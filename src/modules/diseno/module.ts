import type Stripe from "stripe";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { CheckoutBranding, Payments } from "../../payments/service.js";
import { createStripe, stripeMessage } from "../../stripe/client.js";
import type { ConnectModule } from "../connect/module.js";

export interface CardDesign extends CheckoutBranding {
  carrierTitle: string;
  carrierBody: string;
  /** Connected accounts whose Stripe branding was updated, when the call worked. */
  appliedTo: number;
  notice?: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Personalization for issued cards and for Checkout.
 * Colors are sent on each Checkout Session and, when possible, to Connect accounts.
 */
export class DisenoModule {
  readonly id = "diseno";
  readonly label = "Diseño";
  private design: CardDesign = {
    displayName: "instripe",
    buttonColor: "#635bff",
    backgroundColor: "#f5f7fb",
    borderStyle: "rounded",
    carrierTitle: "Tu tarjeta",
    carrierBody: "Crédito de la plataforma",
    appliedTo: 0,
  };
  private readonly stripe: Stripe | undefined;

  constructor(
    private readonly payments: Payments,
    private readonly connect: ConnectModule,
    config: AppConfig,
  ) {
    this.stripe = createStripe(config);
    this.payments.setBranding(this.design);
  }

  current(): CardDesign {
    return { ...this.design };
  }

  async save(input: {
    displayName: string;
    buttonColor: string;
    backgroundColor: string;
    borderStyle: string;
    carrierTitle: string;
    carrierBody: string;
  }): Promise<CardDesign> {
    const displayName = input.displayName.trim();
    const carrierTitle = input.carrierTitle.trim();
    const carrierBody = input.carrierBody.trim();
    if (!displayName || !carrierTitle || !carrierBody) {
      throw new PlatformError("displayName, carrierTitle y carrierBody son requeridos", 400);
    }
    if (!HEX.test(input.buttonColor) || !HEX.test(input.backgroundColor)) {
      throw new PlatformError("Los colores deben ser hexadecimales, como #635bff", 400);
    }
    if (input.borderStyle !== "rounded" && input.borderStyle !== "rectangular" && input.borderStyle !== "pill") {
      throw new PlatformError("borderStyle debe ser rounded, rectangular o pill", 400);
    }

    this.design = {
      displayName,
      buttonColor: input.buttonColor,
      backgroundColor: input.backgroundColor,
      borderStyle: input.borderStyle,
      carrierTitle,
      carrierBody,
      appliedTo: 0,
    };
    this.payments.setBranding(this.design);

    if (this.stripe) {
      const notices: string[] = [];
      for (const account of this.connect.list()) {
        if (!account.stripeAccountId) continue;
        try {
          await this.stripe.accounts.update(account.stripeAccountId, {
            settings: {
              branding: {
                primary_color: this.design.buttonColor,
                secondary_color: this.design.backgroundColor,
              },
            },
          });
          this.design.appliedTo += 1;
        } catch (error) {
          notices.push(stripeMessage(error));
        }
      }
      if (notices.length) this.design.notice = notices[0];
    }

    return this.current();
  }
}
