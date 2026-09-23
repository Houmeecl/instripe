import { randomBytes, randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { createStripe } from "../stripe/client.js";
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
  private readonly client: ReturnType<typeof createStripe>;

  constructor(private readonly config: AppConfig) {
    this.client = createStripe(config);
  }

  get configured(): boolean {
    return Boolean(this.client);
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (this.client) {
      const embedded = Boolean(this.config.stripePublishableKey);
      const reference = req.metadata?.reference;
      const moduleName = req.metadata?.module;
      const session = await this.client.checkout.sessions.create({
        mode: "payment",
        ui_mode: embedded ? "embedded_page" : "hosted_page",
        customer_email: req.customerEmail,
        client_reference_id: reference,
        ...(moduleName && reference ? { metadata: { module: moduleName, reference } } : {}),
        integration_identifier: `proveedor-regional-${randomSuffix()}`,
        ...(req.branding
          ? {
              branding_settings: {
                display_name: req.branding.displayName,
                button_color: req.branding.buttonColor,
                background_color: req.branding.backgroundColor,
                border_style: req.branding.borderStyle,
                font_family: "inter" as const,
              },
            }
          : {}),
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

function randomSuffix(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let suffix = "";
  for (let i = 0; i < 8; i += 1) suffix += alphabet[bytes[i] % alphabet.length];
  return suffix;
}
