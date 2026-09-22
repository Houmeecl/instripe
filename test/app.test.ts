import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Platform } from "../src/platform.js";

function app(env: NodeJS.ProcessEnv = { PORT: "3000", CURRENCY: "clp" }) {
  return createApp(loadConfig(env));
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

  it("lists insurance plans with CLP-formatted premiums", async () => {
    const res = await request(app()).get("/api/plans");
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(3);
    expect(res.body.plans[0].id).toBe("salud-basico");
    // CLP is zero-decimal: 9000 -> $9.000 (no cents)
    expect(res.body.plans[0].displayPremium).toContain("9.000");
    expect(res.body.plans[0].displayPremium).not.toContain(",00");
  });

  it("subscribes to a plan via the Chile gateway and credits the float", async () => {
    const server = app();
    const res = await request(server)
      .post("/api/policies")
      .send({ planId: "salud-basico", holderName: "Ana Díaz", email: "ana@demo.cl", gateway: "chile" });
    expect(res.status).toBe(201);
    expect(res.body.policy.status).toBe("active");
    expect(res.body.charge.gateway).toBe("chile");
    expect(res.body.charge.mode).toBe("demo");

    const overview = await request(server).get("/api/overview");
    expect(overview.body.float.balance).toBe(9000);
    expect(overview.body.policies).toHaveLength(1);
    expect(overview.body.modules.map((m: { id: string }) => m.id).sort()).toEqual(["cobros", "cuentas", "seguros"]);
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
      .send({ planId: "pyme-total", holderName: "Bkr SpA", email: "ops@bkr.cl", gateway: "stripe" });
    expect(res.status).toBe(201);
    expect(res.body.policy.status).toBe("active");
    expect(res.body.charge.gateway).toBe("stripe");
    expect(res.body.charge.clientSecret).toBeUndefined();
    expect(res.body.charge.redirectUrl).toContain("charge=");

    const overview = await request(server).get("/api/overview");
    expect(overview.body.float.balance).toBe(49000);
  });

  it("disperses a claim payout and debits the float (dispersión de fondos)", async () => {
    const server = app();
    const sub = await request(server)
      .post("/api/policies")
      .send({ planId: "pyme-total", holderName: "Bkr SpA", email: "ops@bkr.cl", gateway: "chile" });
    const policyId = sub.body.policy.id;

    const claim = await request(server)
      .post("/api/claims")
      .send({ policyId, amount: 20000, beneficiary: "11.111.111-1", gateway: "chile" });
    expect(claim.status).toBe(201);
    expect(claim.body.claim.status).toBe("paid");
    expect(claim.body.payout.gateway).toBe("chile");
    // float was 49000 (premium) - 20000 (payout) = 29000
    expect(claim.body.floatBalance).toBe(29000);
  });

  it("rejects a claim above coverage", async () => {
    const server = app();
    const sub = await request(server)
      .post("/api/policies")
      .send({ planId: "salud-basico", holderName: "Ana", email: "ana@demo.cl" });
    const res = await request(server)
      .post("/api/claims")
      .send({ policyId: sub.body.policy.id, amount: 99999999, beneficiary: "x" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("cobertura");
  });

  it("rejects a claim when the float has insufficient funds", async () => {
    const server = app();
    const sub = await request(server)
      .post("/api/policies")
      .send({ planId: "salud-basico", holderName: "Ana", email: "ana@demo.cl" });
    // coverage is 1.500.000 but float only holds one 9.000 premium
    const res = await request(server)
      .post("/api/claims")
      .send({ policyId: sub.body.policy.id, amount: 500000, beneficiary: "x" });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Insufficient funds");
  });

  it("validates required fields", async () => {
    const res = await request(app()).post("/api/policies").send({ planId: "salud-basico" });
    expect(res.status).toBe(400);
  });

  it("keeps the float unchanged until a pending Stripe policy is fulfilled, once", () => {
    const platform = new Platform(loadConfig({ PORT: "3000", CURRENCY: "clp" }));
    const policy = platform.listPolicies()[0];
    expect(policy).toBeUndefined();

    const { policy: created } = platform.holdPremium({
      planId: "salud-basico",
      holderName: "Ana Díaz",
      email: "ana@demo.cl",
    });
    expect(created.status).toBe("pending_payment");
    expect(platform.floatAccount.balance).toBe(0);

    const first = platform.fulfillCheckout(created.id, "cs_test_1");
    expect(first.fulfilled).toBe(true);
    expect(platform.floatAccount.balance).toBe(9000);
    expect(platform.listPolicies()[0]?.status).toBe("active");

    const second = platform.fulfillCheckout(created.id, "cs_test_1");
    expect(second.fulfilled).toBe(false);
    expect(platform.floatAccount.balance).toBe(9000);
  });

  it("rejects a claim on a policy that is still awaiting payment", async () => {
    const platform = new Platform(loadConfig({ PORT: "3000", CURRENCY: "clp" }));
    const { policy: created } = platform.holdPremium({
      planId: "salud-basico",
      holderName: "Ana Díaz",
      email: "ana@demo.cl",
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
});
