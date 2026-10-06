import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { DEFAULT_SEED_PASSWORD, loadConfig } from "../src/config.js";
import { Global66BusinessApi } from "../src/gateways/global66BusinessApi.js";
import { Global66Catalog } from "../src/gateways/global66Catalog.js";
import { TuuReports } from "../src/gateways/tuuReports.js";
import { RemesasModule, normalizeRut } from "../src/modules/remesas/module.js";
import { PlatformStore } from "../src/store/db.js";

const BENEFICIARY = {
  firstName: "Juan",
  lastName: "Pérez García",
  documentType: "DNI",
  documentNumber: "45678912",
  bankId: 3,
  bankName: "BCP",
  accountType: "SAVING",
  accountNumber: "1234567890",
};
const REMITTER = { name: "María Soto", rut: "12.345.678-5" };
const OPERACION = { id: "usr_operacion", role: "operacion" };
const CONTROL = { id: "usr_control", role: "operacion" };

function app(env: NodeJS.ProcessEnv = {}) {
  return createApp(loadConfig({ DATABASE_PATH: ":memory:", GLOBAL66_CATALOG_URL: "", REMESAS_SEND_DELAY_MINUTES: "0", ...env }));
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
  it("quotes the sent amount, conversion cost, commission and the estimated amount received", async () => {
    const remesas = new RemesasModule(loadConfig({ GLOBAL66_CATALOG_URL: "" }), new PlatformStore(":memory:"));
    const quote = await remesas.quote({ country: "PE", sendAmount: 500_000 });
    expect(quote).toMatchObject({
      currency: "PEN",
      sendAmount: 500_000,
      conversionCost: 6_000,
      amountToConvert: 494_000,
      commission: 15_000,
      total: 515_000,
      receiveAmount: 1800.88,
    });
    await expect(remesas.quote({ country: "PE", sendAmount: Number.NaN })).rejects.toThrow(/entero positivo/);
    await expect(remesas.quote({ country: "MX", sendAmount: 500_000 })).rejects.toThrow(/no está disponible/);
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
      loadConfig({ NODE_ENV: "production", AUTH_SEED_PASSWORD: "x", GLOBAL66_CATALOG_URL: "" }),
      new PlatformStore(":memory:"),
    );
    expect(await remesas.listCorridors()).toEqual([]);
    await remesas.updateCorridor("PE", { rate: 274.31, enabled: true });
    remesas.saveDevice(OPERACION, { serialNumber: "POS-1", label: "Caja 1" });
    const { remesa } = (await remesas.create({ country: "PE", sendAmount: 200_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION }));
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
    let walletBalance = 100_000;
    let clock = Date.parse("2026-10-06T15:00:00Z");
    const now = () => clock;
    const global66 = new Global66BusinessApi("https://g66.test", async (url, init) => {
      const path = String(url);
      if (path.endsWith("/b2b/auth")) return jsonResponse({ token: "t", refreshToken: "r" });
      if (path.endsWith("/b2b/accounts")) {
        return jsonResponse({ accounts: [
          { walletId: 10, currency: "USD", balance: 9_999_999, isPrincipal: false },
          { walletId: 20, currency: "CLP", balance: walletBalance, alias: "SICR3P", isPrincipal: true },
        ] });
      }
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
      GLOBAL66_CATALOG_URL: "",
    });
    const remesas = new RemesasModule(config, new PlatformStore(":memory:"), { tuu, global66 });

    const first = (await remesas.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION })).remesa;
    const mismatch = await remesas.reportPayment(first.id, OPERACION, { approved: true, sequenceNumber: "000000004321", serialNumber: "POS-9" });
    expect(mismatch.status).toBe("pending_review");
    expect(g66Calls).toHaveLength(0);
    expect(tuuCalls[0]).toMatchObject({ SerialNumber: "POS-9", pageSize: 20 });

    saleAmount = 515_000;
    const second = (await remesas.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION })).remesa;
    const sent = await remesas.reportPayment(second.id, OPERACION, { approved: true, sequenceNumber: "000000004321", serialNumber: "POS-9" }).catch((e) => e);
    // The first remittance already claimed that sale.
    expect(String(sent)).toMatch(/otra remesa/);

    const third = (await remesas.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: CONTROL })).remesa;
    const fresh = new RemesasModule(config, new PlatformStore(":memory:"), { tuu, global66, now });
    const own = (await fresh.create({ country: "PE", sendAmount: 500_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION })).remesa;
    const held = await fresh.reportPayment(own.id, OPERACION, { approved: true, sequenceNumber: "000000004321", serialNumber: "POS-9" });
    expect(third.status).toBe("awaiting_payment");
    // 30-minute funds approval window: nothing leaves Global66 yet.
    expect(held.status).toBe("funds_hold");
    expect(held.sendAt).toBe("2026-10-06T15:30:00.000Z");
    clock += 29 * 60_000;
    expect(await fresh.processDue()).toBe(0);
    expect(g66Calls).toHaveLength(0);
    // Window ended but the SICR3P wallet cannot cover the 494.000 CLP: held and retried.
    clock += 2 * 60_000;
    await fresh.processDue();
    expect(fresh.get(own.id, OPERACION)).toMatchObject({ status: "pending_review", retry: "balance" });
    expect(g66Calls).toHaveLength(0);
    walletBalance = 2_000_000;
    await fresh.processDue();
    const ok = fresh.get(own.id, OPERACION);
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
    expect((g66Calls[0].body as { beneficiary: { bankId: number; documentType: string } }).beneficiary).toMatchObject({ bankId: 3, documentType: "DNI" });
    // Leaves from the SICR3P CLP wallet.
    expect(g66Calls[0].body).toMatchObject({ originAccountId: 20 });

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

  it("builds destinations, banks and the beneficiary form from the Global66 catalog", async () => {
    const calls: string[] = [];
    const catalog = new Global66Catalog("https://g66.test", undefined, async (url) => {
      const path = String(url);
      calls.push(path);
      if (path.includes("/route/ext?")) {
        return jsonResponse({
          groups: [
            {
              destinationCountry: "PE",
              destinationCountryNames: { nameES: "Perú" },
              routes: [
                {
                  routeId: 227, originCurrency: "PEN", destinationCountry: "PE", destinationCurrency: "PEN",
                  originMinUsd: 20, originMaxUsd: 100000, slaHours: 8,
                  paymentTypes: [{ id: 1, paymentType: "WIRE_TRANSFER" }],
                  bankingCodes: [{ id: 11, bankName: "INTERBANK" }, { id: 3, bankName: "Banco de Crédito del Peru (BCP)" }],
                },
              ],
            },
            {
              destinationCountry: "MX",
              destinationCountryNames: { nameES: "México" },
              routes: [{ routeId: 210, originCurrency: "MXN", destinationCountry: "MX", destinationCurrency: "MXN", paymentTypes: [{ paymentType: "WIRE_TRANSFER" }], bankingCodes: [] }],
            },
          ],
        });
      }
      if (path.includes("destination-fields")) {
        return jsonResponse({
          routeId: 227,
          fields: [
            { field: "accountType", label: "Tipo de cuenta", required: true, type: "list", options: [{ value: "Saving", label: "Cuenta de ahorro" }, { value: "Checking", label: "Corriente" }] },
            { field: "accountNumber", label: "Número de cuenta", required: true, type: "text" },
            { field: "state", label: "Departamento", required: true, type: "text", maxLength: 100 },
          ],
        });
      }
      if (path.includes("/documents/PE")) {
        return jsonResponse({ individual: [{ nameDisplay: "DNI", value: "DNI", minSize: 8, maxSize: 9, characterType: "^\\d+$" }, { nameDisplay: "Pasaporte", value: "PASS", minSize: 1, maxSize: 50, characterType: "^\\w+$" }] });
      }
      if (path.includes("/sla?")) return jsonResponse({ slaHours: 2 });
      return jsonResponse({}, 404);
    });
    const remesas = new RemesasModule(loadConfig({}), new PlatformStore(":memory:"), { catalog });

    // RaaS does not accept a remitter to Mexico, so it is not offered.
    expect((await remesas.listCorridors(true)).map((corridor) => corridor.country)).toEqual(["PE"]);
    const form = await remesas.form("PE");
    expect(form.banks.map((bank) => bank.id)).toEqual([3, 11]);
    expect(form.accountTypes.map((type) => type.value)).toEqual(["SAVING", "CHECKING"]);
    expect(form.documents.map((document) => document.value)).toEqual(["DNI", "PASS"]);
    expect(form.extraFields).toEqual([{ field: "state", label: "Departamento", required: true, maxLength: 100 }]);

    const quote = await remesas.quote({ country: "PE", sendAmount: 500_000 });
    expect(quote.slaHours).toBe(2);

    const base = { country: "PE", sendAmount: 100_000, remitter: REMITTER, actor: OPERACION };
    await expect(remesas.create({ ...base, beneficiary: { ...BENEFICIARY, extra: { state: "Lima" }, documentNumber: "12AB" } })).rejects.toThrow(/DNI/);
    await expect(remesas.create({ ...base, beneficiary: { ...BENEFICIARY, extra: { state: "Lima" }, bankId: 999 } })).rejects.toThrow(/Elige un banco/);
    await expect(remesas.create({ ...base, beneficiary: BENEFICIARY })).rejects.toThrow(/Departamento/);
    const { remesa } = await remesas.create({ ...base, beneficiary: { ...BENEFICIARY, extra: { state: "Lima" }, documentType: "PASS", documentNumber: "AB12345" } });
    expect(remesa.beneficiary).toMatchObject({ bankId: 3, bankName: "Banco de Crédito del Peru (BCP)", accountType: "SAVING", documentType: "PASS", extra: { state: "Lima" } });

    // Cached for 12 hours: one route request for everything above.
    expect(calls.filter((call) => call.includes("/route/ext?")).length).toBe(1);
  });

  it("falls back to the built-in Global66 snapshot when the catalog is unreachable", async () => {
    const catalog = new Global66Catalog("https://g66.test", undefined, async () => {
      throw new Error("offline");
    });
    const remesas = new RemesasModule(loadConfig({}), new PlatformStore(":memory:"), { catalog });
    const countries = (await remesas.listCorridors(true)).map((corridor) => corridor.country);
    expect(countries).toContain("PE");
    expect((await remesas.form("PE")).banks.some((bank) => bank.id === 3)).toBe(true);
  });

  it("remembers beneficiaries per company and remitter for the next remittance", async () => {
    const server = app();
    const taller = await signedIn(server, "caja@taller.cl");
    const norte = await signedIn(server, "pago@norte.cl");
    const form = await taller.get("/api/remesas/formulario/PE");
    expect(form.status).toBe(200);
    expect(form.body.form.banks.length).toBeGreaterThan(0);
    await taller.post("/api/remesas").send({ country: "PE", sendAmount: 50_000, remitter: REMITTER, beneficiary: BENEFICIARY });
    const saved = await taller.get("/api/remesas/beneficiarios").query({ rut: "12345678-5", country: "PE" });
    expect(saved.body.beneficiaries).toHaveLength(1);
    expect(saved.body.beneficiaries[0]).toMatchObject({ firstName: "Juan", accountNumber: "1234567890", bankId: 3 });
    expect((await norte.get("/api/remesas/beneficiarios").query({ rut: "12345678-5" })).body.beneficiaries).toEqual([]);
  });

  it("keeps the money in the funds approval window until it ends, and lets Operación hold or send early", async () => {
    let clock = Date.parse("2026-10-06T15:00:00Z");
    const sales: Record<string, { status: string; amount: number }> = {};
    const tuu = new TuuReports("tuu-key", "https://tuu.test", async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { SerialNumber: string };
      return jsonResponse({ data: Object.entries(sales).map(([sequenceNumber, sale]) => ({ sequenceNumber, posSerialNumber: body.SerialNumber, ...sale })) });
    });
    const catalog = new Global66Catalog("https://g66.test", undefined, async (url) =>
      String(url).includes("/sla?") ? jsonResponse({ slaHours: 2 }) : jsonResponse({}, 404),
    );
    const remesas = new RemesasModule(
      loadConfig({ TUU_API_KEY: "tuu-key", GLOBAL66_CATALOG_URL: "" }),
      new PlatformStore(":memory:"),
      { tuu, catalog, now: () => clock },
    );
    const base = { country: "PE", sendAmount: 100_000, remitter: REMITTER, beneficiary: BENEFICIARY };

    // Boleta: dteType 48 and the remitted amount as exempt, so only the commission is taxed.
    const created = await remesas.create({ ...base, actor: OPERACION });
    expect(created.tuuPayment).toMatchObject({ dteType: 48, extraData: { exemptAmount: 100_000 } });

    // A sale voided in TUU during the window does not leave.
    sales["000000000001"] = { status: "Aprobada", amount: created.remesa.quote.total };
    await remesas.reportPayment(created.remesa.id, OPERACION, { approved: true, sequenceNumber: "000000000001", serialNumber: "POS-1" });
    expect(remesas.get(created.remesa.id, OPERACION).status).toBe("funds_hold");
    sales["000000000001"] = { status: "Anulada", amount: created.remesa.quote.total };
    clock += 31 * 60_000;
    await remesas.processDue();
    expect(remesas.get(created.remesa.id, OPERACION).status).toBe("pending_review");

    // Operación holds one, and sends another one early (a second Operación user).
    const toHold = (await remesas.create({ ...base, actor: OPERACION })).remesa;
    sales["000000000002"] = { status: "Aprobada", amount: toHold.quote.total };
    await remesas.reportPayment(toHold.id, OPERACION, { approved: true, sequenceNumber: "000000000002", serialNumber: "POS-1" });
    expect(remesas.get(toHold.id, OPERACION).estimatedArrival).toBe(new Date(clock + 30 * 60_000 + 2 * 3_600_000).toISOString());
    expect(() => remesas.hold(toHold.id, { id: "usr_taller", role: "comercio" }, "x")).toThrow(/Solo Operación/);
    expect(remesas.hold(toHold.id, CONTROL, "Cliente anuló en caja").status).toBe("pending_review");
    clock += 31 * 60_000;
    expect(await remesas.processDue()).toBe(0);

    const early = (await remesas.create({ ...base, actor: OPERACION })).remesa;
    sales["000000000003"] = { status: "Aprobada", amount: early.quote.total };
    await remesas.reportPayment(early.id, OPERACION, { approved: true, sequenceNumber: "000000000003", serialNumber: "POS-1" });
    await expect(remesas.sendNow(early.id, OPERACION)).rejects.toThrow(/Otro usuario/);
    expect((await remesas.sendNow(early.id, CONTROL)).status).toBe("processing");
  });

  it("posts balanced double-entry lines per remittance and reconciles the TUU deposit", async () => {
    const server = app();
    const operacion = await signedIn(server);
    const created = await operacion.post("/api/remesas").send({ country: "PE", sendAmount: 100_000, remitter: REMITTER, beneficiary: BENEFICIARY });
    const id = created.body.remesa.id;
    const quote = created.body.remesa.quote;
    await operacion.post(`/api/remesas/${id}/pago`).send({ approved: true, sequenceNumber: "000000000777", serialNumber: "POS-1" });

    const ledger = await operacion.get("/api/remesas/ledger");
    const despacho = ledger.body.lines.filter((line: { event: string }) => line.event === "despacho");
    expect(despacho).toEqual([
      expect.objectContaining({ account: "cxc_tuu", debit: quote.total, credit: 0 }),
      expect.objectContaining({ account: "fondo_global66", debit: 0, credit: quote.amountToConvert }),
      expect.objectContaining({ account: "ingreso_comision", debit: 0, credit: quote.total - quote.amountToConvert }),
    ]);
    const sum = (rows: Array<{ debit: number; credit: number }>) => rows.reduce((total, row) => total + row.debit - row.credit, 0);
    expect(sum(ledger.body.lines)).toBe(0);

    // Retrying the step does not post twice.
    await operacion.post(`/api/remesas/${id}/actualizar`);
    expect((await operacion.get("/api/remesas/ledger")).body.lines.filter((line: { event: string }) => line.event === "despacho")).toHaveLength(3);

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
    const reconciled = await operacion.post("/api/remesas/conciliar").send({ date: today });
    expect(reconciled.status).toBe(200);
    expect(reconciled.body).toMatchObject({ reconciled: [created.body.remesa.code], gross: quote.total, fees: quote.posFeeEstimated });
    const after = await operacion.get("/api/remesas/ledger");
    const balance = (account: string) => after.body.balances.find((row: { account: string }) => row.account === account).balance;
    expect(balance("cxc_tuu")).toBe(0);
    expect(balance("banco")).toBe(quote.total - quote.posFeeEstimated);
    expect(balance("gasto_comision_tuu")).toBe(quote.posFeeEstimated);
    expect(sum(after.body.lines)).toBe(0);
    expect((await operacion.post("/api/remesas/conciliar").send({ date: today })).body.reconciled).toEqual([]);

    const comercio = await signedIn(server, "caja@taller.cl");
    expect((await comercio.post("/api/remesas/conciliar").send({ date: today })).status).toBe(403);
  });

  it("reverses the dispatch when Global66 rejects the transfer", async () => {
    const remesas = new RemesasModule(
      loadConfig({ GLOBAL66_CATALOG_URL: "", GLOBAL66_WEBHOOK_API_KEY: "k", REMESAS_SEND_DELAY_MINUTES: "0" }),
      new PlatformStore(":memory:"),
    );
    const { remesa } = await remesas.create({ country: "PE", sendAmount: 100_000, remitter: REMITTER, beneficiary: BENEFICIARY, actor: OPERACION });
    const sent = await remesas.reportPayment(remesa.id, OPERACION, { approved: true, sequenceNumber: "1", serialNumber: "POS-1" });
    remesas.handleWebhook("k", { payload: { transactionId: sent.global66?.transactionId, status: "rejected" } });
    const balances = Object.fromEntries(remesas.ledgerBalances(OPERACION).map((row) => [row.account, row.balance]));
    expect(balances.fondo_global66).toBe(0);
    expect(balances.devolucion_cliente).toBe(-remesa.quote.amountToConvert);
  });

  it("only accepts payments from registered, active POS terminals of the company", async () => {
    const server = app({ NODE_ENV: "production", AUTH_SEED_PASSWORD: "Clave.Segura.2026" });
    const login = async (email: string) => {
      const agent = request.agent(server);
      await agent.post("/api/session").send({ email, password: "Clave.Segura.2026" });
      await agent.post("/api/session/password").send({ currentPassword: "Clave.Segura.2026", newPassword: "Remesas.2026" });
      return agent;
    };
    const operacion = await login("operacion@proveedorregional.cl");
    const comercio = await login("caja@taller.cl");
    await operacion.put("/api/remesas/corredores/PE").send({ rate: 274.31, enabled: true });
    const created = await comercio.post("/api/remesas").send({ country: "PE", sendAmount: 100_000, remitter: REMITTER, beneficiary: BENEFICIARY });
    const pay = (serial: string) => comercio.post(`/api/remesas/${created.body.remesa.id}/pago`).send({ approved: true, sequenceNumber: "000000000001", serialNumber: serial });

    expect((await pay("POS-X")).status).toBe(403);
    expect((await comercio.put("/api/remesas/pos/POS-1").send({ label: "Caja 1" })).status).toBe(403);
    await operacion.put("/api/remesas/pos/POS-OTRO").send({ label: "Otro comercio", companyId: "cmp_otro" });
    expect((await pay("POS-OTRO")).status).toBe(403);
    await operacion.put("/api/remesas/pos/POS-1").send({ label: "Caja 1", active: false });
    expect((await pay("POS-1")).status).toBe(403);
    await operacion.put("/api/remesas/pos/POS-1").send({ active: true });
    const ok = await pay("POS-1");
    expect(ok.status).toBe(200);
    expect(ok.body.remesa.status).toBe("pending_review");
    expect((await operacion.get("/api/remesas/pos")).body.devices.map((d: { serialNumber: string }) => d.serialNumber).sort()).toEqual(["POS-1", "POS-OTRO"]);
  });

  it("lets an API client such as Appsmith use the session as a Bearer token", async () => {
    const server = app();
    await signedIn(server, "caja@taller.cl");
    const browser = await request(server).post("/api/session").send({ email: "caja@taller.cl", password: "Remesas.2026" });
    expect(browser.body.token).toBeUndefined();
    const api = await request(server).post("/api/session").set("X-Client", "api").send({ email: "caja@taller.cl", password: "Remesas.2026" });
    expect(api.body.token).toMatch(/^[0-9a-f]{64}$/);
    const list = await request(server).get("/api/remesas").set("Authorization", `Bearer ${api.body.token}`);
    expect(list.status).toBe(200);
    expect((await request(server).get("/api/remesas").set("Authorization", "Bearer nope")).status).toBe(401);
  });
});
