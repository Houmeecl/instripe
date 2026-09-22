import { randomUUID } from "node:crypto";
import type { GatewayName } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Account } from "../../payments/ledger.js";
import type { Payments } from "../../payments/service.js";
import type { ChargeResult, PayoutResult } from "../../gateways/types.js";
import { CREDITO_TC, PLANS, premiumForCupo, type Claim, type InsurancePlan, type Policy } from "./catalog.js";

export interface SubscribeInput {
  holderName: string;
  email: string;
  /** Tarjeta cuyo crédito queda asegurado. */
  cardLabel: string;
  /** Cupo / crédito de la tarjeta, en la moneda de la plataforma. */
  cupo: number;
  gateway: GatewayName;
}

export interface ClaimInput {
  policyId: string;
  amount: number;
  beneficiary: string;
  gateway: GatewayName;
}

const MODULE = "seguros";

/**
 * Seguros is a product module. It does not charge or pay out by itself:
 * every premium and every claim goes through the payments core.
 */
export class SegurosModule {
  readonly id = MODULE;
  readonly label = "Seguros";
  private readonly policies = new Map<string, Policy>();
  private readonly claims: Claim[] = [];

  constructor(private readonly payments: Payments) {
    payments.onSettled((movement) => {
      if (movement.module !== MODULE || movement.kind !== "collect") return;
      const policy = this.policies.get(movement.reference);
      if (!policy || policy.status !== "pending_payment") return;
      policy.status = "active";
      policy.paymentId = movement.id;
      policy.checkoutSessionId = movement.externalId;
    });
  }

  plans(): InsurancePlan[] {
    return PLANS;
  }

  listPolicies(): Policy[] {
    return [...this.policies.values()];
  }

  listClaims(): Claim[] {
    return [...this.claims];
  }

  holdPremium(input: Omit<SubscribeInput, "gateway">): { account: Account; policy: Policy } {
    const cardLabel = input.cardLabel.trim();
    if (!input.holderName.trim() || !input.email.trim() || !cardLabel) {
      throw new PlatformError("holderName, email y la tarjeta son requeridos", 400);
    }
    if (!Number.isFinite(input.cupo) || input.cupo <= 0) {
      throw new PlatformError("El crédito de la tarjeta debe ser positivo", 400);
    }
    const premium = premiumForCupo(input.cupo);
    if (premium <= 0) throw new PlatformError("El crédito de la tarjeta es demasiado bajo", 400);

    const account = this.payments.ledger.createAccount({
      name: input.holderName,
      email: input.email,
      currency: this.payments.walletAccount.currency,
    });
    const policy: Policy = {
      id: `pol_${randomUUID().slice(0, 8)}`,
      planId: CREDITO_TC.id,
      accountId: account.id,
      holderName: input.holderName,
      cardLabel,
      cupo: input.cupo,
      premium,
      coverage: input.cupo,
      status: "pending_payment",
      createdAt: new Date().toISOString(),
    };
    this.policies.set(policy.id, policy);
    const movement = this.payments.openCollect({
      module: MODULE,
      reference: policy.id,
      amount: premium,
      description: `Prima crédito ${cardLabel}`,
    });
    policy.paymentId = movement.id;
    return { account, policy };
  }

  async subscribe(input: SubscribeInput): Promise<{ account: Account; policy: Policy; charge: ChargeResult }> {
    const { account, policy } = this.holdPremium(input);
    try {
      const charge = await this.payments.chargeOpen(MODULE, policy.id, input.gateway, input.email);
      policy.checkoutSessionId = charge.chargeId;
      return { account, policy, charge };
    } catch (error) {
      this.policies.delete(policy.id);
      this.payments.drop(MODULE, policy.id);
      throw error;
    }
  }

  async fileClaim(input: ClaimInput): Promise<{ claim: Claim; payout: PayoutResult; floatBalance: number }> {
    const policy = this.policies.get(input.policyId);
    if (!policy) throw new PlatformError(`Póliza desconocida: ${input.policyId}`, 404);
    if (policy.status === "pending_payment") {
      throw new PlatformError("La póliza espera la confirmación del pago", 409);
    }
    if (policy.status !== "active") throw new PlatformError("La póliza no está activa", 409);
    if (input.amount <= 0) throw new PlatformError("El monto del siniestro debe ser positivo", 400);
    if (input.amount > policy.coverage) {
      throw new PlatformError("El monto supera el crédito asegurado de la tarjeta", 422);
    }

    const claimId = `clm_${randomUUID().slice(0, 8)}`;
    const { movement, payout } = await this.payments.disburse({
      module: MODULE,
      reference: claimId,
      amount: input.amount,
      description: `Dispersión siniestro ${policy.id}`,
      destination: input.beneficiary,
      gateway: input.gateway,
    });
    const claim: Claim = {
      id: claimId,
      policyId: policy.id,
      amount: input.amount,
      beneficiary: input.beneficiary,
      status: payout.status === "paid" ? "paid" : "pending",
      paymentId: movement.id,
      payoutId: payout.payoutId,
      createdAt: new Date().toISOString(),
    };
    this.claims.push(claim);
    return { claim, payout, floatBalance: this.payments.walletAccount.balance };
  }
}
