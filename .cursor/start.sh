#!/usr/bin/env bash
# Arranca el servidor de desarrollo. Si /health ya responde, no abre otro proceso.
set -euo pipefail

root=""
for candidate in . /agent/repos/instripe /workspace/repos/instripe /workspace; do
  if [ -f "$candidate/package.json" ] && grep -q '"name": "instripe"' "$candidate/package.json"; then
    root=$candidate
    break
  fi
done

if [ -z "$root" ]; then
  echo "No se encontró el proyecto instripe" >&2
  exit 1
fi

cd "$root"

if curl -sf --max-time 2 http://127.0.0.1:3000/health >/dev/null; then
  echo "instripe already listening on :3000"
  exit 0
fi

exec npm run dev
