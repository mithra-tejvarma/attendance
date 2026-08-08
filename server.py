from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from datetime import datetime
import calendar

app = FastAPI()

@app.get("/")
def health_check():
    """Lightweight endpoint specifically for cron-job.org ping checks."""
    return {"status": "ok", "message": "Server is awake"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class UserCredentials(BaseModel):
    loginId: str
    password: str

class MonthBatchRequest(BaseModel):
    loginId: str
    password: str
    month: int
    year: int
    classroomId: str
    semNo: str


def authenticate_campx(login_id: str, password: str):
    session = requests.Session()
    login_url = "https://api.campx.in/auth-server/auth-v2/login"

    login_payload = {
        "loginId": login_id.strip(),
        "password": password.strip(),
        "deviceType": "browser",
        "clientName": "unknown",
        "loginType": "USER",
        "longitude": None,
        "latitude": None,
        "os": "unknown",
        "osVersion": "unknown",
        "tokenType": "WEB"
    }

    headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        "origin": "https://aits.campx.in",
        "referer": "https://aits.campx.in/",
        "x-tenant-id": "aits",
        "x-institution-code": "aits",
        "x-platform-id": "campx",
        "x-campx-client": "eyJjbGllbnRJZCI6ImVmYTRkZGFiLTMwMzEtNDM3MC1hZDc3LTQ2NTU3ZDRmMDg5MCIsImlhdCI6MTc4NTA1OTIwN30.7AY9CN4J9XclC760edIgF7GyXNTfy2t0MDuEWC5oLyg",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        login_res = session.post(login_url, json=login_payload, headers=headers)
        if login_res.status_code != 201:
            return None, None
        return session, headers
    except Exception as e:
        print("Auth Exception:", e)
        return None, None


def fetch_month_classes_batch(session, headers, classroom_id, sem_no, year, month):
    """Fetches timetables and recorded attendance per day so the frontend overlays status accurately."""
    _, num_days = calendar.monthrange(year, month)
    from_date = f"{year}-{month:02d}-01"
    to_date = f"{year}-{month:02d}-{num_days:02d}"

    # 1. Fetch Recorded Attendance Logs
    classes_url = "https://api.campx.in/student-api/student-attendance/my-classes"
    params = {"fromDate": from_date, "toDate": to_date, "semNo": sem_no, "classroomId": classroom_id}
    res = session.get(classes_url, params=params, headers=headers)
    all_recorded = res.json() if res.status_code == 200 and isinstance(res.json(), list) else []

    recorded_by_date = {}
    for item in all_recorded:
        d = item.get("date")
        if d:
            recorded_by_date.setdefault(d, []).append(item)

    # 2. Fetch Master Timetable Slots
    timetable_url = "https://api.campx.in/student-api/classroom-timetables"
    tt_params = {"fromDate": from_date, "toDate": to_date, "classroomId": classroom_id}
    tt_res = session.get(timetable_url, params=tt_params, headers=headers)
    all_tt = tt_res.json() if tt_res.status_code == 200 and isinstance(tt_res.json(), list) else []

    tt_by_date = {}
    for item in all_tt:
        d = item.get("sessionDate")
        if d:
            tt_by_date.setdefault(d, []).append(item)

    daily_bundle = {}
    for day in range(1, num_days + 1):
        date_str = f"{year}-{month:02d}-{day:02d}"
        
        tt_list = tt_by_date.get(date_str, [])
        rec_list = recorded_by_date.get(date_str, [])

        # Sort timetable chronologically
        tt_list.sort(key=lambda x: (x.get("orderNumber", 0), x.get("fromTime", "")))

        daily_bundle[date_str] = {
            "hasRecord": len(rec_list) > 0,
            "timetable": tt_list,
            "attendance": rec_list
        }

    return daily_bundle


@app.post("/api/attendance")
def get_student_attendance(creds: UserCredentials):
    session, headers = authenticate_campx(creds.loginId, creds.password)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid CampX credentials or login rejected by server")

    primary_url = "https://api.campx.in/student-api/student-attendance/my-secondary-attendance"
    primary_res = session.get(primary_url, headers=headers)
    primary_data = primary_res.json() if primary_res.status_code == 200 else {}

    student_obj = primary_data.get("student", {})
    classroom_id = str(student_obj.get("classroomId", "57"))
    sem_no = str(student_obj.get("semNo", "7"))

    subjects_url = "https://api.campx.in/student-api/student-attendance/my-all-semester-attendance"
    subjects_res = session.get(subjects_url, params={"semNo": sem_no}, headers=headers)

    now = datetime.now()
    calendar_url = "https://api.campx.in/student-api/student-attendance/my-date-wise-attendance"
    calendar_res = session.get(calendar_url, params={"semNo": sem_no, "month": str(now.month), "year": str(now.year)}, headers=headers)
    month_calendar = calendar_res.json() if calendar_res.status_code in [200, 304] else {}

    daily_bundle = fetch_month_classes_batch(session, headers, classroom_id, sem_no, now.year, now.month)

    return {
        "primary": primary_data,
        "subjectWise": subjects_res.json() if subjects_res.status_code == 200 else {},
        "monthlyCalendar": month_calendar,
        "dailyBundle": daily_bundle,
        "dynamicContext": {
            "classroomId": classroom_id,
            "semNo": sem_no,
            "currentMonth": now.month,
            "currentYear": now.year
        }
    }


@app.post("/api/month-complete-data")
def get_month_complete_data(req: MonthBatchRequest):
    session, headers = authenticate_campx(req.loginId, req.password)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")

    calendar_url = "https://api.campx.in/student-api/student-attendance/my-date-wise-attendance"
    calendar_res = session.get(calendar_url, params={"semNo": str(req.semNo), "month": str(req.month), "year": str(req.year)}, headers=headers)
    month_calendar = calendar_res.json() if calendar_res.status_code in [200, 304] else {}

    daily_bundle = fetch_month_classes_batch(session, headers, req.classroomId, req.semNo, req.year, req.month)

    return {
        "monthlyCalendar": month_calendar,
        "dailyBundle": daily_bundle
    }

class TodaySyncRequest(BaseModel):
    loginId: str
    password: str
    classroomId: str
    semNo: str
    date: str  # Format: YYYY-MM-DD
    month: int
    year: int

@app.post("/api/today-sync")
def sync_today_attendance(req: TodaySyncRequest):
    """Fast lightweight endpoint to auto-sync today's live attendance on page load."""
    session, headers = authenticate_campx(req.loginId, req.password)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired.")

    # 1. Fetch updated primary stats (percentages & counts)
    primary_url = "https://api.campx.in/student-api/student-attendance/my-secondary-attendance"
    primary_res = session.get(primary_url, headers=headers)
    primary_data = primary_res.json() if primary_res.status_code == 200 else {}

    # 2. Fetch updated subject breakdown
    subjects_url = "https://api.campx.in/student-api/student-attendance/my-all-semester-attendance"
    subjects_res = session.get(subjects_url, params={"semNo": req.semNo}, headers=headers)

    # 3. Fetch current month date-wise calendar map
    calendar_url = "https://api.campx.in/student-api/student-attendance/my-date-wise-attendance"
    calendar_res = session.get(calendar_url, params={"semNo": str(req.semNo), "month": str(req.month), "year": str(req.year)}, headers=headers)

    # 4. Fetch today's class schedule / recorded logs
    classes_url = "https://api.campx.in/student-api/student-attendance/my-classes"
    params = {"fromDate": req.date, "toDate": req.date, "semNo": str(req.semNo), "classroomId": str(req.classroomId)}
    rec_res = session.get(classes_url, params=params, headers=headers)
    recorded = rec_res.json() if rec_res.status_code == 200 and isinstance(rec_res.json(), list) else []

    # 5. Fetch today's timetable
    timetable_url = "https://api.campx.in/student-api/classroom-timetables"
    tt_params = {"fromDate": req.date, "toDate": req.date, "classroomId": str(req.classroomId)}
    tt_res = session.get(timetable_url, params=tt_params, headers=headers)
    timetable = tt_res.json() if tt_res.status_code == 200 and isinstance(tt_res.json(), list) else []
    timetable.sort(key=lambda x: (x.get("orderNumber", 0), x.get("fromTime", "")))

    return {
        "primary": primary_data,
        "subjectWise": subjects_res.json() if subjects_res.status_code == 200 else {},
        "monthlyCalendar": calendar_res.json() if calendar_res.status_code in [200, 304] else {},
        "todayBundle": {
            "hasRecord": len(recorded) > 0,
            "timetable": timetable,
            "attendance": recorded
        }
    }
