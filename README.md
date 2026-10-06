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
- **Tarjetas**: la emisión de tarjetas reales depende de Stripe Issuing. Las fichas de débito de Empresas son solo vistas informativas y no representan tarjetas emitidas.
- **Empresas**: registra titulares y trabajadores, genera portales y borradores informativos de contrato; no emite tarjetas ni abre cuentas.
- **Diseño**: colores y texto de la tarjeta, aplicados al portal y a Checkout.
- **App**: escribe `stripe-app.json` para subirlo con `stripe apps upload`; no genera una app móvil ni una integración NFC. Stripe Terminal Tap to Pay no está disponible para Chile según la [disponibilidad de lectores](https://docs.stripe.com/terminal/tap-to-pay-readers).

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

- Node.js >= 22.5 (`node:sqlite` requiere Node 22.5 o posterior)
- npm

## Puesta en marcha

```bash
npm install
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
| `GLOBAL66_CREDENTIALS_ENCRYPTION_KEY` | _(vacío)_        | Clave aleatoria para cifrar en SQLite los clientSecret Global66 por empresa. |
| `PUBLIC_BASE_URL`             | `http://localhost:3000` | Base para URLs de retorno/redirección.                  |
| `PUBLIC_CONTACT_EMAIL`        | `patrocinios@proveedorregional.cl` | Destinatario público para patrocinio y alianzas. |

El formulario público de Alianzas envía nombre, correo de respuesta, organización
opcional, motivo y mensaje a `PUBLIC_CONTACT_EMAIL`. No guarda las consultas en
la base de datos. Para enviar desde el servidor configura `MAIL_HOST`, `MAIL_USER`
y `MAIL_PASSWORD` para SMTP (TLS en producción); crea el buzón o alias de
`PUBLIC_CONTACT_EMAIL` en Mailcow. Si SMTP no está configurado, el formulario
explica que el envío no está disponible y mantiene el enlace directo al correo.
Se limita el número de envíos por dirección IP y se valida el consentimiento.

Aceptar los términos en el onboarding registra la aceptación, pero no crea un
usuario ni inicia una sesión. El dashboard siempre requiere correo y clave.
El listado de preinscritos (`GET /api/registro`) requiere una sesión con acceso
de Operación; la página pública de términos no revela sus datos ni saldos.

### Administración de buzones Mailcow

El rol **Operación** puede crear y listar buzones desde el módulo **Correo**.
Configura `MAILCOW_API_URL` con el origen HTTPS de Mailcow,
`MAILCOW_API_KEY` con una clave API habilitada para la IP de egreso del VPS, y
`MAILCOW_DOMAIN` con el dominio que administrará (por defecto
`proveedorregional.cl`). La clave queda solo en el entorno del servidor y no se
envía al navegador. Guárdala en el `.env`/gestor de secretos del servidor y
reinicia la aplicación. En Mailcow, habilita la API y registra la IP pública de
salida del VPS en la lista permitida. La especificación oficial está en
[`openapi.yaml`](https://github.com/mailcow/mailcow-dockerized/blob/master/data/web/api/openapi.yaml).

Desde el panel se puede crear un buzón con nombre, clave inicial y cuota de
hasta 10 GB, y consultar los buzones de ese dominio. La aplicación no guarda
las claves de los buzones y no ofrece acciones de borrado.

### Portales privados de empresa

Al crear una empresa se genera y persiste su enlace privado. Operación los
administra desde el módulo **Portales**; el panel **Débito** conserva las
herramientas operativas de empresas. Los portales requieren iniciar sesión y
solo muestran los datos de las empresas a las que el usuario tiene acceso.

### Wallets B2B de Global66

Cada empresa puede conectar su credencial de Global66 Empresas desde su portal.
La credencial identifica una organización de Global66; el `accountId` debe
pertenecer a esa misma organización. El servidor cifra `clientSecret` usando
`GLOBAL66_CREDENTIALS_ENCRYPTION_KEY`; este valor es obligatorio para guardar
credenciales y debe respaldarse junto con la base de datos. No lo cambies después
de guardar credenciales sin migrarlas, porque no podrán descifrarse.

En Global66 Empresas, crea la credencial desde **Integraciones API** y registra
la IP IPv4 pública de egreso del VPS. El portal consulta saldo y movimientos
directamente desde la API B2B y no inventa un saldo si no hay movimientos. La
carga a tarjetas Global66 y la tarifa mensual de 0,07 UF no se activan hasta que
Global66 confirme el endpoint doméstico y la aplicación del convenio B2B.

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

- `GET /api/clases` — cursos, videos enlazados, tareas, foro y entregas visibles para el rol y la empresa de la sesión.
- `POST /api/pilot/plan` — solo Operación; genera un plan y checklist no ejecutables con Databricks y no persiste los datos enviados. Requiere `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID` y `DATABRICKS_CLIENT_SECRET`.
- `POST /api/clases/usuarios` — solo Operación; crea usuarios de Cursos (`alumno` o `evaluador`) con empresa asignada y clave inicial que deberán cambiar.
- `POST /api/clases/:id/alumnos` — matrícula en un curso; los alumnos solo pueden inscribirse a sí mismos.
- `POST /api/clases/:id/videos` — evaluador agrega un enlace HTTPS de video al curso de su empresa (no se suben archivos).
- `POST /api/clases/:id/tareas` — evaluador publica instrucciones y fecha opcional de entrega.
- `POST /api/clases/tareas/:id/entregas` — un alumno inscrito entrega su respuesta.
- `POST /api/clases/entregas/:id/evaluacion` — evaluador de la misma empresa aprueba o reprueba con comentarios. Operación puede apoyar la evaluación.
- `POST /api/clases/:id/foro` — alumnos inscritos y evaluadores publican en el foro o responden una publicación con `parentId`.
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
- `PUT /api/empresas/:id/global66` — guarda el clientId, clientSecret y accountId de la wallet de esa empresa. El clientSecret se cifra en el servidor y nunca se devuelve.
- `GET /api/empresas/:id/global66` — consulta en Global66 los movimientos y el último saldo disponible en esos movimientos. Solo operación y el comercio de esa empresa pueden usarlo.
- `POST /api/empresas/:id/global66/transferencias` — envía una transferencia bancaria nacional CLP→CLP a un beneficiario. Requiere `workerId`, `idempotencyKey`, `amount`, nombre/apellido, tipo/número de cuenta, tipo/número de documento y `purposeCode`.
- `POST /api/empresas/:id/abono` y `POST /api/empresas/:id/transferencias` — retirados (HTTP 410). Las cuentas y movimientos internos de demo de Empresas ya no se ofrecen; los datos antiguos se eliminan al iniciar la plataforma. Para transferencias bancarias usa la ruta de Global66.
- `DELETE /api/empresas/:id` — solo Operación; requiere `{ "confirmation": "<nombre exacto de empresa>" }`. Elimina permanentemente los registros locales vinculados a la empresa, sus trabajadores, accesos empresariales y movimientos. También elimina el acceso del titular si solo estaba asociado a esa empresa; conserva cuentas preexistentes que sigan vinculadas a otra empresa. Rechaza la operación si quedan transferencias Global66 sin resolver. No elimina datos que permanezcan en Stripe, Global66 u otros sistemas externos; revisa además las obligaciones legales de conservación aplicables antes de usarlo.

En el LMS de **Cursos**, Operación provisiona cuentas de alumno y evaluador asociadas
a una empresa. El evaluador de esa empresa publica tareas y enlaces HTTPS de video,
participa en foros y revisa entregas; el alumno se matricula, conversa en foros y
entrega respuestas para aprobación o reprobación con comentarios. Cursos, foros,
recursos y entregas se aíslan por empresa. Los videos se alojan fuera del sistema;
el LMS solo almacena sus enlaces. La contraseña inicial se guarda con hash y se
exige cambiarla al primer ingreso.

El portal privado de cada empresa ofrece un acceso externo a Moodle
(`https://vps-6165621-x.dattaweb.com/login/index.php`). Moodle mantiene su propio
inicio de sesión; este enlace no sincroniza usuarios ni habilita SSO.

El planificador **Plan piloto IA** usa Databricks Unity Gateway y el Model Service
`databricks-gpt-6-luna`. Para habilitarlo, crea un service principal OAuth M2M de
Databricks, concédele acceso de consulta al modelo `system.ai.gpt-6-luna`, y configura
`DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID` y `DATABRICKS_CLIENT_SECRET` solo en el
entorno del servidor. El token OAuth solicita únicamente el alcance
`model-serving-inference`. No uses ni compartas credenciales personales. La función no
crea empresas, cuentas, cursos ni transacciones; envía únicamente el formulario del
piloto a Databricks, limita cada usuario de Operación a una generación por minuto y
no guarda el resultado en la base de datos. Evita ingresar datos personales,
credenciales, números de tarjeta o datos bancarios. El modelo se cobra según el uso
y el precio del workspace; verifica las tarifas de Databricks antes de habilitarlo.

La transferencia usa el contrato B2B `REMITTANCE` / `WIRE_TRANSFER` / `BANK_TRANSFER`
con origen y destino CLP. El API acepta la operación inicialmente como
`PROCESSING`; el portal marca el pago como final solo
cuando un movimiento de Global66 coincide con el transactionId. Reutiliza la misma
clave idempotente si necesitas reconocer un resultado incierto; no generes otra
referencia sin reconciliarlo con Global66. Los datos bancarios no se persisten.
Valida con Global66 el código de propósito permitido para tu convenio antes de
usar fondos reales; la interfaz muestra el código de ejemplo `1`.

Las tarjetas mostradas en el portal son vistas internas con los últimos cuatro
dígitos; no representan tarjetas emitidas por Global66. La API privada de emisión
de tarjetas y el cargo de mantenimiento de 0,07 UF quedan deshabilitados hasta
confirmar su disponibilidad y condiciones para el convenio B2B. El 2% del
tarifario enviado es por conversión de moneda, no una comisión de transferencia
nacional CLP→CLP.

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

## Despliegue en VPS

1. **Instalación inicial (una vez, en el VPS):** clona el repo y ejecuta
   `./scripts/setup-vps.sh`. Instala Node 22 (nvm), PM2 en una sola instancia
   (SQLite no admite varios procesos escritores) y Nginx. Luego completa
   `/var/www/instripe/.env` y ejecuta el comando que imprime `pm2 startup`.
2. **Conexión desde GitHub:** en *Settings → Secrets and variables → Actions*
   define `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY` (clave privada cuya pública
   está en `~/.ssh/authorized_keys` del VPS) y, si no es 22, `VPS_PORT`.
3. **Desplegar:** *Actions → Deploy to VPS → Run workflow*. Compila, prueba,
   entra por SSH, actualiza a `origin/main`, reinicia PM2 y verifica `/health`
   (usa `BIND_HOST`/`PORT` del `.env` del servidor).

Alternativa manual desde tu equipo: `VPS_HOST=… VPS_USER=… ./scripts/deploy-vps.sh`.

## Producción / próximos pasos

- Integración real: SDK de Transbank (Webpay Plus), Khipu o Flow para Chile, y
  Stripe Connect para dispersión de fondos multi-cuenta.
- Persistencia: reemplazar el libro mayor en memoria por Postgres.
- Estas integraciones requieren credenciales y cuentas (se configuran como
  secretos del entorno).
