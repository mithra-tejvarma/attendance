import copy
import json
import time
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet, InvalidToken

from .config import Settings
from .errors import ServiceError


def storage_error():
    return ServiceError(
        503,
        "storage_unavailable",
        "Private student storage is unavailable. Please try again.",
    )


class MemoryStore:
    """Bounded single-process development store. Never selected in production."""

    def __init__(self, capacity=1000):
        self.sessions, self.students, self.snapshots, self.leases = {}, {}, {}, {}
        self.capacity = capacity

    async def close(self):
        pass

    async def ready(self):
        return "development-memory"

    def prune(self):
        now = datetime.now(UTC)
        self.sessions = {
            k: v
            for k, v in self.sessions.items()
            if datetime.fromisoformat(v["expires_at"]) > now
        }

    async def put_session(self, session):
        self.prune()
        if (
            session["token_hash"] not in self.sessions
            and len(self.sessions) >= self.capacity
        ):
            raise ServiceError(
                503,
                "session_capacity",
                "The development server is at capacity. Please try later.",
            )
        self.sessions[session["token_hash"]] = copy.deepcopy(session)

    async def update_session(self, session):
        self.prune()
        if session["token_hash"] not in self.sessions:
            raise ServiceError(
                401, "app_session", "Your app session was revoked. Please reconnect."
            )
        self.sessions[session["token_hash"]] = copy.deepcopy(session)

    async def get_session(self, token_hash):
        self.prune()
        return copy.deepcopy(self.sessions.get(token_hash))

    async def delete_session(self, token_hash):
        self.sessions.pop(token_hash, None)

    async def save_student(self, uid, profile):
        if uid not in self.students and len(self.students) >= self.capacity:
            self.students.pop(next(iter(self.students)))
        self.students[uid] = copy.deepcopy(profile)

    async def save_snapshot(self, uid, kind, data):
        key = (uid, kind)
        if key not in self.snapshots and len(self.snapshots) >= self.capacity * 8:
            self.snapshots.pop(next(iter(self.snapshots)))
        self.snapshots[key] = {
            "schemaVersion": 1,
            "fetchedAt": datetime.now(UTC).isoformat(),
            "data": copy.deepcopy(data),
        }

    async def get_snapshot(self, uid, kind):
        return copy.deepcopy(self.snapshots.get((uid, kind)))

    async def claim(self, uid):
        now = time.monotonic()
        self.leases = {k: v for k, v in self.leases.items() if v[1] > now}
        if uid in self.leases:
            raise ServiceError(
                409,
                "refresh_in_progress",
                "A refresh for this student is already running. Please wait.",
            )
        owner = str(uuid4())
        self.leases[uid] = (owner, now + 120)
        return owner

    async def release(self, uid, owner):
        if self.leases.get(uid, (None,))[0] == owner:
            self.leases.pop(uid, None)


class SupabaseStore:
    def __init__(self, settings: Settings, transport=None):
        # Invalid keys fail startup without printing their value.
        self.cipher = Fernet(settings.encryption_key.encode())
        self.client = httpx.AsyncClient(
            base_url=settings.supabase_url + "/rest/v1/",
            headers={
                "apikey": settings.supabase_key,
                "Authorization": "Bearer " + settings.supabase_key,
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            timeout=8,
            transport=transport,
            follow_redirects=False,
        )

    async def close(self):
        await self.client.aclose()

    async def ready(self):
        for table, field in (
            ("students", "id"),
            ("app_sessions", "token_hash"),
            ("attendance_snapshots", "kind"),
            ("student_refresh_leases", "owner"),
        ):
            result = await self.request(
                "GET", table, params={"select": field, "limit": "0"}
            )
            if not isinstance(result, list):
                raise storage_error()
        return "supabase"

    async def request(self, method, path, **kwargs):
        try:
            response = await self.client.request(method, path, **kwargs)
        except httpx.RequestError:
            raise storage_error() from None
        if response.status_code not in (200, 201, 204):
            raise storage_error()
        try:
            return response.json() if response.content else None
        except ValueError:
            raise storage_error() from None

    async def put_session(self, session):
        row = {k: v for k, v in session.items() if k != "connection"}
        row["encrypted_connection"] = self.cipher.encrypt(
            json.dumps(session["connection"]).encode()
        ).decode()
        await self.request("POST", "app_sessions", json=row)

    async def update_session(self, session):
        rows = await self.request(
            "PATCH",
            "app_sessions",
            params={
                "token_hash": "eq." + session["token_hash"],
                "student_id": "eq." + session["student_id"],
                "expires_at": "gt." + datetime.now(UTC).isoformat(),
            },
            headers={"Prefer": "return=representation"},
            json={
                "context": session["context"],
                "encrypted_connection": self.cipher.encrypt(
                    json.dumps(session["connection"]).encode()
                ).decode(),
            },
        )
        if not isinstance(rows, list):
            raise storage_error()
        if not rows:
            raise ServiceError(
                401, "app_session", "Your app session was revoked. Please reconnect."
            )

    async def get_session(self, token_hash):
        rows = await self.request(
            "GET",
            "app_sessions",
            params={"token_hash": "eq." + token_hash, "select": "*", "limit": "1"},
        )
        if not isinstance(rows, list):
            raise storage_error()
        if not rows:
            return None
        row = rows[0]
        try:
            row["connection"] = json.loads(
                self.cipher.decrypt(row.pop("encrypted_connection").encode())
            )
        except (InvalidToken, ValueError, KeyError, AttributeError):
            raise storage_error() from None
        return row

    async def delete_session(self, token_hash):
        await self.request(
            "DELETE", "app_sessions", params={"token_hash": "eq." + token_hash}
        )

    async def save_student(self, uid, profile):
        await self.request(
            "POST",
            "students",
            json={
                "id": uid,
                "profile": profile,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )

    async def save_snapshot(self, uid, kind, data):
        await self.request(
            "POST",
            "attendance_snapshots",
            json={
                "student_id": uid,
                "kind": kind,
                "schema_version": 1,
                "fetched_at": datetime.now(UTC).isoformat(),
                "payload": data,
            },
        )

    async def get_snapshot(self, uid, kind):
        rows = await self.request(
            "GET",
            "attendance_snapshots",
            params={
                "student_id": "eq." + uid,
                "kind": "eq." + kind,
                "select": "schema_version,fetched_at,payload",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise storage_error()
        return (
            {
                "schemaVersion": rows[0]["schema_version"],
                "fetchedAt": rows[0]["fetched_at"],
                "data": rows[0]["payload"],
            }
            if rows
            else None
        )

    async def claim(self, uid):
        owner = str(uuid4())
        acquired = await self.request(
            "POST",
            "rpc/claim_student_refresh",
            json={"p_student_id": uid, "p_owner": owner},
            headers={"Prefer": "return=representation"},
        )
        if acquired is not True:
            raise ServiceError(
                409,
                "refresh_in_progress",
                "A refresh for this student is already running. Please wait.",
            )
        return owner

    async def release(self, uid, owner):
        await self.request(
            "POST",
            "rpc/release_student_refresh",
            json={"p_student_id": uid, "p_owner": owner},
        )
