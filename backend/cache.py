from datetime import UTC, datetime


def fresh(snapshot, context, seconds):
    if not snapshot or seconds <= 0:
        return False
    try:
        age = (
            datetime.now(UTC) - datetime.fromisoformat(snapshot["fetchedAt"])
        ).total_seconds()
        source = snapshot["data"].get("dynamicContext", {})
        return 0 <= age < seconds and all(
            str(source.get(key)) == str(context[key])
            for key in ("classroomId", "semNo")
        )
    except (KeyError, ValueError, TypeError):
        return False


def compact_dashboard(data):
    from zoneinfo import ZoneInfo

    today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
    return {
        **data,
        "dailyBundle": {today: data["dailyBundle"][today]}
        if today in data.get("dailyBundle", {})
        else {},
        "monthDetailsComplete": False,
    }
