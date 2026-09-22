import type { AppConfig, GatewayName } from "./config.js";
import { PlatformError } from "./errors.js";
import { AppsModule } from "./modules/apps/module.js";
import { CobrosModule } from "./modules/cobros/module.js";
import { ConnectModule } from "./modules/connect/module.js";
import { CuentasModule } from "./modules/cuentas/module.js";
import { DisenoModule } from "./modules/diseno/module.js";
import { SegurosModule, type ClaimInput, type SubscribeInput } from "./modules/seguros/module.js";
import { RegistroModule } from "./modules/registro/module.js";
import { TarjetasModule } from "./modules/tarjetas/module.js";
import { TreasuryModule } from "./modules/treasury/module.js";
import type { Account } from "./payments/ledger.js";
import { Payments, type SettleResult } from "./payments/service.js";

export { PlatformError };
export type { SubscribeInput, ClaimInput };

/**
 * Admin composition root. Pagos is the core. Product modules plug into it.
 */
export class Platform {
  readonly payments: Payments;
  readonly cuentas: CuentasModule;
  readonly cobros: CobrosModule;
  readonly seguros: SegurosModule;
  readonly connect: ConnectModule;
  readonly treasury: TreasuryModule;
  readonly tarjetas: TarjetasModule;
  readonly diseno: DisenoModule;
  readonly apps: AppsModule;
  readonly registro: RegistroModule;

  constructor(config: AppConfig) {
    this.payments = new Payments(config);
    this.cuentas = new CuentasModule(this.payments);
    this.cobros = new CobrosModule(this.payments);
    this.seguros = new SegurosModule(this.payments);
    this.connect = new ConnectModule(this.payments, config);
    this.treasury = new TreasuryModule(this.payments, config);
    this.tarjetas = new TarjetasModule(this.payments, config);
    this.diseno = new DisenoModule(this.payments, this.connect, config);
    this.apps = new AppsModule(config.appManifestPath);
    this.registro = new RegistroModule(this.cuentas);
  }

  listModules() {
    return [this.cuentas, this.cobros, this.seguros, this.connect, this.treasury, this.tarjetas, this.diseno, this.apps, this.registro].map((mod) => ({
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

  fulfillCheckout(reference: string | null | undefined, sessionId: string): SettleResult {
    return this.payments.settle(reference, sessionId);
  }

  fileClaim(input: ClaimInput) {
    return this.seguros.fileClaim(input);
  }
}

export type { GatewayName };
