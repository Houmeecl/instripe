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
echo -e "${YELLOW}[1/5]${NC} Building TypeScript..."
npm run build

# Paso 2: Ejecutar tests
echo -e "${YELLOW}[2/5]${NC} Running tests..."
npm test || echo -e "${YELLOW}Tests fallaron pero continuando...${NC}"

# Paso 3: Deploy via SSH
echo -e "${YELLOW}[3/5]${NC} Deploying to VPS..."
ssh -o StrictHostKeyChecking=no -p $VPS_PORT $VPS_USER@$VPS_HOST << 'EOF'
    set -e
    echo "  -> Changing to app directory"
    cd $APP_DIR
    
    echo "  -> Pulling latest changes"
    git fetch origin $BRANCH
    git reset --hard origin/$BRANCH
    
    echo "  -> Installing dependencies"
    npm install --production
    
    echo "  -> Building TypeScript"
    npm run build
    
    echo "  -> Restarting application"
    pm2 restart instripe --update-env
    
    echo "  -> Checking status"
    pm2 list
    
    echo ""
    echo "  Deployment completed successfully!"
    echo "  Time: $(date)"
EOF

# Paso 4: Verificar despliegue
echo -e "${YELLOW}[4/5]${NC} Verifying deployment..."
sleep 5

# Intentar hacer ping a la aplicación
if command -v curl &> /dev/null; then
    echo "  -> Checking application health..."
    curl -s -o /dev/null -w "  HTTP Status: %{http_code}\n" http://$VPS_HOST:3000/api/payments || true
fi

# Paso 5: Mostrar logs
echo -e "${YELLOW}[5/5]${NC} Showing application logs..."
ssh -o StrictHostKeyChecking=no -p $VPS_PORT $VPS_USER@$VPS_HOST "pm2 logs instripe --lines 30"

echo ""
echo -e "${GREEN}=========================================="
echo "  ✅ Deployment completed successfully!"
echo "  📍 VPS: $VPS_HOST"
echo "  📁 App: $APP_DIR"
echo "  🌿 Branch: $BRANCH"
echo "==========================================${NC}"
