import { PlatformError } from "../errors.js";

const DEFAULT_BASE_URL = "https://integrations.payment.haulmer.com";
const PAGE_SIZE = 20;
const MAX_PAGES = 50;

export interface TuuSale {
  saleId: string | null;
  sequenceNumber: string;
  serialNumber: string | null;
  status: string;
  amount: number;
  typeTransaction: string | null;
  paidAt: string | null;
  /** TUU fee on the sale (extraData.amountCommission), when reported. */
  commission: number | null;
  /** What TUU deposits for the sale (extraData.amountWithoutCommission), when reported. */
  net: number | null;
}

/**
 * TUU (Haulmer) transaction reports. The inter-app payment result comes from the POS,
 * so the server confirms it here before moving money: same sequence number, terminal and amount.
 */
export class TuuReports {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Finds a sale by sequence number on one terminal and day (YYYY-MM-DD). */
  async findSale(input: { serialNumber: string; sequenceNumber: string; date: string }): Promise<TuuSale | null> {
    if (!this.apiKey) throw new PlatformError("Falta TUU_API_KEY para verificar pagos", 503);
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await this.request({
        StartDate: input.date,
        EndDate: input.date,
        SerialNumber: input.serialNumber,
        page,
        pageSize: PAGE_SIZE,
      });
      const rows = extractRows(data);
      for (const row of rows) {
        const sale = parseSale(row);
        if (sale && sale.sequenceNumber === input.sequenceNumber) return sale;
      }
      if (rows.length < PAGE_SIZE) return null;
    }
    return null;
  }

  private async request(body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl.replace(/\/+$/, "")}/Report/get-report`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": this.apiKey ?? "" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "error de red";
      throw new PlatformError(`No se pudo conectar con TUU: ${message}`, 502);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new PlatformError(`TUU respondió con contenido no JSON (HTTP ${response.status})`, 502);
    }
    if (!response.ok) {
      throw new PlatformError(`TUU rechazó la consulta de reportes (HTTP ${response.status})`, 502);
    }
    return data;
  }
}

/** True when TUU reports the sale as approved. */
export function tuuSaleApproved(sale: TuuSale): boolean {
  return /aprob|approv|success|exito|éxito|complet|paid|pagad/i.test(sale.status);
}

function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["data", "transactions", "items", "results", "content"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractRows(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function parseSale(value: unknown): TuuSale | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sequenceNumber = text(row.sequenceNumber);
  const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
  const extra = row.extraData && typeof row.extraData === "object" ? (row.extraData as Record<string, unknown>) : {};
  const number = (value: unknown) => (value === undefined || value === null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  if (!sequenceNumber || !Number.isFinite(amount)) return null;
  return {
    saleId: text(row.saleId),
    sequenceNumber,
    serialNumber: text(row.posSerialNumber),
    status: text(row.status) ?? "",
    amount,
    typeTransaction: text(row.typeTransaction),
    paidAt: text(row.paymentDataTime),
    commission: number(extra.amountCommission),
    net: number(extra.amountWithoutCommission),
  };
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
