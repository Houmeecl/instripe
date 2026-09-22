# instripe

A minimal Stripe-style storefront demo built with Node, TypeScript, and Express.

It serves a small product catalog and a checkout flow. When a `STRIPE_SECRET_KEY`
is provided it creates real [Stripe Checkout](https://stripe.com/docs/payments/checkout)
sessions; otherwise it runs in a self-contained **demo mode** so the full
end-to-end flow works with no external credentials.

## Requirements

- Node.js >= 20 (developed on Node 22)
- npm

## Getting started

```bash
npm install
npm run dev      # start the dev server with hot reload on http://localhost:3000
```

Then open http://localhost:3000 and pick a plan to run through checkout.

## Configuration

Copy `.env.example` to `.env` (optional). All variables have safe defaults:

| Variable            | Default                  | Description                                           |
| ------------------- | ------------------------ | ----------------------------------------------------- |
| `PORT`              | `3000`                   | Port the HTTP server listens on.                      |
| `CURRENCY`          | `usd`                    | Currency for prices and checkout sessions.            |
| `STRIPE_SECRET_KEY` | _(unset)_                | Stripe secret key. When set, live Checkout is used.   |
| `PUBLIC_BASE_URL`   | `http://localhost:3000`  | Base URL used for Stripe success/cancel redirects.    |

## Scripts

| Command             | Description                                    |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Start the dev server (hot reload via `tsx`).   |
| `npm run build`     | Compile TypeScript to `dist/`.                 |
| `npm start`         | Run the compiled server from `dist/`.          |
| `npm run typecheck` | Type-check without emitting.                   |
| `npm run lint`      | Lint with ESLint.                              |
| `npm test`          | Run the Vitest test suite.                     |

## API

- `GET /health` — service status and whether Stripe is configured.
- `GET /api/products` — product catalog with formatted prices.
- `POST /api/checkout` — create a checkout session (`{ "productId": "pro" }`).
- `GET /success` — post-payment confirmation page.
