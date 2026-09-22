import { randomUUID } from "node:crypto";
import type { AppConfig, GatewayName } from "../config.js";
import { GatewayRegistry } from "../gateways/registry.js";
import type { ChargeResult, PayoutResult } from "../gateways/types.js";
import { Ledger, type Account } from "./ledger.js";

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
  status: "pending" | "paid";
  externalId?: string;
  description: string;
  createdAt: string;
}

export interface SettleResult {
  fulfilled: boolean;
  reference?: string;
  /** Module that owns the reference, when the collection was found. */
  module?: string;
}

type SettledListener = (movement: MoneyMovement) => void;

/**
 * Payments core: wallets, gateways, Checkout and disbursement.
 * Product modules call this. They never talk to Stripe directly.
 */
export class Payments {
  readonly ledger = new Ledger();
  private readonly gateways: GatewayRegistry;
  private readonly wallet: Account;
  private readonly movements = new Map<string, MoneyMovement>();
  private readonly byReference = new Map<string, string>();
  private readonly listeners: SettledListener[] = [];
  private readonly webhookEvents: { id: string; type: string; receivedAt: string }[] = [];

  constructor(private readonly config: AppConfig) {
    this.gateways = new GatewayRegistry(config);
    this.wallet = this.ledger.createAccount({
      name: "instripe Wallet",
      email: "wallet@instripe.internal",
      currency: config.currency,
    });
  }

  get walletAccount(): Account {
    return this.wallet;
  }

  onSettled(listener: SettledListener): void {
    this.listeners.push(listener);
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
    return movement;
  }

  drop(module: string, reference: string): void {
    const id = this.byReference.get(this.key(module, reference, "collect"));
    if (!id) return;
    const movement = this.movements.get(id);
    if (!movement || movement.status !== "pending") return;
    this.movements.delete(id);
    this.byReference.delete(this.key(module, reference, "collect"));
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
    });
    movement.gateway = gateway.name;
    movement.mode = charge.mode;
    movement.externalId = charge.chargeId;
    const defer = gateway.name === "stripe" && gateway.configured;
    if (!defer) this.settle(reference, charge.chargeId);
    return charge;
  }

  /**
   * Credit the wallet for a pending collection. Safe to call twice.
   */
  settle(reference: string | null | undefined, externalId: string): SettleResult {
    if (!reference) return { fulfilled: false };
    const movement = this.findPendingCollect(reference);
    if (!movement) return { fulfilled: false, reference };
    this.ledger.post("credit", this.wallet.id, movement.amount, `${movement.description} (${externalId})`);
    movement.status = "paid";
    movement.externalId = externalId;
    for (const listener of this.listeners) listener(movement);
    return { fulfilled: true, reference, module: movement.module };
  }

  async disburse(input: {
    module: string;
    reference: string;
    amount: number;
    description: string;
    destination: string;
    gateway: GatewayName;
  }): Promise<{ movement: MoneyMovement; payout: PayoutResult }> {
    this.ledger.post("debit", this.wallet.id, input.amount, input.description);
    const gateway = this.gateways.get(input.gateway);
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
    };
    this.movements.set(movement.id, movement);
    return { movement, payout };
  }

  recordWebhookEvent(id: string, type: string): void {
    this.webhookEvents.unshift({ id, type, receivedAt: new Date().toISOString() });
    if (this.webhookEvents.length > 20) this.webhookEvents.length = 20;
  }

  listWebhookEvents() {
    return [...this.webhookEvents];
  }

  private findPendingCollect(reference: string): MoneyMovement | undefined {
    for (const movement of this.movements.values()) {
      if (movement.kind === "collect" && movement.reference === reference && movement.status === "pending") {
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
