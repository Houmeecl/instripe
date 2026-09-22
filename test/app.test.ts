import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function demoApp() {
  const config = loadConfig({ PORT: "3000", CURRENCY: "usd" });
  return createApp(config);
}

describe("instripe app", () => {
  it("reports health with stripe disabled in demo mode", async () => {
    const res = await request(demoApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.stripeConfigured).toBe(false);
  });

  it("lists products with formatted amounts", async () => {
    const res = await request(demoApp()).get("/api/products");
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(3);
    expect(res.body.products[0]).toMatchObject({ id: "starter" });
    expect(res.body.products[0].displayAmount).toBe("$9.00");
  });

  it("creates a demo checkout session for a valid product", async () => {
    const res = await request(demoApp())
      .post("/api/checkout")
      .send({ productId: "pro" });
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe("demo");
    expect(res.body.product.id).toBe("pro");
    expect(res.body.url).toContain("/success");
    expect(res.body.url).toContain("demo=1");
  });

  it("rejects checkout for an unknown product", async () => {
    const res = await request(demoApp())
      .post("/api/checkout")
      .send({ productId: "does-not-exist" });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Unknown product");
  });

  it("requires a productId", async () => {
    const res = await request(demoApp()).post("/api/checkout").send({});
    expect(res.status).toBe(400);
  });

  it("renders the success page", async () => {
    const res = await request(demoApp()).get("/success?session_id=demo_123&demo=1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Payment complete");
    expect(res.text).toContain("demo_123");
  });
});
