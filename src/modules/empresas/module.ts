import { randomBytes, randomUUID } from "node:crypto";
import type { Role } from "../../auth/module.js";
import { PlatformError } from "../../errors.js";
import { formatAmount } from "../../money.js";
import type { Payments } from "../../payments/service.js";
import {
  GIFT_DISCLAIMER,
  activateVirtualGift,
  issueVirtualGift,
  type GiftActivationStripe,
  type GiftStripe,
  type IssuedGift,
} from "../regalos/issue.js";
import type { PlatformStore } from "../../store/db.js";

export interface CompanyActor {
  id: string;
  email: string;
  role: Role;
  name?: string;
  companyId?: string;
}

export const SPEND_CATEGORIES = ["alimentacion", "transporte", "combustible", "salud", "oficina", "otros"] as const;
export type SpendCategory = (typeof SPEND_CATEGORIES)[number];
export type UsagePeriod = "siempre" | "mensual" | "rango";

export interface CardOptions {
  spendLimit: number | null;
  categories: SpendCategory[];
  period: UsagePeriod;
  periodFrom: string | null;
  periodUntil: string | null;
  blocked: boolean;
  alerts: boolean;
}

export interface CardMovement {
  id: string;
  kind: "credit" | "debit";
  amount: number;
  displayAmount: string;
  reference: string;
  createdAt: string;
}

interface CompanyRecord {
  id: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  color: string;
  logo: string | null;
  commune: string | null;
  last4: string;
  ledgerAccountId: string;
  options: CardOptions;
  createdAt: string;
}

interface WorkerRecord {
  id: string;
  companyId: string;
  name: string;
  email: string;
  last4: string;
  ledgerAccountId: string;
  options: CardOptions;
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

interface GiftRecord extends IssuedGift {
  id: string;
  companyId: string;
  companyName: string;
  recipientId: string;
  recipientName: string;
  title: string;
  note: string;
  disclaimer: string;
  createdAt: string;
  money: false;
}

interface CompanyMemberRecord {
  id: string;
  userId: string;
  companyId: string;
  name: string;
  email: string;
  role: "comercio" | "titular";
  createdAt: string;
}

export interface PrepaidCardView {
  id: string;
  name: string;
  email: string;
  last4: string;
  /** Book balance on the local prepaid ledger. */
  balance: number;
  displayBalance: string;
  /**
   * Money Stripe has settled. A demo or internal abono never counts.
   * Transfers stay on the local ledger and do not fund a Stripe Transfer.
   */
  available: number;
  displayAvailable: string;
  realFunds: boolean;
  logo: string | null;
  kind: "debito";
  plastic: false;
  options: CardOptions;
  movements: CardMovement[];
  receipts: CardMovement[];
  contract: DebitContract | null;
}

export interface CompanyView {
  id: string;
  name: string;
  color: string;
  logo: string | null;
  commune: string | null;
  last4: string;
  balance: number;
  displayBalance: string;
  available: number;
  displayAvailable: string;
  realFunds: boolean;
  canManage: boolean;
  canFund: boolean;
  ownWorkerId?: string;
  contract: DebitContract | null;
  card: PrepaidCardView;
  workers: PrepaidCardView[];
  transfers: Array<TransferRecord & { displayAmount: string }>;
  gifts: GiftView[];
  users: CompanyMemberView[];
  /** Present only for operación. Comercio and titular do not receive these records. */
  globalAccounts?: GlobalAccountsView;
}

export interface HomeView {
  role: Role;
  name: string;
  email: string;
  commune: string | null;
  companyName: string | null;
  card: PrepaidCardView | null;
  contract: DebitContract | null;
  gifts: GiftView[];
  coursesPath: "#/clases";
  configurationPath: "#/configuracion" | null;
}

export interface DebitContract {
  id: string;
  cardId: string;
  companyId: string;
  holderName: string;
  companyName: string;
  accountType: "débito virtual, sin crédito";
  parties: string;
  openedAt: string;
  text: string;
}

export interface GiftView {
  id: string;
  companyId: string;
  companyName: string;
  recipientId: string;
  recipientName: string;
  title: string;
  note: string;
  status: "pending" | "issued";
  active: boolean;
  canActivate: boolean;
  code: string | null;
  stripeCouponId: string | null;
  stripePromotionCodeId: string | null;
  pendingMessage: string | null;
  inactiveMessage: string | null;
  nfcNote: string | null;
  disclaimer: string;
  qr: boolean[][] | null;
  createdAt: string;
  money: false;
}

/**
 * Chile can require a local account, and that account only sends money out.
 * CLP is not a virtual-account rail here, and this repo has no outbound CLP provider,
 * so the request stays pending. No bank number, card, balance, or provider id is invented.
 */
export const CHILE_TRANSFER_LABEL = "Cuenta en Chile solo para transferir";

export const CHILE_TRANSFER_PURPOSE =
  "Solo para transferir desde Chile. No recibe dinero, no emite tarjeta, no convierte a cripto y no abona a Stripe.";

export const CHILE_TRANSFER_NOTICE =
  "La cuenta en Chile queda pendiente. No hay un proveedor para transferir CLP hacia afuera, así que no tiene número de cuenta, no es tarjeta y no deposita en Stripe.";

export type GlobalAccountKind = "cuenta_chile";

export interface GlobalAccountView {
  id: string;
  kind: GlobalAccountKind;
  label: string;
  purpose: string;
  /** Outbound only. This account does not receive CLP. */
  direction: "salida";
  status: "pending";
  /** Absent on purpose: no provider returned an id. */
  externalId: null;
  createdAt: string;
}

export interface GlobalAccountsView {
  notice: string;
  accounts: GlobalAccountView[];
}

interface GlobalAccountRecord {
  id: string;
  companyId: string;
  kind: GlobalAccountKind;
  label: string;
  purpose: string;
  status: "pending";
  externalId: null;
  createdAt: string;
}

const CHILE_TRANSFER_COPY = {
  label: CHILE_TRANSFER_LABEL,
  purpose: CHILE_TRANSFER_PURPOSE,
} as const;

export interface CompanyMemberView {
  id: string;
  name: string;
  email: string;
  role: "comercio" | "titular";
  roleLabel: string;
  companyId: string;
}

export interface CardOptionsInput {
  spendLimit?: number | null;
  categories?: string[];
  period?: string;
  periodFrom?: string | null;
  periodUntil?: string | null;
  blocked?: boolean;
  alerts?: boolean;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = new Set<UsagePeriod>(["siempre", "mensual", "rango"]);

/**
 * Company and worker virtual debit cards.
 * Balances stay on their own ledger accounts. Nothing is sent to Stripe Issuing or Transfer.
 * Available funds are only money Stripe has settled, so a demo abono stays at zero there.
 */
export class EmpresasModule {
  readonly id = "empresas";
  readonly label = "Empresas";
  private readonly companies = new Map<string, CompanyRecord>();
  private readonly workers = new Map<string, WorkerRecord>();
  private readonly transfers: TransferRecord[] = [];
  private readonly contracts = new Map<string, DebitContract>();
  private readonly contractByCard = new Map<string, DebitContract>();
  private readonly gifts = new Map<string, GiftRecord>();
  private readonly members = new Map<string, CompanyMemberRecord>();
  private readonly globalAccounts: GlobalAccountRecord[] = [];

  constructor(
    private readonly payments: Payments,
    private readonly store: PlatformStore,
  ) {
    for (const company of store.list<CompanyRecord>("companies")) this.companies.set(company.id, company);
    for (const worker of store.list<WorkerRecord>("company_workers")) this.workers.set(worker.id, worker);
    this.transfers.push(...store.list<TransferRecord>("company_transfers"));
    for (const contract of store.list<DebitContract>("debit_contracts")) this.rememberContract(contract, false);
    for (const gift of store.list<GiftRecord>("virtual_gifts")) this.gifts.set(gift.id, gift);
    for (const member of store.list<CompanyMemberRecord>("company_users")) this.members.set(member.id, member);
    this.globalAccounts.push(...store.list<GlobalAccountRecord>("company_global_accounts"));
  }

  list(actor: CompanyActor): { companies: CompanyView[]; canCreate: boolean } {
    const visible = [...this.companies.values()].filter((company) => this.canSee(actor, company));
    return {
      canCreate: actor.role === "operacion",
      companies: visible.map((company) => this.present(actor, company)),
    };
  }

  home(actor: CompanyActor, communeFallback: string | null): HomeView {
    const base = {
      role: actor.role,
      email: actor.email,
      coursesPath: "#/clases" as const,
      configurationPath: actor.role === "operacion" ? ("#/configuracion" as const) : null,
    };
    if (actor.role === "operacion") {
      return { ...base, name: actor.name || "Operación", commune: null, companyName: null, card: null, contract: null, gifts: [] };
    }
    if (actor.role === "titular") {
      const worker = [...this.workers.values()].find((item) => this.isWorker(actor, item));
      const company = worker ? this.companies.get(worker.companyId) : undefined;
      if (!worker || !company) {
        return {
          ...base,
          name: actor.name || actor.email,
          commune: communeFallback,
          companyName: null,
          card: null,
          contract: null,
          gifts: [],
        };
      }
      const view = this.present(actor, company);
      const card = view.workers.find((item) => item.id === worker.id) ?? null;
      return {
        ...base,
        name: worker.name,
        email: worker.email,
        commune: company.commune ?? communeFallback,
        companyName: company.name,
        card,
        contract: card?.contract ?? null,
        gifts: view.gifts,
      };
    }
    const owned = actor.companyId
      ? this.companies.get(actor.companyId)
      : [...this.companies.values()].find((company) => company.ownerUserId === actor.id);
    if (!owned) {
      return {
        ...base,
        name: actor.name || actor.email,
        commune: communeFallback,
        companyName: null,
        card: null,
        contract: null,
        gifts: [],
      };
    }
    const view = this.present(actor, owned);
    return {
      ...base,
      name: owned.name,
      email: owned.ownerEmail,
      commune: owned.commune ?? communeFallback,
      companyName: owned.name,
      card: view.card,
      contract: view.card.contract,
      gifts: view.gifts,
    };
  }

  create(
    actor: CompanyActor,
    input: { name: string; color: string; commune?: string; logo?: string; owner?: { id: string; email: string; name: string } },
  ): CompanyView {
    this.requireAdmin(actor);
    const name = input.name.trim();
    const color = input.color.trim();
    if (!name) throw new PlatformError("El nombre de la empresa es requerido", 400);
    if (!COLOR.test(color)) throw new PlatformError("El color de la tarjeta debe ser hexadecimal", 400);
    const owner = input.owner ?? { id: actor.id, email: actor.email, name: actor.name || name };
    const ledger = this.payments.ledger.createAccount({
      name,
      email: owner.email,
      currency: this.payments.walletAccount.currency,
    });
    const company: CompanyRecord = {
      id: `emp_${randomUUID().slice(0, 8)}`,
      name,
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      color,
      logo: input.logo ? normalizeLogo(input.logo) : null,
      commune: cleanCommune(input.commune),
      last4: fourDigits(),
      ledgerAccountId: ledger.id,
      options: defaultOptions(),
      createdAt: new Date().toISOString(),
    };
    this.companies.set(company.id, company);
    this.store.put("companies", company.id, company);
    this.rememberContract(openDebitContract({
      cardId: company.id,
      companyId: company.id,
      holderName: company.name,
      companyName: company.name,
      openedAt: company.createdAt,
    }));
    if (input.owner) {
      this.rememberMember({
        id: memberKey(company.id, owner.id),
        userId: owner.id,
        companyId: company.id,
        name: owner.name || company.name,
        email: owner.email.toLowerCase(),
        role: "comercio",
        createdAt: company.createdAt,
      });
    }
    return this.present(actor, company);
  }

  setLogo(actor: CompanyActor, companyId: string, logo: string): CompanyView {
    const company = this.require(companyId);
    this.requireAdmin(actor);
    company.logo = normalizeLogo(logo);
    this.companies.set(company.id, company);
    this.store.put("companies", company.id, company);
    return this.present(actor, company);
  }

  updateCard(actor: CompanyActor, companyId: string, cardId: string, input: CardOptionsInput): CompanyView {
    const company = this.require(companyId);
    this.requireAdmin(actor);
    const worker = this.workers.get(cardId);
    const companyCard = cardId === company.id;
    if (!companyCard && (!worker || worker.companyId !== company.id)) throw new PlatformError("Tarjeta desconocida", 404);
    const next = mergeOptions(cardOptions(companyCard ? company.options : worker?.options), input);
    if (companyCard) company.options = next;
    else if (worker) worker.options = next;
    if (companyCard) this.store.put("companies", company.id, company);
    else if (worker) this.store.put("company_workers", worker.id, worker);
    return this.present(actor, company);
  }

  addWorker(actor: CompanyActor, companyId: string, input: { name: string; email: string }): CompanyView {
    const company = this.require(companyId);
    this.requireAdmin(actor);
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name || !email.includes("@")) throw new PlatformError("Nombre y correo del trabajador son requeridos", 400);
    const taken = [...this.workers.values()].some((worker) => worker.companyId === company.id && worker.email === email);
    if (taken) throw new PlatformError("Ese trabajador ya tiene prepago en la empresa", 409);
    const otherCompany = [...this.workers.values()].some((worker) => worker.email === email && worker.companyId !== company.id);
    if (otherCompany) throw new PlatformError("Ese cliente ya pertenece a otra empresa", 409);
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
      options: defaultOptions(),
      createdAt: new Date().toISOString(),
    };
    this.workers.set(worker.id, worker);
    this.store.put("company_workers", worker.id, worker);
    this.rememberContract(openDebitContract({
      cardId: worker.id,
      companyId: company.id,
      holderName: worker.name,
      companyName: company.name,
      openedAt: worker.createdAt,
    }));
    return this.present(actor, company);
  }

  async giveGift(
    actor: CompanyActor,
    companyId: string,
    input: { title: string; note: string; recipientId: string },
    stripe: GiftStripe | undefined,
  ): Promise<GiftView> {
    const company = this.require(companyId);
    this.requireAdmin(actor);
    const title = input.title.trim();
    const note = input.note.trim();
    const recipientId = input.recipientId.trim();
    if (!title || !note || !recipientId) throw new PlatformError("Título, nota y destinatario son requeridos", 400);
    if (title.length > 80) throw new PlatformError("El título es demasiado largo", 400);
    if (note.length > 280) throw new PlatformError("La nota es demasiado larga", 400);
    const recipientName = this.recipientName(company, recipientId);
    let issued: IssuedGift;
    try {
      issued = await issueVirtualGift(stripe, title);
    } catch {
      throw new PlatformError("Stripe no pudo emitir el regalo virtual", 502);
    }
    const gift: GiftRecord = {
      id: `gift_${randomUUID().slice(0, 8)}`,
      companyId: company.id,
      companyName: company.name,
      recipientId,
      recipientName,
      title,
      note,
      disclaimer: GIFT_DISCLAIMER,
      createdAt: new Date().toISOString(),
      money: false,
      ...issued,
    };
    this.gifts.set(gift.id, gift);
    this.store.put("virtual_gifts", gift.id, gift);
    return presentGift(gift, { reveal: true, canActivate: true });
  }

  async activateGift(
    actor: CompanyActor,
    companyId: string,
    giftId: string,
    stripe: GiftActivationStripe | undefined,
  ): Promise<GiftView> {
    const company = this.require(companyId);
    this.requireAdmin(actor);
    const gift = this.gifts.get(giftId);
    if (!gift || gift.companyId !== company.id) throw new PlatformError("Regalo desconocido", 404);
    if (gift.active !== true) {
      try {
        await activateVirtualGift(stripe, gift.stripePromotionCodeId);
      } catch {
        throw new PlatformError("Stripe no pudo activar el regalo virtual", 502);
      }
      gift.active = true;
      gift.inactiveMessage = null;
      this.gifts.set(gift.id, gift);
      this.store.put("virtual_gifts", gift.id, gift);
    }
    return presentGift(gift, { reveal: true, canActivate: false });
  }

  assertCompanyUsers(actor: CompanyActor, companyId: string): void {
    this.require(companyId);
    this.requireAdmin(actor);
  }

  registerMember(
    actor: CompanyActor,
    companyId: string,
    input: { id: string; name: string; email: string; role: "comercio" | "titular" },
  ): CompanyView {
    const company = this.require(companyId);
    this.requireAdmin(actor);
    this.rememberMember({
      id: memberKey(company.id, input.id),
      userId: input.id,
      companyId: company.id,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      createdAt: new Date().toISOString(),
    });
    return this.present(actor, company);
  }

  removeMember(companyId: string, userId: string): void {
    const id = memberKey(companyId, userId);
    this.members.delete(id);
    this.store.delete("company_users", id);
  }

  hasWorker(companyId: string, email: string): boolean {
    const normalized = email.trim().toLowerCase();
    return [...this.workers.values()].some((worker) => worker.companyId === companyId && worker.email === normalized);
  }

  workerCompanyId(email: string): string | undefined {
    const normalized = email.trim().toLowerCase();
    return [...this.workers.values()].find((worker) => worker.email === normalized)?.companyId;
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
    this.requireAdmin(actor);
    const worker = this.workers.get(input.workerId);
    if (!worker || worker.companyId !== company.id) throw new PlatformError("Trabajador desconocido", 404);
    this.assertAmount(input.amount);
    const toWorker = input.direction === "to_worker";
    if (toWorker && cardOptions(company.options).blocked) {
      throw new PlatformError("La tarjeta de la empresa está bloqueada", 422);
    }
    if (!toWorker && cardOptions(worker.options).blocked) {
      throw new PlatformError("La tarjeta del trabajador está bloqueada", 422);
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

  /**
   * Local pending request for a Chilean account that can only transfer out.
   * No outbound CLP provider is wired, so nothing is sent to Bridge, Global66,
   * Stripe, or a bank. Debit cards stay on their own ledger.
   */
  requestGlobalAccounts(actor: CompanyActor, companyId: string): { company: CompanyView; created: boolean } {
    const company = this.require(companyId);
    if (actor.role !== "operacion") throw new PlatformError("Solo operación solicita la cuenta en Chile", 403);
    const existing = this.globalAccounts.some((account) => account.companyId === company.id && account.kind === "cuenta_chile");
    if (!existing) {
      this.rememberGlobal(pendingGlobalAccount(company.id, new Date().toISOString()));
    }
    return { company: this.present(actor, company), created: !existing };
  }

  private present(actor: CompanyActor, company: CompanyRecord): CompanyView {
    const manage = actor.role === "operacion";
    const seeCompanyMoney = manage || this.isHolder(actor, company);
    const currency = this.payments.walletAccount.currency;
    const workers = [...this.workers.values()].filter((worker) => worker.companyId === company.id);
    const own = workers.find((worker) => this.isWorker(actor, worker));
    const visibleWorkers = manage ? workers : own ? [own] : [];
    const logo = company.logo ?? null;
    const card = this.cardView(
      company.id,
      company.name,
      seeCompanyMoney ? company.ownerEmail : "",
      seeCompanyMoney ? company.last4 : "",
      company.ledgerAccountId,
      currency,
      logo,
      seeCompanyMoney ? company.options : undefined,
      seeCompanyMoney,
    );
    if (!seeCompanyMoney) card.contract = null;
    const view: CompanyView = {
      id: company.id,
      name: company.name,
      color: company.color,
      logo,
      commune: seeCompanyMoney ? company.commune ?? null : null,
      last4: seeCompanyMoney ? company.last4 : "",
      balance: seeCompanyMoney ? card.balance : 0,
      displayBalance: seeCompanyMoney ? card.displayBalance : "—",
      available: seeCompanyMoney ? card.available : 0,
      displayAvailable: seeCompanyMoney ? card.displayAvailable : "—",
      realFunds: seeCompanyMoney ? card.realFunds : false,
      canManage: manage,
      canFund: manage,
      ownWorkerId: own?.id,
      contract: card.contract,
      card,
      workers: visibleWorkers.map((worker) =>
        this.cardView(
          worker.id,
          worker.name,
          worker.email,
          worker.last4,
          worker.ledgerAccountId,
          currency,
          logo,
          worker.options,
          manage || worker.id === own?.id,
        ),
      ),
      gifts: this.visibleGifts(actor, company),
      users: manage ? this.membersOf(company.id) : [],
      transfers: manage
        ? this.transfers
            .filter((transfer) => transfer.companyId === company.id)
            .slice(-12)
            .reverse()
            .map((transfer) => ({ ...transfer, displayAmount: formatAmount(transfer.amount, currency) }))
        : [],
    };
    if (actor.role === "operacion") {
      view.globalAccounts = {
        notice: CHILE_TRANSFER_NOTICE,
        accounts: this.globalAccountsOf(company.id),
      };
    }
    return view;
  }

  private cardView(
    id: string,
    name: string,
    email: string,
    last4: string,
    ledgerAccountId: string,
    currency: string,
    logo: string | null,
    options: CardOptions | undefined,
    showMoney: boolean,
  ): PrepaidCardView {
    const balance = this.payments.ledger.getAccount(ledgerAccountId)?.balance ?? 0;
    const available = 0;
    const movements = showMoney ? this.movements(ledgerAccountId, currency) : [];
    return {
      id,
      name,
      email,
      last4,
      balance: showMoney ? balance : 0,
      displayBalance: showMoney ? formatAmount(balance, currency) : "—",
      available: showMoney ? available : 0,
      displayAvailable: showMoney ? formatAmount(available, currency) : "—",
      realFunds: false,
      logo,
      kind: "debito",
      plastic: false,
      options: cardOptions(options),
      movements,
      receipts: movements.map((item) => ({ ...item })),
      contract: this.contractByCard.get(id) ?? null,
    };
  }

  private movements(ledgerAccountId: string, currency: string): CardMovement[] {
    return this.payments.ledger
      .entriesFor(ledgerAccountId)
      .slice(-12)
      .reverse()
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amount: entry.amount,
        displayAmount: formatAmount(entry.amount, currency),
        reference: entry.reference,
        createdAt: entry.createdAt,
      }));
  }

  private requireAdmin(actor: CompanyActor): void {
    if (actor.role !== "operacion") throw new PlatformError("Solo operación configura la cuenta", 403);
  }

  private isHolder(actor: CompanyActor, company: CompanyRecord): boolean {
    if (actor.role !== "comercio") return false;
    if (actor.companyId && actor.companyId !== company.id) return false;
    return company.ownerUserId === actor.id || actor.companyId === company.id;
  }

  private canSee(actor: CompanyActor, company: CompanyRecord): boolean {
    if (actor.companyId && actor.companyId !== company.id) return false;
    if (actor.role === "operacion") return true;
    if (this.isHolder(actor, company)) return true;
    return [...this.workers.values()].some((worker) => worker.companyId === company.id && this.isWorker(actor, worker));
  }

  private isWorker(actor: CompanyActor, worker: WorkerRecord): boolean {
    if (actor.role !== "titular" || worker.email !== actor.email.toLowerCase()) return false;
    if (actor.companyId && actor.companyId !== worker.companyId) return false;
    return true;
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

  private rememberGlobal(account: GlobalAccountRecord): void {
    this.globalAccounts.push(account);
    this.store.put("company_global_accounts", account.id, account);
  }

  private globalAccountsOf(companyId: string): GlobalAccountView[] {
    return this.globalAccounts
      .filter((account) => account.companyId === companyId && account.kind === "cuenta_chile")
      .map((account) => ({
        id: account.id,
        kind: "cuenta_chile",
        label: CHILE_TRANSFER_LABEL,
        purpose: CHILE_TRANSFER_PURPOSE,
        direction: "salida",
        status: "pending",
        externalId: null,
        createdAt: account.createdAt,
      }));
  }

  private rememberContract(contract: DebitContract, persist = true): void {
    this.contracts.set(contract.id, contract);
    this.contractByCard.set(contract.cardId, contract);
    if (persist) this.store.put("debit_contracts", contract.id, contract);
  }

  private recipientName(company: CompanyRecord, recipientId: string): string {
    if (recipientId === company.id) return company.name;
    const worker = this.workers.get(recipientId);
    if (!worker || worker.companyId !== company.id) throw new PlatformError("Ese destinatario no está en la empresa", 404);
    return worker.name;
  }

  private visibleGifts(actor: CompanyActor, company: CompanyRecord): GiftView[] {
    const rows = [...this.gifts.values()].filter((gift) => gift.companyId === company.id);
    const own = [...this.workers.values()].find((worker) => worker.companyId === company.id && this.isWorker(actor, worker));
    const holder = this.isHolder(actor, company);
    const admin = actor.role === "operacion";
    const visible = admin
      ? rows
      : rows.filter((gift) => (own && gift.recipientId === own.id) || (holder && gift.recipientId === company.id));
    return visible
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
      .map((gift) => presentGift(gift, { reveal: admin || gift.active === true, canActivate: admin && gift.active !== true }));
  }

  private rememberMember(member: CompanyMemberRecord): void {
    this.members.set(member.id, member);
    this.store.put("company_users", member.id, member);
  }

  private membersOf(companyId: string): CompanyMemberView[] {
    return [...this.members.values()]
      .filter((member) => member.companyId === companyId)
      .map((member) => ({
        id: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        roleLabel: member.role === "titular" ? "Cliente" : "Usuario de la empresa",
        companyId: member.companyId,
      }));
  }
}

export function debitContractText(input: { holderName: string; companyName: string; openedAt: string }): string {
  const date = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "UTC" }).format(new Date(input.openedAt));
  return [
    "Contrato de apertura de cuenta de débito",
    "",
    `Partes: Proveedor Regional y ${input.holderName}.`,
    "Tipo de cuenta: débito virtual, sin crédito.",
    `Titular: ${input.holderName}.`,
    `Empresa: ${input.companyName}.`,
    `Fecha: ${date}.`,
    "",
    "La tarjeta es virtual y muestra el logo de la empresa. No hay plástico y no hay línea de crédito.",
    "Proveedor Regional no es un banco y este contrato no invoca una autorización de la CMF.",
  ].join("\n");
}

function openDebitContract(input: {
  cardId: string;
  companyId: string;
  holderName: string;
  companyName: string;
  openedAt: string;
}): DebitContract {
  return {
    id: `ctr_${randomUUID().slice(0, 8)}`,
    cardId: input.cardId,
    companyId: input.companyId,
    holderName: input.holderName,
    companyName: input.companyName,
    accountType: "débito virtual, sin crédito",
    parties: `Proveedor Regional y ${input.holderName}`,
    openedAt: input.openedAt,
    text: debitContractText(input),
  };
}

function presentGift(gift: GiftRecord, access: { reveal: boolean; canActivate: boolean }): GiftView {
  const active = gift.active === true;
  const showCode = access.reveal || active;
  return {
    id: gift.id,
    companyId: gift.companyId,
    companyName: gift.companyName,
    recipientId: gift.recipientId,
    recipientName: gift.recipientName,
    title: gift.title,
    note: gift.note,
    status: gift.status,
    active,
    canActivate: access.canActivate && !active,
    code: showCode ? gift.code : null,
    stripeCouponId: showCode ? gift.stripeCouponId : null,
    stripePromotionCodeId: showCode ? gift.stripePromotionCodeId : null,
    pendingMessage: gift.pendingMessage,
    inactiveMessage: active ? null : gift.inactiveMessage,
    nfcNote: showCode ? gift.nfcNote : null,
    disclaimer: gift.disclaimer,
    qr: showCode ? gift.qr : null,
    createdAt: gift.createdAt,
    money: false,
  };
}

function pendingGlobalAccount(companyId: string, createdAt: string): GlobalAccountRecord {
  return {
    id: `gac_${randomUUID().slice(0, 8)}`,
    companyId,
    kind: "cuenta_chile",
    label: CHILE_TRANSFER_COPY.label,
    purpose: CHILE_TRANSFER_COPY.purpose,
    status: "pending",
    externalId: null,
    createdAt,
  };
}

function memberKey(companyId: string, userId: string): string {
  return `${companyId}:${userId}`;
}

function defaultOptions(): CardOptions {
  return {
    spendLimit: null,
    categories: [],
    period: "siempre",
    periodFrom: null,
    periodUntil: null,
    blocked: false,
    alerts: false,
  };
}

function cardOptions(value: Partial<CardOptions> | undefined): CardOptions {
  const base = defaultOptions();
  if (!value) return base;
  return {
    spendLimit: value.spendLimit ?? base.spendLimit,
    categories: Array.isArray(value.categories) ? value.categories.filter(isCategory) : base.categories,
    period: value.period && PERIODS.has(value.period) ? value.period : base.period,
    periodFrom: value.periodFrom ?? base.periodFrom,
    periodUntil: value.periodUntil ?? base.periodUntil,
    blocked: value.blocked ?? base.blocked,
    alerts: value.alerts ?? base.alerts,
  };
}

function mergeOptions(current: CardOptions, input: CardOptionsInput): CardOptions {
  const next: CardOptions = { ...current, categories: [...current.categories] };
  if (input.spendLimit !== undefined) {
    if (input.spendLimit === null) next.spendLimit = null;
    else if (!Number.isInteger(input.spendLimit) || input.spendLimit <= 0) {
      throw new PlatformError("El límite de gasto tiene que ser un monto positivo", 400);
    } else next.spendLimit = input.spendLimit;
  }
  if (input.categories !== undefined) {
    if (!Array.isArray(input.categories) || input.categories.some((item) => !isCategory(item))) {
      throw new PlatformError("Hay una categoría de gasto desconocida", 400);
    }
    next.categories = input.categories.filter(isCategory);
  }
  if (input.period !== undefined) {
    if (!isPeriod(input.period)) throw new PlatformError("El período de uso no es válido", 400);
    next.period = input.period;
  }
  if (input.periodFrom !== undefined) next.periodFrom = input.periodFrom;
  if (input.periodUntil !== undefined) next.periodUntil = input.periodUntil;
  if (input.blocked !== undefined) {
    if (typeof input.blocked !== "boolean") throw new PlatformError("El bloqueo tiene que ser sí o no", 400);
    next.blocked = input.blocked;
  }
  if (input.alerts !== undefined) {
    if (typeof input.alerts !== "boolean") throw new PlatformError("Las alertas tienen que ser sí o no", 400);
    next.alerts = input.alerts;
  }
  if (next.period === "rango") {
    if (!next.periodFrom || !next.periodUntil || !DAY.test(next.periodFrom) || !DAY.test(next.periodUntil)) {
      throw new PlatformError("El período necesita una fecha de inicio y de término", 400);
    }
    if (next.periodFrom > next.periodUntil) throw new PlatformError("El período termina antes de empezar", 400);
  } else {
    next.periodFrom = null;
    next.periodUntil = null;
  }
  return next;
}

function isCategory(value: string): value is SpendCategory {
  return (SPEND_CATEGORIES as readonly string[]).includes(value);
}

function isPeriod(value: string): value is UsagePeriod {
  return PERIODS.has(value as UsagePeriod);
}

function cleanCommune(value: string | undefined): string | null {
  const commune = value?.trim() ?? "";
  if (!commune) return null;
  if (commune.length > 80) throw new PlatformError("La comuna es demasiado larga", 400);
  return commune;
}

export function normalizeLogo(logo: string): string | null {
  const value = logo.trim();
  if (!value) return null;
  if (value.length > 120_000) throw new PlatformError("El logo es demasiado grande", 400);
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PlatformError("El logo tiene que ser una imagen https o un archivo PNG, JPEG o WebP", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PlatformError("El logo tiene que ser una imagen https o un archivo PNG, JPEG o WebP", 400);
  }
  return value;
}

function fourDigits(): string {
  const value = randomBytes(2).readUInt16BE(0) % 10000;
  return value.toString().padStart(4, "0");
}
