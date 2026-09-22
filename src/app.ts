import express, { type Express, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, isStripeConfigured, type AppConfig } from "./config.js";
import { PRODUCTS, formatAmount } from "./products.js";
import { createCheckoutSession, CheckoutError } from "./checkout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config: AppConfig = loadConfig()): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      stripeConfigured: isStripeConfigured(config),
      time: new Date().toISOString(),
    });
  });

  app.get("/api/products", (_req: Request, res: Response) => {
    res.json({
      currency: config.currency,
      products: PRODUCTS.map((product) => ({
        ...product,
        displayAmount: formatAmount(product.amount, config.currency),
      })),
    });
  });

  app.post("/api/checkout", async (req: Request, res: Response) => {
    const productId = String(req.body?.productId ?? "");
    if (!productId) {
      res.status(400).json({ error: "productId is required" });
      return;
    }
    try {
      const result = await createCheckoutSession(productId, config);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof CheckoutError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Checkout failed";
      res.status(502).json({ error: message });
    }
  });

  app.get("/success", (req: Request, res: Response) => {
    const sessionId = String(req.query.session_id ?? "unknown");
    const demo = req.query.demo === "1";
    res.send(renderSuccessPage(sessionId, demo));
  });

  app.use(express.static(path.join(__dirname, "..", "public")));

  return app;
}

function renderSuccessPage(sessionId: string, demo: boolean): string {
  const banner = demo
    ? "<p class=\"demo\">Demo mode — no real payment was processed.</p>"
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment complete · instripe</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="card">
      <div class="check">&#10003;</div>
      <h1>Payment complete</h1>
      ${banner}
      <p class="session">Session: <code>${sessionId}</code></p>
      <a class="btn" href="/">Back to store</a>
    </main>
  </body>
</html>`;
}
