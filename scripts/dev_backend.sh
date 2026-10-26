#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec "${BACKEND_PYTHON:-/workspace/.attendance-venv/bin/python}" -B -m scripts.dev_backend
