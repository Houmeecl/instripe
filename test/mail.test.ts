import net from "node:net";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { listInbox, sendLetter } from "../src/mail/box.js";

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

describe("correo de la empresa", () => {
  it("lists a message from the company mailbox", async () => {
    const server = net.createServer((socket) => {
      socket.write("* OK listo\r\n");
      socket.on("data", (chunk) => {
        const line = chunk.toString();
        const tag = line.split(" ")[0];
        if (line.includes("LOGIN")) socket.write(`${tag} OK login\r\n`);
        else if (line.includes("SELECT")) socket.write(`${tag} OK select\r\n`);
        else if (line.includes("SEARCH")) socket.write(`* SEARCH 7\r\n${tag} OK search\r\n`);
        else if (line.includes("FETCH")) {
          const header = "From: Ana <ana@taller.cl>\r\nSubject: Pedido\r\nDate: hoy\r\n";
          socket.write(`* 1 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${header.length}}\r\n${header})\r\n${tag} OK fetch\r\n`);
        }
      });
    });
    const port = await listen(server);
    const config = loadConfig({
      MAIL_HOST: "127.0.0.1",
      MAIL_IMAP_PORT: String(port),
      MAIL_USER: "edward@proveedorregional.cl",
      MAIL_PASSWORD: "clave",
      MAIL_INSECURE: "1",
    });
    const box = await listInbox(config);
    server.close();
    expect(box.address).toBe("edward@proveedorregional.cl");
    expect(box.messages[0]).toMatchObject({ uid: 7, subject: "Pedido", seen: true });
  });

  it("sends through the company mailbox and hides it from other roles", async () => {
    const received: string[] = [];
    const server = net.createServer((socket) => {
      socket.write("220 listo\r\n");
      socket.on("data", (chunk) => {
        const text = chunk.toString();
        received.push(text);
        if (text.startsWith("EHLO")) socket.write("250-hola\r\n250 listo\r\n");
        else if (text.startsWith("AUTH") || text.startsWith("MAIL") || text.startsWith("RCPT")) socket.write("250 ok\r\n");
        else if (text.includes("AUTH") === false && /^[A-Za-z0-9+/=]+\r\n$/.test(text)) socket.write("235 ok\r\n");
        else if (text.startsWith("DATA")) socket.write("354 sigue\r\n");
        else if (text.includes("\r\n.\r\n")) socket.write("250 enviado\r\n");
      });
    });
    const port = await listen(server);
    const config = loadConfig({
      PORT: "3000",
      DATABASE_PATH: ":memory:",
      MAIL_HOST: "127.0.0.1",
      MAIL_SMTP_PORT: String(port),
      MAIL_USER: "edward@proveedorregional.cl",
      MAIL_PASSWORD: "clave",
      MAIL_INSECURE: "1",
    });
    await sendLetter(config, { to: "ana@taller.cl", subject: "Hola", text: "Listo" });
    server.close();
    expect(received.join("")).toContain("Subject: Hola");

    const app = createApp(loadConfig({ PORT: "3000", DATABASE_PATH: ":memory:" }));
    const comercio = request.agent(app);
    await comercio.post("/api/session").send({ email: "caja@taller.cl", password: "Antofagasta.183" });
    expect((await comercio.get("/api/correo")).status).toBe(403);
    const operacion = request.agent(app);
    const login = await operacion.post("/api/session").send({ email: "operacion@proveedorregional.cl", password: "Antofagasta.183" });
    if (login.body.user.mustChangePassword) {
      await operacion.post("/api/session/password").send({ currentPassword: "Antofagasta.183", newPassword: "Operacion.1831" });
    }
    expect((await operacion.get("/api/correo")).status).toBe(503);
  });
});
