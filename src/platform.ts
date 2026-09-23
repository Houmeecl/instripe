import { AuthModule } from "./auth/module.js";
import type { AppConfig, GatewayName } from "./config.js";
import { PlatformError } from "./errors.js";
import { AppsModule } from "./modules/apps/module.js";
import { CobrosModule } from "./modules/cobros/module.js";
import { ConnectModule } from "./modules/connect/module.js";
import { CuentasModule } from "./modules/cuentas/module.js";
import { DisenoModule } from "./modules/diseno/module.js";
import { EmpresasModule } from "./modules/empresas/module.js";
import { SegurosModule, type ClaimInput, type SubscribeInput } from "./modules/seguros/module.js";
import { RegistroModule } from "./modules/registro/module.js";
import { TarjetasModule } from "./modules/tarjetas/module.js";
import { TreasuryModule } from "./modules/treasury/module.js";
import type { Account } from "./payments/ledger.js";
import { Payments, type CheckoutSettlement, type SettleResult } from "./payments/service.js";
import { PlatformStore } from "./store/db.js";

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
  readonly empresas: EmpresasModule;
  readonly auth: AuthModule;

  readonly store: PlatformStore;

  constructor(config: AppConfig) {
    this.store = new PlatformStore(config.databasePath);
    this.payments = new Payments(config, this.store);
    this.cuentas = new CuentasModule(this.payments, this.store);
    this.cobros = new CobrosModule(this.payments, this.store);
    this.seguros = new SegurosModule(this.payments);
    this.connect = new ConnectModule(this.payments, config, this.store);
    this.treasury = new TreasuryModule(this.payments, config);
    this.tarjetas = new TarjetasModule(this.payments, config, this.store);
    this.diseno = new DisenoModule(this.payments, this.connect, config, this.store);
    this.apps = new AppsModule(config.appManifestPath);
    this.registro = new RegistroModule(this.cuentas, this.store);
    this.empresas = new EmpresasModule(this.payments, this.store);
    this.auth = new AuthModule(this.store, config.seedPassword);
  }

  listModules() {
    return [this.cuentas, this.cobros, this.seguros, this.connect, this.treasury, this.tarjetas, this.diseno, this.apps, this.registro, this.empresas].map((mod) => ({
      id: mod.id,
      label: mod.label,
      connected: true as const,
    }));
  }

  get floatAccount(): Account {
    return this.payments.walletAccount;
  }

  get transferableAccount(): Account {
    return this.payments.transferableAccount;
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

  fulfillCheckout(input: CheckoutSettlement): SettleResult {
    return this.payments.settleCheckout(input);
  }

  failCheckout(reference: string | null | undefined, eventKey: string): boolean {
    return this.payments.failCheckout(reference, eventKey);
  }

  reverseCollection(reference: string | undefined, amount: number, eventKey: string): boolean {
    return this.payments.reverseCollection(reference, amount, eventKey);
  }

  reverseTransfer(transferId: string, amountReversed: number, eventKey: string): boolean {
    return this.payments.reverseTransfer(transferId, amountReversed, eventKey);
  }

  seenWebhook(id: string): boolean {
    return this.payments.seenWebhook(id);
  }

  listExits() {
    return this.payments.listExits();
  }

  async confirmExit(id: string, authorizerId: string) {
    const pending = this.payments.getExit(id);
    if (!pending || pending.status !== "pending") throw new PlatformError("Esa salida no está pendiente", 404);
    if (pending.requestedBy === authorizerId) {
      throw new PlatformError("Otro usuario de operación tiene que confirmar la salida", 403);
    }
    if (pending.ledgerAccountId) {
      const balance = this.payments.ledger.getAccount(pending.ledgerAccountId)?.balance ?? 0;
      if (balance < pending.amount) throw new PlatformError("Saldo insuficiente en la cuenta", 422);
      this.payments.ledger.post("debit", pending.ledgerAccountId, pending.amount, pending.description);
    }
    try {
      const result = await this.payments.confirmExit(id, authorizerId);
      if (pending.module === "seguros") this.seguros.markClaimPaid(pending.reference);
      return result;
    } catch (error) {
      if (pending.ledgerAccountId) {
        this.payments.ledger.post("credit", pending.ledgerAccountId, pending.amount, `Reverso ${pending.description}`);
      }
      throw error;
    }
  }

  fileClaim(input: ClaimInput & { requestedBy: string }) {
    return this.seguros.fileClaim(input);
  }
}

export type { GatewayName };
