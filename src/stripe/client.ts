import Stripe from "stripe";
import type { AppConfig } from "../config.js";

export function createStripe(config: AppConfig): Stripe | undefined {
  return config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : undefined;
}

export function platformAccount(stripe: Stripe): Promise<Stripe.Account> {
  return stripe.accounts.retrieve(null);
}

export function stripeMessage(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : "Stripe no está disponible para esta operación";
  const sentence = raw.split(" (Hint:")[0].trim();
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}
