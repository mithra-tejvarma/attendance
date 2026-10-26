"""Opt-in, student-scoped push with durable Supabase checks and delivery outbox."""

import asyncio
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
from cryptography.fernet import Fernet, InvalidToken
from google.auth.exceptions import GoogleAuthError

from .cache import fresh
from .campx import CALENDAR, CLASSES, PRIMARY, SUBJECTS, TIMETABLE
from .errors import ServiceError
from .firebase import PushSender
from .normalize import calendar_data, context, daily_bundle, primary_data, subject_data


def fingerprint(data, day):
    bundle = data.get("todayBundle") or data.get("dailyBundle", {}).get(day, {})
    rows = sorted(
        (
            str(row.get("id", "")),
            str(row.get("classroomTimetableId", "")),
            str(row.get("subjectId", "")),
            row.get("isAbsent"),
        )
        for row in bundle.get("attendance", [])
        if row.get("isAbsent") in (0, 1)
    )
    stats = data.get("primary", {}).get("primaryAttendance", {})
    summary = {
        key: stats.get(key)
        for key in ("present", "absent", "totalSessionsIncludingActivity")
    }
    return hashlib.sha256(
        json.dumps(
            {"rows": rows, "summary": summary}, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()


class Notifications:
    def __init__(self, service, sender=None):
        self.service = service
        self.store = service.store
        self.settings = service.settings
        self.sender = sender or (
            PushSender(self.settings.firebase_project)
            if self.settings.notifications_enabled
            else None
        )
        self.cipher = (
            Fernet(self.settings.encryption_key.encode())
            if self.settings.encryption_key
            else None
        )

    async def close(self):
        if self.sender:
            await self.sender.close()

    def require(self):
        if (
            not self.settings.notifications_enabled
            or not self.cipher
            or not hasattr(self.store, "request")
        ):
            raise ServiceError(
                503,
                "notifications_unavailable",
                "Attendance notifications are not connected yet.",
            )

    async def configured(self):
        enabled = (
            self.settings.notifications_enabled
            and bool(self.cipher)
            and hasattr(self.store, "request")
            and bool(self.settings.vapid_public)
            and self.settings.firebase_web.get("projectId")
            == self.settings.firebase_project
        )
        if enabled:
            try:
                for table in ("push_subscriptions", "notification_outbox"):
                    await self.store.request(
                        "GET", table, params={"select": "*", "limit": "0"}
                    )
            except ServiceError:
                enabled = False
        return {
            "enabled": enabled,
            "firebaseConfig": {
                k: v
                for k, v in self.settings.firebase_web.items()
                if k
                in (
                    "apiKey",
                    "projectId",
                    "appId",
                    "messagingSenderId",
                    "authDomain",
                    "storageBucket",
                )
            }
            if enabled
            else None,
            "vapidKey": self.settings.vapid_public if enabled else None,
            "checkIntervalSeconds": self.settings.notification_interval_seconds,
            "usageEnabled": self.settings.firebase_usage,
        }

    async def subscribe(self, session, token):
        self.require()
        if not (await self.configured())["enabled"]:
            raise ServiceError(
                503,
                "notifications_unavailable",
                "Notification setup is incomplete. Please try later.",
            )
        now = datetime.now(ZoneInfo("Asia/Kolkata"))
        day = now.date().isoformat()
        snapshot = await self.store.get_snapshot(session["student_id"], "dashboard")
        baseline = snapshot["data"] if snapshot else {}
        digest = hashlib.sha256(token.encode()).hexdigest()
        await self.store.request(
            "DELETE", "push_subscriptions", params={"token_hash": "eq." + digest}
        )
        await self.store.request(
            "POST",
            "push_subscriptions",
            json={
                "token_hash": digest,
                "student_id": session["student_id"],
                "session_token_hash": session["token_hash"],
                "encrypted_token": self.cipher.encrypt(token.encode()).decode(),
                "enabled": True,
                "last_fingerprint": fingerprint(baseline, day),
                "snapshot_day": day,
                "next_check_at": (
                    now + timedelta(seconds=self.settings.notification_interval_seconds)
                ).isoformat(),
                "lease_owner": None,
                "lease_until": None,
            },
        )
        return {
            "enabled": True,
            "checkIntervalSeconds": self.settings.notification_interval_seconds,
        }

    async def unsubscribe(self, session, token):
        self.require()
        digest = hashlib.sha256(token.encode()).hexdigest()
        await self.store.request(
            "DELETE",
            "push_subscriptions",
            params={
                "token_hash": "eq." + digest,
                "student_id": "eq." + session["student_id"],
            },
        )

    async def test(self, session, token):
        self.require()
        digest = hashlib.sha256(token.encode()).hexdigest()
        rows = await self.store.request(
            "GET",
            "push_subscriptions",
            params={
                "token_hash": "eq." + digest,
                "student_id": "eq." + session["student_id"],
                "session_token_hash": "eq." + session["token_hash"],
                "select": "encrypted_token",
                "limit": "1",
            },
        )
        if not rows:
            raise ServiceError(
                404,
                "subscription_missing",
                "Enable notifications on this device first.",
            )
        try:
            outcome = await self.sender.send(
                self.cipher.decrypt(rows[0]["encrypted_token"].encode()).decode(),
                str(uuid4()),
                test=True,
            )
        except (httpx.RequestError, ValueError, GoogleAuthError, InvalidToken):
            outcome = "retry"
        if outcome != "sent":
            raise ServiceError(
                503,
                "push_delivery",
                "The push service did not accept this test. Please try again later.",
            )
        return {"accepted": True}

    def authorize_cron(self, request, *, notifications=True):
        value = request.headers.get("authorization", "").removeprefix("Bearer ")
        if len(self.settings.cron_secret) < 32 or not hmac.compare_digest(
            value, self.settings.cron_secret
        ):
            raise ServiceError(401, "cron_auth", "Scheduler authentication required.")
        if notifications:
            self.require()
        elif not hasattr(self.store, "request"):
            raise ServiceError(
                503, "storage_unavailable", "Maintenance requires shared storage."
            )

    async def recent_day(self, session):
        from .app import parallel

        now = datetime.now(ZoneInfo("Asia/Kolkata"))
        day = now.date().isoformat()
        ctx = session["context"]
        uid = session["student_id"]
        cached = await self.store.get_snapshot(uid, "today:" + day)
        if session["connection"].get("reconnectRequired"):
            raise ServiceError(
                428,
                "campx_reconnect",
                "Reconnect to CampX to resume background checks.",
            )
        if fresh(cached, ctx, 60):
            return cached["data"], day
        dashboard = await self.store.get_snapshot(uid, "dashboard")
        if fresh(dashboard, ctx, 60):
            return dashboard["data"], day
        async with (
            self.service.admitted(),
            self.service.student_lease(uid),
            self.service.client(session["connection"]) as client,
        ):
            params = {
                "semNo": ctx["semNo"],
                "classroomId": ctx["classroomId"],
                "fromDate": day,
                "toDate": day,
            }
            raw, subjects, monthly, records, timetable = await parallel(
                client.get(PRIMARY),
                client.get(SUBJECTS, semNo=ctx["semNo"]),
                client.get(
                    CALENDAR,
                    semNo=ctx["semNo"],
                    month=str(now.month),
                    year=str(now.year),
                ),
                client.get(CLASSES, **params),
                client.get(
                    TIMETABLE, classroomId=ctx["classroomId"], fromDate=day, toDate=day
                ),
            )
            if context(raw) != ctx:
                raise ServiceError(
                    401,
                    "campx_session",
                    "Reconnect to CampX to resume background checks.",
                )
            data = {
                "primary": primary_data(raw),
                "subjectWise": subject_data(subjects),
                "monthlyCalendar": calendar_data(monthly, now.year, now.month),
                "todayBundle": daily_bundle(
                    records, timetable, now.year, now.month, day, student_context=ctx
                )[day],
                "dynamicContext": {
                    **{k: ctx[k] for k in ("classroomId", "semNo")},
                    "currentYear": now.year,
                    "currentMonth": now.month,
                },
                "fetchedAt": datetime.now(UTC).isoformat(),
                "schemaVersion": 1,
            }
            session["connection"] = client.connection()
            await self.store.update_session(session)
            await self.store.save_snapshot(uid, "today:" + day, data)
            # Keep the small foreground snapshot current without replacing historical month data.
            compact = {k: v for k, v in data.items() if k != "todayBundle"}
            compact.update(
                dailyBundle={day: data["todayBundle"]}, monthDetailsComplete=False
            )
            await self.store.save_snapshot(uid, "dashboard", compact)
            return data, day

    async def check_one(self, row, owner):
        session = await self.store.get_session(row["session_token_hash"])
        if not session or datetime.fromisoformat(session["expires_at"]) <= datetime.now(
            UTC
        ):
            return False
        try:
            async with asyncio.timeout(20):
                data, day = await self.recent_day(session)
            bundle = data.get("todayBundle") or data.get("dailyBundle", {}).get(day, {})
            notify = row["snapshot_day"] == day or bool(bundle.get("attendance"))
            changed = await self.store.request(
                "POST",
                "rpc/finish_notification_check",
                json={
                    "p_hash": row["token_hash"],
                    "p_owner": owner,
                    "p_fingerprint": fingerprint(data, day),
                    "p_day": day,
                    "p_interval": self.settings.notification_interval_seconds,
                    "p_notify": notify,
                },
            )
            return changed is True
        except (ServiceError, TimeoutError) as error:
            if isinstance(error, ServiceError) and (
                error.status in (401, 428) or error.code == "campx_session"
            ):
                if hasattr(self.store, "update_session"):
                    session.setdefault("connection", {})["reconnectRequired"] = True
                    await self.store.update_session(session)
                await self.store.request(
                    "PATCH",
                    "push_subscriptions",
                    params={
                        "token_hash": "eq." + row["token_hash"],
                        "lease_owner": "eq." + owner,
                    },
                    json={"enabled": False, "lease_owner": None, "lease_until": None},
                )
            # A crash/timeout leaves a bounded lease, never an unlocked duplicate refresh.
            return False

    async def deliver(self, row, owner):
        records = await self.store.request(
            "GET",
            "push_subscriptions",
            params={
                "token_hash": "eq." + row["subscription_hash"],
                "enabled": "eq.true",
                "select": "encrypted_token",
                "limit": "1",
            },
        )
        if not records:
            return False
        try:
            outcome = await self.sender.send(
                self.cipher.decrypt(records[0]["encrypted_token"].encode()).decode(),
                row["id"],
            )
        except (httpx.RequestError, ValueError, GoogleAuthError, InvalidToken):
            outcome = "retry"
        status = (
            "sent"
            if outcome == "sent"
            else "dead"
            if outcome == "unregistered" or row["attempts"] >= 5
            else "pending"
        )
        await self.store.request(
            "PATCH",
            "notification_outbox",
            params={"id": "eq." + row["id"], "lease_owner": "eq." + owner},
            json={
                "status": status,
                "lease_owner": None,
                "lease_until": None,
                "next_attempt_at": (
                    datetime.now(UTC)
                    + timedelta(seconds=min(3600, 30 * 2 ** row["attempts"]))
                ).isoformat(),
            },
        )
        if outcome == "unregistered":
            await self.store.request(
                "PATCH",
                "push_subscriptions",
                params={"token_hash": "eq." + row["subscription_hash"]},
                json={"enabled": False},
            )
        return outcome == "sent"

    async def run(self):
        self.require()
        owner = str(uuid4())
        rows = await self.store.request(
            "POST",
            "rpc/claim_notification_checks",
            json={"p_owner": owner, "p_limit": self.settings.notification_batch_size},
            headers={"Prefer": "return=representation"},
        )
        slots = asyncio.Semaphore(2)

        completed = []

        async def check(row):
            async with slots:
                try:
                    completed.append(await self.check_one(row, owner))
                except ServiceError:
                    completed.append(False)

        try:
            async with asyncio.timeout(16):
                await asyncio.gather(*(check(row) for row in rows))
        except TimeoutError:
            pass  # Unfinished claims become available after their bounded SQL lease.
        return {
            "claimedChecks": len(rows),
            "checked": len(completed),
            "deferredChecks": len(rows) - len(completed),
            "changed": sum(completed),
        }

    async def run_deliveries(self):
        self.require()
        owner = str(uuid4())
        slots = asyncio.Semaphore(2)
        deliveries = await self.store.request(
            "POST",
            "rpc/claim_notification_deliveries",
            json={
                "p_owner": owner,
                "p_limit": min(10, self.settings.notification_batch_size),
            },
            headers={"Prefer": "return=representation"},
        )
        sent = []

        async def deliver(row):
            async with slots:
                try:
                    sent.append(await self.deliver(row, owner))
                except ServiceError:
                    sent.append(False)

        try:
            async with asyncio.timeout(16):
                await asyncio.gather(*(deliver(row) for row in deliveries))
        except TimeoutError:
            pass
        return {
            "acceptedByFcm": sum(sent),
            "deliveryAttempts": len(deliveries),
            "completedAttempts": len(sent),
        }
