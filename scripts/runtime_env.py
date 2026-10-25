"""Load the authorized shared development runtime without replacing injected bindings."""

import os
import shlex
import stat
from pathlib import Path

ALLOWED = {
    "APP_ENV",
    "CAMPX_LOGIN_ID",
    "CAMPX_PASSWORD",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CAMPX_ENCRYPTION_KEY",
    "CAMPX_CLIENT_TOKEN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_USAGE_ENABLED",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "ALLOWED_ORIGINS",
    "SESSION_TTL_SECONDS",
    "CAMPX_MAX_CONCURRENCY",
    "MAX_ACTIVE_OPERATIONS",
    "MAX_MEMORY_SESSIONS",
}


def load_development_env():
    if os.getenv("APP_ENV") == "production":
        return
    path = Path(
        os.getenv("BACKEND_ENV_FILE", "/workspace/.attendance-secrets/attendance.env")
    )
    if not path.exists():
        return
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError(
            "Backend development runtime file must have private permissions (0600)."
        )
    for line in path.read_text().splitlines():
        tokens = shlex.split(line, comments=True)
        if not tokens:
            continue
        if len(tokens) != 1 or "=" not in tokens[0]:
            raise ValueError("Invalid backend runtime assignment; values omitted.")
        name, value = tokens[0].split("=", 1)
        if name not in ALLOWED:
            raise ValueError("Unsupported backend runtime variable; values omitted.")
        os.environ.setdefault(name, value)
