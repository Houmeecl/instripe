#!/usr/bin/env bash
# Prepara el VPS para el despliegue desde GitHub Actions. Correr una vez como root:
#   sudo bash setup-vps.sh <IP pública> [puerto SSH]
# Crea el usuario deploy, /opt/instripe, el servicio systemd y una llave SSH
# solo para el despliegue. Al final imprime los secretos para GitHub.
set -euo pipefail

ip=${1:?Uso: setup-vps.sh <IP pública> [puerto SSH]}
ssh_port=${2:-22}
user=deploy
app_dir=/opt/instripe
key=/root/instripe_deploy

[ "$(id -u)" -eq 0 ] || { echo "Correr como root." >&2; exit 1; }

# Node 22.13+ (la base usa node:sqlite).
if ! command -v node >/dev/null || ! node -e 'require("node:sqlite")' 2>/dev/null; then
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    echo "Instala Node 22.13 o superior y vuelve a correr el script." >&2
    exit 1
  fi
fi
node -e 'require("node:sqlite")' || { echo "Node $(node -v) no trae node:sqlite." >&2; exit 1; }

id "$user" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$user"

mkdir -p "$app_dir/data"
if [ ! -f "$app_dir/.env" ]; then
  seed=$(openssl rand -base64 18)
  cat > "$app_dir/.env" <<ENV
PORT=3000
CURRENCY=clp
DEFAULT_GATEWAY=chile
PUBLIC_BASE_URL=http://$ip:3000
DATABASE_PATH=data/platform.db
AUTH_SEED_PASSWORD=$seed
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
ENV
  echo "Creado $app_dir/.env. Clave inicial del panel: $seed"
fi
chown -R "$user:" "$app_dir"
chmod 600 "$app_dir/.env"

cat > /etc/systemd/system/instripe.service <<UNIT
[Unit]
Description=instripe
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$user
WorkingDirectory=$app_dir
Environment=NODE_ENV=production
ExecStart=$(command -v node) dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable instripe

sudoers=/etc/sudoers.d/instripe
echo "$user ALL=(root) NOPASSWD: $(command -v systemctl) restart instripe" > "$sudoers.tmp"
visudo -cf "$sudoers.tmp" >/dev/null
chmod 440 "$sudoers.tmp"
mv "$sudoers.tmp" "$sudoers"

[ -f "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "github-actions-instripe" -f "$key"
home=$(getent passwd "$user" | cut -d: -f6)
install -d -m 700 -o "$user" -g "$user" "$home/.ssh"
touch "$home/.ssh/authorized_keys"
grep -qF "$(cat "$key.pub")" "$home/.ssh/authorized_keys" || cat "$key.pub" >> "$home/.ssh/authorized_keys"
chown "$user:" "$home/.ssh/authorized_keys"
chmod 600 "$home/.ssh/authorized_keys"

if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  echo "AVISO: algo ya escucha en el puerto 3000:"
  ss -ltnp | grep ':3000 ' || true
fi

# known_hosts usa "ip" en el puerto 22 y "[ip]:puerto" en cualquier otro.
host_entry=$ip
[ "$ssh_port" = 22 ] || host_entry="[$ip]:$ssh_port"
known=$(ssh-keyscan -p "$ssh_port" 127.0.0.1 2>/dev/null | sed "s/^[^ ]*/$host_entry/")
[ -n "$known" ] || { echo "ssh-keyscan no respondió en el puerto $ssh_port." >&2; exit 1; }

cat <<OUT

==== Secretos para GitHub (Settings → Environments → production) ====
VPS_HOST          $ip
VPS_PORT          $ssh_port
VPS_USER          $user
VPS_KNOWN_HOSTS   (las líneas entre las marcas)
---8<---
$known
---8<---
VPS_SSH_KEY       (todo el bloque, incluidas las líneas BEGIN y END)
---8<---
$(cat "$key")
---8<---
Después de copiarla, borra la llave privada del VPS: rm $key
OUT
