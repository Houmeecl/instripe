# VPS Deployment Setup — Guía de Configuración

Este documento describe cómo configurar el despliegue automático desde GitHub al VPS de producción.

## Requisitos previos

- Acceso al VPS (IP y usuario SSH)
- Acceso al repositorio GitHub como administrador
- Git instalado en el VPS

## Paso 1: Configurar SSH en el VPS

### 1.1 Crear usuario de despliegue (si no existe)

En el VPS como root:

```bash
useradd -m -s /bin/bash deploy
```

### 1.2 Autorizar clave SSH

Generar clave en tu máquina local (Windows):

```powershell
# Si no existe:
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\deploy_ed25519 -N ""

# Ver clave pública:
Get-Content $env:USERPROFILE\.ssh\deploy_ed25519.pub
```

En el VPS, como usuario `deploy`:

```bash
mkdir -p ~/.ssh
# Pegar contenido de deploy_ed25519.pub:
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJvvY..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
```

### 1.3 Verificar acceso SSH

Desde tu máquina local:

```bash
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP>
# Deberías ver el prompt del VPS
exit
```

## Paso 2: Configurar repositorio en VPS

### 2.1 Clonar instripe en el VPS

```bash
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> << 'SETUP'
  cd /var/www
  git clone https://github.com/Houmeecl/instripe.git
  cd instripe
  npm ci
  npm run build
SETUP
```

### 2.2 Configurar .env en VPS

```bash
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> << 'SETUP'
  cd /var/www/instripe
  cp .env.example .env
  # Editar .env con credenciales reales:
  # - AUTH_SEED_PASSWORD
  # - STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET (si aplica)
  # - CHILE_GATEWAY_API_KEY, CHILE_GATEWAY_COMMERCE_CODE (si aplica)
  # - AWS_REGION (para Bedrock, opcional)
  nano .env
SETUP
```

### 2.3 Instalar y arrancar con PM2

```bash
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> << 'SETUP'
  npm install -g pm2
  cd /var/www/instripe
  pm2 start dist/app.js --name instripe --update-env
  pm2 save
  pm2 startup
SETUP
```

Confirma que la app está corriendo:

```bash
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> "pm2 list"
```

## Paso 3: Configurar Secrets en GitHub

En GitHub, ve a **Settings → Secrets and variables → Actions** del repositorio `Houmeecl/instripe`.

Agrega los siguientes secrets:

| Secret          | Valor                                             | Tipo           |
| --------------- | ------------------------------------------------- | -------------- |
| `VPS_HOST`      | IP pública del VPS (ej: `203.0.113.42`)           | String         |
| `VPS_USERNAME`  | `deploy`                                          | String         |
| `VPS_SSH_KEY`   | Contenido completo de `~/.ssh/deploy_ed25519`     | Repository secret |
| `VPS_PORT`      | `22` (o puerto SSH personalizado)                 | String         |

### Pasos en GitHub UI:

1. Abre https://github.com/Houmeecl/instripe
2. **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Para cada secret arriba:
   - **Name**: nombre exacto (ej: `VPS_HOST`)
   - **Secret**: valor correspondiente
   - Click **Add secret**

### Para `VPS_SSH_KEY` (clave privada):

En PowerShell:

```powershell
# Copiar clave privada al portapapeles:
Get-Content $env:USERPROFILE\.ssh\deploy_ed25519 | Set-Clipboard
```

Luego en GitHub:
- **Name**: `VPS_SSH_KEY`
- **Secret**: Pegar el contenido (incluyendo `-----BEGIN OPENSSH PRIVATE KEY-----` y el final)
- **Add secret**

## Paso 4: Verificar workflow

El workflow `.github/workflows/deploy-vps.yml` ya está en el repo. Se activará automáticamente en:

- **Push a `main`**: despliegue a producción
- **Push a `agents/ok`**: despliegue a producción (rama experimental)
- **Pull Request a `main`**: solo build y tests, sin deploy

Para verificar:

1. Ve a **Actions** en GitHub
2. Filtra por workflow **"Deploy to VPS"**
3. Deberías ver runs anteriores (si hay)

### Primer deploy

Para disparar un despliegue:

```bash
# Local
git push origin agents/ok
```

En GitHub Actions:
1. Ve a **Actions** → **Deploy to VPS**
2. Busca el run más reciente
3. Haz click para ver logs detallados

Si hay error de SSH, revisa:
- ¿Está correcta la clave privada en `VPS_SSH_KEY`?
- ¿Tiene el usuario `deploy` en VPS la clave pública configurada?
- ¿Es accesible `VPS_HOST:VPS_PORT`?

## Paso 5: Monitorear despliegues

### Ver logs en tiempo real

```bash
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> "pm2 logs instripe --lines 100"
```

### Ver estado de la app

```bash
curl http://<VPS_IP>:3000/health
```

### Ver historial de despliegues en GitHub

1. **Actions** → **Deploy to VPS**
2. Haz click en un run para ver detalles
3. Expand **"Deploy to VPS via SSH"** para ver output del deploy

## Troubleshooting

| Problema | Causa | Solución |
|----------|-------|----------|
| `Permission denied (publickey)` | Clave SSH no configurada en VPS | Verifica `~/.ssh/authorized_keys` en VPS |
| `Connection refused` | VPS offline o firewall | Verifica IP y puerto SSH, ping al host |
| `npm ERR! 404 Not Found` | Dependencia faltante | Ejecuta `npm ci --production` en VPS |
| `Build failed` | Errores de TypeScript | Revisa logs de GitHub Actions, compila local |
| `pm2 restart instripe: command not found` | PM2 no instalado | Ejecuta `npm install -g pm2` en VPS |
| `Cannot read .env` | .env no tiene permisos | Verifica `chmod 600 .env` en VPS |

## Seguridad

⚠️ **Importantes:**

1. **Clave privada SSH**: Nunca comitees `~/.ssh/deploy_ed25519`. Guárdala segura.
2. **Secrets en GitHub**: Una vez agregados, no se pueden ver de nuevo (solo reemplazar).
3. **.env en VPS**: Contiene credenciales reales. Restringe permisos: `chmod 600 .env`.
4. **Auditoría**: Revisa GitHub Audit Log para accesos a secrets.
5. **Rotación**: Si robas/pierdes la clave SSH, bórrala del VPS y crea una nueva.

## Próximos pasos

1. ✅ Push inicial a `agents/ok` → GitHub Actions despliega automáticamente
2. ✅ Verificar que la app está corriendo: `curl http://VPS_IP:3000/health`
3. ✅ Revisar logs: `pm2 logs instripe --lines 50`
4. Integrar monitoreo (alertas si la app cae)
5. Configurar backup automático de datos (SQLite → PostgreSQL)
6. Cambiar la rama de despliegue de `agents/ok` a `main` una vez que todo sea estable

## Referencia rápida

```bash
# Ver logs del workflow
# → GitHub UI: Actions → Deploy to VPS → Click en run

# Desplegar manualmente (si necesario)
git push origin agents/ok

# Ver estado en VPS
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> "pm2 status"

# Reiniciar app (si necesario)
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> "pm2 restart instripe"

# Ver variables de entorno cargadas
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> "pm2 env instripe"
```
