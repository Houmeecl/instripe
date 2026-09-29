# Checklist: Despliegue Automático VPS + GitHub Actions

Sigue estos pasos en orden para activar el despliegue automático desde GitHub al VPS.

## ✅ Fase 1: Preparación VPS (Ejecutar en VPS como root)

- [ ] Crear usuario `deploy`:
  ```bash
  useradd -m -s /bin/bash deploy
  ```

- [ ] Crear directorio de app:
  ```bash
  mkdir -p /var/www/instripe
  chown -R deploy:deploy /var/www/instripe
  ```

- [ ] Instalar Node.js 20+ (si no existe):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  apt-get install -y nodejs
  ```

- [ ] Instalar PM2 globalmente:
  ```bash
  sudo npm install -g pm2
  ```

## ✅ Fase 2: SSH Key Setup (Ejecutar en tu máquina local - PowerShell/Bash)

- [ ] Generar clave SSH si no existe:
  ```powershell
  ssh-keygen -t ed25519 -f ~/.ssh/deploy_ed25519 -N ""
  ```

- [ ] Obtener clave pública:
  ```powershell
  Get-Content ~/.ssh/deploy_ed25519.pub
  ```

- [ ] En VPS (como usuario `deploy`):
  ```bash
  mkdir -p ~/.ssh
  echo "ssh-ed25519 AAAAC3NzaC1..." >> ~/.ssh/authorized_keys  # Pegar contenido
  chmod 600 ~/.ssh/authorized_keys
  chmod 700 ~/.ssh
  ```

- [ ] Verificar acceso SSH (desde local):
  ```bash
  ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP>
  # Deberías ver el prompt del VPS
  exit
  ```

## ✅ Fase 3: Inicializar Repositorio en VPS

- [ ] Clonar repo (como usuario `deploy`):
  ```bash
  cd /var/www/instripe
  git clone https://github.com/Houmeecl/instripe.git .
  ```

- [ ] Instalar dependencias:
  ```bash
  npm ci
  ```

- [ ] Copiar archivo .env:
  ```bash
  cp .env.example .env
  nano .env  # Editar con credenciales reales
  ```

- [ ] Compilar TypeScript:
  ```bash
  npm run build
  ```

- [ ] Iniciar con PM2:
  ```bash
  pm2 start dist/app.js --name instripe --update-env
  pm2 save
  pm2 startup
  ```

- [ ] Verificar que está corriendo:
  ```bash
  pm2 list
  curl http://localhost:3000/health
  ```

## ✅ Fase 4: Configurar GitHub Secrets

En **GitHub → Houmeecl/instripe → Settings → Secrets and variables → Actions**:

- [ ] Agregar secret `VPS_HOST`:
  - **Name**: `VPS_HOST`
  - **Value**: `<IP_PUBLICA_VPS>` (ej: `203.0.113.42`)

- [ ] Agregar secret `VPS_USERNAME`:
  - **Name**: `VPS_USERNAME`
  - **Value**: `deploy`

- [ ] Agregar secret `VPS_SSH_KEY`:
  - **Name**: `VPS_SSH_KEY`
  - **Value**: Contenido completo de `~/.ssh/deploy_ed25519` (copiar todo incluyendo encabezado/pie)

- [ ] Agregar secret `VPS_PORT` (opcional, default 22):
  - **Name**: `VPS_PORT`
  - **Value**: `22` (o puerto personalizado)

## ✅ Fase 5: Verificar Workflow

- [ ] En GitHub, ve a **Actions**
- [ ] Verifica que existe el workflow **"Deploy to VPS"**
- [ ] Revisa el archivo: `.github/workflows/deploy-vps.yml`
  - Debe contener `branches: [main, agents/ok]` en la sección `on:`

## ✅ Fase 6: Primer Deploy

- [ ] Realiza un cambio trivial (ej: comentario en README)
- [ ] Commitea y pushea a `agents/ok`:
  ```bash
  git add -A
  git commit -m "test: trigger deploy workflow"
  git push origin agents/ok
  ```

- [ ] En GitHub **Actions**, ve a **Deploy to VPS** y haz click en el run más reciente
- [ ] Expande **"Deploy to VPS via SSH"** para ver logs
- [ ] Si tiene éxito ✅:
  ```bash
  curl http://<VPS_IP>:3000/health
  # Deberías ver respuesta JSON con estado
  ```

## ✅ Fase 7: Validación Post-Deploy

- [ ] Conectar a VPS y verificar:
  ```bash
  ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP>
  pm2 list
  pm2 logs instripe --lines 30
  ```

- [ ] Verificar la app responde:
  ```bash
  curl http://<VPS_IP>:3000/api/gateways
  ```

- [ ] Revisar que .env se cargó correctamente:
  ```bash
  pm2 env instripe | grep CURRENCY
  ```

## 🎯 Triggers de Deploy

El workflow se dispara automáticamente en:

| Rama | Evento | Deploy |
|------|--------|--------|
| `main` | Push | ✅ Sí (producción) |
| `agents/ok` | Push | ✅ Sí (experimental) |
| Cualquier rama | Pull Request a `main` | ❌ No (solo tests) |

## 🔄 Despliegues futuros

Desde ahora, cada vez que hagas push a `agents/ok` o `main`:

1. GitHub Actions automáticamente:
   - Clona el código
   - Compila TypeScript
   - Ejecuta tests
   - (Si éxito) Se conecta a VPS via SSH
   - Tira los cambios más recientes
   - Reinstala dependencias
   - Compila nuevamente
   - Reinicia PM2

2. Puedes ver el progreso en **GitHub Actions → Deploy to VPS**

## ⚠️ Seguridad

- **Clave privada**: Nunca comitees `deploy_ed25519`. Guárdala segura.
- **Secrets**: No se pueden ver después de creados (solo reemplazar).
- **.env en VPS**: Contiene credenciales. Permisos restrictivos: `chmod 600 .env`.
- **Auditoría**: Revisa **GitHub → Settings → Audit log** para cambios.

## 📞 Troubleshooting

| Error | Verificar |
|-------|-----------|
| `Permission denied (publickey)` | ¿Clave SSH en `~/.ssh/authorized_keys` del VPS? |
| `Connection refused` | ¿VPS online? ¿Firewall permite puerto SSH? |
| `npm ERR! 404` | ¿Dependencias en `package.json` válidas? |
| Build falla | Revisa logs en GitHub Actions → Click en run |
| App no arranca | `pm2 logs instripe` en VPS para ver errores |

## 📚 Documentación completa

- [`docs/VPS_DEPLOYMENT_SETUP.md`](./VPS_DEPLOYMENT_SETUP.md) — Guía detallada
- [`docs/OPERATIONS_ADVISOR.md`](./OPERATIONS_ADVISOR.md) — Módulo Bedrock
- [`docs/BEDROCK_IAM.md`](./BEDROCK_IAM.md) — Permisos IAM para Bedrock

---

✅ **Estado**: Una vez completes la Fase 6, el despliegue automático está activado.

**Próximo paso**: Continúa con la migración a AWS ECS/Fargate, pero el VPS seguirá como respaldo.
