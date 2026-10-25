"""Read-only live contract inspection. Output schemas/counts, never credentials or PII.
Run: python -m scripts.inspect_campx
Requires CAMPX_LOGIN_ID and CAMPX_PASSWORD supplied securely in the process environment.
"""

import asyncio
import calendar
import json
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from backend.campx import CALENDAR, CLASSES, PRIMARY, SUBJECTS, TIMETABLE, Campx
from backend.config import Settings
from backend.errors import ServiceError
from backend.normalize import (
    calendar_data,
    context,
    daily_bundle,
    primary_data,
    subject_data,
)

from .runtime_env import load_development_env


def shape(value, depth=0):
    if depth > 6:
        return type(value).__name__
    if isinstance(value, dict):
        output = {}
        for key, child in list(value.items())[:80]:
            safe_key = (
                key
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,40}", str(key))
                else "<dynamic-key>"
            )
            output[safe_key] = shape(child, depth + 1)
        return output
    if isinstance(value, list):
        return {
            "type": "array",
            "count": len(value),
            "firstItemShape": shape(value[0], depth + 1) if value else None,
        }
    return type(value).__name__


async def main():
    load_development_env()
    login_id, password = os.getenv("CAMPX_LOGIN_ID"), os.getenv("CAMPX_PASSWORD")
    if not login_id or not password:
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "missing": [
                        name
                        for name in ("CAMPX_LOGIN_ID", "CAMPX_PASSWORD")
                        if not os.getenv(name)
                    ],
                    "action": "Supply values securely in environment settings; do not put them in shell commands.",
                }
            )
        )
        return 2
    settings = Settings.from_env()
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    first = f"{now.year}-{now.month:02d}-01"
    last = (
        f"{now.year}-{now.month:02d}-{calendar.monthrange(now.year, now.month)[1]:02d}"
    )
    report = {"status": "inspecting", "endpoints": {}}
    try:
        async with Campx(settings, asyncio.Semaphore(4)) as client:
            report["authentication"] = {}
            await client.authenticate(
                login_id,
                password,
                on_response=lambda value: report["authentication"].update(
                    responseShape=shape(value)
                ),
            )
            report["authentication"]["supportedSessionReturned"] = True
            primary = await client.get(PRIMARY)
            report["endpoints"][PRIMARY] = shape(primary)
            ctx = context(primary)
            raw = await asyncio.gather(
                client.get(SUBJECTS, semNo=ctx["semNo"]),
                client.get(
                    CALENDAR,
                    semNo=ctx["semNo"],
                    month=str(now.month),
                    year=str(now.year),
                ),
                client.get(
                    CLASSES,
                    semNo=ctx["semNo"],
                    classroomId=ctx["classroomId"],
                    fromDate=first,
                    toDate=last,
                ),
                client.get(
                    TIMETABLE,
                    classroomId=ctx["classroomId"],
                    fromDate=first,
                    toDate=last,
                ),
            )
            for path, response in zip((SUBJECTS, CALENDAR, CLASSES, TIMETABLE), raw):
                report["endpoints"][path] = shape(response)
            primary_data(primary)
            subject_data(raw[0])
            calendar_data(raw[1], now.year, now.month)
            daily_bundle(raw[2], raw[3], now.year, now.month, student_context=ctx)
            report.update(
                status="validated",
                requests=client.calls,
                note="Schema checks only; no raw payloads or credentials were saved.",
            )
    except ServiceError as error:
        report.update(status="failed", code=error.code, httpStatus=error.status)
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "validated" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
