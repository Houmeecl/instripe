import type { PlatformStore } from "../../store/db.js";

/** Chart of accounts for remittances. */
export const ACCOUNTS = {
  cxc_tuu: "Cuenta por cobrar TUU",
  fondo_global66: "Fondo Global66 SICR3P (float)",
  ingreso_comision: "Ingreso por comisión y conversión",
  devolucion_cliente: "Devoluciones por pagar a clientes",
  banco: "Banco (depósito TUU)",
  gasto_comision_tuu: "Gasto comisión TUU",
} as const;

export type LedgerAccount = keyof typeof ACCOUNTS;

/** despacho: the transfer left Global66. rechazo: Global66 returned it. deposito_tuu: TUU paid the sale. */
export type LedgerEvent = "despacho" | "rechazo" | "deposito_tuu";

export interface LedgerLine {
  id: string;
  remesaId: string;
  code: string;
  event: LedgerEvent;
  account: LedgerAccount;
  debit: number;
  credit: number;
  createdAt: string;
}

/**
 * Double-entry ledger for remittances. Each event posts once (idempotent by remittance and event),
 * its lines always balance, and lines are never updated: a correction is a new event.
 */
export class RemesasLedger {
  constructor(private readonly store: PlatformStore) {}

  /** Posts a balanced entry. Returns false when that event was already posted for the remittance. */
  post(
    remesa: { id: string; code: string },
    event: LedgerEvent,
    lines: Array<{ account: LedgerAccount; debit?: number; credit?: number }>,
    at: string,
  ): boolean {
    const clean = lines
      .map((line) => ({ account: line.account, debit: Math.round(line.debit ?? 0), credit: Math.round(line.credit ?? 0) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const debit = clean.reduce((sum, line) => sum + line.debit, 0);
    const credit = clean.reduce((sum, line) => sum + line.credit, 0);
    if (!clean.length || debit !== credit) {
      throw new Error(`Asiento ${event} de ${remesa.code} no cuadra: debe ${debit}, haber ${credit}`);
    }
    if (this.has(remesa.id, event)) return false;
    this.store.transaction(() => {
      clean.forEach((line, index) => {
        const id = `${remesa.id}:${event}:${index}`;
        const row: LedgerLine = { id, remesaId: remesa.id, code: remesa.code, event, ...line, createdAt: at };
        this.store.putIfAbsent("remesas_ledger", id, row);
      });
    });
    return true;
  }

  has(remesaId: string, event: LedgerEvent): boolean {
    return Boolean(this.store.get<LedgerLine>("remesas_ledger", `${remesaId}:${event}:0`));
  }

  lines(filter: { remesaIds?: Set<string> } = {}): LedgerLine[] {
    return this.store
      .list<LedgerLine>("remesas_ledger")
      .filter((line) => !filter.remesaIds || filter.remesaIds.has(line.remesaId));
  }

  /** Balance per account (debit minus credit). */
  balances(filter: { remesaIds?: Set<string> } = {}) {
    const totals = new Map<LedgerAccount, { debit: number; credit: number }>();
    for (const line of this.lines(filter)) {
      const total = totals.get(line.account) ?? { debit: 0, credit: 0 };
      total.debit += line.debit;
      total.credit += line.credit;
      totals.set(line.account, total);
    }
    return (Object.keys(ACCOUNTS) as LedgerAccount[]).map((account) => {
      const total = totals.get(account) ?? { debit: 0, credit: 0 };
      return { account, name: ACCOUNTS[account], debit: total.debit, credit: total.credit, balance: total.debit - total.credit };
    });
  }
}
