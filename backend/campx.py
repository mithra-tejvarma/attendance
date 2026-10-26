import asyncio
import http.cookiejar

import httpx

from .config import Settings
from .errors import ServiceError, schema_error

BASE = "https://api.campx.in"
PRIMARY = "/student-api/student-attendance/my-secondary-attendance"
SUBJECTS = "/student-api/student-attendance/my-all-semester-attendance"
CALENDAR = "/student-api/student-attendance/my-date-wise-attendance"
CLASSES = "/student-api/student-attendance/my-classes"
TIMETABLE = "/student-api/classroom-timetables"
LOGIN = "/auth-server/auth-v2/login"


class Campx:
    def __init__(
        self,
        settings: Settings,
        semaphore: asyncio.Semaphore,
        transport=None,
        connection=None,
    ):
        headers = {
            "accept": "application/json, text/plain, */*",
            "origin": "https://aits.campx.in",
            "referer": "https://aits.campx.in/",
            "x-tenant-id": "aits",
            "x-institution-code": "aits",
            "x-platform-id": "campx",
            "x-campx-client": settings.client_token,
            "user-agent": "Mozilla/5.0",
        }
        self.client = httpx.AsyncClient(
            base_url=BASE,
            headers=headers,
            transport=transport,
            timeout=httpx.Timeout(12, connect=5, pool=3),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            follow_redirects=False,
        )
        self.semaphore, self.calls = semaphore, 0
        self.login_id = connection.get("loginId") if connection else None
        if connection:
            if connection.get("bearer"):
                self.client.headers["authorization"] = "Bearer " + connection["bearer"]
            for cookie in connection.get("cookies", []):
                domain = cookie["domain"]
                if domain.lstrip(".") not in {"api.campx.in", "campx.in"}:
                    raise ServiceError(
                        401, "session_invalid", "Please reconnect to CampX."
                    )
                self.client.cookies.jar.set_cookie(
                    http.cookiejar.Cookie(
                        version=0,
                        name=cookie["name"],
                        value=cookie["value"],
                        port=None,
                        port_specified=False,
                        domain=domain,
                        domain_specified=True,
                        domain_initial_dot=domain.startswith("."),
                        path=cookie["path"],
                        path_specified=True,
                        secure=cookie["secure"],
                        expires=cookie["expires"],
                        discard=cookie["expires"] is None,
                        comment=None,
                        comment_url=None,
                        rest={},
                        rfc2109=False,
                    )
                )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.client.aclose()

    async def request(self, method, path, *, params=None, payload=None, auth=False):
        try:
            async with asyncio.timeout(35):
                async with self.semaphore:
                    self.calls += 1
                    response = await self.client.request(
                        method, path, params=params, json=payload
                    )
        except (httpx.TimeoutException, TimeoutError):
            raise ServiceError(
                504,
                "upstream_timeout",
                "CampX took too long to respond. Please try again.",
            ) from None
        except httpx.RequestError:
            raise ServiceError(
                502,
                "upstream_unavailable",
                "CampX could not be reached. Please try again.",
            ) from None
        if response.status_code in (401, 403):
            raise ServiceError(
                401 if response.status_code == 401 or auth else 502,
                "campx_auth" if auth else "campx_session",
                "CampX rejected the login or session. Please reconnect.",
            )
        if response.status_code == 429:
            raise ServiceError(
                503,
                "upstream_rate_limit",
                "CampX is limiting requests. Please wait before refreshing.",
            )
        if response.status_code not in ((200, 201) if auth else (200,)):
            # 304 has no usable body without a validated cached entity.
            raise ServiceError(
                502,
                "upstream_status",
                "CampX returned an unsuccessful response. Please try again.",
            )
        if len(response.content) > 4 * 1024 * 1024:
            raise schema_error()
        try:
            data = response.json()
        except ValueError:
            raise schema_error() from None
        return data

    async def authenticate(self, login_id, password, on_response=None):
        # Passwords must not be trimmed: whitespace can be part of the password.
        data = await self.request(
            "POST",
            LOGIN,
            payload={
                "loginId": login_id.strip(),
                "password": password,
                "deviceType": "browser",
                "clientName": "unknown",
                "loginType": "USER",
                "longitude": None,
                "latitude": None,
                "os": "unknown",
                "osVersion": "unknown",
                "tokenType": "WEB",
            },
            auth=True,
        )
        if on_response is not None:
            on_response(data)
        if isinstance(data, dict) and data.get("isMfaRequired") is True:
            raise ServiceError(
                401,
                "campx_mfa_required",
                "CampX requires additional verification. Complete it through CampX before reconnecting.",
            )
        bearer = None
        if isinstance(data, dict):
            for container in (data, data.get("data")):
                if isinstance(container, dict):
                    candidate = container.get("accessToken") or container.get(
                        "access_token"
                    )
                    if (
                        isinstance(candidate, str)
                        and candidate
                        and "\n" not in candidate
                        and "\r" not in candidate
                    ):
                        bearer = candidate
                        break
        if bearer:
            self.client.headers["authorization"] = "Bearer " + bearer
        if not self.client.cookies and not bearer:
            raise ServiceError(
                502,
                "upstream_auth_schema",
                "CampX did not return a supported session. The login response needs inspection.",
            )
        self.login_id = login_id.strip()

    def connection(self):
        bearer = self.client.headers.get("authorization", "")
        return {
            "loginId": self.login_id,
            "bearer": bearer.removeprefix("Bearer ") if bearer else None,
            "cookies": [
                {
                    "name": c.name,
                    "value": c.value,
                    "domain": c.domain,
                    "path": c.path,
                    "secure": c.secure,
                    "expires": c.expires,
                }
                for c in self.client.cookies.jar
                if c.domain.lstrip(".") in {"api.campx.in", "campx.in"}
            ],
        }

    async def get(self, path, **params):
        return await self.request("GET", path, params=params)
