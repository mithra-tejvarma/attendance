"""Render entry point: uvicorn server:app --host 0.0.0.0 --port $PORT."""

from backend.app import create_app

app = create_app()
