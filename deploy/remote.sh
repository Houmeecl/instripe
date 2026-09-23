#!/usr/bin/env bash
# Corre en el VPS (el workflow lo envía por SSH).
# Uso: remote.sh <app_dir|auto> <release.tgz> <sha> <comando de reinicio|auto>
# Con "auto" usa la instalación que ya está corriendo: su carpeta y su servicio (systemd o pm2).
# No toca .env ni data/: la base y las llaves viven fuera del release.
set -euo pipefail

app_dir=$1
release=$2
sha=$3
restart_cmd=$4
managed=(dist public package.json package-lock.json stripe-app.json .env.example REVISION)

# PID del proceso node que sirve la app. Solo procesos node, no shells que mencionen el archivo.
app_pid() {
  local pid
  for pid in $(pgrep -f 'index\.(js|ts)' || true); do
    [ "$(ps -o comm= -p "$pid" 2>/dev/null)" = node ] || continue
    if ps -o args= -p "$pid" | grep -qE '(^| )(\S*/)?(dist/index\.js|src/index\.ts)( |$)'; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}

old_pid=$(app_pid || true)

if [ "$app_dir" = auto ]; then
  [ -n "$old_pid" ] || { echo "No encontré la app corriendo (node dist/index.js). Define VPS_APP_DIR." >&2; exit 1; }
  entry=$(ps -o args= -p "$old_pid" | grep -oE '(^| )(\S*/)?(dist/index\.js|src/index\.ts)( |$)' | head -n1 | tr -d ' ')
  if [[ "$entry" == /* ]]; then
    app_dir=$(dirname "$(dirname "$entry")")
  else
    cwd=$(readlink "/proc/$old_pid/cwd" 2>/dev/null || true)
    app_dir=${cwd:+$cwd/$(dirname "$(dirname "$entry")")}
    app_dir=${app_dir%/.}
  fi
  [ -n "$app_dir" ] || { echo "No puedo leer la carpeta del proceso $old_pid. Usa el mismo usuario que corre la app o define VPS_APP_DIR." >&2; exit 1; }
  echo "Instalación detectada: $app_dir (PID $old_pid)"
fi

if [ -n "$old_pid" ] && ps -o args= -p "$old_pid" | grep -q 'src/index\.ts'; then
  echo "La app corre desde src/index.ts (modo desarrollo). El release trae dist/: arráncala con 'node dist/index.js'." >&2
  exit 1
fi

if [ "$restart_cmd" = auto ]; then
  [ -n "$old_pid" ] || { echo "No encontré la app corriendo para saber cómo reiniciarla. Define VPS_RESTART_CMD." >&2; exit 1; }
  sudo=""
  [ "$(id -u)" -eq 0 ] || sudo="sudo -n"
  unit=$(ps -o unit= -p "$old_pid" 2>/dev/null | tr -d ' ' || true)
  if [[ "$unit" == *.service && "$unit" != user@* ]]; then
    restart_cmd="$sudo systemctl restart $unit"
  elif command -v pm2 >/dev/null && name=$(pm2 jlist 2>/dev/null | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const app = JSON.parse(s || "[]").find((p) => String(p.pid) === process.argv[1]);
        if (!app) process.exit(1);
        console.log(app.name);
      });' "$old_pid"); then
    restart_cmd="pm2 restart $name"
  else
    echo "La app (PID $old_pid) no es un servicio systemd ni un proceso pm2. Define VPS_RESTART_CMD." >&2
    exit 1
  fi
  echo "Reinicio detectado: $restart_cmd"
fi

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

# Sano = responde /health y, si había un proceso antes, ya no es el mismo (el reinicio ocurrió).
healthy() {
  local url pid
  url=$(health_url)
  for _ in $(seq 1 30); do
    pid=$(app_pid || true)
    if [ -z "$old_pid" ] || { [ -n "$pid" ] && [ "$pid" != "$old_pid" ]; }; then
      curl -fsS -m 3 "$url" >/dev/null 2>&1 && return 0
    fi
    sleep 1
  done
  echo "Sin respuesta nueva en $url" >&2
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
