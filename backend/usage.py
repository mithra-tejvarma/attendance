"""Optional backend-only Firebase usage aggregates. No Firebase Auth or student PII."""

import asyncio
import json
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger("attendance.usage")


class Usage:
    def __init__(self, settings, store=None):
        self.enabled = settings.firebase_usage
        self.store = store
        self.project = settings.firebase_project
        self.queue = asyncio.Queue(maxsize=128)
        self.worker = None
        self.credentials = None
        self.client = None
        if self.enabled:
            import google.auth
            from google.oauth2 import service_account

            scopes = ["https://www.googleapis.com/auth/datastore"]
            raw = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
            self.credentials = (
                service_account.Credentials.from_service_account_info(
                    json.loads(raw), scopes=scopes
                )
                if raw
                else google.auth.default(scopes=scopes)[0]
            )

    async def start(self):
        if self.enabled:
            self.client = httpx.AsyncClient(timeout=10)
            self.worker = asyncio.create_task(self.run())

    def emit(self, uid, operation, calls, success):
        if not self.enabled:
            return
        try:
            self.queue.put_nowait(
                (
                    uid,
                    operation,
                    calls,
                    success,
                    datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat(),
                )
            )
        except asyncio.QueueFull:
            logger.warning("Usage queue is full; an analytics event was dropped")

    async def run(self):
        while True:
            event = await self.queue.get()
            try:
                await self.write(event)
            except Exception:  # noqa: BLE001 -- analytics must not terminate the attendance service
                # Never include credentials, exception strings, or response bodies in logs.
                logger.warning(
                    "Firebase usage write failed; attendance response was unaffected"
                )
            finally:
                self.queue.task_done()

    async def write(self, event):
        uid, operation, calls, success, day = event
        if self.store and hasattr(self.store, "request"):
            reserved = await self.store.request(
                "POST",
                "rpc/reserve_firebase_usage_writes",
                json={
                    "p_cost": 2 if operation == "login" and success else 1,
                    "p_limit": 16000,
                },
                headers={"Prefer": "return=representation"},
            )
            if reserved is not True:
                return
        if not self.credentials.valid:
            from google.auth.transport.requests import Request

            request = Request()

            def bounded_request(**kwargs):
                kwargs["timeout"] = 10
                return request(**kwargs)

            await asyncio.to_thread(self.credentials.refresh, bounded_request)
        base = f"projects/{self.project}/databases/(default)/documents"
        name = f"{base}/usage_users/{uid}/days/{day}"
        counters = {
            operation + "Requests": 1,
            "campxRequests": calls,
            "successfulRequests" if success else "failedRequests": 1,
        }
        transforms = [
            {"fieldPath": key, "increment": {"integerValue": str(value)}}
            for key, value in counters.items()
        ]
        transforms.append(
            {"fieldPath": "lastActiveAt", "setToServerValue": "REQUEST_TIME"}
        )
        writes = [
            {
                "update": {
                    "name": name,
                    "fields": {
                        "studentId": {"stringValue": uid},
                        "date": {"stringValue": day},
                    },
                },
                "updateMask": {"fieldPaths": ["studentId", "date"]},
                "updateTransforms": transforms,
            }
        ]
        if operation == "login" and success:
            # A parent document makes total verified users countable without scanning daily events.
            writes.append(
                {
                    "update": {
                        "name": f"{base}/usage_users/{uid}",
                        "fields": {"studentId": {"stringValue": uid}},
                    },
                    "updateMask": {"fieldPaths": ["studentId"]},
                    "updateTransforms": [
                        {
                            "fieldPath": "lastLoginAt",
                            "setToServerValue": "REQUEST_TIME",
                        },
                        {
                            "fieldPath": "successfulLogins",
                            "increment": {"integerValue": "1"},
                        },
                    ],
                }
            )
        response = await self.client.post(
            f"https://firestore.googleapis.com/v1/{base}:commit",
            headers={"Authorization": "Bearer " + self.credentials.token},
            json={"writes": writes},
        )
        response.raise_for_status()

    async def close(self):
        if self.worker:
            try:
                await asyncio.wait_for(self.queue.join(), timeout=2)
            except TimeoutError:
                pass
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)
        if self.client:
            await self.client.aclose()
