import asyncio
import copy
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import UNTIL_SIGN_OUT, create_app
from backend.campx import PRIMARY, SUBJECTS
from backend.config import Settings
from backend.store import MemoryStore
from backend_tests.test_backend import FakeCampx, sign_in


def test_remembered_session_survives_service_restart_and_keeps_only_owned_snapshot():
    fake, store = FakeCampx(), MemoryStore()
    first = create_app(
        Settings(), store=store, transport=httpx.MockTransport(fake.handler)
    )
    with TestClient(first) as client:
        _, headers = sign_in(client)
        session = next(iter(store.sessions.values()))
        assert session["expires_at"] == UNTIL_SIGN_OUT
        assert session["connection"]["loginId"] == "fixture"
        assert "password" not in str(session).lower()
    fake.calls.clear()
    second = create_app(
        Settings(), store=store, transport=httpx.MockTransport(fake.handler)
    )
    with TestClient(second) as client:
        saved = client.get("/api/me/dashboard", headers=headers)
        assert saved.status_code == 200
        assert saved.json()["loginId"] == "fixture"
        assert not fake.calls
        assert client.post("/api/logout", headers=headers).status_code == 204
        assert client.get("/api/me/dashboard", headers=headers).status_code == 401


def test_session_zero_is_supported_and_explicit_timed_sessions_still_expire(
    monkeypatch,
):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("SESSION_TTL_SECONDS", "0")
    assert Settings.from_env().session_seconds == 0
    monkeypatch.setenv("SESSION_TTL_SECONDS", "-1")
    with pytest.raises(ValueError):
        Settings.from_env()
    fake = FakeCampx()
    with TestClient(
        create_app(
            Settings(session_seconds=7200),
            store=MemoryStore(),
            transport=httpx.MockTransport(fake.handler),
        )
    ) as client:
        data, _ = sign_in(client)
        expires = datetime.fromisoformat(data["sessionExpiresAt"])
        assert 7100 < (expires - datetime.now(UTC)).total_seconds() <= 7200


def test_campx_reconnect_keeps_app_token_and_checks_student_identity():
    fake, store = FakeCampx(), MemoryStore()
    with TestClient(
        create_app(Settings(), store=store, transport=httpx.MockTransport(fake.handler))
    ) as client:
        _, headers = sign_in(client)
        before = copy.deepcopy(store.sessions)
        fake.responses[PRIMARY] = lambda _: httpx.Response(
            401, json={"private": "PRIVATE"}
        )
        assert client.post("/api/refresh", headers=headers).status_code == 428
        fake.calls.clear()
        assert client.post("/api/refresh", headers=headers).status_code == 428
        assert not fake.calls  # Don't repeatedly send an expired upstream connection.
        assert client.get("/api/me/dashboard", headers=headers).status_code == 200
        del fake.responses[PRIMARY]
        original = fake.primary["student"]["id"]
        fake.primary["student"]["id"] = "different-student"
        wrong = client.post(
            "/api/reconnect",
            headers=headers,
            json={"loginId": "another", "password": "  valid password  "},
        )
        assert wrong.status_code == 403
        assert wrong.json()["code"] == "account_mismatch"
        assert set(store.sessions) == set(before)
        fake.primary["student"]["id"] = original
        response = client.post(
            "/api/reconnect",
            headers=headers,
            json={"loginId": "fixture", "password": "  valid password  "},
        )
        assert response.status_code == 200
        assert set(store.sessions) == set(before)
        assert not next(iter(store.sessions.values()))["connection"].get(
            "reconnectRequired"
        )
        assert client.post("/api/refresh", headers=headers).status_code == 200
        assert (
            client.get("/api/me/dashboard", headers=headers).json()[
                "campxReconnectRequired"
            ]
            is False
        )
        assert client.post("/api/logout", headers=headers).status_code == 204
        assert (
            client.post(
                "/api/reconnect",
                headers=headers,
                json={"loginId": "fixture", "password": "  valid password  "},
            ).status_code
            == 401
        )


@pytest.mark.asyncio
async def test_logout_during_reconnect_cannot_restore_revoked_session():
    fake, store = FakeCampx(), MemoryStore()
    entered, release = asyncio.Event(), asyncio.Event()
    reconnecting = False

    async def handler(request):
        if reconnecting and request.url.path == SUBJECTS:
            entered.set()
            await release.wait()
        return fake.handler(request)

    app = create_app(Settings(), store=store, transport=httpx.MockTransport(handler))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture"
        ) as client,
    ):
        response = await client.post(
            "/api/attendance",
            json={"loginId": "fixture", "password": "  valid password  "},
        )
        headers = {"Authorization": "Bearer " + response.json()["sessionToken"]}
        reconnecting = True
        task = asyncio.create_task(
            client.post(
                "/api/reconnect",
                headers=headers,
                json={"loginId": "fixture", "password": "  valid password  "},
            )
        )
        await asyncio.wait_for(entered.wait(), 2)
        assert (await client.post("/api/logout", headers=headers)).status_code == 204
        release.set()
        assert (await task).status_code == 401
        assert not store.sessions
