import Stripe from "stripe";
import type { AppConfig } from "./config.js";
import { findProduct, type Product } from "./products.js";

export interface CheckoutResult {
  mode: "stripe" | "demo";
  sessionId: string;
  url: string;
  product: Product;
  amount: number;
  currency: string;
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

/**
 * Creates a checkout session for the given product.
 *
 * When a Stripe secret key is configured, a real Stripe Checkout Session is
 * created. Otherwise the app falls back to a self-contained demo session so the
 * end-to-end flow remains runnable without external credentials.
 */
export async function createCheckoutSession(
  productId: string,
  config: AppConfig,
): Promise<CheckoutResult> {
  const product = findProduct(productId);
  if (!product) {
    throw new CheckoutError(`Unknown product: ${productId}`, 404);
  }

  if (config.stripeSecretKey) {
    const stripe = new Stripe(config.stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: config.currency,
            unit_amount: product.amount,
            product_data: {
              name: product.name,
              description: product.description,
            },
          },
        },
      ],
      success_url: `${config.publicBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.publicBaseUrl}/?canceled=1`,
    });

    return {
      mode: "stripe",
      sessionId: session.id,
      url: session.url ?? `${config.publicBaseUrl}/success?session_id=${session.id}`,
      product,
      amount: product.amount,
      currency: config.currency,
    };
  }

  const sessionId = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    mode: "demo",
    sessionId,
    url: `${config.publicBaseUrl}/success?session_id=${sessionId}&demo=1`,
    product,
    amount: product.amount,
    currency: config.currency,
  };
}
