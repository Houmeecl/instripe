import { AuthModule } from "./auth/module.js";
import type { AppConfig, GatewayName } from "./config.js";
import { PlatformError } from "./errors.js";
import { AppsModule } from "./modules/apps/module.js";
import { AutomationModule } from "./modules/automation/module.js";
import { CobrosModule } from "./modules/cobros/module.js";
import { ColaboradoresModule } from "./modules/colaboradores/module.js";
import { ConnectModule } from "./modules/connect/module.js";
import { CuentasModule } from "./modules/cuentas/module.js";
import { DisenoModule } from "./modules/diseno/module.js";
import { EmpresasModule } from "./modules/empresas/module.js";
import { KYCModule } from "./modules/kyc/module.js";
import { LaboralModule } from "./modules/laboral/module.js";
import { PortalModule } from "./modules/portal/module.js";
import { SegurosModule, type ClaimInput, type FrostingInput, type SubscribeInput } from "./modules/seguros/module.js";
import { RegistroModule } from "./modules/registro/module.js";
import { SuscripcionModule } from "./modules/suscripcion/module.js";
import { TarjetasModule } from "./modules/tarjetas/module.js";
import { TreasuryModule } from "./modules/treasury/module.js";
import type { Role } from "./auth/module.js";
import type { Account } from "./payments/ledger.js";
import { Payments, type CheckoutSettlement, type SettleResult } from "./payments/service.js";
import { PlatformStore } from "./store/db.js";

export { PlatformError };
export type { SubscribeInput, ClaimInput, FrostingInput };

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
  readonly laboral: LaboralModule;
  readonly kyc: KYCModule;
  readonly colaboradores: ColaboradoresModule;
  readonly portal: PortalModule;
  readonly automation: AutomationModule;
  readonly suscripcion: SuscripcionModule;
  readonly auth: AuthModule;

  readonly store: PlatformStore;

  constructor(config: AppConfig) {
    this.store = new PlatformStore(config.databasePath);
    this.payments = new Payments(config, this.store);
    this.cuentas = new CuentasModule(this.payments, this.store);
    this.cobros = new CobrosModule(this.payments, this.store);
    this.seguros = new SegurosModule(this.payments, this.store);
    this.connect = new ConnectModule(this.payments, config, this.store);
    this.treasury = new TreasuryModule(this.payments, config);
    this.tarjetas = new TarjetasModule(this.payments, config, this.store);
    this.diseno = new DisenoModule(this.payments, this.connect, this.tarjetas, config, this.store);
    this.apps = new AppsModule(config.appManifestPath);
    this.registro = new RegistroModule(this.cuentas, this.store);
    this.empresas = new EmpresasModule(this.payments, this.store);
    this.laboral = new LaboralModule(this.store, config.publicBaseUrl);
    this.kyc = new KYCModule(config, this.store);
    this.colaboradores = new ColaboradoresModule(this.payments, config, this.store);
    this.portal = new PortalModule(this.payments, config, this.store);
    this.automation = new AutomationModule(this.payments, config, this.store);
    this.suscripcion = new SuscripcionModule(this.payments, config, this.store);
    this.auth = new AuthModule(this.store, config.seedPassword);
  }

  listModules() {
    return [this.cuentas, this.cobros, this.seguros, this.connect, this.treasury, this.tarjetas, this.diseno, this.apps, this.registro, this.empresas, this.laboral, this.kyc, this.colaboradores, this.portal, this.automation, this.suscripcion].map((mod) => ({
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

  inicio(actor: { id: string; email: string; role: Role; name: string; companyId?: string }) {
    const commune =
      this.registro.list().find((member) => member.email.toLowerCase() === actor.email.toLowerCase())?.city ?? null;
    return this.empresas.home(actor, commune);
  }

  createCompanyUser(
    actor: { id: string; email: string; role: Role; name: string; companyId?: string },
    companyId: string,
    input: { name: string; email: string; role: "comercio" | "titular"; password: string },
  ) {
    this.empresas.assertCompanyUsers(actor, companyId);
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!name || !email.includes("@")) throw new PlatformError("Nombre y correo son requeridos", 400);
    if (input.role !== "comercio" && input.role !== "titular") throw new PlatformError("El rol del usuario no es válido", 400);
    if (this.auth.emailTaken(email)) throw new PlatformError("Ese correo ya tiene usuario", 409);
    const other = this.empresas.workerCompanyId(email);
    if (other && other !== companyId) throw new PlatformError("Ese cliente ya pertenece a otra empresa", 409);
    const user = this.auth.createScopedUser({
      name,
      email,
      role: input.role,
      companyId,
      password: input.password,
    });
    try {
      const company = this.empresas.registerMember(actor, companyId, {
        id: user.id,
        name: user.name,
        email: user.email,
        role: input.role,
      });
      if (input.role === "titular" && !this.empresas.hasWorker(companyId, email)) {
        return { user, company: this.empresas.addWorker(actor, companyId, { name, email }) };
      }
      return { user, company };
    } catch (error) {
      this.auth.deleteUser(user.id);
      this.empresas.removeMember(companyId, user.id);
      throw error;
    }
  }

  subscribeFrosting(input: FrostingInput & { actorRole: Role }) {
    return this.seguros.subscribeFrosting(input);
  }
}

export type { GatewayName };
