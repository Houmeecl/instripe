import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { DEFAULT_SEED_PASSWORD, loadConfig } from "../src/config.js";
import { Global66BusinessApi } from "../src/gateways/global66BusinessApi.js";
import { TuuReports } from "../src/gateways/tuuReports.js";
import { RemesasModule, normalizeRut } from "../src/modules/remesas/module.js";
import { PlatformStore } from "../src/store/db.js";

const BENEFICIARY = {
  firstName: "Juan",
  lastName: "Pérez García",
  documentType: "DNI",
  documentNumber: "45678912",
  bankName: "BCP - Banco de Crédito del Perú",
  accountType: "SAVING",
  accountNumber: "1234567890",
};
const REMITTER = { name: "María Soto", rut: "12.345.678-5" };
const OPERACION = { id: "usr_operacion", role: "operacion" };
const CONTROL = { id: "usr_control", role: "operacion" };

function app(env: NodeJS.ProcessEnv = {}) {
  return createApp(loadConfig({ DATABASE_PATH: ":memory:", ...env }));
}

async function signedIn(server: ReturnType<typeof app>, email = "operacion@proveedorregional.cl") {
  const agent = request.agent(server);
  const login = await agent.post("/api/session").send({ email, password: DEFAULT_SEED_PASSWORD });
  expect(login.status).toBe(201);
  await agent.post("/api/session/password").send({ currentPassword: DEFAULT_SEED_PASSWORD, newPassword: "Remesas.2026" });
  return agent;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("remesas TUU + Global66", () => {
  it("quotes the sent amount, conversion cost, commission and the estimated amount received", () => {
    const remesas = new RemesasModule(loadConfig({}), new PlatformStore(":memory:"));
    const quote = remesas.quote({ country: "PE", sendAmount: 500_000 });
    expect(quote).toMatchObject({
      currency: "PEN",
      sendAmount: 500_000,
      conversionCost: 6_000,
      amountToConvert: 494_000,
      commission: 15_000,
      total: 515_000,
      receiveAmount: 1800.88,
    });
    expect(() => remesas.quote({ country: "PE", sendAmount: Number.NaN })).toThrow(/entero positivo/);
    expect(() => remesas.quote({ country: "MX", sendAmount: 500_000 })).toThrow(/no está disponible/);
  });

  it("validates the Chilean RUT check digit", () => {
    expect(normalizeRut("12.345.678-5")).toBe("12345678-5");
    expect(normalizeRut("12345678-9")).toBe("");
    expect(normalizeRut("7.654.321-6")).toBe("7654321-6");
  });

  it("runs the demo flow from the POS payment to the beneficiary and exposes a masked tracking page", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const config = await comercio.get("/api/remesas/config");
    expect(config.status).toBe(200);
    expect(config.body.canConfigure).toBe(false);

    const created = await comercio.post("/api/remesas").send({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY });
    expect(created.status).toBe(201);
    expect(created.body.remesa.code).toMatch(/^CR-\d{4}-000001$/);
    expect(created.body.tuuPayment).toMatchObject({ amount: 515_000, method: 0, printVoucherOnApp: true });
    const id = created.body.remesa.id;

    const paid = await comercio.post(`/api/remesas/${id}/pago`).send({ approved: true, sequenceNumber: "000000001234", serialNumber: "POS-1" });
    expect(paid.status).toBe(200);
    expect(paid.body.remesa.status).toBe("processing");

    expect((await comercio.post(`/api/remesas/${id}/actualizar`)).body.remesa.status).toBe("sent");
    expect((await comercio.post(`/api/remesas/${id}/actualizar`)).body.remesa.status).toBe("successful");

    const token = String(paid.body.trackingUrl).split("/").pop();
    const tracking = await request(server).get(`/api/seguimiento/${token}`);
    expect(tracking.status).toBe(200);
    expect(tracking.body).toMatchObject({ status: "successful", currency: "PEN", account: "••••7890", beneficiary: "Juan P." });
    expect(JSON.stringify(tracking.body)).not.toContain("12345678");
    expect((await request(server).get("/seguimiento/" + token)).status).toBe(200);

    const reused = await comercio.post("/api/remesas").send({ country: "PE", sendAmount: 100_000, remitter: REMITTER, beneficiary: BENEFICIARY });
    const duplicate = await comercio.post(`/api/remesas/${reused.body.remesa.id}/pago`).send({ approved: true, sequenceNumber: "000000001234", serialNumber: "POS-1" });
    expect(duplicate.status).toBe(409);

    const csv = await comercio.get("/api/remesas/export");
    expect(csv.text).toContain("total_cobrado_clp");
    expect(csv.text).toContain("515000");
  });

  it("keeps remittances per company and corridor settings with Operación", async () => {
    const server = app();
    const taller = await signedIn(server, "caja@taller.cl");
    const norte = await signedIn(server, "pago@norte.cl");
    const created = await taller.post("/api/remesas").send({ country: "PE", sendAmount: 50_000, remitter: REMITTER, beneficiary: BENEFICIARY });
    expect((await norte.get("/api/remesas")).body.remesas).toEqual([]);
    expect((await norte.get(`/api/remesas/${created.body.remesa.id}`)).status).toBe(404);
    expect((await taller.put("/api/remesas/corredores/PE").send({ rate: 1 })).status).toBe(403);

    const operacion = await signedIn(server);
    const updated = await operacion.put("/api/remesas/corredores/PE").send({ rate: 280, commissionPct: 0.02 });
    expect(updated.status).toBe(200);
    expect(updated.body.corridor).toMatchObject({ rate: 280, commissionPct: 0.02 });
    expect((await operacion.get("/api/remesas")).body.remesas).toHaveLength(1);
  });

  it("rejects bad remitter and beneficiary data", async () => {
    const server = app();
    const comercio = await signedIn(server, "caja@taller.cl");
    const badRut = await comercio.post("/api/remesas").send({ country: "PE", sendAmount: 50_000, remitter: { name: "X", rut: "11.111.111-2" }, beneficiary: BENEFICIARY });
    expect(badRut.status).toBe(400);
    const badAccount = await comercio.post("/api/remesas").send({ country: "PE", sendAmount: 50_000, remitter: REMITTER, beneficiary: { ...BENEFICIARY, accountType: "RUT" } });
    expect(badAccount.status).toBe(400);
  });

  it("in production without TUU verification holds the remittance for a second Operación user", async () => {
    const remesas = new RemesasModule(
      loadConfig({ NODE_ENV: "production", AUTH_SEED_PASSWORD: "x" }),
      new PlatformStore(":memory:"),
    );
    expect(remesas.listCorridors()).toEqual([]);
    remesas.updateCorridor("PE", { rate: 274.31, enabled: true });
    const { remesa } = remesas.create({ country: "PE", sendAmount: 200_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION });
    const held = await remesas.reportPayment(remesa.id, OPERACION, { approved: true, sequenceNumber: "1", serialNumber: "POS-1" });
    expect(held.status).toBe("pending_review");
    await expect(remesas.approve(remesa.id, OPERACION)).rejects.toThrow(/Otro usuario/);
    const released = await remesas.approve(remesa.id, CONTROL);
    expect(released.status).toBe("processing");
  });

  it("sends through Global66 RaaS only after the TUU report shows the same sale", async () => {
    const tuuCalls: unknown[] = [];
    let saleAmount = 999;
    const tuu = new TuuReports("tuu-key", "https://tuu.test", async (_url, init) => {
      tuuCalls.push(JSON.parse(String(init?.body)));
      return jsonResponse({ data: [{ saleId: "s1", sequenceNumber: "000000004321", posSerialNumber: "POS-9", status: "Aprobada", amount: saleAmount, typeTransaction: "DEBIT" }] });
    });
    const g66Calls: Array<{ url: string; body: unknown }> = [];
    const global66 = new Global66BusinessApi("https://g66.test", async (url, init) => {
      const path = String(url);
      if (path.endsWith("/b2b/auth")) return jsonResponse({ token: "t", refreshToken: "r" });
      const form = init?.body as FormData;
      g66Calls.push({ url: path, body: JSON.parse(String(form.get("request"))) });
      return jsonResponse({ valid: true, status: "PROCESSING", transactionId: 777, externalReferenceId: "x", violations: [] });
    });
    const config = loadConfig({
      TUU_API_KEY: "tuu-key",
      GLOBAL66_B2B_CLIENT_ID: "id",
      GLOBAL66_B2B_CLIENT_SECRET: "secret",
      GLOBAL66_WEBHOOK_API_KEY: "hook-key",
      GLOBAL66_REMITTANCE_PURPOSE_CODE: "64",
    });
    const remesas = new RemesasModule(config, new PlatformStore(":memory:"), { tuu, global66 });

    const first = remesas.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION }).remesa;
    const mismatch = await remesas.reportPayment(first.id, OPERACION, { approved: true, sequenceNumber: "000000004321", serialNumber: "POS-9" });
    expect(mismatch.status).toBe("pending_review");
    expect(g66Calls).toHaveLength(0);
    expect(tuuCalls[0]).toMatchObject({ SerialNumber: "POS-9", pageSize: 20 });

    saleAmount = 515_000;
    const second = remesas.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION }).remesa;
    const sent = await remesas.reportPayment(second.id, OPERACION, { approved: true, sequenceNumber: "000000004321", serialNumber: "POS-9" }).catch((e) => e);
    // The first remittance already claimed that sale.
    expect(String(sent)).toMatch(/otra remesa/);

    const third = remesas.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: CONTROL }).remesa;
    const fresh = new RemesasModule(config, new PlatformStore(":memory:"), { tuu, global66 });
    const own = fresh.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION }).remesa;
    const ok = await fresh.reportPayment(own.id, OPERACION, { approved: true, sequenceNumber: "000000004321", serialNumber: "POS-9" });
    expect(third.status).toBe("awaiting_payment");
    expect(ok.status).toBe("processing");
    expect(ok.global66?.transactionId).toBe("777");
    expect(g66Calls[0].url).toBe("https://g66.test/b2b/transactions/raas/payments");
    expect(g66Calls[0].body).toMatchObject({
      externalReferenceId: own.code,
      transactionType: "REMITTANCE",
      originCurrency: "CLP",
      amount: 494_000,
      purposeCode: [{ purposeCode: 64 }],
      beneficiary: { destinationCurrency: "PEN", countryCode: "PE", accountType: "SAVING", accountNumber: "1234567890" },
      remitter: { name: "María Soto", identificationType: "RUT", identificationNumber: "12345678-5", countryCode: "CL" },
    });

    expect(fresh.handleWebhook("wrong", {})).toBe(false);
    expect(fresh.handleWebhook("hook-key", { event: "RMT - Transaction", payload: { transactionId: 777, status: "successful", destinyAmount: 1801.5 } })).toBe(true);
    const done = fresh.get(own.id, OPERACION);
    expect(done.status).toBe("successful");
    expect(done.global66?.destinationAmount).toBe(1801.5);
  });

  it("answers the Global66 webhook with 401 when the key is wrong", async () => {
    const server = app({ GLOBAL66_WEBHOOK_API_KEY: "hook-key" });
    expect((await request(server).post("/webhooks/global66").set("x-api-key", "nope").send({})).status).toBe(401);
    expect((await request(server).post("/webhooks/global66").set("x-api-key", "hook-key").send({ payload: {} })).status).toBe(200);
  });
});
