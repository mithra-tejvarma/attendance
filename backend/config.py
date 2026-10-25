import json
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

# Existing public web-client identifier; override when CampX rotates its browser client.
LEGACY_CLIENT = "eyJjbGllbnRJZCI6ImVmYTRkZGFiLTMwMzEtNDM3MC1hZDc3LTQ2NTU3ZDRmMDg5MCIsImlhdCI6MTc4NTA1OTIwN30.7AY9CN4J9XclC760edIgF7GyXNTfy2t0MDuEWC5oLyg"


@dataclass(frozen=True)
class Settings:
    production: bool = False
    supabase_url: str = ""
    supabase_key: str = ""
    encryption_key: str = ""
    client_token: str = LEGACY_CLIENT
    origins: tuple[str, ...] = (
        "https://attendance.varmalabs.tech",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )
    cache_seconds: int = 0
    session_seconds: int = 7200
    max_requests: int = 16
    max_operations: int = 8
    max_sessions: int = 1000
    firebase_usage: bool = False
    firebase_project: str = "attendance-90c12"
    firebase_web: dict = field(default_factory=dict)
    vapid_public: str = ""
    notifications_enabled: bool = False
    cron_secret: str = ""
    notification_batch_size: int = 2
    notification_interval_seconds: int = 900

    @classmethod
    def from_env(cls):
        production = os.getenv("APP_ENV") == "production"
        defaults = ("https://attendance.varmalabs.tech",) if production else cls.origins
        result = cls(
            production=production,
            supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/"),
            supabase_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            encryption_key=os.getenv("CAMPX_ENCRYPTION_KEY", ""),
            client_token=os.getenv("CAMPX_CLIENT_TOKEN", LEGACY_CLIENT),
            origins=tuple(
                v.strip()
                for v in os.getenv("ALLOWED_ORIGINS", ",".join(defaults)).split(",")
                if v.strip()
            ),
            cache_seconds=int(os.getenv("CACHE_TTL_SECONDS", "60")),
            session_seconds=int(os.getenv("SESSION_TTL_SECONDS", "7200")),
            max_requests=int(os.getenv("CAMPX_MAX_CONCURRENCY", "16")),
            max_operations=int(os.getenv("MAX_ACTIVE_OPERATIONS", "8")),
            max_sessions=int(os.getenv("MAX_MEMORY_SESSIONS", "1000")),
            firebase_usage=os.getenv("FIREBASE_USAGE_ENABLED", "false").lower()
            == "true",
            firebase_project=os.getenv("FIREBASE_PROJECT_ID", "attendance-90c12"),
            firebase_web=json.loads(os.getenv("FIREBASE_WEB_CONFIG", "{}")),
            vapid_public=os.getenv("FCM_VAPID_PUBLIC_KEY", ""),
            notifications_enabled=os.getenv("NOTIFICATIONS_ENABLED", "false").lower()
            == "true",
            cron_secret=os.getenv("CRON_SECRET", ""),
            notification_batch_size=int(os.getenv("NOTIFICATION_BATCH_SIZE", "2")),
            notification_interval_seconds=int(
                os.getenv("NOTIFICATION_INTERVAL_SECONDS", "900")
            ),
        )
        if not (
            0 <= result.cache_seconds <= 300
            and 60 <= result.session_seconds <= 86400
            and 1 <= result.max_requests <= 64
            and 1 <= result.max_operations <= 64
            and result.max_sessions > 0
        ):
            raise ValueError("Invalid concurrency or session settings")
        if not (
            1 <= result.notification_batch_size <= 12
            and 900 <= result.notification_interval_seconds <= 86400
        ):
            raise ValueError("Invalid notification batch or interval")
        if result.notifications_enabled and (
            not result.supabase_url or len(result.cron_secret) < 32
        ):
            raise ValueError("Notifications require Supabase and a strong CRON_SECRET")
        for origin in result.origins:
            url = urlsplit(origin)
            if (
                not url.hostname
                or url.path
                or url.query
                or url.fragment
                or url.username
                or url.scheme not in {"http", "https"}
            ):
                raise ValueError("ALLOWED_ORIGINS must contain exact HTTP(S) origins")
            if production and url.scheme != "https":
                raise ValueError("Production origins must use HTTPS")
        if bool(result.supabase_url) != bool(result.supabase_key):
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together"
            )
        if result.supabase_url:
            url = urlsplit(result.supabase_url)
            if (
                url.scheme != "https"
                or not url.hostname
                or url.username
                or url.path
                or url.query
                or url.fragment
            ):
                raise ValueError("SUPABASE_URL must be an HTTPS origin")
            if not result.encryption_key:
                raise ValueError(
                    "CAMPX_ENCRYPTION_KEY is required for database sessions"
                )
        if production and not result.supabase_url:
            raise ValueError(
                "Production requires shared Supabase storage; memory storage is development-only"
            )
        return result
