import { PlatformError } from "../errors.js";
import { isMailcowConfigured, type AppConfig } from "../config.js";

export interface MailcowMailbox {
  email: string;
  name: string;
  quotaMb: number;
  active: boolean;
}

export interface CreateMailboxInput {
  localPart: string;
  name: string;
  password: string;
  quotaMb: number;
}

type Fetcher = typeof fetch;

function apiBase(config: AppConfig): URL {
  if (!isMailcowConfigured(config)) {
    throw new PlatformError("Configura MAILCOW_API_URL, MAILCOW_API_KEY y MAILCOW_DOMAIN en el servidor", 503);
  }

  let url: URL;
  try {
    url = new URL(config.mailcow.apiUrl!);
  } catch {
    throw new PlatformError("MAILCOW_API_URL no es una URL válida", 503);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new PlatformError("MAILCOW_API_URL debe ser el origen HTTPS de Mailcow, sin ruta ni credenciales", 503);
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.mailcow.domain)) {
    throw new PlatformError("MAILCOW_DOMAIN no es válido", 503);
  }
  return url;
}

async function callMailcow(
  config: AppConfig,
  endpoint: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<unknown> {
  const base = apiBase(config);
  let response: Response;
  try {
    response = await fetcher(new URL(`/api/v1/${endpoint}`, base), {
      ...init,
      headers: {
        "X-API-Key": config.mailcow.apiKey!,
        Accept: "application/json",
        ...init.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError"
      ? "Mailcow no respondió dentro del tiempo esperado"
      : "No se pudo conectar con Mailcow";
    throw new PlatformError(reason, 502);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new PlatformError(`Mailcow devolvió una respuesta no JSON (HTTP ${response.status})`, 502);
  }
  if (!response.ok) {
    throw new PlatformError(`Mailcow rechazó la solicitud (HTTP ${response.status})`, 502);
  }
  return data;
}

function mailcowFailure(data: unknown): string | undefined {
  const entries = Array.isArray(data) ? data : [data];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !("type" in entry)) continue;
    if (entry.type === "success") continue;
    const message = "msg" in entry ? entry.msg : undefined;
    if (typeof message === "string") return message.slice(0, 300);
    if (Array.isArray(message)) return message.filter((item) => typeof item === "string").join(", ").slice(0, 300);
    return "Mailcow no pudo completar la operación";
  }
  return undefined;
}

export async function listMailboxes(config: AppConfig, fetcher: Fetcher = fetch): Promise<MailcowMailbox[]> {
  const data = await callMailcow(config, "get/mailbox/all", { method: "GET" }, fetcher);
  if (!Array.isArray(data)) throw new PlatformError("Mailcow devolvió un listado de buzones inválido", 502);

  const suffix = `@${config.mailcow.domain}`;
  return data.flatMap((entry): MailcowMailbox[] => {
    if (!entry || typeof entry !== "object") return [];
    const mailbox = entry as Record<string, unknown>;
    const email = typeof mailbox.username === "string" ? mailbox.username.toLowerCase() : "";
    if (!email.endsWith(suffix)) return [];

    const quota = Number(mailbox.quota ?? mailbox.max_quota ?? 0);
    return [{
      email,
      name: typeof mailbox.name === "string" ? mailbox.name : "",
      quotaMb: Number.isFinite(quota) ? quota : 0,
      active: mailbox.active === 1 || mailbox.active === "1" || mailbox.active === true,
    }];
  });
}

export async function createMailbox(
  config: AppConfig,
  input: CreateMailboxInput,
  fetcher: Fetcher = fetch,
): Promise<{ email: string }> {
  apiBase(config);
  const localPart = input.localPart.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(localPart)) {
    throw new PlatformError("Usa un nombre de buzón válido (letras, números, punto, guion o guion bajo)", 400);
  }
  if (input.name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(input.name)) {
    throw new PlatformError("El nombre debe tener 100 caracteres o menos", 400);
  }
  if (input.password.length < 12 || input.password.length > 256 || /[\r\n\u0000]/.test(input.password)) {
    throw new PlatformError("La clave debe tener entre 12 y 256 caracteres y no incluir saltos de línea", 400);
  }
  if (!Number.isInteger(input.quotaMb) || input.quotaMb < 1 || input.quotaMb > 10240) {
    throw new PlatformError("La cuota debe ser de 1 a 10240 MB", 400);
  }

  const email = `${localPart}@${config.mailcow.domain}`;
  const data = await callMailcow(config, "add/mailbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{
        local_part: localPart,
        domain: config.mailcow.domain,
        name: input.name.trim(),
        quota: String(input.quotaMb),
        password: input.password,
        password2: input.password,
        active: "1",
      }],
    }),
  }, fetcher);
  const failure = mailcowFailure(data);
  if (failure) throw new PlatformError(`Mailcow: ${failure}`, 400);
  const entries = Array.isArray(data) ? data : [data];
  if (!entries.some((entry) => entry && typeof entry === "object" && "type" in entry && entry.type === "success")) {
    throw new PlatformError("Mailcow no confirmó la creación del buzón", 502);
  }
  return { email };
}
