"""Synthetic in-process cache-path check; never contacts CampX, Supabase or Firebase.

This checks isolation/backpressure, not Render or production capacity.
"""

import argparse
import asyncio
import hashlib
import json
import statistics
import time
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_DNS, uuid5

import httpx

from backend.app import create_app
from backend.config import Settings
from backend.store import MemoryStore


async def main(students, concurrency):
    store = MemoryStore(capacity=students)
    now = datetime.now(UTC)
    tokens = []
    for index in range(students):
        uid = str(uuid5(NAMESPACE_DNS, f"fixture-{index}.invalid"))
        token = f"synthetic-cache-session-{index:016d}"
        tokens.append(token)
        await store.put_session(
            {
                "token_hash": hashlib.sha256(token.encode()).hexdigest(),
                "student_id": uid,
                "expires_at": (now + timedelta(hours=1)).isoformat(),
                "context": {"studentId": uid, "classroomId": "fixture", "semNo": "7"},
                "connection": {},
            }
        )
        await store.save_snapshot(
            uid,
            "dashboard",
            {
                "primary": {"student": {"rollNo": f"fixture-{index}"}},
                "dailyBundle": {},
                "monthDetailsComplete": False,
                "fetchedAt": now.isoformat(),
            },
        )
    app = create_app(Settings(), store=store)
    durations, counts = [], {}
    slots = asyncio.Semaphore(concurrency)
    started = time.perf_counter()
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid"
        ) as client,
    ):

        async def request(index):
            async with slots:
                before = time.perf_counter()
                response = await client.get(
                    "/api/me/dashboard",
                    headers={"Authorization": "Bearer " + tokens[index]},
                )
                durations.append(1000 * (time.perf_counter() - before))
                counts[response.status_code] = counts.get(response.status_code, 0) + 1
                if response.status_code == 200:
                    assert (
                        response.json()["data"]["primary"]["student"]["rollNo"]
                        == f"fixture-{index}"
                    )
                else:
                    assert response.status_code == 503

        await asyncio.gather(*(request(index) for index in range(students)))
    elapsed = time.perf_counter() - started
    durations.sort()
    print(
        json.dumps(
            {
                "mode": "synthetic-memory-ASGI-no-network",
                "students": students,
                "concurrency": concurrency,
                "statuses": counts,
                "elapsedSeconds": round(elapsed, 3),
                "medianMs": round(statistics.median(durations), 2),
                "p95Ms": round(durations[int(len(durations) * 0.95) - 1], 2),
                "maxMs": round(durations[-1], 2),
                "crossStudentMismatches": 0,
                "productionCapacityEstablished": False,
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--students", type=int, default=2000)
    parser.add_argument("--concurrency", type=int, default=32)
    args = parser.parse_args()
    if not 1 <= args.students <= 10000 or not 1 <= args.concurrency <= 200:
        parser.error("Use 1..10000 students and 1..200 concurrency")
    asyncio.run(main(args.students, args.concurrency))
