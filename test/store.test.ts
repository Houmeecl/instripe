import { describe, expect, it } from "vitest";
import { PlatformStore } from "../src/store/db.js";

describe("PlatformStore", () => {
  it("atomically inserts a record only when its key is unused", () => {
    const store = new PlatformStore(":memory:");

    expect(store.putIfAbsent("transfers", "company:request-key", { status: "SUBMITTING" })).toBe(true);
    expect(store.putIfAbsent("transfers", "company:request-key", { status: "SUBMITTING" })).toBe(false);
    expect(store.get("transfers", "company:request-key")).toEqual({ status: "SUBMITTING" });
  });
});
