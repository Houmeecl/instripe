import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type {
  ChargeRequest,
  ChargeResult,
  PayoutRequest,
  PayoutResult,
  PaymentGateway,
} from "./types.js";

const DEFAULT_API_URL = "https://api.global66.com/business-api";

export interface Global66Config {
  clientId: string | undefined;
  clientSecret: string | undefined;
  apiUrl: string;
}

export interface Global66Beneficiary {
  operationType: string;
  destinationCurrency: string;
  beneficiaryName: string;
  beneficiaryLastName: string;
  typeBeneficiary: string;
  email: string;
  countryCode: string;
  accountType: string;
  bankId: number;
  accountNumber: string;
  documentNumber: string;
  documentType: string;
  [key: string]: unknown;
}

/** Exact request envelope documented by Global66's B2B transactional API. */
export interface Global66PaymentRequest {
  externalReferenceId: string;
  transactionType: string;
  originCurrency: string;
  amount: number;
  way: string;
  description: string;
  paymentType: string;
  purposeCode: Array<{ purposeCode: number; amount: number }>;
  beneficiary: Global66Beneficiary;
  [key: string]: unknown;
}

export interface Global66PaymentResponse {
  valid?: boolean;
  status?: string;
  transactionId?: string | number;
  id?: string | number;
  violations?: unknown[];
  [key: string]: unknown;
}

interface Global66PayoutDestination {
  transactionType: string;
  way: string;
  paymentType: string;
  purposeCode: Array<{ purposeCode: number; amount: number }>;
  beneficiary: Global66Beneficiary;
  [key: string]: unknown;
}

export interface Global66MovementsResponse {
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  movements: Array<Record<string, unknown>>;
}

interface AuthResponse {
  token: string;
  refreshToken: string;
}

/**
 * Global66 B2B transactional API adapter.
 *
 * Official production contract:
 * - POST /b2b/auth
 * - POST /b2b/auth/refresh
 * - POST /b2b/transactions/payments (multipart field `request`)
 * - GET /b2b/movements/{accountId}
 */
export class Global66Gateway implements PaymentGateway {
  readonly name = "global66" as const;
  readonly label = "Global66 B2B";

  private readonly config: Global66Config;
  private token: string | undefined;
  private refreshToken: string | undefined;

  constructor(appConfig: AppConfig) {
    this.config = {
      clientId: appConfig.global66?.clientId,
      clientSecret: appConfig.global66?.clientSecret,
      apiUrl: (appConfig.global66?.apiUrl || DEFAULT_API_URL).replace(/\/$/, ""),
    };
  }

  get configured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  get isDemoMode(): boolean {
    return !this.configured;
  }

  async authenticate(): Promise<void> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Global66 no está configurado");
    }
    const response = await this.fetchJson<AuthResponse>("/b2b/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      }),
    });
    if (!response.token || !response.refreshToken) {
      throw new Error("Global66 respondió sin token o refreshToken");
    }
    this.token = response.token;
    this.refreshToken = response.refreshToken;
  }

  async createPayment(request: Global66PaymentRequest): Promise<Global66PaymentResponse> {
    this.validatePayment(request);
    const boundary = `----instripe-${randomUUID()}`;
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="request"',
      "Content-Type: application/json",
      "",
      JSON.stringify(request),
      `--${boundary}--`,
      "",
    ].join("\r\n");
    return this.authorizedJson<Global66PaymentResponse>("/b2b/transactions/payments", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
  }

  async listMovements(
    accountId: number,
    filters: { dateFrom?: string; dateTo?: string; page?: number } = {},
  ): Promise<Global66MovementsResponse> {
    if (!Number.isInteger(accountId) || accountId <= 0) throw new Error("accountId inválido");
    const query = new URLSearchParams();
    if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) query.set("dateTo", filters.dateTo);
    if (filters.page !== undefined) query.set("page", String(filters.page));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.authorizedJson<Global66MovementsResponse>(`/b2b/movements/${accountId}${suffix}`);
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!this.configured) {
      const id = `g66_demo_${randomUUID().slice(0, 8)}`;
      return {
        gateway: this.name,
        mode: "demo",
        chargeId: id,
        redirectUrl: `${req.successUrl}${req.successUrl.includes("?") ? "&" : "?"}charge=${id}`,
        amount: req.amount,
        currency: req.currency,
      };
    }
    throw new Error("La API Transaccional de Global66 no documenta cobros con tarjeta");
  }

  async createCardPayment(_req: {
    amount: number;
    currency: string;
    card: {
      cardNumber: string;
      expiryMonth: number;
      expiryYear: number;
      cvv: string;
      cardholderName: string;
    };
    description: string;
  }): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    void _req;
    if (!this.configured) {
      return { success: true, transactionId: `g66_demo_${randomUUID().slice(0, 8)}` };
    }
    return {
      success: false,
      error: "Global66 B2B no admite sincronizar ni duplicar tarjetas desde Stripe",
    };
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!this.configured) {
      return {
        gateway: this.name,
        mode: "demo",
        payoutId: `g66_payout_demo_${randomUUID().slice(0, 8)}`,
        amount: req.amount,
        currency: req.currency,
        destination: req.destination,
        status: "paid",
      };
    }

    let destination: Global66PayoutDestination;
    try {
      destination = JSON.parse(req.destination) as typeof destination;
    } catch {
      throw new Error("El destino Global66 debe ser un JSON del contrato B2B oficial");
    }
    if (!req.reference) throw new Error("La salida Global66 requiere una referencia idempotente");
    const response = await this.createPayment({
      ...destination,
      externalReferenceId: req.reference,
      amount: req.amount,
      originCurrency: req.currency.toUpperCase(),
      description: req.description,
    });
    if (response.valid === false || response.status === "FAILED") {
      throw new Error(`Global66 rechazó la operación: ${JSON.stringify(response.violations ?? [])}`);
    }
    const externalId = response.transactionId ?? response.id ?? req.reference;
    return {
      gateway: this.name,
      mode: "live",
      payoutId: String(externalId),
      amount: req.amount,
      currency: req.currency,
      destination: req.destination,
      status: "pending",
    };
  }

  async available(_currency: string): Promise<number> {
    void _currency;
    return 0;
  }

  private validatePayment(request: Global66PaymentRequest): void {
    if (!request.externalReferenceId?.trim()) throw new Error("externalReferenceId es requerido");
    if (!Number.isFinite(request.amount) || request.amount <= 0) throw new Error("amount inválido");
    if (!request.originCurrency?.trim()) throw new Error("originCurrency es requerido");
    if (!request.beneficiary || !request.beneficiary.accountNumber) {
      throw new Error("beneficiary.accountNumber es requerido");
    }
  }

  private async authorizedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) await this.authenticate();
    let response = await this.fetchWithToken(path, init);
    if (response.status === 401 && this.refreshToken) {
      await this.refreshAuthentication();
      response = await this.fetchWithToken(path, init);
    }
    return this.parseResponse<T>(response);
  }

  private fetchWithToken(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.token ?? "");
    return fetch(`${this.config.apiUrl}${path}`, { ...init, headers });
  }

  private async refreshAuthentication(): Promise<void> {
    if (!this.refreshToken) {
      await this.authenticate();
      return;
    }
    const response = await this.fetchJson<AuthResponse>("/b2b/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    if (!response.token) throw new Error("Global66 respondió sin token renovado");
    this.token = response.token;
    this.refreshToken = response.refreshToken || this.refreshToken;
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${path}`, init);
    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const suffix = retryAfter ? `; retry-after=${retryAfter}` : "";
      throw new Error(`Global66 HTTP ${response.status}${suffix}: ${JSON.stringify(payload)}`);
    }
    return payload as T;
  }
}
