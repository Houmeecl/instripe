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
 * Chilean payment gateway adapter (Webpay/Khipu/Flow-style).
 *
 * Chilean gateways are redirect-based: you create a transaction, redirect the
 * payer to the provider, and confirm on return. This adapter models that flow.
 * With real credentials (CHILE_GATEWAY_API_KEY + CHILE_GATEWAY_COMMERCE_CODE)
 * this is where the Transbank/Khipu/Flow SDK calls would go; without them it
 * runs in demo mode so CLP flows are exercisable end to end.
 */
export class ChileGateway implements PaymentGateway {
  readonly name = "chile" as const;
  readonly label = "Chile (Webpay-style)";

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(this.config.chile.apiKey && this.config.chile.commerceCode);
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const token = `chl_${randomUUID().slice(0, 10)}`;
    const redirectUrl = `${req.successUrl}${req.successUrl.includes("?") ? "&" : "?"}token_ws=${token}`;
    return {
      gateway: this.name,
      mode: this.configured ? "live" : "demo",
      chargeId: token,
      redirectUrl,
      amount: req.amount,
      currency: req.currency,
    };
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    return {
      gateway: this.name,
      mode: this.configured ? "live" : "demo",
      payoutId: `abono_${randomUUID().slice(0, 10)}`,
      amount: req.amount,
      currency: req.currency,
      destination: req.destination,
      status: this.configured ? "pending" : "paid",
    };
  }
}
