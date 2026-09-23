import net from "node:net";
import tls from "node:tls";
import { PlatformError } from "../errors.js";
import type { AppConfig } from "../config.js";
import { isMailConfigured } from "../config.js";

export interface MailSummary {
  uid: number;
  from: string;
  subject: string;
  date: string;
  seen: boolean;
}

export interface MailLetter extends MailSummary {
  body: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function quoteImap(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function headerValue(header: string, name: string): string {
  const match = header.match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
  return (match?.[1] ?? "").replace(/\s+/g, " ").trim();
}

class LineSocket {
  private pending = Buffer.alloc(0);
  private waiters: Array<(chunk: Buffer) => void> = [];

  constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(chunk);
      else this.pending = Buffer.concat([this.pending, chunk]);
    });
  }

  private nextChunk(): Promise<Buffer> {
    if (this.pending.length) {
      const chunk = this.pending;
      this.pending = Buffer.alloc(0);
      return Promise.resolve(chunk);
    }
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.socket.once("error", onError);
      this.waiters.push((chunk) => {
        this.socket.off("error", onError);
        resolve(chunk);
      });
    });
  }

  async readBytes(count: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let got = 0;
    while (got < count) {
      const chunk = await this.nextChunk();
      const need = count - got;
      parts.push(chunk.subarray(0, need));
      got += Math.min(chunk.length, need);
      if (chunk.length > need) this.pending = Buffer.concat([chunk.subarray(need), this.pending]);
    }
    return Buffer.concat(parts);
  }

  async readLine(): Promise<string> {
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = await this.nextChunk();
      const end = chunk.indexOf("\r\n");
      if (end >= 0) {
        chunks.push(chunk.subarray(0, end));
        if (chunk.length > end + 2) this.pending = Buffer.concat([chunk.subarray(end + 2), this.pending]);
        let line = Buffer.concat(chunks).toString("utf8");
        const literal = line.match(/\{(\d+)\}$/);
        if (literal) {
          const bytes = await this.readBytes(Number(literal[1]));
          const rest = await this.readLine();
          line = `${line}\r\n${bytes.toString("utf8")}${rest}`;
        }
        return line;
      }
      chunks.push(chunk);
    }
  }
}

function connectSocket(config: AppConfig, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (config.mail.insecure) {
      const socket = net.connect(port, config.mail.host, () => resolve(socket));
      socket.once("error", reject);
      return;
    }
    const socket = tls.connect(
      { host: config.mail.host, port, servername: config.mail.host, rejectUnauthorized: true },
      () => resolve(socket),
    );
    socket.once("error", reject);
  });
}

async function withImap<T>(config: AppConfig, run: (command: (line: string) => Promise<string[]>, lines: LineSocket) => Promise<T>): Promise<T> {
  if (!isMailConfigured(config)) {
    throw new PlatformError("El correo de la empresa no está configurado", 503);
  }
  const socket = await connectSocket(config, config.mail.imapPort);
  const lines = new LineSocket(socket);
  let n = 0;
  const command = async (line: string) => {
    const tag = `a${++n}`;
    socket.write(`${tag} ${line}\r\n`);
    const response: string[] = [];
    for (;;) {
      const row = await lines.readLine();
      response.push(row);
      if (row.startsWith(`${tag} `)) {
        if (!row.startsWith(`${tag} OK`)) throw new PlatformError("El correo no respondió", 502);
        return response;
      }
    }
  };
  try {
    await lines.readLine();
    await command(`LOGIN ${quoteImap(config.mail.user!)} ${quoteImap(config.mail.password!)}`);
    await command("SELECT INBOX");
    return await run(command, lines);
  } finally {
    socket.end();
  }
}

function parseFetch(rows: string[]): MailSummary[] {
  const messages: MailSummary[] = [];
  for (const row of rows) {
    if (!row.includes("FETCH")) continue;
    const uid = Number(row.match(/\bUID (\d+)/)?.[1]);
    if (!uid) continue;
    const headerStart = row.indexOf("\r\n");
    const header = headerStart >= 0 ? row.slice(headerStart + 2) : "";
    messages.push({
      uid,
      from: headerValue(header, "From") || "Sin remitente",
      subject: headerValue(header, "Subject") || "(sin asunto)",
      date: headerValue(header, "Date"),
      seen: /\\Seen/.test(row),
    });
  }
  return messages.sort((a, b) => b.uid - a.uid);
}

export async function listInbox(config: AppConfig): Promise<{ address: string; messages: MailSummary[] }> {
  return withImap(config, async (command) => {
    const search = await command("UID SEARCH ALL");
    const uids = (search.find((row) => row.startsWith("* SEARCH")) ?? "")
      .replace("* SEARCH", "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((uid) => uid > 0)
      .slice(-25);
    if (!uids.length) return { address: config.mail.user!, messages: [] };
    const fetched = await command(
      `UID FETCH ${uids.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`,
    );
    return { address: config.mail.user!, messages: parseFetch(fetched) };
  });
}

export async function readLetter(config: AppConfig, uid: number): Promise<MailLetter> {
  if (!Number.isInteger(uid) || uid <= 0) throw new PlatformError("Mensaje desconocido", 400);
  return withImap(config, async (command) => {
    const fetched = await command(`UID FETCH ${uid} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT])`);
    const summary = parseFetch(fetched)[0];
    if (!summary) throw new PlatformError("Mensaje desconocido", 404);
    const row = fetched.find((line) => line.includes("BODY[TEXT]")) ?? "";
    const marker = row.indexOf("BODY[TEXT]");
    const literal = marker >= 0 ? row.slice(row.indexOf("\r\n", marker) + 2) : "";
    const body = literal.replace(/\)\s*$/, "").trim().slice(0, 20_000);
    return { ...summary, body: body || "(sin texto)" };
  });
}

async function smtpReply(socket: net.Socket, lines: LineSocket, command?: string): Promise<string> {
  if (command) socket.write(`${command}\r\n`);
  let last = "";
  for (;;) {
    last = await lines.readLine();
    if (/^\d{3} /.test(last)) return last;
    if (!/^\d{3}-/.test(last)) return last;
  }
}

export async function sendLetter(config: AppConfig, input: { to: string; subject: string; text: string }): Promise<void> {
  if (!isMailConfigured(config)) throw new PlatformError("El correo de la empresa no está configurado", 503);
  const to = input.to.trim();
  const subject = input.subject.replace(/[\r\n]/g, " ").trim();
  const text = input.text.replace(/\r?\n/g, "\r\n");
  if (!EMAIL.test(to) || !subject || !text.trim()) {
    throw new PlatformError("Destino, asunto y mensaje son requeridos", 400);
  }
  const plain = await connectSocket(config, config.mail.smtpPort);
  let channel = plain;
  const greet = new LineSocket(plain);
  const banner = await greet.readLine();
  if (!banner.startsWith("220")) throw new PlatformError("El correo no aceptó el envío", 502);
  await smtpReply(plain, greet, `EHLO ${config.mail.host}`);
  if (!config.mail.insecure) {
    const ready = await smtpReply(plain, greet, "STARTTLS");
    if (!ready.startsWith("220")) throw new PlatformError("El correo no aceptó el envío", 502);
    plain.removeAllListeners("data");
    channel = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const socket = tls.connect({ socket: plain, host: config.mail.host, servername: config.mail.host }, () => resolve(socket));
      socket.once("error", reject);
    });
  }
  const lines = channel === plain ? greet : new LineSocket(channel);
  await smtpReply(channel, lines, `EHLO ${config.mail.host}`);
  await smtpReply(channel, lines, "AUTH LOGIN");
  await smtpReply(channel, lines, Buffer.from(config.mail.user!).toString("base64"));
  const authed = await smtpReply(channel, lines, Buffer.from(config.mail.password!).toString("base64"));
  if (!authed.startsWith("235")) throw new PlatformError("El correo no aceptó el envío", 502);
  await smtpReply(channel, lines, `MAIL FROM:<${config.mail.user}>`);
  const accepted = await smtpReply(channel, lines, `RCPT TO:<${to}>`);
  if (!accepted.startsWith("250")) throw new PlatformError("Ese destino no se puede usar", 400);
  await smtpReply(channel, lines, "DATA");
  const dotted = text.split("\r\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
  channel.write(`From: ${config.mail.user}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${dotted}\r\n.\r\n`);
  const queued = await lines.readLine();
  channel.end();
  if (!queued.startsWith("250")) throw new PlatformError("El correo no aceptó el envío", 502);
}
