import asyncio
import copy
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.campx import CALENDAR, CLASSES, LOGIN, PRIMARY, SUBJECTS, TIMETABLE
from backend.config import Settings
from backend.errors import ServiceError
from backend.store import MemoryStore, SupabaseStore


class FakeCampx:
    def __init__(self):
        self.calls = []
        self.responses = {}
        self.identity = "one"
        self.primary = {
            "student": {
                "id": "one",
                "fullName": "Fixture Student",
                "rollNo": "FIXTURE",
                "email": "fixture@example.test",
                "branchCode": "CSE",
                "classroomId": "class-1",
                "semNo": "7",
                "bankAccount": "PRIVATE",
            },
            "classroom": {"name": "B"},
            "attendancePercentage": 80,
            "primaryAttendance": {
                "present": 8,
                "absent": 2,
                "totalSessionsIncludingActivity": 10,
            },
            "token": "PRIVATE",
            "contactAddress": "PRIVATE",
        }

    def handler(self, request):
        self.calls.append(request)
        path = request.url.path
        if path in self.responses:
            return self.responses[path](request)
        if path == LOGIN:
            assert json.loads(request.content)["password"] == "  valid password  "
            return httpx.Response(
                201,
                json={"message": "ok"},
                headers={
                    "Set-Cookie": "campx_session=PRIVATE_SESSION; Path=/; Secure; HttpOnly"
                },
            )
        assert request.headers.get("cookie") == "campx_session=PRIVATE_SESSION"
        if path == PRIMARY:
            return httpx.Response(200, json=self.primary)
        if path == SUBJECTS:
            return httpx.Response(
                200,
                json={
                    "overallAttendance": 80,
                    "subjects": [
                        {
                            "subjectName": "Math",
                            "subjectId": "math",
                            "present": 8,
                            "numberOfClasses": 10,
                            "percentage": 80,
                            "unnecessaryField": "PRIVATE",
                        }
                    ],
                },
            )
        if path == CALENDAR:
            return httpx.Response(200, json={})
        if path == CLASSES:
            return httpx.Response(
                200,
                json=[
                    {
                        "date": request.url.params["fromDate"],
                        "subjectId": "math",
                        "isAbsent": 0,
                        "unnecessaryField": "PRIVATE",
                    }
                ],
            )
        if path == TIMETABLE:
            return httpx.Response(
                200,
                json=[
                    {
                        "sessionDate": request.url.params["fromDate"],
                        "subjectId": "math",
                        "fromTime": "09:00",
                        "toTime": "10:00",
                        "orderNumber": 2,
                    },
                    {
                        "sessionDate": request.url.params["fromDate"],
                        "subjectId": "other",
                        "fromTime": "08:00",
                        "toTime": "09:00",
                        "orderNumber": 1,
                    },
                ],
            )
        raise AssertionError(path)


@pytest.fixture
def setup():
    fake, store = FakeCampx(), MemoryStore()
    app = create_app(
        Settings(), store=store, transport=httpx.MockTransport(fake.handler)
    )
    with TestClient(app) as client:
        yield client, fake, store, app


def sign_in(client):
    response = client.post(
        "/api/attendance", json={"loginId": "fixture", "password": "  valid password  "}
    )
    assert response.status_code == 200, response.text
    return response.json(), {
        "Authorization": "Bearer " + response.json()["sessionToken"]
    }


def test_login_returns_minimal_data_and_saves_no_passwords(setup):
    client, fake, store, _ = setup
    data, headers = sign_in(client)
    assert len(fake.calls) == 6
    assert data["primary"]["student"]["email"] == "fixture@example.test"
    assert data["subjectWise"]["subjects"][0]["percentage"] == 80
    assert "PRIVATE" not in json.dumps(data)
    snapshot = next(iter(store.snapshots.values()))
    assert "sessionToken" not in snapshot["data"]
    assert "password" not in json.dumps(store.sessions)
    assert "  valid password  " not in json.dumps(store.sessions)
    assert data["sessionToken"] not in json.dumps(store.sessions)
    bundle = next(iter(data["dailyBundle"].values()))
    assert [s["orderNumber"] for s in bundle["timetable"]] == [1, 2]
    assert bundle["attendance"][0]["isAbsent"] == 0
    assert (
        client.get("/api/me/dashboard", headers=headers).json()["data"]
        == snapshot["data"]
    )
    assert len(fake.calls) == 6  # Reading a snapshot never calls CampX.


def test_session_refresh_avoids_login_and_logout_revokes_access(setup):
    client, fake, _, _ = setup
    _, headers = sign_in(client)
    fake.calls.clear()
    result = client.post("/api/refresh", headers=headers)
    assert result.status_code == 200
    assert len(fake.calls) == 5
    assert all(r.url.path != LOGIN for r in fake.calls)
    assert client.post("/api/logout", headers=headers).status_code == 204
    assert client.post("/api/refresh", headers=headers).status_code == 401


def test_session_expiry(setup):
    client, _, store, _ = setup
    _, headers = sign_in(client)
    for session in store.sessions.values():
        session["expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    assert client.get("/api/me/dashboard", headers=headers).status_code == 401


def test_month_context_is_verified_and_never_trusted_from_browser(setup):
    client, fake, _, _ = setup
    _, headers = sign_in(client)
    fake.calls.clear()
    response = client.post(
        "/api/month-complete-data",
        headers=headers,
        json={"month": 2, "year": 2024, "classroomId": "another-student", "semNo": "7"},
    )
    assert response.status_code == 403
    assert not fake.calls
    response = client.post(
        "/api/month-complete-data", headers=headers, json={"month": 2, "year": 2024}
    )
    assert response.status_code == 200
    assert len(response.json()["dailyBundle"]) == 29
    assert len(fake.calls) == 3
    records = next(r for r in fake.calls if r.url.path == CLASSES)
    assert records.url.params["classroomId"] == "class-1"


def test_legacy_credential_month_route_still_checks_identity(setup):
    client, fake, _, _ = setup
    response = client.post(
        "/api/month-complete-data",
        json={
            "loginId": "fixture",
            "password": "  valid password  ",
            "year": 2026,
            "month": 1,
            "classroomId": "class-1",
            "semNo": "7",
        },
    )
    assert response.status_code == 200
    assert len(fake.calls) == 5


@pytest.mark.parametrize(
    "body",
    [
        {"month": 0, "year": 2026},
        {"month": 13, "year": 2026},
        {"month": 2, "year": 2026, "date": "2026-03-01"},
        {"month": 2, "year": 2026, "date": "2026-02-30"},
    ],
)
def test_bad_months_and_dates_do_not_call_upstream(setup, body):
    client, fake, _, _ = setup
    path = "/api/today-sync" if "date" in body else "/api/month-complete-data"
    assert client.post(path, json=body).status_code == 422
    assert not fake.calls


def test_validation_never_echoes_credentials(setup):
    client, fake, _, _ = setup
    response = client.post(
        "/api/attendance",
        json={"loginId": "PRIVATE_EMAIL", "password": {"secret": "PRIVATE_PASSWORD"}},
    )
    assert response.status_code == 422
    assert "PRIVATE" not in response.text
    assert "input" not in response.text
    assert not fake.calls


@pytest.mark.parametrize(
    "failure,expected",
    [
        ("timeout", 504),
        ("bad-json", 502),
        ("bad-shape", 502),
        ("304", 502),
        ("500", 502),
        ("429", 503),
    ],
)
def test_upstream_errors_never_overwrite_successful_snapshot(setup, failure, expected):
    client, fake, store, _ = setup
    _, headers = sign_in(client)
    saved = copy.deepcopy(store.snapshots)

    def respond(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("PRIVATE", request=request)
        if failure == "bad-json":
            return httpx.Response(200, text="PRIVATE bad response")
        if failure == "bad-shape":
            return httpx.Response(200, json={"subjects": "PRIVATE"})
        return httpx.Response(int(failure), text="PRIVATE")

    fake.responses[SUBJECTS] = respond
    response = client.post("/api/refresh", headers=headers)
    assert response.status_code == expected
    assert "PRIVATE" not in response.text
    assert store.snapshots == saved
    assert not store.leases


def test_missing_student_context_has_no_default_classroom(setup):
    client, fake, _, _ = setup
    del fake.primary["student"]["classroomId"]
    result = client.post(
        "/api/attendance", json={"loginId": "fixture", "password": "  valid password  "}
    )
    assert result.status_code == 502
    assert len(fake.calls) == 2


def test_upstream_session_rejection_revokes_application_session(setup):
    client, fake, _, _ = setup
    _, headers = sign_in(client)
    fake.responses[PRIMARY] = lambda _: httpx.Response(401, json={"private": "PRIVATE"})
    assert client.post("/api/refresh", headers=headers).status_code == 401
    assert client.get("/api/me/dashboard", headers=headers).status_code == 401


def test_identity_change_is_rejected(setup):
    client, fake, _, _ = setup
    _, headers = sign_in(client)
    fake.primary["student"]["id"] = "someone-else"
    assert client.post("/api/refresh", headers=headers).status_code == 401


def test_two_students_get_only_their_own_snapshots(setup):
    client, fake, _, _ = setup
    _, first = sign_in(client)
    fake.primary["student"].update(id="two", fullName="Other Student")
    _, second = sign_in(client)
    assert (
        client.get("/api/me/dashboard", headers=first).json()["data"]["primary"][
            "student"
        ]["fullName"]
        == "Fixture Student"
    )
    assert (
        client.get("/api/me/dashboard", headers=second).json()["data"]["primary"][
            "student"
        ]["fullName"]
        == "Other Student"
    )


def test_exact_cors_and_no_store(setup):
    client, _, _, _ = setup
    allowed = client.options(
        "/api/attendance",
        headers={
            "Origin": "https://attendance.varmalabs.tech",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert allowed.status_code == 200
    assert (
        allowed.headers["access-control-allow-origin"]
        == "https://attendance.varmalabs.tech"
    )
    denied = client.options(
        "/api/attendance",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers
    assert client.post("/api/refresh").headers["cache-control"] == "no-store"


def test_duplicate_refresh_lease_is_rejected_and_released(setup):
    client, _, store, _ = setup
    _, headers = sign_in(client)
    uid = next(iter(store.students))
    store.leases[uid] = ("other-worker", __import__("time").monotonic() + 100)
    assert client.post("/api/refresh", headers=headers).status_code == 409
    assert store.leases[uid][0] == "other-worker"


def test_repeated_logins_are_rate_limited(setup):
    client, _, _, _ = setup
    for _ in range(6):
        sign_in(client)
    response = client.post(
        "/api/attendance", json={"loginId": "fixture", "password": "  valid password  "}
    )
    assert response.status_code == 429


def test_production_refuses_memory_only_storage(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(ValueError, match="shared Supabase"):
        Settings.from_env()


async def test_supabase_encrypts_upstream_authentication_and_surfaces_failures():
    key = Fernet.generate_key().decode()
    saved = {}

    def handler(request):
        if request.method == "POST":
            saved.update(json.loads(request.content))
            return httpx.Response(201)
        return httpx.Response(200, json=[saved.copy()])

    store = SupabaseStore(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_key="test-key",
            encryption_key=key,
        ),
        transport=httpx.MockTransport(handler),
    )
    session = {
        "token_hash": "a" * 64,
        "student_id": "fixture",
        "context": {},
        "connection": {"cookies": [{"value": "PRIVATE_COOKIE"}]},
        "expires_at": datetime.now(UTC).isoformat(),
    }
    await store.put_session(session)
    assert "PRIVATE_COOKIE" not in json.dumps(saved)
    restored = await store.get_session("a" * 64)
    assert restored["connection"] == session["connection"]
    await store.close()


async def test_requests_are_concurrent_but_global_limit_is_respected():
    fake, active, peak = FakeCampx(), 0, 0

    async def handler(request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.015)
        try:
            return fake.handler(request)
        finally:
            active -= 1

    app = create_app(
        Settings(max_requests=2),
        store=MemoryStore(),
        transport=httpx.MockTransport(handler),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client,
    ):
        result = await client.post(
            "/api/attendance",
            json={"loginId": "fixture", "password": "  valid password  "},
        )
        assert result.status_code == 200
        assert peak == 2


def test_today_sync_is_personal_and_date_scoped(setup):
    client, fake, _, _ = setup
    _, headers = sign_in(client)
    response = client.post(
        "/api/today-sync",
        headers=headers,
        json={"year": 2026, "month": 2, "date": "2026-02-02"},
    )
    assert response.status_code == 200
    assert response.json()["todayBundle"]["attendance"][0]["isAbsent"] == 0
    classes = [r for r in fake.calls if r.url.path == CLASSES][-1]
    assert (
        classes.url.params["fromDate"] == classes.url.params["toDate"] == "2026-02-02"
    )


async def test_supabase_database_errors_do_not_leak_keys_or_server_messages():
    store = SupabaseStore(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_key="PRIVATE_KEY",
            encryption_key=Fernet.generate_key().decode(),
        ),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(503, text="PRIVATE DATABASE ERROR")
        ),
    )
    with pytest.raises(ServiceError) as exc:
        await store.get_snapshot("fixture", "dashboard")
    assert exc.value.status == 503
    assert "PRIVATE" not in exc.value.message
    await store.close()


async def test_supabase_refresh_lease_result_is_checked():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=False)

    store = SupabaseStore(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_key="test-key",
            encryption_key=Fernet.generate_key().decode(),
        ),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(ServiceError) as exc:
        await store.claim("fixture")
    assert exc.value.status == 409
    assert calls[0].headers["prefer"] == "return=representation"
    await store.close()


async def test_firebase_usage_payload_is_pseudonymous_and_atomic():
    from backend.usage import Usage

    usage = Usage(Settings())
    usage.enabled = True
    usage.credentials = type("Credentials", (), {"valid": True, "token": "test-only"})()
    writes = []
    usage.client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: writes.append(r) or httpx.Response(200, json={})
        )
    )
    await usage.write(("student-uuid", "refresh", 5, True, "2026-10-24"))
    body = json.loads(writes[0].content)
    assert writes[0].url.path.endswith("/documents:commit")
    write = body["writes"][0]
    assert write["update"]["name"].endswith("usage_users/student-uuid/days/2026-10-24")
    assert {"fieldPath": "campxRequests", "increment": {"integerValue": "5"}} in write[
        "updateTransforms"
    ]
    assert "email" not in writes[0].content.decode().lower()
    assert "password" not in writes[0].content.decode().lower()
    await usage.close()


def test_failed_database_write_does_not_return_a_successful_dashboard(setup):
    client, _, store, _ = setup

    async def fail(*args):
        raise ServiceError(
            503, "storage_unavailable", "Private student storage is unavailable."
        )

    store.save_snapshot = fail
    response = client.post(
        "/api/attendance", json={"loginId": "fixture", "password": "  valid password  "}
    )
    assert response.status_code == 503


async def test_overloaded_server_returns_fast_backpressure_without_upstream_calls():
    fake = FakeCampx()
    app = create_app(
        Settings(max_operations=1),
        store=MemoryStore(),
        transport=httpx.MockTransport(fake.handler),
    )
    async with app.router.lifespan_context(app):
        service = app.state.service
        await service.operations.acquire()
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    "/api/attendance",
                    json={"loginId": "fixture", "password": "  valid password  "},
                )
                assert response.status_code == 503
                assert not fake.calls
        finally:
            service.operations.release()


def test_readiness_reports_development_storage_explicitly(setup):
    client, _, _, _ = setup
    assert client.get("/").json()["status"] == "ok"
    result = client.get("/health/ready")
    assert result.status_code == 200
    assert result.json() == {
        "status": "ok",
        "storage": "development-memory",
        "usage": "disabled",
    }


async def test_failed_database_readiness_is_not_reported_as_ready():
    store = SupabaseStore(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_key="key",
            encryption_key=Fernet.generate_key().decode(),
        ),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(404, json={"message": "missing table"})
        ),
    )
    with pytest.raises(ServiceError):
        await store.ready()
    await store.close()


async def test_firebase_login_registers_user_without_profile_fields():
    from backend.usage import Usage

    usage = Usage(Settings())
    usage.enabled = True
    usage.credentials = type("Credentials", (), {"valid": True, "token": "test-only"})()
    requests = []
    usage.client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: requests.append(r) or httpx.Response(200, json={})
        )
    )
    await usage.write(("student-uuid", "login", 6, True, "2026-10-25"))
    body = json.loads(requests[0].content)
    assert len(body["writes"]) == 2
    assert body["writes"][1]["update"]["name"].endswith("/usage_users/student-uuid")
    assert set(body["writes"][1]["update"]["fields"]) == {"studentId"}
    await usage.close()


async def test_logout_during_refresh_cannot_resurrect_revoked_session():
    fake, store = FakeCampx(), MemoryStore()
    entered, release = asyncio.Event(), asyncio.Event()
    refreshing = False

    async def handler(request):
        if refreshing and request.url.path == SUBJECTS:
            entered.set()
            await release.wait()
        return fake.handler(request)

    app = create_app(Settings(), store=store, transport=httpx.MockTransport(handler))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client,
    ):
        login = await client.post(
            "/api/attendance",
            json={"loginId": "fixture", "password": "  valid password  "},
        )
        assert login.status_code == 200
        headers = {"Authorization": "Bearer " + login.json()["sessionToken"]}
        refreshing = True
        refresh = asyncio.create_task(client.post("/api/refresh", headers=headers))
        await asyncio.wait_for(entered.wait(), timeout=2)
        assert (await client.post("/api/logout", headers=headers)).status_code == 204
        release.set()
        assert (await refresh).status_code == 401
        assert not store.sessions
        assert (
            await client.get("/api/me/dashboard", headers=headers)
        ).status_code == 401


async def test_supabase_session_rotation_updates_only_an_existing_row():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=[])

    store = SupabaseStore(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_key="test-key",
            encryption_key=Fernet.generate_key().decode(),
        ),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(ServiceError) as exc:
        await store.update_session(
            {
                "token_hash": "a" * 64,
                "student_id": "student-uuid",
                "context": {},
                "connection": {"bearer": "PRIVATE"},
            }
        )
    assert exc.value.status == 401
    assert calls[0].method == "PATCH"
    assert "PRIVATE" not in calls[0].content.decode()
    assert calls[0].url.params["expires_at"].startswith("gt.")
    await store.close()


def test_unsupported_login_session_is_not_treated_as_success(setup):
    client, fake, _, _ = setup
    fake.responses[LOGIN] = lambda _: httpx.Response(
        201, json={"unknownLoginFormat": {"email": "PRIVATE"}}
    )
    response = client.post(
        "/api/attendance", json={"loginId": "fixture", "password": "  valid password  "}
    )
    assert response.status_code == 502
    assert response.json()["code"] == "upstream_auth_schema"
    assert "PRIVATE" not in response.text
    assert len(fake.calls) == 1


def test_live_timetable_status_polarity_and_exact_links_are_normalized():
    from backend.normalize import daily_bundle

    ctx = {"campxStudentId": "student", "classroomId": "room", "semNo": "7"}

    def slot(identifier, record_id, status, start):
        return {
            "id": identifier,
            "subjectId": "math",
            "sessionDate": "2026-10-01",
            "fromTime": start,
            "toTime": "12:00",
            "studentAttendance": {
                "id": record_id,
                "studentId": "student",
                "classroomId": "room",
                "semNo": 7,
                "subjectId": "math",
                "classroomTimetableId": identifier,
                "date": "2026-10-01",
                "hasAttendance": True,
                "status": status,
            },
        }

    # Live cross-check established that True means ABSENT, not present.
    slots = [
        slot("slot-1", "record-1", False, "09:00"),
        slot("slot-2", "record-2", True, "11:00"),
    ]
    records = [
        {"id": "record-1", "date": "2026-10-01", "subjectId": "math", "isAbsent": 0},
        {"id": "record-2", "date": "2026-10-01", "subjectId": "math", "isAbsent": 1},
    ]
    bundle = daily_bundle(records, slots, 2026, 10, student_context=ctx)["2026-10-01"]
    assert len(bundle["attendance"]) == 2
    assert [
        (r["classroomTimetableId"], r["isAbsent"]) for r in bundle["attendance"]
    ] == [("slot-1", 0), ("slot-2", 1)]
    assert "studentAttendance" not in json.dumps(bundle)
    assert "studentId" not in json.dumps(bundle)


@pytest.mark.parametrize(
    "field,value",
    [
        ("studentId", "someone-else"),
        ("classroomId", "other-room"),
        ("semNo", "9"),
        ("classroomTimetableId", "other-slot"),
        ("subjectId", "other-subject"),
    ],
)
def test_foreign_or_mismatched_embedded_attendance_is_rejected(field, value):
    from backend.normalize import daily_bundle

    ctx = {"campxStudentId": "student", "classroomId": "room", "semNo": "7"}
    record = {
        "id": "record",
        "studentId": "student",
        "classroomId": "room",
        "semNo": 7,
        "subjectId": "math",
        "classroomTimetableId": "slot",
        "date": "2026-10-01",
        "hasAttendance": True,
        "status": False,
    }
    record[field] = value
    slot = {
        "id": "slot",
        "subjectId": "math",
        "sessionDate": "2026-10-01",
        "studentAttendance": record,
    }
    with pytest.raises(ServiceError):
        daily_bundle([], [slot], 2026, 10, student_context=ctx)


def test_conflicting_live_endpoints_do_not_guess_attendance():
    from backend.normalize import daily_bundle

    ctx = {"campxStudentId": "student", "classroomId": "room", "semNo": "7"}
    embedded = {
        "id": "record",
        "studentId": "student",
        "classroomId": "room",
        "semNo": 7,
        "subjectId": "math",
        "classroomTimetableId": "slot",
        "date": "2026-10-01",
        "hasAttendance": True,
        "status": True,
    }
    timetable = [
        {
            "id": "slot",
            "subjectId": "math",
            "sessionDate": "2026-10-01",
            "studentAttendance": embedded,
        }
    ]
    records = [
        {"id": "record", "date": "2026-10-01", "subjectId": "math", "isAbsent": 0}
    ]
    with pytest.raises(ServiceError):
        daily_bundle(records, timetable, 2026, 10, student_context=ctx)


def test_mfa_requirement_is_not_bypassed(setup):
    client, fake, _, _ = setup
    fake.responses[LOGIN] = lambda _: httpx.Response(
        201,
        json={"isMfaRequired": True},
        headers={"Set-Cookie": "pending=verification; Secure; Path=/"},
    )
    response = client.post(
        "/api/attendance", json={"loginId": "fixture", "password": "  valid password  "}
    )
    assert response.status_code == 401
    assert response.json()["code"] == "campx_mfa_required"
    assert len(fake.calls) == 1


def test_development_runtime_preserves_injected_values(monkeypatch, tmp_path):
    from scripts.runtime_env import load_development_env

    path = tmp_path / "runtime.env"
    path.write_text("CAMPX_LOGIN_ID=fixture\nCAMPX_PASSWORD='fixture value'\n")
    path.chmod(0o600)
    monkeypatch.setenv("BACKEND_ENV_FILE", str(path))
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("CAMPX_LOGIN_ID", "existing-binding")
    monkeypatch.delenv("CAMPX_PASSWORD", raising=False)
    load_development_env()
    assert __import__("os").environ["CAMPX_LOGIN_ID"] == "existing-binding"
    assert __import__("os").environ["CAMPX_PASSWORD"] == "fixture value"


def test_production_never_loads_shared_development_credentials(monkeypatch, tmp_path):
    from scripts.runtime_env import load_development_env

    path = tmp_path / "runtime.env"
    path.write_text("CAMPX_PASSWORD=fixture\n")
    path.chmod(0o600)
    monkeypatch.setenv("BACKEND_ENV_FILE", str(path))
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("CAMPX_PASSWORD", raising=False)
    load_development_env()
    assert "CAMPX_PASSWORD" not in __import__("os").environ


def test_insecure_development_runtime_is_rejected(monkeypatch, tmp_path):
    from scripts.runtime_env import load_development_env

    path = tmp_path / "runtime.env"
    path.write_text("CAMPX_PASSWORD=fixture\n")
    path.chmod(0o644)
    monkeypatch.setenv("BACKEND_ENV_FILE", str(path))
    monkeypatch.setenv("APP_ENV", "development")
    with pytest.raises(ValueError, match="private permissions"):
        load_development_env()


def test_class_details_keep_useful_names_and_codes_without_faculty_contact_details():
    from backend.normalize import slot_data

    raw = {
        "subjectCode": "MAT101",
        "subject": {
            "id": 1,
            "name": "Mathematics",
            "subjectCode": "MAT101",
            "syllabusUrl": "PRIVATE",
        },
        "faculties": [
            {"fullName": "Fixture Lecturer", "email": "PRIVATE", "mobile": "PRIVATE"}
        ],
    }
    normalized = slot_data(raw)
    assert normalized["subjectCode"] == "MAT101"
    assert normalized["subject"]["subjectCode"] == "MAT101"
    assert normalized["facultyName"] == "Fixture Lecturer"
    assert "PRIVATE" not in json.dumps(normalized)
