# Attendance · Varma Labs

React 19 + TypeScript + Vite frontend with an async FastAPI attendance backend. Responsive light/dark design, floating mobile navigation, subject summaries, on-demand calendar, local what-if planner, and an installable PWA shell. No Firebase authentication is used.

## Develop

Use Node.js 24 and the existing checkout (no worktree needed).

```sh
npm ci
npm run dev
```

The API defaults to `https://attendance-temn.onrender.com`. To use your own backend, copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL`. For example, use `http://127.0.0.1:8000` when running `python -m uvicorn server:app --reload` with the Python requirements installed. Vite variables are public build-time values: never put credentials in them.

The cloud sandbox can use `npm ci --cache /tmp/attendance-npm-cache` when its default home cache is unwritable.

## Verify

```sh
npm run build
npx playwright install chromium
npm test -- --workers=2
npm run preview
```

Tests use mocked CampX payloads, real Chromium, both themes, mobile/desktop viewports, axe accessibility checks, and offline shell loading. A system Chromium is used when available; alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` or install Playwright's browser. These checks do not validate real CampX authentication or complete browser/device coverage.

## Deployment at attendance.varmalabs.tech

The existing domain currently serves a static site with GitHub Pages headers. This repository now requires a build; publishing the raw repository root will not serve the React app correctly.

### Keep GitHub Pages (no DNS move required)

1. Set repository Settings → Pages → Source to **GitHub Actions**.
2. Keep the Pages custom domain set to `attendance.varmalabs.tech`.
3. Review and run the manual **Publish React frontend to GitHub Pages** workflow. It publishes `dist`, not source files. The custom domain is also copied into `dist/CNAME`.

The workflow intentionally has no push trigger. Implementation does not publish the live site.

### Alternatively use Firebase Hosting

`firebase.json` targets the built `dist` directory and `.firebaserc` selects `attendance-90c12`. Build, authenticate using an authorized Firebase account, and run `firebase deploy --only hosting --project attendance-90c12`. Configure the custom domain in Firebase Hosting and update DNS using the records Firebase provides. Choose one hosting target for the domain, not both.

Backend-only Firebase usage and opt-in FCM delivery are implemented but not activated. The server credential is private, outside Git; Firestore API activation, the notification migration and the Web Push VAPID public key are still needed. A Firebase project ID is public configuration, not authentication.

## Authentication and data boundaries

- Login calls `/api/attendance`. The new backend returns an opaque app session; subsequent refresh/month requests use that bearer token, not the password. Tokens and credentials remain in memory for this tab, never localStorage or cookies. Reloading requires signing in again; sessions are not restored across browser reloads.
- Legacy CampX browser credentials and attendance caches are cleared on first load of this version. Their old cookie deletion is scoped to the current host and `/` path; host/parent-domain cookies created elsewhere need corresponding server-side cleanup.
- The previous HTML interface is preserved in `docs/legacy-interface.html` as a migration reference. It is not included in `dist` and should not be served: it contains the previous plaintext browser password behavior.
- Current-month data is fetched by the server at login; the frontend receives a compact summary and today’s classes. Full month details load when Calendar or Playground is selected. Other months load only when selected. No adjacent-month or five-month prefetch exists.
- Navigation, theme changes and planner calculations are local; network refreshes never disable navigation. Network latency is not guaranteed to be zero.
- The public app has only CampX login: there is no demo button, sample workspace, or marketing intro. Synthetic data lives only under `tests/` and is excluded from the application build.
- Calendar colors distinguish green full-present days, red full-absent days, orange mixed days, and pending/unmarked records. Incomplete marks never turn a day fully present. Selected-day details include all scheduled and separately recorded classes, times, useful subject codes and faculty names, and personal statuses on mobile as well as desktop.
- Timetable names support the known/fallback shapes. Class-level present/absent uses the legacy `isAbsent` flag (0 = present, 1 = absent). Records match by explicit session identity, subject plus time, or a subject that occurs only once in both datasets. Missing flags, conflicting records and ambiguous repeated subjects stay unmarked. Live responses now verify the embedded per-timetable personal record; the adapter uses its exact class link and absence-polarity flag.
- Playground supports day-wise and class-wise future plans with overall/subject projections, plus a quick calculator. Only loaded real timetables through the chosen end date count; no guessed semester end or institution-specific exemptions are applied.
- Attendance is held in memory, not persisted offline. The service worker caches only public UI assets. Closing/reloading offline does not restore personal attendance.

## Future work and rollout limits

The async backend, private Supabase adapter/migration, encrypted upstream sessions, saved snapshots, and optional Firebase usage writer are implemented. Supabase persistence is configured and live-tested in this workspace; the new code is not deployed to Render or the live domain. Opt-in FCM delivery, bounded scheduled checks, a durable outbox and retention cleanup are implemented behind activation flags. An analytics UI remains pending. See [backend activation and verification](docs/backend.md) for exact contracts, limits, tests, configuration and blockers.

Development runs with bounded in-memory storage; production explicitly requires Supabase. Live CampX checks have passed using the provided private development runtime. The Supabase migration is installed, and encrypted session persistence, private reads, refresh, month/day writes and logout have passed live checks. Firebase server credentials are configured privately, but Firestore is disabled in the project, so usage analytics are not activated. Push also needs the VAPID public key and new SQL migration. Backend client limits, error handling and session behavior need a small authorized live pilot before broad rollout.

See [rollout, activation steps and measured limits](docs/rollout.md) for the current 1,000–2,000-student assessment, Firebase/cron configuration and known limitations.

## Release updates and performance

`npm run build` emits hashed assets and a versioned service worker. Existing app sessions show an **Update now** banner after a new worker is discovered; activation waits for the user. HTML and worker files should be revalidated; hashed assets can be cached immutably. Firebase headers are configured accordingly. GitHub Pages controls its own cache headers. Keep old hashed assets available during releases if your hosting supports it so long-open tabs can finish loading.

System fonts, local icons, no animation library, limited backdrop blur, reduced-motion support and immediate React state transitions keep interactions lightweight. Bundle sizes are printed by Vite; measure actual low-end mobile performance and CampX latency before promising response targets.

To extend the app, use `src/App.tsx` for session/page orchestration, `src/components.tsx` for views, `src/api.ts` for transport, `src/data.ts` for payload types, `tests/fixtures.ts` for isolated test data, and `src/styles.css` for theme tokens and responsive styling.

## Focused glass interface

Overview contains only the attendance hero, attended/missed/total counts, and today’s classes. Subjects and Calendar live in separate navigation views. The workspace/profile top bar is removed. Frosted surfaces use the original static interface’s navy/slate and indigo palette in dark mode, with neutral gray/white surfaces and indigo in light mode; semantic present/absent colors remain distinct. Blur is limited to surfaces and navigation with reduced-transparency and unsupported-browser fallbacks.

The class clock follows Asia/Kolkata (campus IST), updates every 15 seconds and resynchronizes when the tab becomes visible. A class is upcoming before its start, live from start inclusive to end exclusive, and completed afterward. Invalid or missing times remain unavailable. This clock does not poll CampX or imply that attendance is streamed live: refresh retrieves newly posted attendance. Day changes select the new campus date; refresh if its bundle is unavailable.

Settings shows available CampX student name, profile email, roll number, branch, class and semester. The separately labeled “Login used” comes from the current in-memory login, since a CampX login ID need not equal the profile email. Missing fields show explicit placeholders; passwords are never displayed. Profile data is cleared on sign-out and is not added to browser storage.

## Calendar and glass interactions

Calendar opens a useful selected day automatically, shows full class details on mobile, and includes separately recorded attendance when no timetable link is available. Month loads are tracked per month, so rapidly switching months cannot hide a newer request's loading state. Failed requests have an explicit retry action and do not replace known student records. Subject/faculty details contain names and codes only, never contact data.

`src/student.css` contains the student calendar, minimal login and legacy status palette. `src/useGlassLight.ts` tracks pointer light and a small scroll-driven ambient offset using a single scheduled animation frame, with no continuous idle loop. Reduced-motion disables movement; reduced-transparency and unsupported-browser fallbacks remain available.
