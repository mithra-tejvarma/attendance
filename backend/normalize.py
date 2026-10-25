"""Allowlist the current repository's API contract. Never persist raw upstream payloads."""

import calendar
import math
from datetime import date
from uuid import NAMESPACE_URL, uuid5

from .errors import schema_error


def identifier(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, (str, int))
        or not str(value).strip()
        or len(str(value)) > 150
    ):
        raise schema_error()
    return str(value)


def text(value, limit=240):
    return value[:limit] if isinstance(value, str) else None


def number(value, percentage=False, integer=False):
    if isinstance(value, bool):
        raise schema_error()
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise schema_error() from None
    if (
        not math.isfinite(result)
        or result < 0
        or (percentage and result > 100)
        or (integer and not result.is_integer())
    ):
        raise schema_error()
    return int(result) if integer else result


def object_response(value):
    if not isinstance(value, dict):
        raise schema_error()
    return value


def list_response(value):
    if not isinstance(value, list) or not all(isinstance(x, dict) for x in value):
        raise schema_error()
    return value


def context(primary):
    student = object_response(object_response(primary).get("student"))
    # No hardcoded student, semester, or classroom fallbacks.
    classroom = identifier(student.get("classroomId"))
    semester = identifier(student.get("semNo"))
    upstream_id = identifier(student.get("id") or student.get("rollNo"))
    uid = str(uuid5(NAMESPACE_URL, "campx:aits:" + upstream_id))
    return {
        "studentId": uid,
        "classroomId": classroom,
        "semNo": semester,
        "campxStudentId": upstream_id,
    }


def primary_data(raw):
    raw = object_response(raw)
    student = object_response(raw.get("student"))
    profile = {
        key: value
        for key in ("fullName", "email", "rollNo", "branchCode")
        if (value := text(student.get(key))) is not None
    }
    if student.get("semNo") is not None:
        profile["semNo"] = identifier(student["semNo"])
    result = {"student": profile}
    classroom = raw.get("classroom")
    if isinstance(classroom, dict) and isinstance(classroom.get("name"), str):
        result["classroom"] = {"name": text(classroom["name"])}
    if raw.get("attendancePercentage") is not None:
        result["attendancePercentage"] = number(
            raw["attendancePercentage"], percentage=True
        )
    stats = raw.get("primaryAttendance")
    if stats is not None:
        stats = object_response(stats)
        result["primaryAttendance"] = {
            key: number(stats[key], integer=True)
            for key in ("present", "absent", "totalSessionsIncludingActivity")
            if stats.get(key) is not None
        }
    return result


def subject_data(raw):
    raw = object_response(raw)
    subjects = list_response(raw.get("subjects"))
    result = {"subjects": []}
    for subject in subjects:
        name = text(subject.get("subjectName"))
        if not name:
            raise schema_error()
        row = {
            "subjectName": name,
            "present": number(subject.get("present"), integer=True),
            "numberOfClasses": number(subject.get("numberOfClasses"), integer=True),
            "percentage": number(subject.get("percentage"), percentage=True),
        }
        if row["present"] > row["numberOfClasses"]:
            raise schema_error()
        if subject.get("subjectId") is not None:
            row["subjectId"] = identifier(subject["subjectId"])
        result["subjects"].append(row)
    if raw.get("overallAttendance") is not None:
        result["overallAttendance"] = number(raw["overallAttendance"], percentage=True)
    return result


def iso_date(raw):
    if not isinstance(raw, str):
        raise schema_error()
    try:
        return date.fromisoformat(raw[:10]).isoformat()
    except ValueError:
        raise schema_error() from None


def calendar_data(raw, year, month):
    raw = object_response(raw)
    result = {}
    for key, value in raw.items():
        normalized = iso_date(key)
        if (
            not normalized.startswith(f"{year}-{month:02d}-")
            or not isinstance(value, str)
            or len(value) > 40
        ):
            raise schema_error()
        result[normalized] = value.lower()
    return result


def slot_data(raw):
    raw = object_response(raw)
    result = {}
    for key in ("id", "subjectId", "classroomTimetableId", "timetableId", "slotId"):
        if raw.get(key) is not None:
            result[key] = identifier(raw[key])
    for key in ("subjectName", "subjectCode", "fromTime", "toTime"):
        if raw.get(key) is not None:
            if not isinstance(raw[key], str):
                raise schema_error()
            result[key] = text(raw[key])
    if isinstance(raw.get("subject"), dict):
        subject = raw["subject"]
        result["subject"] = {
            key: text(subject[key])
            for key in ("name", "subjectName", "subjectCode")
            if isinstance(subject.get(key), str)
        }
        if isinstance(subject.get("subjectType"), dict) and isinstance(
            subject["subjectType"].get("hasAttendance"), bool
        ):
            result["attendanceRequired"] = subject["subjectType"]["hasAttendance"]
        if subject.get("id") is not None:
            result["subject"]["id"] = identifier(subject["id"])
    if isinstance(raw.get("faculties"), list):
        names = [
            text(f.get("fullName"), 120)
            for f in raw["faculties"][:3]
            if isinstance(f, dict) and isinstance(f.get("fullName"), str)
        ]
        if names:
            result["facultyName"] = ", ".join(names)
    for key in ("completed", "isSuspended"):
        if isinstance(raw.get(key), bool):
            result[key] = raw[key]
    if raw.get("orderNumber") is not None:
        result["orderNumber"] = number(raw["orderNumber"], integer=True)
    # Unknown flags remain unmarked. Missing records never become absent.
    if raw.get("isAbsent") in (0, 1) and isinstance(raw.get("isAbsent"), (int, bool)):
        result["isAbsent"] = int(raw["isAbsent"])
    return result


def daily_bundle(
    records, timetable, year, month, only_date=None, *, student_context=None
):
    records, timetable = list_response(records), list_response(timetable)
    output = {}
    days = (
        [only_date]
        if only_date
        else [
            f"{year}-{month:02d}-{n:02d}"
            for n in range(1, calendar.monthrange(year, month)[1] + 1)
        ]
    )
    for day in days:
        output[day] = {"hasRecord": False, "timetable": [], "attendance": []}
    for rows, date_field, destination in (
        (records, "date", "attendance"),
        (timetable, "sessionDate", "timetable"),
    ):
        for raw in rows:
            day = iso_date(raw.get(date_field))
            if day not in output:
                raise schema_error()
            output[day][destination].append(slot_data(raw))
    # Live CampX verification: timetable.studentAttendance.status uses the same
    # polarity as my-classes.isAbsent: True = absent, False = present.
    # It is tied to the exact timetable row; subject-only matching is insufficient.
    for raw in timetable:
        attendance = raw.get("studentAttendance")
        if attendance is None:
            continue
        if not isinstance(attendance, dict) or student_context is None:
            raise schema_error()
        expected = {
            "studentId": student_context.get("campxStudentId"),
            "classroomId": student_context.get("classroomId"),
            "semNo": student_context.get("semNo"),
            "classroomTimetableId": raw.get("id"),
            "subjectId": raw.get("subjectId") or (raw.get("subject") or {}).get("id"),
        }
        if any(
            value is None or identifier(attendance.get(key)) != identifier(value)
            for key, value in expected.items()
        ):
            raise schema_error()
        day = iso_date(raw.get("sessionDate"))
        if iso_date(attendance.get("date")) != day:
            raise schema_error()
        if not isinstance(attendance.get("hasAttendance"), bool):
            raise schema_error()
        slot = next(
            (
                row
                for row in output[day]["timetable"]
                if row.get("id") == identifier(raw.get("id"))
            ),
            None,
        )
        if slot is None:
            raise schema_error()
        slot["attendanceRequired"] = attendance["hasAttendance"]
        if not attendance["hasAttendance"]:
            continue
        if not isinstance(attendance.get("status"), bool):
            raise schema_error()
        record_id = identifier(attendance.get("id"))
        matches = [
            row for row in output[day]["attendance"] if row.get("id") == record_id
        ]
        if len(matches) > 1:
            raise schema_error()
        absent = int(attendance["status"])
        if matches:
            record = matches[0]
            if record.get("isAbsent") is not None and record["isAbsent"] != absent:
                raise schema_error()
            if record.get("subjectId") is not None and record[
                "subjectId"
            ] != identifier(expected["subjectId"]):
                raise schema_error()
        else:
            record = {"id": record_id}
            output[day]["attendance"].append(record)
        record.update(
            {
                "classroomTimetableId": slot["id"],
                "subjectId": identifier(expected["subjectId"]),
                "isAbsent": absent,
            }
        )
        for key in ("fromTime", "toTime"):
            if key in slot:
                record[key] = slot[key]
        if "subjectName" not in record:
            name = slot.get("subjectName") or (slot.get("subject") or {}).get("name")
            if name:
                record["subjectName"] = name
    for bundle in output.values():
        bundle["hasRecord"] = bool(bundle["attendance"])
        bundle["timetable"].sort(
            key=lambda row: (row.get("orderNumber", 0), row.get("fromTime", ""))
        )
    return output
