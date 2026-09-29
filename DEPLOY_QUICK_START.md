# 🚀 Quick Start: Despliegue Automático

Instrucciones rápidas para activar el despliegue automático desde GitHub al VPS.

## Resumen

Cada push a `agents/ok` o `main` dispara automáticamente GitHub Actions que compila, testea y despliega a VPS vía SSH.

## Pasos rápidos (10 min)

### 1️⃣ En VPS (SSH como root)

```bash
useradd -m -s /bin/bash deploy
mkdir -p /var/www/instripe && chown deploy:deploy /var/www/instripe
sudo npm install -g pm2
```

### 2️⃣ Generar SSH Key (tu máquina)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_ed25519 -N ""
```

### 3️⃣ Autorizar clave en VPS (SSH como deploy)

```bash
mkdir -p ~/.ssh && echo "ssh-ed25519 AAAAC3..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

(Reemplaza `AAAAC3...` con el contenido de `~/.ssh/deploy_ed25519.pub`)

### 4️⃣ GitHub Secrets (Web)

En **GitHub → Houmeecl/instripe → Settings → Secrets and variables → Actions**, agrega:

| Secret | Valor |
|--------|-------|
| `VPS_HOST` | IP del VPS |
| `VPS_USERNAME` | `deploy` |
| `VPS_SSH_KEY` | Contenido de `~/.ssh/deploy_ed25519` |
| `VPS_PORT` | `22` |

### 5️⃣ Primer Deploy

```bash
git push origin agents/ok
```

Verifica en **GitHub Actions → Deploy to VPS**.

## Verificación

```bash
# Ver que está corriendo en VPS
curl http://<VPS_IP>:3000/health

# Ver logs
ssh -i ~/.ssh/deploy_ed25519 deploy@<VPS_IP> "pm2 logs instripe"
```

## Documentación completa

- [`docs/DEPLOYMENT_CHECKLIST.md`](./docs/DEPLOYMENT_CHECKLIST.md) — Checklist ejecutable
- [`docs/VPS_DEPLOYMENT_SETUP.md`](./docs/VPS_DEPLOYMENT_SETUP.md) — Guía detallada
- [`README.md`](./README.md) — Sección "Despliegue automático a VPS"

---

**¿Problemas?** Revisa [troubleshooting](./docs/VPS_DEPLOYMENT_SETUP.md#troubleshooting).
