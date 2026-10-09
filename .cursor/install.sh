#!/usr/bin/env bash
# Instala dependencias de instripe aunque el agente arranque en la raíz del workspace.
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
npm ci
