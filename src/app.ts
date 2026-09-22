import express, { type Express, type Request, type Response } from "express";
import Stripe from "stripe";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, isStripeConfigured, isChileConfigured, type AppConfig, type GatewayName } from "./config.js";
import { formatAmount } from "./money.js";
import { Platform, PlatformError } from "./platform.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function asGateway(value: unknown, fallback: GatewayName): GatewayName {
  return value === "stripe" || value === "chile" ? value : fallback;
}

export function createApp(config: AppConfig = loadConfig()): Express {
  const app = express();
  const platform = new Platform(config);

  // Stripe webhooks need the raw body for signature verification, so this
  // route is registered before the JSON body parser.
  app.post(
    "/webhooks/stripe",
    express.raw({ type: "application/json" }),
    (req: Request, res: Response) => {
      const signature = req.headers["stripe-signature"];
      let event: Stripe.Event;

      if (config.stripeSecretKey && config.stripeWebhookSecret && signature) {
        try {
          const stripe = new Stripe(config.stripeSecretKey);
          event = stripe.webhooks.constructEvent(
            req.body as Buffer,
            signature as string,
            config.stripeWebhookSecret,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid signature";
          res.status(400).json({ error: `Webhook signature verification failed: ${message}` });
          return;
        }
      } else {
        // Demo fallback when no webhook secret is configured.
        try {
          event = JSON.parse((req.body as Buffer).toString("utf8")) as Stripe.Event;
        } catch {
          res.status(400).json({ error: "invalid payload" });
          return;
        }
      }

      platform.recordWebhookEvent(event.id, event.type);
      let fulfilled = false;
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const policyId =
          session.metadata?.reference ?? session.metadata?.policyId ?? session.client_reference_id ?? undefined;
        fulfilled = platform.fulfillCheckout(policyId, session.id).fulfilled;
        console.log(
          `[stripe] checkout.session.completed ${session.id} policy=${policyId ?? "-"} fulfilled=${fulfilled}`,
        );
      }
      res.json({ received: true, type: event.type, fulfilled });
    },
  );

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      currency: config.currency,
      defaultGateway: config.defaultGateway,
      stripeConfigured: isStripeConfigured(config),
      stripeWebhookConfigured: Boolean(config.stripeWebhookSecret),
      chileConfigured: isChileConfigured(config),
      time: new Date().toISOString(),
    });
  });

  app.get("/api/gateways", (_req: Request, res: Response) => {
    res.json({ defaultGateway: config.defaultGateway, gateways: platform.listGateways() });
  });

  app.get("/api/plans", (_req: Request, res: Response) => {
    res.json({
      currency: config.currency,
      plans: platform.plans().map((plan) => ({
        ...plan,
        displayPremium: formatAmount(plan.premium, config.currency),
        displayCoverage: formatAmount(plan.coverage, config.currency),
      })),
    });
  });

  app.get("/api/stripe/events", (_req: Request, res: Response) => {
    res.json({ events: platform.listWebhookEvents() });
  });

  app.get("/api/payments", (_req: Request, res: Response) => {
    const wallet = platform.floatAccount;
    res.json({
      currency: config.currency,
      wallet: {
        balance: wallet.balance,
        displayBalance: formatAmount(wallet.balance, config.currency),
      },
      payments: platform.listPayments(),
      modules: [{ id: "seguros", label: "Seguros", connected: true }],
    });
  });

  app.get("/api/overview", (_req: Request, res: Response) => {
    const floatAccount = platform.floatAccount;
    res.json({
      currency: config.currency,
      float: {
        balance: floatAccount.balance,
        displayBalance: formatAmount(floatAccount.balance, config.currency),
      },
      payments: platform.listPayments(),
      modules: [{ id: "seguros", label: "Seguros", connected: true }],
      policies: platform.listPolicies(),
      claims: platform.listClaims(),
    });
  });

  app.post("/api/policies", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (!body.planId || !body.holderName || !body.email) {
      res.status(400).json({ error: "planId, holderName y email son requeridos" });
      return;
    }
    try {
      const result = await platform.subscribe({
        planId: String(body.planId),
        holderName: String(body.holderName),
        email: String(body.email),
        gateway: asGateway(body.gateway, config.defaultGateway),
      });
      res.status(201).json({
        ...result,
        charge: {
          ...result.charge,
          publishableKey: result.charge.clientSecret ? config.stripePublishableKey : undefined,
        },
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/checkout/sessions/:id", async (req: Request, res: Response) => {
    if (!config.stripeSecretKey) {
      res.status(409).json({ error: "Stripe no está configurado" });
      return;
    }
    const sessionId = String(req.params.id);
    try {
      const stripe = new Stripe(config.stripeSecretKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const policyId =
        session.metadata?.reference ?? session.metadata?.policyId ?? session.client_reference_id ?? undefined;
      const paid = session.status === "complete" && session.payment_status === "paid";
      const fulfillment = paid
        ? platform.fulfillCheckout(policyId, session.id)
        : { fulfilled: false, policyId };
      res.json({
        id: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        policyId: fulfillment.policyId ?? policyId ?? null,
        fulfilled: fulfillment.fulfilled,
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/claims", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (!body.policyId || !body.beneficiary || body.amount === undefined) {
      res.status(400).json({ error: "policyId, amount y beneficiary son requeridos" });
      return;
    }
    try {
      const result = await platform.fileClaim({
        policyId: String(body.policyId),
        amount: Number(body.amount),
        beneficiary: String(body.beneficiary),
        gateway: asGateway(body.gateway, config.defaultGateway),
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.use(express.static(path.join(__dirname, "..", "public")));

  return app;
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof PlatformError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Error inesperado";
  res.status(502).json({ error: message });
}
