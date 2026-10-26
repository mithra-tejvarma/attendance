"""Development launcher; production must supply its own server environment."""

import os
import sys

from .runtime_env import load_development_env

if __name__ == "__main__":
    load_development_env()
    os.execv(
        sys.executable,
        [
            sys.executable,
            "-B",
            "-m",
            "uvicorn",
            "server:app",
            "--host",
            os.getenv("HOST", "127.0.0.1"),
            "--port",
            os.getenv("PORT", "8001"),
        ],
    )
