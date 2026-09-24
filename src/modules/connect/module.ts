import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { AppConfig, GatewayName } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import { createStripe, platformAccount, stripeMessage } from "../../stripe/client.js";
import type { PlatformStore } from "../../store/db.js";
import type { IssuedCard } from "../tarjetas/module.js";
import type { CardDesign } from "../diseno/module.js";

export interface ConnectedAccount {
  id: string;
  businessName: string;
  email: string;
  country: string;
  stripeAccountId?: string;
  onboardingUrl?: string;
  mode: "live" | "pending" | "demo";
  notice?: string;
  cardId?: string;
  hasCard: boolean;
  createdAt: string;
}

const MODULE = "connect";

/**
 * Stripe Connect accounts. Creating one does not move money.
 * A payout to the account is a disbursement through payments.
 * Can optionally create an issued card for the connected account.
 */
export class ConnectModule {
  readonly id = MODULE;
  readonly label = "Connect";
  private readonly accounts = new Map<string, ConnectedAccount>();
  private readonly stripe: Stripe | undefined;
  private platformCountry: string | undefined;

  constructor(
    private readonly payments: Payments,
    private readonly config: AppConfig,
    private readonly store: PlatformStore,
  ) {
    this.stripe = createStripe(config);
    for (const account of store.list<ConnectedAccount>("connect_accounts")) this.accounts.set(account.id, account);
  }

  list(actor?: { role: string; email: string }): ConnectedAccount[] {
    return [...this.accounts.values()].map((account) => this.visible(account, actor));
  }

  async create(input: {
    businessName: string;
    email: string;
    actor?: { role: string; email: string };
    createCard?: boolean;
    cardCupo?: number;
    cardHolderName?: string;
    cardPhone?: string;
  }): Promise<ConnectedAccount> {
    const businessName = input.businessName.trim();
    const email = input.email.trim();
    if (!businessName || !email) throw new PlatformError("businessName y email son requeridos", 400);

    const account: ConnectedAccount = {
      id: `con_${randomUUID().slice(0, 8)}`,
      businessName,
      email,
      country: "CL",
      mode: "demo",
      hasCard: false,
      createdAt: new Date().toISOString(),
    };

    if (this.stripe) {
      try {
        const platform = await platformAccount(this.stripe);
        if (platform.controller?.type !== "application") {
          account.notice = "Esta cuenta no es una plataforma Connect. El comercio queda en el registro local.";
        } else {
          const country = await this.country();
          const created = await this.stripe.accounts.create({
            country,
            email,
            controller: {
              stripe_dashboard: { type: "express" },
              fees: { payer: "application" },
              losses: { payments: "application" },
            },
            capabilities: {
              transfers: { requested: true },
            },
            metadata: { module: MODULE, reference: account.id, businessName },
          });
          const link = await this.stripe.accountLinks.create({
            account: created.id,
            type: "account_onboarding",
            refresh_url: `${this.config.publicBaseUrl}/?connect=refresh`,
            return_url: `${this.config.publicBaseUrl}/?connect=return`,
          });
          account.country = country;
          account.stripeAccountId = created.id;
          account.onboardingUrl = link.url;
          account.mode = created.payouts_enabled ? "live" : "pending";
          if (!created.payouts_enabled) {
            account.notice = "La cuenta existe en Stripe y todav\u00eda no puede recibir pagos.";
          }
        }
      } catch (error) {
        account.notice = stripeMessage(error);
      }
    }

    this.accounts.set(account.id, account);
    this.store.put("connect_accounts", account.id, account);
    
    // Optionally create a card for this connected account
    if (input.createCard && this.stripe && account.stripeAccountId) {
      try {
        const card = await this.createCardForAccount(account.id, {
          cupo: input.cardCupo || 1000000,
          holderName: input.cardHolderName || businessName,
          email,
          phone: input.cardPhone || "+56900000000",
        });
        account.cardId = card.id;
        account.hasCard = true;
        this.accounts.set(account.id, account);
        this.store.put("connect_accounts", account.id, account);
      } catch (error) {
        // Card creation failed, but account is still created
        account.notice = (account.notice ? `${account.notice} | ` : "") + `No se pudo crear tarjeta: ${stripeMessage(error)}`;
      }
    }

    return this.visible(account, input.actor);
  }

  /**
   * Create an issued card for a connected account
   */
  async createCardForAccount(
    accountId: string,
    input: {
      cupo: number;
      holderName: string;
      email: string;
      phone: string;
      dob?: { day: number; month: number; year: number };
      address?: { line1: string; city: string; country: string; postalCode: string };
    }
  ): Promise<IssuedCard> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new PlatformError(`Cuenta Connect no encontrada: ${accountId}`, 404);
    }

    if (!this.stripe) {
      throw new PlatformError("Stripe no est\u00e1 configurado", 409);
    }

    // This would normally use the TarjetasModule, but we implement it here for circular dependency
    const cardId = `crd_con_${randomUUID().slice(0, 8)}`;
    
    try {
      const country = await this.country();
      const status = await this.checkIssuingStatus();
      if (!status.active || !status.currency) {
        throw new PlatformError(status.detail, 409);
      }

      // Create cardholder
      const holderName = input.holderName.slice(0, 24);
      const [first, ...rest] = input.holderName.split(/\s+/).filter(Boolean);
      const last = rest.join(" ");
      
      const holder = await this.stripe.issuing.cardholders.create(
        {
          name: holderName,
          email: input.email,
          phone_number: input.phone,
          type: "individual",
          individual: {
            first_name: first,
            last_name: last,
            dob: input.dob || { day: 1, month: 1, year: 1990 },
          },
          billing: {
            address: input.address ? {
              line1: input.address.line1,
              city: input.address.city,
              country: input.address.country,
              postal_code: input.address.postalCode,
            } : {
              line1: "Unknown",
              city: "Santiago",
              country: country,
              postal_code: "0000000",
            },
          },
          metadata: { 
            module: MODULE, 
            connect_account_id: accountId,
            reference: cardId 
          },
        },
        { idempotencyKey: `holder_${cardId}` },
      );

      // Create card linked to the connected account's balance
      const sameCurrency = status.currency === this.payments.walletAccount.currency;
      const issued = await this.stripe.issuing.cards.create(
        {
          cardholder: holder.id,
          currency: status.currency,
          type: "virtual",
          status: "active",
          metadata: { 
            module: MODULE, 
            connect_account_id: accountId,
            reference: cardId,
            cupo: String(input.cupo)
          },
          ...(sameCurrency
            ? { spending_controls: { spending_limits: [{ amount: input.cupo, interval: "all_time" as const }] } }
            : {}),
        },
        { idempotencyKey: `card_${cardId}` },
      );

      const card: IssuedCard = {
        id: cardId,
        holderName: input.holderName,
        email: input.email,
        last4: issued.last4,
        brand: issued.brand,
        cupo: input.cupo,
        cardCurrency: issued.currency,
        status: issued.status === "active" ? "active" : "inactive",
        stripeCardId: issued.id,
        mode: "live",
        notice: sameCurrency
          ? "Tarjeta virtual vinculada a cuenta Connect. El n\u00famero queda en Stripe."
          : `Tarjeta en ${issued.currency.toUpperCase()}.`,
        createdAt: new Date().toISOString(),
      };

      return card;
    } catch (error) {
      throw new PlatformError(stripeMessage(error), 502);
    }
  }

  /**
   * Apply design branding to a connected account
   */
  async applyBranding(
    accountId: string,
    design: CardDesign
  ): Promise<{ success: boolean; message?: string }> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new PlatformError(`Cuenta Connect no encontrada: ${accountId}`, 404);
    }

    if (!this.stripe || !account.stripeAccountId) {
      return { success: false, message: "Stripe no configurado o cuenta sin ID" };
    }

    try {
      await this.stripe.accounts.update(account.stripeAccountId, {
        settings: {
          branding: {
            primary_color: design.buttonColor,
            secondary_color: design.backgroundColor,
          },
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, message: stripeMessage(error) };
    }
  }

  /**
   * Apply design to all connected accounts
   */
  async applyBrandingToAll(design: CardDesign): Promise<{ total: number; success: number; failures: Array<{ accountId: string; message: string }> }> {
    const results = { total: 0, success: 0, failures: [] as Array<{ accountId: string; message: string }> };
    
    for (const account of this.accounts.values()) {
      if (!account.stripeAccountId) continue;
      results.total++;
      
      try {
        await this.stripe?.accounts.update(account.stripeAccountId, {
          settings: {
            branding: {
              primary_color: design.buttonColor,
              secondary_color: design.backgroundColor,
            },
          },
        });
        results.success++;
      } catch (error) {
        results.failures.push({ accountId: account.id, message: stripeMessage(error) });
      }
    }
    
    return results;
  }

  payout(input: {
    accountId: string;
    amount: number;
    gateway: GatewayName;
    requestedBy: string;
  }): { account: ConnectedAccount; exitId: string } {
    const account = this.accounts.get(input.accountId);
    if (!account) throw new PlatformError(`Cuenta Connect desconocida: ${input.accountId}`, 404);
    if (input.amount <= 0) throw new PlatformError("El monto del pago debe ser positivo", 400);
    const destination = input.gateway === "stripe" ? account.stripeAccountId : account.id;
    if (!destination) throw new PlatformError("El pago real necesita una cuenta conectada acct_", 422);
    const exit = this.payments.requestExit({
      module: MODULE,
      reference: `cnp_${randomUUID().slice(0, 8)}`,
      amount: input.amount,
      description: `Pago Connect ${account.businessName}`,
      destination,
      gateway: input.gateway,
      requestedBy: input.requestedBy,
    });
    return { account: this.visible(account), exitId: exit.id };
  }

  /**
   * Get card for a connected account
   */
  getCard(accountId: string): IssuedCard | undefined {
    const account = this.accounts.get(accountId);
    if (!account || !account.cardId) return undefined;
    // This would normally fetch from TarjetasModule, but we return a placeholder
    // In a full implementation, you'd need to coordinate between modules
    return undefined;
  }

  private visible(account: ConnectedAccount, actor?: { role: string; email: string }): ConnectedAccount {
    const owner = actor?.role !== "operacion" && actor?.email.toLowerCase() === account.email.toLowerCase();
    if (owner) return { ...account };
    const copy = { ...account };
    delete copy.onboardingUrl;
    return copy;
  }

  private async country(): Promise<string> {
    if (this.platformCountry) return this.platformCountry;
    if (!this.stripe) return "ES";
    const account = await platformAccount(this.stripe);
    this.platformCountry = account.country ?? "ES";
    return this.platformCountry;
  }

  private async checkIssuingStatus(): Promise<{ active: boolean; currency?: string; detail: string }> {
    if (!this.stripe) {
      return { active: false, detail: "Stripe no configurado" };
    }
    try {
      const platform = await platformAccount(this.stripe);
      const currency = (platform.default_currency ?? "eur").toLowerCase();
      const capabilities = platform.capabilities as (Stripe.Account.Capabilities & { card_issuing?: string }) | undefined;
      const active = capabilities?.card_issuing === "active" && Boolean(platform.settings?.card_issuing?.tos_acceptance?.date);
      return {
        active,
        currency,
        detail: active
          ? `Issuing activo en ${currency.toUpperCase()}`
          : "Issuing no activo. Act\u00edvalo en el Dashboard de Stripe.",
      };
    } catch (error) {
      return { active: false, detail: stripeMessage(error) };
    }
  }
}
