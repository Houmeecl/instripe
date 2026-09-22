import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type {
  ChargeRequest,
  ChargeResult,
  PayoutRequest,
  PayoutResult,
  PaymentGateway,
} from "./types.js";

/**
 * Stripe adapter. When a secret key is present it uses the real Stripe API
 * (Checkout for charges, Transfers/Payouts for fund dispersion). Otherwise it
 * runs in demo mode so the platform is fully exercisable without credentials.
 */
export class StripeGateway implements PaymentGateway {
  readonly name = "stripe" as const;
  readonly label = "Stripe";
  private readonly client: Stripe | undefined;

  constructor(private readonly config: AppConfig) {
    this.client = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : undefined;
  }

  get configured(): boolean {
    return Boolean(this.client);
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (this.client) {
      const embedded = Boolean(this.config.stripePublishableKey);
      const session = await this.client.checkout.sessions.create({
        mode: "payment",
        ui_mode: embedded ? "embedded_page" : "hosted_page",
        customer_email: req.customerEmail,
        client_reference_id: req.metadata?.policyId,
        metadata: req.metadata,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: req.currency,
              unit_amount: req.amount,
              product_data: { name: req.description },
            },
          },
        ],
        ...(embedded
          ? { return_url: req.returnUrl ?? req.successUrl }
          : { success_url: req.successUrl, cancel_url: req.cancelUrl }),
      });
      return {
        gateway: this.name,
        mode: "live",
        chargeId: session.id,
        redirectUrl: session.url ?? req.returnUrl ?? req.successUrl,
        clientSecret: session.client_secret ?? undefined,
        amount: req.amount,
        currency: req.currency,
      };
    }
    const id = `ch_demo_${randomUUID().slice(0, 8)}`;
    return {
      gateway: this.name,
      mode: "demo",
      chargeId: id,
      redirectUrl: `${req.successUrl}${req.successUrl.includes("?") ? "&" : "?"}charge=${id}`,
      amount: req.amount,
      currency: req.currency,
    };
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (this.client) {
      const transfer = await this.client.transfers.create({
        amount: req.amount,
        currency: req.currency,
        destination: req.destination,
        description: req.description,
      });
      return {
        gateway: this.name,
        mode: "live",
        payoutId: transfer.id,
        amount: req.amount,
        currency: req.currency,
        destination: req.destination,
        status: "paid",
      };
    }
    return {
      gateway: this.name,
      mode: "demo",
      payoutId: `po_demo_${randomUUID().slice(0, 8)}`,
      amount: req.amount,
      currency: req.currency,
      destination: req.destination,
      status: "paid",
    };
  }
}
