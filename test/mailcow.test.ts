import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMailbox, listMailboxes } from "../src/mail/mailcow.js";

const apiKey = "mailcow-api-secret";

function mailcowConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    MAILCOW_API_URL: "https://mail.proveedorregional.cl",
    MAILCOW_API_KEY: apiKey,
    MAILCOW_DOMAIN: "proveedorregional.cl",
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("administración de buzones Mailcow", () => {
  it("lists only mailboxes from the configured domain and returns safe fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      { username: "ventas@proveedorregional.cl", name: "Ventas", quota: "1024", active: "1", password: "never return this" },
      { username: "other@outside.cl", name: "Other", quota: "512", active: "1" },
    ]));

    const mailboxes = await listMailboxes(mailcowConfig(), fetcher);

    expect(mailboxes).toEqual([{
      email: "ventas@proveedorregional.cl",
      name: "Ventas",
      quotaMb: 1024,
      active: true,
    }]);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://mail.proveedorregional.cl/api/v1/get/mailbox/all"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-API-Key": apiKey }),
      }),
    );
  });

  it("creates one mailbox using the configured domain and does not return its password", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ type: "success", msg: ["mailbox_added"] }]));
    const password = "temporary-strong-password";

    const result = await createMailbox(mailcowConfig(), {
      localPart: "Patrocinios",
      name: "Patrocinios",
      password,
      quotaMb: 1024,
    }, fetcher);

    expect(result).toEqual({ email: "patrocinios@proveedorregional.cl" });
    const [, options] = fetcher.mock.calls[0];
    const payload = JSON.parse(String(options?.body));
    expect(payload).toEqual({
      items: [{
        local_part: "patrocinios",
        domain: "proveedorregional.cl",
        name: "Patrocinios",
        quota: "1024",
        password,
        password2: password,
        active: "1",
      }],
    });
  });

  it("rejects unsafe upstream URLs and invalid mailbox input before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(listMailboxes(mailcowConfig({ MAILCOW_API_URL: "http://mail.proveedorregional.cl" }), fetcher))
      .rejects.toThrow("origen HTTPS");
    await expect(createMailbox(mailcowConfig(), {
      localPart: "bad@example.com",
      name: "Buzón",
      password: "temporary-strong-password",
      quotaMb: 1024,
    }, fetcher)).rejects.toThrow("nombre de buzón válido");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces Mailcow API errors without exposing server credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ type: "error", msg: ["mailbox_exists"] }]));

    await expect(createMailbox(mailcowConfig(), {
      localPart: "ventas",
      name: "Ventas",
      password: "temporary-strong-password",
      quotaMb: 1024,
    }, fetcher)).rejects.toThrow("Mailcow: mailbox_exists");
  });

  it("exposes mailbox administration only to the operation role", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ username: "info@proveedorregional.cl", name: "Información", quota: "256", active: "1" }]))
      .mockResolvedValueOnce(jsonResponse([{ type: "success", msg: ["mailbox_added"] }]));
    vi.stubGlobal("fetch", fetcher);
    try {
      const server = createApp(loadConfig({
        PORT: "3000",
        DATABASE_PATH: ":memory:",
        MAILCOW_API_URL: "https://mail.proveedorregional.cl",
        MAILCOW_API_KEY: apiKey,
      }));
      const operation = request.agent(server);
      const login = await operation.post("/api/session").send({
        email: "operacion@proveedorregional.cl",
        password: "Antofagasta.183",
      });
      expect(login.status).toBe(201);
      if (login.body.user.mustChangePassword) {
        await operation.post("/api/session/password").send({
          currentPassword: "Antofagasta.183",
          newPassword: "Operacion.1831",
        });
      }

      const listing = await operation.get("/api/correo/buzones");
      expect(listing.status).toBe(200);
      expect(listing.body.mailboxes[0].email).toBe("info@proveedorregional.cl");
      const created = await operation.post("/api/correo/buzones").send({
        localPart: "alianzas",
        name: "Alianzas",
        password: "another-temporary-password",
        quotaMb: 512,
      });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({ email: "alianzas@proveedorregional.cl" });

      const commerce = request.agent(server);
      await commerce.post("/api/session").send({ email: "caja@taller.cl", password: "Antofagasta.183" });
      expect((await commerce.get("/api/correo/buzones")).status).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
