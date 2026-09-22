import type { AppConfig, GatewayName } from "./config.js";
import { PlatformError } from "./errors.js";
import { CobrosModule } from "./modules/cobros/module.js";
import { CuentasModule } from "./modules/cuentas/module.js";
import { SegurosModule, type ClaimInput, type SubscribeInput } from "./modules/seguros/module.js";
import type { Account } from "./payments/ledger.js";
import { Payments, type SettleResult } from "./payments/service.js";

export { PlatformError };
export type { SubscribeInput, ClaimInput };

/**
 * Admin composition root. Pagos is the core. Cuentas, Cobros and Seguros
 * are modules plugged into it.
 */
export class Platform {
  readonly payments: Payments;
  readonly cuentas: CuentasModule;
  readonly cobros: CobrosModule;
  readonly seguros: SegurosModule;

  constructor(config: AppConfig) {
    this.payments = new Payments(config);
    this.cuentas = new CuentasModule(this.payments);
    this.cobros = new CobrosModule(this.payments);
    this.seguros = new SegurosModule(this.payments);
  }

  listModules() {
    return [this.cuentas, this.cobros, this.seguros].map((mod) => ({
      id: mod.id,
      label: mod.label,
      connected: true as const,
    }));
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
