import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type Stripe from "stripe";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requiredOption, type SessionUser } from "./auth/module.js";
import { loadConfig, isStripeConfigured, isChileConfigured, isMailConfigured, type AppConfig, type GatewayName } from "./config.js";
import { listInbox, readLetter, sendLetter } from "./mail/box.js";
import { createMailbox, listMailboxes } from "./mail/mailcow.js";
import { createStripe } from "./stripe/client.js";
import { formatAmount } from "./money.js";
import type { GiftActivationStripe, GiftStripe } from "./modules/regalos/issue.js";
import { planDisplayRate } from "./modules/seguros/catalog.js";
import { Platform, PlatformError } from "./platform.js";
import { PilotPlanner, PilotPlannerError } from "./modules/pilot/planner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function asGateway(value: unknown, fallback: GatewayName): GatewayName {
  return value === "stripe" || value === "chile" ? value : fallback;
}

export function createApp(config: AppConfig = loadConfig()): Express {
  const app = express();
  app.set("trust proxy", "loopback");
  const platform = new Platform(config);
  app.locals.platform = platform;
  const pilotPlanner = new PilotPlanner(config);
  const pilotRequestTimes = new Map<string, number>();
  const publicContactWindows = new Map<string, { count: number; resetAt: number }>();

  // Operación sees the whole platform. Every other role only sees what it owns:
  // its Connect accounts (by email), their Treasury accounts and cards, and its own exits.
  const ownConnect = (user: SessionUser) => {
    const email = user.email.toLowerCase();
    return platform.connect
      .list(user)
      .filter((account) => user.role === "operacion" || account.email.toLowerCase() === email);
  };
  const ownTreasury = (user: SessionUser) => {
    if (user.role === "operacion") return platform.treasury.list();
    const ids = new Set(ownConnect(user).map((account) => account.id));
    return platform.treasury.list().filter((account) => account.connectedId !== undefined && ids.has(account.connectedId));
  };
  const ownCards = (user: SessionUser) => {
    if (user.role === "operacion") return platform.tarjetas.list();
    const email = user.email.toLowerCase();
    const cardIds = new Set(ownConnect(user).flatMap((account) => (account.cardId ? [account.cardId] : [])));
    return platform.tarjetas.list().filter((card) => card.email.toLowerCase() === email || cardIds.has(card.id));
  };

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

      if (platform.seenWebhook(event.id)) {
        res.json({ received: true, type: event.type, fulfilled: false, duplicate: true });
        return;
      }
      platform.recordWebhookEvent(event.id, event.type);
      let fulfilled = false;
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const session = event.data.object as Stripe.Checkout.Session;
        const reference = checkoutReference(session);
        const result = platform.fulfillCheckout({
          reference,
          sessionId: session.id,
          amountTotal: session.amount_total,
          currency: session.currency,
          paymentStatus: session.payment_status,
        });
        fulfilled = result.fulfilled;
        const moduleName = result.module ?? session.metadata?.module ?? "-";
        console.log(
          `[stripe] ${event.type} ${session.id} module=${moduleName} reference=${reference ?? "-"} fulfilled=${fulfilled}`,
        );
      } else if (event.type === "checkout.session.async_payment_failed") {
        const session = event.data.object as Stripe.Checkout.Session;
        platform.failCheckout(checkoutReference(session), event.id);
      } else if (event.type === "charge.refunded") {
        const charge = event.data.object as Stripe.Charge;
        platform.reverseCollection(charge.metadata?.reference, charge.amount_refunded, event.id);
      } else if (event.type === "charge.dispute.created") {
        const dispute = event.data.object as Stripe.Dispute;
        const charge = typeof dispute.charge === "string" ? undefined : dispute.charge;
        const reference = dispute.metadata?.reference ?? charge?.metadata?.reference;
        platform.reverseCollection(reference, dispute.amount, event.id);
      } else if (event.type === "transfer.reversed") {
        const transfer = event.data.object as Stripe.Transfer;
        platform.reverseTransfer(transfer.id, transfer.amount_reversed, event.id);
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

  app.get("/api/public-contact", (_req: Request, res: Response) => {
    const email = config.publicContactEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(503).json({ error: "El correo público de contacto configurado no es válido." });
      return;
    }
    res.json({ email });
  });

  app.post("/api/public-contact", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const organization = typeof body.organization === "string" ? body.organization.trim() : "";
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const website = typeof body.website === "string" ? body.website.trim() : "";
    const topics = new Set(["Patrocinio y alianzas", "Información del programa", "Otra consulta"]);

    if (website) {
      res.status(200).json({ sent: true });
      return;
    }
    if (
      !name ||
      name.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      organization.length > 160 ||
      !topics.has(topic) ||
      !message ||
      message.length > 4000 ||
      body.consent !== true
    ) {
      res.status(400).json({ error: "Completa los campos requeridos con datos válidos y acepta el uso de datos para responder." });
      return;
    }

    const destination = config.publicContactEmail.trim();
    if (!isMailConfigured(config) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      res.status(503).json({ error: "El envío de consultas no está configurado todavía. Escríbenos directamente al correo publicado." });
      return;
    }

    const now = Date.now();
    for (const [key, window] of publicContactWindows) {
      if (window.resetAt <= now) publicContactWindows.delete(key);
    }
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const currentWindow = publicContactWindows.get(ip);
    if (currentWindow && currentWindow.count >= 5) {
      res.status(429).json({ error: "Has enviado varias consultas. Espera unos minutos antes de intentarlo nuevamente." });
      return;
    }
    if (currentWindow) currentWindow.count += 1;
    else publicContactWindows.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });

    try {
      await sendLetter(config, {
        to: destination,
        replyTo: email,
        subject: `Consulta web: ${topic}`,
        text: [
          "Nueva consulta enviada desde la landing de Proveedor Regional.",
          "",
          `Nombre: ${name}`,
          `Correo para responder: ${email}`,
          `Organización: ${organization || "No indicada"}`,
          `Motivo: ${topic}`,
          "",
          "Mensaje:",
          message,
        ].join("\n"),
      });
      res.status(201).json({ sent: true });
    } catch (error) {
      handleError(error, res);
    }
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
    if (user.mustChangePassword && req.path !== "/api/session/password") {
      res.status(403).json({ error: "Cambia la clave inicial antes de operar" });
      return;
    }
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
      const user = platform.auth.changePassword(
        readCookie(req.headers.cookie, "pr_session"),
        String(body.currentPassword ?? ""),
        String(body.newPassword ?? ""),
      );
      res.json({ updated: true, user });
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
        displayRate: planDisplayRate(plan),
      })),
    });
  });

  app.get("/api/stripe/events", (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    res.json({ events: user.role === "operacion" ? platform.listWebhookEvents() : [] });
  });

  app.get("/api/payments", (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    if (user.role !== "operacion") {
      res.json({ currency: config.currency, payments: [], modules: platform.listModules() });
      return;
    }
    const wallet = platform.floatAccount;
    res.json({
      currency: config.currency,
      wallet: {
        balance: wallet.balance,
        displayBalance: formatAmount(wallet.balance, config.currency),
      },
      transferable: {
        balance: platform.transferableAccount.balance,
        displayBalance: formatAmount(platform.transferableAccount.balance, config.currency),
      },
      payments: platform.listPayments(),
      modules: platform.listModules(),
    });
  });

  app.get("/api/overview", (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    const options = new Set(user.options);
    const body: Record<string, unknown> = { currency: config.currency };
    if (options.has("payments") && user.role !== "operacion") {
      body.payments = [];
      body.modules = platform.listModules();
    } else if (options.has("payments")) {
      const floatAccount = platform.floatAccount;
      body.float = {
        balance: floatAccount.balance,
        displayBalance: formatAmount(floatAccount.balance, config.currency),
      };
      body.transferable = {
        balance: platform.transferableAccount.balance,
        displayBalance: formatAmount(platform.transferableAccount.balance, config.currency),
      };
      body.payments = platform.listPayments();
      body.modules = platform.listModules();
    }
    if (options.has("accounts")) body.accounts = platform.cuentas.listFor(user);
    if (options.has("cobros")) body.cobros = platform.cobros.list();
    if (options.has("policies")) body.policies = platform.listPolicies();
    if (options.has("claims")) body.claims = platform.listClaims();
    if (options.has("connect")) body.connect = ownConnect(user);
    if (options.has("treasury")) body.treasury = ownTreasury(user);
    if (options.has("cards")) body.cards = ownCards(user);
    if (options.has("design")) body.design = platform.diseno.current();
    if (options.has("apps")) body.app = platform.apps.current();
    if (options.has("empresas")) body.empresas = platform.empresas.list(companyActor(res));
    body.inicio = platform.inicio(companyActor(res));
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
    const user = res.locals.user as SessionUser;
    res.json({ accounts: platform.cuentas.listFor(user) });
  });

  app.post("/api/cuentas", (req: Request, res: Response) => {
    const body = req.body ?? {};
    const user = res.locals.user as SessionUser;
    try {
      const account = platform.cuentas.open({
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        memberId: user.role === "operacion" ? undefined : user.memberId,
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
      const user = res.locals.user as SessionUser;
      const result = await platform.cuentas.fund({
        accountId: String(req.params.id),
        amount: Number(body.amount),
        gateway: asGateway(body.gateway, config.defaultGateway),
        email: body.email ? String(body.email) : undefined,
        actor: user,
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
      const user = res.locals.user as SessionUser;
      const result = platform.cuentas.withdraw({
        accountId: String(req.params.id),
        amount: Number(body.amount),
        destination: String(body.destination),
        gateway: asGateway(body.gateway, config.defaultGateway),
        requestedBy: user.id,
        actor: user,
      });
      res.status(202).json(result);
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
    const user = res.locals.user as SessionUser;
    res.json({ accounts: ownConnect(user) });
  });

  app.post("/api/connect", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const user = res.locals.user as SessionUser;
    try {
      const account = await platform.connect.create({
        businessName: String(body.businessName ?? ""),
        email: String(body.email ?? ""),
        actor: user,
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
      const user = res.locals.user as SessionUser;
      if (!ownConnect(user).some((account) => account.id === String(req.params.id))) {
        res.status(404).json({ error: `Cuenta Connect desconocida: ${String(req.params.id)}` });
        return;
      }
      const result = platform.connect.payout({
        accountId: String(req.params.id),
        amount: Number(body.amount),
        gateway: asGateway(body.gateway, config.defaultGateway),
        requestedBy: user.id,
      });
      res.status(202).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/inicio", (_req: Request, res: Response) => {
    res.json(platform.inicio(companyActor(res)));
  });

  app.get("/api/clases", (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    try {
      const scope = { companyId: user.companyId, allCompanies: user.role === "operacion" };
      const courses = platform.laboral.courses(scope).courses.map((course) => ({
        ...course,
        students: user.role === "alumno"
          ? course.students.filter((student) => student.email === user.email)
          : course.students,
      }));
      res.json({ courses, submissions: platform.laboral.listSubmissions(companyActor(res)) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/pilot/plan", async (req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    if (user.role !== "operacion") {
      res.status(403).json({ error: "Solo Operación puede preparar el plan del piloto." });
      return;
    }
    if (!pilotPlanner.isConfigured()) {
      res.status(503).json({ error: "El planificador IA no está configurado en el servidor." });
      return;
    }
    const lastRequest = pilotRequestTimes.get(user.id) ?? 0;
    if (Date.now() - lastRequest < 60_000) {
      res.status(429).json({ error: "Espera un minuto antes de generar otro plan." });
      return;
    }

    const body = req.body ?? {};
    const input = {
      name: typeof body.name === "string" ? body.name.trim() : "",
      objective: typeof body.objective === "string" ? body.objective.trim() : "",
      companyCount: Number(body.companyCount),
      workerCount: Number(body.workerCount),
      durationWeeks: Number(body.durationWeeks),
      constraints: typeof body.constraints === "string" ? body.constraints.trim() : "",
    };
    if (
      !input.name ||
      input.name.length > 120 ||
      !input.objective ||
      input.objective.length > 1200 ||
      !Number.isInteger(input.companyCount) ||
      input.companyCount < 1 ||
      input.companyCount > 100 ||
      !Number.isInteger(input.workerCount) ||
      input.workerCount < 1 ||
      input.workerCount > 1000 ||
      !Number.isInteger(input.durationWeeks) ||
      input.durationWeeks < 1 ||
      input.durationWeeks > 52 ||
      input.constraints.length > 1200
    ) {
      res.status(400).json({ error: "Revisa los campos: el piloto necesita nombre, objetivo y cantidades válidas." });
      return;
    }

    pilotRequestTimes.set(user.id, Date.now());
    try {
      const plan = await pilotPlanner.generate(input);
      res.json({ plan, model: config.databricks.model, executedActions: false });
    } catch (error) {
      if (error instanceof PilotPlannerError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      console.error("Unexpected error generating a Databricks pilot plan");
      res.status(502).json({ error: "No se pudo generar el plan del piloto." });
    }
  });

  app.post("/api/clases/:id/alumnos", (req: Request, res: Response) => {
    const body = req.body ?? {};
    const user = res.locals.user as SessionUser;
    try {
      const course = platform.laboral.enroll(String(req.params.id), {
        name: user.role === "alumno" ? user.name : String(body.name || user.name),
        email: user.role === "alumno" ? user.email : String(body.email || user.email),
      }, { companyId: user.companyId });
      res.status(201).json({ course });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/clases/usuarios", (req: Request, res: Response) => {
    const body = req.body ?? {};
    if ((body.role !== "alumno" && body.role !== "evaluador") || !body.name || !body.email || !body.password || !body.companyId) {
      res.status(400).json({ error: "Nombre, correo, rol, empresa y clave inicial son requeridos" });
      return;
    }
    try {
      const user = platform.createLmsUser(companyActor(res), {
        name: String(body.name),
        email: String(body.email),
        role: body.role,
        companyId: String(body.companyId),
        password: String(body.password),
      });
      res.status(201).json({ user });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/clases/:id/videos", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const actor = companyActor(res);
      if (actor.role === "operacion") assertCourseCompany(platform, actor, String(body.companyId ?? ""));
      const video = platform.laboral.createVideo(companyActor(res), {
        courseId: String(req.params.id),
        title: String(body.title ?? ""),
        url: String(body.url ?? ""),
        companyId: body.companyId ? String(body.companyId) : undefined,
      });
      res.status(201).json({ video });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/clases/:id/tareas", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const actor = companyActor(res);
      if (actor.role === "operacion") assertCourseCompany(platform, actor, String(body.companyId ?? ""));
      const task = platform.laboral.createTask(companyActor(res), {
        courseId: String(req.params.id),
        title: String(body.title ?? ""),
        instructions: String(body.instructions ?? ""),
        dueAt: body.dueAt ? String(body.dueAt) : undefined,
        companyId: body.companyId ? String(body.companyId) : undefined,
      });
      res.status(201).json({ task });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/clases/tareas/:id/entregas", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const submission = platform.laboral.submitTask(companyActor(res), String(req.params.id), String(body.answer ?? ""));
      res.status(201).json({ submission });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/clases/entregas/:id/evaluacion", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      if (body.status !== "approved" && body.status !== "rejected") {
        throw new PlatformError("El resultado de evaluación no es válido", 400);
      }
      const submission = platform.laboral.reviewSubmission(companyActor(res), String(req.params.id), {
        status: body.status,
        feedback: String(body.feedback ?? ""),
      });
      res.status(200).json({ submission });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/clases/:id/foro", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const actor = companyActor(res);
      if (actor.role === "operacion") assertCourseCompany(platform, actor, String(body.companyId ?? ""));
      const post = platform.laboral.createForumPost(companyActor(res), {
        courseId: String(req.params.id),
        message: String(body.message ?? ""),
        parentId: body.parentId ? String(body.parentId) : undefined,
        companyId: body.companyId ? String(body.companyId) : undefined,
      });
      res.status(201).json({ post });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/configuracion", (_req: Request, res: Response) => {
    try {
      res.json(platform.laboral.configuration(companyActor(res).role));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/configuracion", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const saved = platform.laboral.saveConfiguration(companyActor(res).role, {
        url: String(body.url ?? ""),
        secret: body.secret === undefined ? undefined : String(body.secret),
      });
      res.status(200).json(saved);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/actuarial", (_req: Request, res: Response) => {
    res.json({ classes: platform.seguros.riskClasses(), opensCredit: false });
  });

  app.post("/api/actuarial", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const classes = platform.seguros.setRiskRate(companyActor(res).role, String(body.classId ?? ""), Number(body.rate));
      res.status(200).json({ classes, opensCredit: false });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/frosting", (_req: Request, res: Response) => {
    res.json({
      planId: "frosting",
      opensCredit: false,
      pricing: "workers",
      classes: platform.seguros.riskClasses(),
    });
  });

  app.post("/api/frosting", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (!body.holderName || !body.email || !body.companyName || body.workers === undefined || !body.riskClassId) {
      res.status(400).json({ error: "holderName, email, companyName, workers y riskClassId son requeridos" });
      return;
    }
    try {
      const result = await platform.subscribeFrosting({
        holderName: String(body.holderName),
        email: String(body.email),
        companyName: String(body.companyName),
        workers: Number(body.workers),
        riskClassId: String(body.riskClassId),
        gateway: asGateway(body.gateway, config.defaultGateway),
        actorRole: companyActor(res).role,
      });
      res.status(201).json(withPublishableKey(result, config));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/empresas", (_req: Request, res: Response) => {
    res.json(platform.empresas.list(companyActor(res)));
  });

  app.delete("/api/empresas/:id", (req: Request, res: Response) => {
    try {
      const result = platform.deleteCompany(
        companyActor(res),
        String(req.params.id),
        String(req.body?.confirmation ?? ""),
      );
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Listar por empresa
  app.get("/api/empresas/:id/colaboradores", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const colaboradores = platform.colaboradores.listByCompany(String(req.params.id), user);
      res.json({ colaboradores });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Crear
  app.post("/api/empresas/:id/colaboradores", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const colaborador = platform.colaboradores.create(user, {
        companyId: String(req.params.id),
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        role: body.role === "administrador_empresa" ? "administrador_empresa" : "colaborador",
        spendLimit: body.spendLimit ? Number(body.spendLimit) : undefined,
        categories: body.categories && Array.isArray(body.categories) ? body.categories.map(String) : undefined,
      });
      res.status(201).json({ colaborador });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Obtener uno
  app.get("/api/colaboradores/:id", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const colaborador = platform.colaboradores.get(String(req.params.id), user);
      if (!colaborador) {
        res.status(404).json({ error: "Colaborador no encontrado" });
        return;
      }
      res.json({ colaborador });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Transferir
  app.post("/api/colaboradores/transfer", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const result = platform.colaboradores.transfer(user, {
        fromColaboradorId: String(body.fromColaboradorId ?? ""),
        toColaboradorId: String(body.toColaboradorId ?? ""),
        amount: Number(body.amount),
        description: String(body.description ?? ""),
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Estadisticas por empresa
  app.get("/api/empresas/:id/colaboradores/stats", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const stats = platform.colaboradores.getStats(String(req.params.id), user);
      res.json({ stats });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Transferencias por colaborador
  app.get("/api/colaboradores/:id/transferencias", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const transferencias = platform.colaboradores.listTransferencias(String(req.params.id), user);
      res.json({ transferencias });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Transferencias por empresa
  app.get("/api/empresas/:id/transferencias", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const transferencias = platform.colaboradores.listTransferenciasByCompany(String(req.params.id), user);
      res.json({ transferencias });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Actualizar limite de gasto
  app.put("/api/colaboradores/:id/spend-limit", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const colaborador = platform.colaboradores.updateSpendLimit(
        String(req.params.id),
        Number(body.spendLimit),
        user
      );
      res.json({ colaborador });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Actualizar categorias
  app.put("/api/colaboradores/:id/categories", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const colaborador = platform.colaboradores.updateCategories(
        String(req.params.id),
        body.categories && Array.isArray(body.categories) ? body.categories.map(String) : [],
        user
      );
      res.json({ colaborador });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Bloquear/Desbloquear
  app.put("/api/colaboradores/:id/status", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const colaborador = platform.colaboradores.toggleStatus(
        String(req.params.id),
        body.status === "suspended" ? "suspended" : "active",
        user
      );
      res.json({ colaborador });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Colaboradores - Eliminar
  app.delete("/api/colaboradores/:id", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const deleted = platform.colaboradores.delete(String(req.params.id), user);
      res.json({ deleted });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Pagina de colaboradores
  app.get("/colaboradores", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "colaboradores.html"));
  });

  app.post("/api/empresas", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const ownerEmail = String(body.ownerEmail ?? "").trim();
      let owner: { id: string; email: string; name: string } | undefined;
      if (ownerEmail) {
        const found = platform.auth.findLogin(ownerEmail);
        if (!found || found.role !== "comercio" || found.companyId) {
          throw new PlatformError("El titular de la empresa tiene que ser un comercio sin otra empresa", 400);
        }
        owner = { id: found.id, email: found.email, name: found.name };
      }
      const company = platform.empresas.create(companyActor(res), {
        name: String(body.name ?? ""),
        color: String(body.color ?? ""),
        owner,
      });
      res.status(201).json({ company });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/logo", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const company = platform.empresas.setLogo(companyActor(res), String(req.params.id), String(body.logo ?? ""));
      res.status(200).json({ company });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.put("/api/empresas/:id/global66", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const company = platform.empresas.configureGlobal66(companyActor(res), String(req.params.id), {
        clientId: String(body.clientId ?? ""),
        clientSecret: String(body.clientSecret ?? ""),
        accountId: String(body.accountId ?? ""),
      });
      res.status(200).json({ company });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/empresas/:id/global66", async (req: Request, res: Response) => {
    try {
      const wallet = await platform.empresas.global66Wallet(companyActor(res), String(req.params.id));
      res.status(200).json({ wallet });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/global66/transferencias", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const transfer = await platform.empresas.transferToBank(companyActor(res), String(req.params.id), {
        workerId: String(body.workerId ?? ""),
        idempotencyKey: String(body.idempotencyKey ?? ""),
        amount: Number(body.amount),
        beneficiaryName: String(body.beneficiaryName ?? ""),
        beneficiaryLastName: String(body.beneficiaryLastName ?? ""),
        accountType: String(body.accountType ?? ""),
        accountNumber: String(body.accountNumber ?? ""),
        documentNumber: String(body.documentNumber ?? ""),
        documentType: String(body.documentType ?? ""),
        purposeCode: Number(body.purposeCode),
      });
      res.status(202).json({ transfer });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/tarjetas/:cardId", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const company = platform.empresas.updateCard(companyActor(res), String(req.params.id), String(req.params.cardId), {
        spendLimit: body.spendLimit === undefined ? undefined : body.spendLimit === null ? null : Number(body.spendLimit),
        categories: body.categories === undefined ? undefined : Array.isArray(body.categories) ? body.categories.map(String) : [String(body.categories)],
        period: body.period === undefined ? undefined : String(body.period),
        periodFrom: body.periodFrom === undefined ? undefined : body.periodFrom === null ? null : String(body.periodFrom),
        periodUntil: body.periodUntil === undefined ? undefined : body.periodUntil === null ? null : String(body.periodUntil),
        blocked: body.blocked === undefined ? undefined : body.blocked === true,
        alerts: body.alerts === undefined ? undefined : body.alerts === true,
      });
      res.status(200).json({ company });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/trabajadores", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const company = platform.empresas.addWorker(companyActor(res), String(req.params.id), {
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
      });
      res.status(201).json({ company });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/regalos", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.amount !== undefined || body.currency !== undefined) {
      res.status(400).json({ error: "Un regalo virtual no lleva monto" });
      return;
    }
    if (!body.title || !body.note || !body.recipientId) {
      res.status(400).json({ error: "Título, nota y destinatario son requeridos" });
      return;
    }
    try {
      const gift = await platform.empresas.giveGift(
        companyActor(res),
        String(req.params.id),
        {
          title: String(body.title),
          note: String(body.note),
          recipientId: String(body.recipientId),
        },
        createStripe(config) as GiftStripe | undefined,
      );
      res.status(201).json({ gift });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/regalos/:giftId/activar", async (req: Request, res: Response) => {
    try {
      const gift = await platform.empresas.activateGift(
        companyActor(res),
        String(req.params.id),
        String(req.params.giftId),
        createStripe(config) as GiftActivationStripe | undefined,
      );
      res.status(200).json({ gift });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/usuarios", (req: Request, res: Response) => {
    const body = req.body ?? {};
    const role = body.role === "titular" || body.role === "comercio" ? body.role : "";
    if (!body.name || !body.email || !role || !body.password) {
      res.status(400).json({ error: "Nombre, correo, rol y clave son requeridos" });
      return;
    }
    try {
      const result = platform.createCompanyUser(companyActor(res), String(req.params.id), {
        name: String(body.name),
        email: String(body.email),
        role,
        password: String(body.password),
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/empresas/:id/abono", (_req: Request, res: Response) => {
    res.status(410).json({ error: "Los abonos demo de empresa fueron retirados. Usa la transferencia bancaria Global66 cuando corresponda." });
  });

  app.post("/api/empresas/:id/transferencias", (_req: Request, res: Response) => {
    res.status(410).json({ error: "Las transferencias internas de demo fueron retiradas. Usa el formulario de transferencia bancaria Global66." });
  });

  app.get("/api/treasury", (_req: Request, res: Response) => {
    res.json({ accounts: ownTreasury(res.locals.user as SessionUser) });
  });

  app.post("/api/treasury", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const user = res.locals.user as SessionUser;
    const connectedId = body.connectedId ? String(body.connectedId) : undefined;
    if (user.role !== "operacion" && (!connectedId || !ownConnect(user).some((account) => account.id === connectedId))) {
      res.status(403).json({ error: "La cuenta financiera tiene que pertenecer a una de tus cuentas Connect" });
      return;
    }
    try {
      const account = await platform.treasury.open({
        nickname: String(body.nickname ?? ""),
        connectedId,
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

  app.get("/api/tarjetas", async (_req: Request, res: Response) => {
    const issuing = await platform.tarjetas.issuingStatus();
    res.json({ cards: ownCards(res.locals.user as SessionUser), issuing });
  });

  app.post("/api/tarjetas", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.cupo === undefined) {
      res.status(400).json({ error: "cupo es requerido" });
      return;
    }
    const dob = body.dob && typeof body.dob === "object" ? body.dob : undefined;
    const address = body.address && typeof body.address === "object" ? body.address : undefined;
    try {
      const card = await platform.tarjetas.issue({
        holderName: String(body.holderName ?? ""),
        email: String(body.email ?? ""),
        phone: String(body.phone ?? ""),
        cupo: Number(body.cupo),
        dob: dob
          ? { day: Number(dob.day), month: Number(dob.month), year: Number(dob.year) }
          : undefined,
        address: address
          ? {
              line1: String(address.line1 ?? ""),
              city: String(address.city ?? ""),
              country: String(address.country ?? ""),
              postalCode: String(address.postalCode ?? address.postal_code ?? ""),
            }
          : undefined,
      });
      res.status(201).json({ card });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/tarjetas/:id", async (req: Request, res: Response) => {
    const cardId = String(req.params.id);
    const card = platform.tarjetas.get(cardId);
    if (!card) {
      res.status(404).json({ error: `Tarjeta no encontrada: ${cardId}` });
      return;
    }
    res.json({ card });
  });

  app.get("/api/tarjetas/:id/details", async (req: Request, res: Response) => {
    const cardId = String(req.params.id);
    const card = platform.tarjetas.getWithDetails(cardId);
    if (!card) {
      res.status(404).json({ error: `Tarjeta no encontrada: ${cardId}` });
      return;
    }
    res.json({ card });
  });

  app.get("/api/tarjetas/:id/cvv", async (req: Request, res: Response) => {
    const cardId = String(req.params.id);
    const cvv = platform.tarjetas.getCVV(cardId);
    if (!cvv) {
      res.status(404).json({ error: `CVV no disponible para tarjeta: ${cardId}` });
      return;
    }
    res.json({ cvv });
  });

  app.post("/api/tarjetas/with-cvv", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.cupo === undefined) {
      res.status(400).json({ error: "cupo es requerido" });
      return;
    }
    const dob = body.dob && typeof body.dob === "object" ? body.dob : undefined;
    const address = body.address && typeof body.address === "object" ? body.address : undefined;
    try {
      const card = await platform.tarjetas.issueWithCVV({
        holderName: String(body.holderName ?? ""),
        email: String(body.email ?? ""),
        phone: String(body.phone ?? ""),
        cupo: Number(body.cupo),
        dob: dob
          ? { day: Number(dob.day), month: Number(dob.month), year: Number(dob.year) }
          : undefined,
        address: address
          ? {
              line1: String(address.line1 ?? ""),
              city: String(address.city ?? ""),
              country: String(address.country ?? ""),
              postalCode: String(address.postalCode ?? address.postal_code ?? ""),
            }
          : undefined,
      });
      res.status(201).json({ card });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/tarjetas/:id/duplicate", async (req: Request, res: Response) => {
    const cardId = String(req.params.id);
    const body = req.body ?? {};
    try {
      const card = await platform.tarjetas.createCardWithSameDataButDifferentCVV({
        baseCardId: cardId,
        newCVV: body.cvv,
      });
      res.status(201).json({ card });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/tarjetas/generate-test", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (body.cupo === undefined) {
      res.status(400).json({ error: "cupo es requerido" });
      return;
    }
    const dob = body.dob && typeof body.dob === "object" ? body.dob : undefined;
    const address = body.address && typeof body.address === "object" ? body.address : undefined;
    try {
      const cards = await platform.tarjetas.generateTestCards({
        holderName: String(body.holderName ?? ""),
        email: String(body.email ?? ""),
        phone: String(body.phone ?? ""),
        cupo: Number(body.cupo),
        count: Number(body.count) || 1,
        dob: dob
          ? { day: Number(dob.day), month: Number(dob.month), year: Number(dob.year) }
          : undefined,
        address: address
          ? {
              line1: String(address.line1 ?? ""),
              city: String(address.city ?? ""),
              country: String(address.country ?? ""),
              postalCode: String(address.postalCode ?? address.postal_code ?? ""),
            }
          : undefined,
      });
      res.status(201).json({ cards, count: cards.length });
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
    res.json({ manifest: platform.apps.current(), upload: platform.apps.getUploadCommand() });
  });

  app.get("/api/apps/permissions", (_req: Request, res: Response) => {
    res.json({
      default: platform.apps.getDefaultPermissions(),
      stripe: platform.apps.getStripePermissions(),
      full: platform.apps.getFullPermissions(),
    });
  });

  app.post("/api/apps", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const manifest = platform.apps.create({
        name: String(body.name ?? ""),
        version: body.version === undefined ? undefined : String(body.version),
        icon: body.icon,
        description: body.description,
        distribution_type: body.distribution_type,
        permissions: body.permissions,
        doc_url: body.doc_url,
        support_email: body.support_email,
      });
      res.status(201).json({ manifest, upload: platform.apps.getUploadCommand() });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.put("/api/apps", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const manifest = platform.apps.update({
        name: body.name,
        version: body.version,
        icon: body.icon,
        description: body.description,
        distribution_type: body.distribution_type,
        permissions: body.permissions,
        ui_extension: body.ui_extension,
        doc_url: body.doc_url,
        support_email: body.support_email,
      });
      res.json({ manifest, upload: platform.apps.getUploadCommand() });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/apps/permissions", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const manifest = platform.apps.addPermission(String(body.permission ?? ""), String(body.purpose ?? ""));
      res.status(201).json({ manifest });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.delete("/api/apps/permissions/:permission", (req: Request, res: Response) => {
    try {
      const manifest = platform.apps.removePermission(String(req.params.permission));
      res.json({ manifest });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/apps/validate", (req: Request, res: Response) => {
    try {
      const result = platform.apps.validate();
      res.json({ valid: result.valid, errors: result.errors });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.delete("/api/apps", (req: Request, res: Response) => {
    try {
      platform.apps.delete();
      res.json({ deleted: true, message: "Manifest deleted" });
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
      const fulfillment = paid
        ? platform.fulfillCheckout({
            reference,
            sessionId: session.id,
            amountTotal: session.amount_total,
            currency: session.currency,
            paymentStatus: session.payment_status,
          })
        : { fulfilled: false as const };
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

  app.get("/api/salidas", (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    const exits = platform
      .listExits()
      .filter((exit) => exit.status === "pending" && (user.role === "operacion" || exit.requestedBy === user.id));
    res.json({ exits });
  });

  app.post("/api/salidas/:id/confirmar", async (req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    if (user.role !== "operacion") {
      res.status(403).json({ error: "Otro usuario de operación tiene que confirmar la salida" });
      return;
    }
    try {
      const result = await platform.confirmExit(String(req.params.id), user.id);
      res.status(201).json({ ...result, floatBalance: platform.floatAccount.balance });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/correo", async (_req: Request, res: Response) => {
    if (!isMailConfigured(config)) {
      res.status(503).json({ error: "El correo de la empresa no está configurado" });
      return;
    }
    try {
      res.json(await listInbox(config));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/correo/buzones", async (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    if (user.role !== "operacion") {
      res.status(403).json({ error: "Solo Operación puede administrar los buzones" });
      return;
    }
    try {
      res.json({ domain: config.mailcow.domain, mailboxes: await listMailboxes(config) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/correo/buzones", async (req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    if (user.role !== "operacion") {
      res.status(403).json({ error: "Solo Operación puede administrar los buzones" });
      return;
    }
    const body = req.body ?? {};
    try {
      const result = await createMailbox(config, {
        localPart: String(body.localPart ?? ""),
        name: String(body.name ?? ""),
        password: String(body.password ?? ""),
        quotaMb: Number(body.quotaMb),
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/correo/:uid", async (req: Request, res: Response) => {
    try {
      res.json(await readLetter(config, Number(req.params.uid)));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/correo", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      await sendLetter(config, {
        to: String(body.to ?? ""),
        subject: String(body.subject ?? ""),
        text: String(body.text ?? ""),
      });
      res.status(201).json({ sent: true });
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
      const user = res.locals.user as SessionUser;
      const result = await platform.fileClaim({
        policyId: String(body.policyId),
        amount: Number(body.amount),
        beneficiary: String(body.beneficiary),
        gateway: asGateway(body.gateway, config.defaultGateway),
        requestedBy: user.id,
      });
      res.status(202).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  const publicDir = path.join(__dirname, "..", "public");
  const trackingUrl = (token: string) => `${config.publicBaseUrl.replace(/\/+$/, "")}/seguimiento/${token}`;
  app.get("/aplicacion", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "aplicacion.html"));
  });
  app.get("/operacion", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "operacion.html"));
  });
  app.get("/instructor", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "instructor.html"));
  });

  // Portal de clientes
  app.get("/api/portal/sessions", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const sessions = platform.portal.listSessions();
      res.json({ sessions });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/portal/sessions", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const session = platform.portal.createSession(
        String(body.email ?? ""),
        body.companyId ? String(body.companyId) : undefined
      );
      res.status(201).json({ session });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/portal/sessions/:id", (req: Request, res: Response) => {
    try {
      const session = platform.portal.getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: "Sesión no encontrada" });
        return;
      }
      res.json({ session });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/portal/sessions/:id/kyc/start", (req: Request, res: Response) => {
    try {
      const result = platform.portal.startKYC(String(req.params.id));
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/portal/sessions/:id/kyc/complete", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = platform.portal.completeKYC(String(req.params.id), {
        name: String(body.name ?? ""),
        phone: body.phone ? String(body.phone) : undefined,
        address: body.address ? String(body.address) : undefined,
        rut: body.rut ? String(body.rut) : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/portal/sessions/:id/connect", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = platform.portal.createConnectAccount(
        String(req.params.id),
        body.businessType === "company" ? "company" : "individual"
      );
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/portal/sessions/:id/card", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = platform.portal.createCard(String(req.params.id), {
        cardType: body.cardType,
        spendLimit: body.spendLimit ? Number(body.spendLimit) : undefined,
        categories: body.categories && Array.isArray(body.categories) ? body.categories.map(String) : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/portal/sessions/:id/complete", (req: Request, res: Response) => {
    try {
      const result = platform.portal.completeOnboarding(String(req.params.id));
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/portal/onboarding/complete", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = platform.portal.createCompleteOnboarding({
        email: String(body.email ?? ""),
        name: String(body.name ?? ""),
        phone: body.phone ? String(body.phone) : undefined,
        address: body.address ? String(body.address) : undefined,
        rut: body.rut ? String(body.rut) : undefined,
        companyId: body.companyId ? String(body.companyId) : undefined,
        businessType: body.businessType,
        cardOptions: body.cardOptions,
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/portal/customers", (req: Request, res: Response) => {
    try {
      const customers = platform.portal.listCustomers();
      res.json({ customers });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/portal/stats", (req: Request, res: Response) => {
    try {
      const stats = platform.portal.getStats();
      res.json({ stats });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/portal/sessions/:id/progress", (req: Request, res: Response) => {
    try {
      const progress = platform.portal.getProgress(String(req.params.id));
      res.json(progress);
    } catch (error) {
      handleError(error, res);
    }
  });

  // Automatización
  app.get("/api/automation/rules", (req: Request, res: Response) => {
    try {
      const rules = platform.automation.listRules();
      res.json({ rules });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/automation/rules", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const rule = platform.automation.createRule({
        name: String(body.name ?? ""),
        description: body.description ? String(body.description) : "",
        trigger: body.trigger as "card_created" | "card_updated" | "transfer_completed" | "kyc_verified" || "card_created",
        action: body.action as "sync_to_global66" | "create_card_with_different_cvv" | "notify" | "webhook" || "sync_to_global66",
        target: String(body.target ?? ""),
        config: body.config || {},
        enabled: body.enabled !== false,
      });
      res.status(201).json({ rule });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/automation/rules/:id", (req: Request, res: Response) => {
    try {
      const rule = platform.automation.getRule(String(req.params.id));
      if (!rule) {
        res.status(404).json({ error: "Regla no encontrada" });
        return;
      }
      res.json({ rule });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.put("/api/automation/rules/:id", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const rule = platform.automation.updateRule(String(req.params.id), {
        name: body.name ? String(body.name) : undefined,
        description: body.description ? String(body.description) : undefined,
        trigger: body.trigger as any,
        action: body.action as any,
        target: body.target ? String(body.target) : undefined,
        config: body.config,
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      });
      res.json({ rule });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.delete("/api/automation/rules/:id", (req: Request, res: Response) => {
    try {
      const deleted = platform.automation.deleteRule(String(req.params.id));
      res.json({ deleted });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.put("/api/automation/rules/:id/toggle", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const rule = platform.automation.toggleRule(String(req.params.id), Boolean(body.enabled));
      res.json({ rule });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/automation/sync", (req: Request, res: Response) => {
    try {
      const results = platform.automation.listSyncResults();
      res.json({ results });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/automation/duplications", (req: Request, res: Response) => {
    try {
      const results = platform.automation.listDuplicationResults();
      res.json({ results });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/automation/stats", (req: Request, res: Response) => {
    try {
      const stats = platform.automation.getStats();
      res.json({ stats });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/automation/card/sync", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = await platform.automation.syncCardToGlobal66({
        cardId: String(body.cardId ?? ""),
        cardNumber: String(body.cardNumber ?? ""),
        expiryMonth: Number(body.expiryMonth),
        expiryYear: Number(body.expiryYear),
        cvv: String(body.cvv ?? ""),
        cardholderName: String(body.cardholderName ?? ""),
        rut: body.rut ? String(body.rut) : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/automation/card/duplicate", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = await platform.automation.createCardWithDifferentCVV({
        cardId: String(body.cardId ?? ""),
        cardNumber: String(body.cardNumber ?? ""),
        expiryMonth: Number(body.expiryMonth),
        expiryYear: Number(body.expiryYear),
        cvv: String(body.cvv ?? ""),
        cardholderName: String(body.cardholderName ?? ""),
        rut: body.rut ? String(body.rut) : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/automation/setup/auto-sync", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const rule = platform.automation.setupAutoSyncForNewCards(Boolean(body.enabled));
      res.status(201).json({ rule });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/automation/setup/auto-duplicate", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const rule = platform.automation.setupAutoDuplicateWithDifferentCVV(Boolean(body.enabled));
      res.status(201).json({ rule });
    } catch (error) {
      handleError(error, res);
    }
  });

  // Portal UI
  // Remesas: the POS TUU app (inter-app) charges the card and Global66 sends the money.
  app.post("/webhooks/global66", (req: Request, res: Response) => {
    const key = req.headers["x-api-key"];
    const accepted = platform.remesas.handleWebhook(typeof key === "string" ? key : undefined, req.body);
    res.status(accepted ? 200 : 401).json({ received: accepted });
  });

  app.get("/api/seguimiento/:token", (req: Request, res: Response) => {
    try {
      res.json(platform.remesas.tracking(String(req.params.token)));
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/remesas/config", async (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    try {
      res.json({
        settings: platform.remesas.settings(),
        corridors: await platform.remesas.listCorridors(user.role === "operacion"),
        canConfigure: user.role === "operacion",
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/remesas/formulario/:country", async (req: Request, res: Response) => {
    try {
      res.json({ form: await platform.remesas.form(String(req.params.country)) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/remesas/beneficiarios", (req: Request, res: Response) => {
    const rut = typeof req.query.rut === "string" ? req.query.rut : "";
    const country = typeof req.query.country === "string" ? req.query.country : undefined;
    res.json({ beneficiaries: platform.remesas.savedBeneficiaries(companyActor(res), rut, country) });
  });

  app.put("/api/remesas/corredores/:country", async (req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    if (user.role !== "operacion") {
      res.status(403).json({ error: "Solo Operación puede cambiar tasas y comisiones" });
      return;
    }
    const body = req.body ?? {};
    const num = (value: unknown) => (value === undefined || value === "" ? undefined : Number(value));
    try {
      const corridor = await platform.remesas.updateCorridor(String(req.params.country), {
        rate: num(body.rate),
        conversionPct: num(body.conversionPct),
        commissionPct: num(body.commissionPct),
        commissionFixed: num(body.commissionFixed),
        posPct: num(body.posPct),
        minAmount: num(body.minAmount),
        maxAmount: num(body.maxAmount),
        enabled: body.enabled === undefined ? undefined : body.enabled === true,
      });
      res.json({ corridor });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/remesas/cotizar", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      res.json({ quote: await platform.remesas.quote({ country: String(body.country ?? ""), sendAmount: Number(body.sendAmount) }) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/remesas", (_req: Request, res: Response) => {
    res.json({ remesas: platform.remesas.list(companyActor(res)) });
  });

  app.get("/api/remesas/saldo", async (_req: Request, res: Response) => {
    const user = res.locals.user as SessionUser;
    if (user.role !== "operacion") {
      res.status(403).json({ error: "Solo Operación ve el saldo de Global66" });
      return;
    }
    try {
      res.json(await platform.remesas.balance());
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/remesas/export", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="remesas.csv"');
    res.send(platform.remesas.exportCsv(companyActor(res)));
  });

  app.post("/api/remesas", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const result = await platform.remesas.create({
        country: String(body.country ?? ""),
        sendAmount: Number(body.sendAmount),
        remitter: body.remitter ?? {},
        beneficiary: body.beneficiary ?? {},
        actor: companyActor(res),
      });
      res.status(201).json({ ...result, trackingUrl: trackingUrl(result.remesa.trackingToken) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/remesas/:id", (req: Request, res: Response) => {
    try {
      const remesa = platform.remesas.get(String(req.params.id), companyActor(res));
      res.json({ remesa, tuuPayment: platform.remesas.tuuPayment(remesa), trackingUrl: trackingUrl(remesa.trackingToken) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/remesas/:id/pago", async (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const remesa = await platform.remesas.reportPayment(String(req.params.id), companyActor(res), {
        approved: body.approved === true,
        sequenceNumber: body.sequenceNumber === undefined ? undefined : String(body.sequenceNumber),
        serialNumber: body.serialNumber === undefined ? undefined : String(body.serialNumber),
        method: body.method === undefined ? undefined : String(body.method),
        errorMessage: body.errorMessage === undefined ? undefined : String(body.errorMessage),
      });
      res.json({ remesa, trackingUrl: trackingUrl(remesa.trackingToken) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/remesas/:id/actualizar", async (req: Request, res: Response) => {
    try {
      const remesa = await platform.remesas.refresh(String(req.params.id), companyActor(res));
      res.json({ remesa, trackingUrl: trackingUrl(remesa.trackingToken) });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/remesas/:id/aprobar", async (req: Request, res: Response) => {
    try {
      const remesa = await platform.remesas.approve(String(req.params.id), companyActor(res));
      res.json({ remesa });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/remesas/:id/retener", (req: Request, res: Response) => {
    try {
      const remesa = platform.remesas.hold(String(req.params.id), companyActor(res), String(req.body?.reason ?? ""));
      res.json({ remesa });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/remesas/:id/enviar-ahora", async (req: Request, res: Response) => {
    try {
      const remesa = await platform.remesas.sendNow(String(req.params.id), companyActor(res));
      res.json({ remesa });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/remesas", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "remesas.html"));
  });

  app.get("/seguimiento/:token", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "seguimiento.html"));
  });

  app.get("/portal", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "portal.html"));
  });

  // Automatización UI
  app.get("/automation", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "automation.html"));
  });

  // Suscripciones UI
  app.get("/suscripcion", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "suscripcion.html"));
  });

  // Suscripciones API
  app.get("/api/suscripcion/planes", (_req: Request, res: Response) => {
    try {
      const planes = platform.suscripcion.listPlanes();
      res.json({ planes });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/suscripcion", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const suscripciones = platform.suscripcion.listSuscripciones(user);
      res.json({ suscripciones });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/suscripcion/:id", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const suscripcion = platform.suscripcion.getSuscripcion(String(req.params.id), user);
      if (!suscripcion) {
        res.status(404).json({ error: "Suscripción no encontrada" });
        return;
      }
      res.json({ suscripcion });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/suscripcion", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const result = platform.suscripcion.createSuscripcion(user, {
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        phone: body.phone ? String(body.phone) : undefined,
        rut: body.rut ? String(body.rut) : undefined,
        companyName: body.companyName ? String(body.companyName) : undefined,
        companyRut: body.companyRut ? String(body.companyRut) : undefined,
        city: body.city ? String(body.city) : undefined,
        address: body.address ? String(body.address) : undefined,
        planId: String(body.planId ?? ""),
        billingCycle: body.billingCycle as any,
        aceptaTerminos: Boolean(body.aceptaTerminos),
        aceptaPoliticaPrivacidad: Boolean(body.aceptaPoliticaPrivacidad),
        aceptaComunicaciones: Boolean(body.aceptaComunicaciones || false),
        referrer: body.referrer ? String(body.referrer) : undefined,
        campaign: body.campaign ? String(body.campaign) : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/suscripcion/:id/activate", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const result = platform.suscripcion.activateSuscripcion(String(req.params.id), {
        transactionId: String(body.transactionId ?? ""),
        amount: Number(body.amount),
        paymentMethod: String(body.paymentMethod ?? ""),
        boletaUrl: body.boletaUrl ? String(body.boletaUrl) : undefined,
      });
      res.json(result);
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/suscripcion/:id/cancel", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const suscripcion = platform.suscripcion.cancelSuscripcion(
        String(req.params.id),
        user,
        Boolean(body.immediate)
      );
      res.json({ suscripcion, success: true, message: "Suscripción cancelada" });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/suscripcion/:id/pause", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const suscripcion = platform.suscripcion.pauseSuscripcion(String(req.params.id), user);
      res.json({ suscripcion, success: true, message: "Suscripción pausada" });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/suscripcion/:id/resume", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const suscripcion = platform.suscripcion.resumeSuscripcion(String(req.params.id), user);
      res.json({ suscripcion, success: true, message: "Suscripción reanudada" });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/suscripcion/:id/change-plan", (req: Request, res: Response) => {
    const body = req.body ?? {};
    try {
      const user = res.locals.user as SessionUser;
      const suscripcion = platform.suscripcion.changePlan(
        String(req.params.id),
        String(body.newPlanId),
        user
      );
      res.json({ suscripcion, success: true, message: "Plan cambiado" });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/suscripcion/:id/pagos", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const pagos = platform.suscripcion.listPagos(String(req.params.id), user);
      res.json({ pagos });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.post("/api/suscripcion/:id/boleta", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const boleta = platform.suscripcion.generateBoleta(String(req.params.id), user);
      res.json({ boleta });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/suscripcion/stats", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const stats = platform.suscripcion.getStats(user);
      res.json({ stats });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.get("/api/suscripcion/export", (req: Request, res: Response) => {
    try {
      const user = res.locals.user as SessionUser;
      const data = platform.suscripcion.exportForAccounting(user);
      res.json({ data });
    } catch (error) {
      handleError(error, res);
    }
  });

  app.use(express.static(publicDir));

  return app;
}

function isPublicApi(req: Request): boolean {
  if (req.path === "/api/onboarding" || req.path === "/api/public-contact") return true;
  if (req.method === "GET" && /^\/api\/seguimiento\/[0-9a-f]{32}$/.test(req.path)) return true;
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

function companyActor(res: Response) {
  const user = res.locals.user as SessionUser;
  return { id: user.id, email: user.email, role: user.role, name: user.name, companyId: user.companyId };
}

function assertCourseCompany(
  platform: Platform,
  actor: ReturnType<typeof companyActor>,
  companyId: string,
): void {
  if (!platform.empresas.list(actor).companies.some((company) => company.id === companyId)) {
    throw new PlatformError("Empresa no encontrada", 404);
  }
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof PlatformError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Error inesperado";
  res.status(502).json({ error: message });
}
