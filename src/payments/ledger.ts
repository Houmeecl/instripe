import { randomUUID } from "node:crypto";
import type { PlatformStore } from "../store/db.js";

export type TxKind = "credit" | "debit";

export interface LedgerEntry {
  id: string;
  accountId: string;
  kind: TxKind;
  amount: number;
  currency: string;
  reference: string;
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  currency: string;
  /** Balance in the smallest currency unit. */
  balance: number;
  createdAt: string;
}

/**
 * Payments ledger on SQLite. Every account holds a wallet balance and every
 * movement is a credit or a debit.
 */
export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly entries: LedgerEntry[] = [];

  constructor(private readonly store: PlatformStore) {
    for (const account of store.list<Account>("ledger_accounts")) this.accounts.set(account.id, account);
    this.entries.push(...store.list<LedgerEntry>("ledger_entries"));
  }

  createAccount(input: { name: string; email: string; currency: string }): Account {
    const account: Account = {
      id: `acct_${randomUUID().slice(0, 8)}`,
      name: input.name,
      email: input.email,
      currency: input.currency,
      balance: 0,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(account.id, account);
    this.store.put("ledger_accounts", account.id, account);
    return account;
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()];
  }

  post(kind: TxKind, accountId: string, amount: number, reference: string): LedgerEntry {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Unknown account: ${accountId}`);
    }
    if (amount <= 0) {
      throw new Error("Amount must be positive");
    }
    if (kind === "debit" && account.balance < amount) {
      throw new Error("Insufficient funds for disbursement");
    }
    account.balance += kind === "credit" ? amount : -amount;
    const entry: LedgerEntry = {
      id: `txn_${randomUUID().slice(0, 8)}`,
      accountId,
      kind,
      amount,
      currency: account.currency,
      reference,
      createdAt: new Date().toISOString(),
    };
    this.entries.push(entry);
    this.store.transaction(() => {
      this.store.put("ledger_accounts", account.id, account);
      this.store.put("ledger_entries", entry.id, entry);
    });
    return entry;
  }

  entriesFor(accountId: string): LedgerEntry[] {
    return this.entries.filter((entry) => entry.accountId === accountId);
  }
}
