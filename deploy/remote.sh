#!/usr/bin/env bash
# Corre en el VPS (el workflow lo envía por SSH).
# Uso: remote.sh <app_dir> <release.tgz> <sha> <comando de reinicio>
# No toca .env ni data/: la base y las llaves viven fuera del release.
set -euo pipefail

app_dir=$1
release=$2
sha=$3
restart_cmd=$4
managed=(dist public package.json package-lock.json stripe-app.json .env.example REVISION)

cd "$app_dir"

node -e 'require("node:sqlite")' 2>/dev/null || {
  echo "Node $(node -v) no trae node:sqlite. Instala Node 22.13 o superior." >&2
  exit 1
}

health_url() {
  local port=3000 host=127.0.0.1 line
  if [ -f .env ]; then
    line=$(grep -E '^PORT=' .env | tail -n1 || true)
    [ -n "$line" ] && port=${line#PORT=}
    line=$(grep -E '^BIND_HOST=' .env | tail -n1 || true)
    [ -n "$line" ] && host=${line#BIND_HOST=}
  fi
  [ "$host" = "0.0.0.0" ] && host=127.0.0.1
  echo "http://$host:$port/health"
}

healthy() {
  local url
  url=$(health_url)
  for _ in $(seq 1 30); do
    curl -fsS -m 3 "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "Sin respuesta en $url" >&2
  return 1
}

activate() {
  npm ci --omit=dev --no-audit --no-fund
  eval "$restart_cmd"
}

# Se descomprime aparte; la versión en uso no se toca hasta que el paquete esté completo.
staging=.release-new
rm -rf "$staging"
mkdir "$staging"
tar -xzf "$release" -C "$staging"
[ -f "$staging/dist/index.js" ] || { echo "El paquete no trae dist/index.js." >&2; exit 1; }
echo "$sha" > "$staging/REVISION"

existing=()
for f in "${managed[@]}"; do [ -e "$f" ] && existing+=("$f"); done
if [ ${#existing[@]} -gt 0 ]; then
  tar -czf .release-prev.tgz "${existing[@]}"
fi

rm -rf dist public
cp -a "$staging"/. .
rm -rf "$staging" "$release"

activate
if healthy; then
  echo "Desplegado $sha"
  exit 0
fi

echo "El release $sha no respondió. Volviendo al anterior." >&2
if [ -f .release-prev.tgz ]; then
  rm -rf dist public
  tar -xzf .release-prev.tgz
  activate
  healthy || echo "El release anterior tampoco responde." >&2
fi
exit 1
