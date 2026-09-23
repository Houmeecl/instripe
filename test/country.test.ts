import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { Platform } from "../src/platform.js";
import { issuingFundingHint, treasuryAvailability } from "../src/stripe/country.js";

describe("Stripe by account country", () => {
  it("funds Issuing with the rails of the account's country", () => {
    expect(issuingFundingHint("GB")).toContain("GBP por FPS, CHAPS o Bacs");
    expect(issuingFundingHint("US")).toContain("devuelve las transferencias internacionales");
    expect(issuingFundingHint("ES")).toContain("SEPA");
    expect(issuingFundingHint("CL")).toContain("Chile");
  });

  it("opens Treasury only where this module can", () => {
    expect(treasuryAvailability("US")).toEqual({ usable: true });
    expect(treasuryAvailability("GB").usable).toBe(false);
    expect(treasuryAvailability("GB").detail).toContain("cuentas financieras v2");
    expect(treasuryAvailability("ES").detail).toContain("no ofrece Treasury para una cuenta de España");
  });
});

describe("Treasury records", () => {
  it("keeps financial accounts and their balance after a restart", async () => {
    const databasePath = path.join(mkdtempSync(path.join(tmpdir(), "pr-tsy-")), "platform.db");
    const config = loadConfig({ PORT: "3000", CURRENCY: "clp", DATABASE_PATH: databasePath });

    const first = new Platform(config);
    const account = await first.treasury.open({ nickname: "Caja principal" });
    await first.treasury.fund({ accountId: account.id, amount: 8000, gateway: "chile" });
    expect(first.treasury.list()[0].balance).toBe(8000);

    const second = new Platform(config);
    expect(second.treasury.list()).toEqual([expect.objectContaining({ id: account.id, nickname: "Caja principal", balance: 8000 })]);
  });
});
