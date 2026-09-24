#!/bin/bash

# Script de configuración inicial del VPS
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

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Ejecuta este script desde el directorio raiz del proyecto${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/6]${NC} Installing system dependencies..."

# Actualizar sistema
sudo apt-get update -y
sudo apt-get upgrade -y

# Instalar dependencias necesarias
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
echo -e "${YELLOW}[2/6]${NC} Installing Node.js 20..."

# Instalar Node.js usando nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node --version
npm --version

echo ""
echo -e "${YELLOW}[3/6]${NC} Setting up application directory..."

# Crear directorio de la aplicación
sudo mkdir -p /var/www/instripe
sudo chown -R $USER:$USER /var/www/instripe

# Clonar repositorio (si no existe)
if [ ! -d "/var/www/instripe/.git" ]; then
    git clone https://github.com/Houmeecl/instripe.git /var/www/instripe
fi

cd /var/www/instripe

# Configurar entorno
echo -e "${YELLOW}[4/6]${NC} Setting up environment..."

# Crear archivo .env si no existe
if [ ! -f ".env" ]; then
    cat > .env << 'EOF'
# Stripe Configuration
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Global66 Configuration
GLOBAL66_API_KEY=
GLOBAL66_MERCHANT_ID=

# Application Configuration
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000
SEED_PASSWORD=Antofagasta.183
CURRENCY=CLP
DATABASE_PATH=/var/www/instripe/data/instripe.db

# Default Gateway
defaultGateway=chile
EOF
    echo "  -> Created .env file. Please edit with your credentials."
fi

# Instalar dependencias
echo -e "${YELLOW}[5/6]${NC} Installing npm dependencies..."
npm install --production

# Build TypeScript
echo -e "${YELLOW}  Building TypeScript...${NC}"
npm run build

# Configurar PM2
echo -e "${YELLOW}[6/6]${NC} Setting up PM2 process manager..."

# Instalar PM2 global
npm install -g pm2

# Crear ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'instripe',
    script: './dist/app.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/instripe-error.log',
    out_file: '/var/log/instripe-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    merge_logs: true
  }]
}
EOF

# Iniciar aplicación con PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Configurar Nginx
echo ""
echo -e "${YELLOW}Setting up Nginx reverse proxy...${NC}"

sudo bash -c 'cat > /etc/nginx/sites-available/instripe << "EOF"
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
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
echo "  1. Edit /var/www/instripe/.env with your credentials"
echo "  2. Configure DNS to point to your VPS IP"
echo "  3. Run: certbot --nginx -d your-domain.com"
echo "  4. Update PUBLIC_BASE_URL in .env to https://your-domain.com"
echo "  5. Restart: pm2 restart instripe"
echo ""
echo "  Access your app at: http://your-domain.com"
echo "  PM2 commands:"
echo "    - pm2 list"
echo "    - pm2 logs instripe"
echo "    - pm2 restart instripe"
echo "==========================================${NC}"
