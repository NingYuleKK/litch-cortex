#!/bin/sh
set -e

echo "[Cortex] Running database migrations..."
./node_modules/.bin/drizzle-kit migrate

echo "[Cortex] Starting server..."
exec node dist/index.js
