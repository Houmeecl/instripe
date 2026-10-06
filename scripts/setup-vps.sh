#!/bin/bash

# Script de configuración inicial del VPS (se ejecuta EN el VPS, una sola vez)
# Uso: ./scripts/setup-vps.sh

set -e

echo "=========================================="
echo "  VPS Setup for instripe"
echo "=========================================="
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_DIR=${APP_DIR:-"/var/www/instripe"}

echo -e "${YELLOW}[1/6]${NC} Installing system dependencies..."

sudo apt-get update -y
sudo apt-get upgrade -y

sudo apt-get install -y \
    curl \
    git \
    build-essential \
    openssl \
    libssl-dev \
    nginx \
    certbot \
    python3-certbot-nginx

echo ""
echo -e "${YELLOW}[2/6]${NC} Installing Node.js 22..."

# node:sqlite requiere Node >= 22.5
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
node --version
npm --version

echo ""
echo -e "${YELLOW}[3/6]${NC} Setting up application directory..."

sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
    git clone https://github.com/Houmeecl/instripe.git "$APP_DIR"
fi

cd "$APP_DIR"
mkdir -p data logs

echo -e "${YELLOW}[4/6]${NC} Setting up environment..."

# Parte de .env.example. Las credenciales se completan a mano en el VPS.
if [ ! -f ".env" ]; then
    cp .env.example .env
    sed -i "s|^DATABASE_PATH=.*|DATABASE_PATH=$APP_DIR/data/platform.db|" .env
    echo "NODE_ENV=production" >> .env
    echo "  -> Created .env from .env.example. Edit it with your credentials"
    echo "     (AUTH_SEED_PASSWORD, Stripe, etc.) before exposing the app."
fi

echo -e "${YELLOW}[5/6]${NC} Installing npm dependencies and building..."

# tsc es devDependency: instalar todo, compilar y luego podar.
npm ci
npm run build
npm prune --omit=dev

echo -e "${YELLOW}[6/6]${NC} Setting up PM2 process manager..."

npm install -g pm2

# Una sola instancia en modo fork: SQLite no admite varios procesos escritores.
cat > ecosystem.config.cjs << EOF
module.exports = {
  apps: [{
    name: 'instripe',
    script: './dist/index.js',
    cwd: '$APP_DIR',
    instances: 1,
    exec_mode: 'fork',
    node_args: '--env-file=.env',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '$APP_DIR/logs/instripe-error.log',
    out_file: '$APP_DIR/logs/instripe-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    merge_logs: true
  }]
}
EOF

pm2 start ecosystem.config.cjs
pm2 save
# Imprime el comando sudo que registra PM2 al arranque; ejecútalo.
pm2 startup || true

echo ""
echo -e "${YELLOW}Setting up Nginx reverse proxy...${NC}"

sudo bash -c 'cat > /etc/nginx/sites-available/instripe << "EOF"
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF'

sudo ln -sf /etc/nginx/sites-available/instripe /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

echo ""
echo -e "${GREEN}=========================================="
echo "  ✅ VPS Setup completed successfully!"
echo ""
echo "  Next steps:"
echo "  1. Edit $APP_DIR/.env with your credentials"
echo "  2. Run the command printed by 'pm2 startup'"
echo "  3. Configure DNS to point to your VPS IP"
echo "  4. Run: sudo certbot --nginx -d your-domain.com"
echo "  5. Update PUBLIC_BASE_URL in .env to https://your-domain.com"
echo "  6. Restart: pm2 restart instripe --update-env"
echo "==========================================${NC}"
