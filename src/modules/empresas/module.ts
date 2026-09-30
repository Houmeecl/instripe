import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Role } from "../../auth/module.js";
import { PlatformError } from "../../errors.js";
import {
  decryptGlobal66Secret,
  encryptGlobal66Secret,
  Global66BusinessApi,
  type Global66Credentials,
  type Global66WalletSnapshot,
} from "../../gateways/global66BusinessApi.js";
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

interface CompanyRecord {
  id: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  color: string;
  logo: string | null;
  commune: string | null;
  last4: string;
  ledgerAccountId?: string;
  options: CardOptions;
  global66?: {
    clientId: string;
    accountId: string;
    encryptedClientSecret: string;
    configuredAt: string;
  };
  portal?: {
    slug: string;
    createdAt: string;
    enabled: true;
  };
  createdAt: string;
}

interface WorkerRecord {
  id: string;
  companyId: string;
  name: string;
  email: string;
  last4: string;
  ledgerAccountId?: string;
  options: CardOptions;
  createdAt: string;
}

interface Global66TransferRecord {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  idempotencyKey: string;
  requestFingerprint: string;
  externalReferenceId: string;
  amount: number;
  status: "SUBMITTING" | "PROCESSING" | "SUCCESSFUL" | "FAILED" | "UNKNOWN";
  transactionId: string | null;
  createdAt: string;
}

export interface Global66TransferView {
  id: string;
  workerName: string;
  externalReferenceId: string;
  amount: number;
  status: Global66TransferRecord["status"];
  transactionId: string | null;
  createdAt: string;
}

export interface Global66CompanyWalletView extends Global66WalletSnapshot {
  transfers: Global66TransferView[];
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
  logo: string | null;
  kind: "debito";
  plastic: false;
  options: CardOptions;
  contract: DebitContract | null;
}

export interface CompanyView {
  id: string;
  name: string;
  color: string;
  logo: string | null;
  commune: string | null;
  last4: string;
  canManage: boolean;
  canViewWorkers: boolean;
  ownWorkerId?: string;
  contract: DebitContract | null;
  card: PrepaidCardView;
  workers: PrepaidCardView[];
  gifts: GiftView[];
  users: CompanyMemberView[];
  global66Connection?: {
    configured: boolean;
    accountId: string | null;
    clientIdHint: string | null;
  };
  portal: {
    slug: string;
    path: string;
    createdAt: string;
    enabled: boolean;
  };
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

export interface CompanyMemberView {
  id: string;
  name: string;
  email: string;
  role: "comercio" | "titular";
  roleLabel: string;
  companyId: string;
}

export interface CompanyDeletionPlan {
  ledgerAccountIds: string[];
  ownerUserId: string;
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

function maskIdentifier(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function createCompanyPortal(name: string, companyId: string, createdAt: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "empresa";
  return {
    slug: `${base}-${companyId.slice(-8).toLowerCase()}`,
    createdAt,
    enabled: true as const,
  };
}

/**
 * Company and worker card profiles. These are descriptive views, not issued cards
 * or stored-value accounts; company funds and card balances are handled elsewhere.
 */
export class EmpresasModule {
  readonly id = "empresas";
  readonly label = "Empresas";
  private readonly companies = new Map<string, CompanyRecord>();
  private readonly workers = new Map<string, WorkerRecord>();
  private readonly global66Transfers: Global66TransferRecord[] = [];
  private readonly contracts = new Map<string, DebitContract>();
  private readonly contractByCard = new Map<string, DebitContract>();
  private readonly gifts = new Map<string, GiftRecord>();
  private readonly members = new Map<string, CompanyMemberRecord>();
  private readonly global66Api: Global66BusinessApi;

  constructor(
    private readonly payments: Payments,
    private readonly store: PlatformStore,
    private readonly global66EncryptionKey: string | undefined,
    global66Api = new Global66BusinessApi(),
  ) {
    this.global66Api = global66Api;
    const companies = store.list<CompanyRecord>("companies");
    const workers = store.list<WorkerRecord>("company_workers");
    this.purgeLegacyDemoMoney(companies, workers);
    for (const company of companies) {
      if (!company.portal) {
        company.portal = createCompanyPortal(company.name, company.id, company.createdAt);
        store.put("companies", company.id, company);
      }
      this.companies.set(company.id, company);
    }
    for (const worker of workers) this.workers.set(worker.id, worker);
    this.global66Transfers.push(...store.list<Global66TransferRecord>("company_global66_transfers"));
    for (const contract of store.list<DebitContract>("debit_contracts")) this.rememberContract(contract, false);
    for (const gift of store.list<GiftRecord>("virtual_gifts")) this.gifts.set(gift.id, gift);
    for (const member of store.list<CompanyMemberRecord>("company_users")) this.members.set(member.id, member);
  }

  list(actor: CompanyActor): { companies: CompanyView[]; canCreate: boolean } {
    const visible = [...this.companies.values()].filter((company) => this.canSee(actor, company));
    return {
      canCreate: actor.role === "operacion",
      companies: visible.map((company) => this.present(actor, company)),
    };
  }

  prepareDeletion(actor: CompanyActor, companyId: string, confirmation: string): CompanyDeletionPlan {
    if (actor.role !== "operacion") throw new PlatformError("Solo operación puede eliminar empresas", 403);
    const company = this.require(companyId);
    if (confirmation !== company.name) throw new PlatformError("Escribe el nombre exacto de la empresa para confirmar", 400);

    const workers = [...this.workers.values()].filter((worker) => worker.companyId === company.id);
    const ledgerAccountIds = [company.ledgerAccountId, ...workers.map((worker) => worker.ledgerAccountId)]
      .filter((id): id is string => Boolean(id));
    if (this.global66Transfers.some(
      (transfer) => transfer.companyId === company.id && ["SUBMITTING", "PROCESSING", "UNKNOWN"].includes(transfer.status),
    )) {
      throw new PlatformError("No se puede eliminar mientras haya transferencias Global66 sin resolver", 409);
    }
    return { ledgerAccountIds, ownerUserId: company.ownerUserId };
  }

  forgetDeletedCompany(companyId: string): void {
    const workerIds = new Set(
      [...this.workers.values()].filter((worker) => worker.companyId === companyId).map((worker) => worker.id),
    );
    this.companies.delete(companyId);
    for (const workerId of workerIds) this.workers.delete(workerId);
    this.global66Transfers.splice(
      0,
      this.global66Transfers.length,
      ...this.global66Transfers.filter((transfer) => transfer.companyId !== companyId),
    );
    for (const [id, contract] of this.contracts) {
      if (contract.companyId !== companyId) continue;
      this.contracts.delete(id);
      this.contractByCard.delete(contract.cardId);
    }
    for (const [id, gift] of this.gifts) {
      if (gift.companyId === companyId) this.gifts.delete(id);
    }
    for (const [id, member] of this.members) {
      if (member.companyId === companyId) this.members.delete(id);
    }
  }

  private purgeLegacyDemoMoney(companies: CompanyRecord[], workers: WorkerRecord[]): void {
    const accountIds = new Set(
      [...companies.map((company) => company.ledgerAccountId), ...workers.map((worker) => worker.ledgerAccountId)]
        .filter((id): id is string => Boolean(id)),
    );
    const entries = this.store.list<{ id: string; accountId: string }>("ledger_entries")
      .filter((entry) => accountIds.has(entry.accountId));
    const accounts = this.store.list<{ id: string }>("ledger_accounts")
      .filter((account) => accountIds.has(account.id));
    const transfers = this.store.list<{ id: string }>("company_transfers");
    this.store.transaction(() => {
      for (const account of accounts) this.store.delete("ledger_accounts", account.id);
      for (const entry of entries) this.store.delete("ledger_entries", entry.id);
      for (const transfer of transfers) this.store.delete("company_transfers", transfer.id);
      for (const company of companies) {
        if (!company.ledgerAccountId) continue;
        delete company.ledgerAccountId;
        this.store.put("companies", company.id, company);
      }
      for (const worker of workers) {
        if (!worker.ledgerAccountId) continue;
        delete worker.ledgerAccountId;
        this.store.put("company_workers", worker.id, worker);
      }
    });
    this.payments.ledger.forgetAccounts([...accountIds]);
  }

  configureGlobal66(
    actor: CompanyActor,
    companyId: string,
    input: { clientId: string; clientSecret: string; accountId: string },
  ): CompanyView {
    const company = this.require(companyId);
    this.requireWalletManager(actor, company);
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    const accountId = input.accountId.trim();
    if (!clientId || !clientSecret || !accountId) {
      throw new PlatformError("clientId, clientSecret y accountId son requeridos", 400);
    }
    if (!this.global66EncryptionKey) {
      throw new PlatformError("Global66 no está habilitado: falta GLOBAL66_CREDENTIALS_ENCRYPTION_KEY en el servidor", 503);
    }
    const duplicate = [...this.companies.values()].find(
      (other) => other.id !== company.id && other.global66?.clientId === clientId,
    );
    if (duplicate) {
      throw new PlatformError("Esa credencial Global66 ya está asociada a otra empresa", 409);
    }
    company.global66 = {
      clientId,
      accountId,
      encryptedClientSecret: encryptGlobal66Secret(clientSecret, this.global66EncryptionKey),
      configuredAt: new Date().toISOString(),
    };
    this.companies.set(company.id, company);
    this.store.put("companies", company.id, company);
    return this.present(actor, company);
  }

  async global66Wallet(actor: CompanyActor, companyId: string): Promise<Global66CompanyWalletView> {
    const company = this.require(companyId);
    this.requireWalletManager(actor, company);
    const wallet = await this.global66WalletSnapshot(company);
    this.reconcileGlobal66Transfers(company.id, wallet.movements);
    return {
      ...wallet,
      transfers: this.global66Transfers
        .filter((transfer) => transfer.companyId === company.id)
        .slice(-20)
        .reverse()
        .map(({ id, workerName, externalReferenceId, amount, status, transactionId, createdAt }) => ({
          id,
          workerName,
          externalReferenceId,
          amount,
          status,
          transactionId,
          createdAt,
        })),
    };
  }

  async transferToBank(
    actor: CompanyActor,
    companyId: string,
    input: {
      workerId: string;
      idempotencyKey: string;
      amount: number;
      beneficiaryName: string;
      beneficiaryLastName: string;
      accountType: string;
      accountNumber: string;
      documentNumber: string;
      documentType: string;
      purposeCode: number;
    },
  ): Promise<Global66TransferView> {
    const company = this.require(companyId);
    this.requireWalletManager(actor, company);
    const worker = this.workers.get(input.workerId);
    if (!worker || worker.companyId !== company.id) throw new PlatformError("Colaborador desconocido", 404);
    this.assertAmount(input.amount);
    const credentials = this.credentialsFor(company);
    const encryptionKey = this.requireGlobal66EncryptionKey();

    const idempotencyKey = input.idempotencyKey.trim();
    const beneficiaryName = input.beneficiaryName.trim();
    const beneficiaryLastName = input.beneficiaryLastName.trim();
    const accountType = input.accountType.trim();
    const accountNumber = input.accountNumber.trim();
    const documentNumber = input.documentNumber.trim();
    const documentType = input.documentType.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)) {
      throw new PlatformError("La clave idempotente de la transferencia no es válida", 400);
    }
    if (!beneficiaryName || !beneficiaryLastName || !accountType || !accountNumber || !documentNumber || !documentType) {
      throw new PlatformError("Completa los datos bancarios y de identificación del beneficiario", 400);
    }
    if (!Number.isInteger(input.purposeCode) || input.purposeCode <= 0) {
      throw new PlatformError("El código de propósito de Global66 debe ser un entero positivo", 400);
    }
    const requestFingerprint = createHmac("sha256", encryptionKey)
      .update(JSON.stringify({
        workerId: worker.id,
        amount: input.amount,
        beneficiaryName,
        beneficiaryLastName,
        accountType,
        accountNumber,
        documentNumber,
        documentType,
        purposeCode: input.purposeCode,
      }))
      .digest("hex");
    const existing = this.global66Transfers.find(
      (transfer) => transfer.companyId === company.id && transfer.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new PlatformError("Esa clave idempotente ya se usó con datos diferentes", 409);
      }
      if (existing.status === "PROCESSING") return this.global66TransferView(existing);
      throw new PlatformError(
        `La transferencia ${existing.externalReferenceId} ya está ${existing.status}; verifica su estado con Global66 antes de intentar otra`,
        409,
      );
    }

    const wallet = await this.global66Api.walletSnapshot(credentials);
    if (wallet.balance === null) throw new PlatformError("Global66 no informó un saldo; la transferencia no se envió", 409);
    if (wallet.currency !== "CLP") {
      throw new PlatformError("La cuenta Global66 no confirmó saldo en CLP para una transferencia nacional", 422);
    }
    if (wallet.balance < input.amount) throw new PlatformError("Saldo insuficiente en la wallet Global66", 422);

    const transfer: Global66TransferRecord = {
      id: `g66t_${createHash("sha256").update(`${company.id}\0${idempotencyKey}`).digest("hex")}`,
      companyId: company.id,
      workerId: worker.id,
      workerName: worker.name,
      idempotencyKey,
      requestFingerprint,
      externalReferenceId: `pr_${company.id}_${idempotencyKey}`,
      amount: input.amount,
      status: "SUBMITTING",
      transactionId: null,
      createdAt: new Date().toISOString(),
    };
    if (!this.reserveGlobal66Transfer(transfer)) {
      const existingReservation = this.store.get<Global66TransferRecord>("company_global66_transfers", transfer.id);
      if (!existingReservation) {
        throw new PlatformError("No se pudo reservar la referencia de transferencia; verifica el historial antes de reenviar", 409);
      }
      if (existingReservation.requestFingerprint !== requestFingerprint) {
        throw new PlatformError("Esa clave idempotente ya se usó con datos diferentes", 409);
      }
      if (existingReservation.status === "PROCESSING") return this.global66TransferView(existingReservation);
      throw new PlatformError(
        `La transferencia ${existingReservation.externalReferenceId} ya está ${existingReservation.status}; verifica su estado con Global66 antes de intentar otra`,
        409,
      );
    }
    this.global66Transfers.push(transfer);

    let result: Awaited<ReturnType<Global66BusinessApi["createBankTransfer"]>>;
    try {
      result = await this.global66Api.createBankTransfer(
        credentials,
        {
          amount: input.amount,
          originCurrency: "CLP",
          destinationCurrency: "CLP",
          purposeCode: [input.purposeCode],
          beneficiaryName,
          beneficiaryLastName,
          countryCode: "CL",
          accountType,
          accountNumber,
          documentNumber,
          documentType,
          externalReferenceId: transfer.externalReferenceId,
        },
      );
    } catch (error) {
      transfer.status = "UNKNOWN";
      this.updateGlobal66Transfer(transfer);
      const detail = error instanceof Error ? error.message : "error no identificado";
      console.error(`Global66 transfer outcome unknown ref=${transfer.externalReferenceId}: ${detail}`);
      throw new PlatformError(
        `No se pudo confirmar el resultado con Global66. No repitas con otra referencia; verifica ${transfer.externalReferenceId} con Global66`,
        502,
      );
    }

    if (!result.valid) {
      transfer.status = "FAILED";
      this.updateGlobal66Transfer(transfer);
      throw new PlatformError(result.violations.join("; ") || "Global66 rechazó la transferencia", 422);
    }
    if (result.status !== "PROCESSING") {
      transfer.status = "UNKNOWN";
      transfer.transactionId = result.transactionId;
      this.updateGlobal66Transfer(transfer);
      throw new PlatformError(
        `Global66 no confirmó el estado de la transferencia ${transfer.externalReferenceId}; verifica antes de reenviar`,
        502,
      );
    }

    transfer.status = "PROCESSING";
    transfer.transactionId = result.transactionId;
    this.updateGlobal66Transfer(transfer);
    return this.global66TransferView(transfer);
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
    const company: CompanyRecord = {
      id: `emp_${randomUUID().slice(0, 8)}`,
      name,
      ownerUserId: owner.id,
      ownerEmail: owner.email,
      color,
      logo: input.logo ? normalizeLogo(input.logo) : null,
      commune: cleanCommune(input.commune),
      last4: fourDigits(),
      options: defaultOptions(),
      createdAt: new Date().toISOString(),
    };
    company.portal = createCompanyPortal(company.name, company.id, company.createdAt);
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
    if (taken) throw new PlatformError("Ese trabajador ya está agregado a la empresa", 409);
    const otherCompany = [...this.workers.values()].some((worker) => worker.email === email && worker.companyId !== company.id);
    if (otherCompany) throw new PlatformError("Ese cliente ya pertenece a otra empresa", 409);
    const worker: WorkerRecord = {
      id: `wrk_${randomUUID().slice(0, 8)}`,
      companyId: company.id,
      name,
      email,
      last4: fourDigits(),
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

  private present(actor: CompanyActor, company: CompanyRecord): CompanyView {
    const manage = actor.role === "operacion";
    const companyPortal = this.isHolder(actor, company);
    const canViewWorkers = manage || companyPortal;
    const seeCompanyMoney = manage;
    const workers = [...this.workers.values()].filter((worker) => worker.companyId === company.id);
    const own = workers.find((worker) => this.isWorker(actor, worker));
    const visibleWorkers = canViewWorkers ? workers : own ? [own] : [];
    const logo = company.logo ?? null;
    const card = this.cardView(
      company.id,
      company.name,
      seeCompanyMoney ? company.ownerEmail : "",
      seeCompanyMoney ? company.last4 : "",
      logo,
      seeCompanyMoney ? company.options : undefined,
    );
    if (!seeCompanyMoney) card.contract = null;
    const portal = company.portal ?? createCompanyPortal(company.name, company.id, company.createdAt);
    const view: CompanyView = {
      id: company.id,
      name: company.name,
      color: company.color,
      logo,
      commune: seeCompanyMoney ? company.commune ?? null : null,
      last4: seeCompanyMoney ? company.last4 : "",
      canManage: manage,
      canViewWorkers,
      ownWorkerId: own?.id,
      contract: card.contract,
      card,
      workers: visibleWorkers.map((worker) =>
        this.cardView(
        worker.id,
        worker.name,
        manage || !companyPortal ? worker.email : "",
        worker.last4,
        logo,
        worker.options,
        ),
      ),
      gifts: this.visibleGifts(actor, company),
      users: manage ? this.membersOf(company.id) : [],
      portal: {
        slug: portal.slug,
        path: `#/portal/${portal.slug}`,
        createdAt: portal.createdAt,
        enabled: portal.enabled,
      },
    };
    if (canViewWorkers) {
      view.global66Connection = company.global66
        ? {
            configured: true,
            accountId: company.global66.accountId,
            clientIdHint: maskIdentifier(company.global66.clientId),
          }
        : { configured: false, accountId: null, clientIdHint: null };
    }
    return view;
  }

  private cardView(
    id: string,
    name: string,
    email: string,
    last4: string,
    logo: string | null,
    options: CardOptions | undefined,
  ): PrepaidCardView {
    return {
      id,
      name,
      email,
      last4,
      logo,
      kind: "debito",
      plastic: false,
      options: cardOptions(options),
      contract: this.contractByCard.get(id) ?? null,
    };
  }

  private requireAdmin(actor: CompanyActor): void {
    if (actor.role !== "operacion") throw new PlatformError("Solo operación configura la cuenta", 403);
  }

  private requireWalletManager(actor: CompanyActor, company: CompanyRecord): void {
    if (actor.role === "operacion" || this.isHolder(actor, company)) return;
    throw new PlatformError("Solo operación o el administrador de esta empresa puede configurar su wallet", 403);
  }

  private credentialsFor(company: CompanyRecord): Global66Credentials {
    if (!company.global66) throw new PlatformError("Conecta primero la cuenta B2B de Global66", 409);
    const encryptionKey = this.requireGlobal66EncryptionKey();
    return {
      clientId: company.global66.clientId,
      accountId: company.global66.accountId,
      clientSecret: decryptGlobal66Secret(company.global66.encryptedClientSecret, encryptionKey),
    };
  }

  private requireGlobal66EncryptionKey(): string {
    if (!this.global66EncryptionKey) {
      throw new PlatformError("Global66 no está habilitado: falta GLOBAL66_CREDENTIALS_ENCRYPTION_KEY en el servidor", 503);
    }
    return this.global66EncryptionKey;
  }

  private async global66WalletSnapshot(company: CompanyRecord): Promise<Global66WalletSnapshot> {
    return this.global66Api.walletSnapshot(this.credentialsFor(company));
  }

  private reconcileGlobal66Transfers(companyId: string, movements: Global66WalletSnapshot["movements"]): void {
    const byId = new Map(movements.map((movement) => [movement.id, movement]));
    for (const transfer of this.global66Transfers) {
      if (transfer.companyId !== companyId || transfer.status !== "PROCESSING" || !transfer.transactionId) continue;
      const movement = byId.get(transfer.transactionId);
      if (!movement) continue;
      const status = movement.status.toUpperCase();
      if (status === "PAID" || status === "COMPLETED" || status === "SUCCESSFUL") {
        transfer.status = "SUCCESSFUL";
        this.updateGlobal66Transfer(transfer);
      } else if (status === "REJECTED" || status === "FAILED") {
        transfer.status = "FAILED";
        this.updateGlobal66Transfer(transfer);
      }
    }
  }

  private reserveGlobal66Transfer(transfer: Global66TransferRecord): boolean {
    return this.store.putIfAbsent("company_global66_transfers", transfer.id, transfer);
  }

  private updateGlobal66Transfer(transfer: Global66TransferRecord): void {
    const index = this.global66Transfers.findIndex((current) => current.id === transfer.id);
    if (index >= 0) this.global66Transfers[index] = transfer;
    this.store.put("company_global66_transfers", transfer.id, transfer);
  }

  private global66TransferView(transfer: Global66TransferRecord): Global66TransferView {
    return {
      id: transfer.id,
      workerName: transfer.workerName,
      externalReferenceId: transfer.externalReferenceId,
      amount: transfer.amount,
      status: transfer.status,
      transactionId: transfer.transactionId,
      createdAt: transfer.createdAt,
    };
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
    "BORRADOR — requiere revisión y aceptación de las partes. No acredita firma, emisión de tarjeta ni apertura de una cuenta bancaria.",
    "",
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
