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
npm install
npm run dev      # http://localhost:3000
```

## Despliegue

Cada push a `main` se prueba y se sube al VPS. Ver [`deploy/README.md`](deploy/README.md).

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

## Producción / próximos pasos

- Integración real: SDK de Transbank (Webpay Plus), Khipu o Flow para Chile, y
  Stripe Connect para dispersión de fondos multi-cuenta.
- Persistencia: reemplazar el libro mayor en memoria por Postgres.
- Estas integraciones requieren credenciales y cuentas (se configuran como
  secretos del entorno).
