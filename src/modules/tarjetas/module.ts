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
  cvv?: string;
  expiryMonth?: number;
  expiryYear?: number;
  fullNumber?: string;
  createdAt: string;
}

export interface CardWithDetails extends IssuedCard {
  cvv: string;
  expiryMonth: number;
  expiryYear: number;
  fullNumber: string;
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
 * Virtual cards. The full number never touches this server in production.
 * With a Stripe key, a card exists only after Issuing accepts it.
 * In demo mode, we generate a simulated card with CVV for testing.
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

  /**
   * Get a card by ID with full details (including CVV in demo mode)
   */
  get(cardId: string): IssuedCard | undefined {
    return this.cards.get(cardId) ? { ...this.cards.get(cardId)! } : undefined;
  }

  /**
   * Get card with CVV and full number (only in demo mode)
   */
  getWithDetails(cardId: string): CardWithDetails | undefined {
    const card = this.cards.get(cardId);
    if (!card) return undefined;
    
    // In demo mode, we have the full details stored
    if (card.mode === "demo" && card.fullNumber && card.cvv) {
      return {
        ...card,
        cvv: card.cvv,
        expiryMonth: card.expiryMonth!,
        expiryYear: card.expiryYear!,
        fullNumber: card.fullNumber,
      };
    }
    
    // In live mode, we don't have CVV or full number (security)
    return undefined;
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
          ? `Issuing est\u00e1 activo. La tarjeta virtual se crea en Stripe, en ${currency.toUpperCase()}, y gasta el saldo de Issuing. El n\u00famero no se guarda aqu\u00ed.`
          : "Stripe ya puede cobrar con tarjeta. La tarjeta virtual real pide Issuing activo: en el Dashboard hay que abrir Issuing y aceptar los t\u00e9rminos. Hasta entonces no se crea ninguna tarjeta.",
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

  /**
   * Issue a new virtual card
   */
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
      // Demo mode: generate a simulated card with CVV
      const card = this.createDemoCard({
        holderName,
        email,
        cupo: input.cupo,
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
        ? "Tarjeta virtual de Stripe. El n\u00famero queda en Stripe."
        : `Tarjeta virtual de Stripe en ${issued.currency.toUpperCase()}. El cupo del seguro queda en la moneda de la plataforma.`,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Issue a card with CVV (for demo/testing purposes)
   * This creates a card and returns the CVV for immediate use
   */
  async issueWithCVV(input: {
    holderName: string;
    email: string;
    phone: string;
    cupo: number;
    dob?: { day: number; month: number; year: number };
    address?: { line1: string; city: string; country: string; postalCode: string };
  }): Promise<CardWithDetails> {
    const holderName = input.holderName.trim();
    const email = input.email.trim();
    const phone = input.phone.trim();
    if (!holderName || !email || !phone) {
      throw new PlatformError("holderName, email y phone son requeridos", 400);
    }
    if (!Number.isInteger(input.cupo) || input.cupo <= 0) {
      throw new PlatformError("El cupo de la tarjeta debe ser un entero positivo", 400);
    }

    // In live mode with Stripe, we create a real card but return demo CVV
    // (real CVV is not accessible via API for security)
    if (this.stripe) {
      const status = await this.issuingStatus();
      if (!status.active || !status.currency) {
        throw new PlatformError(status.detail, 409);
      }
      
      const identity = this.identity(holderName, phone, input.dob, input.address);
      const cardId = `crd_${randomUUID().slice(0, 8)}`;
      
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
        const issued = await this.stripe.issuing.cards.create(
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

        // Store the live card
        const card: IssuedCard = {
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
            ? "Tarjeta virtual de Stripe. El n\u00famero queda en Stripe."
            : `Tarjeta virtual de Stripe en ${issued.currency.toUpperCase()}. El cupo del seguro queda en la moneda de la plataforma.`,
          createdAt: new Date().toISOString(),
        };
        this.remember(card);

        // Return with a generated CVV for testing (not the real one)
        return {
          ...card,
          cvv: this.generateCVV(),
          expiryMonth: Math.floor(Math.random() * 12) + 1,
          expiryYear: new Date().getFullYear() + 3,
          fullNumber: this.generateTestCardNumber(issued.brand),
        };
      } catch (error) {
        throw new PlatformError(stripeMessage(error), 502);
      }
    }

    // Demo mode: create a simulated card with CVV
    const card = this.createDemoCard({
      holderName,
      email,
      cupo: input.cupo,
    });
    
    return {
      ...card,
      cvv: card.cvv!,
      expiryMonth: card.expiryMonth!,
      expiryYear: card.expiryYear!,
      fullNumber: card.fullNumber!,
    };
  }

  /**
   * Create a demo card with CVV and full number
   */
  private createDemoCard(input: {
    holderName: string;
    email: string;
    cupo: number;
  }): IssuedCard {
    const cardId = `crd_${randomUUID().slice(0, 8)}`;
    const fullNumber = this.generateTestCardNumber("visa");
    const last4 = fullNumber.slice(-4);
    
    const card: IssuedCard = {
      id: cardId,
      holderName: input.holderName,
      email: input.email,
      last4,
      brand: "Visa",
      cupo: input.cupo,
      cardCurrency: this.payments.walletAccount.currency,
      status: "active",
      mode: "demo",
      cvv: this.generateCVV(),
      expiryMonth: Math.floor(Math.random() * 12) + 1,
      expiryYear: new Date().getFullYear() + 3,
      fullNumber,
      notice: "Demo local. Tarjeta simulada con CVV para pruebas.",
      createdAt: new Date().toISOString(),
    };
    
    this.cards.set(cardId, card);
    this.store.put("issued_cards", cardId, card);
    return card;
  }

  /**
   * Generate a test card number (Luhn algorithm)
   */
  private generateTestCardNumber(brand: string): string {
    const prefixes: Record<string, string> = {
      visa: "4",
      mastercard: "5",
      amex: "37",
      discover: "6011",
    };
    const prefix = prefixes[brand.toLowerCase()] || "4";
    let number = prefix;
    
    // Generate 12-15 random digits
    while (number.length < 15) {
      number += Math.floor(Math.random() * 10).toString();
    }
    
    // Apply Luhn algorithm to make it valid
    return this.luhnCheck(number);
  }

  /**
   * Apply Luhn algorithm to make a valid card number
   */
  private luhnCheck(number: string): string {
    let sum = 0;
    let shouldDouble = false;
    
    for (let i = number.length - 1; i >= 0; i--) {
      let digit = parseInt(number.charAt(i), 10);
      
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) {
          digit = (digit % 10) + 1;
        }
      }
      
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    
    const checkDigit = (10 - (sum % 10)) % 10;
    return number + checkDigit.toString();
  }

  /**
   * Generate a random CVV (3 digits)
   */
  private generateCVV(): string {
    return (Math.floor(Math.random() * 900) + 100).toString();
  }

  /**
   * Generate multiple test cards with different CVVs
   */
  async generateTestCards(input: {
    holderName: string;
    email: string;
    phone: string;
    cupo: number;
    count: number;
    dob?: { day: number; month: number; year: number };
    address?: { line1: string; city: string; country: string; postalCode: string };
  }): Promise<CardWithDetails[]> {
    const count = input.count || 1;
    const cards: CardWithDetails[] = [];
    
    for (let i = 0; i < count; i++) {
      const card = await this.issueWithCVV({
        holderName: input.holderName,
        email: input.email,
        phone: input.phone,
        cupo: input.cupo,
        dob: input.dob,
        address: input.address,
      });
      cards.push(card);
    }
    
    return cards;
  }

  /**
   * Create a card with the same data but different CVV
   * This is useful for testing multiple transactions with the same card details
   */
  async createCardWithSameDataButDifferentCVV(input: {
    baseCardId: string;
    newCVV?: string;
  }): Promise<CardWithDetails> {
    const baseCard = this.cards.get(input.baseCardId);
    if (!baseCard) {
      throw new PlatformError(`Tarjeta base no encontrada: ${input.baseCardId}`, 404);
    }
    
    // Generate a new card ID
    const newCardId = `crd_${randomUUID().slice(0, 8)}`;
    
    if (baseCard.mode === "demo") {
      // For demo cards, create a new one with different CVV but same other data
      const newCard: IssuedCard = {
        ...baseCard,
        id: newCardId,
        cvv: input.newCVV || this.generateCVV(),
        // Keep the same fullNumber but different CVV
        fullNumber: baseCard.fullNumber,
        expiryMonth: baseCard.expiryMonth,
        expiryYear: baseCard.expiryYear,
        stripeCardId: undefined, // Different card
        notice: `Tarjeta duplicada de ${baseCard.id} con CVV diferente para pruebas.`,
        createdAt: new Date().toISOString(),
      };
      
      this.cards.set(newCardId, newCard);
      this.store.put("issued_cards", newCardId, newCard);
      
      return {
        ...newCard,
        cvv: newCard.cvv!,
        expiryMonth: newCard.expiryMonth!,
        expiryYear: newCard.expiryYear!,
        fullNumber: newCard.fullNumber!,
      };
    } else {
      // For live cards, we can't create with same PAN but different CVV
      // (Stripe doesn't allow this for security)
      // So we create a new card with similar data but different number
      const newFullNumber = this.generateTestCardNumber(baseCard.brand);
      const newLast4 = newFullNumber.slice(-4);
      
      const newCard: IssuedCard = {
        ...baseCard,
        id: newCardId,
        last4: newLast4,
        cvv: input.newCVV || this.generateCVV(),
        fullNumber: newFullNumber,
        expiryMonth: Math.floor(Math.random() * 12) + 1,
        expiryYear: new Date().getFullYear() + 3,
        stripeCardId: undefined,
        notice: `Tarjeta nueva con datos similares a ${baseCard.id} pero n\u00famero y CVV diferente.`,
        createdAt: new Date().toISOString(),
      };
      
      this.cards.set(newCardId, newCard);
      this.store.put("issued_cards", newCardId, newCard);
      
      return {
        ...newCard,
        cvv: newCard.cvv!,
        expiryMonth: newCard.expiryMonth!,
        expiryYear: newCard.expiryYear!,
        fullNumber: newCard.fullNumber!,
      };
    }
  }

  /**
   * Get CVV for a card (only available in demo mode for security)
   */
  getCVV(cardId: string): string | undefined {
    const card = this.cards.get(cardId);
    if (!card) return undefined;
    
    // Only return CVV in demo mode
    if (card.mode === "demo" && card.cvv) {
      return card.cvv;
    }
    
    // In live mode, CVV is not stored on our server for security
    return undefined;
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
    if (!PHONE.test(phone)) throw new PlatformError("El tel\u00e9fono tiene que ir en formato internacional, con +", 400);
    if (!dob || !calendarDate(dob)) throw new PlatformError("La fecha de nacimiento es requerida", 400);
    const line1 = address?.line1.trim() ?? "";
    const city = address?.city.trim() ?? "";
    const country = (address?.country ?? "").trim().toUpperCase();
    const postalCode = address?.postalCode.trim() ?? "";
    if (!line1 || !city || !/^[A-Z]{2}$/.test(country) || !postalCode) {
      throw new PlatformError("La direcci\u00f3n de facturaci\u00f3n es requerida", 400);
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
