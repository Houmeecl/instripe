import { CATALOG_SEED } from "../modules/remesas/catalogSeed.js";
import type { PlatformStore } from "../store/db.js";

const CACHE_MS = 12 * 60 * 60 * 1000;

export interface CatalogBank {
  /** `bankId` in the transactional API. */
  id: number;
  name: string;
}

export interface CatalogRoute {
  routeId: number;
  country: string;
  countryName: string;
  currency: string;
  minUsd: number;
  maxUsd: number;
  slaHours: number | null;
  banks: CatalogBank[];
}

export interface CatalogField {
  field: string;
  label: string;
  required: boolean;
  type: string;
  options: Array<{ value: string; label: string }>;
  regex: string | null;
  minLength: number | null;
  maxLength: number | null;
}

export interface CatalogDocument {
  value: string;
  label: string;
  minSize: number | null;
  maxSize: number | null;
  pattern: string | null;
}

/**
 * Global66 public route catalog (no credentials): destinations, banks with their `bankId`,
 * beneficiary fields per route, document types and delivery time.
 * Cached for 12 hours. When Global66 is unreachable it serves the last good copy, then the seed.
 */
export class Global66Catalog {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    private readonly baseUrl: string | undefined,
    private readonly store?: PlatformStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get live(): boolean {
    return Boolean(this.baseUrl);
  }

  async routes(): Promise<CatalogRoute[]> {
    const seed = (CATALOG_SEED as { routes: unknown }).routes;
    const data = await this.load("routes", "/route/ext?product=REMITTANCE_B2B", seed);
    return parseRoutes(data);
  }

  async fields(routeId: number): Promise<CatalogField[]> {
    const seed = (CATALOG_SEED as { fields: Record<string, unknown> }).fields[String(routeId)] ?? { fields: [] };
    const data = await this.load(`fields:${routeId}`, `/route/ext/destination-fields?routeId=${routeId}`, seed);
    const list = data && typeof data === "object" ? (data as { fields?: unknown }).fields : undefined;
    return Array.isArray(list) ? list.flatMap(parseField) : [];
  }

  async documents(country: string): Promise<CatalogDocument[]> {
    const code = country.toUpperCase();
    const seed = (CATALOG_SEED as { documents: Record<string, unknown> }).documents[code] ?? { individual: [] };
    const data = await this.load(`documents:${code}`, `/route/ext/documents/${encodeURIComponent(code)}`, seed);
    const list = data && typeof data === "object" ? (data as { individual?: unknown }).individual : undefined;
    return Array.isArray(list) ? list.flatMap(parseDocument) : [];
  }

  /** Estimated delivery in hours for an amount in the destination currency. Null when unknown. */
  async slaHours(country: string, currency: string, amount: number): Promise<number | null> {
    if (!this.baseUrl) return null;
    const rounded = Math.max(1, Math.round(amount));
    const query = new URLSearchParams({ country, currency, amount: String(rounded) });
    try {
      const data = await this.load(`sla:${country}:${currency}:${rounded}`, `/route/ext/sla?${query}`, null);
      const hours = data && typeof data === "object" ? (data as { slaHours?: unknown }).slaHours : undefined;
      return typeof hours === "number" && Number.isFinite(hours) ? hours : null;
    } catch {
      return null;
    }
  }

  private async load(key: string, path: string, seed: unknown): Promise<unknown> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    if (this.baseUrl) {
      try {
        const response = await this.fetcher(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const value: unknown = await response.json();
          this.cache.set(key, { at: Date.now(), value });
          this.store?.put("remesas_catalog", key, { at: new Date().toISOString(), value });
          return value;
        }
      } catch {
        // Falls back below.
      }
    }
    const saved = this.store?.get<{ value: unknown }>("remesas_catalog", key);
    const value = saved?.value ?? seed;
    // Retry the network sooner than a good answer would.
    this.cache.set(key, { at: Date.now() - CACHE_MS + 5 * 60 * 1000, value });
    return value;
  }
}

function parseRoutes(data: unknown): CatalogRoute[] {
  const groups = data && typeof data === "object" ? (data as { groups?: unknown }).groups : undefined;
  if (!Array.isArray(groups)) return [];
  const routes: CatalogRoute[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const g = group as Record<string, unknown>;
    const names = g.destinationCountryNames as Record<string, unknown> | undefined;
    for (const item of Array.isArray(g.routes) ? g.routes : []) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const paymentTypes = Array.isArray(r.paymentTypes) ? r.paymentTypes : [];
      const wire = paymentTypes.some((p) => p && typeof p === "object" && (p as { paymentType?: unknown }).paymentType === "WIRE_TRANSFER");
      // The local payout leg of each destination: origin currency equals destination currency.
      if (!wire || r.originCurrency !== r.destinationCurrency || typeof r.routeId !== "number") continue;
      const country = String(r.destinationCountry ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(country) || country === "CL") continue;
      routes.push({
        routeId: r.routeId,
        country,
        countryName: typeof names?.nameES === "string" ? names.nameES : country,
        currency: String(r.destinationCurrency).toUpperCase(),
        minUsd: typeof r.originMinUsd === "number" ? r.originMinUsd : 0,
        maxUsd: typeof r.originMaxUsd === "number" ? r.originMaxUsd : 0,
        slaHours: typeof r.slaHours === "number" ? r.slaHours : null,
        banks: (Array.isArray(r.bankingCodes) ? r.bankingCodes : []).flatMap((bank) => {
          const b = bank as Record<string, unknown> | null;
          return b && typeof b.id === "number" && typeof b.bankName === "string" && b.bankName.trim()
            ? [{ id: b.id, name: b.bankName.trim() }]
            : [];
        }),
      });
    }
  }
  return routes;
}

function parseField(value: unknown): CatalogField[] {
  if (!value || typeof value !== "object") return [];
  const f = value as Record<string, unknown>;
  if (typeof f.field !== "string") return [];
  return [
    {
      field: f.field,
      label: typeof f.label === "string" ? f.label : f.field,
      required: f.required === true,
      type: typeof f.type === "string" ? f.type : "text",
      options: (Array.isArray(f.options) ? f.options : []).flatMap((option) => {
        const o = option as Record<string, unknown> | null;
        return o && typeof o.value === "string" ? [{ value: o.value, label: typeof o.label === "string" ? o.label : o.value }] : [];
      }),
      regex: typeof f.regex === "string" && f.regex ? f.regex : null,
      minLength: typeof f.minLength === "number" ? f.minLength : null,
      maxLength: typeof f.maxLength === "number" ? f.maxLength : null,
    },
  ];
}

function parseDocument(value: unknown): CatalogDocument[] {
  if (!value || typeof value !== "object") return [];
  const d = value as Record<string, unknown>;
  if (typeof d.value !== "string") return [];
  return [
    {
      value: d.value,
      label: typeof d.nameDisplay === "string" ? d.nameDisplay : d.value,
      minSize: typeof d.minSize === "number" ? d.minSize : null,
      maxSize: typeof d.maxSize === "number" ? d.maxSize : null,
      pattern: typeof d.characterType === "string" && d.characterType ? d.characterType : null,
    },
  ];
}
