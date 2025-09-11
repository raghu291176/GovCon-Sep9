#!/usr/bin/env bash
set -euo pipefail

# Simple launcher for Azure Web App and local use
# - Installs backend deps if missing
# - Starts the single-process server (serves API + frontend)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[run] Node version: $(node -v || echo 'node not found')"

echo "[run] Ensuring backend dependencies"
pushd "$ROOT_DIR/backend" >/dev/null
if [[ ! -d node_modules ]]; then
  echo "[run] Installing backend deps (npm ci --omit=dev)"
  if ! npm ci --omit=dev --no-audit --no-fund; then
    echo "[run] npm ci failed; falling back to npm install --omit=dev"
    npm install --omit=dev --no-audit --no-fund
  fi
else
  echo "[run] backend/node_modules present; skipping install"
fi

# Ensure better-sqlite3 is available to enable SQLite persistence
if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  echo "[run] Installing optional dependency: better-sqlite3"
  if ! npm install --no-audit --no-fund better-sqlite3@11.0.0 >/dev/null 2>&1; then
    echo "[run] Warning: better-sqlite3 install failed. The app will run in in-memory mode with file-based config persistence."
  fi
fi
popd >/dev/null

export NODE_ENV="${NODE_ENV:-production}"
PORT="${PORT:-3000}"

# Set up a durable SQLite path when possible
if [[ -z "${SQLITE_PATH:-}" ]]; then
  if mkdir -p "/home/data" >/dev/null 2>&1; then
    export SQLITE_PATH="/home/data/govcon.sqlite"
    echo "[run] Using SQLite at $SQLITE_PATH"
  else
    export SQLITE_PATH="$ROOT_DIR/backend/data.sqlite"
    echo "[run] Using SQLite at $SQLITE_PATH"
  fi
fi

echo "[run] Starting app on :$PORT"
exec node "$ROOT_DIR/backend/server.js"
