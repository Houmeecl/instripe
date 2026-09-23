import Stripe from "stripe";
import type { AppConfig } from "../config.js";

/** Matches the Stripe SDK default. Passed explicitly so calls don't drift. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

export function createStripe(config: AppConfig): Stripe | undefined {
  return config.stripeSecretKey
    ? new Stripe(config.stripeSecretKey, { apiVersion: STRIPE_API_VERSION })
    : undefined;
}

export function platformAccount(stripe: Stripe): Promise<Stripe.Account> {
  return stripe.accounts.retrieve(null);
}

export function stripeMessage(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : "Stripe no está disponible para esta operación";
  const sentence = raw.split(" (Hint:")[0].trim();
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}
