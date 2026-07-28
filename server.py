from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from datetime import datetime

app = FastAPI()

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

class MonthRequest(BaseModel):
    loginId: str
    password: str
    month: int
    year: int
    semNo: str

class DateRequest(BaseModel):
    loginId: str
    password: str
    date: str  # "YYYY-MM-DD"
    classroomId: str
    semNo: str


def get_authenticated_session(login_id: str, password: str):
    session = requests.Session()
    login_url = "https://api.campx.in/auth-server/auth-v2/login"

    login_payload = {
        "loginId": login_id,
        "password": password,
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
        "origin": "https://aits.campx.in",
        "referer": "https://aits.campx.in/",
        "x-tenant-id": "aits",
        "x-institution-code": "aits",
        "x-platform-id": "campx",
        "x-campx-client": "eyJjbGllbnRJZCI6ImVmYTRkZGFiLTMwMzEtNDM3MC1hZDc3LTQ2NTU3ZDRmMDg5MCIsImlhdCI6MTc4NTA1OTIwN30.7AY9CN4J9XclC760edIgF7GyXNTfy2t0MDuEWC5oLyg",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    login_res = session.post(login_url, json=login_payload, headers=headers)
    if login_res.status_code != 201:
        return None, None

    return session, headers


@app.post("/api/attendance")
def get_student_attendance(creds: UserCredentials):
    session, headers = get_authenticated_session(creds.loginId, creds.password)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid CampX credentials")

    # 1. Fetch Primary Profile to dynamically extract student's classroomId and semNo
    primary_url = "https://api.campx.in/student-api/student-attendance/my-secondary-attendance"
    primary_res = session.get(primary_url, headers=headers)
    primary_data = primary_res.json() if primary_res.status_code == 200 else {}

    # Dynamic extraction of Classroom and Sem Number
    student_obj = primary_data.get("student", {})
    classroom_id = str(student_obj.get("classroomId", "57"))
    sem_no = str(student_obj.get("semNo", "7"))

    # 2. Fetch Subject-wise Attendance
    subjects_url = "https://api.campx.in/student-api/student-attendance/my-all-semester-attendance"
    subjects_res = session.get(subjects_url, params={"semNo": sem_no}, headers=headers)

    # 3. Fetch Current Month Calendar Data
    now = datetime.now()
    calendar_url = "https://api.campx.in/student-api/student-attendance/my-date-wise-attendance"
    calendar_res = session.get(calendar_url, params={"semNo": sem_no, "month": str(now.month), "year": str(now.year)}, headers=headers)

    return {
        "primary": primary_data,
        "subjectWise": subjects_res.json() if subjects_res.status_code == 200 else {},
        "monthlyCalendar": calendar_res.json() if calendar_res.status_code in [200, 304] else {},
        "dynamicContext": {
            "classroomId": classroom_id,
            "semNo": sem_no
        }
    }


@app.post("/api/month-calendar")
def get_month_calendar(req: MonthRequest):
    session, headers = get_authenticated_session(req.loginId, req.password)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")

    calendar_url = "https://api.campx.in/student-api/student-attendance/my-date-wise-attendance"
    res = session.get(calendar_url, params={"semNo": str(req.semNo), "month": str(req.month), "year": str(req.year)}, headers=headers)
    
    return res.json() if res.status_code in [200, 304] else {}


@app.post("/api/daily-classes")
def get_daily_classes(req: DateRequest):
    session, headers = get_authenticated_session(req.loginId, req.password)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")

    # Step A: Check if actual attendance records exist for this date
    classes_url = "https://api.campx.in/student-api/student-attendance/my-classes"
    params = {"fromDate": req.date, "toDate": req.date, "semNo": str(req.semNo), "classroomId": str(req.classroomId)}
    res = session.get(classes_url, params=params, headers=headers)
    
    recorded_classes = res.json() if res.status_code == 200 else []

    if isinstance(recorded_classes, list) and len(recorded_classes) > 0:
        return {"hasRecord": True, "data": recorded_classes}

    # Step B: If no recorded attendance (e.g. tomorrow/future/unmarked date), fetch classroom timetables
    timetable_url = "https://api.campx.in/student-api/classroom-timetables"
    tt_res = session.get(timetable_url, params={"fromDate": req.date, "toDate": req.date, "classroomId": str(req.classroomId)}, headers=headers)
    
    raw_tt = tt_res.json() if tt_res.status_code == 200 else []

    filtered_timetable = []

    if isinstance(raw_tt, list):
        for item in raw_tt:
            # Match current sem & requested date
            session_date = item.get("sessionDate", "")
            item_sem = str(item.get("semNo", ""))

            # Filter matching date and current sem
            if (session_date == req.date or not session_date) and (item_sem == str(req.semNo) or not item_sem):
                filtered_timetable.append(item)

        # Sort timetable chronologically by period order / start time
        filtered_timetable.sort(key=lambda x: (x.get("orderNumber", 0), x.get("fromTime", "")))

    return {"hasRecord": False, "data": filtered_timetable}
