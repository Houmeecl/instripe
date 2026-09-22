export type GatewayName = "stripe" | "chile";

export interface AppConfig {
  port: number;
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
  /** Where `Crear app` writes the Stripe App manifest. */
  appManifestPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsedPort = Number.parseInt(env.PORT ?? "3000", 10);
  const port = Number.isNaN(parsedPort) ? 3000 : parsedPort;
  const defaultGateway: GatewayName = env.DEFAULT_GATEWAY === "stripe" ? "stripe" : "chile";
  return {
    port,
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
    appManifestPath: env.APP_MANIFEST_PATH?.trim() || "stripe-app.json",
  };
}

export function isStripeConfigured(config: AppConfig): boolean {
  return Boolean(config.stripeSecretKey);
}

export function isChileConfigured(config: AppConfig): boolean {
  return Boolean(config.chile.apiKey && config.chile.commerceCode);
}
