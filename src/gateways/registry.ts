import type { AppConfig, GatewayName } from "../config.js";
import type { PaymentGateway } from "./types.js";
import { StripeGateway } from "./stripeGateway.js";
import { ChileGateway } from "./chileGateway.js";
import { Global66Gateway } from "./global66Gateway.js";

export class GatewayRegistry {
  private readonly gateways: Map<GatewayName, PaymentGateway>;

  constructor(config: AppConfig) {
    const stripe = new StripeGateway(config);
    const chile = new ChileGateway(config);
    const global66 = new Global66Gateway(config);
    this.gateways = new Map<GatewayName, PaymentGateway>([
      [stripe.name, stripe],
      [chile.name, chile],
      [global66.name, global66],
    ]);
  }

  get(name: GatewayName): PaymentGateway {
    const gateway = this.gateways.get(name);
    if (!gateway) {
      throw new Error(`Unknown gateway: ${name}`);
    }
    return gateway;
  }

  list(): PaymentGateway[] {
    return [...this.gateways.values()];
  }
}
