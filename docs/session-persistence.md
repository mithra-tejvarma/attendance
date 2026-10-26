# Remembered app sessions

Reopening or reloading the app now restores the signed-in account using an opaque app token. The browser stores only that token, the configured API origin and a frontend build identifier under `vl-session-v1`. It does not store a CampX password, email/profile, attendance response or timetable in browser storage. The login ID needed for Settings/reconnection stays inside the server's encrypted CampX connection metadata and is returned only to the authenticated owner.

The first restore reads `GET /api/me/dashboard` from the private server cache. It renders saved attendance with its original fetch time, then refreshes stale data in the background without resending the password. Resuming an already-open stale app can also refresh on visibility change. It does not continuously poll CampX while hidden. Slow/cold servers, network errors and 5xx responses preserve the saved sign-in and offer retry. Offline reopening can preserve sign-in but cannot load personal attendance without the backend; personal responses are still excluded from service-worker caches.

## Deploy this update

1. Deploy the updated backend code and set **`SESSION_TTL_SECONDS=0`** in each Render backend service. An existing `7200` value overrides the new default and would retain the old two-hour timeout. Save and deploy/restart the services.
2. Verify `/health/ready` reports `storage: supabase` and `sessionTtlSeconds: 0`. Keep the same Supabase project and persistent `CAMPX_ENCRYPTION_KEY` across services/restarts. No new SQL migration is needed.
3. Build/publish the updated React frontend. Existing users sign in once on this release, then subsequent opens restore their account until sign-out, a new frontend version, server revocation or browser storage clearing.
4. Test reload, closing/reopening the app, sign-out across two tabs and another reload. Private browsing/site-data restrictions may prevent device persistence outside the app's control.

The prepared private Render import file in this workspace has been updated to use zero; it is still outside Git. Updating that file does not change a running Render service. The Render environment value must be changed by its owner.

Zero means the app session has no automatic lifetime timeout. The existing SQL expiry column remains NOT NULL, so the backend uses a documented far-future timestamp for these revocable rows. Explicit positive values from 60 to 86,400 seconds remain supported for operators who want timed sessions. Successful session restoration does not create a new session or slide a finite expiry.

## App login and CampX connection are separate

CampX can expire or reject its own cookies independently. The app does not store passwords to bypass that expiry. A confirmed upstream expiry now returns `428 campx_reconnect`, marks that connection for renewal and retains the app session and private saved dashboard. Repeated requests with the known-expired connection are stopped without repeatedly contacting CampX.

The interface keeps the dashboard open and offers **Reconnect CampX**. `POST /api/reconnect` requires the current app bearer token and fresh credentials for the **same verified student**. A different student is rejected; switch accounts through Sign out first. Successful reconnection updates the encrypted connection and fresh snapshots without replacing/resurrecting the app token, and can resume existing consented notification subscriptions. The password is discarded after use. A concurrent sign-out cannot be undone by a late reconnection response.

An app token explicitly expired, deleted or rejected by the backend clears the remembered login. A verified upstream identity change still revokes the affected session. The backend's service-role and encryption keys must stay private; changing encryption keys without a migration/revocation plan can prevent existing connections from being restored.

## Sign-out and updates

Sign out removes the local app token and personal in-memory state immediately, notifies other open tabs through browser storage events and sends an authenticated server logout request. A successful server logout deletes that session and its bound push subscriptions. Server-side revocation needs a working network connection; offline/failed requests can clear the device immediately but cannot guarantee server acknowledgement. Tokens are never accepted in URLs.

The frontend build identifier is a deterministic hash of frontend source/public assets and build configuration. Loading a changed frontend version discards the old remembered login and attempts to revoke it, as requested. Rebuilding unchanged frontend inputs keeps the same identifier; an ordinary backend restart does not force app logout when shared storage/encryption are stable. Old tabs respond to storage changes without deleting a newer version's session. Requests finishing after sign-out/account changes cannot restore the old account.

This uses a first-party stored bearer token because the current frontend/custom domain and Render API are on different sites; it does not depend on third-party cookies. Persisting a token means trusted JavaScript on the frontend origin can access it, so dependency/XSS protection remains part of deployment security. It never introduces Firebase Auth or a plaintext password vault. Students should sign out on shared devices.

## Verification

Automated checks cover reload/new-tab restoration, sign-out propagation, transient/network failures, server revocation, release invalidation, stale-data refresh, app resume, same-account CampX reconnection, session expiry configuration, cross-instance restore and concurrent logout/reconnect races. Live development checks passed against the actual Supabase database, including the far-future expiry, encrypted restore in a second service instance, same-account reconnection and cross-instance logout/revocation. Those checks do not change the live Render environment or publish the new frontend.
