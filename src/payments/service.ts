import { randomUUID } from "node:crypto";
import type { AppConfig, GatewayName } from "../config.js";
import { PlatformError } from "../errors.js";
import { GatewayRegistry } from "../gateways/registry.js";
import type { ChargeResult, PayoutResult } from "../gateways/types.js";
import { Ledger, type Account } from "./ledger.js";
import type { PlatformStore } from "../store/db.js";

export interface MoneyMovement {
  id: string;
  /** Which product module asked for this movement (`cuentas`, `cobros`, `seguros`). */
  module: string;
  kind: "collect" | "disburse";
  /** Id the module owns. Payments does not interpret it. */
  reference: string;
  amount: number;
  currency: string;
  gateway: GatewayName | null;
  mode: "live" | "demo" | null;
  status: "pending" | "paid" | "failed";
  externalId?: string;
  description: string;
  createdAt: string;
  reversedAmount?: number;
  adjustments?: string[];
  requestedBy?: string;
  authorizedBy?: string;
}

export interface ExitRequest {
  id: string;
  module: string;
  reference: string;
  amount: number;
  description: string;
  destination: string;
  gateway: GatewayName;
  requestedBy: string;
  ledgerAccountId?: string;
  status: "pending" | "paid";
  authorizedBy?: string;
  createdAt: string;
}

export interface CheckoutSettlement {
  reference: string | null | undefined;
  sessionId: string;
  amountTotal: number | null;
  currency: string | null;
  paymentStatus: string | null;
}

export interface SettleResult {
  fulfilled: boolean;
  reference?: string;
  /** Module that owns the reference, when the collection was found. */
  module?: string;
}

/** Appearance sent on Checkout Sessions. Product modules set it; payments does not interpret it. */
export interface CheckoutBranding {
  displayName: string;
  buttonColor: string;
  backgroundColor: string;
  borderStyle: "rounded" | "rectangular" | "pill";
}

type SettledListener = (movement: MoneyMovement) => void;

/**
 * Payments core: wallets, gateways, Checkout and disbursement.
 * Product modules call this. They never talk to Stripe directly.
 */
export class Payments {
  readonly ledger: Ledger;
  private readonly gateways: GatewayRegistry;
  private readonly wallet: Account;
  /** Confirmed Stripe collections only. Demo credits never land here. */
  private readonly transferable: Account;
  private readonly movements = new Map<string, MoneyMovement>();
  private readonly byReference = new Map<string, string>();
  private readonly listeners: SettledListener[] = [];
  private webhookEvents: { id: string; type: string; receivedAt: string }[] = [];
  private branding: CheckoutBranding | undefined;
  private readonly exits = new Map<string, ExitRequest>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: PlatformStore,
  ) {
    this.ledger = new Ledger(store);
    this.gateways = new GatewayRegistry(config);
    this.wallet = this.accountNamed("instripe Wallet", "wallet@instripe.internal", config.currency);
    this.transferable = this.accountNamed("Saldo transferible", "transferable@instripe.internal", config.currency);
    for (const movement of store.list<MoneyMovement>("movements")) {
      this.movements.set(movement.id, movement);
      this.byReference.set(this.key(movement.module, movement.reference, movement.kind), movement.id);
    }
    this.webhookEvents = store.get("webhook_events", "recent") ?? [];
    for (const exit of store.list<ExitRequest>("exits")) this.exits.set(exit.id, exit);
  }

  private accountNamed(name: string, email: string, currency: string): Account {
    return (
      this.ledger.listAccounts().find((account) => account.email === email) ??
      this.ledger.createAccount({ name, email, currency })
    );
  }

  get walletAccount(): Account {
    return this.wallet;
  }

  get transferableAccount(): Account {
    return this.transferable;
  }

  onSettled(listener: SettledListener): void {
    this.listeners.push(listener);
  }

  setBranding(branding: CheckoutBranding): void {
    this.branding = branding;
  }

  listGateways() {
    return this.gateways.list().map((gateway) => ({
      name: gateway.name,
      label: gateway.label,
      configured: gateway.configured,
    }));
  }

  list(): MoneyMovement[] {
    return [...this.movements.values()];
  }

  /**
   * Reserve a collection. The wallet is credited only when the gateway
   * confirms the payment (`settle`).
   */
  openCollect(input: { module: string; reference: string; amount: number; description: string }): MoneyMovement {
    const movement: MoneyMovement = {
      id: `pay_${randomUUID().slice(0, 8)}`,
      module: input.module,
      kind: "collect",
      reference: input.reference,
      amount: input.amount,
      currency: this.config.currency,
      gateway: null,
      mode: null,
      status: "pending",
      description: input.description,
      createdAt: new Date().toISOString(),
    };
    this.movements.set(movement.id, movement);
    this.byReference.set(this.key(input.module, input.reference, "collect"), movement.id);
    this.store.put("movements", movement.id, movement);
    return movement;
  }

  drop(module: string, reference: string): void {
    const id = this.byReference.get(this.key(module, reference, "collect"));
    if (!id) return;
    const movement = this.movements.get(id);
    if (!movement || movement.status !== "pending") return;
    this.movements.delete(id);
    this.byReference.delete(this.key(module, reference, "collect"));
    this.store.delete("movements", id);
  }

  async chargeOpen(module: string, reference: string, gatewayName: GatewayName, customerEmail: string): Promise<ChargeResult> {
    const movement = this.require(module, reference, "collect");
    const gateway = this.gateways.get(gatewayName);
    const charge = await gateway.charge({
      amount: movement.amount,
      currency: this.config.currency,
      description: movement.description,
      customerEmail,
      successUrl: `${this.config.publicBaseUrl}/?paid=1&ref=${encodeURIComponent(reference)}`,
      cancelUrl: `${this.config.publicBaseUrl}/?canceled=1`,
      returnUrl: `${this.config.publicBaseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { module, reference },
      branding: this.branding,
    });
    movement.gateway = gateway.name;
    movement.mode = charge.mode;
    movement.externalId = charge.chargeId;
    this.store.put("movements", movement.id, movement);
    const defer = gateway.name === "stripe" && gateway.configured;
    if (!defer) this.settle(reference, charge.chargeId, false);
    return charge;
  }

  /**
   * Credit the book for a pending collection. Safe to call twice.
   * Demo credits stay out of the transferable balance.
   */
  settle(reference: string | null | undefined, externalId: string, creditTransferable = false): SettleResult {
    if (!reference) return { fulfilled: false };
    const movement = this.findPendingCollect(reference);
    if (!movement) return { fulfilled: false, reference };
    this.creditPaid(movement, externalId, creditTransferable);
    return { fulfilled: true, reference, module: movement.module };
  }

  /**
   * Settle a Checkout session only when amount, currency and session id match.
   * `no_payment_required` does not settle a movement that has an amount.
   */
  settleCheckout(input: CheckoutSettlement): SettleResult {
    if (!input.reference || !input.sessionId) return { fulfilled: false, reference: input.reference ?? undefined };
    const movement = this.findPendingCollect(input.reference);
    if (!movement) return { fulfilled: false, reference: input.reference };
    if (movement.amount > 0 && input.paymentStatus === "no_payment_required") {
      return { fulfilled: false, reference: input.reference, module: movement.module };
    }
    if (input.paymentStatus !== "paid") {
      return { fulfilled: false, reference: input.reference, module: movement.module };
    }
    if (input.amountTotal !== movement.amount || (input.currency ?? "").toLowerCase() !== movement.currency) {
      return { fulfilled: false, reference: input.reference, module: movement.module };
    }
    if (movement.externalId && movement.externalId !== input.sessionId) {
      return { fulfilled: false, reference: input.reference, module: movement.module };
    }
    const live = movement.gateway === "stripe" && movement.mode === "live";
    this.creditPaid(movement, input.sessionId, live);
    return { fulfilled: true, reference: input.reference, module: movement.module };
  }

  failCheckout(reference: string | null | undefined, eventKey: string): boolean {
    if (!reference) return false;
    const paid = this.findCollect(reference, "paid");
    if (paid) return this.reverseCollection(reference, paid.amount - (paid.reversedAmount ?? 0), eventKey);
    const pending = this.findPendingCollect(reference);
    if (!pending || pending.adjustments?.includes(eventKey)) return false;
    pending.status = "failed";
    pending.adjustments = [...(pending.adjustments ?? []), eventKey];
    this.store.put("movements", pending.id, pending);
    return true;
  }

  reverseCollection(reference: string | undefined, amount: number, eventKey: string): boolean {
    if (!reference || amount <= 0) return false;
    const movement = this.findCollect(reference, "paid");
    if (!movement || movement.adjustments?.includes(eventKey)) return false;
    const room = movement.amount - (movement.reversedAmount ?? 0);
    const debit = Math.min(amount, room);
    if (debit <= 0) return false;
    this.ledger.post("debit", this.wallet.id, debit, `Reverso ${eventKey}`);
    if (movement.gateway === "stripe" && movement.mode === "live") {
      const take = Math.min(debit, this.transferable.balance);
      if (take > 0) this.ledger.post("debit", this.transferable.id, take, `Reverso ${eventKey}`);
    }
    movement.reversedAmount = (movement.reversedAmount ?? 0) + debit;
    movement.adjustments = [...(movement.adjustments ?? []), eventKey];
    this.store.put("movements", movement.id, movement);
    return true;
  }

  /** `amountReversed` is the cumulative reversed amount on the Transfer. */
  reverseTransfer(transferId: string, amountReversed: number, eventKey: string): boolean {
    const movement = [...this.movements.values()].find(
      (item) => item.kind === "disburse" && item.externalId === transferId,
    );
    if (!movement || movement.adjustments?.includes(eventKey)) return false;
    const delta = amountReversed - (movement.reversedAmount ?? 0);
    if (delta <= 0) return false;
    this.ledger.post("credit", this.wallet.id, delta, `Reverso ${transferId}`);
    if (movement.gateway === "stripe" && movement.mode === "live") {
      this.ledger.post("credit", this.transferable.id, delta, `Reverso ${transferId}`);
    }
    movement.reversedAmount = (movement.reversedAmount ?? 0) + delta;
    movement.adjustments = [...(movement.adjustments ?? []), eventKey];
    this.store.put("movements", movement.id, movement);
    return true;
  }

  seenWebhook(id: string): boolean {
    return this.webhookEvents.some((event) => event.id === id);
  }

  requestExit(input: {
    module: string;
    reference: string;
    amount: number;
    description: string;
    destination: string;
    gateway: GatewayName;
    requestedBy: string;
    ledgerAccountId?: string;
  }): ExitRequest {
    if (input.gateway === "stripe" && !/^acct_[A-Za-z0-9]+$/.test(input.destination)) {
      throw new PlatformError("El destino de un Transfer tiene que ser una cuenta conectada acct_", 422);
    }
    const exit: ExitRequest = {
      id: `ext_${randomUUID().slice(0, 8)}`,
      ...input,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.exits.set(exit.id, exit);
    this.store.put("exits", exit.id, exit);
    return exit;
  }

  listExits(): ExitRequest[] {
    return [...this.exits.values()];
  }

  getExit(id: string): ExitRequest | undefined {
    return this.exits.get(id);
  }

  async confirmExit(id: string, authorizerId: string): Promise<{ exit: ExitRequest; movement: MoneyMovement; payout: PayoutResult }> {
    const exit = this.exits.get(id);
    if (!exit || exit.status !== "pending") throw new PlatformError("Esa salida no está pendiente", 404);
    if (exit.requestedBy === authorizerId) {
      throw new PlatformError("Otro usuario de operación tiene que confirmar la salida", 403);
    }
    const result = await this.disburse({
      module: exit.module,
      reference: exit.reference,
      amount: exit.amount,
      description: exit.description,
      destination: exit.destination,
      gateway: exit.gateway,
      requestedBy: exit.requestedBy,
      authorizedBy: authorizerId,
    });
    exit.status = "paid";
    exit.authorizedBy = authorizerId;
    this.store.put("exits", exit.id, exit);
    return { exit, ...result };
  }

  async disburse(input: {
    module: string;
    reference: string;
    amount: number;
    description: string;
    destination: string;
    gateway: GatewayName;
    requestedBy?: string;
    authorizedBy?: string;
  }): Promise<{ movement: MoneyMovement; payout: PayoutResult }> {
    const gateway = this.gateways.get(input.gateway);
    const realStripe = gateway.name === "stripe" && gateway.configured;
    if (gateway.name === "stripe" && !/^acct_[A-Za-z0-9]+$/.test(input.destination)) {
      throw new PlatformError("El destino de un Transfer tiene que ser una cuenta conectada acct_", 422);
    }
    if (realStripe) {
      const available = gateway.available ? await gateway.available(this.config.currency) : 0;
      if (available < input.amount) {
        throw new PlatformError("Stripe no tiene saldo disponible en CLP para esta salida", 422);
      }
      if (this.transferable.balance < input.amount) {
        throw new PlatformError("El libro transferible no alcanza. Un abono demo no sale por Stripe", 422);
      }
    }
    let debitedWallet = false;
    let debitedTransferable = false;
    try {
      this.ledger.post("debit", this.wallet.id, input.amount, input.description);
      debitedWallet = true;
      if (realStripe) {
        this.ledger.post("debit", this.transferable.id, input.amount, input.description);
        debitedTransferable = true;
      }
      const payout = await gateway.payout({
        amount: input.amount,
        currency: this.config.currency,
        description: input.description,
        destination: input.destination,
      });
      const movement: MoneyMovement = {
        id: `pay_${randomUUID().slice(0, 8)}`,
        module: input.module,
        kind: "disburse",
        reference: input.reference,
        amount: input.amount,
        currency: this.config.currency,
        gateway: gateway.name,
        mode: payout.mode,
        status: payout.status === "paid" ? "paid" : "pending",
        externalId: payout.payoutId,
        description: input.description,
        createdAt: new Date().toISOString(),
        requestedBy: input.requestedBy,
        authorizedBy: input.authorizedBy,
      };
      this.movements.set(movement.id, movement);
      this.store.put("movements", movement.id, movement);
      return { movement, payout };
    } catch (error) {
      if (debitedTransferable) this.ledger.post("credit", this.transferable.id, input.amount, `Reverso ${input.description}`);
      if (debitedWallet) this.ledger.post("credit", this.wallet.id, input.amount, `Reverso ${input.description}`);
      if (error instanceof PlatformError) throw error;
      const message = error instanceof Error ? error.message : "La salida fue rechazada";
      throw new PlatformError(message, 502);
    }
  }

  private creditPaid(movement: MoneyMovement, externalId: string, creditTransferable: boolean): void {
    this.ledger.post("credit", this.wallet.id, movement.amount, `${movement.description} (${externalId})`);
    if (creditTransferable) {
      this.ledger.post("credit", this.transferable.id, movement.amount, `${movement.description} (${externalId})`);
    }
    movement.status = "paid";
    movement.externalId = externalId;
    this.store.put("movements", movement.id, movement);
    for (const listener of this.listeners) listener(movement);
  }

  recordWebhookEvent(id: string, type: string): void {
    this.webhookEvents.unshift({ id, type, receivedAt: new Date().toISOString() });
    if (this.webhookEvents.length > 20) this.webhookEvents.length = 20;
    this.store.put("webhook_events", "recent", this.webhookEvents);
  }

  listWebhookEvents() {
    return [...this.webhookEvents];
  }

  private findPendingCollect(reference: string): MoneyMovement | undefined {
    return this.findCollect(reference, "pending");
  }

  private findCollect(reference: string, status: MoneyMovement["status"]): MoneyMovement | undefined {
    for (const movement of this.movements.values()) {
      if (movement.kind === "collect" && movement.reference === reference && movement.status === status) {
        return movement;
      }
    }
    return undefined;
  }

  private require(module: string, reference: string, kind: MoneyMovement["kind"]): MoneyMovement {
    const id = this.byReference.get(this.key(module, reference, kind));
    const movement = id ? this.movements.get(id) : undefined;
    if (!movement) {
      throw new Error(`Unknown payment reference: ${reference}`);
    }
    return movement;
  }

  private key(module: string, reference: string, kind: MoneyMovement["kind"]): string {
    return `${module}:${kind}:${reference}`;
  }
}
