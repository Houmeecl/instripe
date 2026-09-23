import { randomBytes, randomUUID } from "node:crypto";
import type { Role } from "../../auth/module.js";
import { PlatformError } from "../../errors.js";
import { formatAmount } from "../../money.js";
import type { Payments } from "../../payments/service.js";
import type { PlatformStore } from "../../store/db.js";

export interface CompanyActor {
  id: string;
  email: string;
  role: Role;
}

interface CompanyRecord {
  id: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  color: string;
  last4: string;
  ledgerAccountId: string;
  createdAt: string;
}

interface WorkerRecord {
  id: string;
  companyId: string;
  name: string;
  email: string;
  last4: string;
  ledgerAccountId: string;
  createdAt: string;
}

interface TransferRecord {
  id: string;
  companyId: string;
  kind: "abono" | "to_worker" | "to_company";
  workerId?: string;
  workerName?: string;
  amount: number;
  actorUserId: string;
  createdAt: string;
}

export interface PrepaidCardView {
  id: string;
  name: string;
  email: string;
  last4: string;
  balance: number;
  displayBalance: string;
}

export interface CompanyView {
  id: string;
  name: string;
  color: string;
  last4: string;
  balance: number;
  displayBalance: string;
  canManage: boolean;
  canFund: boolean;
  ownWorkerId?: string;
  card: PrepaidCardView;
  workers: PrepaidCardView[];
  transfers: Array<TransferRecord & { displayAmount: string }>;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Company prepaid cards and worker cards.
 * Balances stay on their own ledger accounts. Nothing is sent to Stripe.
 */
export class EmpresasModule {
  readonly id = "empresas";
  readonly label = "Empresas";
  private readonly companies = new Map<string, CompanyRecord>();
  private readonly workers = new Map<string, WorkerRecord>();
  private readonly transfers: TransferRecord[] = [];

  constructor(
    private readonly payments: Payments,
    private readonly store: PlatformStore,
  ) {
    for (const company of store.list<CompanyRecord>("companies")) this.companies.set(company.id, company);
    for (const worker of store.list<WorkerRecord>("company_workers")) this.workers.set(worker.id, worker);
    this.transfers.push(...store.list<TransferRecord>("company_transfers"));
  }

  list(actor: CompanyActor): { companies: CompanyView[]; canCreate: boolean } {
    const visible = [...this.companies.values()].filter((company) => this.canSee(actor, company));
    return {
      canCreate: actor.role === "operacion" || actor.role === "comercio",
      companies: visible.map((company) => this.present(actor, company)),
    };
  }

  create(actor: CompanyActor, input: { name: string; color: string }): CompanyView {
    if (actor.role === "titular") throw new PlatformError("Un trabajador no abre la empresa", 403);
    const name = input.name.trim();
    const color = input.color.trim();
    if (!name) throw new PlatformError("El nombre de la empresa es requerido", 400);
    if (!COLOR.test(color)) throw new PlatformError("El color de la tarjeta debe ser hexadecimal", 400);
    const ledger = this.payments.ledger.createAccount({
      name,
      email: actor.email,
      currency: this.payments.walletAccount.currency,
    });
    const company: CompanyRecord = {
      id: `emp_${randomUUID().slice(0, 8)}`,
      name,
      ownerUserId: actor.id,
      ownerEmail: actor.email,
      color,
      last4: fourDigits(),
      ledgerAccountId: ledger.id,
      createdAt: new Date().toISOString(),
    };
    this.companies.set(company.id, company);
    this.store.put("companies", company.id, company);
    return this.present(actor, company);
  }

  addWorker(actor: CompanyActor, companyId: string, input: { name: string; email: string }): CompanyView {
    const company = this.require(companyId);
    if (!this.canManage(actor, company)) throw new PlatformError("Esta empresa no está en tu rol", 403);
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name || !email.includes("@")) throw new PlatformError("Nombre y correo del trabajador son requeridos", 400);
    const taken = [...this.workers.values()].some((worker) => worker.companyId === company.id && worker.email === email);
    if (taken) throw new PlatformError("Ese trabajador ya tiene prepago en la empresa", 409);
    const ledger = this.payments.ledger.createAccount({
      name,
      email,
      currency: this.payments.walletAccount.currency,
    });
    const worker: WorkerRecord = {
      id: `wrk_${randomUUID().slice(0, 8)}`,
      companyId: company.id,
      name,
      email,
      last4: fourDigits(),
      ledgerAccountId: ledger.id,
      createdAt: new Date().toISOString(),
    };
    this.workers.set(worker.id, worker);
    this.store.put("company_workers", worker.id, worker);
    return this.present(actor, company);
  }

  fund(actor: CompanyActor, companyId: string, amount: number): CompanyView {
    if (actor.role !== "operacion") throw new PlatformError("Solo operación carga el prepago de la empresa", 403);
    const company = this.require(companyId);
    this.assertAmount(amount);
    this.payments.ledger.post("credit", company.ledgerAccountId, amount, `Abono prepago ${company.name}`);
    this.remember({
      id: `ptr_${randomUUID().slice(0, 8)}`,
      companyId: company.id,
      kind: "abono",
      amount,
      actorUserId: actor.id,
      createdAt: new Date().toISOString(),
    });
    return this.present(actor, company);
  }

  transfer(
    actor: CompanyActor,
    companyId: string,
    input: { workerId: string; amount: number; direction: "to_worker" | "to_company" },
  ): CompanyView {
    const company = this.require(companyId);
    const worker = this.workers.get(input.workerId);
    if (!worker || worker.companyId !== company.id) throw new PlatformError("Trabajador desconocido", 404);
    this.assertAmount(input.amount);
    if (!this.canSee(actor, company)) throw new PlatformError("Esta empresa no está en tu rol", 403);
    const toWorker = input.direction === "to_worker";
    if (toWorker && !this.canManage(actor, company)) throw new PlatformError("Solo la empresa transfiere hacia el prepago", 403);
    if (!toWorker && !this.canManage(actor, company) && !this.isWorker(actor, worker)) {
      throw new PlatformError("Solo puedes transferir tu propio prepago", 403);
    }
    const source = toWorker ? company.ledgerAccountId : worker.ledgerAccountId;
    const target = toWorker ? worker.ledgerAccountId : company.ledgerAccountId;
    if ((this.payments.ledger.getAccount(source)?.balance ?? 0) < input.amount) {
      throw new PlatformError("Saldo insuficiente en la tarjeta", 422);
    }
    const label = toWorker ? `Prepago a ${worker.name}` : `Prepago de ${worker.name} a la empresa`;
    this.payments.ledger.post("debit", source, input.amount, label);
    this.payments.ledger.post("credit", target, input.amount, label);
    this.remember({
      id: `ptr_${randomUUID().slice(0, 8)}`,
      companyId: company.id,
      kind: toWorker ? "to_worker" : "to_company",
      workerId: worker.id,
      workerName: worker.name,
      amount: input.amount,
      actorUserId: actor.id,
      createdAt: new Date().toISOString(),
    });
    return this.present(actor, company);
  }

  private present(actor: CompanyActor, company: CompanyRecord): CompanyView {
    const manage = this.canManage(actor, company);
    const currency = this.payments.walletAccount.currency;
    const workers = [...this.workers.values()].filter((worker) => worker.companyId === company.id);
    const own = workers.find((worker) => this.isWorker(actor, worker));
    const visibleWorkers = manage ? workers : workers.filter((worker) => worker.id === own?.id);
    const card = this.cardView(company.id, company.name, company.ownerEmail, company.last4, company.ledgerAccountId, currency);
    const hideWorkerBalance = actor.role === "comercio";
    return {
      id: company.id,
      name: company.name,
      color: company.color,
      last4: company.last4,
      balance: manage ? card.balance : 0,
      displayBalance: manage ? card.displayBalance : "—",
      canManage: manage,
      canFund: actor.role === "operacion",
      ownWorkerId: own?.id,
      card: manage ? card : { ...card, balance: 0, displayBalance: "—" },
      workers: visibleWorkers.map((worker) => {
        const view = this.cardView(worker.id, worker.name, worker.email, worker.last4, worker.ledgerAccountId, currency);
        if (!hideWorkerBalance) return view;
        return { ...view, balance: 0, displayBalance: "—" };
      }),
      transfers: this.transfers
        .filter((transfer) => transfer.companyId === company.id)
        .filter((transfer) => manage || transfer.workerId === own?.id)
        .slice(-12)
        .reverse()
        .map((transfer) => ({ ...transfer, displayAmount: formatAmount(transfer.amount, currency) })),
    };
  }

  private cardView(id: string, name: string, email: string, last4: string, ledgerAccountId: string, currency: string): PrepaidCardView {
    const balance = this.payments.ledger.getAccount(ledgerAccountId)?.balance ?? 0;
    return { id, name, email, last4, balance, displayBalance: formatAmount(balance, currency) };
  }

  private canManage(actor: CompanyActor, company: CompanyRecord): boolean {
    return actor.role === "operacion" || company.ownerUserId === actor.id;
  }

  private canSee(actor: CompanyActor, company: CompanyRecord): boolean {
    if (this.canManage(actor, company)) return true;
    return [...this.workers.values()].some((worker) => worker.companyId === company.id && this.isWorker(actor, worker));
  }

  private isWorker(actor: CompanyActor, worker: WorkerRecord): boolean {
    return actor.role === "titular" && worker.email === actor.email.toLowerCase();
  }

  private require(id: string): CompanyRecord {
    const company = this.companies.get(id);
    if (!company) throw new PlatformError("Empresa desconocida", 404);
    return company;
  }

  private assertAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new PlatformError("El monto debe ser un entero positivo", 400);
  }

  private remember(transfer: TransferRecord): void {
    this.transfers.push(transfer);
    this.store.put("company_transfers", transfer.id, transfer);
  }
}

function fourDigits(): string {
  const value = randomBytes(2).readUInt16BE(0) % 10000;
  return value.toString().padStart(4, "0");
}
