export interface AppConfig {
  port: number;
  stripeSecretKey: string | undefined;
  currency: string;
  publicBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  return {
    port: Number.isNaN(port) ? 3000 : port,
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    currency: (env.CURRENCY ?? "usd").toLowerCase(),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? "3000"}`,
  };
}

export function isStripeConfigured(config: AppConfig): boolean {
  return Boolean(config.stripeSecretKey);
}
