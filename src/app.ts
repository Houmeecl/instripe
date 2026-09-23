import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type Stripe from "stripe";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requiredOption, type SessionUser } from "./auth/module.js";
import { loadConfig, isStripeConfigured, isChileConfigured, type AppConfig, type GatewayName } from "./config.js";
import { createStripe } from "./stripe/client.js";
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

      if (config.stripeWebhookSecret) {
        if (!signature || !config.stripeSecretKey) {
          res.status(400).json({ error: "Webhook signature verification failed: falta la firma" });
          return;
        }
        try {
          const stripe = createStripe(config);
          if (!stripe) {
            res.status(400).json({ error: "Webhook signature verification failed: falta la firma" });
            return;
          }
          event = stripe.webhooks.constructEvent(req.body as Buffer, signature, config.stripeWebhookSecret);
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
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const session = event.data.object as Stripe.Checkout.Session;
        const payable = session.payment_status === "paid" || session.payment_status === "no_payment_required";
        if (payable) {
          const reference = checkoutReference(session);
          const result = platform.fulfillCheckout(reference, session.id);
          fulfilled = result.fulfilled;
          const moduleName = result.module ?? session.metadata?.module ?? "-";
          console.log(
            `[stripe] ${event.type} ${session.id} module=${moduleName} reference=${reference ?? "-"} fulfilled=${fulfilled}`,
          );
        }
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
      database: "sqlite",
      chileConfigured: isChileConfigured(config),
      time: new Date().toISOString(),
    });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/") || isPublicApi(req)) {
      next();
      return;
    }
    const user = platform.auth.userFromCookie(readCookie(req.headers.cookie, "pr_session"));
    if (!user) {
      res.status(401).json({ error: "Inicia sesión" });
      return;
    }
    res.locals.user = user;
    const required = requiredOption(req.path);
    if (required === "any" || (required !== "deny" && user.options.includes(required))) {
      next();
      return;
    }
    res.status(403).json({ error: "Esta opción no está en tu rol" });
  });

  app.post("/api/session", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = platform.auth.login(String(body.email ?? ""), String(body.password ?? ""));
      writeSessionCookie(res, result.token, config);
      res.status(201).json({ user: result.user });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/session", (req: Request, res: Response) => {
    const user = platform.auth.userFromCookie(readCookie(req.headers.cookie, "pr_session"));
    res.json({ user });
  });

  app.delete("/api/session", (req: Request, res: Response) => {
    platform.auth.logout(readCookie(req.headers.cookie, "pr_session"));
    writeSessionCookie(res, "", config, true);
    res.json({ user: null });
  });

  app.post("/api/session/password", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      platform.auth.changePassword(
        readCookie(req.headers.cookie, "pr_session"),
        String(body.currentPassword ?? ""),
        String(body.newPassword ?? ""),
      );
      res.json({ updated: true });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/gateways", (_req: Request, res: Response) => {
    res.json({ defaultGateway: config.defaultGateway, gateways: platform.listGateways() });
  });

  app.get("/api/plans", (_req: Request, res: Response) => {
    res.json({
      currency: config.currency,
      plans: platform.plans().map((plan) => ({
        ...plan,
        displayRate: `${(plan.rateBps / 100).toFixed(2).replace(".", ",")}%`,
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
      modules: platform.listModules(),
    });
  });

  app.get("/api/overview", (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    const options = new Set(user.options);
    const body: Record<string, unknown> = { currency: config.currency };
    if (options.has("payments")) {
      const floatAccount = platform.floatAccount;
      body.float = {
        balance: floatAccount.balance,
        displayBalance: formatAmount(floatAccount.balance, config.currency),
      };
      body.payments = platform.listPayments();
      body.modules = platform.listModules();
    }
    if (options.has("accounts")) body.accounts = platform.cuentas.list();
    if (options.has("cobros")) body.cobros = platform.cobros.list();
    if (options.has("policies")) body.policies = platform.listPolicies();
    if (options.has("claims")) body.claims = platform.listClaims();
    if (options.has("connect")) body.connect = platform.connect.list();
    if (options.has("treasury")) body.treasury = platform.treasury.list();
    if (options.has("cards")) body.cards = platform.tarjetas.list();
    if (options.has("design")) body.design = platform.diseno.current();
    if (options.has("apps")) body.app = platform.apps.current();
    res.json(body);
  });

  app.get("/api/onboarding", (req: Request, res: Response) => {
    const acceptance = platform.registro.tosSession(readCookie(req.headers.cookie, "pr_tos"));
    res.json({
      kind: "tos",
      accepted: Boolean(acceptance),
      acceptance: acceptance ?? null,
      space: platform.registro.space(),
    });
  });

  app.post("/api/onboarding", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = platform.registro.acceptTos({
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        accepted: body.accepted === true,
      });
      const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
      res.setHeader("Set-Cookie", `pr_tos=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`);
      res.status(201).json({ acceptance: result.acceptance, space: platform.registro.space() });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/registro", (_req: Request, res: Response) => {
    const balances = new Map(platform.cuentas.list().map((account) => [account.id, account.balance]));
    res.json({
      domain: "proveedorregional.cl",
      members: platform.registro.list().map((member) => ({
        ...member,
        balance: balances.get(member.accountId) ?? 0,
        displayBalance: formatAmount(balances.get(member.accountId) ?? 0, config.currency),
      })),
    });
  });

  app.get("/api/cuentas", (_req: Request, res: Response) => {
    res.json({ accounts: platform.cuentas.list() });
  });

  app.post("/api/cuentas", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const account = platform.cuentas.open({
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
      });
      res.status(201).json({ account });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/cuentas/:id/recarga", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.amount === undefined) {
      res.status(400).json({ error: "amount es requerido" });
      return;
    }
    try {
      const result = await platform.cuentas.fund({
        accountId: String(req.params.id),
        amount: Number(body.amount),
        gateway: asGateway(body.gateway, config.defaultGateway),
        email: body.email ? String(body.email) : undefined,
      });
      res.status(201).json(withPublishableKey(result, config));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/cuentas/:id/retiro", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.amount === undefined || !body.destination) {
      res.status(400).json({ error: "amount y destination son requeridos" });
      return;
    }
    try {
      const result = await platform.cuentas.withdraw({
        accountId: String(req.params.id),
        amount: Number(body.amount),
        destination: String(body.destination),
        gateway: asGateway(body.gateway, config.defaultGateway),
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/cobros", (_req: Request, res: Response) => {
    res.json({ cobros: platform.cobros.list() });
  });

  app.post("/api/cobros", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.amount === undefined) {
      res.status(400).json({ error: "amount es requerido" });
      return;
    }
    try {
      const result = await platform.cobros.create({
        concept: String(body.concept ?? ""),
        payerName: String(body.payerName ?? ""),
        email: String(body.email ?? ""),
        amount: Number(body.amount),
        gateway: asGateway(body.gateway, config.defaultGateway),
      });
      res.status(201).json(withPublishableKey(result, config));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/connect", (_req: Request, res: Response) => {
    res.json({ accounts: platform.connect.list() });
  });

  app.post("/api/connect", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const account = await platform.connect.create({
        businessName: String(body.businessName ?? ""),
        email: String(body.email ?? ""),
      });
      res.status(201).json({ account });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/connect/:id/pago", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.amount === undefined) {
      res.status(400).json({ error: "amount es requerido" });
      return;
    }
    try {
      const result = await platform.connect.payout({
        accountId: String(req.params.id),
        amount: Number(body.amount),
        gateway: asGateway(body.gateway, config.defaultGateway),
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/treasury", (_req: Request, res: Response) => {
    res.json({ accounts: platform.treasury.list() });
  });

  app.post("/api/treasury", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const account = await platform.treasury.open({
        nickname: String(body.nickname ?? ""),
        connectedId: body.connectedId ? String(body.connectedId) : undefined,
      });
      res.status(201).json({ account });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/treasury/:id/abono", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.amount === undefined) {
      res.status(400).json({ error: "amount es requerido" });
      return;
    }
    try {
      const result = await platform.treasury.fund({
        accountId: String(req.params.id),
        amount: Number(body.amount),
        gateway: asGateway(body.gateway, config.defaultGateway),
        email: body.email ? String(body.email) : undefined,
      });
      res.status(201).json(withPublishableKey(result, config));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/tarjetas", (_req: Request, res: Response) => {
    res.json({ cards: platform.tarjetas.list() });
  });

  app.post("/api/tarjetas", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.cupo === undefined) {
      res.status(400).json({ error: "cupo es requerido" });
      return;
    }
    try {
      const card = await platform.tarjetas.issue({
        holderName: String(body.holderName ?? ""),
        email: String(body.email ?? ""),
        phone: String(body.phone ?? ""),
        cupo: Number(body.cupo),
      });
      res.status(201).json({ card });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/diseno", (_req: Request, res: Response) => {
    res.json({ design: platform.diseno.current() });
  });

  app.post("/api/diseno", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const design = await platform.diseno.save({
        displayName: String(body.displayName ?? ""),
        buttonColor: String(body.buttonColor ?? ""),
        backgroundColor: String(body.backgroundColor ?? ""),
        borderStyle: String(body.borderStyle ?? ""),
        carrierTitle: String(body.carrierTitle ?? ""),
        carrierBody: String(body.carrierBody ?? ""),
      });
      res.status(200).json({ design });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/apps", (_req: Request, res: Response) => {
    res.json({ manifest: platform.apps.current() });
  });

  app.post("/api/apps", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const manifest = platform.apps.create({ name: String(body.name ?? "") });
      res.status(201).json({ manifest, upload: "stripe apps upload" });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/policies", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (!body.holderName || !body.email || !body.cardLabel || body.cupo === undefined) {
      res.status(400).json({ error: "holderName, email, cardLabel y cupo son requeridos" });
      return;
    }
    try {
      const result = await platform.subscribe({
        holderName: String(body.holderName),
        email: String(body.email),
        cardLabel: String(body.cardLabel),
        cupo: Number(body.cupo),
        gateway: asGateway(body.gateway, config.defaultGateway),
      });
      res.status(201).json(withPublishableKey(result, config));
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
      const stripe = createStripe(config);
      if (!stripe) {
        res.status(409).json({ error: "Stripe no está configurado" });
        return;
      }
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const reference = checkoutReference(session);
      const paid = session.status === "complete" && session.payment_status === "paid";
      const fulfillment = paid ? platform.fulfillCheckout(reference, session.id) : { fulfilled: false as const };
      const moduleName = fulfillment.module ?? session.metadata?.module ?? null;
      const settledReference = fulfillment.reference ?? reference ?? null;
      res.json({
        id: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        module: moduleName,
        reference: settledReference,
        policyId: moduleName === "seguros" ? settledReference : null,
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

  const publicDir = path.join(__dirname, "..", "public");
  app.get("/aplicacion", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "aplicacion.html"));
  });
  app.get("/operacion", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "operacion.html"));
  });
  app.use(express.static(publicDir));

  return app;
}

function isPublicApi(req: Request): boolean {
  if (req.path === "/api/onboarding" || req.path === "/api/registro") return true;
  return req.path === "/api/session" && (req.method === "GET" || req.method === "POST" || req.method === "DELETE");
}

function writeSessionCookie(res: Response, token: string, config: AppConfig, clear = false): void {
  const secure = config.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
  const value = clear ? "" : encodeURIComponent(token);
  const maxAge = clear ? 0 : 43200;
  res.setHeader("Set-Cookie", `pr_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function checkoutReference(session: Stripe.Checkout.Session): string | undefined {
  return session.metadata?.reference ?? session.client_reference_id ?? undefined;
}

function withPublishableKey<T extends { charge: { clientSecret?: string } }>(
  result: T,
  config: AppConfig,
): T & { charge: T["charge"] & { publishableKey?: string } } {
  return {
    ...result,
    charge: {
      ...result.charge,
      publishableKey: result.charge.clientSecret ? config.stripePublishableKey : undefined,
    },
  };
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof PlatformError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Error inesperado";
  res.status(502).json({ error: message });
}
