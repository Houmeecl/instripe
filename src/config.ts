export type GatewayName = "stripe" | "chile" | "global66";

export interface AppConfig {
  port: number;
  /** Address the HTTP server binds to. */
  bindHost: string;
  /** Base currency for the platform (Chile-first: CLP). */
  currency: string;
  publicBaseUrl: string;
  /** Public recipient for sponsorship and partnership inquiries. */
  publicContactEmail: string;
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
  /** Encryption key for per-company Global66 B2B client secrets. */
  global66CredentialsEncryptionKey: string | undefined;
  /** Databricks OAuth M2M connection used by the read-only pilot planner. */
  databricks: {
    host: string | undefined;
    clientId: string | undefined;
    clientSecret: string | undefined;
    model: string;
  };
  /** Where `Crear app` writes the Stripe App manifest. */
  appManifestPath: string;
  /** SQLite file. `:memory:` does not survive a restart. */
  databasePath: string;
  /** Initial password used only when the user table is still empty. */
  seedPassword: string;
  /** NODE_ENV=production. The public default seed password is refused there. */
  production: boolean;
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
  /** Optional Mailcow administrator API connection used only for mailbox management. */
  mailcow: {
    apiUrl: string | undefined;
    apiKey: string | undefined;
    domain: string;
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
    publicContactEmail: env.PUBLIC_CONTACT_EMAIL?.trim() || "patrocinios@proveedorregional.cl",
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
    global66CredentialsEncryptionKey: env.GLOBAL66_CREDENTIALS_ENCRYPTION_KEY?.trim() || undefined,
    databricks: {
      host: env.DATABRICKS_HOST?.trim() || undefined,
      clientId: env.DATABRICKS_CLIENT_ID?.trim() || undefined,
      clientSecret: env.DATABRICKS_CLIENT_SECRET?.trim() || undefined,
      model: env.DATABRICKS_PILOT_MODEL?.trim() || "databricks-gpt-6-luna",
    },
    appManifestPath: env.APP_MANIFEST_PATH?.trim() || "stripe-app.json",
    databasePath: env.DATABASE_PATH?.trim() || "data/platform.db",
    seedPassword: env.AUTH_SEED_PASSWORD?.trim() || DEFAULT_SEED_PASSWORD,
    production: env.NODE_ENV === "production",
    mail: {
      host: env.MAIL_HOST?.trim() || "mail.proveedorregional.cl",
      user: env.MAIL_USER?.trim() || undefined,
      password: env.MAIL_PASSWORD?.trim() || undefined,
      imapPort: Number.parseInt(env.MAIL_IMAP_PORT ?? "993", 10) || 993,
      smtpPort: Number.parseInt(env.MAIL_SMTP_PORT ?? "587", 10) || 587,
      insecure: env.MAIL_INSECURE === "1",
    },
    mailcow: {
      apiUrl: env.MAILCOW_API_URL?.trim() || undefined,
      apiKey: env.MAILCOW_API_KEY?.trim() || undefined,
      domain: (env.MAILCOW_DOMAIN?.trim() || "proveedorregional.cl").toLowerCase(),
    },
  };
}

export function isDatabricksPilotConfigured(config: AppConfig): boolean {
  return Boolean(config.databricks.host && config.databricks.clientId && config.databricks.clientSecret);
}

export function isMailConfigured(config: AppConfig): boolean {
  return Boolean(config.mail.user && config.mail.password);
}

export function isMailcowConfigured(config: AppConfig): boolean {
  return Boolean(config.mailcow.apiUrl && config.mailcow.apiKey && config.mailcow.domain);
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
