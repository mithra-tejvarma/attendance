# Backend implementation and activation

## What is implemented and what is verified

The previous synchronous proxy has been replaced with an async FastAPI service. Existing `/api/attendance`, `/api/month-complete-data`, `/api/today-sync` contracts are retained with filtered fields. Initial login requires CampX credentials; it returns a random app session. Subsequent frontend refresh/month requests use that bearer token. No Firebase or Supabase Auth login is introduced.

Automated checks use synthetic payloads, and the supplied account has now also been used for read-only live validation. CampX authentication and all five data endpoints passed schema normalization. The application login, saved-dashboard read, session refresh, today's synchronization, logout and revoked-access check passed with explicitly isolated development memory storage. No raw personal payload was committed or persisted as a fixture.

Live inspection verified that `classroom-timetables.studentAttendance` carries the personal attendance record tied to the exact timetable row. Its `id` matches the corresponding `my-classes.id`; `classroomTimetableId` matches the timetable row's `id`. Critically, the embedded boolean `status` has **absence polarity**: `true` corresponds to `isAbsent=1` (absent), `false` corresponds to `isAbsent=0` (present). The adapter verifies student, classroom, semester, subject, date and timetable linkage, enriches/deduplicates attendance by record ID, and refuses inconsistent cross-endpoint flags. This avoids confusing repeated same-subject classes. Embedded student/faculty records are never forwarded wholesale. `hasAttendance=false` becomes “Not required”; suspended classes do not become “Live now.”

The reviewed migration is now installed in Supabase project `sknfnvupcgoarfzrfwvl`. Live readiness, login, encrypted session write/decrypt, private snapshot read, session refresh, selected-month/day writes, logout and revoked-access checks passed against the actual database. Test sessions were revoked at the end; the student's filtered snapshots remain as the requested application cache. A real mobile Chromium session also verified login-only entry, live class details, profile display and server logout. This validates the configured instance; Render deployment, new-machine restoration, high-load capacity and Firebase analytics are not established by these checks.

Login currently succeeds through CampX cookies. The response also includes a nested `session.token`; the adapter does not guess that this is a bearer token when working cookies are available. MFA-required responses are rejected with an explicit message, never bypassed. The browser client identifier remains configurable through `CAMPX_CLIENT_TOKEN`.

The provided development credentials and service key are stored in a private mode-0600 runtime file outside the checkout at `/workspace/.attendance-secrets/attendance.env`. A persistent Fernet key was generated there without printing it. This is a local shared-workspace configuration, not a write to the platform secret vault or Render settings. Do not copy its contents into GitHub, a frontend build, or setup scripts. After reviewing this file's use, authorized workspace tasks can source it without displaying values. Individual students must still supply their own CampX login; this account is never a default for other users.

For the latest compact cache, notification endpoints, required migration and scale assessment, read [rollout and activation](rollout.md).

## Local development

Use Python 3.12, Node 24, and the existing checkout.

```sh
python3 -m venv /workspace/.attendance-venv
/workspace/.attendance-venv/bin/python -m pip install -r requirements-dev.txt
/workspace/.attendance-venv/bin/python -m pytest -q
/workspace/.attendance-venv/bin/python -m ruff check backend backend_tests scripts server.py
./scripts/dev_backend.sh
```

Then start the frontend with `VITE_API_BASE_URL=http://127.0.0.1:8001 npm run dev`. For port 8000 simply substitute it in both commands. Existing public frontend builds continue to point to the Render API unless rebuilt with an override.

`APP_ENV=development` (default) allows a bounded, process-local in-memory store. This verifies the workflow without credentials but loses sessions/snapshots on restart and cannot coordinate two servers. Production refuses to start without shared Supabase storage. Memory mode is not a production-ready deployment.

`GET /` is liveness and compatible with the existing cron ping. `GET /health/ready` verifies configured table access (or explicitly reports `development-memory`). Readiness is rate-limited and does not perform a CampX login or claim Firebase connectivity.

## Required live CampX check

For this workspace the private runtime file is already present. The development launcher and inspection scripts load it automatically without printing values, preserve existing injected variables, and skip it entirely when `APP_ENV=production`. Group/world-readable files and unsupported assignments are rejected. On other machines supply personal `CAMPX_LOGIN_ID` and `CAMPX_PASSWORD` through secure runtime settings; never commit them or deploy this development account as a default.

Run:

```sh
/workspace/.attendance-venv/bin/python -m scripts.inspect_campx
```

The inspector performs one login and five read-only data requests, reports response field shapes/types and array counts, and runs normalizers. It never prints values, cookies, tokens, or student profile contents. It does not persist raw account responses. `python -m scripts.audit_campx` separately cross-checks record relationships and flag polarity, reporting aggregate checks rather than personal values. Without variables it exits 2 with a precise blocked status. Unsupported live shapes must be mapped and retested before production rollout. Verify recorded IDs, session expiry, electives/lab groups, corrected attendance, empty timetables and class matching with actual authorized accounts; one account cannot establish whole-section invariants.

## Supabase activation

Use **one shared production project** for both backend instances.

1. Use `SUPABASE_URL=https://sknfnvupcgoarfzrfwvl.supabase.co`. Apply `supabase/migrations/202610240001_private_attendance.sql` after review, preferably in a dedicated project. No migration is automatically applied.
2. Securely configure `SUPABASE_SERVICE_ROLE_KEY` using the project's server-only legacy service-role key. This adapter does not assume newer `sb_secret_` keys can be used as bearer JWTs. Never expose this key to Vite, the browser, or GitHub.
3. Generate a persistent Fernet key in your own secure configuration workflow: `Fernet.generate_key()` from `cryptography.fernet`. Enter it as `CAMPX_ENCRYPTION_KEY` in server secret settings. It must be identical on both servers. Never regenerate on each boot. Rotating it requires revoking existing sessions or re-encrypting their connections.
4. Set `APP_ENV=production`, `ALLOWED_ORIGINS=https://attendance.varmalabs.tech`. Additional origins must be explicit. These are runtime/server variables, not `VITE_` variables.
5. Check `/health/ready` and run an authenticated login, snapshot read, refresh and logout against the deployed service. `render.yaml` is a reviewable deployment blueprint; it has not been applied.

Cloud proxy-backed credentials are not interchangeable with raw encryption keys or a service-account private key. Fernet and local OAuth signing need the real value in the server's process. Use the platform's supported direct secret injection or Render server secret settings. Do not declare a placeholder-only proxy secret for local cryptography.

Stored data:

- `students`: deterministic app UUID from verified CampX institution + student ID (or official roll number), and an allowlisted profile.
- `app_sessions`: SHA-256 hash of a random 256-bit app token, verified student context, expiry, and **encrypted CampX cookies/token**. No CampX password is persisted.
- `attendance_snapshots`: versioned filtered dashboard, selected month, or selected day. No app token or upstream login response is included. Invalid upstream data never replaces the last successful snapshot.
- `student_refresh_leases`: an atomic 120-second per-student lease, shared across servers. Duplicate refreshes return 409 rather than doubling upstream traffic. Callers retain their current data and can retry; responses are not automatically fanned out to concurrent tabs.

Tables have RLS enabled and no browser grants/policies. Only backend `service_role` access is permitted. Every private read derives the student UUID from the app session; no arbitrary browser-supplied student UUID is accepted. Browser classroom/semester hints are compared against verified context, never trusted. `service_role` bypasses RLS, so backend authorization tests remain essential.

Snapshots preserve the verified per-timetable attendance links while avoiding invented identifiers. Subject codes and faculty display names are retained for student class details; faculty email/mobile and unrelated student profile fields are omitted. Timetables remain student-scoped until teaching-group equivalence is verified. No cross-student attendance or credential sharing occurs.

A successful session refresh persists rotated upstream cookies/tokens. Upstream expiry/rejection requires reconnection; passwords are not retained for automatic reauthentication. App sessions default to two hours and do not slide indefinitely. Upstream logout/revocation support has not been established; app logout revokes only the app token.

The second migration adds bounded retention cleanup: expired app sessions/leases, day snapshots older than 7 days, month snapshots older than 60 days, completed delivery records older than 7 days and all delivery records older than 30 days. Apply it and configure the authenticated daily maintenance job described in [rollout and activation](rollout.md). The migration and scheduler have not been activated remotely yet. Student profiles/latest dashboards and Firestore metrics need an explicit deletion/retention policy; an account deletion UI and guaranteed backups/uptime are not provided.

## Firebase usage, project attendance-90c12

Optional backend-only analytics are implemented but disabled by default. Set `FIREBASE_USAGE_ENABLED=true` only after provisioning Firestore, a least-privilege service identity with document-write access, and server credentials (`FIREBASE_SERVICE_ACCOUNT_JSON`, or supported Google Application Default Credentials). The project ID alone is insufficient. No Firebase Auth is used.

The backend writes daily aggregates to `usage_users/{pseudonymousStudentUuid}/days/{YYYY-MM-DD}`. Each event performs one atomic daily-document update with operation counts, CampX call counts, successful/failed request counts and `lastActiveAt`. Successful login also updates a pseudonymous parent user document, making total verified-user counts available without scanning daily records. Login uses two document writes; other tracked operations use one. No email, password, profile, attendance data, or token is sent. Distinct student IDs with a document for a date give that day's active users; summing request counts does not give unique users. These count backend operations, not app openings or button clicks. Unknown/failed logins before identity verification do not count as active students.

A bounded async queue keeps analytics off the attendance response path. Events can be dropped on queue overflow, write failure or process shutdown. Metrics are best-effort, **not billing-grade exact counts**. There is no analytics dashboard or scheduled aggregation job yet.

`firestore.rules` is a **template** denying browser access to usage records. Merge it with any existing rules; do not overwrite unrelated project policies blindly. The trusted service identity bypasses these client rules. The uploaded server credential authenticates, but Firestore returns SERVICE_DISABLED and usage remains off. Browser rules and real usage writes have not been deployed/verified remotely. A global Supabase reservation budget limits this app to 16,000 Firestore writes per Pacific quota day; apply the second migration before enabling usage. Required HTTPS destinations are `firestore.googleapis.com` and `oauth2.googleapis.com`; the Supabase project host is also required when enabling that adapter. Preserve existing network policy when adding destinations.

## Endpoints and operational limits

- `POST /api/attendance`: CampX login + current dashboard; returns `sessionToken`, `sessionExpiresAt` plus the frontend-compatible dashboard. Credentials are sent once. Treat the response as private.
- `POST /api/refresh`: bearer-authenticated current dashboard; no password body.
- `POST /api/month-complete-data`: bearer + `{month, year}`; optional classroom/semester must match verified context. Legacy credential bodies remain supported.
- `POST /api/today-sync`: bearer + `{month, year, date}`; date must be valid and belong to that month. Legacy credential bodies remain supported.
- `GET /api/me/dashboard`: bearer-authenticated saved dashboard, explicitly labeled `source: saved`, with original fetch time; no CampX calls. The frontend doesn't restore sessions across browser reloads yet.
- `POST /api/logout`: revoke the bearer token.

The frontend keeps the bearer token only in memory and strips login/password from session requests. Settings retains the login identifier for display. Error responses and validation errors do not echo submitted credentials. API responses have `Cache-Control: no-store`. Tokens are never accepted in URLs. Cross-site cookies are unnecessary for this version; HTTP-only same-site cookies remain a future option. An XSS could still steal an in-memory token, so production CSP and dependency/security review remain necessary.

On cache misses, initial login uses six CampX requests; subsequent full refreshes use five, and session month fetches use three. Fresh private cache hits avoid those data fetches; login still verifies credentials and identity. Required independent requests run concurrently after context is established. Defaults: 16 upstream requests and 8 admitted operations per process, 12-second HTTP timeout (5-second connect), 50-second overall operation budget. Capacity is rejected quickly with 503 instead of building an unbounded queue. No automatic retry storm, keep-alive circumvention or upstream TLS bypass is used.

Per-account/per-client/per-student rate limits are process-local. Shared refresh leases coordinate two servers, but rate budgets do not. Before horizontal rollout, evaluate a shared rate limiter and configure trusted proxy addresses correctly; never trust arbitrary `X-Forwarded-For` headers. One Uvicorn worker is recommended on a small Render free instance. These bounds are safety defaults, not proven CampX limits or capacity guarantees. Do not promise a student count or latency before an authorized load pilot.

Opt-in scheduled checks and FCM delivery now use encrypted session-bound subscriptions, atomic Supabase claims and a durable outbox. Activation is still pending. See [rollout and activation](rollout.md) for the new migration, separate scheduler endpoints, current free-tier limits and live verification status. No CampX webhook has been established.
