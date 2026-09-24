export type GatewayName = "stripe" | "chile" | "global66";

export interface AppConfig {
  port: number;
  /** Address the HTTP server binds to. */
  bindHost: string;
  /** Base currency for the platform (Chile-first: CLP). */
  currency: string;
  publicBaseUrl: string;
  defaultGateway: GatewayName;
  stripeSecretKey: string | undefined;
  /** Publishable key (pk_test_/pk_live_). Safe to send to the browser. */
  stripePublishableKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  /** Credentials for the Chilean gateway (Webpay/Khipu/Flow-style). Demo when unset. */
  chile: {
    apiKey: string | undefined;
    commerceCode: string | undefined;
  };
  /** Credentials for Global66 (Payoy) gateway. Demo when unset. */
  global66?: {
    apiKey: string | undefined;
    merchantId: string | undefined;
    apiUrl: string | undefined;
  };
  /** Where `Crear app` writes the Stripe App manifest. */
  appManifestPath: string;
  /** SQLite file. `:memory:` does not survive a restart. */
  databasePath: string;
  /** Initial password used only when the user table is still empty. */
  seedPassword: string;
  /** Company mailbox on the VPS. The panel reads it; Mailcow's webmail stays unused. */
  mail: {
    host: string;
    user: string | undefined;
    password: string | undefined;
    imapPort: number;
    smtpPort: number;
    /** Test-only plain sockets. Production stays on TLS. */
    insecure: boolean;
  };
}

export const DEFAULT_SEED_PASSWORD = "Antofagasta.183";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsedPort = Number.parseInt(env.PORT ?? "3000", 10);
  const port = Number.isNaN(parsedPort) ? 3000 : parsedPort;
  const defaultGateway: GatewayName = env.DEFAULT_GATEWAY === "stripe" ? "stripe" : "chile";
  return {
    port,
    bindHost: env.BIND_HOST?.trim() || "0.0.0.0",
    currency: (env.CURRENCY ?? "clp").toLowerCase(),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    defaultGateway,
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY?.trim() || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    chile: {
      apiKey: env.CHILE_GATEWAY_API_KEY?.trim() || undefined,
      commerceCode: env.CHILE_GATEWAY_COMMERCE_CODE?.trim() || undefined,
    },
    global66: {
      apiKey: env.GLOBAL66_API_KEY?.trim() || undefined,
      merchantId: env.GLOBAL66_MERCHANT_ID?.trim() || undefined,
      apiUrl: env.GLOBAL66_API_URL?.trim() || undefined,
    },
    appManifestPath: env.APP_MANIFEST_PATH?.trim() || "stripe-app.json",
    databasePath: env.DATABASE_PATH?.trim() || "data/platform.db",
    seedPassword: env.AUTH_SEED_PASSWORD?.trim() || DEFAULT_SEED_PASSWORD,
    mail: {
      host: env.MAIL_HOST?.trim() || "mail.proveedorregional.cl",
      user: env.MAIL_USER?.trim() || undefined,
      password: env.MAIL_PASSWORD?.trim() || undefined,
      imapPort: Number.parseInt(env.MAIL_IMAP_PORT ?? "993", 10) || 993,
      smtpPort: Number.parseInt(env.MAIL_SMTP_PORT ?? "587", 10) || 587,
      insecure: env.MAIL_INSECURE === "1",
    },
  };
}

export function isMailConfigured(config: AppConfig): boolean {
  return Boolean(config.mail.user && config.mail.password);
}

export function isStripeConfigured(config: AppConfig): boolean {
  return Boolean(config.stripeSecretKey);
}

export function isChileConfigured(config: AppConfig): boolean {
  return Boolean(config.chile.apiKey && config.chile.commerceCode);
}

export function isGlobal66Configured(config: AppConfig): boolean {
  return Boolean(config.global66?.apiKey && config.global66?.merchantId);
}
