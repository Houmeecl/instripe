# Despliegue al VPS

Cada push a `main` corre typecheck, lint, pruebas y build en GitHub Actions
(`.github/workflows/deploy.yml`). Si todo pasa, sube el build al VPS por SSH,
reinicia el servicio y revisa `/health`. Si `/health` no responde en 30 s,
vuelve al release anterior y el job falla.

Si la app **ya corre en el VPS**, no hace falta indicar dónde: por defecto el
despliegue busca el proceso `node dist/index.js` que está sirviendo, usa su
carpeta y lo reinicia con su servicio (systemd o pm2). Para eso `VPS_USER` debe
ser el mismo usuario que corre la app, o root. Si la app corre desde
`src/index.ts` (modo desarrollo), el despliegue se detiene y avisa.

El despliegue **no toca** `.env` ni `data/` (la base SQLite). Esos archivos
viven solo en el VPS.

## Preparar el VPS (una vez)

Forma rápida, como root en el VPS (Debian/Ubuntu):

```bash
curl -fsSLO https://raw.githubusercontent.com/Houmeecl/instripe/main/deploy/setup-vps.sh
sudo bash setup-vps.sh <IP pública> <puerto SSH>
```

Hace los pasos de abajo y al final imprime los secretos para GitHub.
Si el repo es privado, copia el archivo con `scp` en vez de `curl`.

Paso a paso:

1. Node 22.13 o superior (la base usa `node:sqlite`).
2. Usuario y carpeta de la app:
   ```bash
   sudo adduser --disabled-password deploy
   sudo mkdir -p /opt/instripe && sudo chown deploy: /opt/instripe
   ```
3. `/opt/instripe/.env` con las variables de `.env.example`
   (`PORT`, `BIND_HOST`, `PUBLIC_BASE_URL`, `AUTH_SEED_PASSWORD`, llaves de Stripe…).
4. Servicio systemd:
   ```bash
   sudo cp deploy/instripe.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable instripe
   ```
5. Permitir que `deploy` reinicie el servicio sin clave
   (`sudo visudo -f /etc/sudoers.d/instripe`):
   ```
   deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart instripe
   ```
6. Llave SSH solo para el despliegue:
   ```bash
   ssh-keygen -t ed25519 -f instripe_deploy -N ""
   # instripe_deploy.pub va en /home/deploy/.ssh/authorized_keys del VPS
   ssh-keyscan -p 22 TU_VPS   # salida para VPS_KNOWN_HOSTS
   ```

Si hoy la app corre desde un `git clone` en otra carpeta o con pm2, apunta
`VPS_APP_DIR` a esa carpeta y `VPS_RESTART_CMD` a tu comando
(por ejemplo `pm2 reload instripe`). El `.env` y `data/` de esa carpeta se conservan.

## Secretos en GitHub

Settings → Environments → `production` → Environment secrets:

| Secreto            | Obligatorio | Default                           |
| ------------------ | ----------- | --------------------------------- |
| `VPS_HOST`         | sí          |                                   |
| `VPS_SSH_KEY`      | sí          | (contenido de `instripe_deploy`)  |
| `VPS_KNOWN_HOSTS`  | recomendado | se toma con `ssh-keyscan`         |
| `VPS_USER`         | no          | `deploy`                          |
| `VPS_PORT`         | no          | `22`                              |
| `VPS_APP_DIR`      | no          | carpeta de la app que ya corre    |
| `VPS_RESTART_CMD`  | no          | su servicio (systemd o pm2)       |

## Ver qué versión corre

```bash
cat /opt/instripe/REVISION   # commit desplegado
```

Para desplegar sin un push nuevo: Actions → "CI y despliegue al VPS" → Run workflow.
