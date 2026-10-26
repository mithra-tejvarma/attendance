import asyncio
import json
import os

import httpx


class FirebaseAuth:
    def __init__(self):
        import google.auth
        from google.oauth2 import service_account

        scopes = ["https://www.googleapis.com/auth/firebase.messaging"]
        raw = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        self.credentials = (
            service_account.Credentials.from_service_account_info(
                json.loads(raw), scopes=scopes
            )
            if raw
            else google.auth.default(scopes=scopes)[0]
        )
        self.lock = asyncio.Lock()

    async def token(self):
        async with self.lock:
            if not self.credentials.valid:
                from google.auth.transport.requests import Request

                request = Request()

                def bounded(**kwargs):
                    kwargs["timeout"] = 8
                    return request(**kwargs)

                await asyncio.to_thread(self.credentials.refresh, bounded)
            return self.credentials.token


class PushSender:
    def __init__(self, project, transport=None, auth=None):
        self.project, self.auth = project, auth or FirebaseAuth()
        self.client = httpx.AsyncClient(timeout=8, transport=transport)

    async def send(self, token, event_id, test=False):
        access = await self.auth.token()
        response = await self.client.post(
            f"https://fcm.googleapis.com/v1/projects/{self.project}/messages:send",
            headers={"Authorization": "Bearer " + access},
            json={
                "message": {
                    "token": token,
                    "data": {
                        "title": "Attendance notifications connected"
                        if test
                        else "Your attendance was updated",
                        "body": "You can now receive updates while your CampX connection is valid."
                        if test
                        else "Open Attendance to see your latest personal records.",
                        "url": "/",
                        "eventId": event_id,
                    },
                    "webpush": {
                        "headers": {
                            "TTL": "3600",
                            "Topic": event_id.replace("-", "")[:32],
                        }
                    },
                }
            },
        )
        if response.is_success:
            return "sent"
        try:
            details = response.json().get("error", {}).get("details", [])
            unregistered = any(
                item.get("errorCode") == "UNREGISTERED"
                for item in details
                if isinstance(item, dict)
            )
        except ValueError:
            unregistered = False
        return "unregistered" if unregistered else "retry"

    async def close(self):
        await self.client.aclose()
