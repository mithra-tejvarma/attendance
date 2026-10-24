# Attendance · Varma Labs

React 19 + TypeScript + Vite frontend for the existing FastAPI attendance API. Responsive light/dark design, floating mobile navigation, subject summaries, on-demand calendar, local what-if planner, and an installable PWA shell. No Firebase authentication is used.

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

No Firebase secrets, Admin SDK keys, analytics writes, or push backend have been added. A Firebase project ID is public configuration, not authentication.

## Authentication and data boundaries

- Login calls the existing `/api/attendance` endpoint. Credentials remain in React memory for this tab; they are not saved in localStorage or cookies. Reloading requires signing in again until server sessions are implemented.
- Legacy CampX browser credentials and attendance caches are cleared on first load of this version. Their old cookie deletion is scoped to the current host and `/` path; host/parent-domain cookies created elsewhere need corresponding server-side cleanup.
- The previous HTML interface is preserved in `docs/legacy-interface.html` as a migration reference. It is not included in `dist` and should not be served: it contains the previous plaintext browser password behavior.
- Current-month data is loaded at login. Other months load only when selected. No adjacent-month prefetch exists.
- Navigation, theme changes and planner calculations are local; network refreshes never disable navigation. Network latency is not guaranteed to be zero.
- Demo mode is clearly labeled and never contacts CampX. No sample data is substituted into a live account.
- Missing calendar records are unknown, not absent. Unknown status labels stay unclassified until the upstream schema is verified.
- Timetable names support the known/fallback shapes. Class-level present/absent uses the legacy `isAbsent` flag (0 = present, 1 = absent). Records match by explicit session identity, subject plus time, or a subject that occurs only once in both datasets. Missing flags, conflicting records and ambiguous repeated subjects stay unmarked. Real-account payload validation is still pending.
- Planner projections use attended/total counts and a 75% reference. They do not implement the legacy full-semester projection or institution-specific exemptions.
- Attendance is held in memory, not persisted offline. The service worker caches only public UI assets. Closing/reloading offline does not restore personal attendance.

## Future work and rollout limits

Supabase sessions/data, Firebase usage records and FCM delivery are separate backend phases and are not connected yet. Notification settings intentionally do not request permission. Installation is browser-dependent; test Android, desktop and iPhone home-screen flows on real devices.

The backend still has its original synchronous requests, broad CORS configuration, no production session system, and upstream error fallbacks. Before a wider rollout, implement bounded concurrent requests, explicit timeouts, verified student identity, per-user authorization, rate limits, restricted production CORS, reliable failure semantics, encrypted upstream session handling and a durable sync/notification outbox. This frontend does not solve those server limitations.

For future sessions, prefer same-site `attendance.varmalabs.tech` and `api.varmalabs.tech` with secure HTTP-only cookies and explicit CSRF/CORS handling. Both backend instances must share sessions and job leases if a second server is introduced.

## Release updates and performance

`npm run build` emits hashed assets and a versioned service worker. Existing app sessions show an **Update now** banner after a new worker is discovered; activation waits for the user. HTML and worker files should be revalidated; hashed assets can be cached immutably. Firebase headers are configured accordingly. GitHub Pages controls its own cache headers. Keep old hashed assets available during releases if your hosting supports it so long-open tabs can finish loading.

System fonts, local icons, no animation library, limited backdrop blur, reduced-motion support and immediate React state transitions keep interactions lightweight. Bundle sizes are printed by Vite; measure actual low-end mobile performance and CampX latency before promising response targets.

To extend the app, use `src/App.tsx` for session/page orchestration, `src/components.tsx` for views, `src/api.ts` for transport, `src/data.ts` for payload types and clearly separated demo fixtures, and `src/styles.css` for theme tokens and responsive styling.

## Focused glass interface

Overview contains only the attendance hero, attended/missed/total counts, and today’s classes. Subjects and Calendar live in separate navigation views. The workspace/profile top bar is removed. Frosted surfaces use the original static interface’s navy/slate and indigo palette in dark mode, with neutral gray/white surfaces and indigo in light mode; semantic present/absent colors remain distinct. Blur is limited to surfaces and navigation with reduced-transparency and unsupported-browser fallbacks.

The class clock follows Asia/Kolkata (campus IST), updates every 15 seconds and resynchronizes when the tab becomes visible. A class is upcoming before its start, live from start inclusive to end exclusive, and completed afterward. Invalid or missing times remain unavailable. This clock does not poll CampX or imply that attendance is streamed live: refresh retrieves newly posted attendance. Day changes select the new campus date; refresh if its bundle is unavailable.

Settings shows available CampX student name, profile email, roll number, branch, class and semester. The separately labeled “Login used” comes from the current in-memory login, since a CampX login ID need not equal the profile email. Missing fields show explicit placeholders; passwords are never displayed. Profile data is cleared on sign-out and is not added to browser storage.
