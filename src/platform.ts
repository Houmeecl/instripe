import { randomUUID } from "node:crypto";
import type { AppConfig, GatewayName } from "./config.js";
import { Ledger, type Account } from "./domain/ledger.js";
import {
  PLANS,
  findPlan,
  type Claim,
  type InsurancePlan,
  type Policy,
} from "./domain/insurance.js";
import { GatewayRegistry } from "./gateways/registry.js";
import type { ChargeResult, PayoutResult } from "./gateways/types.js";

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export interface SubscribeInput {
  planId: string;
  holderName: string;
  email: string;
  gateway: GatewayName;
}

export interface SubscribeResult {
  account: Account;
  policy: Policy;
  charge: ChargeResult;
}

export interface FulfillResult {
  fulfilled: boolean;
  policyId?: string;
}

export interface ClaimInput {
  policyId: string;
  amount: number;
  beneficiary: string;
  gateway: GatewayName;
}

export interface ClaimResult {
  claim: Claim;
  payout: PayoutResult;
  floatBalance: number;
}

/**
 * Core BaaS + insurtech platform. It collects premiums through a payment
 * gateway, pools them in an insurer float wallet, and disperses claim payouts
 * back out through a gateway ("dispersión de fondos").
 */
export class Platform {
  readonly ledger = new Ledger();
  private readonly gateways: GatewayRegistry;
  private readonly float: Account;
  private readonly policies = new Map<string, Policy>();
  private readonly claims: Claim[] = [];
  private readonly webhookEvents: { id: string; type: string; receivedAt: string }[] = [];

  constructor(private readonly config: AppConfig) {
    this.gateways = new GatewayRegistry(config);
    this.float = this.ledger.createAccount({
      name: "instripe Insurer Float",
      email: "float@instripe.internal",
      currency: config.currency,
    });
  }

  get floatAccount(): Account {
    return this.float;
  }

  plans(): InsurancePlan[] {
    return PLANS;
  }

  listGateways() {
    return this.gateways.list().map((g) => ({
      name: g.name,
      label: g.label,
      configured: g.configured,
    }));
  }

  listPolicies(): Policy[] {
    return [...this.policies.values()];
  }

  listClaims(): Claim[] {
    return [...this.claims];
  }

  recordWebhookEvent(id: string, type: string): void {
    this.webhookEvents.unshift({ id, type, receivedAt: new Date().toISOString() });
    if (this.webhookEvents.length > 20) {
      this.webhookEvents.length = 20;
    }
  }

  listWebhookEvents() {
    return [...this.webhookEvents];
  }

  async subscribe(input: SubscribeInput): Promise<SubscribeResult> {
    const plan = findPlan(input.planId);
    if (!plan) {
      throw new PlatformError(`Plan desconocido: ${input.planId}`, 404);
    }
    const gateway = this.gateways.get(input.gateway);
    // Live Stripe collects the premium asynchronously. The policy stays pending
    // until Checkout reports the payment (webhook or session retrieve).
    const deferFulfillment = gateway.name === "stripe" && gateway.configured;
    const { account, policy } = this.holdPremium(input);

    let charge: ChargeResult;
    try {
      charge = await gateway.charge({
        amount: plan.premium,
        currency: this.config.currency,
        description: `Prima ${plan.name}`,
        customerEmail: input.email,
        successUrl: `${this.config.publicBaseUrl}/?paid=1&plan=${plan.id}`,
        cancelUrl: `${this.config.publicBaseUrl}/?canceled=1`,
        returnUrl: `${this.config.publicBaseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
        metadata: { policyId: policy.id, planId: plan.id },
      });
    } catch (error) {
      this.policies.delete(policy.id);
      throw error;
    }

    if (deferFulfillment) {
      policy.checkoutSessionId = charge.chargeId;
    } else {
      this.fulfillCheckout(policy.id, charge.chargeId);
    }

    return { account, policy, charge };
  }

  /**
   * Record a policy that has not collected its premium yet. Live Stripe uses
   * this until Checkout confirms payment.
   */
  holdPremium(input: Omit<SubscribeInput, "gateway">): { account: Account; policy: Policy } {
    const plan = findPlan(input.planId);
    if (!plan) {
      throw new PlatformError(`Plan desconocido: ${input.planId}`, 404);
    }
    const account = this.ledger.createAccount({
      name: input.holderName,
      email: input.email,
      currency: this.config.currency,
    });
    const policy: Policy = {
      id: `pol_${randomUUID().slice(0, 8)}`,
      planId: plan.id,
      accountId: account.id,
      holderName: input.holderName,
      premium: plan.premium,
      coverage: plan.coverage,
      status: "pending_payment",
      createdAt: new Date().toISOString(),
    };
    this.policies.set(policy.id, policy);
    return { account, policy };
  }

  /**
   * Activate a pending policy and credit the insurer float. Safe to call more
   * than once for the same Checkout session.
   */
  fulfillCheckout(policyId: string | null | undefined, sessionId: string): FulfillResult {
    if (!policyId) return { fulfilled: false };
    const policy = this.policies.get(policyId);
    if (!policy || policy.status !== "pending_payment") {
      return { fulfilled: false, policyId };
    }
    this.creditPremium(policy, sessionId);
    policy.status = "active";
    policy.checkoutSessionId = sessionId;
    return { fulfilled: true, policyId };
  }

  private creditPremium(policy: Policy, reference: string): void {
    const plan = findPlan(policy.planId);
    const label = plan?.name ?? policy.planId;
    this.ledger.post(
      "credit",
      this.float.id,
      policy.premium,
      `Prima póliza ${label} (${reference})`,
    );
  }

  async fileClaim(input: ClaimInput): Promise<ClaimResult> {
    const policy = this.policies.get(input.policyId);
    if (!policy) {
      throw new PlatformError(`Póliza desconocida: ${input.policyId}`, 404);
    }
    if (policy.status === "pending_payment") {
      throw new PlatformError("La póliza espera la confirmación del pago", 409);
    }
    if (policy.status !== "active") {
      throw new PlatformError("La póliza no está activa", 409);
    }
    if (input.amount <= 0) {
      throw new PlatformError("El monto del siniestro debe ser positivo", 400);
    }
    if (input.amount > policy.coverage) {
      throw new PlatformError("El monto supera la cobertura de la póliza", 422);
    }

    const gateway = this.gateways.get(input.gateway);

    this.ledger.post("debit", this.float.id, input.amount, `Siniestro póliza ${policy.id}`);

    const payout = await gateway.payout({
      amount: input.amount,
      currency: this.config.currency,
      description: `Dispersión siniestro ${policy.id}`,
      destination: input.beneficiary,
    });

    const claim: Claim = {
      id: `clm_${randomUUID().slice(0, 8)}`,
      policyId: policy.id,
      amount: input.amount,
      beneficiary: input.beneficiary,
      status: payout.status === "paid" ? "paid" : "pending",
      payoutId: payout.payoutId,
      createdAt: new Date().toISOString(),
    };
    this.claims.push(claim);

    return { claim, payout, floatBalance: this.float.balance };
  }
}
