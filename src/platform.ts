import type { AppConfig, GatewayName } from "./config.js";
import { PlatformError } from "./errors.js";
import { SegurosModule, type ClaimInput, type SubscribeInput } from "./modules/seguros/module.js";
import type { Account } from "./payments/ledger.js";
import { Payments, type SettleResult } from "./payments/service.js";

export { PlatformError };
export type { SubscribeInput, ClaimInput };

/**
 * Composition root. Pagos is the core; Seguros is a module plugged into it.
 */
export class Platform {
  readonly payments: Payments;
  readonly seguros: SegurosModule;

  constructor(config: AppConfig) {
    this.payments = new Payments(config);
    this.seguros = new SegurosModule(this.payments);
  }

  get floatAccount(): Account {
    return this.payments.walletAccount;
  }

  plans() {
    return this.seguros.plans();
  }

  listGateways() {
    return this.payments.listGateways();
  }

  listPolicies() {
    return this.seguros.listPolicies();
  }

  listClaims() {
    return this.seguros.listClaims();
  }

  listPayments() {
    return this.payments.list();
  }

  recordWebhookEvent(id: string, type: string): void {
    this.payments.recordWebhookEvent(id, type);
  }

  listWebhookEvents() {
    return this.payments.listWebhookEvents();
  }

  subscribe(input: SubscribeInput) {
    return this.seguros.subscribe(input);
  }

  holdPremium(input: Omit<SubscribeInput, "gateway">) {
    return this.seguros.holdPremium(input);
  }

  fulfillCheckout(reference: string | null | undefined, sessionId: string): SettleResult & { policyId?: string } {
    const result = this.payments.settle(reference, sessionId);
    return { ...result, policyId: result.reference };
  }

  fileClaim(input: ClaimInput) {
    return this.seguros.fileClaim(input);
  }
}

export type { GatewayName };
