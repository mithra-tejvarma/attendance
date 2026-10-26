# Configure the deployed Render backend

On 26 October 2026, the frontend's configured API (`https://attendance-temn.onrender.com`) responded with `storage: development-memory` and `usage: disabled`. The new server code is deployed there, but persistent storage and Firebase settings still need configuration. The public custom domain still served the legacy HTML at that check. If your new service uses a different Render URL, substitute its exact HTTPS origin below and update the frontend setting before building.

## 1. Open the right service

Go to Render Dashboard → your **Python Web Service** → **Environment**. These variables belong to the backend service. They do not belong in the React source, GitHub repository secrets for the frontend, or any `VITE_` variable.

The repo's private development environment is not automatically copied into Render. Production deliberately skips that file. You do not need to run a backend on your lab computer.

A private import file has been prepared in this workspace at `/workspace/.attendance-secrets/render-production.env` with mode 0600. It reuses the existing Supabase server key, persistent encryption key and scheduler secret, and contains the supplied public Firebase config/key. It does not include the development student's email or password. This file is outside Git and must never be committed, shared publicly, or pasted into chat.

## 2. Import the backend variables together

In Render's Environment page, choose **Add from .env** (or the equivalent bulk-import option), and import/paste the private file there. Review all entries before saving. If adding rows individually, use this list:

| Variable | Value / source |
| --- | --- |
| `APP_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://attendance.varmalabs.tech` — exact origin, no trailing slash |
| `SUPABASE_URL` | `https://sknfnvupcgoarfzrfwvl.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only service-role key from the private import file |
| `CAMPX_ENCRYPTION_KEY` | Existing persistent Fernet key from the private import file |
| `CACHE_TTL_SECONDS` | `60` |
| `SESSION_TTL_SECONDS` | `0` for remembered login until sign-out/revocation |
| `CAMPX_MAX_CONCURRENCY` | `16` |
| `MAX_ACTIVE_OPERATIONS` | `8` |
| `FIREBASE_PROJECT_ID` | `attendance-90c12` |
| `FIREBASE_WEB_CONFIG` | Public Firebase config as one valid JSON object, supplied in the import file |
| `FCM_VAPID_PUBLIC_KEY` | The supplied public Web Push key, in the import file |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/etc/secrets/firebase-service-account.json` |
| `CRON_SECRET` | Existing scheduler secret from the private import file; keep it private |
| `NOTIFICATION_BATCH_SIZE` | `2` for the initial pilot |
| `NOTIFICATION_INTERVAL_SECONDS` | `900` |
| `FIREBASE_USAGE_ENABLED` | `false` for the first deployment |
| `NOTIFICATIONS_ENABLED` | `false` for the first deployment |

Save the complete group together so the production server receives the Supabase URL, server key and encryption key in the same deployment. Render may label the action **Save, rebuild, and deploy** or **Save and deploy**; if you save without deploying, use Manual Deploy afterward. Values are not active in an already-running process until it restarts/deploys.

Do not add `CAMPX_LOGIN_ID` or `CAMPX_PASSWORD`: each student supplies their own login. Do not prefix backend secrets with `VITE_`. Keep the same encryption key on all instances using this database; changing it invalidates the ability to decrypt sessions written with the previous key. Do not regenerate it on every deployment.

If you use local Vite development against this production API, prefer an HTTPS lab preview URL and add its exact origin to the comma-separated CORS list alongside the custom domain. The current production validation rejects HTTP origins, including `http://localhost:5173`. Plain HTTP local development requires a development backend rather than changing the production service to development mode.

## 3. Verify persistent storage before enabling Firebase

Wait for a successful deploy. Check these service settings:

- Branch: `feature/react-attendance-pwa`, including the latest reviewed commit.
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT --workers 1`
- Health check path: `/health/ready`
- Runtime: Python 3.12 or a supported newer version.

Open `YOUR_RENDER_URL/health/ready`. At this stage expect:

```json
{"status":"ok","storage":"supabase","usage":"disabled"}
```

`development-memory` means this is not yet running with the intended production configuration. A startup failure about Supabase/encryption means one of the required values is missing or invalid. Keep TLS verification enabled. Check Render logs for the specific configuration error, without publishing keys or full environment contents.

Use the React frontend to log in, open Calendar/Subjects, refresh and log out. Both Supabase migrations are already applied to the existing project; no additional migration is required for the final tour note.

## 4. Add the Firebase server credential

In the same Render backend service → Environment → **Secret Files**, add a file named exactly:

```text
firebase-service-account.json
```

Put the complete contents of the Firebase service-account JSON you previously supplied into this private Render secret file. The existing private copy in this workspace is `/workspace/.attendance-secrets/firebase-service-account.json`; use the original upload if you already have it locally. Do not paste its contents into chat or source files.

Render mounts that filename at `/etc/secrets/firebase-service-account.json`, matching `GOOGLE_APPLICATION_CREDENTIALS`. If you choose another filename, update that path to match it exactly. The public `FIREBASE_WEB_CONFIG` JSON is different: it initializes the browser messaging client and cannot replace this private server credential.

## 5. Enable Firebase usage and notification opt-in

After the credential file exists, change these two rows:

```dotenv
FIREBASE_USAGE_ENABLED=true
NOTIFICATIONS_ENABLED=true
```

Save and deploy again. The startup reads both flags and the service-account file. Verify:

- `/health/ready` reports Supabase and `usage: enabled-best-effort`.
- `/api/notifications/config` reports `enabled: true` and `usageEnabled: true`.
- One real login creates/updates private pseudonymous records under Firebase → Firestore → `usage_users` and its `days` subcollection.

These checks do not prove device delivery. On the deployed HTTPS React app, choose Settings → Enable notifications, grant permission, then Send a test. Verify receipt and click behavior on that actual device. iOS/iPadOS requires a supported installed Home Screen app. There is no Firebase Auth sign-in in this app.

## 6. Configure the scheduled jobs

In cron-job.org, create the following jobs using your deployed API URL:

| HTTP method | URL path | Initial schedule |
| --- | --- | --- |
| POST | `/internal/notifications/run` | Once per minute |
| POST | `/internal/notifications/deliver` | Once per minute |
| POST | `/internal/maintenance` | Daily, e.g. 02:00 with the scheduler timezone set to Asia/Kolkata |

For every job add an HTTP header named `Authorization` with value `Bearer ` followed by the **exact `CRON_SECRET`** from your Render environment, including the space after Bearer. No request body is needed. Do not place the secret in the URL. An old GET liveness ping does not run these jobs. Check job history for HTTP 200; a 401 means the header/secret does not match.

The default checking batch is a small pilot setting, not capacity for frequent checks of 2,000 students. Read [rollout.md](rollout.md) before increasing enrollment. Background checks need a valid CampX connection even when the app login is remembered. CampX can independently require reconnection; it is not bypassed by the app-session setting.

## 7. Connect and publish the React frontend

The frontend currently defaults to `https://attendance-temn.onrender.com`. If this is your deployed backend, no API URL change is needed. For another Render hostname, set `VITE_API_BASE_URL` to that exact HTTPS origin before the build, then rebuild and publish. This is the frontend's only backend-address setting; none of the server keys belong there.

For lab development, put the public API URL in `.env.local`, restart Vite, and ensure that lab preview's origin is allowed by the backend. For the manual GitHub Pages workflow, the build uses the repository variable `VITE_API_BASE_URL` if provided, otherwise the existing default API URL. Changing a repository variable after publication requires running the build/deploy workflow again.

In GitHub Settings → Pages, keep the custom domain `attendance.varmalabs.tech` and choose GitHub Actions as source. The default `main` branch currently has no Pages workflow, so first create/review a pull request from `feature/react-attendance-pwa` into `main` and merge it when ready to publish. GitHub's manual workflow trigger requires the workflow file on the default branch. Then open Actions → **Publish React frontend to GitHub Pages** → Run workflow and select `main`. It publishes `dist`, not raw source. Wait for success and verify login, the tour's final CampX note, subject history, calendar and logout on the custom domain. Render may continue to use the feature branch, or you can point it to the reviewed merged branch; ensure the deployed code includes the same changes.

If you created two Render services, import the same shared database/encryption/Firebase/scheduler settings and add the secret file to each. The frontend still uses one API base URL; merely deploying a second service does not configure traffic distribution or failover.

For the remembered-login update, deploy the new backend, save/redeploy `SESSION_TTL_SECONDS=0`, then publish the new frontend. `/health/ready` should report `sessionTtlSeconds: 0`. No additional SQL migration is required; see [session-persistence.md](session-persistence.md).
