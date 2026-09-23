import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { GatewayName } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { ChargeResult } from "../../gateways/types.js";
import { createStripe, platformAccount, stripeMessage } from "../../stripe/client.js";
import { treasuryAvailability } from "../../stripe/country.js";
import type { AppConfig } from "../../config.js";
import type { PlatformStore } from "../../store/db.js";

export interface FinancialAccount {
  id: string;
  nickname: string;
  connectedId?: string;
  stripeFinancialAccountId?: string;
  balance: number;
  currency: string;
  mode: "live" | "demo";
  notice?: string;
  createdAt: string;
}

export interface TreasuryInbound {
  id: string;
  financialAccountId: string;
  amount: number;
  status: "pending" | "paid";
  paymentId?: string;
  createdAt: string;
}

const MODULE = "treasury";

/**
 * Treasury financial accounts. Funding is a collection through payments.
 * Stripe Treasury is used only where Stripe offers it for the platform's country.
 */
export class TreasuryModule {
  readonly id = MODULE;
  readonly label = "Treasury";
  private readonly accounts = new Map<string, FinancialAccount>();
  private readonly inbounds = new Map<string, TreasuryInbound>();
  private readonly stripe: Stripe | undefined;

  constructor(
    private readonly payments: Payments,
    config: AppConfig,
    private readonly store: PlatformStore,
  ) {
    this.stripe = createStripe(config);
    for (const account of store.list<FinancialAccount>("treasury_accounts")) this.accounts.set(account.id, account);
    for (const inbound of store.list<TreasuryInbound>("treasury_inbounds")) this.inbounds.set(inbound.id, inbound);
    payments.onSettled((movement) => {
      if (movement.module !== MODULE || movement.kind !== "collect") return;
      const inbound = this.inbounds.get(movement.reference);
      if (!inbound || inbound.status === "paid") return;
      const account = this.accounts.get(inbound.financialAccountId);
      if (!account) return;
      account.balance += inbound.amount;
      inbound.status = "paid";
      inbound.paymentId = movement.id;
      this.store.transaction(() => {
        this.store.put("treasury_accounts", account.id, account);
        this.store.put("treasury_inbounds", inbound.id, inbound);
      });
    });
  }

  list(): FinancialAccount[] {
    return [...this.accounts.values()];
  }

  async open(input: { nickname: string; connectedId?: string }): Promise<FinancialAccount> {
    const nickname = input.nickname.trim();
    if (!nickname) throw new PlatformError("nickname es requerido", 400);
    const account: FinancialAccount = {
      id: `tsy_${randomUUID().slice(0, 8)}`,
      nickname,
      connectedId: input.connectedId?.trim() || undefined,
      balance: 0,
      currency: this.payments.walletAccount.currency,
      mode: "demo",
      createdAt: new Date().toISOString(),
    };

    if (this.stripe && account.currency === "clp") {
      account.notice = "Treasury no se abre en CLP. El abono queda en el libro local.";
    } else if (this.stripe) {
      try {
        const platform = await platformAccount(this.stripe);
        const availability = treasuryAvailability(platform.country ?? "");
        if (!availability.usable) {
          account.notice = availability.detail;
          return this.remember(account);
        }
        const created = await this.stripe.treasury.financialAccounts.create({
          supported_currencies: [account.currency],
          nickname,
          metadata: { module: MODULE, reference: account.id },
        });
        account.stripeFinancialAccountId = created.id;
        account.mode = "live";
      } catch (error) {
        const message = stripeMessage(error);
        account.notice = /treasury/i.test(message)
          ? "Treasury no está activo en esta cuenta de Stripe. El abono igual entra por pagos."
          : message;
      }
    }

    return this.remember(account);
  }

  private remember(account: FinancialAccount): FinancialAccount {
    this.accounts.set(account.id, account);
    this.store.put("treasury_accounts", account.id, account);
    return account;
  }

  async fund(input: {
    accountId: string;
    amount: number;
    gateway: GatewayName;
    email?: string;
  }): Promise<{ account: FinancialAccount; inbound: TreasuryInbound; charge: ChargeResult }> {
    const account = this.accounts.get(input.accountId);
    if (!account) throw new PlatformError(`Cuenta Treasury desconocida: ${input.accountId}`, 404);
    if (input.amount <= 0) throw new PlatformError("El abono debe ser positivo", 400);
    const inbound: TreasuryInbound = {
      id: `tin_${randomUUID().slice(0, 8)}`,
      financialAccountId: account.id,
      amount: input.amount,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.inbounds.set(inbound.id, inbound);
    this.store.put("treasury_inbounds", inbound.id, inbound);
    const movement = this.payments.openCollect({
      module: MODULE,
      reference: inbound.id,
      amount: input.amount,
      description: `Abono Treasury ${account.nickname}`,
    });
    inbound.paymentId = movement.id;
    this.store.put("treasury_inbounds", inbound.id, inbound);
    try {
      const charge = await this.payments.chargeOpen(
        MODULE,
        inbound.id,
        input.gateway,
        input.email || "treasury@instripe.internal",
      );
      return { account, inbound, charge };
    } catch (error) {
      this.inbounds.delete(inbound.id);
      this.store.delete("treasury_inbounds", inbound.id);
      this.payments.drop(MODULE, inbound.id);
      throw error;
    }
  }
}
