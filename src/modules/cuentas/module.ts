import { randomUUID } from "node:crypto";
import type { GatewayName } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { ChargeResult } from "../../gateways/types.js";
import type { PlatformStore } from "../../store/db.js";

export interface CustomerAccount {
  id: string;
  name: string;
  email: string;
  ledgerAccountId: string;
  memberId?: string;
  createdAt: string;
}

export interface Topup {
  id: string;
  accountId: string;
  amount: number;
  status: "pending" | "paid";
  paymentId?: string;
  createdAt: string;
}

const MODULE = "cuentas";

/**
 * BaaS wallets. Opening an account is local; funding and withdrawals
 * are payment movements tagged `cuentas`.
 */
export class CuentasModule {
  readonly id = MODULE;
  readonly label = "Cuentas";
  private readonly accounts = new Map<string, CustomerAccount>();
  private readonly topups = new Map<string, Topup>();

  constructor(
    private readonly payments: Payments,
    private readonly store: PlatformStore,
  ) {
    for (const account of store.list<CustomerAccount>("cuentas")) this.accounts.set(account.id, account);
    for (const topup of store.list<Topup>("topups")) this.topups.set(topup.id, topup);
    payments.onSettled((movement) => {
      if (movement.module !== MODULE || movement.kind !== "collect") return;
      const topup = this.topups.get(movement.reference);
      if (!topup || topup.status === "paid") return;
      const account = this.accounts.get(topup.accountId);
      if (!account) return;
      this.payments.ledger.post(
        "credit",
        account.ledgerAccountId,
        topup.amount,
        `Recarga ${account.name} (${movement.externalId ?? movement.id})`,
      );
      topup.status = "paid";
      topup.paymentId = movement.id;
      this.store.put("topups", topup.id, topup);
    });
  }

  list() {
    return [...this.accounts.values()].map((account) => this.withBalance(account));
  }

  listFor(actor: { role: string; memberId?: string }) {
    return this.list().filter((account) => this.owns(actor, account));
  }

  bindMember(accountId: string, memberId: string): void {
    const account = this.accounts.get(accountId);
    if (!account || account.memberId) return;
    account.memberId = memberId;
    this.store.put("cuentas", account.id, account);
  }

  open(input: { name: string; email: string; memberId?: string }): CustomerAccount {
    const name = input.name.trim();
    const email = input.email.trim();
    if (!name || !email) throw new PlatformError("name y email son requeridos", 400);
    const ledgerAccount = this.payments.ledger.createAccount({
      name,
      email,
      currency: this.payments.walletAccount.currency,
    });
    const account: CustomerAccount = {
      id: `cta_${randomUUID().slice(0, 8)}`,
      name,
      email,
      ledgerAccountId: ledgerAccount.id,
      memberId: input.memberId,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(account.id, account);
    this.store.put("cuentas", account.id, account);
    return account;
  }

  async fund(input: {
    accountId: string;
    amount: number;
    gateway: GatewayName;
    email?: string;
    actor: { role: string; memberId?: string };
  }): Promise<{
    account: CustomerAccount & { balance: number };
    topup: Topup;
    charge: ChargeResult;
  }> {
    const account = this.requireOwned(input.accountId, input.actor);
    if (input.amount <= 0) throw new PlatformError("El monto de la recarga debe ser positivo", 400);
    const topup: Topup = {
      id: `top_${randomUUID().slice(0, 8)}`,
      accountId: account.id,
      amount: input.amount,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.topups.set(topup.id, topup);
    this.store.put("topups", topup.id, topup);
    const movement = this.payments.openCollect({
      module: MODULE,
      reference: topup.id,
      amount: input.amount,
      description: `Recarga ${account.name}`,
    });
    topup.paymentId = movement.id;
    this.store.put("topups", topup.id, topup);
    try {
      const charge = await this.payments.chargeOpen(MODULE, topup.id, input.gateway, input.email || account.email);
      return { account: { ...account, balance: this.balanceOf(account) }, topup, charge };
    } catch (error) {
      this.topups.delete(topup.id);
      this.store.delete("topups", topup.id);
      this.payments.drop(MODULE, topup.id);
      throw error;
    }
  }

  withdraw(input: {
    accountId: string;
    amount: number;
    destination: string;
    gateway: GatewayName;
    requestedBy: string;
    actor: { role: string; memberId?: string };
  }): { account: CustomerAccount & { balance: number }; exitId: string } {
    const account = this.requireOwned(input.accountId, input.actor);
    if (input.amount <= 0) throw new PlatformError("El monto del retiro debe ser positivo", 400);
    if (!input.destination.trim()) throw new PlatformError("destination es requerido", 400);
    if (this.balanceOf(account) < input.amount) {
      throw new PlatformError("Saldo insuficiente en la cuenta", 422);
    }
    const withdrawalId = `ret_${randomUUID().slice(0, 8)}`;
    const exit = this.payments.requestExit({
      module: MODULE,
      reference: withdrawalId,
      amount: input.amount,
      description: `Retiro ${account.name}`,
      destination: input.destination.trim(),
      gateway: input.gateway,
      requestedBy: input.requestedBy,
      ledgerAccountId: account.ledgerAccountId,
    });
    return { account: this.withBalance(account), exitId: exit.id };
  }

  private requireOwned(id: string, actor: { role: string; memberId?: string }): CustomerAccount {
    const account = this.accounts.get(id);
    if (!account) throw new PlatformError(`Cuenta desconocida: ${id}`, 404);
    if (!this.owns(actor, account)) throw new PlatformError("Esta cuenta no está en tu rol", 403);
    return account;
  }

  private owns(actor: { role: string; memberId?: string }, account: CustomerAccount): boolean {
    if (actor.role === "operacion") return true;
    return Boolean(actor.memberId && account.memberId === actor.memberId);
  }

  private withBalance(account: CustomerAccount): CustomerAccount & { balance: number } {
    return { ...account, balance: this.balanceOf(account) };
  }

  private balanceOf(account: CustomerAccount): number {
    return this.payments.ledger.getAccount(account.ledgerAccountId)?.balance ?? 0;
  }
}
