#!/usr/bin/env bash
# Boot the instripe dev server. Idempotent: leave an existing healthy server alone.
set -euo pipefail

cd "$(dirname "$0")/.."

if curl -sf --max-time 2 http://127.0.0.1:3000/health >/dev/null; then
  echo "instripe already listening on :3000"
  exit 0
fi

exec npm run dev
