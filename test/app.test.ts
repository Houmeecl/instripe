import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Platform } from "../src/platform.js";

function app(env: NodeJS.ProcessEnv = {}) {
  return createApp(loadConfig({ PORT: "3000", CURRENCY: "clp", DATABASE_PATH: ":memory:", ...env }));
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
    const res = await request(app()).get("/api/gateways");
    expect(res.status).toBe(200);
    const names = res.body.gateways.map((g: { name: string }) => g.name).sort();
    expect(names).toEqual(["chile", "stripe"]);
  });

  it("lists the credit-card credit policy", async () => {
    const res = await request(app()).get("/api/plans");
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0].id).toBe("credito-tc");
    expect(res.body.plans[0].rateBps).toBe(60);
    expect(res.body.plans[0].displayRate).toBe("0,60%");
  });

  it("subscribes to a plan via the Chile gateway and credits the float", async () => {
    const server = app();
    const res = await request(server)
      .post("/api/policies")
      .send(creditPolicy());
    expect(res.status).toBe(201);
    expect(res.body.policy.status).toBe("active");
    expect(res.body.policy.cardLabel).toBe("Visa •••• 4242");
    expect(res.body.policy.cupo).toBe(1_500_000);
    expect(res.body.policy.premium).toBe(9000);
    expect(res.body.charge.gateway).toBe("chile");
    expect(res.body.charge.mode).toBe("demo");

    const overview = await request(server).get("/api/overview");
    expect(overview.body.float.balance).toBe(9000);
    expect(overview.body.policies).toHaveLength(1);
    expect(overview.body.modules.map((m: { id: string }) => m.id).sort()).toEqual([
      "apps",
      "cobros",
      "connect",
      "cuentas",
      "diseno",
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
    const res = await request(server)
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Bkr SpA", email: "ops@bkr.cl", gateway: "stripe" }));
    expect(res.status).toBe(201);
    expect(res.body.policy.status).toBe("active");
    expect(res.body.charge.gateway).toBe("stripe");
    expect(res.body.charge.clientSecret).toBeUndefined();
    expect(res.body.charge.redirectUrl).toContain("charge=");

    const overview = await request(server).get("/api/overview");
    expect(overview.body.float.balance).toBe(9000);
  });

  it("disperses a claim payout and debits the float (dispersión de fondos)", async () => {
    const server = app();
    const sub = await request(server)
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Bkr SpA", email: "ops@bkr.cl", cupo: 5_000_000 }));
    const policyId = sub.body.policy.id;

    const claim = await request(server)
      .post("/api/claims")
      .send({ policyId, amount: 20000, beneficiary: "11.111.111-1", gateway: "chile" });
    expect(claim.status).toBe(201);
    expect(claim.body.claim.status).toBe("paid");
    expect(claim.body.payout.gateway).toBe("chile");
    // premium is 0,60% of 5.000.000 = 30.000; payout 20.000 leaves 10.000
    expect(claim.body.floatBalance).toBe(10000);
  });

  it("rejects a claim above coverage", async () => {
    const server = app();
    const sub = await request(server)
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Ana", email: "ana@demo.cl" }));
    const res = await request(server)
      .post("/api/claims")
      .send({ policyId: sub.body.policy.id, amount: 99999999, beneficiary: "x" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("crédito");
  });

  it("rejects a claim when the float has insufficient funds", async () => {
    const server = app();
    const sub = await request(server)
      .post("/api/policies")
      .send(creditPolicy({ holderName: "Ana", email: "ana@demo.cl" }));
    // insured credit is 1.500.000 but the wallet only holds the 9.000 premium
    const res = await request(server)
      .post("/api/claims")
      .send({ policyId: sub.body.policy.id, amount: 500000, beneficiary: "x" });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Insufficient funds");
  });

  it("validates required fields", async () => {
    const res = await request(app()).post("/api/policies").send({ holderName: "Ana" });
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

    const first = platform.fulfillCheckout(created.id, "cs_test_1");
    expect(first).toMatchObject({ fulfilled: true, module: "seguros", reference: created.id });
    expect(platform.floatAccount.balance).toBe(9000);
    expect(platform.listPolicies()[0]?.status).toBe("active");

    const second = platform.fulfillCheckout(created.id, "cs_test_1");
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
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns 409 when retrieving a checkout session without Stripe", async () => {
    const res = await request(app()).get("/api/checkout/sessions/cs_test_missing");
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

    const events = await request(server).get("/api/stripe/events");
    expect(events.body.events[0]).toMatchObject({ id: "evt_test_123", type: "checkout.session.completed" });
  });

  it("funds a BaaS account through payments and withdraws from that balance", async () => {
    const server = app();
    const opened = await request(server).post("/api/cuentas").send({ name: "Taller Sur", email: "caja@taller.cl" });
    expect(opened.status).toBe(201);
    const id = opened.body.account.id;

    const fund = await request(server).post(`/api/cuentas/${id}/recarga`).send({ amount: 10000, gateway: "chile" });
    expect(fund.status).toBe(201);
    expect(fund.body.account.balance).toBe(10000);
    expect(fund.body.topup.status).toBe("paid");

    const withdraw = await request(server)
      .post(`/api/cuentas/${id}/retiro`)
      .send({ amount: 4000, destination: "12.345.678-9", gateway: "chile" });
    expect(withdraw.status).toBe(201);
    expect(withdraw.body.account.balance).toBe(6000);

    const tooMuch = await request(server)
      .post(`/api/cuentas/${id}/retiro`)
      .send({ amount: 99999, destination: "12.345.678-9", gateway: "chile" });
    expect(tooMuch.status).toBe(422);

    const payments = await request(server).get("/api/payments");
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
    const result = platform.fulfillCheckout("cob_demo", "cs_test_cob");
    expect(result).toEqual({ fulfilled: true, reference: "cob_demo", module: "cobros" });
    expect(platform.listPolicies()).toHaveLength(0);
    expect(platform.floatAccount.balance).toBe(15000);
  });

  it("collects a cobro through payments without creating a policy", async () => {
    const server = app();
    const res = await request(server).post("/api/cobros").send({
      concept: "Mantención mensual",
      payerName: "Oficina Norte",
      email: "pago@norte.cl",
      amount: 15000,
      gateway: "chile",
    });
    expect(res.status).toBe(201);
    expect(res.body.cobro.status).toBe("paid");
    expect(res.body.cobro.paymentId).toMatch(/^pay_/);

    const overview = await request(server).get("/api/overview");
    expect(overview.body.policies).toHaveLength(0);
    expect(overview.body.float.balance).toBe(15000);
    expect(overview.body.payments[0]).toMatchObject({ module: "cobros", kind: "collect", status: "paid" });
  });

  it("opens Connect, Treasury, a card and an app without treating them as policies", async () => {
    const manifestPath = `/tmp/instripe-app-${Date.now()}.json`;
    const server = app({ PORT: "3000", CURRENCY: "clp", APP_MANIFEST_PATH: manifestPath });

    const connect = await request(server).post("/api/connect").send({ businessName: "Taller Sur", email: "caja@taller.cl" });
    expect(connect.status).toBe(201);
    expect(connect.body.account.id).toMatch(/^con_/);
    expect(connect.body.account.mode).toBe("demo");
    expect(connect.body.account.country).toBe("CL");

    const funded = await request(server).post("/api/cobros").send({
      concept: "Fondo",
      payerName: "Caja",
      email: "caja@taller.cl",
      amount: 20000,
      gateway: "chile",
    });
    expect(funded.status).toBe(201);

    const payout = await request(server).post(`/api/connect/${connect.body.account.id}/pago`).send({ amount: 5000, gateway: "chile" });
    expect(payout.status).toBe(201);
    expect(payout.body.payout.destination).toBe(connect.body.account.id);

    const treasury = await request(server).post("/api/treasury").send({ nickname: "Caja principal" });
    expect(treasury.status).toBe(201);
    expect(treasury.body.account.mode).toBe("demo");
    const abono = await request(server).post(`/api/treasury/${treasury.body.account.id}/abono`).send({ amount: 8000, gateway: "chile" });
    expect(abono.status).toBe(201);

    const card = await request(server).post("/api/tarjetas").send({
      holderName: "Ana Díaz",
      email: "ana@demo.cl",
      phone: "+34910000000",
      cupo: 1_500_000,
    });
    expect(card.status).toBe(201);
    expect(card.body.card.last4).toHaveLength(4);
    expect(card.body.card.cupo).toBe(1_500_000);
    expect(card.body.card.number).toBeUndefined();

    const design = await request(server).post("/api/diseno").send({
      displayName: "instripe",
      buttonColor: "#112233",
      backgroundColor: "#f5f7fb",
      borderStyle: "pill",
      carrierTitle: "Tu tarjeta",
      carrierBody: "Crédito de la plataforma",
    });
    expect(design.status).toBe(200);
    expect(design.body.design.buttonColor).toBe("#112233");

    const blocked = await request(server).post("/api/apps").send({ name: "Stripe Gratis" });
    expect(blocked.status).toBe(400);

    const created = await request(server).post("/api/apps").send({ name: "Instripe" });
    expect(created.status).toBe(201);
    expect(created.body.manifest.id).toBe("com.houmeecl.instripe");
    expect(created.body.upload).toBe("stripe apps upload");

    const overview = await request(server).get("/api/overview");
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
    expect(landing.text).toContain('src="/logo.png"');
    expect(landing.text).toContain('src="/aplicacion"');
    expect(landing.text).toContain("Procesador de pagos");
    expect(landing.text).toContain("Espacio ocupado");

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
    const funded = await first.cuentas.fund({ accountId: opened.id, amount: 8000, gateway: "chile" });
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
});
