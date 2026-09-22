import type { GatewayName } from "../config.js";

export interface ChargeRequest {
  amount: number;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface ChargeResult {
  gateway: GatewayName;
  mode: "live" | "demo";
  chargeId: string;
  /** Redirect URL for hosted checkout / redirect-based gateways. */
  redirectUrl: string;
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
}
