import { randomUUID } from "node:crypto";
import type { GatewayName } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { ChargeResult } from "../../gateways/types.js";

export interface Cobro {
  id: string;
  concept: string;
  payerName: string;
  email: string;
  amount: number;
  status: "pending_payment" | "paid";
  paymentId?: string;
  createdAt: string;
}

const MODULE = "cobros";

/**
 * Generic collections. A cobro is not a policy: it is a payment request
 * that settles through the payments core.
 */
export class CobrosModule {
  readonly id = MODULE;
  readonly label = "Cobros";
  private readonly cobros = new Map<string, Cobro>();

  constructor(private readonly payments: Payments) {
    payments.onSettled((movement) => {
      if (movement.module !== MODULE || movement.kind !== "collect") return;
      const cobro = this.cobros.get(movement.reference);
      if (!cobro || cobro.status === "paid") return;
      cobro.status = "paid";
      cobro.paymentId = movement.id;
    });
  }

  list(): Cobro[] {
    return [...this.cobros.values()];
  }

  async create(input: {
    concept: string;
    payerName: string;
    email: string;
    amount: number;
    gateway: GatewayName;
  }): Promise<{ cobro: Cobro; charge: ChargeResult }> {
    const concept = input.concept.trim();
    const payerName = input.payerName.trim();
    const email = input.email.trim();
    if (!concept || !payerName || !email) {
      throw new PlatformError("concept, payerName y email son requeridos", 400);
    }
    if (input.amount <= 0) throw new PlatformError("El monto del cobro debe ser positivo", 400);

    const cobro: Cobro = {
      id: `cob_${randomUUID().slice(0, 8)}`,
      concept,
      payerName,
      email,
      amount: input.amount,
      status: "pending_payment",
      createdAt: new Date().toISOString(),
    };
    this.cobros.set(cobro.id, cobro);
    const movement = this.payments.openCollect({
      module: MODULE,
      reference: cobro.id,
      amount: input.amount,
      description: concept,
    });
    cobro.paymentId = movement.id;
    try {
      const charge = await this.payments.chargeOpen(MODULE, cobro.id, input.gateway, email);
      return { cobro, charge };
    } catch (error) {
      this.cobros.delete(cobro.id);
      this.payments.drop(MODULE, cobro.id);
      throw error;
    }
  }
}
