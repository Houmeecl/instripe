import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import { createStripe, platformAccount, stripeMessage } from "../../stripe/client.js";
import type { PlatformStore } from "../../store/db.js";

export interface IssuedCard {
  id: string;
  holderName: string;
  email: string;
  last4: string;
  brand: string;
  /** Credit limit in the platform currency. This is the cupo seguros can cover. */
  cupo: number;
  /** Currency Stripe used for the card. May differ from the platform currency. */
  cardCurrency: string;
  status: "active" | "inactive";
  stripeCardId?: string;
  mode: "live" | "demo";
  notice?: string;
  createdAt: string;
}

export interface IssuingStatus {
  stripeConfigured: boolean;
  active: boolean;
  chargesEnabled: boolean;
  currency?: string;
  detail: string;
}

interface CardIdentity {
  firstName: string;
  lastName: string;
  phone: string;
  dob: { day: number; month: number; year: number };
  address: { line1: string; city: string; country: string; postalCode: string };
}

const MODULE = "tarjetas";
const PHONE = /^\+[1-9]\d{7,14}$/;

/**
 * Virtual cards. The full number never touches this server.
 * With a Stripe key, a card exists only after Issuing accepts it.
 */
export class TarjetasModule {
  readonly id = MODULE;
  readonly label = "Tarjetas";
  private readonly cards = new Map<string, IssuedCard>();
  private readonly stripe: Stripe | undefined;

  constructor(
    private readonly payments: Payments,
    config: AppConfig,
    private readonly store: PlatformStore,
  ) {
    this.stripe = createStripe(config);
    for (const card of store.list<IssuedCard>("issued_cards")) this.cards.set(card.id, card);
  }

  list(): IssuedCard[] {
    return [...this.cards.values()];
  }

  async issuingStatus(): Promise<IssuingStatus> {
    if (!this.stripe) {
      return {
        stripeConfigured: false,
        active: false,
        chargesEnabled: false,
        detail: "Sin clave de Stripe la tarjeta queda en demo y no es una tarjeta virtual real.",
      };
    }
    try {
      const account = await platformAccount(this.stripe);
      const currency = (account.default_currency ?? "eur").toLowerCase();
      const chargesEnabled = account.charges_enabled === true;
      const active = cardIssuingActive(account);
      return {
        stripeConfigured: true,
        active,
        chargesEnabled,
        currency,
        detail: active
          ? `Issuing está activo. La tarjeta virtual se crea en Stripe, en ${currency.toUpperCase()}, y gasta el saldo de Issuing. El número no se guarda aquí.`
          : "Stripe ya puede cobrar con tarjeta. La tarjeta virtual real pide Issuing activo: en el Dashboard hay que abrir Issuing y aceptar los términos. Hasta entonces no se crea ninguna tarjeta.",
      };
    } catch (error) {
      return {
        stripeConfigured: true,
        active: false,
        chargesEnabled: false,
        detail: stripeMessage(error),
      };
    }
  }

  async issue(input: {
    holderName: string;
    email: string;
    phone: string;
    cupo: number;
    dob?: { day: number; month: number; year: number };
    address?: { line1: string; city: string; country: string; postalCode: string };
  }): Promise<IssuedCard> {
    const holderName = input.holderName.trim();
    const email = input.email.trim();
    const phone = input.phone.trim();
    if (!holderName || !email || !phone) {
      throw new PlatformError("holderName, email y phone son requeridos", 400);
    }
    if (!Number.isInteger(input.cupo) || input.cupo <= 0) {
      throw new PlatformError("El cupo de la tarjeta debe ser un entero positivo", 400);
    }

    if (!this.stripe) {
      const card = this.remember({
        id: `crd_${randomUUID().slice(0, 8)}`,
        holderName,
        email,
        last4: randomUUID().replace(/\D/g, "").padEnd(4, "4").slice(0, 4),
        brand: "Visa",
        cupo: input.cupo,
        cardCurrency: this.payments.walletAccount.currency,
        status: "active",
        mode: "demo",
        notice: "Demo local. No es una tarjeta de Stripe.",
        createdAt: new Date().toISOString(),
      });
      return card;
    }

    const status = await this.issuingStatus();
    if (!status.active || !status.currency) {
      throw new PlatformError(status.detail, 409);
    }
    const identity = this.identity(holderName, phone, input.dob, input.address);
    const cardId = `crd_${randomUUID().slice(0, 8)}`;
    let issued: Stripe.Issuing.Card;
    try {
      const holder = await this.stripe.issuing.cardholders.create(
        {
          name: holderName.slice(0, 24),
          email,
          phone_number: identity.phone,
          type: "individual",
          individual: {
            first_name: identity.firstName,
            last_name: identity.lastName,
            dob: identity.dob,
          },
          billing: {
            address: {
              line1: identity.address.line1,
              city: identity.address.city,
              country: identity.address.country,
              postal_code: identity.address.postalCode,
            },
          },
          metadata: { module: MODULE, reference: cardId },
        },
        { idempotencyKey: `holder_${cardId}` },
      );
      const sameCurrency = status.currency === this.payments.walletAccount.currency;
      issued = await this.stripe.issuing.cards.create(
        {
          cardholder: holder.id,
          currency: status.currency,
          type: "virtual",
          status: "active",
          metadata: { module: MODULE, reference: cardId, cupo: String(input.cupo) },
          ...(sameCurrency
            ? { spending_controls: { spending_limits: [{ amount: input.cupo, interval: "all_time" as const }] } }
            : {}),
        },
        { idempotencyKey: `card_${cardId}` },
      );
    } catch (error) {
      throw new PlatformError(stripeMessage(error), 502);
    }

    const sameCurrency = issued.currency === this.payments.walletAccount.currency;
    return this.remember({
      id: cardId,
      holderName,
      email,
      last4: issued.last4,
      brand: issued.brand,
      cupo: input.cupo,
      cardCurrency: issued.currency,
      status: issued.status === "active" ? "active" : "inactive",
      stripeCardId: issued.id,
      mode: "live",
      notice: sameCurrency
        ? "Tarjeta virtual de Stripe. El número queda en Stripe."
        : `Tarjeta virtual de Stripe en ${issued.currency.toUpperCase()}. El cupo del seguro queda en la moneda de la plataforma.`,
      createdAt: new Date().toISOString(),
    });
  }

  private identity(
    holderName: string,
    phone: string,
    dob: { day: number; month: number; year: number } | undefined,
    address: { line1: string; city: string; country: string; postalCode: string } | undefined,
  ): CardIdentity {
    const [first, ...rest] = holderName.split(/\s+/).filter(Boolean);
    const last = rest.join(" ");
    if (!first || !last) throw new PlatformError("El titular necesita nombre y apellido", 400);
    if (`${first} ${last}`.length > 24) throw new PlatformError("El nombre del titular cabe en 24 caracteres", 400);
    if (!PHONE.test(phone)) throw new PlatformError("El teléfono tiene que ir en formato internacional, con +", 400);
    if (!dob || !calendarDate(dob)) throw new PlatformError("La fecha de nacimiento es requerida", 400);
    const line1 = address?.line1.trim() ?? "";
    const city = address?.city.trim() ?? "";
    const country = (address?.country ?? "").trim().toUpperCase();
    const postalCode = address?.postalCode.trim() ?? "";
    if (!line1 || !city || !/^[A-Z]{2}$/.test(country) || !postalCode) {
      throw new PlatformError("La dirección de facturación es requerida", 400);
    }
    return {
      firstName: first,
      lastName: last,
      phone,
      dob,
      address: { line1, city, country, postalCode },
    };
  }

  private remember(card: IssuedCard): IssuedCard {
    this.cards.set(card.id, card);
    this.store.put("issued_cards", card.id, card);
    return card;
  }
}

function cardIssuingActive(account: Stripe.Account): boolean {
  const capabilities = account.capabilities as (Stripe.Account.Capabilities & { card_issuing?: string }) | undefined;
  return capabilities?.card_issuing === "active" && Boolean(account.settings?.card_issuing?.tos_acceptance?.date);
}

function calendarDate(dob: { day: number; month: number; year: number }): boolean {
  if (!Number.isInteger(dob.day) || !Number.isInteger(dob.month) || !Number.isInteger(dob.year)) return false;
  if (dob.year < 1900 || dob.year > new Date().getUTCFullYear() - 18) return false;
  const date = new Date(Date.UTC(dob.year, dob.month - 1, dob.day));
  return date.getUTCFullYear() === dob.year && date.getUTCMonth() === dob.month - 1 && date.getUTCDate() === dob.day;
}
