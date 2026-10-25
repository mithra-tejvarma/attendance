import asyncio
import calendar
import hashlib
import logging
import secrets
import time
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from .campx import CALENDAR, CLASSES, PRIMARY, SUBJECTS, TIMETABLE, Campx
from .config import Settings
from .errors import ServiceError, schema_error
from .normalize import calendar_data, context, daily_bundle, primary_data, subject_data
from .store import MemoryStore, SupabaseStore
from .usage import Usage

CAMPUS = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger("attendance")


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    loginId: str | None = Field(default=None, min_length=1, max_length=254)
    password: SecretStr | None = Field(default=None, min_length=1, max_length=4096)


class UserCredentials(Credentials):
    loginId: str = Field(min_length=1, max_length=254)
    password: SecretStr = Field(min_length=1, max_length=4096)


class MonthBatchRequest(Credentials):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=2100)
    classroomId: str | None = Field(default=None, max_length=150)
    semNo: str | None = Field(default=None, max_length=150)


class TodaySyncRequest(MonthBatchRequest):
    date: date

    @model_validator(mode="after")
    def same_month(self):
        if self.date.month != self.month or self.date.year != self.year:
            raise ValueError("Requested date must belong to the requested month")
        return self


class RateLimits:
    def __init__(self):
        self.rows = {}

    def check(self, key, limit):
        now = time.monotonic()
        self.rows = {k: v for k, v in self.rows.items() if v[0] > now}
        if key not in self.rows and len(self.rows) >= 4096:
            raise ServiceError(
                503, "server_busy", "The server is busy. Please try shortly."
            )
        expires, count = self.rows.get(key, (now + 60, 0))
        if count >= limit:
            raise ServiceError(
                429, "app_rate_limit", "Too many requests. Please wait a minute."
            )
        self.rows[key] = (expires, count + 1)


async def parallel(*coroutines):
    tasks = [asyncio.create_task(coro) for coro in coroutines]
    try:
        return await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


class Service:
    def __init__(self, settings, store, usage, transport=None):
        self.settings, self.store, self.usage, self.transport = (
            settings,
            store,
            usage,
            transport,
        )
        self.http_slots = asyncio.Semaphore(settings.max_requests)
        self.operations = asyncio.Semaphore(settings.max_operations)
        self.rates = RateLimits()

    @asynccontextmanager
    async def admitted(self):
        try:
            await asyncio.wait_for(self.operations.acquire(), timeout=0.1)
        except TimeoutError:
            raise ServiceError(
                503, "server_busy", "The server is busy. Please try shortly."
            ) from None
        try:
            async with asyncio.timeout(50):
                yield
        except TimeoutError:
            raise ServiceError(
                504,
                "operation_timeout",
                "The attendance refresh timed out. Your previous data was retained.",
            ) from None
        finally:
            self.operations.release()

    def client(self, connection=None):
        return Campx(self.settings, self.http_slots, self.transport, connection)

    def login_limit(self, request, credentials):
        account = hashlib.sha256(
            (credentials.loginId or "").strip().casefold().encode()
        ).hexdigest()
        self.rates.check("login-account:" + account, 6)
        self.rates.check(
            "login-ip:" + (request.client.host if request.client else "unknown"), 60
        )

    async def session(self, request):
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            raise ServiceError(401, "app_session", "Please reconnect to CampX.")
        token = header[7:]
        if len(token) < 32 or len(token) > 200:
            raise ServiceError(401, "app_session", "Please reconnect to CampX.")
        hashed = hashlib.sha256(token.encode()).hexdigest()
        session = await self.store.get_session(hashed)
        if not session or datetime.fromisoformat(session["expires_at"]) <= datetime.now(
            UTC
        ):
            if session:
                await self.store.delete_session(hashed)
            raise ServiceError(
                401,
                "app_session",
                "Your app session expired. Please reconnect to CampX.",
            )
        return session

    @asynccontextmanager
    async def student_lease(self, uid):
        owner = await self.store.claim(uid)
        try:
            yield
        finally:
            try:
                await self.store.release(uid, owner)
            except ServiceError:
                logger.warning(
                    "Refresh lease release failed; it will expire automatically"
                )

    async def dashboard(self, client, primary, ctx, year, month):
        last = calendar.monthrange(year, month)[1]
        first_date, last_date = (
            f"{year}-{month:02d}-01",
            f"{year}-{month:02d}-{last:02d}",
        )
        subjects, monthly, records, timetable = await parallel(
            client.get(SUBJECTS, semNo=ctx["semNo"]),
            client.get(CALENDAR, semNo=ctx["semNo"], month=str(month), year=str(year)),
            client.get(
                CLASSES,
                semNo=ctx["semNo"],
                classroomId=ctx["classroomId"],
                fromDate=first_date,
                toDate=last_date,
            ),
            client.get(
                TIMETABLE,
                classroomId=ctx["classroomId"],
                fromDate=first_date,
                toDate=last_date,
            ),
        )
        primary, subjects = primary_data(primary), subject_data(subjects)
        if (
            "overallAttendance" not in subjects
            and "attendancePercentage" not in primary
        ):
            raise schema_error()
        return {
            "primary": primary,
            "subjectWise": subjects,
            "monthlyCalendar": calendar_data(monthly, year, month),
            "dailyBundle": daily_bundle(records, timetable, year, month),
            "dynamicContext": {
                "classroomId": ctx["classroomId"],
                "semNo": ctx["semNo"],
                "currentMonth": month,
                "currentYear": year,
            },
            "fetchedAt": datetime.now(UTC).isoformat(),
            "schemaVersion": 1,
        }

    async def login(self, request, credentials):
        self.login_limit(request, credentials)
        now = datetime.now(CAMPUS)
        async with self.admitted(), self.client() as client:
            uid, success = None, False
            try:
                await client.authenticate(
                    credentials.loginId, credentials.password.get_secret_value()
                )
                primary = await client.get(PRIMARY)
                ctx = context(primary)
                uid = ctx["studentId"]
                async with self.student_lease(uid):
                    data = await self.dashboard(
                        client, primary, ctx, now.year, now.month
                    )
                    token = secrets.token_urlsafe(32)
                    session = {
                        "token_hash": hashlib.sha256(token.encode()).hexdigest(),
                        "student_id": uid,
                        "context": ctx,
                        "connection": client.connection(),
                        "expires_at": (
                            datetime.now(UTC)
                            + timedelta(seconds=self.settings.session_seconds)
                        ).isoformat(),
                    }
                    await self.store.save_student(uid, data["primary"]["student"])
                    await self.store.put_session(session)
                    await self.store.save_snapshot(uid, "dashboard", data)
                success = True
                return {
                    **data,
                    "sessionToken": token,
                    "sessionExpiresAt": session["expires_at"],
                }
            finally:
                if uid:
                    self.usage.emit(uid, "login", client.calls, success)

    async def run(self, request, body=None, operation="refresh"):
        """Bearer session preferred; credential-body fallback keeps old clients compatible."""
        self.rates.check(
            "request-ip:" + (request.client.host if request.client else "unknown"), 120
        )
        async with self.admitted():
            session = None
            if request.headers.get("authorization"):
                session = await self.session(request)
            elif not body or not body.loginId or body.password is None:
                raise ServiceError(401, "app_session", "Please reconnect to CampX.")
            else:
                self.login_limit(request, body)
            async with self.client(
                session["connection"] if session else None
            ) as client:
                uid, success = None, False
                try:
                    if session:
                        ctx = session["context"]
                    else:
                        await client.authenticate(
                            body.loginId, body.password.get_secret_value()
                        )
                        primary = await client.get(PRIMARY)
                        ctx = context(primary)
                    uid = ctx["studentId"]
                    self.rates.check("student:" + uid, 30)
                    if body:
                        for name in ("classroomId", "semNo"):
                            supplied = getattr(body, name, None)
                            if supplied is not None and supplied != ctx[name]:
                                raise ServiceError(
                                    403,
                                    "student_context",
                                    "The requested classroom or semester does not match your CampX account.",
                                )
                    async with self.student_lease(uid):
                        if operation == "refresh":
                            primary = await client.get(PRIMARY)
                            verified = context(primary)
                            if verified["studentId"] != uid:
                                raise ServiceError(
                                    401,
                                    "student_identity",
                                    "CampX identity changed. Please reconnect.",
                                )
                            ctx = verified
                            now = datetime.now(CAMPUS)
                            data = await self.dashboard(
                                client, primary, ctx, now.year, now.month
                            )
                            kind = "dashboard"
                            await self.store.save_student(
                                uid, data["primary"]["student"]
                            )
                        else:
                            params = {
                                "semNo": ctx["semNo"],
                                "classroomId": ctx["classroomId"],
                            }
                            first = (
                                body.date.isoformat()
                                if operation == "today"
                                else f"{body.year}-{body.month:02d}-01"
                            )
                            last = (
                                first
                                if operation == "today"
                                else f"{body.year}-{body.month:02d}-{calendar.monthrange(body.year, body.month)[1]:02d}"
                            )
                            if operation == "today":
                                (
                                    primary,
                                    subjects,
                                    monthly,
                                    records,
                                    timetable,
                                ) = await parallel(
                                    client.get(PRIMARY),
                                    client.get(SUBJECTS, semNo=ctx["semNo"]),
                                    client.get(
                                        CALENDAR,
                                        semNo=ctx["semNo"],
                                        month=str(body.month),
                                        year=str(body.year),
                                    ),
                                    client.get(
                                        CLASSES, **params, fromDate=first, toDate=last
                                    ),
                                    client.get(
                                        TIMETABLE,
                                        classroomId=ctx["classroomId"],
                                        fromDate=first,
                                        toDate=last,
                                    ),
                                )
                                if context(primary) != ctx:
                                    raise ServiceError(
                                        401,
                                        "student_context",
                                        "CampX student context changed. Please refresh your dashboard.",
                                    )
                            else:
                                monthly, records, timetable = await parallel(
                                    client.get(
                                        CALENDAR,
                                        semNo=ctx["semNo"],
                                        month=str(body.month),
                                        year=str(body.year),
                                    ),
                                    client.get(
                                        CLASSES, **params, fromDate=first, toDate=last
                                    ),
                                    client.get(
                                        TIMETABLE,
                                        classroomId=ctx["classroomId"],
                                        fromDate=first,
                                        toDate=last,
                                    ),
                                )
                            bundle = daily_bundle(
                                records,
                                timetable,
                                body.year,
                                body.month,
                                first if operation == "today" else None,
                            )
                            data = {
                                "monthlyCalendar": calendar_data(
                                    monthly, body.year, body.month
                                ),
                                "fetchedAt": datetime.now(UTC).isoformat(),
                                "schemaVersion": 1,
                            }
                            if operation == "today":
                                data.update(
                                    primary=primary_data(primary),
                                    subjectWise=subject_data(subjects),
                                    todayBundle=bundle[first],
                                )
                            else:
                                data["dailyBundle"] = bundle
                            kind = (
                                "today:" + first
                                if operation == "today"
                                else f"month:{body.year}-{body.month:02d}"
                            )
                        if session:
                            session.update(context=ctx, connection=client.connection())
                            await self.store.update_session(session)
                        else:
                            await self.store.save_student(
                                uid, primary_data(primary)["student"]
                            )
                        await self.store.save_snapshot(uid, kind, data)
                    success = True
                    return data
                except ServiceError as error:
                    if error.status == 401 and session:
                        await self.store.delete_session(session["token_hash"])
                    raise
                finally:
                    if uid:
                        self.usage.emit(uid, operation, client.calls, success)


def create_app(settings=None, store=None, transport=None, usage=None):
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        active_store = store or (
            SupabaseStore(settings)
            if settings.supabase_url
            else MemoryStore(settings.max_sessions)
        )
        active_usage = usage or Usage(settings)
        app.state.service = Service(settings, active_store, active_usage, transport)
        await active_usage.start()
        if not settings.supabase_url and store is None:
            logger.warning(
                "Development memory storage active: sessions and snapshots do not survive restarts"
            )
        try:
            yield
        finally:
            await active_usage.close()
            await active_store.close()

    app = FastAPI(title="Varma Labs Attendance API", version="2.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.middleware("http")
    async def response_headers(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(ServiceError)
    async def service_error(request, error):
        headers = {"Retry-After": "60"} if error.status in (429, 503) else {}
        return JSONResponse(
            status_code=error.status,
            content={"detail": error.message, "code": error.code},
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # FastAPI's default errors can echo submitted passwords in `input`.
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Invalid request fields.",
                "code": "validation_error",
                "fields": [
                    {"field": ".".join(map(str, e["loc"])), "type": e["type"]}
                    for e in error.errors()
                ],
            },
        )

    @app.get("/")
    async def health():
        return {"status": "ok", "message": "Server is awake"}

    @app.get("/health/ready")
    async def ready(request: Request):
        service = request.app.state.service
        service.rates.check("readiness", 120)
        async with service.admitted():
            return {
                "status": "ok",
                "storage": await service.store.ready(),
                "usage": "enabled-best-effort"
                if settings.firebase_usage
                else "disabled",
            }

    @app.post("/api/attendance")
    async def attendance(request: Request, body: UserCredentials):
        return await request.app.state.service.login(request, body)

    @app.post("/api/refresh")
    async def refresh(request: Request):
        return await request.app.state.service.run(request)

    @app.post("/api/month-complete-data")
    async def month(request: Request, body: MonthBatchRequest):
        return await request.app.state.service.run(request, body, "month")

    @app.post("/api/today-sync")
    async def today(request: Request, body: TodaySyncRequest):
        return await request.app.state.service.run(request, body, "today")

    @app.get("/api/me/dashboard")
    async def saved_dashboard(request: Request):
        service = request.app.state.service
        async with service.admitted():
            session = await service.session(request)
            service.rates.check("cached:" + session["student_id"], 60)
            snapshot = await service.store.get_snapshot(
                session["student_id"], "dashboard"
            )
            if not snapshot:
                raise ServiceError(
                    404, "snapshot_missing", "No saved dashboard is available yet."
                )
            service.usage.emit(session["student_id"], "dashboard", 0, True)
            return {**snapshot, "source": "saved"}

    @app.post("/api/logout", status_code=204)
    async def logout(request: Request):
        service = request.app.state.service
        async with service.admitted():
            session = await service.session(request)
            await service.store.delete_session(session["token_hash"])
        return Response(status_code=204)

    return app
