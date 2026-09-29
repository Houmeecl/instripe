# instripe

Infraestructura de **pagos** para Chile, construida con Node, TypeScript y
Express. Integra **Stripe** y una **pasarela chilena** (estilo Webpay/Khipu/Flow)
tras una misma abstracción, gestiona **wallets y un libro mayor**, y realiza
**cobros y dispersión de fondos**.

Sobre ese núcleo corren tres módulos, y los tres liquidan en pagos:

- **Cuentas**: wallets de clientes, recarga y retiro.
- **Cobros**: un cobro suelto a un pagador.
- **Seguros**: póliza del crédito de una tarjeta. La prima es un cobro y el siniestro es una dispersión.
- **Connect**: cuentas conectadas. Un pago hacia ellas es una dispersión.
- **Treasury**: cuentas financieras. El abono es un cobro. Si la cuenta Stripe no tiene Treasury, queda en demo.
- **Tarjetas**: emisión virtual. El cupo es el crédito que el seguro puede cubrir. El PAN no pasa por este servidor.
- **Diseño**: colores y texto de la tarjeta, aplicados al portal y a Checkout.
- **App**: escribe `stripe-app.json`. Se sube con `stripe apps upload`.

Corre completamente en **modo demo** sin credenciales externas. Si defines las
credenciales, cada pasarela usa su API real automáticamente.

## Arquitectura

- **Pagos** (`src/payments/`): wallet, libro mayor y movimientos (`collect` /
  `disburse`). No conoce pólizas. Un módulo le pasa un `reference` y pagos
  acredita o debita la wallet.
- **Pasarelas** (`src/gateways/`): `PaymentGateway` con `charge` y `payout`.
  Adaptadores: `StripeGateway` y `ChileGateway`.
- **Módulo Cuentas** (`src/modules/cuentas/`): wallets BaaS. Recarga y retiro
  pasan por pagos.
- **Módulo Cobros** (`src/modules/cobros/`): solicitudes de pago a un pagador.
- **Módulo Seguros** (`src/modules/seguros/`): póliza del crédito de una TC.
  La prima es un cobro y el siniestro es una dispersión.
- El portal en `public/` es el **admin** de esos módulos: operación por producto
  y, aparte, el admin técnico del libro.
- **Composición** (`src/platform.ts`): arma pagos y le enchufa los módulos.
- **API + panel** (`src/app.ts`, `public/`): REST y el portal.

## Requisitos

- Node.js >= 20 (desarrollado en Node 22)
- npm

## Puesta en marcha

```bash
cp .env.example .env
# Define AUTH_SEED_PASSWORD con una contraseña temporal única antes de iniciar.
npm ci
npm run dev      # http://localhost:3000
```

## Configuración

Copia `.env.example` a `.env` (opcional). El servidor lo carga al arrancar y no pisa variables que ya vengan del entorno. Todo tiene valores por defecto seguros:

| Variable                      | Default                 | Descripción                                             |
| ----------------------------- | ----------------------- | ------------------------------------------------------- |
| `PORT`                        | `3000`                  | Puerto del servidor HTTP.                               |
| `CURRENCY`                    | `clp`                   | Moneda base (Chile). Soporta monedas sin decimales.     |
| `DEFAULT_GATEWAY`             | `chile`                 | Pasarela por defecto (`chile` o `stripe`).              |
| `STRIPE_SECRET_KEY`           | _(vacío)_               | Si está presente, Stripe usa su API real.               |
| `STRIPE_PUBLISHABLE_KEY`      | _(vacío)_               | `pk_test_…`. Monta Checkout embebido en el portal.      |
| `STRIPE_WEBHOOK_SECRET`       | _(vacío)_               | `whsec_…` de `stripe listen`. Liquida el movimiento al pagar.|
| `CHILE_GATEWAY_API_KEY`       | _(vacío)_               | Credencial de la pasarela chilena (modo live).          |
| `CHILE_GATEWAY_COMMERCE_CODE` | _(vacío)_               | Código de comercio de la pasarela chilena.              |
| `PUBLIC_BASE_URL`             | `http://localhost:3000` | Base para URLs de retorno/redirección.                  |
| `AUTH_SEED_PASSWORD`          | _(requerido)_           | Contraseña temporal única para las cuentas iniciales; se debe rotar al primer acceso. |

## Scripts

| Comando             | Descripción                              |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Servidor de desarrollo con recarga.      |
| `npm run build`     | Compila TypeScript a `dist/`.            |
| `npm start`         | Ejecuta el servidor compilado.           |
| `npm run typecheck` | Verificación de tipos.                   |
| `npm run lint`      | ESLint.                                  |
| `npm test`          | Suite de pruebas (Vitest + Supertest).   |

## API

- `GET /health` — estado, moneda y pasarelas configuradas.
- `GET /api/gateways` — pasarelas disponibles y cuál es la predeterminada.
- `GET /api/plans` — planes de seguro con montos formateados.
- `GET /api/overview` — saldo, cuentas, cobros, pólizas y siniestros.
- `POST /api/policies` — póliza del crédito de una TC: `{ holderName, email, cardLabel, cupo, gateway }`. La prima es el 0,60% del cupo.
  Con Stripe live y llave publicable, la respuesta trae `charge.clientSecret` y la póliza queda en `pending_payment` hasta que el pago se confirma.
- `GET /api/checkout/sessions/:id` — estado de una sesión de Checkout; si está pagada, liquida el movimiento del módulo dueño (idempotente).
- `POST /api/claims` — dispersar siniestro: `{ policyId, amount, beneficiary, gateway }`.
- `POST /webhooks/stripe` — webhook de Stripe con verificación de firma. `checkout.session.completed` acredita el float y avisa al módulo dueño (`cuentas`, `cobros` o `seguros`).
- `GET /api/stripe/events` — últimos eventos de webhook recibidos.

## Stripe (entorno de desarrollo)

El SDK de servidor es `stripe` 22.6.0, el que indica la guía de Node en
[docs.stripe.com/development](https://docs.stripe.com/development). Las llaves
viven en el entorno, nunca en el código.

```bash
npm install -g @stripe/cli@latest
stripe login                              # o: stripe sandbox create --from-git
# copia la secret key a STRIPE_SECRET_KEY y la publishable key a STRIPE_PUBLISHABLE_KEY

# Reenvía los eventos del sandbox al webhook local y copia el whsec_…:
stripe listen --forward-to localhost:3000/webhooks/stripe
stripe trigger checkout.session.completed
```

Con ambas llaves, un cobro por la pasarela `stripe` abre Checkout embebido
(`ui_mode: embedded_page`, Stripe.js `createEmbeddedCheckoutPage`). El movimiento
queda pendiente y el float no se acredita hasta `checkout.session.completed`
(webhook) o hasta que el retorno consulta `GET /api/checkout/sessions/:id` con
`payment_status=paid`. Ambas vías son idempotentes. Sin llave publicable, Stripe
usa Checkout alojado (`hosted_page`).

En producción, mueve las llaves a los Secrets del entorno en lugar de `.env`.
La llave secreta no debe commitearse. Si se pegó en un chat, rótala en el
Dashboard de Stripe.

## Contenedor y ECS

La imagen de producción se construye sin secretos y ejecuta como el usuario
sin privilegios `node`:

```bash
docker build -t instripe:local .
docker run --rm -p 3000:3000 \
  -e AUTH_SEED_PASSWORD='contraseña-temporal-unica' \
  instripe:local
```

En ECS, configure `AUTH_SEED_PASSWORD`, credenciales de pasarelas y correo con
el campo `secrets` de la definición de tarea, apuntando a AWS Secrets Manager;
no los agregue al Dockerfile, la imagen ni variables visibles de CI. La tarea
debe usar `/health` como health check del balanceador.

La persistencia actual usa SQLite local. No despliegue más de una tarea ni use
esta imagen como servicio productivo de ECS hasta migrar el almacenamiento a
PostgreSQL/Aurora y validar la migración de datos; el almacenamiento efímero de
Fargate perdería la base ante un reemplazo de tarea.

### Exportación de SQLite para el corte a PostgreSQL

Antes de cualquier corte, detenga las escrituras en la aplicación del VPS y
realice una copia de seguridad de su archivo SQLite. La herramienta genera un
archivo SQL con el total y checksum de origen; el archivo contiene datos de la
plataforma y está ignorado por Git.

```bash
node scripts/export-sqlite-to-postgres.mjs \
  /ruta/segura/platform.db \
  /ruta/segura/platform.instripe-migration.sql
```

Ejecute el SQL una sola vez contra una base PostgreSQL/Aurora vacía usando una
conexión segura y sin registrar la URL ni contraseña:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f /ruta/segura/platform.instripe-migration.sql
```

El script se niega a sobrescribir un archivo existente y el SQL se revierte si
la tabla destino contiene datos o el conteo importado no coincide. Conserve la
copia SQLite para reversión hasta completar la validación funcional.

La exportación y `PostgresPlatformStore` son preparación de migración, no un
corte ya conectado: la aplicación sigue usando el almacenamiento SQLite
síncrono. Los módulos mantienen además estado en memoria y algunos usan
transacciones síncronas. Hay que adaptar y probar esos flujos antes de conectar
la aplicación a PostgreSQL; no cambie `DATABASE_PATH` por una URL esperando que
la aplicación la use.

### Infraestructura AWS como código

El proyecto CDK en [`infra/`](./infra) define únicamente la base compartida:
VPC de dos zonas, subredes públicas, privadas de aplicación y aisladas para
datos, un NAT Gateway, ECR con análisis de imágenes y etiquetas inmutables,
CloudWatch Logs y un clúster ECS. No define todavía una base de datos, servicio
ni balanceador, para impedir un despliegue accidental de la aplicación mientras
dependa de SQLite.

```bash
cd infra
npm ci
npm run build
npm run synth
```

La primera implementación en `632404568231` / `us-east-1` requerirá primero
revisar el cambio sintetizado, aprobar el costo del NAT Gateway y ejecutar el
bootstrap de CDK. No ejecute `cdk deploy` hasta que la migración PostgreSQL y
el plan de corte estén aprobados.

## Despliegue automático a VPS

El workflow de GitHub Actions (`.github/workflows/deploy-vps.yml`) despliega automáticamente la aplicación al VPS en cada push a las ramas `main` y `agents/ok`:

1. **Build y tests**: Compila TypeScript, ejecuta tests.
2. **SSH a VPS**: Se conecta via SSH con clave privada.
3. **Pull & restart**: Tira los cambios más recientes, reinstala dependencias, compila y reinicia PM2.

### Configuración de Secrets

En **GitHub → Settings → Secrets and variables → Actions**, agregue:

| Secret          | Valor                                  | Descripción                  |
| --------------- | -------------------------------------- | ---------------------------- |
| `VPS_HOST`      | IP pública o dominio del VPS           | Host SSH                     |
| `VPS_USERNAME`  | `deploy` (o el usuario SSH en VPS)     | Usuario SSH                  |
| `VPS_SSH_KEY`   | Contenido de `~/.ssh/id_ed25519` (privada) | Clave SSH privada        |
| `VPS_PORT`      | `22` (o puerto SSH personalizado)      | Puerto SSH (opcional)        |

### Generar clave SSH

En la máquina local (Windows):

```powershell
# Si no existe:
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519 -N ""

# Ver contenido (privada):
Get-Content $env:USERPROFILE\.ssh\id_ed25519
```

En el VPS, agregue la clave pública a `~/.ssh/authorized_keys`:

```bash
echo "ssh-ed25519 AAAAC3N... (contenido de id_ed25519.pub)" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Ramas y triggers

- **`main`**: Branch de producción. Push a `main` despliega a VPS en producción.
- **`agents/ok`**: Branch experimental con agentes (Copilot). Push a `agents/ok` también despliega automáticamente.

Esto permite probar cambios en `agents/ok` sin afectar `main`, pero ambos desplazan a la misma instancia VPS. Para ambientes separados (staging/prod), cree otra rama o un segundo VPS.

## Operations Advisor (Bedrock)

Un nuevo módulo experimental integra AWS Bedrock Converse para proporcionar análisis operacional en lenguaje natural:

- **Consultas sin ejecución**: Usuarios con rol `operacion` hacen preguntas.
- **Análisis con Bedrock**: Claude Sonnet genera propuestas (no vinculantes).
- **Auditoría**: Cada consulta y propuesta queda registrada.

### Configuración en VPS/ECS

Agregue variables de entorno:

```bash
export AWS_REGION=us-east-1
export BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6  # opcional
```

Sin `AWS_REGION`, el módulo funciona en modo local (almacena consultas pero no invoca Bedrock).

### Permisos IAM

El rol de ejecución de la tarea ECS necesita:

```json
{
  "Effect": "Allow",
  "Action": "bedrock:InvokeModel",
  "Resource": "arn:aws:bedrock:us-east-1::foundation-model/us.anthropic.claude-sonnet-4-6"
}
```

Consulte [`docs/BEDROCK_IAM.md`](./docs/BEDROCK_IAM.md) para detalles.

### Endpoints

- `POST /api/advisor/query` — crear consulta (operacion)
- `GET /api/advisor/queries` — listar consultas (operacion)
- `GET /api/advisor/proposals` — listar propuestas (operacion, administrador_empresa)
- `POST /api/advisor/proposals/:id/review` — revisar propuesta (operacion, administrador_empresa)

Consulte [`docs/OPERATIONS_ADVISOR.md`](./docs/OPERATIONS_ADVISOR.md) para endpoints completos y ejemplo de flujo.

## Producción / próximos pasos

- Integración real: SDK de Transbank (Webpay Plus), Khipu o Flow para Chile, y
  Stripe Connect para dispersión de fondos multi-cuenta.
- Persistencia: migrar la base SQLite local a PostgreSQL/Aurora antes de
  desplegar más de una tarea ECS.
- Estas integraciones requieren credenciales y cuentas (se configuran como
  secretos del entorno).
