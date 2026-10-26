# Use the React frontend from your lab

You do not need to run Python or a backend server on your lab computer. Run/build the frontend there and connect it to the deployed Render API. As checked on 25 October 2026, `attendance.varmalabs.tech` still serves the legacy HTML and the existing Render API returns 404 for `/health/ready`. Pushing the feature branch does not deploy either service.

For the exact current Render variable values, private import-file instructions and staged checks, follow [render-environment-setup.md](render-environment-setup.md). The latest check on 26 October found the new API running with development-memory storage; environment setup is the next step.

## Deploy the new backend first

1. In Render, open the existing attendance service and set its repository branch to `feature/react-attendance-pwa` (or merge the reviewed changes into its deployment branch).
2. Use Python 3.12 or a supported newer version. Set build command to `pip install -r requirements.txt` and start command to `uvicorn server:app --host 0.0.0.0 --port $PORT --workers 1`. Set the health check path to `/health/ready`. The repository's `render.yaml` is a reference; it has not been applied automatically.
3. Configure server variables securely. Nothing confidential belongs in a `VITE_` variable:

   | Name | Setting |
   | --- | --- |
   | `APP_ENV` | `production` |
   | `ALLOWED_ORIGINS` | `https://attendance.varmalabs.tech`, plus the exact frontend development origin if required |
   | `SUPABASE_URL` | The existing shared project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server secret from the existing project |
   | `CAMPX_ENCRYPTION_KEY` | One persistent Fernet key, identical across backend instances; never regenerate every boot |
   | `CACHE_TTL_SECONDS` | `60` |
   | `FIREBASE_PROJECT_ID` | `attendance-90c12` |
   | `FIREBASE_WEB_CONFIG` | The supplied public Firebase web configuration as JSON |
   | `FCM_VAPID_PUBLIC_KEY` | The public key supplied in this conversation |
   | `CRON_SECRET` | A strong server/scheduler secret of at least 32 random characters |
   | `NOTIFICATION_BATCH_SIZE` | `2` for the initial pilot |
   | `NOTIFICATION_INTERVAL_SECONDS` | `900` |
   | `FIREBASE_USAGE_ENABLED` | Enable after the deployed server passes a usage-write check |
   | `NOTIFICATIONS_ENABLED` | Enable after credentials, migrations and public push configuration are present |

4. Add the Firebase service-account JSON as a Render **Secret File**, named `firebase-service-account.json`, and set `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-service-account.json`. A secure `FIREBASE_SERVICE_ACCOUNT_JSON` environment value is an alternative. Do not use both unnecessarily. Never commit or paste this private JSON into frontend code. The workspace's private development files are not automatically copied into Render.
5. Do not configure `CAMPX_LOGIN_ID` or `CAMPX_PASSWORD` as defaults for website users. Every student supplies their own login. Production deliberately ignores the development runtime file.
6. Manually deploy, check `/health/ready`, and test login, refresh, selected month, settings and logout. The two Supabase migrations and live Firebase usage have been verified in development; repeat the affected checks against the deployed service. No new SQL migration is required for the tour/history interface.

Keep both optional flags false during the initial server deployment if Firebase credentials have not been securely configured there yet. Readiness currently verifies the operational database, not real device push delivery. Confirm that `/api/notifications/config` reports the expected public readiness before offering opt-in to testers.

## Run only the frontend locally

```sh
npm ci
npm run dev
```

The app defaults to `https://attendance-temn.onrender.com`. If your Render hostname changes, set `VITE_API_BASE_URL` in `.env.local` before starting/building. Vite values are public and build-time. Add the actual lab/browser frontend origin to the backend's exact CORS list. If an online development platform supplies a preview hostname, use that origin rather than assuming localhost. Keep the live domain in the list as well. No student credentials or Firebase server key belong in this frontend file.

The browser supports the legacy faculty array and safely links legacy embedded timetable IDs to an owned attendance record, but this compatibility is not a replacement for deploying the new backend. Firebase usage, push endpoints, encrypted app sessions and the server cache need the new server code.

## Publish the React website

1. In GitHub repository Settings → Pages, choose **GitHub Actions**, keeping `attendance.varmalabs.tech` as the custom domain.
2. The default `main` branch currently has no Pages workflow. Review and merge `feature/react-attendance-pwa` into `main` before trying manual dispatch: GitHub requires the workflow file on its default branch. Then run **Publish React frontend to GitHub Pages** from `main`. It builds/publishes `dist`; publishing the raw repository root would continue serving the wrong files.
3. Verify the custom domain now loads hashed `/assets/` files, log in with an authorized account, and complete the guided tour. Users can skip it or restart it under Settings → Show me around.

## Activate scheduled notifications

In cron-job.org create separate authenticated **POST** jobs for `/internal/notifications/run` and `/internal/notifications/deliver`, initially once per minute. Create a daily **POST** `/internal/maintenance` job. Each uses `Authorization: Bearer <CRON_SECRET>` as a header. Keep the secret out of URLs. See [rollout.md](rollout.md) for pilot queue capacity and free-provider timeout limits.

On the deployed HTTPS app, a tester must choose Settings → Enable notifications, grant browser permission, and select Send a test. Verify both receipt and click behavior on that real device. Development has verified Firebase usage writes, public push configuration and empty worker calls, but **not a real-device notification**. The two-hour app session lifetime still limits unattended checks. iOS/iPadOS requires a supported installed Home Screen app. There is no confirmed instant CampX webhook.
