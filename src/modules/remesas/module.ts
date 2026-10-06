import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import {
  Global66BusinessApi,
  type Global66Credentials,
  type Global66RemittanceInput,
  type Global66TransferResult,
} from "../../gateways/global66BusinessApi.js";
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
  minAmount: number;
  maxAmount: number;
  accountTypes: string[];
  documentTypes: string[];
  enabled: boolean;
  rateUpdatedAt: string | null;
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
  timeline: RemesaEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface RemesaActor {
  id: string;
  role: string;
  companyId?: string;
}

/** Corridors where Global66 accepts a remitter with BANK_TRANSFER (RaaS docs). */
const DEFAULT_CORRIDORS: Array<Pick<Corridor, "country" | "countryName" | "currency" | "documentTypes"> & { demoRate: number }> = [
  { country: "PE", countryName: "Perú", currency: "PEN", documentTypes: ["DNI", "CE", "PASSPORT"], demoRate: 274.31 },
  { country: "CO", countryName: "Colombia", currency: "COP", documentTypes: ["CC", "CE", "PASSPORT"], demoRate: 0.24 },
  { country: "BO", countryName: "Bolivia", currency: "BOB", documentTypes: ["CI", "PASSPORT"], demoRate: 136.5 },
  { country: "VE", countryName: "Venezuela", currency: "VES", documentTypes: ["CI", "PASSPORT"], demoRate: 25.4 },
  { country: "PY", countryName: "Paraguay", currency: "PYG", documentTypes: ["CI", "PASSPORT"], demoRate: 0.125 },
  { country: "UY", countryName: "Uruguay", currency: "UYU", documentTypes: ["CI", "PASSPORT"], demoRate: 23.6 },
  { country: "DO", countryName: "República Dominicana", currency: "DOP", documentTypes: ["CEDULA", "PASSPORT"], demoRate: 15.7 },
  { country: "US", countryName: "Estados Unidos", currency: "USD", documentTypes: ["PASSPORT", "SSN"], demoRate: 950 },
  { country: "ES", countryName: "España", currency: "EUR", documentTypes: ["DNI", "NIE", "PASSPORT"], demoRate: 1030 },
];

const STATUS_LABEL: Record<RemesaStatus, string> = {
  awaiting_payment: "Esperando pago en el POS",
  payment_failed: "Pago no aprobado",
  payment_unverified: "Pago en verificación",
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
  /** Demo progress of a Global66 transfer: processing → sent → successful. */
  private readonly demoSteps = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: PlatformStore,
    deps: { tuu?: TuuReports; global66?: Global66BusinessApi } = {},
  ) {
    this.tuu = deps.tuu ?? new TuuReports(config.remesas.tuuApiKey);
    this.global66 = deps.global66 ?? new Global66BusinessApi();
    for (const corridor of store.list<Corridor>("remesas_corridors")) this.corridors.set(corridor.country, corridor);
    for (const seed of DEFAULT_CORRIDORS) {
      if (this.corridors.has(seed.country)) continue;
      const demo = !config.production;
      const corridor: Corridor = {
        country: seed.country,
        countryName: seed.countryName,
        currency: seed.currency,
        rate: demo ? seed.demoRate : 0,
        conversionPct: 0.012,
        commissionPct: 0.03,
        commissionFixed: 0,
        posPct: 0.0076,
        minAmount: 10_000,
        maxAmount: 5_000_000,
        accountTypes: seed.country === "CO" ? ["SAVING", "CHECKING", "ELECTRONIC"] : ["SAVING", "CHECKING", "ELECTRONIC", "NOT_APPLY"],
        documentTypes: seed.documentTypes,
        enabled: demo,
        rateUpdatedAt: demo ? new Date().toISOString() : null,
      };
      this.corridors.set(corridor.country, corridor);
      store.put("remesas_corridors", corridor.country, corridor);
    }
    for (const remesa of store.list<Remesa>("remesas")) this.remesas.set(remesa.id, remesa);
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

  listCorridors(includeDisabled = false): Corridor[] {
    return [...this.corridors.values()].filter((corridor) => includeDisabled || (corridor.enabled && corridor.rate > 0));
  }

  updateCorridor(country: string, input: Partial<Corridor>): Corridor {
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

  quote(input: { country: string; sendAmount: number }): RemesaQuote {
    const corridor = this.corridors.get(String(input.country).toUpperCase());
    if (!corridor || !corridor.enabled || corridor.rate <= 0) {
      throw new PlatformError("Ese país no está disponible para remesas", 400);
    }
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
    const receiveAmount = Math.floor((amountToConvert / corridor.rate) * 100) / 100;
    return {
      country: corridor.country,
      currency: corridor.currency,
      sendAmount,
      conversionCost,
      amountToConvert,
      rate: corridor.rate,
      rateText: `1 ${corridor.currency} = ${corridor.rate.toLocaleString("es-CL", { maximumFractionDigits: 4 })} CLP`,
      receiveAmount,
      commission,
      serviceFee,
      total,
      posFeeEstimated: Math.round(total * corridor.posPct),
      expiresAt: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
    };
  }

  create(input: {
    country: string;
    sendAmount: number;
    remitter: Remitter;
    beneficiary: Beneficiary;
    actor: RemesaActor;
  }): { remesa: Remesa; tuuPayment: Record<string, unknown> } {
    const quote = this.quote(input);
    const corridor = this.corridors.get(quote.country) as Corridor;
    const remitter = cleanRemitter(input.remitter);
    const beneficiary = cleanBeneficiary(input.beneficiary, corridor);
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
    return { remesa, tuuPayment: this.tuuPayment(remesa) };
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
        exemptAmount: 0,
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
    this.transition(remesa, "paid", "Aprobada por Operación");
    await this.send(remesa);
    return remesa;
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
      timeline: remesa.timeline.map((event) => ({ ...event, label: STATUS_LABEL[event.status] })),
    };
  }

  /** Rows for accounting: what was charged, kept and converted for each remittance. */
  exportCsv(actor: RemesaActor): string {
    const header = [
      "fecha", "codigo", "estado", "remitente", "rut_remitente", "pais", "moneda",
      "monto_enviado_clp", "costo_conversion_clp", "monto_convertido_clp", "comision_clp", "total_cobrado_clp",
      "comision_pos_estimada_clp", "tasa_clp", "monto_destino_estimado", "monto_destino_global66",
      "secuencia_tuu", "pos_serie", "transaccion_global66",
    ];
    const rows = this.list(actor).map((remesa) => [
      remesa.createdAt, remesa.code, remesa.status, remesa.remitter.name, remesa.remitter.rut,
      remesa.quote.country, remesa.quote.currency, remesa.quote.sendAmount, remesa.quote.conversionCost,
      remesa.quote.amountToConvert, remesa.quote.commission, remesa.quote.total, remesa.quote.posFeeEstimated,
      remesa.quote.rate, remesa.quote.receiveAmount, remesa.global66?.destinationAmount ?? "",
      remesa.payment?.sequenceNumber ?? "", remesa.payment?.serialNumber ?? "", remesa.global66?.transactionId ?? "",
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

  private async afterPaid(remesa: Remesa): Promise<void> {
    const limit = this.config.remesas.autoSendMax;
    if (limit !== undefined && remesa.quote.total > limit) {
      this.transition(remesa, "pending_review", `Supera el envío automático de ${formatClp(limit)}`);
      return;
    }
    this.transition(remesa, "paid", remesa.payment?.detail);
    await this.send(remesa);
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

function cleanBeneficiary(input: Beneficiary, corridor: Corridor): Beneficiary {
  const value = (key: keyof Beneficiary, max: number) => String(input?.[key] ?? "").trim().slice(0, max);
  const beneficiary: Beneficiary = {
    firstName: value("firstName", 100),
    lastName: value("lastName", 100),
    documentType: value("documentType", 20).toUpperCase(),
    documentNumber: value("documentNumber", 30),
    bankName: value("bankName", 100),
    accountType: value("accountType", 20).toUpperCase(),
    accountNumber: value("accountNumber", 40).replace(/\s+/g, ""),
  };
  if (!beneficiary.firstName || !beneficiary.lastName) throw new PlatformError("Nombre y apellido del beneficiario son requeridos", 400);
  if (!beneficiary.documentType || !beneficiary.documentNumber) throw new PlatformError("El documento del beneficiario es requerido", 400);
  if (!beneficiary.bankName) throw new PlatformError("El banco del beneficiario es requerido", 400);
  if (!corridor.accountTypes.includes(beneficiary.accountType)) {
    throw new PlatformError(`Tipo de cuenta no válido para ${corridor.countryName}`, 400);
  }
  if (!/^[0-9A-Za-z-]{4,40}$/.test(beneficiary.accountNumber)) throw new PlatformError("El número de cuenta no es válido", 400);
  const bankId = Number(input?.bankId);
  if (input?.bankId !== undefined && input.bankId !== null && String(input.bankId) !== "") {
    if (!Number.isSafeInteger(bankId) || bankId <= 0) throw new PlatformError("El código de banco no es válido", 400);
    beneficiary.bankId = bankId;
  }
  const email = String(input?.email ?? "").trim();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError("El correo del beneficiario no es válido", 400);
    beneficiary.email = email.slice(0, 100);
  }
  return beneficiary;
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
