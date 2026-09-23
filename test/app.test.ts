import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { DEFAULT_SEED_PASSWORD, loadConfig } from "../src/config.js";
import { activateVirtualGift, issueVirtualGift } from "../src/modules/regalos/issue.js";
import { Platform } from "../src/platform.js";

const TEST_PASSWORD = "Operacion.1831";

function app(env: NodeJS.ProcessEnv = {}) {
  return createApp(loadConfig({ PORT: "3000", CURRENCY: "clp", DATABASE_PATH: ":memory:", ...env }));
}

async function signedIn(
  server: ReturnType<typeof app>,
  email = "operacion@proveedorregional.cl",
  password = DEFAULT_SEED_PASSWORD,
) {
  const agent = request.agent(server);
  const login = await agent.post("/api/session").send({ email, password });
  expect(login.status).toBe(201);
  if (login.body.user.mustChangePassword) {
    const changed = await agent.post("/api/session/password").send({
      currentPassword: password,
      newPassword: TEST_PASSWORD,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
  }
  return agent;
}

async function confirmExit(server: ReturnType<typeof app>, exitId: string) {
  const control = await signedIn(server, "control@proveedorregional.cl");
  return control.post(`/api/salidas/${exitId}/confirmar`);
}

function creditPolicy(overrides: Record<string, unknown> = {}) {
  return {
    holderName: "Ana Díaz",
    email: "ana@demo.cl",
    cardLabel: "Visa •••• 4242",
    cupo: 1_500_000,
    gateway: "chile",
    ...overrides,
  };
}

describe("instripe BaaS platform", () => {
  it("reports health in demo mode with CLP and Chile default gateway", async () => {
    const res = await request(app()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.currency).toBe("clp");
    expect(res.body.defaultGateway).toBe("chile");
    expect(res.body.stripeConfigured).toBe(false);
    expect(res.body.chileConfigured).toBe(false);
  });

  it("lists both gateways", async () => {
    const res = await (await signedIn(app())).get("/api/gateways");
    expect(res.status).toBe(200);
    const names = res.body.gateways.map((g: { name: string }) => g.name).sort();
    expect(names).toEqual(["chile", "stripe"]);
  });

  it("lists the credit-card credit policy", async () => {
    const res = await (await signedIn(app())).get("/api/plans");
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(2);
    expect(res.body.plans[0].id).toBe("credito-tc");
    expect(res.body.plans[0].rateBps).toBe(60);
    expect(res.body.plans[0].displayRate).toBe("0,60%");
    expect(res.body.plans[0].opensCredit).toBe(true);
    expect(res.body.plans[1]).toMatchObject({
      id: "frosting",
      pricing: "workers",
      opensCredit: false,
      displayRate: "trabajadores × tasa",
    });
  });

  it("subscribes to a plan via the Chile gateway and credits the float", async () => {
    const server = app();
    const client = await signedIn(server);
    const res = await client
      .post("/api/policies")
      .send(creditPolicy());
    expect(res.status).toBe(201);
    expect(res.body.policy.status).toBe("active");
    expect(res.body.policy.cardLabel).toBe("Visa •••• 4242");
    expect(res.body.policy.cupo).toBe(1_500_000);
    expect(res.body.policy.premium).toBe(9000);
    expect(res.body.charge.gateway).toBe("chile");
    expect(res.body.charge.mode).toBe("demo");

    const overview = await client.get("/api/overview");
    expect(overview.body.float.balance).toBe(9000);
    expect(overview.body.policies).toHaveLength(1);
    expect(overview.body.modules.map((m: { id: string }) => m.id).sort()).toEqual([
      "apps",
      "cobros",
      "connect",
      "cuentas",
      "diseno",
      "empresas",
      "laboral",
      "registro",
      "seguros",
      "tarjetas",
      "treasury",
    ]);
    expect(overview.body.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ module: "seguros", kind: "collect", status: "paid", reference: res.body.policy.id }),
      ]),
    );
    expect(res.body.policy.paymentId).toMatch(/^pay_/);
  });

  it("subscribes via Stripe gateway in demo mode and activates immediately", async () => {
    const server = app();
    const client = await signedIn(server);
    const res = await client
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Bkr SpA", email: "ops@bkr.cl", gateway: "stripe" }));
    expect(res.status).toBe(201);
    expect(res.body.policy.status).toBe("active");
    expect(res.body.charge.gateway).toBe("stripe");
    expect(res.body.charge.clientSecret).toBeUndefined();
    expect(res.body.charge.redirectUrl).toContain("charge=");

    const overview = await client.get("/api/overview");
    expect(overview.body.float.balance).toBe(9000);
  });

  it("disperses a claim payout and debits the float (dispersión de fondos)", async () => {
    const server = app();
    const client = await signedIn(server);
    const sub = await client
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Bkr SpA", email: "ops@bkr.cl", cupo: 5_000_000 }));
    const policyId = sub.body.policy.id;

    const claim = await client
      .post("/api/claims")
      .send({ policyId, amount: 20000, beneficiary: "11.111.111-1", gateway: "chile" });
    expect(claim.status).toBe(202);
    expect(claim.body.claim.status).toBe("pending");
    expect(claim.body.floatBalance).toBe(30000);
    const confirmed = await confirmExit(server, claim.body.exitId);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.payout.gateway).toBe("chile");
    expect(confirmed.body.exit.requestedBy).not.toBe(confirmed.body.exit.authorizedBy);
    // premium is 0,60% of 5.000.000 = 30.000; payout 20.000 leaves 10.000
    expect(confirmed.body.floatBalance).toBe(10000);
  });

  it("rejects a claim above coverage", async () => {
    const server = app();
    const client = await signedIn(server);
    const sub = await client
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Ana", email: "ana@demo.cl" }));
    const res = await client
      .post("/api/claims")
      .send({ policyId: sub.body.policy.id, amount: 99999999, beneficiary: "x" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("crédito");
  });

  it("rejects a claim when the float has insufficient funds", async () => {
    const server = app();
    const client = await signedIn(server);
    const sub = await client
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Ana", email: "ana@demo.cl" }));
    // insured credit is 1.500.000 but the wallet only holds the 9.000 premium
    const res = await client
      .post("/api/claims")
      .send({ policyId: sub.body.policy.id, amount: 500000, beneficiary: "x" });
    expect(res.status).toBe(202);
    const confirmed = await confirmExit(server, res.body.exitId);
    expect(confirmed.status).toBe(502);
    expect(confirmed.body.error).toContain("Insufficient funds");
    expect((await client.get("/api/overview")).body.float.balance).toBe(9000);
  });

  it("validates required fields", async () => {
    const res = await (await signedIn(app())).post("/api/policies").send({ holderName: "Ana" });
    expect(res.status).toBe(400);
  });

  it("keeps the float unchanged until a pending Stripe policy is fulfilled, once", () => {
    const platform = new Platform(loadConfig({ PORT: "3000", CURRENCY: "clp", DATABASE_PATH: ":memory:" }));
    const policy = platform.listPolicies()[0];
    expect(policy).toBeUndefined();

    const { policy: created } = platform.holdPremium({
      holderName: "Ana Díaz",
      email: "ana@demo.cl",
      cardLabel: "Visa •••• 4242",
      cupo: 1_500_000,
    });
    expect(created.status).toBe("pending_payment");
    expect(platform.floatAccount.balance).toBe(0);

    const wrong = platform.fulfillCheckout({
      reference: created.id,
      sessionId: "cs_test_1",
      amountTotal: 1,
      currency: "clp",
      paymentStatus: "paid",
    });
    expect(wrong.fulfilled).toBe(false);
    expect(platform.floatAccount.balance).toBe(0);

    const unpaid = platform.fulfillCheckout({
      reference: created.id,
      sessionId: "cs_test_1",
      amountTotal: 9000,
      currency: "clp",
      paymentStatus: "no_payment_required",
    });
    expect(unpaid.fulfilled).toBe(false);

    const first = platform.fulfillCheckout({
      reference: created.id,
      sessionId: "cs_test_1",
      amountTotal: 9000,
      currency: "clp",
      paymentStatus: "paid",
    });
    expect(first).toMatchObject({ fulfilled: true, module: "seguros", reference: created.id });
    expect(platform.floatAccount.balance).toBe(9000);
    expect(platform.transferableAccount.balance).toBe(0);
    expect(platform.listPolicies()[0]?.status).toBe("active");

    const second = platform.fulfillCheckout({
      reference: created.id,
      sessionId: "cs_test_1",
      amountTotal: 9000,
      currency: "clp",
      paymentStatus: "paid",
    });
    expect(second.fulfilled).toBe(false);
    expect(platform.floatAccount.balance).toBe(9000);
  });

  it("rejects a claim on a policy that is still awaiting payment", async () => {
    const platform = new Platform(loadConfig({ PORT: "3000", CURRENCY: "clp", DATABASE_PATH: ":memory:" }));
    const { policy: created } = platform.holdPremium({
      holderName: "Ana Díaz",
      email: "ana@demo.cl",
      cardLabel: "Visa •••• 4242",
      cupo: 1_500_000,
    });
    await expect(
      platform.fileClaim({
        policyId: created.id,
        amount: 1000,
        beneficiary: "12.345.678-9",
        gateway: "chile",
        requestedBy: "usr_operacion",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns 409 when retrieving a checkout session without Stripe", async () => {
    const res = await (await signedIn(app())).get("/api/checkout/sessions/cs_test_missing");
    expect(res.status).toBe(409);
  });

  it("accepts a Stripe webhook (demo fallback) and records the event", async () => {
    const server = app();
    const payload = { id: "evt_test_123", type: "checkout.session.completed", data: { object: { id: "cs_test_1", amount_total: 49000, currency: "clp" } } };
    const res = await request(server)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, type: "checkout.session.completed", fulfilled: false });

    const events = await (await signedIn(server)).get("/api/stripe/events");
    expect(events.body.events[0]).toMatchObject({ id: "evt_test_123", type: "checkout.session.completed" });
  });

  it("funds a BaaS account through payments and withdraws from that balance", async () => {
    const server = app();
    const client = await signedIn(server);
    const opened = await client.post("/api/cuentas").send({ name: "Taller Sur", email: "caja@taller.cl" });
    expect(opened.status).toBe(201);
    const id = opened.body.account.id;

    const fund = await client.post(`/api/cuentas/${id}/recarga`).send({ amount: 10000, gateway: "chile" });
    expect(fund.status).toBe(201);
    expect(fund.body.account.balance).toBe(10000);
    expect(fund.body.topup.status).toBe("paid");

    const withdraw = await client
      .post(`/api/cuentas/${id}/retiro`)
      .send({ amount: 4000, destination: "12.345.678-9", gateway: "chile" });
    expect(withdraw.status).toBe(202);
    expect(withdraw.body.account.balance).toBe(10000);
    const confirmed = await confirmExit(server, withdraw.body.exitId);
    expect(confirmed.status).toBe(201);
    expect((await client.get("/api/cuentas")).body.accounts.find((account: { id: string }) => account.id === id).balance).toBe(6000);

    const tooMuch = await client
      .post(`/api/cuentas/${id}/retiro`)
      .send({ amount: 99999, destination: "12.345.678-9", gateway: "chile" });
    expect(tooMuch.status).toBe(422);

    const payments = await client.get("/api/payments");
    const modules = payments.body.payments.map((p: { module: string }) => p.module);
    expect(modules).toContain("cuentas");
  });

  it("settles a cobro reference as cobros, not as a policy", () => {
    const platform = new Platform(loadConfig({ PORT: "3000", CURRENCY: "clp", DATABASE_PATH: ":memory:" }));
    platform.payments.openCollect({
      module: "cobros",
      reference: "cob_demo",
      amount: 15000,
      description: "Mantención mensual",
    });
    const result = platform.fulfillCheckout({
      reference: "cob_demo",
      sessionId: "cs_test_cob",
      amountTotal: 15000,
      currency: "clp",
      paymentStatus: "paid",
    });
    expect(result).toEqual({ fulfilled: true, reference: "cob_demo", module: "cobros" });
    expect(platform.listPolicies()).toHaveLength(0);
    expect(platform.floatAccount.balance).toBe(15000);
  });

  it("collects a cobro through payments without creating a policy", async () => {
    const server = app();
    const client = await signedIn(server);
    const res = await client.post("/api/cobros").send({
      concept: "Mantención mensual",
      payerName: "Oficina Norte",
      email: "pago@norte.cl",
      amount: 15000,
      gateway: "chile",
    });
    expect(res.status).toBe(201);
    expect(res.body.cobro.status).toBe("paid");
    expect(res.body.cobro.paymentId).toMatch(/^pay_/);

    const overview = await client.get("/api/overview");
    expect(overview.body.policies).toHaveLength(0);
    expect(overview.body.float.balance).toBe(15000);
    expect(overview.body.payments[0]).toMatchObject({ module: "cobros", kind: "collect", status: "paid" });
  });

  it("opens Connect, Treasury, a card and an app without treating them as policies", async () => {
    const manifestPath = `/tmp/instripe-app-${Date.now()}.json`;
    const server = app({ PORT: "3000", CURRENCY: "clp", APP_MANIFEST_PATH: manifestPath });
    const client = await signedIn(server);

    const connect = await client.post("/api/connect").send({ businessName: "Taller Sur", email: "caja@taller.cl" });
    expect(connect.status).toBe(201);
    expect(connect.body.account.id).toMatch(/^con_/);
    expect(connect.body.account.mode).toBe("demo");
    expect(connect.body.account.country).toBe("CL");

    const funded = await client.post("/api/cobros").send({
      concept: "Fondo",
      payerName: "Caja",
      email: "caja@taller.cl",
      amount: 20000,
      gateway: "chile",
    });
    expect(funded.status).toBe(201);

    const payout = await client.post(`/api/connect/${connect.body.account.id}/pago`).send({ amount: 5000, gateway: "chile" });
    expect(payout.status).toBe(202);
    const confirmed = await confirmExit(server, payout.body.exitId);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.payout.destination).toBe(connect.body.account.id);

    const treasury = await client.post("/api/treasury").send({ nickname: "Caja principal" });
    expect(treasury.status).toBe(201);
    expect(treasury.body.account.mode).toBe("demo");
    const abono = await client.post(`/api/treasury/${treasury.body.account.id}/abono`).send({ amount: 8000, gateway: "chile" });
    expect(abono.status).toBe(201);

    const card = await client.post("/api/tarjetas").send({
      holderName: "Ana Díaz",
      email: "ana@demo.cl",
      phone: "+34910000000",
      cupo: 1_500_000,
    });
    expect(card.status).toBe(201);
    expect(card.body.card.last4).toHaveLength(4);
    expect(card.body.card.cupo).toBe(1_500_000);
    expect(card.body.card.mode).toBe("demo");
    expect(card.body.card.stripeCardId).toBeUndefined();
    expect(card.body.card.number).toBeUndefined();
    const listed = await client.get("/api/tarjetas");
    expect(listed.body.issuing).toMatchObject({ stripeConfigured: false, active: false, chargesEnabled: false });
    expect(listed.body.cards).toHaveLength(1);

    const design = await client.post("/api/diseno").send({
      displayName: "instripe",
      buttonColor: "#112233",
      backgroundColor: "#f5f7fb",
      borderStyle: "pill",
      carrierTitle: "Tu tarjeta",
      carrierBody: "Crédito de la plataforma",
    });
    expect(design.status).toBe(200);
    expect(design.body.design.buttonColor).toBe("#112233");

    const blocked = await client.post("/api/apps").send({ name: "Stripe Gratis" });
    expect(blocked.status).toBe(400);

    const created = await client.post("/api/apps").send({ name: "Instripe" });
    expect(created.status).toBe(201);
    expect(created.body.manifest.id).toBe("com.houmeecl.instripe");
    expect(created.body.upload).toBe("stripe apps upload");

    const overview = await client.get("/api/overview");
    expect(overview.body.policies).toHaveLength(0);
    expect(overview.body.connect).toHaveLength(1);
    expect(overview.body.treasury[0].balance).toBe(8000);
    expect(overview.body.cards).toHaveLength(1);
    const modules = overview.body.payments.map((p: { module: string }) => p.module);
    expect(modules).toEqual(expect.arrayContaining(["cobros", "connect", "treasury"]));
  });

  it("rejects a webhook without a signature when the secret is set", async () => {
    const server = app({ PORT: "3000", CURRENCY: "clp", STRIPE_SECRET_KEY: "rk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" });
    const res = await request(server)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send({ id: "evt_nosig", type: "checkout.session.completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("signature verification failed");
  });

  it("records an async checkout event without fulfilling an unpaid session", async () => {
    const server = app();
    const res = await request(server)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send({
        id: "evt_async_1",
        type: "checkout.session.async_payment_succeeded",
        data: { object: { id: "cs_async", payment_status: "unpaid" } },
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, type: "checkout.session.async_payment_succeeded", fulfilled: false });
  });

  it("rejects a signed webhook when the signature is invalid", async () => {
    const server = app({ PORT: "3000", CURRENCY: "clp", STRIPE_SECRET_KEY: "rk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" });
    const res = await request(server)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=deadbeef")
      .send({ id: "evt_x", type: "checkout.session.completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("signature verification failed");
  });

  it("serves the landing with an embedded app of pre-registered members", async () => {
    const server = app();
    const landing = await request(server).get("/");
    expect(landing.status).toBe(200);
    expect(landing.text).toContain("Proveedor Regional");
    expect(landing.text).toContain('src="/logo-mark.png"');
    expect(landing.text).toContain('src="/aplicacion"');
    expect(landing.text).toContain("Procesador de pagos");
    expect(landing.text).toContain("El espacio ya está ocupado.");

    const embedded = await request(server).get("/aplicacion");
    expect(embedded.status).toBe(200);
    expect(embedded.text).toContain("Términos");
    expect(embedded.text).toContain("Espacio ocupado");

    const agent = request.agent(server);
    const denied = await agent.post("/api/onboarding").send({ name: "Luis", email: "luis@proveedorregional.cl", accepted: false });
    expect(denied.status).toBe(400);
    const accepted = await agent.post("/api/onboarding").send({ name: "Luis", email: "luis@proveedorregional.cl", accepted: true });
    expect(accepted.status).toBe(201);
    const session = await agent.get("/api/onboarding");
    expect(session.body).toMatchObject({ kind: "tos", accepted: true, space: "ocupado" });
    expect(session.body.acceptance.email).toBe("luis@proveedorregional.cl");

    const registro = await request(server).get("/api/registro");
    expect(registro.status).toBe(200);
    expect(registro.body.domain).toBe("proveedorregional.cl");
    expect(registro.body.members.map((member: { email: string }) => member.email).sort()).toEqual([
      "ana@proveedorregional.cl",
      "caja@taller.cl",
      "pago@norte.cl",
    ]);
    expect(registro.body.members.every((member: { status: string }) => member.status === "preinscrito")).toBe(true);
  });

  it("keeps accounts, balances and terms when a new platform opens the same database", async () => {
    const databasePath = path.join(mkdtempSync(path.join(tmpdir(), "pr-db-")), "platform.db");
    const env = { PORT: "3000", CURRENCY: "clp", DATABASE_PATH: databasePath };
    const first = new Platform(loadConfig(env));
    const opened = first.cuentas.open({ name: "Bodega Centro", email: "bodega@proveedorregional.cl" });
    const funded = await first.cuentas.fund({
      accountId: opened.id,
      amount: 8000,
      gateway: "chile",
      actor: { role: "operacion" },
    });
    expect(funded.account.balance).toBe(8000);
    const accepted = first.registro.acceptTos({ name: "Luis", email: "luis@proveedorregional.cl", accepted: true });

    const second = new Platform(loadConfig(env));
    const again = second.cuentas.list().find((account) => account.email === "bodega@proveedorregional.cl");
    expect(again?.id).toBe(opened.id);
    expect(again?.balance).toBe(8000);
    expect(second.registro.list()).toHaveLength(3);
    expect(second.cuentas.list().filter((account) => account.email === "caja@taller.cl")).toHaveLength(1);
    expect(second.registro.tosSession(accepted.token)?.email).toBe("luis@proveedorregional.cl");
    expect(second.floatAccount.balance).toBe(first.floatAccount.balance);
  });

  it("keeps the dashboard closed until a role signs in", async () => {
    const server = app();
    const anonymous = await request(server).get("/api/overview");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error).toBe("Inicia sesión");

    const wrong = await request(server).post("/api/session").send({
      email: "operacion@proveedorregional.cl",
      password: "clave-incorrecta",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers["set-cookie"]).toBeUndefined();

    const missing = await request(server).post("/api/session").send({ email: "nadie@proveedorregional.cl", password: "Antofagasta.183" });
    expect(missing.status).toBe(401);

    const operacion = await request(server).post("/api/session").send({
      email: "operacion@proveedorregional.cl",
      password: DEFAULT_SEED_PASSWORD,
    });
    expect(operacion.status).toBe(201);
    expect(operacion.body.user).toMatchObject({
      email: "operacion@proveedorregional.cl",
      role: "operacion",
      roleLabel: "Operación",
    });
    expect(operacion.body.user.options).toEqual([
      "overview",
      "accounts",
      "cobros",
      "plans",
      "policies",
      "claims",
      "connect",
      "empresas",
      "treasury",
      "cards",
      "design",
      "apps",
      "payments",
      "clases",
      "configuracion",
      "actuarial",
    ]);
    expect(operacion.body.user.passwordHash).toBeUndefined();
    const cookie = String(operacion.headers["set-cookie"]);
    expect(cookie).toContain("pr_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const secureLogin = await request(app({ PUBLIC_BASE_URL: "https://proveedorregional.cl" }))
      .post("/api/session")
      .send({ email: "operacion@proveedorregional.cl", password: DEFAULT_SEED_PASSWORD });
    expect(String(secureLogin.headers["set-cookie"])).toContain("Secure");

    const comercio = await signedIn(server, "caja@taller.cl");
    const comercioSession = await comercio.get("/api/session");
    expect(comercioSession.body.user.options).toEqual(["overview", "accounts", "cobros", "connect", "empresas", "clases"]);
    const comercioOverview = await comercio.get("/api/overview");
    expect(comercioOverview.status).toBe(200);
    expect(comercioOverview.body.accounts).toBeDefined();
    expect(comercioOverview.body.cobros).toBeDefined();
    expect(comercioOverview.body.connect).toBeDefined();
    expect(comercioOverview.body.payments).toBeUndefined();
    expect(comercioOverview.body.cards).toBeUndefined();
    expect(comercioOverview.body.policies).toBeUndefined();
    const blocked = await comercio.get("/api/payments");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("Esta opción no está en tu rol");
    expect((await comercio.get("/api/tarjetas")).status).toBe(403);
    expect((await comercio.get("/api/gateways")).status).toBe(200);

    const titular = await signedIn(server, "ana@proveedorregional.cl");
    expect((await titular.get("/api/session")).body.user.options).toEqual([
      "overview",
      "plans",
      "policies",
      "claims",
      "cards",
      "empresas",
      "clases",
    ]);
    expect((await titular.get("/api/tarjetas")).status).toBe(200);
    expect((await titular.get("/api/cuentas")).status).toBe(403);
    const titularOverview = await titular.get("/api/overview");
    expect(titularOverview.body.cards).toBeDefined();
    expect(titularOverview.body.policies).toBeDefined();
    expect(titularOverview.body.accounts).toBeUndefined();

    const changed = await titular.post("/api/session/password").send({
      currentPassword: TEST_PASSWORD,
      newPassword: "NuevaClave.183",
    });
    expect(changed.status).toBe(200);
    const stale = await request(server).post("/api/session").send({
      email: "ana@proveedorregional.cl",
      password: DEFAULT_SEED_PASSWORD,
    });
    expect(stale.status).toBe(401);
    const next = await request(server).post("/api/session").send({
      email: "ana@proveedorregional.cl",
      password: "NuevaClave.183",
    });
    expect(next.status).toBe(201);

    const out = await comercio.delete("/api/session");
    expect(out.status).toBe(200);
    expect(out.body.user).toBeNull();
    expect((await comercio.get("/api/overview")).status).toBe(401);
    expect((await request(server).get("/api/empresas")).status).toBe(401);
    expect((await request(server).get("/api/registro")).status).toBe(200);
    expect((await request(server).post("/webhooks/stripe").set("Content-Type", "application/json").send({
      id: "evt_public",
      type: "checkout.session.completed",
      data: { object: { id: "cs_public", payment_status: "unpaid" } },
    })).status).toBe(200);
  });

  it("keeps company prepaid on its own card and lets a worker transfer it back", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const created = await comercio.post("/api/empresas").send({ name: "Taller Sur", color: "#0e3e66" });
    expect(created.status).toBe(201);
    expect(created.body.company.balance).toBe(0);
    expect(created.body.company.last4).toMatch(/^\d{4}$/);
    expect(created.body.company.color).toBe("#0e3e66");
    const id = created.body.company.id;

    const titular = await signedIn(server, "ana@proveedorregional.cl");
    const denied = await titular.post("/api/empresas").send({ name: "Ana", color: "#112233" });
    expect(denied.status).toBe(403);
    expect((await comercio.post(`/api/empresas/${id}/abono`).send({ amount: 50_000 })).status).toBe(403);
    expect((await comercio.post("/api/empresas").send({ name: "Sin color", color: "azul" })).status).toBe(400);

    const operacion = await signedIn(server);
    const funded = await operacion.post(`/api/empresas/${id}/abono`).send({ amount: 50_000 });
    expect(funded.status).toBe(200);
    expect(funded.body.company.balance).toBe(50_000);
    expect((await operacion.get("/api/overview")).body.float.balance).toBe(0);

    const other = await signedIn(server, "pago@norte.cl");
    expect((await other.get("/api/empresas")).body.companies).toEqual([]);
    expect((await other.post(`/api/empresas/${id}/trabajadores`).send({ name: "Ana Díaz", email: "ana@proveedorregional.cl" })).status).toBe(403);

    const withWorker = await comercio.post(`/api/empresas/${id}/trabajadores`).send({
      name: "Ana Díaz",
      email: "ana@proveedorregional.cl",
    });
    expect(withWorker.status).toBe(201);
    const workerId = withWorker.body.company.workers[0].id;
    const moved = await comercio.post(`/api/empresas/${id}/transferencias`).send({
      workerId,
      amount: 20_000,
      direction: "to_worker",
    });
    expect(moved.status).toBe(200);
    expect(moved.body.company.balance).toBe(30_000);
    expect(moved.body.company.canManage).toBe(true);
    expect(moved.body.company.workers[0].displayBalance).toBe("—");
    expect(moved.body.company.workers[0].balance).toBe(0);
    expect((await operacion.get("/api/empresas")).body.companies[0].workers[0].balance).toBe(20_000);

    const own = await titular.get("/api/empresas");
    expect(own.status).toBe(200);
    expect(own.body.canCreate).toBe(false);
    expect(own.body.companies).toHaveLength(1);
    expect(own.body.companies[0].displayBalance).toBe("—");
    expect(own.body.companies[0].workers).toHaveLength(1);
    expect(own.body.companies[0].workers[0].balance).toBe(20_000);
    expect(own.body.companies[0].transfers.every((item: { kind: string }) => item.kind !== "abono")).toBe(true);

    const back = await titular.post(`/api/empresas/${id}/transferencias`).send({
      workerId,
      amount: 5_000,
      direction: "to_company",
    });
    expect(back.status).toBe(200);
    expect(back.body.company.workers[0].balance).toBe(15_000);
    expect(back.body.company.displayBalance).toBe("—");

    const tooMuch = await titular.post(`/api/empresas/${id}/transferencias`).send({
      workerId,
      amount: 999_999,
      direction: "to_company",
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toBe("Saldo insuficiente en la tarjeta");
    expect((await titular.post(`/api/empresas/${id}/transferencias`).send({
      workerId,
      amount: 1_000,
      direction: "to_worker",
    })).status).toBe(403);
    expect((await operacion.get("/api/overview")).body.float.balance).toBe(0);
    expect((await operacion.get("/api/empresas")).body.companies[0].balance).toBe(35_000);
    expect((await operacion.get("/api/empresas")).body.companies[0].workers[0].balance).toBe(15_000);
    const companyView = await comercio.get("/api/empresas");
    expect(companyView.body.companies[0].balance).toBe(35_000);
    expect(companyView.body.companies[0].workers[0].displayBalance).toBe("—");
    expect(companyView.body.companies[0].workers[0].balance).toBe(0);
  });

  it("does not let a demo collection fund a Transfer, and reverses a rejected one", async () => {
    const server = app();
    const client = await signedIn(server);
    const opened = await client.post("/api/cuentas").send({ name: "Taller Sur", email: "caja@taller.cl" });
    const id = opened.body.account.id;
    await client.post(`/api/cuentas/${id}/recarga`).send({ amount: 10000, gateway: "chile" });
    const book = await client.get("/api/payments");
    expect(book.body.wallet.balance).toBe(10000);
    expect(book.body.transferable.balance).toBe(0);

    const rut = await client.post(`/api/cuentas/${id}/retiro`).send({ amount: 1000, destination: "12.345.678-9", gateway: "stripe" });
    expect(rut.status).toBe(422);
    expect(rut.body.error).toContain("acct_");

    const exit = await client.post(`/api/cuentas/${id}/retiro`).send({ amount: 1000, destination: "acct_reversa", gateway: "stripe" });
    expect(exit.status).toBe(202);
    const rejected = await confirmExit(server, exit.body.exitId);
    expect(rejected.status).toBe(502);
    expect(rejected.body.error).toContain("Transfer rejected");
    const after = await client.get("/api/payments");
    expect(after.body.wallet.balance).toBe(10000);
    expect(after.body.transferable.balance).toBe(0);
    expect((await client.get("/api/cuentas")).body.accounts.find((account: { id: string }) => account.id === id).balance).toBe(10000);

    const self = await client.post(`/api/salidas/${exit.body.exitId}/confirmar`);
    expect(self.status).toBe(403);
  });

  it("settles a webhook only when amount, currency and payment status match, then reverses a refund", async () => {
    const server = app();
    const platform = new Platform(loadConfig({ PORT: "3000", CURRENCY: "clp", DATABASE_PATH: ":memory:" }));
    const { policy } = platform.holdPremium({
      holderName: "Ana Díaz",
      email: "ana@demo.cl",
      cardLabel: "Visa •••• 4242",
      cupo: 1_500_000,
    });
    const paid = await request(server).post("/webhooks/stripe").set("Content-Type", "application/json").send({
      id: "evt_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_paid",
          payment_status: "paid",
          amount_total: 1,
          currency: "clp",
          metadata: { reference: "missing" },
        },
      },
    });
    expect(paid.body.fulfilled).toBe(false);

    const good = platform.fulfillCheckout({
      reference: policy.id,
      sessionId: "cs_paid",
      amountTotal: 9000,
      currency: "usd",
      paymentStatus: "paid",
    });
    expect(good.fulfilled).toBe(false);
    platform.fulfillCheckout({
      reference: policy.id,
      sessionId: "cs_paid",
      amountTotal: 9000,
      currency: "clp",
      paymentStatus: "paid",
    });
    expect(platform.floatAccount.balance).toBe(9000);
    expect(platform.reverseCollection(policy.id, 9000, "evt_refund")).toBe(true);
    expect(platform.floatAccount.balance).toBe(0);
    expect(platform.reverseCollection(policy.id, 9000, "evt_refund")).toBe(false);
  });

  it("blocks the panel until the seed password is replaced and keeps a comercio on its member", async () => {
    const server = app();
    const login = await request(server).post("/api/session").send({
      email: "operacion@proveedorregional.cl",
      password: DEFAULT_SEED_PASSWORD,
    });
    expect(login.body.user.mustChangePassword).toBe(true);
    const agent = request.agent(server);
    await agent.post("/api/session").send({ email: "operacion@proveedorregional.cl", password: DEFAULT_SEED_PASSWORD });
    expect((await agent.get("/api/overview")).status).toBe(403);

    const norte = await signedIn(server, "pago@norte.cl");
    const taller = await signedIn(server, "caja@taller.cl");
    const accounts = await taller.get("/api/cuentas");
    const own = accounts.body.accounts.find((account: { email: string }) => account.email === "caja@taller.cl");
    expect(own.memberId).toBe("reg_taller");
    expect((await norte.post(`/api/cuentas/${own.id}/retiro`).send({ amount: 1, destination: "x", gateway: "chile" })).status).toBe(403);
  });

  it("shows each client their own virtual debit card and keeps demo money out of available funds", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const titular = await signedIn(server, "ana@proveedorregional.cl");
    const operacion = await signedIn(server);
    const created = await comercio.post("/api/empresas").send({ name: "Taller Sur", color: "#0e3e66" });
    const id = created.body.company.id;
    const logo = "https://cdn.ejemplo.cl/taller.png";
    const withLogo = await comercio.post(`/api/empresas/${id}/logo`).send({ logo });
    expect(withLogo.status).toBe(200);
    expect(withLogo.body.company.logo).toBe(logo);
    expect(withLogo.body.company.card.logo).toBe(logo);
    expect(withLogo.body.company.card.kind).toBe("debito");
    expect(withLogo.body.company.card.plastic).toBe(false);

    await operacion.post(`/api/empresas/${id}/abono`).send({ amount: 50_000 });
    const withWorkers = await comercio.post(`/api/empresas/${id}/trabajadores`).send({
      name: "Ana Díaz",
      email: "ana@proveedorregional.cl",
    });
    const workerId = withWorkers.body.company.workers[0].id;
    await comercio.post(`/api/empresas/${id}/trabajadores`).send({ name: "Luis Soto", email: "luis@proveedorregional.cl" });
    await comercio.post(`/api/empresas/${id}/transferencias`).send({ workerId, amount: 20_000, direction: "to_worker" });

    const companyHome = await comercio.get("/api/inicio");
    expect(companyHome.body).toMatchObject({
      name: "Taller Sur",
      email: "caja@taller.cl",
      commune: "Antofagasta",
      companyName: "Taller Sur",
      coursesPath: "#/clases",
    });
    expect(companyHome.body.card.balance).toBe(30_000);
    expect(companyHome.body.card.available).toBe(0);
    expect(companyHome.body.card.realFunds).toBe(false);
    expect(companyHome.body.card.logo).toBe(logo);
    expect(companyHome.body.workers).toBeUndefined();

    const companyList = await comercio.get("/api/empresas");
    const company = companyList.body.companies[0];
    expect(company.workers).toHaveLength(2);
    expect(company.workers.every((worker: { balance: number; displayBalance: string; movements: unknown[]; receipts: unknown[] }) => {
      return worker.balance === 0 && worker.displayBalance === "—" && worker.movements.length === 0 && worker.receipts.length === 0;
    })).toBe(true);
    expect(company.card.balance).toBe(30_000);
    expect(company.card.available).toBe(0);
    expect(company.card.movements.length).toBeGreaterThan(0);

    const workerHome = await titular.get("/api/inicio");
    expect(workerHome.body.name).toBe("Ana Díaz");
    expect(workerHome.body.companyName).toBe("Taller Sur");
    expect(workerHome.body.card.id).toBe(workerId);
    expect(workerHome.body.card.balance).toBe(20_000);
    expect(workerHome.body.card.logo).toBe(logo);
    expect(workerHome.body.card.kind).toBe("debito");
    expect(workerHome.body.companyBalance).toBeUndefined();
    expect(workerHome.body.workers).toBeUndefined();

    const own = await titular.get("/api/empresas");
    expect(own.body.companies[0].balance).toBe(0);
    expect(own.body.companies[0].displayBalance).toBe("—");
    expect(own.body.companies[0].card.movements).toEqual([]);
    expect(own.body.companies[0].workers).toHaveLength(1);
    expect(own.body.companies[0].workers[0].balance).toBe(20_000);
    expect(own.body.companies[0].workers[0].logo).toBe(logo);
    expect(own.body.companies[0].workers[0].movements.length).toBeGreaterThan(0);
    expect(own.body.companies[0].workers[0].receipts.length).toBeGreaterThan(0);

    const options = await comercio.post(`/api/empresas/${id}/tarjetas/${id}`).send({
      spendLimit: 8_000,
      categories: ["transporte"],
      period: "mensual",
      blocked: false,
      alerts: true,
    });
    expect(options.status).toBe(200);
    const workerOptions = await comercio.post(`/api/empresas/${id}/tarjetas/${workerId}`).send({
      spendLimit: 4_000,
      categories: ["salud"],
      period: "siempre",
      blocked: true,
      alerts: false,
    });
    expect(workerOptions.status).toBe(200);
    expect(workerOptions.body.company.workers.find((worker: { id: string }) => worker.id === workerId).balance).toBe(0);
    const saved = await comercio.get("/api/empresas");
    expect(saved.body.companies[0].card.options).toMatchObject({
      spendLimit: 8_000,
      blocked: false,
      alerts: true,
      period: "mensual",
      categories: ["transporte"],
    });
    expect(saved.body.companies[0].workers.find((worker: { id: string }) => worker.id === workerId).options).toMatchObject({
      spendLimit: 4_000,
      blocked: true,
      categories: ["salud"],
    });
    const workerSaved = await titular.get("/api/empresas");
    expect(workerSaved.body.companies[0].workers[0].options).toMatchObject({ spendLimit: 4_000, blocked: true });
    expect((await titular.post(`/api/empresas/${id}/tarjetas/${id}`).send({ blocked: true })).status).toBe(403);
    const blockedBack = await titular.post(`/api/empresas/${id}/transferencias`).send({
      workerId,
      amount: 1_000,
      direction: "to_company",
    });
    expect(blockedBack.status).toBe(422);

    const opened = await operacion.post("/api/cuentas").send({ name: "Taller Sur", email: "caja@taller.cl" });
    await operacion.post(`/api/cuentas/${opened.body.account.id}/recarga`).send({ amount: 10_000, gateway: "chile" });
    const book = await operacion.get("/api/payments");
    expect(book.body.wallet.balance).toBe(10_000);
    expect(book.body.transferable.balance).toBe(0);
    const afterDemo = await comercio.get("/api/empresas");
    expect(afterDemo.body.companies[0].card.balance).toBe(30_000);
    expect(afterDemo.body.companies[0].card.available).toBe(0);
    expect(afterDemo.body.companies[0].card.realFunds).toBe(false);

    const panel = await request(server).get("/app.js");
    expect(panel.text).toContain("Entrar a cursos");
    expect(panel.text).toContain("Configura la URL https de SICR3P");
    expect(panel.text).toContain("Débito virtual");
  });

  it("keeps SICR3P external and does not return its secret", async () => {
    const server = app();
    const operacion = await signedIn(server);
    const comercio = await signedIn(server, "caja@taller.cl");
    const titular = await signedIn(server, "ana@proveedorregional.cl");
    expect((await comercio.get("/api/configuracion")).status).toBe(403);
    expect((await titular.get("/api/configuracion")).status).toBe(403);
    expect((await titular.get("/api/actuarial")).status).toBe(403);

    const missing = await operacion.get("/api/configuracion");
    expect(missing.body.sicr3p).toEqual({ url: null, configured: false, secretStored: false });

    const secret = "llave-sicr-9f3a";
    const saved = await operacion.post("/api/configuracion").send({
      url: "https://sicr3p.ejemplo.cl/panel",
      secret,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.sicr3p.url).toBe("https://sicr3p.ejemplo.cl/panel");
    expect(saved.body.sicr3p.secret).toBeUndefined();
    expect(saved.body.sicr3p.secretStored).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain(secret);
    const read = await operacion.get("/api/configuracion");
    expect(JSON.stringify(read.body)).not.toContain(secret);
    expect((await operacion.post("/api/configuracion").send({ url: "http://sicr3p.ejemplo.cl/panel" })).status).toBe(400);
    expect((await operacion.post("/api/configuracion").send({ url: "https://proveedorregional.cl/sicr" })).status).toBe(400);
    expect((await operacion.post("/api/configuracion").send({ url: "https://user:clave@sicr3p.ejemplo.cl/panel" })).status).toBe(400);

    const courses = await titular.get("/api/clases");
    expect(courses.status).toBe(200);
    expect(courses.body.courses.map((course: { title: string }) => course.title)).toEqual([
      "Gestión financiera",
      "Uso de la tarjeta de débito",
      "Control de gastos",
      "Seguros y riesgos",
    ]);
    expect(courses.body.courses.every((course: { lessons: unknown[] }) => course.lessons.length > 0)).toBe(true);
    const enrolled = await titular.post("/api/clases/tarjeta-debito/alumnos").send({
      name: "Ana Díaz",
      email: "ana@proveedorregional.cl",
    });
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.course.students).toEqual([
      expect.objectContaining({ email: "ana@proveedorregional.cl", name: "Ana Díaz" }),
    ]);
  });

  it("prices Frosting as workers times the risk-class rate and does not open credit", async () => {
    const server = app();
    const operacion = await signedIn(server);
    const titular = await signedIn(server, "ana@proveedorregional.cl");
    const classes = await operacion.get("/api/actuarial");
    expect(classes.status).toBe(200);
    expect(classes.body.opensCredit).toBe(false);
    const medio = classes.body.classes.find((item: { id: string; rate: number }) => item.id === "medio");
    expect(medio.rate).toBe(3_200);

    const denied = await titular.post("/api/frosting").send({
      holderName: "Ana Díaz",
      email: "ana@proveedorregional.cl",
      companyName: "Taller Sur",
      workers: 4,
      riskClassId: "medio",
      gateway: "chile",
    });
    expect(denied.status).toBe(403);

    const bought = await operacion.post("/api/frosting").send({
      holderName: "Taller Sur",
      email: "caja@taller.cl",
      companyName: "Taller Sur",
      workers: 4,
      riskClassId: "medio",
      gateway: "chile",
    });
    expect(bought.status).toBe(201);
    expect(bought.body.policy.planId).toBe("frosting");
    expect(bought.body.policy.premium).toBe(4 * 3_200);
    expect(bought.body.policy.cupo).toBe(0);
    expect(bought.body.policy.coverage).toBe(0);
    expect(bought.body.policy.workers).toBe(4);
    expect(bought.body.policy.riskRate).toBe(3_200);
    expect(bought.body.charge.mode).toBe("demo");
    const book = await operacion.get("/api/payments");
    expect(book.body.wallet.balance).toBe(4 * 3_200);
    expect(book.body.transferable.balance).toBe(0);

    const rated = await operacion.post("/api/actuarial").send({ classId: "medio", rate: 2_000 });
    expect(rated.status).toBe(200);
    const again = await operacion.post("/api/frosting").send({
      holderName: "Taller Sur",
      email: "caja@taller.cl",
      companyName: "Taller Sur",
      workers: 4,
      riskClassId: "medio",
      gateway: "chile",
    });
    expect(again.body.policy.premium).toBe(4 * 2_000);
    const claim = await operacion.post("/api/claims").send({
      policyId: again.body.policy.id,
      amount: 1_000,
      beneficiary: "Ana Díaz",
      gateway: "chile",
    });
    expect(claim.status).toBe(422);
    expect(claim.body.error).toBe("Frosting no abre crédito");
    expect((await operacion.get("/api/payments")).body.transferable.balance).toBe(0);
  });

  it("shows the debit opening contract beside the signed-in client", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const titular = await signedIn(server, "ana@proveedorregional.cl");
    const created = await comercio.post("/api/empresas").send({ name: "Taller Sur", color: "#0e3e66" });
    expect(created.status).toBe(201);
    const companyContract = created.body.company.contract;
    expect(companyContract.holderName).toBe("Taller Sur");
    expect(companyContract.companyName).toBe("Taller Sur");
    expect(companyContract.accountType).toBe("débito virtual, sin crédito");
    expect(companyContract.parties).toBe("Proveedor Regional y Taller Sur");
    expect(companyContract.text).toContain("Partes: Proveedor Regional y Taller Sur.");
    expect(companyContract.text).toContain("Tipo de cuenta: débito virtual, sin crédito.");
    expect(companyContract.text).toContain("Titular: Taller Sur.");
    expect(companyContract.text).toContain("Empresa: Taller Sur.");
    expect(companyContract.text).toContain("Fecha:");
    expect(companyContract.text).toContain("La tarjeta es virtual y muestra el logo de la empresa.");
    expect(companyContract.text).toContain("Proveedor Regional no es un banco y este contrato no invoca una autorización de la CMF.");
    expect(companyContract.text).not.toMatch(/autorizad[oa] por la CMF/i);
    expect(companyContract.text).not.toMatch(/banco licenciado/i);
    expect(created.body.company.card.contract.text).toBe(companyContract.text);

    const companyHome = await comercio.get("/api/inicio");
    expect(companyHome.body.contract.text).toBe(companyContract.text);
    expect(companyHome.body.card.contract.text).toBe(companyContract.text);

    const withWorker = await comercio.post(`/api/empresas/${created.body.company.id}/trabajadores`).send({
      name: "Ana Díaz",
      email: "ana@proveedorregional.cl",
    });
    const workerContract = withWorker.body.company.workers[0].contract;
    expect(workerContract.holderName).toBe("Ana Díaz");
    expect(workerContract.companyName).toBe("Taller Sur");
    expect(workerContract.accountType).toBe("débito virtual, sin crédito");
    expect(workerContract.text).toContain("Partes: Proveedor Regional y Ana Díaz.");
    expect(workerContract.text).toContain("Empresa: Taller Sur.");
    expect(workerContract.text).toContain("La tarjeta es virtual y muestra el logo de la empresa.");
    expect(workerContract.text).not.toMatch(/autorizad[oa] por la CMF/i);

    const workerHome = await titular.get("/api/inicio");
    expect(workerHome.body.contract.text).toBe(workerContract.text);
    expect(workerHome.body.card.balance).toBe(0);
    expect(workerHome.body.workers).toBeUndefined();

    const panel = await request(server).get("/app.js");
    expect(panel.text).toContain("Ver contrato");
    expect(panel.text).toContain("contractBox");
  });

  it("stores a virtual gift without moving balances or calling Stripe when Stripe is off", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const titular = await signedIn(server, "ana@proveedorregional.cl");
    const operacion = await signedIn(server);
    const created = await comercio.post("/api/empresas").send({ name: "Taller Sur", color: "#0e3e66" });
    const id = created.body.company.id;
    await operacion.post(`/api/empresas/${id}/abono`).send({ amount: 50_000 });
    const withWorker = await comercio.post(`/api/empresas/${id}/trabajadores`).send({
      name: "Ana Díaz",
      email: "ana@proveedorregional.cl",
    });
    const workerId = withWorker.body.company.workers[0].id;
    await comercio.post(`/api/empresas/${id}/transferencias`).send({ workerId, amount: 20_000, direction: "to_worker" });

    const beforeCompany = await comercio.get("/api/empresas");
    const beforeWorker = await titular.get("/api/inicio");
    const beforeBook = await operacion.get("/api/payments");
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error("Stripe no debe llamarse");
    }) as typeof fetch;
    let gift;
    try {
      gift = await comercio.post(`/api/empresas/${id}/regalos`).send({
        title: "Almuerzo",
        note: "Para el equipo",
        recipientId: workerId,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toEqual([]);
    expect(gift.status).toBe(201);
    expect(gift.body.gift).toMatchObject({
      status: "pending",
      code: null,
      stripeCouponId: null,
      stripePromotionCodeId: null,
      money: false,
      recipientId: workerId,
      recipientName: "Ana Díaz",
      title: "Almuerzo",
      disclaimer: "Este regalo es virtual. No es una cuenta de débito y no es dinero.",
    });
    expect(gift.body.gift.pendingMessage).toContain("Stripe no está configurado");
    expect(gift.body.gift.qr).toBeNull();
    expect(gift.body.gift.nfcNote).toBeNull();
    expect(JSON.stringify(gift.body)).not.toMatch(/coupon_|promo_|ch_|pi_|acct_|sk_/);

    const afterCompany = await comercio.get("/api/empresas");
    expect(afterCompany.body.companies[0].card.balance).toBe(beforeCompany.body.companies[0].card.balance);
    expect(afterCompany.body.companies[0].card.balance).toBe(30_000);
    expect(afterCompany.body.companies[0].card.available).toBe(0);
    expect(afterCompany.body.companies[0].card.realFunds).toBe(false);
    expect(afterCompany.body.companies[0].workers[0].balance).toBe(0);
    expect(afterCompany.body.companies[0].workers[0].displayBalance).toBe("—");
    expect(afterCompany.body.companies[0].gifts).toEqual([
      expect.objectContaining({ id: gift.body.gift.id, status: "pending", recipientId: workerId }),
    ]);
    const afterBook = await operacion.get("/api/payments");
    expect(afterBook.body.wallet.balance).toBe(beforeBook.body.wallet.balance);
    expect(afterBook.body.transferable.balance).toBe(0);
    const afterWorker = await titular.get("/api/inicio");
    expect(afterWorker.body.card.balance).toBe(beforeWorker.body.card.balance);
    expect(afterWorker.body.card.balance).toBe(20_000);
    expect(afterWorker.body.gifts).toEqual([
      expect.objectContaining({ id: gift.body.gift.id, recipientId: workerId }),
    ]);

    const ownGift = await comercio.post(`/api/empresas/${id}/regalos`).send({
      title: "Para la empresa",
      note: "Uso interno",
      recipientId: id,
    });
    expect(ownGift.status).toBe(201);
    const companyHome = await comercio.get("/api/inicio");
    expect(companyHome.body.gifts).toHaveLength(2);
    const workerSees = await titular.get("/api/inicio");
    expect(workerSees.body.gifts.map((item: { recipientId: string }) => item.recipientId)).toEqual([workerId]);
    const workerCompany = await titular.get("/api/empresas");
    expect(workerCompany.body.companies[0].gifts).toHaveLength(1);
    expect(workerCompany.body.companies[0].balance).toBe(0);
    expect(workerCompany.body.companies[0].displayBalance).toBe("—");

    expect((await titular.post(`/api/empresas/${id}/regalos`).send({
      title: "No",
      note: "No",
      recipientId: workerId,
    })).status).toBe(403);
    expect((await operacion.post(`/api/empresas/${id}/regalos`).send({
      title: "No",
      note: "No",
      recipientId: id,
    })).status).toBe(403);
    expect((await comercio.post(`/api/empresas/${id}/regalos`).send({
      title: "Fuera",
      note: "Nadie",
      recipientId: "wrk_missing",
    })).status).toBe(404);
    const priced = await comercio.post(`/api/empresas/${id}/regalos`).send({
      title: "Con monto",
      note: "No",
      recipientId: id,
      amount: 1000,
      currency: "clp",
    });
    expect(priced.status).toBe(400);
    expect(priced.body.error).toBe("Un regalo virtual no lleva monto");
    expect((await comercio.get("/api/empresas")).body.companies[0].card.balance).toBe(30_000);
    expect((await titular.get("/api/inicio")).body.card.balance).toBe(20_000);
    expect((await operacion.get("/api/payments")).body.transferable.balance).toBe(0);

    const panel = await request(server).get("/app.js");
    expect(panel.text).toContain("Regalo virtual");
    expect(panel.text).toContain("etiqueta NFC");
  });

  it("issues a gift as a Stripe coupon and promotion code without a live call", async () => {
    const pending = await issueVirtualGift(undefined, "Pendiente");
    expect(pending).toMatchObject({
      status: "pending",
      active: false,
      code: null,
      stripeCouponId: null,
      stripePromotionCodeId: null,
      qr: null,
    });
    await activateVirtualGift(undefined, null);
    const calls: string[] = [];
    const issued = await issueVirtualGift({
      coupons: {
        create: async (params) => {
          calls.push("coupon");
          expect(params.percent_off).toBe(100);
          expect(params.duration).toBe("once");
          expect(params.metadata).toEqual({ kind: "regalo_virtual", money: "false" });
          expect(params).not.toHaveProperty("amount_off");
          expect(params).not.toHaveProperty("currency");
          return { id: "coupon_stub" };
        },
      },
      promotionCodes: {
        create: async (params) => {
          calls.push("promotion");
          expect(params.promotion).toEqual({ type: "coupon", coupon: "coupon_stub" });
          expect(params.active).toBe(false);
          expect(params.max_redemptions).toBe(1);
          return { id: "promo_stub", code: params.code ?? "" };
        },
      },
    }, "Almuerzo");
    expect(calls).toEqual(["coupon", "promotion"]);
    expect(issued.status).toBe("issued");
    expect(issued.active).toBe(false);
    expect(issued.code).toMatch(/^RG-[A-Z2-9]{6}$/);
    expect(issued.stripeCouponId).toBe("coupon_stub");
    expect(issued.stripePromotionCodeId).toBe("promo_stub");
    expect(issued.nfcNote).toContain("etiqueta NFC");
    expect(issued.qr?.[0]).toHaveLength(21);
    const updates: Array<{ id: string; active: boolean }> = [];
    await activateVirtualGift({
      promotionCodes: {
        update: async (id, params) => {
          updates.push({ id, active: params.active });
          return { id };
        },
      },
    }, issued.stripePromotionCodeId);
    expect(updates).toEqual([{ id: "promo_stub", active: true }]);
  });

  it("keeps a gift inactive until Activar and does not move balances", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const titular = await signedIn(server, "ana@proveedorregional.cl");
    const operacion = await signedIn(server);
    const created = await comercio.post("/api/empresas").send({ name: "Taller Sur", color: "#0e3e66" });
    const id = created.body.company.id;
    await operacion.post(`/api/empresas/${id}/abono`).send({ amount: 40_000 });
    const withWorker = await comercio.post(`/api/empresas/${id}/trabajadores`).send({
      name: "Ana Díaz",
      email: "ana@proveedorregional.cl",
    });
    const workerId = withWorker.body.company.workers[0].id;
    await comercio.post(`/api/empresas/${id}/transferencias`).send({ workerId, amount: 15_000, direction: "to_worker" });
    const beforeBook = await operacion.get("/api/payments");

    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error("Stripe no debe llamarse");
    }) as typeof fetch;
    let gift;
    try {
      gift = await comercio.post(`/api/empresas/${id}/regalos`).send({
        title: "Once",
        note: "Para Ana",
        recipientId: workerId,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toEqual([]);
    expect(gift.status).toBe(201);
    expect(gift.body.gift.active).toBe(false);
    expect(gift.body.gift.canActivate).toBe(true);
    expect(gift.body.gift.code).toBeNull();
    expect(gift.body.gift.inactiveMessage).toContain("Inactivo");
    const waiting = await titular.get("/api/inicio");
    expect(waiting.body.gifts[0]).toMatchObject({ id: gift.body.gift.id, active: false, canActivate: false, code: null });
    expect(waiting.body.card.balance).toBe(15_000);

    expect((await titular.post(`/api/empresas/${id}/regalos/${gift.body.gift.id}/activar`)).status).toBe(403);
    expect((await operacion.post(`/api/empresas/${id}/regalos/${gift.body.gift.id}/activar`)).status).toBe(403);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error("Stripe no debe llamarse");
    }) as typeof fetch;
    let activated;
    try {
      activated = await comercio.post(`/api/empresas/${id}/regalos/${gift.body.gift.id}/activar`);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalls).toEqual([]);
    expect(activated.status).toBe(200);
    expect(activated.body.gift.active).toBe(true);
    expect(activated.body.gift.canActivate).toBe(false);
    expect(activated.body.gift.inactiveMessage).toBeNull();
    expect(activated.body.gift.stripeCouponId).toBeNull();
    expect(activated.body.gift.stripePromotionCodeId).toBeNull();

    const afterCompany = await comercio.get("/api/empresas");
    expect(afterCompany.body.companies[0].card.balance).toBe(25_000);
    expect(afterCompany.body.companies[0].card.available).toBe(0);
    expect(afterCompany.body.companies[0].card.realFunds).toBe(false);
    expect(afterCompany.body.companies[0].workers[0].balance).toBe(0);
    expect(afterCompany.body.companies[0].workers[0].displayBalance).toBe("—");
    expect(afterCompany.body.companies[0].gifts[0].active).toBe(true);
    const afterBook = await operacion.get("/api/payments");
    expect(afterBook.body.wallet.balance).toBe(beforeBook.body.wallet.balance);
    expect(afterBook.body.transferable.balance).toBe(0);
    const afterWorker = await titular.get("/api/inicio");
    expect(afterWorker.body.card.balance).toBe(15_000);
    expect(afterWorker.body.gifts[0].active).toBe(true);
    const panel = await request(server).get("/app.js");
    expect(panel.text).toContain("Activar");
    expect(panel.text).toContain("Inactivo");
  });

  it("scopes company users so one company cannot read another", async () => {
    const server = app();
    const taller = await signedIn(server, "caja@taller.cl");
    const norte = await signedIn(server, "pago@norte.cl");
    const operacion = await signedIn(server);
    const companyA = await taller.post("/api/empresas").send({ name: "Taller Sur", color: "#0e3e66" });
    const companyB = await norte.post("/api/empresas").send({ name: "Oficina Norte", color: "#14532d" });
    const idA = companyA.body.company.id;
    const idB = companyB.body.company.id;
    const password = "Empresa.1831";

    const staff = await taller.post(`/api/empresas/${idA}/usuarios`).send({
      name: "Caja Sur",
      email: "caja.sur@taller.cl",
      role: "comercio",
      password,
    });
    expect(staff.status).toBe(201);
    expect(staff.body.user).toMatchObject({
      email: "caja.sur@taller.cl",
      role: "comercio",
      roleLabel: "Usuario de la empresa",
      companyId: idA,
    });
    expect(JSON.stringify(staff.body)).not.toContain(password);
    expect(staff.body.company.users.map((user: { email: string }) => user.email)).toEqual([
      "caja@taller.cl",
      "caja.sur@taller.cl",
    ]);

    const client = await taller.post(`/api/empresas/${idA}/usuarios`).send({
      name: "Luz Soto",
      email: "luz.sur@taller.cl",
      role: "titular",
      password,
    });
    expect(client.status).toBe(201);
    const luzCard = client.body.company.workers.find((worker: { email: string }) => worker.email === "luz.sur@taller.cl");
    expect(luzCard.contract.holderName).toBe("Luz Soto");
    expect(luzCard.contract.companyName).toBe("Taller Sur");
    expect(luzCard.contract.text).toContain("débito virtual, sin crédito");

    const norteClient = await norte.post(`/api/empresas/${idB}/usuarios`).send({
      name: "Pablo Norte",
      email: "pablo.norte@norte.cl",
      role: "titular",
      password,
    });
    expect(norteClient.status).toBe(201);
    expect((await operacion.post(`/api/empresas/${idA}/usuarios`).send({
      name: "Mesa",
      email: "mesa.sur@taller.cl",
      role: "comercio",
      password,
    })).status).toBe(403);
    expect((await norte.post(`/api/empresas/${idA}/usuarios`).send({
      name: "Intruso",
      email: "intruso@norte.cl",
      role: "comercio",
      password,
    })).status).toBe(403);
    expect((await taller.post(`/api/empresas/${idA}/usuarios`).send({
      name: "Pablo",
      email: "pablo.norte@norte.cl",
      role: "titular",
      password,
    })).status).toBe(409);

    const sur = await signedIn(server, "caja.sur@taller.cl", password);
    const visible = await sur.get("/api/empresas");
    expect(visible.body.companies.map((company: { id: string }) => company.id)).toEqual([idA]);
    expect(visible.body.canCreate).toBe(false);
    expect(JSON.stringify(visible.body)).not.toContain("Oficina Norte");
    expect(JSON.stringify(visible.body)).not.toContain("pablo.norte@norte.cl");
    expect(visible.body.companies[0].workers.map((worker: { email: string }) => worker.email)).toEqual(["luz.sur@taller.cl"]);
    expect(visible.body.companies[0].workers[0].displayBalance).toBe("—");
    const surHome = await sur.get("/api/inicio");
    expect(surHome.body.companyName).toBe("Taller Sur");
    expect(surHome.body.contract.companyName).toBe("Taller Sur");
    expect(JSON.stringify(surHome.body)).not.toContain("Oficina Norte");
    expect((await sur.post("/api/empresas").send({ name: "Otra", color: "#112233" })).status).toBe(403);
    expect((await sur.post(`/api/empresas/${idB}/regalos`).send({
      title: "Ajeno",
      note: "No",
      recipientId: idB,
    })).status).toBe(403);
    expect((await sur.post(`/api/empresas/${idB}/trabajadores`).send({
      name: "Ajeno",
      email: "ajeno@norte.cl",
    })).status).toBe(403);
    expect((await sur.get("/api/cuentas")).body.accounts).toEqual([]);

    const luz = await signedIn(server, "luz.sur@taller.cl", password);
    const luzHome = await luz.get("/api/inicio");
    expect(luzHome.body.name).toBe("Luz Soto");
    expect(luzHome.body.companyName).toBe("Taller Sur");
    expect(luzHome.body.contract.holderName).toBe("Luz Soto");
    expect(luzHome.body.workers).toBeUndefined();
    const luzCompanies = await luz.get("/api/empresas");
    expect(luzCompanies.body.companies).toHaveLength(1);
    expect(luzCompanies.body.companies[0].id).toBe(idA);
    expect(luzCompanies.body.companies[0].workers).toHaveLength(1);
    expect(luzCompanies.body.companies[0].displayBalance).toBe("—");
    expect(luzCompanies.body.companies[0].users).toEqual([]);
    expect(JSON.stringify(luzCompanies.body)).not.toContain("pablo.norte@norte.cl");
    expect(JSON.stringify(luzCompanies.body)).not.toContain(idB);

    await sur.post("/api/clases/tarjeta-debito/alumnos").send({ name: "Caja Sur", email: "caja.sur@taller.cl" });
    await norte.post("/api/clases/tarjeta-debito/alumnos").send({ name: "Oficina Norte", email: "pago@norte.cl" });
    const surCourses = await sur.get("/api/clases");
    const surStudents = surCourses.body.courses.find((course: { id: string }) => course.id === "tarjeta-debito").students;
    expect(surStudents.map((student: { email: string }) => student.email)).toEqual(["caja.sur@taller.cl"]);
    const norteCourses = await norte.get("/api/clases");
    const norteStudents = norteCourses.body.courses.find((course: { id: string }) => course.id === "tarjeta-debito").students;
    expect(norteStudents.map((student: { email: string }) => student.email)).not.toContain("caja.sur@taller.cl");

    const panel = await request(server).get("/app.js");
    expect(panel.text).toContain("Usuario de la empresa");
    expect(panel.text).toContain("Cada empresa y cada cliente tiene su propio usuario");
  });

  it("stores a pending cuenta virtual and cuenta puente without moving debit balances", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const created = await comercio.post("/api/empresas").send({ name: "Taller Sur", color: "#0e3e66" });
    expect(created.status).toBe(201);
    const id = created.body.company.id;
    expect(created.body.company.globalAccounts).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toContain("cuenta_puente");
    expect((await comercio.post(`/api/empresas/${id}/cuentas-virtuales`)).status).toBe(403);

    const operacion = await signedIn(server);
    const funded = await operacion.post(`/api/empresas/${id}/abono`).send({ amount: 40_000 });
    expect(funded.body.company.balance).toBe(40_000);
    const withWorker = await comercio.post(`/api/empresas/${id}/trabajadores`).send({
      name: "Ana Díaz",
      email: "ana@proveedorregional.cl",
    });
    const workerId = withWorker.body.company.workers[0].id;
    const moved = await comercio.post(`/api/empresas/${id}/transferencias`).send({
      workerId,
      amount: 12_000,
      direction: "to_worker",
    });
    expect(moved.body.company.balance).toBe(28_000);
    const beforeMoves = moved.body.company.card.movements;

    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("no se debe llamar a Global66");
    }) as typeof fetch;
    let requested: Awaited<ReturnType<typeof operacion.post>>;
    try {
      requested = await operacion.post(`/api/empresas/${id}/cuentas-virtuales`);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toEqual([]);
    expect(requested.status).toBe(201);
    expect(requested.body.company.balance).toBe(28_000);
    expect(requested.body.company.card.balance).toBe(28_000);
    expect(requested.body.company.card.available).toBe(0);
    expect(requested.body.company.card.movements).toEqual(beforeMoves);
    expect(requested.body.company.workers[0].balance).toBe(12_000);
    const accounts = requested.body.company.globalAccounts.accounts;
    expect(accounts.map((account: { kind: string }) => account.kind)).toEqual(["cuenta_virtual", "cuenta_puente"]);
    expect(accounts.every((account: { status: string; externalId: null }) => account.status === "pending" && account.externalId === null)).toBe(true);
    expect(accounts.every((account: { accountNumber?: string }) => account.accountNumber === undefined)).toBe(true);
    const bridge = accounts.find((account: { kind: string }) => account.kind === "cuenta_puente");
    expect(bridge.purpose).toBe("Recibe una transferencia destinada a Stripe. No mueve dinero por sí sola.");
    expect(accounts.find((account: { kind: string }) => account.kind === "cuenta_virtual").label).toBe("Cuenta virtual");
    expect(requested.body.company.globalAccounts.notice).toContain("movimientos y pagos");
    expect(requested.body.company.globalAccounts.notice).toContain("no la apertura de cuentas");

    const titular = await signedIn(server, "ana@proveedorregional.cl");
    const own = await titular.get("/api/empresas");
    expect(own.body.companies[0].workers[0].balance).toBe(12_000);
    expect(own.body.companies[0].globalAccounts).toBeUndefined();
    expect(JSON.stringify(own.body)).not.toContain("cuenta_virtual");
    expect((await titular.post(`/api/empresas/${id}/cuentas-virtuales`)).status).toBe(403);

    const again = await operacion.post(`/api/empresas/${id}/cuentas-virtuales`);
    expect(again.status).toBe(200);
    expect(again.body.company.globalAccounts.accounts.map((account: { id: string }) => account.id)).toEqual(
      accounts.map((account: { id: string }) => account.id),
    );
    expect(again.body.company.balance).toBe(28_000);
    expect((await comercio.post(`/api/empresas/${id}/cuentas-virtuales`)).status).toBe(403);
    expect((await operacion.get("/api/overview")).body.float.balance).toBe(0);

    const other = await signedIn(server, "pago@norte.cl");
    expect((await other.post(`/api/empresas/${id}/cuentas-virtuales`)).status).toBe(403);
    const otherCreated = await other.post("/api/empresas").send({ name: "Oficina Norte", color: "#112233" });
    const otherId = otherCreated.body.company.id;
    expect(otherCreated.body.company.globalAccounts).toBeUndefined();
    const otherRequest = await operacion.post(`/api/empresas/${otherId}/cuentas-virtuales`);
    expect(otherRequest.status).toBe(201);
    const otherAccounts = otherRequest.body.company.globalAccounts.accounts;
    expect(otherAccounts).toHaveLength(2);
    const otherIds = otherAccounts.map((account: { id: string }) => account.id);
    const tallerIds = accounts.map((account: { id: string }) => account.id);
    expect(otherIds.some((accountId: string) => tallerIds.includes(accountId))).toBe(false);

    const tallerView = await comercio.get("/api/empresas");
    expect(tallerView.body.companies).toHaveLength(1);
    expect(tallerView.body.companies[0].id).toBe(id);
    expect(tallerView.body.companies[0].globalAccounts).toBeUndefined();
    expect(tallerView.body.companies[0].balance).toBe(28_000);
    expect(JSON.stringify(tallerView.body)).not.toContain(otherId);
    expect(JSON.stringify(tallerView.body)).not.toContain(tallerIds[0]);

    const norteView = await other.get("/api/empresas");
    expect(norteView.body.companies.map((company: { id: string }) => company.id)).toEqual([otherId]);
    expect(norteView.body.companies[0].globalAccounts).toBeUndefined();
    expect(JSON.stringify(norteView.body)).not.toContain(id);
    expect(JSON.stringify(norteView.body)).not.toContain(otherIds[0]);

    const seen = await operacion.get("/api/empresas");
    const byId = new Map(seen.body.companies.map((company: { id: string; globalAccounts: { accounts: { id: string }[] } }) => [company.id, company]));
    expect((byId.get(id) as { globalAccounts: { accounts: { id: string }[] } }).globalAccounts.accounts.map((account) => account.id)).toEqual(tallerIds);
    expect((byId.get(otherId) as { globalAccounts: { accounts: { id: string }[] } }).globalAccounts.accounts.map((account) => account.id)).toEqual(otherIds);

    const panel = await request(server).get("/app.js");
    const companyBlock = panel.text.slice(panel.text.indexOf("function companyBlock"), panel.text.indexOf("function viewEmpresas"));
    const home = panel.text.slice(panel.text.indexOf("function viewOperacionHome"), panel.text.indexOf("function viewAccounts"));
    expect(companyBlock).not.toContain("globalAccountsBox");
    expect(companyBlock).not.toContain("data-global-accounts");
    expect(home).toContain("adminGlobalAccounts()");
    expect(panel.text).toContain("Solicitar cuenta virtual y cuenta puente");
    expect(panel.text).toContain("Recibe una transferencia destinada a Stripe. No mueve dinero por sí sola.");
    expect(panel.text).toContain("Sin número de cuenta");
  });
});
