"""Audit live field relationships without printing any personal values."""

import asyncio
import calendar
import json
import os
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from backend.campx import CLASSES, PRIMARY, TIMETABLE, Campx
from backend.config import Settings

from .runtime_env import load_development_env


async def main():
    load_development_env()
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    async with Campx(Settings.from_env(), asyncio.Semaphore(4)) as client:
        await client.authenticate(
            os.environ["CAMPX_LOGIN_ID"], os.environ["CAMPX_PASSWORD"]
        )
        primary = await client.get(PRIMARY)
        student = primary["student"]
        params = {
            "classroomId": str(student["classroomId"]),
            "fromDate": f"{now.year}-{now.month:02d}-01",
            "toDate": f"{now.year}-{now.month:02d}-{calendar.monthrange(now.year, now.month)[1]:02d}",
        }
        records, slots = await asyncio.gather(
            client.get(CLASSES, **params, semNo=str(student["semNo"])),
            client.get(TIMETABLE, **params),
        )
        by_id = {str(r.get("id")): r for r in records}
        by_subject = defaultdict(list)
        for r in records:
            by_subject[(r["date"][:10], str(r["subjectId"]))].append(r)
        counts = Counter()
        pairs = Counter()
        for slot in slots:
            embedded = slot.get("studentAttendance")
            if not isinstance(embedded, dict):
                counts["no_embedded_record"] += 1
                continue
            counts["embedded_records"] += 1
            if str(embedded.get("studentId")) != str(student["id"]):
                counts["wrong_student"] += 1
            if str(embedded.get("classroomTimetableId")) != str(slot.get("id")):
                counts["wrong_timetable_link"] += 1
            if embedded.get("hasAttendance") is False:
                counts["attendance_not_applicable"] += 1
            if slot.get("isSuspended"):
                counts["suspended"] += 1
            rec = by_id.get(str(embedded.get("id")))
            if rec is not None:
                counts["matching_attendance_primary_key"] += 1
            if rec is None:
                candidates = by_subject[
                    (slot["sessionDate"][:10], str(slot["subjectId"]))
                ]
                if len(candidates) == 1:
                    rec = candidates[0]
                    counts["unique_subject_date_fallback"] += 1
            if rec is not None:
                pairs[
                    f"status_{str(embedded.get('status')).lower()}__isAbsent_{rec.get('isAbsent')}"
                ] += 1
        print(
            json.dumps(
                {
                    "counts": dict(counts),
                    "status_cross_check": dict(pairs),
                    "requests": client.calls,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
