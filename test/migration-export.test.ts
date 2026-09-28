import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PlatformStore } from "../src/store/db.js";

describe("SQLite to PostgreSQL export", () => {
  it("writes an atomic, count-verified migration for generic records", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "instripe-migration-"));
    const source = path.join(directory, "platform.db");
    const output = path.join(directory, "platform.instripe-migration.sql");
    const store = new PlatformStore(source);
    store.put("accounts", "acc_1", { owner: "O'Brien", balance: 12000 });
    store.put("sessions", "ses_1", { active: true });

    execFileSync(process.execPath, ["scripts/export-sqlite-to-postgres.mjs", source, output], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    const migration = readFileSync(output, "utf8");
    expect(migration).toContain("-- Source record count: 2");
    expect(migration).toContain("LOCK TABLE records IN ACCESS EXCLUSIVE MODE;");
    expect(migration).toContain("Target records table is not empty; refusing migration");
    expect(migration).toContain("O''Brien");
    expect(migration).toContain("position, collection, id, body) OVERRIDING SYSTEM VALUE VALUES (1,");
    expect(migration).toContain("COUNT(*) FROM records) <> 2");
    expect(migration).toMatch(/Source SHA-256: [a-f0-9]{64}/);
  });
});
