import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import {
  Global66BusinessApi,
  type Global66Account,
  type Global66Credentials,
  type Global66RemittanceInput,
  type Global66TransferResult,
} from "../../gateways/global66BusinessApi.js";
import { Global66Catalog, type CatalogBank, type CatalogDocument, type CatalogField } from "../../gateways/global66Catalog.js";
import { TuuReports, tuuSaleApproved } from "../../gateways/tuuReports.js";
import { isValidAmount } from "../../money.js";
import type { PlatformStore } from "../../store/db.js";

const MODULE = "remesas";
const QUOTE_MINUTES = 15;
/** TUU inter-app accepts amounts of up to 12 digits; the payment app itself starts at $100. */
const MIN_TOTAL = 100;

export type RemesaStatus =
  | "awaiting_payment" // Quote accepted; the POS has to charge the card.
  | "payment_failed" // TUU did not approve the card or the flow was canceled.
  | "payment_unverified" // The POS reported a payment that TUU reports do not show yet.
  | "funds_hold" // Paid and confirmed. Funds approval window before the Global66 transfer.
  | "pending_review" // Paid, waiting for Operación before sending.
  | "paid" // Paid and confirmed, about to be sent (or a send failed transiently).
  | "processing" // Accepted by Global66.
  | "sent" // Global66 sent it to the destination bank.
  | "successful" // Credited to the beneficiary.
  | "rejected" // Rejected by Global66 or the destination bank.
  | "transfer_failed"; // Global66 refused the payload. The card payment has to be reversed in TUU.

export interface Corridor {
  country: string;
  countryName: string;
  currency: string;
  /** CLP per 1 unit of the destination currency. 0 = not configured. */
  rate: number;
  /** Share of the sent amount kept as conversion cost (0.012 = 1,2 %). */
  conversionPct: number;
  /** Commission charged on top of the sent amount. */
  commissionPct: number;
  commissionFixed: number;
  /** Estimated TUU card fee, shown for the merchant's information. */
  posPct: number;
  /** Own limits in CLP, on top of Global66's limits in USD. */
  minAmount: number;
  maxAmount: number;
  /** Global66 payout route for the destination. */
  routeId: number;
  minUsd: number;
  maxUsd: number;
  /** False when the destination left the Global66 catalog. */
  available: boolean;
  enabled: boolean;
  rateUpdatedAt: string | null;
}

/** What the beneficiary screen needs, taken from the Global66 catalog. */
export interface BeneficiaryForm {
  country: string;
  countryName: string;
  currency: string;
  banks: CatalogBank[];
  accountTypes: Array<{ value: string; label: string }>;
  documents: CatalogDocument[];
  /** Extra address fields the route requires (BANK_TRANSFER schema names). */
  extraFields: Array<{ field: string; label: string; required: boolean; maxLength: number | null }>;
  slaHours: number | null;
}

export interface RemesaQuote {
  country: string;
  currency: string;
  /** CLP the customer sends. */
  sendAmount: number;
  conversionCost: number;
  /** CLP converted by Global66. */
  amountToConvert: number;
  rate: number;
  rateText: string;
  /** Estimated amount the beneficiary receives. Global66 fixes the final amount. */
  receiveAmount: number;
  commission: number;
  serviceFee: number;
  /** CLP charged on the card. */
  total: number;
  posFeeEstimated: number;
  /** Global66 delivery estimate in hours, when known. */
  slaHours: number | null;
  expiresAt: string;
}

export interface Remitter {
  name: string;
  rut: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
}

export interface Beneficiary {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  bankName: string;
  bankId?: number;
  accountType: string;
  accountNumber: string;
  email?: string;
  /** state, postalCode, residenceCity, address, branchCode when the route asks for them. */
  extra?: Record<string, string>;
}

export interface SavedBeneficiary extends Beneficiary {
  id: string;
  country: string;
  remitterRut: string;
  ownerKey: string;
  lastUsedAt: string;
}

export interface RateSource {
  readonly name: string;
  rate(corridor: Corridor): Promise<number>;
}

export interface RemesaEvent {
  status: RemesaStatus;
  at: string;
  detail?: string;
}

export interface Remesa {
  id: string;
  code: string;
  trackingToken: string;
  status: RemesaStatus;
  quote: RemesaQuote;
  remitter: Remitter;
  beneficiary: Beneficiary;
  createdBy: string;
  companyId?: string;
  payment?: {
    sequenceNumber: string;
    serialNumber: string;
    method: string | null;
    reportedAt: string;
    verified: boolean;
    detail?: string;
  };
  global66?: {
    externalReferenceId: string;
    transactionId: string | null;
    status: string;
    destinationAmount: number | null;
    violations: string[];
    lastError?: string;
  };
  reviewedBy?: string;
  /** When the funds approval window ends and the transfer leaves Global66. */
  sendAt?: string;
  /** sendAt plus the Global66 delivery estimate. */
  estimatedArrival?: string | null;
  /** SICR3P Global66 wallet the transfer leaves from. */
  originAccountId?: number;
  /** Held only for lack of Global66 balance: retried automatically. */
  retry?: "balance";
  timeline: RemesaEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface RemesaActor {
  id: string;
  role: string;
  companyId?: string;
}

/**
 * Destinations where Global66 accepts a remitter with BANK_TRANSFER (RaaS docs, "Corredores disponibles").
 * Without RaaS every destination of the catalog is offered.
 */
const RAAS_BANK_TRANSFER = new Set([
  "CO", "BO", "PH", "GT", "MA", "PY", "PE", "DO", "TH", "UY", "VE", "DE", "AU", "AT", "BE", "BG", "CN", "CY",
  "VA", "HR", "DK", "SK", "SI", "ES", "US", "FI", "FR", "GR", "HU", "IN", "IE", "IS", "IT", "LV", "LI", "LT",
  "LU", "MY", "MT", "MC", "ME", "NP", "NO", "NL", "PL", "PT", "PR", "GB", "CZ", "RO", "SM", "SG", "LK", "SE", "VN",
]);

/** Reference rates (CLP per unit) only used in demo mode. Operación sets the real ones. */
const DEMO_RATES: Record<string, number> = { PEN: 274.31, COP: 0.24, VES: 25.4, PYG: 0.125, USD: 950, EUR: 1030 };

/** Catalog field → BANK_TRANSFER beneficiary field. Routing fields belong to other operation types. */
const EXTRA_FIELDS: Record<string, string> = {
  state: "state",
  postCode: "postalCode",
  postalCode: "postalCode",
  residenceCity: "residenceCity",
  city: "residenceCity",
  address: "address",
  branchCode: "branchCode",
};

const STATUS_LABEL: Record<RemesaStatus, string> = {
  awaiting_payment: "Esperando pago en el POS",
  payment_failed: "Pago no aprobado",
  payment_unverified: "Pago en verificación",
  funds_hold: "Aprobación de fondos",
  pending_review: "En revisión",
  paid: "Pago aprobado",
  processing: "Conversión en proceso",
  sent: "Enviado al banco",
  successful: "Recibido por el beneficiario",
  rejected: "Rechazado",
  transfer_failed: "Envío no aceptado",
};

/**
 * Remesas: the POS TUU app charges the card (inter-app) and the platform sends the
 * converted amount through the Global66 transactional API.
 * Money only leaves after TUU reports confirm the card payment.
 */
export class RemesasModule {
  readonly id = MODULE;
  readonly label = "Remesas";
  private readonly corridors = new Map<string, Corridor>();
  private readonly remesas = new Map<string, Remesa>();
  private readonly tuu: TuuReports;
  private readonly global66: Global66BusinessApi;
  private readonly catalog: Global66Catalog;
  /** Demo progress of a Global66 transfer: processing → sent → successful. */
  private readonly demoSteps = new Map<string, number>();
  private syncedAt = 0;
  private readonly now: () => number;
  private processing = false;
  /** Where the customer rate comes from. Manual today; a Global66 quote endpoint can replace it. */
  private readonly rates: RateSource = { name: "manual", rate: async (corridor) => corridor.rate };

  constructor(
    private readonly config: AppConfig,
    private readonly store: PlatformStore,
    deps: { tuu?: TuuReports; global66?: Global66BusinessApi; catalog?: Global66Catalog; now?: () => number } = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.tuu = deps.tuu ?? new TuuReports(config.remesas.tuuApiKey);
    this.global66 = deps.global66 ?? new Global66BusinessApi();
    this.catalog = deps.catalog ?? new Global66Catalog(config.remesas.global66CatalogUrl, store);
    for (const corridor of store.list<Corridor>("remesas_corridors")) this.corridors.set(corridor.country, corridor);
    for (const remesa of store.list<Remesa>("remesas")) this.remesas.set(remesa.id, remesa);
  }

  /**
   * Brings destinations from the Global66 catalog. New ones start disabled without a rate
   * (demo mode uses reference rates). Operación's rates and fees are kept.
   */
  async syncCatalog(force = false): Promise<void> {
    if (!force && Date.now() - this.syncedAt < 10 * 60 * 1000 && this.corridors.size) return;
    const routes = await this.catalog.routes();
    if (!routes.length) return;
    const seen = new Set<string>();
    const demo = !this.config.production;
    for (const route of routes) {
      if (this.config.remesas.raas && !RAAS_BANK_TRANSFER.has(route.country)) continue;
      if (seen.has(route.country)) continue;
      seen.add(route.country);
      const current = this.corridors.get(route.country);
      const demoRate = demo ? DEMO_RATES[route.currency] ?? 0 : 0;
      const corridor: Corridor = current
        ? { ...current, routeId: route.routeId, currency: route.currency, countryName: route.countryName, minUsd: route.minUsd, maxUsd: route.maxUsd, available: true }
        : {
            country: route.country,
            countryName: route.countryName,
            currency: route.currency,
            rate: demoRate,
            conversionPct: 0.012,
            commissionPct: 0.03,
            commissionFixed: 0,
            posPct: 0.0076,
            minAmount: 10_000,
            maxAmount: 5_000_000,
            routeId: route.routeId,
            minUsd: route.minUsd,
            maxUsd: route.maxUsd,
            available: true,
            enabled: demoRate > 0,
            rateUpdatedAt: demoRate > 0 ? new Date().toISOString() : null,
          };
      this.corridors.set(corridor.country, corridor);
      this.store.put("remesas_corridors", corridor.country, corridor);
    }
    for (const corridor of this.corridors.values()) {
      if (seen.has(corridor.country) || !corridor.available) continue;
      corridor.available = false;
      this.store.put("remesas_corridors", corridor.country, corridor);
    }
    this.syncedAt = Date.now();
  }

  /** Beneficiary fields, banks and document types for a destination, from Global66. */
  async form(country: string): Promise<BeneficiaryForm> {
    await this.syncCatalog();
    const corridor = this.usable(country);
    const [fields, documents] = await Promise.all([this.catalog.fields(corridor.routeId), this.catalog.documents(corridor.country)]);
    const routes = await this.catalog.routes();
    const banks = routes.find((route) => route.routeId === corridor.routeId)?.banks ?? [];
    const accountField = fields.find((field) => field.field === "accountType");
    const accountTypes = accountField?.options.length
      ? accountField.options.map((option) => ({ value: option.value.toUpperCase(), label: option.label }))
      : [
          { value: "SAVING", label: "Cuenta de ahorro" },
          { value: "CHECKING", label: "Cuenta corriente" },
        ];
    return {
      country: corridor.country,
      countryName: corridor.countryName,
      currency: corridor.currency,
      banks: [...banks].sort((a, b) => a.name.localeCompare(b.name, "es")),
      accountTypes,
      documents,
      extraFields: extraFields(fields),
      slaHours: null,
    };
  }

  /** Modes the POS app and the panel need to know about. */
  settings() {
    return {
      tuuVerification: this.tuu.configured ? "live" : "demo",
      global66: this.global66Credentials() ? "live" : "demo",
      raas: this.config.remesas.raas,
      autoSendMax: this.config.remesas.autoSendMax ?? null,
      tuuPackage: this.config.production ? "com.haulmer.paymentapp" : "com.haulmer.paymentapp.dev",
    };
  }

  async listCorridors(includeDisabled = false): Promise<Corridor[]> {
    await this.syncCatalog();
    return [...this.corridors.values()]
      .filter((corridor) => includeDisabled || (corridor.available && corridor.enabled && corridor.rate > 0))
      .sort((a, b) => a.countryName.localeCompare(b.countryName, "es"));
  }

  async updateCorridor(country: string, input: Partial<Corridor>): Promise<Corridor> {
    await this.syncCatalog();
    const current = this.corridors.get(country.toUpperCase());
    if (!current) throw new PlatformError(`Corredor desconocido: ${country}`, 404);
    const next: Corridor = { ...current };
    if (input.rate !== undefined) {
      if (!Number.isFinite(input.rate) || input.rate < 0) throw new PlatformError("La tasa tiene que ser un número positivo", 400);
      next.rate = input.rate;
      next.rateUpdatedAt = new Date().toISOString();
    }
    for (const key of ["conversionPct", "commissionPct", "posPct"] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0 || value >= 0.5) throw new PlatformError(`${key} tiene que estar entre 0 y 0,5`, 400);
      next[key] = value;
    }
    for (const key of ["commissionFixed", "minAmount", "maxAmount"] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value) || value < 0) throw new PlatformError(`${key} tiene que ser un entero positivo`, 400);
      next[key] = value;
    }
    if (input.enabled !== undefined) next.enabled = Boolean(input.enabled);
    if (next.minAmount > next.maxAmount) throw new PlatformError("El mínimo no puede superar al máximo", 400);
    if (next.enabled && next.rate <= 0) throw new PlatformError("Define la tasa antes de habilitar el corredor", 400);
    this.corridors.set(next.country, next);
    this.store.put("remesas_corridors", next.country, next);
    return next;
  }

  async quote(input: { country: string; sendAmount: number }): Promise<RemesaQuote> {
    await this.syncCatalog();
    const corridor = this.usable(input.country);
    const rate = await this.rates.rate(corridor);
    if (!(rate > 0)) throw new PlatformError("Ese país no tiene tasa vigente", 400);
    const sendAmount = input.sendAmount;
    if (!isValidAmount(sendAmount)) throw new PlatformError("El monto a enviar debe ser un entero positivo", 400);
    if (sendAmount < corridor.minAmount || sendAmount > corridor.maxAmount) {
      throw new PlatformError(
        `El monto tiene que estar entre ${formatClp(corridor.minAmount)} y ${formatClp(corridor.maxAmount)}`,
        400,
      );
    }
    const conversionCost = Math.round(sendAmount * corridor.conversionPct);
    const amountToConvert = sendAmount - conversionCost;
    const commission = Math.round(sendAmount * corridor.commissionPct) + corridor.commissionFixed;
    const serviceFee = 0;
    const total = sendAmount + commission + serviceFee;
    if (total < MIN_TOTAL || total > 999_999_999_999) throw new PlatformError("El total queda fuera del rango del POS", 400);
    // Global66 limits are in USD. They apply when Operación has a USD rate.
    const usdRate = this.corridors.get("US")?.rate ?? 0;
    if (usdRate > 0) {
      const usd = amountToConvert / usdRate;
      if (corridor.minUsd && usd < corridor.minUsd) {
        throw new PlatformError(`Global66 pide al menos USD ${corridor.minUsd} para ${corridor.countryName}`, 400);
      }
      if (corridor.maxUsd && usd > corridor.maxUsd) {
        throw new PlatformError(`Global66 acepta hasta USD ${corridor.maxUsd.toLocaleString("es-CL")} para ${corridor.countryName}`, 400);
      }
    }
    const receiveAmount = Math.floor((amountToConvert / rate) * 100) / 100;
    const slaHours = await this.catalog.slaHours(corridor.country, corridor.currency, receiveAmount);
    return {
      country: corridor.country,
      currency: corridor.currency,
      sendAmount,
      conversionCost,
      amountToConvert,
      rate,
      rateText: `1 ${corridor.currency} = ${rate.toLocaleString("es-CL", { maximumFractionDigits: 4 })} CLP`,
      receiveAmount,
      commission,
      serviceFee,
      total,
      posFeeEstimated: Math.round(total * corridor.posPct),
      slaHours,
      expiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
    };
  }

  async create(input: {
    country: string;
    sendAmount: number;
    remitter: Remitter;
    beneficiary: Beneficiary;
    actor: RemesaActor;
  }): Promise<{ remesa: Remesa; tuuPayment: Record<string, unknown> }> {
    const quote = await this.quote(input);
    const remitter = cleanRemitter(input.remitter);
    const beneficiary = cleanBeneficiary(input.beneficiary, await this.form(quote.country));
    const now = new Date().toISOString();
    const remesa: Remesa = {
      id: `rem_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      code: this.nextCode(),
      trackingToken: randomBytes(16).toString("hex"),
      status: "awaiting_payment",
      quote,
      remitter,
      beneficiary,
      createdBy: input.actor.id,
      companyId: input.actor.companyId,
      timeline: [{ status: "awaiting_payment", at: now }],
      createdAt: now,
      updatedAt: now,
    };
    this.save(remesa);
    this.rememberBeneficiary(remesa, input.actor);
    return { remesa, tuuPayment: this.tuuPayment(remesa) };
  }

  /** Beneficiaries this company already sent to for a remitter ("Mis beneficiarios"). */
  savedBeneficiaries(actor: RemesaActor, remitterRut: string, country?: string): SavedBeneficiary[] {
    const rut = normalizeRut(remitterRut);
    if (!rut) return [];
    const owner = ownerKey(actor);
    return this.store
      .list<SavedBeneficiary>("remesas_beneficiaries")
      .filter((item) => item.ownerKey === owner && item.remitterRut === rut && (!country || item.country === country.toUpperCase()))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  private rememberBeneficiary(remesa: Remesa, actor: RemesaActor): void {
    const owner = ownerKey(actor);
    const id = createHash("sha256")
      .update([owner, remesa.remitter.rut, remesa.quote.country, remesa.beneficiary.accountNumber].join("\0"))
      .digest("hex")
      .slice(0, 24);
    const saved: SavedBeneficiary = {
      ...remesa.beneficiary,
      id,
      country: remesa.quote.country,
      remitterRut: remesa.remitter.rut,
      ownerKey: owner,
      lastUsedAt: remesa.createdAt,
    };
    this.store.put("remesas_beneficiaries", id, saved);
  }

  private usable(country: string): Corridor {
    const corridor = this.corridors.get(String(country).toUpperCase());
    if (!corridor || !corridor.available || !corridor.enabled || corridor.rate <= 0) {
      throw new PlatformError("Ese país no está disponible para remesas", 400);
    }
    return corridor;
  }

  /** The JSON the POS app passes to the TUU payment app (Intent.EXTRA_TEXT). */
  tuuPayment(remesa: Remesa): Record<string, unknown> {
    return {
      amount: remesa.quote.total,
      tip: 0,
      cashback: 0,
      method: 0,
      installmentsQuantity: 0,
      printVoucherOnApp: true,
      dteType: this.config.remesas.tuuDteType,
      extraData: {
        taxIdnValidation: "",
        // The remitted amount is not a sale: only the commission is taxed on the boleta.
        exemptAmount: this.config.remesas.dteExempt === "send" && this.config.remesas.tuuDteType !== 0 ? remesa.quote.sendAmount : 0,
        netAmount: 0,
        sourceName: "instripe remesas",
        sourceVersion: "1",
        customFields: [
          // TUU rejects "&" and "/" in custom fields.
          { name: "Remesa", value: tuuText(remesa.code), print: true },
          { name: "Destino", value: tuuText(`${remesa.quote.receiveAmount} ${remesa.quote.currency}`), print: true },
        ],
      },
    };
  }

  list(actor: RemesaActor): Remesa[] {
    return [...this.remesas.values()]
      .filter((remesa) => this.canSee(remesa, actor))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string, actor: RemesaActor): Remesa {
    const remesa = this.remesas.get(id);
    if (!remesa || !this.canSee(remesa, actor)) throw new PlatformError("Remesa no encontrada", 404);
    return remesa;
  }

  /**
   * Result of the TUU payment app, reported by the POS. Money only moves after TUU
   * reports show the same sale (or Operación approves it).
   */
  async reportPayment(
    id: string,
    actor: RemesaActor,
    input: { approved: boolean; sequenceNumber?: string; serialNumber?: string; method?: string; errorMessage?: string },
  ): Promise<Remesa> {
    const remesa = this.get(id, actor);
    if (remesa.status !== "awaiting_payment" && remesa.status !== "payment_failed") return remesa;
    if (!input.approved) {
      this.transition(remesa, "payment_failed", input.errorMessage?.slice(0, 200) || "El POS no aprobó el pago");
      return remesa;
    }
    const sequenceNumber = String(input.sequenceNumber ?? "").trim();
    const serialNumber = String(input.serialNumber ?? "").trim();
    if (!/^\d{1,20}$/.test(sequenceNumber)) throw new PlatformError("Falta el número de secuencia del pago TUU", 400);
    if (!serialNumber) throw new PlatformError("Falta el número de serie del POS", 400);
    const duplicate = [...this.remesas.values()].find(
      (other) => other.id !== remesa.id && other.payment?.sequenceNumber === sequenceNumber && other.payment.serialNumber === serialNumber,
    );
    if (duplicate) throw new PlatformError("Ese pago TUU ya está asociado a otra remesa", 409);
    remesa.payment = {
      sequenceNumber,
      serialNumber,
      method: input.method ? String(input.method).slice(0, 30) : null,
      reportedAt: new Date().toISOString(),
      verified: false,
    };
    this.transition(remesa, "payment_unverified");
    await this.verifyPayment(remesa);
    return remesa;
  }

  /** Re-checks the pending step: the TUU sale or the Global66 transfer. */
  async refresh(id: string, actor: RemesaActor): Promise<Remesa> {
    const remesa = this.get(id, actor);
    if (remesa.status === "payment_unverified") await this.verifyPayment(remesa);
    else if (this.due(remesa)) await this.release(remesa);
    else if (remesa.status === "paid") await this.send(remesa);
    else if (remesa.status === "processing" || remesa.status === "sent") await this.pollGlobal66(remesa);
    return remesa;
  }

  /** Operación releases a remittance held for review, or sends one whose payment was confirmed by hand. */
  async approve(id: string, actor: RemesaActor): Promise<Remesa> {
    if (actor.role !== "operacion") throw new PlatformError("Solo Operación puede aprobar una remesa", 403);
    const remesa = this.get(id, actor);
    if (remesa.status !== "pending_review" && remesa.status !== "payment_unverified") {
      throw new PlatformError("Esa remesa no está esperando revisión", 409);
    }
    if (remesa.createdBy === actor.id) throw new PlatformError("Otro usuario de Operación tiene que aprobarla", 403);
    if (remesa.payment) remesa.payment.verified = true;
    remesa.reviewedBy = actor.id;
    await this.release(remesa, { skipTuu: true, detail: "Aprobada por Operación" });
    return remesa;
  }

  /** Operación sends a remittance before its funds approval window ends. */
  async sendNow(id: string, actor: RemesaActor): Promise<Remesa> {
    if (actor.role !== "operacion") throw new PlatformError("Solo Operación puede adelantar un envío", 403);
    const remesa = this.get(id, actor);
    if (remesa.status !== "funds_hold") throw new PlatformError("Esa remesa no está en aprobación de fondos", 409);
    if (remesa.createdBy === actor.id) throw new PlatformError("Otro usuario de Operación tiene que adelantarla", 403);
    remesa.reviewedBy = actor.id;
    await this.release(remesa, { detail: "Enviada antes por Operación" });
    return remesa;
  }

  /** Operación stops a remittance before it leaves (for example, the card payment was voided in TUU). */
  hold(id: string, actor: RemesaActor, reason: string): Remesa {
    if (actor.role !== "operacion") throw new PlatformError("Solo Operación puede retener una remesa", 403);
    const remesa = this.get(id, actor);
    if (remesa.status !== "funds_hold" && !(remesa.status === "pending_review" && remesa.retry)) {
      throw new PlatformError("Solo se retiene una remesa que todavía no salió", 409);
    }
    delete remesa.retry;
    this.transition(remesa, "pending_review", `Retenida por Operación: ${reason.trim().slice(0, 200) || "sin motivo"}`);
    return remesa;
  }

  /** Sends every remittance whose funds approval window ended. Called by the scheduler every minute. */
  async processDue(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    let released = 0;
    try {
      for (const remesa of [...this.remesas.values()]) {
        if (!this.due(remesa)) continue;
        await this.release(remesa);
        released += 1;
      }
    } finally {
      this.processing = false;
    }
    return released;
  }

  /** Available balance of the SICR3P Global66 wallet the remittances leave from. */
  async balance(): Promise<{ mode: "live" | "demo"; walletId: number | null; currency: string; balance: number | null; alias: string | null }> {
    const credentials = this.global66Credentials();
    if (!credentials) return { mode: "demo", walletId: null, currency: "CLP", balance: null, alias: null };
    const wallet = await this.wallet(credentials);
    return { mode: "live", walletId: wallet?.walletId ?? null, currency: "CLP", balance: wallet?.balance ?? null, alias: wallet?.alias ?? null };
  }

  /** Global66 remittance webhook. Returns false when the key does not match. */
  handleWebhook(apiKey: string | undefined, body: unknown): boolean {
    const expected = this.config.remesas.global66WebhookApiKey;
    if (!expected || !apiKey || !safeEqual(apiKey, expected)) return false;
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>).payload : undefined;
    if (!payload || typeof payload !== "object") return true;
    const data = payload as Record<string, unknown>;
    const transactionId = data.transactionId === undefined ? "" : String(data.transactionId);
    const remesa = [...this.remesas.values()].find((item) => item.global66?.transactionId === transactionId);
    if (!remesa?.global66) return true;
    const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
    if (typeof data.destinyAmount === "number") remesa.global66.destinationAmount = data.destinyAmount;
    remesa.global66.status = status || remesa.global66.status;
    if (status === "sent") this.transition(remesa, "sent");
    else if (status === "successful") this.transition(remesa, "successful");
    else if (status === "rejected") this.transition(remesa, "rejected", "Global66 informó el rechazo");
    else this.save(remesa);
    return true;
  }

  /** Public view behind the voucher QR. No document numbers and only the last account digits. */
  tracking(token: string) {
    const remesa = [...this.remesas.values()].find(
      (item) => item.trackingToken.length === token.length && safeEqual(item.trackingToken, token),
    );
    if (!remesa) throw new PlatformError("Seguimiento no encontrado", 404);
    return {
      code: remesa.code,
      status: remesa.status,
      statusLabel: STATUS_LABEL[remesa.status],
      createdAt: remesa.createdAt,
      receiveAmount: remesa.global66?.destinationAmount ?? remesa.quote.receiveAmount,
      receiveEstimated: remesa.global66?.destinationAmount == null,
      currency: remesa.quote.currency,
      country: remesa.quote.country,
      beneficiary: `${remesa.beneficiary.firstName} ${remesa.beneficiary.lastName.charAt(0)}.`.trim(),
      bank: remesa.beneficiary.bankName,
      account: maskAccount(remesa.beneficiary.accountNumber),
      sendAt: remesa.sendAt ?? null,
      estimatedArrival: remesa.estimatedArrival ?? null,
      timeline: remesa.timeline.map((event) => ({ ...event, label: STATUS_LABEL[event.status] })),
    };
  }

  /** Rows for accounting: what was charged, kept and converted for each remittance. */
  exportCsv(actor: RemesaActor): string {
    const header = [
      "fecha", "codigo", "estado", "remitente", "rut_remitente", "pais", "moneda",
      "monto_enviado_clp", "costo_conversion_clp", "monto_convertido_clp", "comision_clp", "total_cobrado_clp",
      "comision_pos_estimada_clp", "tasa_clp", "monto_destino_estimado", "monto_destino_global66",
      "secuencia_tuu", "pos_serie", "transaccion_global66", "salida_global66", "llegada_estimada",
    ];
    const rows = this.list(actor).map((remesa) => [
      remesa.createdAt, remesa.code, remesa.status, remesa.remitter.name, remesa.remitter.rut,
      remesa.quote.country, remesa.quote.currency, remesa.quote.sendAmount, remesa.quote.conversionCost,
      remesa.quote.amountToConvert, remesa.quote.commission, remesa.quote.total, remesa.quote.posFeeEstimated,
      remesa.quote.rate, remesa.quote.receiveAmount, remesa.global66?.destinationAmount ?? "",
      remesa.payment?.sequenceNumber ?? "", remesa.payment?.serialNumber ?? "", remesa.global66?.transactionId ?? "",
      remesa.sendAt ?? "", remesa.estimatedArrival ?? "",
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }

  statusLabel(status: RemesaStatus): string {
    return STATUS_LABEL[status];
  }

  private async verifyPayment(remesa: Remesa): Promise<void> {
    const payment = remesa.payment;
    if (!payment) return;
    if (!this.tuu.configured) {
      if (this.config.production) {
        this.transition(remesa, "pending_review", "Sin TUU_API_KEY el pago se confirma a mano");
        return;
      }
      payment.verified = true;
      payment.detail = "Demo: pago sin verificar en TUU";
      await this.afterPaid(remesa);
      return;
    }
    let sale;
    try {
      sale = await this.tuu.findSale({
        serialNumber: payment.serialNumber,
        sequenceNumber: payment.sequenceNumber,
        date: chileDate(payment.reportedAt),
      });
    } catch (error) {
      payment.detail = error instanceof Error ? error.message : "No se pudo consultar TUU";
      this.save(remesa);
      return;
    }
    if (!sale) {
      payment.detail = "TUU todavía no muestra la venta";
      this.save(remesa);
      return;
    }
    if (sale.amount !== remesa.quote.total || !tuuSaleApproved(sale)) {
      payment.detail = `TUU informa ${sale.status} por ${formatClp(sale.amount)}`;
      this.transition(remesa, "pending_review", "La venta TUU no coincide con la remesa");
      return;
    }
    payment.verified = true;
    payment.method = sale.typeTransaction ?? payment.method;
    payment.detail = "Venta confirmada en TUU";
    await this.afterPaid(remesa);
  }

  /** Confirmed card payment: the funds approval window starts. */
  private async afterPaid(remesa: Remesa): Promise<void> {
    const sendAt = this.now() + this.config.remesas.sendDelayMinutes * 60_000;
    remesa.sendAt = new Date(sendAt).toISOString();
    const sla = remesa.quote.slaHours;
    remesa.estimatedArrival = sla ? new Date(sendAt + sla * 3_600_000).toISOString() : null;
    this.transition(remesa, "funds_hold", `Sale de Global66 a las ${chileTime(remesa.sendAt)}`);
    if (this.config.remesas.sendDelayMinutes === 0) await this.release(remesa);
  }

  private due(remesa: Remesa): boolean {
    const ready = remesa.status === "funds_hold" || (remesa.status === "pending_review" && remesa.retry === "balance");
    return ready && Date.parse(remesa.sendAt ?? "") <= this.now();
  }

  /**
   * End of the funds approval window: the TUU sale still approved, the automatic limit and
   * the SICR3P wallet balance. Then the transfer leaves Global66.
   */
  private async release(remesa: Remesa, options: { skipTuu?: boolean; detail?: string } = {}): Promise<void> {
    delete remesa.retry;
    const payment = remesa.payment;
    if (!payment?.verified) return;
    if (this.tuu.configured && !options.skipTuu) {
      try {
        const sale = await this.tuu.findSale({
          serialNumber: payment.serialNumber,
          sequenceNumber: payment.sequenceNumber,
          date: chileDate(payment.reportedAt),
        });
        if (!sale || sale.amount !== remesa.quote.total || !tuuSaleApproved(sale)) {
          this.transition(remesa, "pending_review", "La venta TUU ya no figura aprobada (¿anulada?)");
          return;
        }
      } catch (error) {
        remesa.retry = "balance";
        payment.detail = error instanceof Error ? error.message : "No se pudo consultar TUU";
        this.transition(remesa, "pending_review", "No se pudo confirmar la venta en TUU; se reintenta");
        return;
      }
    }
    const limit = this.config.remesas.autoSendMax;
    if (!remesa.reviewedBy && limit !== undefined && remesa.quote.total > limit) {
      this.transition(remesa, "pending_review", `Supera el envío automático de ${formatClp(limit)}`);
      return;
    }
    const credentials = this.global66Credentials();
    if (credentials) {
      let wallet: Global66Account | undefined;
      try {
        wallet = await this.wallet(credentials);
      } catch (error) {
        remesa.retry = "balance";
        this.transition(remesa, "pending_review", error instanceof Error ? error.message : "No se pudo consultar el saldo en Global66");
        return;
      }
      if (!wallet) {
        remesa.retry = "balance";
        this.transition(remesa, "pending_review", "No se encontró la wallet CLP de Global66 SICR3P");
        return;
      }
      if (wallet.balance < remesa.quote.amountToConvert) {
        remesa.retry = "balance";
        this.transition(remesa, "pending_review", `Saldo insuficiente en Global66 SICR3P (${formatClp(Math.floor(wallet.balance))}); se reintenta`);
        return;
      }
      remesa.originAccountId = wallet.walletId;
    }
    this.transition(remesa, "paid", options.detail ?? "Fondos aprobados");
    await this.send(remesa);
  }

  private async wallet(credentials: Global66Credentials): Promise<Global66Account | undefined> {
    const accounts = (await this.global66.accounts(credentials)).filter((account) => account.currency === "CLP");
    const configured = this.config.remesas.global66AccountId;
    if (configured) return accounts.find((account) => String(account.walletId) === configured);
    return (
      accounts.find((account) => /sicr3?p/i.test(account.alias ?? "")) ??
      accounts.find((account) => account.isPrincipal) ??
      accounts[0]
    );
  }

  private async send(remesa: Remesa): Promise<void> {
    if (remesa.status !== "paid" || !remesa.payment?.verified) return;
    const externalReferenceId = remesa.code;
    const input: Global66RemittanceInput = {
      externalReferenceId,
      amount: remesa.quote.amountToConvert,
      originCurrency: "CLP",
      destinationCurrency: remesa.quote.currency,
      purposeCode: [this.config.remesas.global66PurposeCode],
      beneficiaryName: remesa.beneficiary.firstName,
      beneficiaryLastName: remesa.beneficiary.lastName,
      countryCode: remesa.quote.country,
      accountType: remesa.beneficiary.accountType,
      accountNumber: remesa.beneficiary.accountNumber,
      documentNumber: remesa.beneficiary.documentNumber,
      documentType: remesa.beneficiary.documentType,
      bankId: remesa.beneficiary.bankId,
      ...(remesa.originAccountId !== undefined ? { originAccountId: remesa.originAccountId } : {}),
      beneficiaryExtra: remesa.beneficiary.extra,
      description: `Remesa ${remesa.code}`,
      ...(this.config.remesas.raas
        ? {
            remitter: {
              name: remesa.remitter.name,
              identificationType: "RUT",
              identificationNumber: remesa.remitter.rut,
              countryCode: "CL",
              ...(remesa.remitter.phone ? { contactNumber: remesa.remitter.phone } : {}),
              ...(remesa.remitter.email ? { email: remesa.remitter.email } : {}),
              ...(remesa.remitter.address ? { address: remesa.remitter.address } : {}),
              ...(remesa.remitter.city ? { city: remesa.remitter.city } : {}),
            },
          }
        : {}),
    };

    const credentials = this.global66Credentials();
    let result: Global66TransferResult;
    try {
      result = credentials
        ? await this.global66.createRemittance(credentials, input)
        : {
            externalReferenceId,
            transactionId: String(Date.now()).slice(-8),
            status: "PROCESSING",
            valid: true,
            violations: [],
          };
    } catch (error) {
      const status = error instanceof PlatformError ? error.status : 502;
      const message = error instanceof Error ? error.message : "Error al enviar a Global66";
      if (status === 409) {
        // Same externalReferenceId already submitted: look it up instead of sending twice.
        remesa.global66 = { externalReferenceId, transactionId: null, status: "PROCESSING", destinationAmount: null, violations: [] };
        this.transition(remesa, "processing", "Global66 ya tenía este envío");
        await this.pollGlobal66(remesa);
        return;
      }
      remesa.global66 = {
        externalReferenceId,
        transactionId: null,
        status: "ERROR",
        destinationAmount: null,
        violations: [],
        lastError:
          status === 403
            ? "Global66 no habilitó el envío con remitente (RaaS) para esta empresa"
            : message,
      };
      if (status === 403) this.transition(remesa, "transfer_failed", remesa.global66.lastError);
      else this.save(remesa); // Transient: stays "paid" and Actualizar retries with the same reference.
      return;
    }
    remesa.global66 = {
      externalReferenceId,
      transactionId: result.transactionId,
      status: result.status,
      destinationAmount: null,
      violations: result.violations,
    };
    if (result.valid) {
      if (!credentials) this.demoSteps.set(remesa.id, 0);
      this.transition(remesa, "processing");
    } else {
      this.transition(remesa, "transfer_failed", result.violations.join("; ").slice(0, 300) || "Global66 rechazó los datos");
    }
  }

  private async pollGlobal66(remesa: Remesa): Promise<void> {
    if (!remesa.global66) return;
    const credentials = this.global66Credentials();
    if (!credentials) {
      const step = (this.demoSteps.get(remesa.id) ?? 0) + 1;
      this.demoSteps.set(remesa.id, step);
      if (step === 1) this.transition(remesa, "sent");
      else {
        remesa.global66.destinationAmount = remesa.quote.receiveAmount;
        this.transition(remesa, "successful");
      }
      return;
    }
    try {
      const detail = await this.global66.transactionDetail(credentials, remesa.global66.externalReferenceId);
      remesa.global66.transactionId = remesa.global66.transactionId ?? detail.transactionId;
      remesa.global66.status = detail.status ?? detail.apiStatus;
      if (detail.destinationAmount !== null) remesa.global66.destinationAmount = detail.destinationAmount;
      if (detail.apiStatus === "FAILED") this.transition(remesa, "rejected", "Global66 informó el rechazo");
      else if (detail.apiStatus === "COMPLETED" && remesa.status === "processing") this.transition(remesa, "sent");
      else this.save(remesa);
    } catch (error) {
      remesa.global66.lastError = error instanceof Error ? error.message : "No se pudo consultar Global66";
      this.save(remesa);
    }
  }

  private global66Credentials(): Global66Credentials | undefined {
    const { global66ClientId, global66ClientSecret } = this.config.remesas;
    if (!global66ClientId || !global66ClientSecret) return undefined;
    return { clientId: global66ClientId, clientSecret: global66ClientSecret, accountId: "" };
  }

  private canSee(remesa: Remesa, actor: RemesaActor): boolean {
    if (actor.role === "operacion") return true;
    if (actor.companyId && remesa.companyId === actor.companyId) return true;
    return remesa.createdBy === actor.id;
  }

  private transition(remesa: Remesa, status: RemesaStatus, detail?: string): void {
    const now = new Date().toISOString();
    if (remesa.status !== status) remesa.timeline.push({ status, at: now, ...(detail ? { detail } : {}) });
    remesa.status = status;
    remesa.updatedAt = now;
    this.save(remesa);
  }

  private save(remesa: Remesa): void {
    this.remesas.set(remesa.id, remesa);
    this.store.put("remesas", remesa.id, remesa);
  }

  private nextCode(): string {
    const year = new Date().getFullYear();
    const key = `seq_${year}`;
    const current = this.store.get<{ value: number }>("remesas_meta", key)?.value ?? 0;
    const value = current + 1;
    this.store.put("remesas_meta", key, { value });
    return `CR-${year}-${String(value).padStart(6, "0")}`;
  }
}

function cleanRemitter(input: Remitter): Remitter {
  const name = String(input?.name ?? "").trim();
  const rut = normalizeRut(String(input?.rut ?? ""));
  if (!name || name.length > 255) throw new PlatformError("El nombre del remitente es requerido", 400);
  if (!rut) throw new PlatformError("El RUT del remitente no es válido", 400);
  const email = String(input?.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError("El correo del remitente no es válido", 400);
  return {
    name,
    rut,
    ...(input?.phone ? { phone: String(input.phone).trim().slice(0, 50) } : {}),
    ...(email ? { email: email.slice(0, 100) } : {}),
    ...(input?.address ? { address: String(input.address).trim().slice(0, 255) } : {}),
    ...(input?.city ? { city: String(input.city).trim().slice(0, 100) } : {}),
  };
}

/** Validates the beneficiary against the Global66 form of the route. */
function cleanBeneficiary(input: Beneficiary, form: BeneficiaryForm): Beneficiary {
  const value = (raw: unknown, max: number) => String(raw ?? "").trim().slice(0, max);
  const firstName = value(input?.firstName, 100);
  const lastName = value(input?.lastName, 100);
  if (!firstName || !lastName) throw new PlatformError("Nombre y apellido del beneficiario son requeridos", 400);

  const accountType = value(input?.accountType, 20).toUpperCase();
  if (!form.accountTypes.some((option) => option.value === accountType)) {
    throw new PlatformError(`Tipo de cuenta no válido para ${form.countryName}`, 400);
  }
  const accountNumber = value(input?.accountNumber, 50).replace(/\s+/g, "");
  if (!/^[0-9A-Za-z-]{4,50}$/.test(accountNumber)) throw new PlatformError("El número de cuenta no es válido", 400);

  let bankId: number | undefined;
  let bankName = value(input?.bankName, 50);
  if (form.banks.length) {
    const bank = form.banks.find((item) => item.id === Number(input?.bankId));
    if (!bank) throw new PlatformError(`Elige un banco de ${form.countryName}`, 400);
    bankId = bank.id;
    bankName = bank.name.slice(0, 50);
  } else if (!bankName) {
    throw new PlatformError("El banco del beneficiario es requerido", 400);
  }

  const documentType = value(input?.documentType, 20).toUpperCase();
  const documentNumber = value(input?.documentNumber, 30).replace(/[\s.]/g, "");
  if (!documentType || !documentNumber) throw new PlatformError("El documento del beneficiario es requerido", 400);
  if (form.documents.length) {
    const document = form.documents.find((item) => item.value.toUpperCase() === documentType);
    if (!document) throw new PlatformError(`Tipo de documento no válido para ${form.countryName}`, 400);
    const tooShort = document.minSize !== null && documentNumber.length < document.minSize;
    const tooLong = document.maxSize !== null && documentNumber.length > document.maxSize;
    if (tooShort || tooLong || !matches(document.pattern, documentNumber)) {
      throw new PlatformError(`El ${document.label} no tiene el formato que pide Global66`, 400);
    }
  }

  const extra: Record<string, string> = {};
  const given = (input?.extra ?? {}) as Record<string, unknown>;
  for (const field of form.extraFields) {
    const text = value(given[field.field], field.maxLength ?? 200);
    if (field.required && !text) throw new PlatformError(`${field.label} es requerido`, 400);
    if (text) extra[field.field] = text;
  }

  const beneficiary: Beneficiary = { firstName, lastName, documentType, documentNumber, bankName, accountType, accountNumber };
  if (bankId !== undefined) beneficiary.bankId = bankId;
  if (Object.keys(extra).length) beneficiary.extra = extra;
  const email = value(input?.email, 100);
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError("El correo del beneficiario no es válido", 400);
    beneficiary.email = email;
  }
  return beneficiary;
}

function extraFields(fields: CatalogField[]): BeneficiaryForm["extraFields"] {
  const result: BeneficiaryForm["extraFields"] = [];
  for (const field of fields) {
    const name = EXTRA_FIELDS[field.field];
    if (!name || result.some((item) => item.field === name)) continue;
    result.push({ field: name, label: field.label, required: field.required, maxLength: field.maxLength });
  }
  return result;
}

/** Global66 patterns come from its catalog. A bad pattern does not block the form. */
function matches(pattern: string | null, text: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return true;
  }
}

function ownerKey(actor: RemesaActor): string {
  return actor.companyId ? `company:${actor.companyId}` : `user:${actor.id}`;
}

/** Returns the RUT as 12345678-9 when the check digit is right, or an empty string. */
export function normalizeRut(value: string): string {
  const clean = value.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(clean)) return "";
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0;
  let factor = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
  return expected === dv ? `${body}-${dv}` : "";
}

function tuuText(value: string): string {
  return value.replace(/[&/]/g, " ").slice(0, 200);
}

function maskAccount(account: string): string {
  return account.length <= 4 ? account : `••••${account.slice(-4)}`;
}

function formatClp(amount: number): string {
  return `$${amount.toLocaleString("es-CL")}`;
}

function chileTime(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function chileDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(iso));
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
