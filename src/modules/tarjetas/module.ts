import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import { createStripe, platformAccount, stripeMessage } from "../../stripe/client.js";

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

const MODULE = "tarjetas";

/**
 * Issued cards. The full number never touches this server.
 * The cupo is the platform credit limit, not a collected payment.
 */
export class TarjetasModule {
  readonly id = MODULE;
  readonly label = "Tarjetas";
  private readonly cards = new Map<string, IssuedCard>();
  private readonly stripe: Stripe | undefined;
  private issuing: { country: string; currency: string } | undefined;

  constructor(
    private readonly payments: Payments,
    config: AppConfig,
  ) {
    this.stripe = createStripe(config);
  }

  list(): IssuedCard[] {
    return [...this.cards.values()];
  }

  async issue(input: { holderName: string; email: string; phone: string; cupo: number }): Promise<IssuedCard> {
    const holderName = input.holderName.trim();
    const email = input.email.trim();
    const phone = input.phone.trim();
    if (!holderName || !email || !phone) {
      throw new PlatformError("holderName, email y phone son requeridos", 400);
    }
    if (!Number.isFinite(input.cupo) || input.cupo <= 0) {
      throw new PlatformError("El cupo de la tarjeta debe ser positivo", 400);
    }

    const card: IssuedCard = {
      id: `crd_${randomUUID().slice(0, 8)}`,
      holderName,
      email,
      last4: randomUUID().replace(/\D/g, "").padEnd(4, "4").slice(0, 4),
      brand: "Visa",
      cupo: input.cupo,
      cardCurrency: this.payments.walletAccount.currency,
      status: "active",
      mode: "demo",
      createdAt: new Date().toISOString(),
    };

    if (this.stripe) {
      try {
        const issuing = await this.issuingProfile();
        const [first, ...rest] = holderName.split(/\s+/);
        const holder = await this.stripe.issuing.cardholders.create({
          name: holderName,
          email,
          phone_number: phone,
          type: "individual",
          individual: {
            first_name: first || holderName,
            last_name: rest.join(" ") || first || "Titular",
            dob: { day: 1, month: 1, year: 1990 },
          },
          billing: {
            address: {
              line1: "Calle Mayor 1",
              city: issuing.country === "ES" ? "Madrid" : "City",
              country: issuing.country,
              postal_code: issuing.country === "ES" ? "28013" : "10001",
            },
          },
          metadata: { module: MODULE, reference: card.id },
        });
        const sameCurrency = issuing.currency === card.cardCurrency;
        const params: Stripe.Issuing.CardCreateParams = {
          cardholder: holder.id,
          currency: issuing.currency,
          type: "virtual",
          status: "inactive",
          metadata: { module: MODULE, reference: card.id, cupo: String(input.cupo) },
          ...(sameCurrency
            ? { spending_controls: { spending_limits: [{ amount: input.cupo, interval: "all_time" as const }] } }
            : {}),
        };
        const issued = await this.stripe.issuing.cards.create(params);
        card.stripeCardId = issued.id;
        card.last4 = issued.last4;
        card.brand = issued.brand;
        card.cardCurrency = issued.currency;
        card.status = issued.status === "active" ? "active" : "inactive";
        card.mode = "live";
        if (!sameCurrency) {
          card.notice = `Emitida en ${issued.currency.toUpperCase()}. El cupo queda en la moneda de la plataforma.`;
        }
      } catch (error) {
        card.notice = stripeMessage(error);
      }
    }

    this.cards.set(card.id, card);
    return card;
  }

  private async issuingProfile(): Promise<{ country: string; currency: string }> {
    if (this.issuing) return this.issuing;
    if (!this.stripe) return { country: "ES", currency: this.payments.walletAccount.currency };
    const account = await platformAccount(this.stripe);
    this.issuing = {
      country: account.country ?? "ES",
      currency: (account.default_currency ?? "eur").toLowerCase(),
    };
    return this.issuing;
  }
}
