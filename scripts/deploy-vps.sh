#!/bin/bash

# Script de despliegue para VPS
# Uso: ./scripts/deploy-vps.sh

set -e

echo "=========================================="
echo "  Deploying instripe to VPS"
echo "=========================================="
echo ""

# Colores para salida
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuración (puede ser sobrescrita por variables de entorno)
VPS_HOST=${VPS_HOST:-"your-vps-ip"}
VPS_USER=${VPS_USER:-"deploy"}
VPS_PORT=${VPS_PORT:-"22"}
APP_DIR=${APP_DIR:-"/var/www/instripe"}
BRANCH=${BRANCH:-"main"}

# Validar que tenemos las variables necesarias
if [ -z "$VPS_HOST" ] || [ "$VPS_HOST" = "your-vps-ip" ]; then
    echo -e "${RED}Error: VPS_HOST no está configurado${NC}"
    echo "Configura VPS_HOST en .env o como variable de entorno"
    exit 1
fi

# Validar SSH key
if [ ! -f "$HOME/.ssh/id_rsa" ] && [ ! -f "$HOME/.ssh/id_ed25519" ]; then
    echo -e "${YELLOW}Advertencia: No se encontró clave SSH en ~/.ssh/${NC}"
    echo "El script intentará usar el agente SSH"
fi

# Paso 1: Build local
echo -e "${YELLOW}[1/4]${NC} Building TypeScript..."
npm run build

# Paso 2: Ejecutar tests (si fallan, no se despliega)
echo -e "${YELLOW}[2/4]${NC} Running tests..."
npm test

# Paso 3: Deploy via SSH. Las variables se pasan al shell remoto.
echo -e "${YELLOW}[3/4]${NC} Deploying to VPS..."
ssh -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" \
    "APP_DIR='$APP_DIR' BRANCH='$BRANCH' bash -s" << 'EOF'
    set -e
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

    echo "  -> Changing to app directory"
    cd "$APP_DIR"

    echo "  -> Pulling latest changes"
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"

    echo "  -> Installing dependencies and building"
    npm ci
    npm run build
    npm prune --omit=dev

    echo "  -> Restarting application"
    pm2 restart instripe --update-env

    echo "  -> Checking health"
    HOST=$(grep -E '^BIND_HOST=' .env 2>/dev/null | cut -d= -f2)
    case "$HOST" in ""|0.0.0.0) HOST=127.0.0.1 ;; esac
    PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
    for attempt in $(seq 1 10); do
        if curl --fail --silent "http://$HOST:${PORT:-3000}/health" >/dev/null; then
            echo "  Deployment healthy at $(date)"
            exit 0
        fi
        sleep 3
    done
    echo "  Health check failed" >&2
    pm2 logs instripe --lines 30 --nostream
    exit 1
EOF

# Paso 4: Estado
echo -e "${YELLOW}[4/4]${NC} PM2 status..."
ssh -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" \
    'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; pm2 list'

echo ""
echo -e "${GREEN}=========================================="
echo "  ✅ Deployment completed successfully!"
echo "  📍 VPS: $VPS_HOST"
echo "  📁 App: $APP_DIR"
echo "  🌿 Branch: $BRANCH"
echo "==========================================${NC}"
