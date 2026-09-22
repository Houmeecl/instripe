import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { AppConfig, GatewayName } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { PayoutResult } from "../../gateways/types.js";
import { createStripe, platformAccount, stripeMessage } from "../../stripe/client.js";

export interface ConnectedAccount {
  id: string;
  businessName: string;
  email: string;
  country: string;
  stripeAccountId?: string;
  onboardingUrl?: string;
  mode: "live" | "demo";
  notice?: string;
  createdAt: string;
}

const MODULE = "connect";

/**
 * Stripe Connect accounts. Creating one does not move money.
 * A payout to the account is a disbursement through payments.
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
  ) {
    this.stripe = createStripe(config);
  }

  list(): ConnectedAccount[] {
    return [...this.accounts.values()];
  }

  async create(input: { businessName: string; email: string }): Promise<ConnectedAccount> {
    const businessName = input.businessName.trim();
    const email = input.email.trim();
    if (!businessName || !email) throw new PlatformError("businessName y email son requeridos", 400);

    const account: ConnectedAccount = {
      id: `con_${randomUUID().slice(0, 8)}`,
      businessName,
      email,
      country: "ES",
      mode: "demo",
      createdAt: new Date().toISOString(),
    };

    if (this.stripe) {
      try {
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
            card_payments: { requested: true },
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
        account.mode = "live";
      } catch (error) {
        account.notice = stripeMessage(error);
      }
    }

    this.accounts.set(account.id, account);
    return account;
  }

  async payout(input: {
    accountId: string;
    amount: number;
    gateway: GatewayName;
  }): Promise<{ account: ConnectedAccount; payout: PayoutResult }> {
    const account = this.accounts.get(input.accountId);
    if (!account) throw new PlatformError(`Cuenta Connect desconocida: ${input.accountId}`, 404);
    if (input.amount <= 0) throw new PlatformError("El monto del pago debe ser positivo", 400);
    const destination = account.stripeAccountId ?? account.id;
    const { payout } = await this.payments.disburse({
      module: MODULE,
      reference: `cnp_${randomUUID().slice(0, 8)}`,
      amount: input.amount,
      description: `Pago Connect ${account.businessName}`,
      destination,
      gateway: input.gateway,
    });
    return { account, payout };
  }

  private async country(): Promise<string> {
    if (this.platformCountry) return this.platformCountry;
    if (!this.stripe) return "ES";
    const account = await platformAccount(this.stripe);
    this.platformCountry = account.country ?? "ES";
    return this.platformCountry;
  }
}
