import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PlatformError } from "../errors.js";

const DEFAULT_BASE_URL = "https://api.global66.com/business-api";
const PAGE_LIMIT = 200;

export interface Global66Credentials {
  clientId: string;
  clientSecret: string;
  accountId: string;
}

export interface Global66Movement {
  id: string;
  amount: number;
  status: string;
  transactionDate: string;
  comment: string | null;
  movementType: string | null;
  currency: string | null;
  accountBalance: number | null;
  destinationName: string | null;
}

export interface Global66WalletSnapshot {
  accountId: string;
  balance: number | null;
  currency: string | null;
  balanceAsOf: string | null;
  movements: Global66Movement[];
}

export interface Global66BankTransferInput {
  amount: number;
  originCurrency: string;
  destinationCurrency: string;
  purposeCode: number[];
  beneficiaryName: string;
  beneficiaryLastName: string;
  countryCode: string;
  accountType: string;
  accountNumber: string;
  documentNumber: string;
  documentType: string;
  externalReferenceId: string;
}

/** Final customer on whose behalf a remittance is sent (RaaS). */
export interface Global66Remitter {
  name: string;
  identificationType: string;
  identificationNumber: string;
  countryCode?: string;
  contactNumber?: string;
  email?: string;
  address?: string;
  city?: string;
}

export interface Global66RemittanceInput extends Global66BankTransferInput {
  description?: string;
  /** walletId the money leaves from (GET /b2b/accounts). */
  originAccountId?: number;
  bankId?: number;
  /** BANK_TRANSFER fields some destinations require: state, postalCode, residenceCity, address, branchCode. */
  beneficiaryExtra?: Record<string, string>;
  remitter?: Global66Remitter;
}

export interface Global66Account {
  walletId: number;
  currency: string;
  balance: number;
  alias: string | null;
  isPrincipal: boolean;
}

export interface Global66TransactionDetail {
  externalReferenceId: string;
  transactionId: string | null;
  /** PENDING, PROCESSING, COMPLETED or FAILED. */
  apiStatus: string;
  /** Status reported by the remittance product, when COMPLETED. */
  status: string | null;
  destinationAmount: number | null;
  destinationCurrency: string | null;
  exchangeRate: number | null;
}

export interface Global66TransferResult {
  externalReferenceId: string;
  transactionId: string | null;
  status: string;
  valid: boolean;
  violations: string[];
}

interface AccessTokens {
  token: string;
  refreshToken: string;
}

interface MovementPage {
  movements: unknown[];
  totalPages: number;
}

export function encryptGlobal66Secret(secret: string, masterKey: string): string {
  if (!secret.trim()) throw new PlatformError("El clientSecret de Global66 es requerido", 400);
  if (!masterKey.trim()) throw new PlatformError("Falta configurar la clave de cifrado de Global66", 503);
  const key = createHash("sha256").update(masterKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(".");
}

export function decryptGlobal66Secret(encrypted: string, masterKey: string): string {
  const [ivPart, tagPart, ciphertextPart, extra] = encrypted.split(".");
  if (!ivPart || !tagPart || !ciphertextPart || extra) {
    throw new PlatformError("Las credenciales Global66 guardadas no se pueden descifrar", 500);
  }
  if (!masterKey.trim()) throw new PlatformError("Falta configurar la clave de cifrado de Global66", 503);
  try {
    const key = createHash("sha256").update(masterKey).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new PlatformError("No se pudieron descifrar las credenciales Global66; revisa la clave de cifrado", 500);
  }
}

export class Global66BusinessApi {
  constructor(
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async walletSnapshot(credentials: Global66Credentials): Promise<Global66WalletSnapshot> {
    const tokens = await this.accessTokens(credentials);
    const movements: Global66Movement[] = [];
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page += 1) {
      if (page > PAGE_LIMIT) throw new PlatformError("Global66 devolvió demasiadas páginas de movimientos", 502);
      const query = new URLSearchParams({ page: String(page) });
      const data = await this.authenticatedRequest<MovementPage>(
        `/b2b/movements/${encodeURIComponent(credentials.accountId)}?${query.toString()}`,
        tokens,
        (token) => this.request(`/b2b/movements/${encodeURIComponent(credentials.accountId)}?${query.toString()}`, {
          method: "GET",
          headers: { Authorization: token },
        }),
      );
      if (!Array.isArray(data.movements) || !Number.isInteger(data.totalPages) || data.totalPages < 0) {
        throw new PlatformError("Global66 respondió con un formato de movimientos no válido", 502);
      }
      totalPages = Math.max(data.totalPages, 1);
      movements.push(...data.movements.map(parseMovement));
    }

    const latest = movements.reduce<Global66Movement | null>(
      (current, movement) =>
        !current || Date.parse(movement.transactionDate) > Date.parse(current.transactionDate)
          ? movement
          : current,
      null,
    );
    return {
      accountId: credentials.accountId,
      balance: latest?.accountBalance ?? null,
      currency: latest?.accountBalance === null ? null : latest?.currency ?? null,
      balanceAsOf: latest?.transactionDate ?? null,
      movements: movements.sort(
        (a, b) => Date.parse(b.transactionDate) - Date.parse(a.transactionDate),
      ),
    };
  }

  async createBankTransfer(
    credentials: Global66Credentials,
    input: Global66BankTransferInput,
  ): Promise<Global66TransferResult> {
    return this.submitPayment(credentials, input, "/b2b/transactions/payments");
  }

  /**
   * A remittance on behalf of a final customer. With `remitter` it uses the RaaS endpoint,
   * which Global66 enables per company (403 otherwise).
   */
  async createRemittance(credentials: Global66Credentials, input: Global66RemittanceInput): Promise<Global66TransferResult> {
    return this.submitPayment(
      credentials,
      input,
      input.remitter ? "/b2b/transactions/raas/payments" : "/b2b/transactions/payments",
    );
  }

  /** Company wallets with their available balance. */
  async accounts(credentials: Global66Credentials): Promise<Global66Account[]> {
    const tokens = await this.accessTokens(credentials);
    const data = await this.authenticatedRequest<{ accounts?: unknown }>("/b2b/accounts", tokens, (token) =>
      this.request("/b2b/accounts", { method: "GET", headers: { Authorization: token } }),
    );
    if (!Array.isArray(data.accounts)) throw new PlatformError("Global66 respondió con un formato de cuentas no válido", 502);
    return data.accounts.flatMap((item) => {
      const account = item as Record<string, unknown> | null;
      const walletId = numericField(account?.walletId);
      const balance = numericField(account?.balance);
      const currency = stringField(account?.currency);
      if (walletId === null || balance === null || !currency) return [];
      return [{ walletId, currency: currency.toUpperCase(), balance, alias: stringField(account?.alias), isPrincipal: account?.isPrincipal === true }];
    });
  }

  /** Status of a payment created by API, looked up by our own reference. */
  async transactionDetail(credentials: Global66Credentials, externalReferenceId: string): Promise<Global66TransactionDetail> {
    const tokens = await this.accessTokens(credentials);
    const path = `/b2b/transactions/detail?externalReferenceId=${encodeURIComponent(externalReferenceId)}`;
    const data = await this.authenticatedRequest<Record<string, unknown>>(path, tokens, (token) =>
      this.request(path, { method: "GET", headers: { Authorization: token } }),
    );
    const detail = data.detail && typeof data.detail === "object" ? (data.detail as Record<string, unknown>) : undefined;
    const destination =
      detail?.destination && typeof detail.destination === "object" ? (detail.destination as Record<string, unknown>) : undefined;
    return {
      externalReferenceId,
      transactionId: identifierField(data.transactionId),
      apiStatus: stringField(data.apiStatus) ?? "PENDING",
      status: stringField(detail?.status),
      destinationAmount: numericField(destination?.amount),
      destinationCurrency: stringField(destination?.currency),
      exchangeRate: numericField(detail?.exchangeRate),
    };
  }

  private async submitPayment(
    credentials: Global66Credentials,
    input: Global66RemittanceInput,
    path: string,
  ): Promise<Global66TransferResult> {
    const tokens = await this.accessTokens(credentials);
    const request = {
      externalReferenceId: input.externalReferenceId,
      transactionType: "REMITTANCE",
      originCurrency: input.originCurrency,
      amount: input.amount,
      way: "ORIGIN",
      ...(input.originAccountId !== undefined ? { originAccountId: input.originAccountId } : {}),
      ...(input.description ? { description: input.description.slice(0, 140) } : {}),
      paymentType: "WIRE_TRANSFER",
      // Documented shape: [{ purposeCode: 64, amount?: 100.00 }].
      purposeCode: input.purposeCode.map((purposeCode) => ({ purposeCode })),
      beneficiary: {
        operationType: "BANK_TRANSFER",
        destinationCurrency: input.destinationCurrency,
        beneficiaryName: input.beneficiaryName,
        beneficiaryLastName: input.beneficiaryLastName,
        typeBeneficiary: "INDIVIDUAL",
        countryCode: input.countryCode,
        accountType: input.accountType,
        accountNumber: input.accountNumber,
        documentNumber: input.documentNumber,
        documentType: input.documentType,
        ...(input.bankId !== undefined ? { bankId: input.bankId } : {}),
        ...(input.beneficiaryExtra ?? {}),
      },
      ...(input.remitter ? { remitter: input.remitter } : {}),
    };
    const form = new FormData();
    form.set("request", JSON.stringify(request));
    const result = await this.authenticatedRequest<Record<string, unknown>>(
      path,
      tokens,
      (token) => this.request(path, {
        method: "POST",
        headers: { Authorization: token },
        body: form,
      }),
    );
    if (typeof result.valid !== "boolean" || typeof result.status !== "string") {
      throw new PlatformError("Global66 respondió con un resultado de transferencia no válido", 502);
    }
    return {
      externalReferenceId: input.externalReferenceId,
      transactionId: identifierField(result.transactionId) ?? identifierField(result.id),
      status: result.status,
      valid: result.valid,
      violations: Array.isArray(result.violations)
        ? result.violations.map(describeViolation)
        : result.valid
          ? []
          : ["Global66 rechazó la validación de la transferencia"],
    };
  }

  private async accessTokens(credentials: Global66Credentials): Promise<AccessTokens> {
    const result = await this.request<{ token?: unknown; refreshToken?: unknown }>("/b2b/auth", {
      method: "POST",
      json: { clientId: credentials.clientId, clientSecret: credentials.clientSecret },
    });
    if (typeof result.token !== "string" || !result.token || typeof result.refreshToken !== "string" || !result.refreshToken) {
      throw new PlatformError("Global66 no devolvió tokens de acceso válidos", 502);
    }
    return { token: result.token, refreshToken: result.refreshToken };
  }

  private async authenticatedRequest<T>(
    path: string,
    tokens: AccessTokens,
    send: (token: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await send(tokens.token);
    } catch (error) {
      if (!(error instanceof PlatformError) || error.status !== 401) throw error;
      const refreshed = await this.request<{ token?: unknown; refreshToken?: unknown }>("/b2b/auth/refresh", {
        method: "POST",
        json: { refreshToken: tokens.refreshToken },
      });
      if (typeof refreshed.token !== "string" || !refreshed.token) {
        throw new PlatformError("Global66 no renovó el token; revisa las credenciales y la IP permitida", 401);
      }
      try {
        return await send(refreshed.token);
      } catch (retryError) {
        if (retryError instanceof PlatformError && retryError.status === 401) {
          throw new PlatformError(`Global66 rechazó la autenticación para ${path}; revisa la IP permitida y la credencial`, 401);
        }
        throw retryError;
      }
    }
  }

  private async request<T>(
    path: string,
    input: { method: "GET" | "POST"; headers?: Record<string, string>; json?: unknown; body?: RequestInit["body"] },
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: input.method,
        headers: {
          Accept: "application/json",
          ...(input.json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...input.headers,
        },
        ...(input.json !== undefined ? { body: JSON.stringify(input.json) } : input.body !== undefined ? { body: input.body } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "error de red";
      throw new PlatformError(`No se pudo conectar con Global66: ${message}`, 502);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new PlatformError(`Global66 respondió con contenido no JSON (HTTP ${response.status})`, 502);
    }
    if (!response.ok) {
      const body = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
      // Payload validation errors come back as 400 with the same shape as a 200 { valid: false }.
      if (response.status === 400 && body.valid === false) return body as T;
      const code = stringField(body.code) ?? stringField(body.rule);
      const status = [401, 403, 409].includes(response.status) ? response.status : 502;
      throw new PlatformError(`Global66 respondió HTTP ${response.status}${code ? ` (${code})` : ""}`, status);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new PlatformError("Global66 respondió con un formato no válido", 502);
    }
    return data as T;
  }
}

function parseMovement(value: unknown): Global66Movement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlatformError("Global66 devolvió un movimiento no válido", 502);
  }
  const movement = value as Record<string, unknown>;
  const id = movement.id;
  const transactionDate = movement.transactionDate;
  const amount = movement.amount;
  const status = movement.status;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof transactionDate !== "string" ||
    typeof amount !== "number" ||
    typeof status !== "string"
  ) {
    throw new PlatformError("Global66 devolvió un movimiento incompleto", 502);
  }
  const date = Date.parse(transactionDate);
  if (!Number.isFinite(date)) throw new PlatformError("Global66 devolvió una fecha de movimiento no válida", 502);
  return {
    id: String(id),
    amount,
    status,
    transactionDate,
    comment: stringField(movement.comment),
    movementType: stringField(movement.type),
    currency:
      stringField(movement.amountCurrency) ??
      stringField(movement.currency) ??
      stringField(movement.originCurrency) ??
      stringField(movement.currencyCode),
    accountBalance: numericField(movement.accountBalance),
    destinationName: stringField(movement.destinationName),
  };
}

function describeViolation(violation: unknown): string {
  if (typeof violation === "string") return violation;
  if (violation && typeof violation === "object") {
    const item = violation as Record<string, unknown>;
    const field = stringField(item.field);
    const message = stringField(item.message) ?? stringField(item.rule);
    if (message) return field ? `${field}: ${message}` : message;
  }
  return JSON.stringify(violation);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function identifierField(value: unknown): string | null {
  return typeof value === "string" && value.length
    ? value
    : typeof value === "number" && Number.isInteger(value)
      ? String(value)
      : null;
}

function numericField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
