# Database choice for this attendance app

Keep **Supabase for private sessions, attendance caches, leases and notification jobs**, and **Firebase for usage totals and FCM**. Moving all storage to Firebase is not an improvement for the current free-only workload. No database migration to Firebase was made.

Official limits checked on 25 October 2026:

| Requirement | Supabase Free | Firestore free quota |
| --- | --- | --- |
| Database storage | 500 MB | 1 GiB |
| Operations | Unlimited API requests, subject to shared compute/resource limits | 50,000 document reads/day; 20,000 document writes/day; 20,000 deletes/day |
| Transfer | 5 GB ordinary egress; cached egress has a separate allowance | 10 GiB outgoing/month |
| Current backend | Already implements SQL transactions, foreign-key deletion, indexed session lookups, atomic claims and durable outbox | Needs a different store, transaction/claim design, deletion logic and authorization tests |
| Notification delivery | Can feed FCM directly from backend | FCM works with either database; it does not require attendance storage in Firestore |
| Authentication | Current backend authenticates against CampX | Server Firestore access also works without Firebase Auth; moving storage does not change CampX latency |

Sources: [Supabase pricing](https://supabase.com/pricing), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [FCM pricing](https://firebase.google.com/products/cloud-messaging).

The larger free Firestore storage allowance does not remove its operation quotas. For example, 2,000 students opening the app four times daily is 8,000 login flows. A straightforward port of this backend would update a student, create a session, save a dashboard and save a month: roughly **32,000 document writes/day**, before usage tracking, refreshes, month views, token registration or polling. Successful login analytics can add two writes each. Cache hits change the exact total, but Firestore-only cannot be assumed to fit a 20,000-write daily budget. A redesigned Firestore backend could coalesce/skip some writes, but that is a separate implementation and pilot, not extra free capacity by switching a URL.

Supabase also has real limits. One measured normalized month for the authorized account was about 37.5 KB. Two such cached months for 2,000 students is about **150 MB of JSON**, before PostgreSQL JSONB overhead, indexes, sessions, day snapshots, profiles and job history. This is an estimate, not a measurement of physical database size or a guarantee that 500 MB is sufficient. The current TTL removes months by last fetch time, so users requesting many different historical months can retain more than two months temporarily.

Monitor actual database size, ordinary egress, active sessions and worker queue age in Supabase. Use an early warning around **350 MB** rather than waiting until the project reaches 500 MB. The daily authenticated maintenance job removes expired sessions/leases, day caches after 7 days, month caches after 60 days and old delivery records. It is implemented and its SQL is installed, but the external cron schedule still needs to be configured. Latest dashboards/profiles and Firebase daily metrics need separate long-term retention decisions.

If storage approaches the free limit, first shorten cache retention or evict older cached month snapshots in a controlled change. These are copies that can be fetched again from CampX, not the official attendance records. The tradeoff is more upstream requests and slower old-month views. Do not keep every raw response or permanent duplicate attendance history. Compression, smaller stored projections and bounded per-user cache counts are possible follow-up improvements if measurements justify them; they are not implemented by this change.

History views also cost bandwidth: showing five results does not make the backend's whole-month cache read free. This version shares one month request among Subjects, Calendar and Playground, and expands already-loaded results locally. If all 2,000 users load a 37.5 KB month four times daily, that payload alone is around **9 GB/month**, before other traffic, above Supabase's 5 GB ordinary egress allowance. The small overview response helps, but heavy history use needs a measured pilot and further server/database projection work. No free plan has been verified for 2,000 concurrent students or frequent all-student polling.

Firebase usage is best-effort and this app reserves at most 16,000 document writes per Pacific quota day across servers. If attendance storage also lived in that same Firestore project, both features would compete for its 20,000-write free quota. Keeping SQL operational state separate avoids that coupling. FCM remains available independently; moving databases would not fix Render cold starts or the lack of a CampX posting webhook.
