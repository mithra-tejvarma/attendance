from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

app = FastAPI()

# Enable CORS so your HTML frontend can communicate with this backend
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

@app.post("/api/attendance")
def get_student_attendance(creds: UserCredentials):
    session = requests.Session()
    
    # 1. Login to CampX
    login_url = "https://api.campx.in/auth-server/auth-v2/login"
    
    # Added the exact payload fields that worked previously
    login_payload = {
        "loginId": creds.loginId,
        "password": creds.password,
        "deviceType": "browser",
        "clientName": "unknown",
        "loginType": "USER",
        "longitude": None,
        "latitude": None,
        "os": "unknown",
        "osVersion": "unknown",
        "tokenType": "WEB"
    }
    
    # Added all the required browser mimicry headers
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
        # We print the response text to the terminal to see exactly why it fails if it happens again
        print("Login Failed Response:", login_res.text)
        raise HTTPException(status_code=401, detail="Invalid CampX credentials or blocked by API")
        
    # 2. Fetch the attendance
    attendance_url = "https://api.campx.in/student-api/student-attendance/my-secondary-attendance"
    attendance_res = session.get(attendance_url, params={"classroomId": "57", "semNo": "7"}, headers=headers)
    
    if attendance_res.status_code == 200:
        return attendance_res.json()
    else:
        print("Attendance Fetch Failed:", attendance_res.text)
        raise HTTPException(status_code=500, detail="Failed to fetch attendance data")