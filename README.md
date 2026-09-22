# instripe

Infraestructura de pagos **BaaS + Insurtech** para Chile, construida con Node,
TypeScript y Express. Integra **Stripe** y una **pasarela chilena**
(estilo Webpay/Khipu/Flow) tras una misma abstracción, gestiona **wallets y un
libro mayor (BaaS)**, y realiza **dispersión de fondos** (payouts de siniestros).

Corre completamente en **modo demo** sin credenciales externas. Si defines las
credenciales, cada pasarela usa su API real automáticamente.

## Arquitectura

- **Pasarelas de pago** (`src/gateways/`): interfaz `PaymentGateway` con
  `charge` (cobro) y `payout` (dispersión). Adaptadores: `StripeGateway` y
  `ChileGateway`, seleccionables en tiempo de ejecución.
- **BaaS / libro mayor** (`src/domain/ledger.ts`): cuentas con saldo (wallet) y
  asientos credit/debit. Un *float asegurador* concentra las primas.
- **Insurtech** (`src/domain/insurance.ts`): planes, pólizas y siniestros.
- **Plataforma** (`src/platform.ts`): orquesta cobro de prima → acredita float →
  dispersa siniestro al beneficiario.
- **API + panel** (`src/app.ts`, `public/`): REST y un dashboard.

## Requisitos

- Node.js >= 20 (desarrollado en Node 22)
- npm

## Puesta en marcha

```bash
npm install
npm run dev      # http://localhost:3000
```

## Configuración

Copia `.env.example` a `.env` (opcional). Todo tiene valores por defecto seguros:

| Variable                      | Default                 | Descripción                                             |
| ----------------------------- | ----------------------- | ------------------------------------------------------- |
| `PORT`                        | `3000`                  | Puerto del servidor HTTP.                               |
| `CURRENCY`                    | `clp`                   | Moneda base (Chile). Soporta monedas sin decimales.     |
| `DEFAULT_GATEWAY`             | `chile`                 | Pasarela por defecto (`chile` o `stripe`).              |
| `STRIPE_SECRET_KEY`           | _(vacío)_               | Si está presente, Stripe usa su API real.               |
| `STRIPE_PUBLISHABLE_KEY`      | _(vacío)_               | `pk_test_…`. Monta Checkout embebido en el portal.      |
| `STRIPE_WEBHOOK_SECRET`       | _(vacío)_               | `whsec_…` de `stripe listen`. Activa la póliza al pagar.|
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
- `GET /api/overview` — saldo del float, pólizas y siniestros.
- `POST /api/policies` — contratar póliza (cobra prima): `{ planId, holderName, email, gateway }`.
  Con Stripe live y llave publicable, la respuesta trae `charge.clientSecret` y la póliza queda en `pending_payment` hasta que el pago se confirma.
- `GET /api/checkout/sessions/:id` — estado de una sesión de Checkout; si está pagada, activa la póliza (idempotente).
- `POST /api/claims` — dispersar siniestro: `{ policyId, amount, beneficiary, gateway }`.
- `POST /webhooks/stripe` — webhook de Stripe con verificación de firma. `checkout.session.completed` acredita el float y activa la póliza.
- `GET /api/stripe/events` — últimos eventos de webhook recibidos.

## Stripe (modo live con sandbox de prueba)

Puedes obtener llaves de prueba sin registrar cuenta (ver `https://docs.stripe.com/get-started`):

```bash
npm i -g @stripe/cli
stripe sandbox create --from-git          # crea sandbox y guarda llaves de test
# copia secret_key a STRIPE_SECRET_KEY en .env

# Reenvía webhooks a la app y copia el whsec_... a STRIPE_WEBHOOK_SECRET:
stripe listen --forward-to localhost:3000/webhooks/stripe
stripe trigger checkout.session.completed # dispara un evento de prueba
```

Con `STRIPE_SECRET_KEY` y `STRIPE_PUBLISHABLE_KEY`, contratar una póliza vía la
pasarela `stripe` abre **Checkout embebido** en el portal (Stripe.js). La póliza
queda en `pending_payment` y el float no se acredita hasta
`checkout.session.completed` (webhook) o hasta que el retorno consulta
`GET /api/checkout/sessions/:id` con `payment_status=paid`. Ambas vías son
idempotentes. Sin llave publicable, Stripe usa Checkout alojado (redirect).

En producción, mueve las llaves a los Secrets del entorno en lugar de `.env`.
La llave secreta no debe commitearse. Si se pegó en un chat, rótala en el
Dashboard de Stripe.

## Producción / próximos pasos

- Integración real: SDK de Transbank (Webpay Plus), Khipu o Flow para Chile, y
  Stripe Connect para dispersión de fondos multi-cuenta.
- Persistencia: reemplazar el libro mayor en memoria por Postgres.
- Estas integraciones requieren credenciales y cuentas (se configuran como
  secretos del entorno).
