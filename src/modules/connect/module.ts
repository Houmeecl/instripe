import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { AppConfig, GatewayName } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import { createStripe, platformAccount, stripeMessage } from "../../stripe/client.js";
import type { PlatformStore } from "../../store/db.js";

export interface ConnectedAccount {
  id: string;
  businessName: string;
  email: string;
  country: string;
  stripeAccountId?: string;
  onboardingUrl?: string;
  mode: "live" | "pending" | "demo";
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
      createdAt: new Date().toISOString(),
    };

    if (this.stripe) {
      // Stripe rejects the call when the account has not signed up for Connect; that message becomes the notice.
      try {
        const country = await this.country(this.stripe);
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
          account.notice = "La cuenta existe en Stripe y todavía no puede recibir pagos.";
        }
      } catch (error) {
        account.notice = stripeMessage(error);
      }
    }

    this.accounts.set(account.id, account);
    this.store.put("connect_accounts", account.id, account);
    return this.visible(account, input.actor);
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

  private visible(account: ConnectedAccount, actor?: { role: string; email: string }): ConnectedAccount {
    const owner = actor?.role !== "operacion" && actor?.email.toLowerCase() === account.email.toLowerCase();
    if (owner) return { ...account };
    const copy = { ...account };
    delete copy.onboardingUrl;
    return copy;
  }

  private async country(stripe: Stripe): Promise<string> {
    if (this.platformCountry) return this.platformCountry;
    const account = await platformAccount(stripe);
    if (!account.country) throw new PlatformError("Stripe no informó el país de la cuenta de la plataforma", 502);
    this.platformCountry = account.country;
    return this.platformCountry;
  }
}
