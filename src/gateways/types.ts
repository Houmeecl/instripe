import type { GatewayName } from "../config.js";

export interface ChargeRequest {
  amount: number;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Stripe replaces `{CHECKOUT_SESSION_ID}` when ui_mode is embedded_page. */
  returnUrl?: string;
  metadata?: Record<string, string>;
  branding?: {
    displayName: string;
    buttonColor: string;
    backgroundColor: string;
    borderStyle: "rounded" | "rectangular" | "pill";
  };
}

export interface ChargeResult {
  gateway: GatewayName;
  mode: "live" | "demo";
  chargeId: string;
  /** Redirect URL for hosted checkout / redirect-based gateways. */
  redirectUrl: string;
  /** Present when Stripe Checkout runs embedded in the portal. */
  clientSecret?: string;
  amount: number;
  currency: string;
}

export interface PayoutRequest {
  amount: number;
  currency: string;
  description: string;
  /** Beneficiary account/handle (bank account, RUT, connected acct, etc.). */
  destination: string;
}

export interface PayoutResult {
  gateway: GatewayName;
  mode: "live" | "demo";
  payoutId: string;
  amount: number;
  currency: string;
  destination: string;
  status: "paid" | "pending";
}

/**
 * A payment gateway abstracts collecting funds (charge) and dispersing funds
 * (payout). Concrete adapters back this with Stripe, a Chilean provider, etc.
 */
export interface PaymentGateway {
  readonly name: GatewayName;
  readonly label: string;
  readonly configured: boolean;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  payout(req: PayoutRequest): Promise<PayoutResult>;
  /** Available Stripe balance for a currency, in the smallest unit. */
  available?(currency: string): Promise<number>;
}
