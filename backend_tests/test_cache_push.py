import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.cache import compact_dashboard, fresh
from backend.config import Settings
from backend.errors import ServiceError
from backend.firebase import PushSender
from backend.notifications import Notifications, fingerprint
from backend.store import MemoryStore
from backend.usage import Usage
from backend_tests.test_backend import FakeCampx, sign_in

COMPACT = {"Accept": "application/vnd.varmalabs.compact+json"}


def test_compact_cache_keeps_month_on_demand_and_verifies_each_login():
    fake, store = FakeCampx(), MemoryStore()
    app = create_app(
        Settings(cache_seconds=60),
        store=store,
        transport=httpx.MockTransport(fake.handler),
    )
    with TestClient(app) as client:
        full, headers = sign_in(client)
        fake.calls.clear()
        response = client.post("/api/refresh", headers={**headers, **COMPACT})
        assert response.status_code == 200
        small = response.json()
        assert small["source"] == "cache"
        assert small["monthDetailsComplete"] is False
        assert len(small["dailyBundle"]) <= 1
        assert small["primary"] == full["primary"]
        assert not fake.calls
        ctx = full["dynamicContext"]
        month = client.post(
            "/api/month-complete-data",
            headers=headers,
            json={"month": ctx["currentMonth"], "year": ctx["currentYear"]},
        )
        assert month.json()["dailyBundle"] == full["dailyBundle"]
        assert not fake.calls
        second = client.post(
            "/api/attendance",
            headers=COMPACT,
            json={"loginId": "fixture", "password": "  valid password  "},
        )
        assert second.status_code == 200
        assert second.json()["source"] == "cache"
        assert (
            len(fake.calls) == 2
        )  # Login + identity; never reuse someone else's authentication.
        fake.primary["student"]["id"] = "another-student"
        fake.calls.clear()
        third = client.post(
            "/api/attendance",
            headers=COMPACT,
            json={"loginId": "another", "password": "  valid password  "},
        )
        assert third.status_code == 200
        assert third.json().get("source") != "cache"
        assert len(fake.calls) == 6
        assert len(store.students) == 2


def test_cache_rejects_old_future_or_wrong_class_and_never_mutates_source():
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
    data = {
        "dailyBundle": {today: {"attendance": []}, "2000-01-01": {}},
        "dynamicContext": {"classroomId": "one", "semNo": "7"},
    }
    before = copy.deepcopy(data)
    assert list(compact_dashboard(data)["dailyBundle"]) == [today]
    assert data == before
    snapshot = {"data": data, "fetchedAt": datetime.now(UTC).isoformat()}
    assert fresh(snapshot, data["dynamicContext"], 60)
    assert not fresh(snapshot, {"classroomId": "two", "semNo": "7"}, 60)
    for offset in (-61, 60):
        snapshot["fetchedAt"] = (
            datetime.now(UTC) + timedelta(seconds=offset)
        ).isoformat()
        assert not fresh(snapshot, data["dynamicContext"], 60)


def worker():
    settings = Settings(
        notifications_enabled=True,
        encryption_key=Fernet.generate_key().decode(),
        vapid_public="public-fixture",
        firebase_web={"projectId": "attendance-90c12"},
        cron_secret="x" * 32,
    )
    store = SimpleNamespace(
        request=AsyncMock(return_value=[]), get_snapshot=AsyncMock(return_value=None)
    )
    sender = SimpleNamespace(send=AsyncMock(return_value="sent"))
    service = SimpleNamespace(settings=settings, store=store)
    return Notifications(service, sender), store, sender


@pytest.mark.asyncio
async def test_subscription_encrypts_token_and_binds_verified_session():
    notify, store, _ = worker()
    token = "test-private-device-token" * 3
    await notify.subscribe(
        {"student_id": "student-one", "token_hash": "session-one"}, token
    )
    calls = store.request.call_args_list
    post = next(c for c in calls if c.args == ("POST", "push_subscriptions"))
    row = post.kwargs["json"]
    assert row["student_id"] == "student-one"
    assert row["session_token_hash"] == "session-one"
    assert token not in json.dumps(row)
    assert notify.cipher.decrypt(row["encrypted_token"].encode()).decode() == token
    assert row["token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    await notify.unsubscribe({"student_id": "student-two"}, token)
    assert store.request.call_args.kwargs["params"]["student_id"] == "eq.student-two"


@pytest.mark.asyncio
async def test_test_push_requires_current_session_and_contains_no_private_failure():
    notify, store, sender = worker()
    session = {"student_id": "student-one", "token_hash": "session-one"}
    with pytest.raises(ServiceError) as error:
        await notify.test(session, "token")
    assert error.value.status == 404
    assert (
        store.request.call_args.kwargs["params"]["session_token_hash"]
        == "eq.session-one"
    )
    sender.send.assert_not_awaited()
    store.request.return_value = [
        {"encrypted_token": notify.cipher.encrypt(b"test-private-token").decode()}
    ]
    sender.send.side_effect = httpx.ConnectError("test-private-token")
    with pytest.raises(ServiceError) as error:
        await notify.test(session, "token")
    assert error.value.status == 503
    assert "private-token" not in error.value.message


@pytest.mark.asyncio
async def test_detection_is_order_independent_and_correction_changes_fingerprint():
    day = "2026-10-25"
    rows = [{"id": "one", "isAbsent": 0}, {"id": "two", "isAbsent": 1}]
    first = {"todayBundle": {"attendance": rows}}
    assert fingerprint(first, day) == fingerprint(
        {"dailyBundle": {day: {"attendance": rows[::-1]}}}, day
    )
    changed = copy.deepcopy(first)
    changed["todayBundle"]["attendance"][0]["isAbsent"] = 1
    assert fingerprint(first, day) != fingerprint(changed, day)
    notify, store, _ = worker()
    store.get_session = AsyncMock(
        return_value={
            "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        }
    )
    notify.recent_day = AsyncMock(return_value=(first, day))
    store.request.return_value = True
    assert await notify.check_one(
        {"session_token_hash": "session", "token_hash": "hash", "snapshot_day": day},
        "owner",
    )
    assert store.request.call_args.args[1] == "rpc/finish_notification_check"
    assert store.request.call_args.kwargs["json"]["p_notify"] is True
    notify.recent_day.side_effect = ServiceError(401, "expired", "Reconnect")
    assert not await notify.check_one(
        {"session_token_hash": "session", "token_hash": "hash", "snapshot_day": day},
        "owner",
    )
    assert store.request.call_args.kwargs["json"]["enabled"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome,attempts,status",
    [
        ("sent", 1, "sent"),
        ("retry", 1, "pending"),
        ("retry", 5, "dead"),
        ("unregistered", 1, "dead"),
    ],
)
async def test_delivery_outbox_retries_and_disables_invalid_tokens(
    outcome, attempts, status
):
    notify, store, sender = worker()
    store.request.return_value = [
        {"encrypted_token": notify.cipher.encrypt(b"test-device-token").decode()}
    ]
    sender.send.return_value = outcome
    result = await notify.deliver(
        {"subscription_hash": "hash", "id": "event", "attempts": attempts}, "owner"
    )
    assert result == (outcome == "sent")
    patch = next(
        c
        for c in store.request.call_args_list
        if c.args == ("PATCH", "notification_outbox")
    )
    assert patch.kwargs["json"]["status"] == status
    assert patch.kwargs["params"]["lease_owner"] == "eq.owner"
    if outcome == "unregistered":
        assert store.request.call_args.kwargs["json"] == {"enabled": False}


@pytest.mark.asyncio
async def test_fcm_payload_is_generic_and_unregistered_is_handled():
    requests = []

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, json={"name": "fixture"})
        return httpx.Response(
            404, json={"error": {"details": [{"errorCode": "UNREGISTERED"}]}}
        )

    sender = PushSender(
        "fixture-project",
        transport=httpx.MockTransport(handler),
        auth=SimpleNamespace(token=AsyncMock(return_value="fixture-access")),
    )
    try:
        assert await sender.send("fixture-device", "event-id") == "sent"
        assert await sender.send("fixture-device", "event-id") == "unregistered"
        message = json.loads(requests[0].content)["message"]
        assert message["data"]["url"] == "/"
        assert "student" not in json.dumps(message).lower()
        assert message["webpush"]["headers"]["TTL"] == "3600"
    finally:
        await sender.close()


@pytest.mark.asyncio
async def test_firebase_budget_denial_skips_write_without_affecting_app():
    store = SimpleNamespace(request=AsyncMock(return_value=False))
    usage = Usage(Settings(), store)
    usage.client = SimpleNamespace(post=AsyncMock())
    await usage.write(("student", "login", 6, True, "2026-10-25"))
    usage.client.post.assert_not_awaited()
    assert store.request.call_args.kwargs["json"]["p_cost"] == 2


def test_scheduler_is_protected_and_maintenance_does_not_require_firebase():
    class SharedMemory(MemoryStore):
        request = AsyncMock(return_value=0)

    app = create_app(Settings(cron_secret="fixture-" * 8), store=SharedMemory())
    with TestClient(app) as client:
        assert client.get("/api/notifications/config").json()["enabled"] is False
        assert client.post("/internal/notifications/run").status_code == 401
        assert client.post("/internal/maintenance").status_code == 401
        headers = {"Authorization": "Bearer " + "fixture-" * 8}
        assert (
            client.post("/internal/notifications/run", headers=headers).status_code
            == 503
        )
        assert client.post("/internal/maintenance", headers=headers).json() == {
            "deleted": 0
        }
        assert (
            client.post(
                "/api/notifications/subscribe", json={"token": "fixture-" * 8}
            ).status_code
            == 401
        )


@pytest.mark.asyncio
async def test_background_refresh_uses_personal_session_and_reuses_recent_snapshot():
    from backend.app import Service
    from backend.normalize import context

    fake, store = FakeCampx(), MemoryStore()
    settings = Settings(encryption_key=Fernet.generate_key().decode())
    usage = Usage(settings)
    service = Service(
        settings, store, usage, transport=httpx.MockTransport(fake.handler)
    )
    async with service.client() as upstream:
        await upstream.authenticate("fixture", "  valid password  ")
        session = {
            "token_hash": "fixture-hash",
            "student_id": context(fake.primary)["studentId"],
            "context": context(fake.primary),
            "connection": upstream.connection(),
            "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        }
    await store.put_session(session)
    notify = Notifications(service, sender=SimpleNamespace())
    fake.calls.clear()
    data, day = await notify.recent_day(session)
    assert len(fake.calls) == 5
    assert data["primary"]["student"]["email"] == "fixture@example.test"
    assert data["dynamicContext"]["classroomId"] == session["context"]["classroomId"]
    assert "todayBundle" in data
    saved = await store.get_snapshot(session["student_id"], "dashboard")
    assert saved["data"]["monthDetailsComplete"] is False
    assert list(saved["data"]["dailyBundle"]) == [day]
    fake.calls.clear()
    again, same_day = await notify.recent_day(session)
    assert again == data and same_day == day
    assert not fake.calls
    assert (
        usage.queue.empty()
    )  # Background polling must not consume analytics write quota.
