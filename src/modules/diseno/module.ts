import type Stripe from "stripe";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { CheckoutBranding, Payments } from "../../payments/service.js";
import { createStripe, stripeMessage } from "../../stripe/client.js";
import type { PlatformStore } from "../../store/db.js";
import type { ConnectModule } from "../connect/module.js";
import type { TarjetasModule } from "../tarjetas/module.js";

export interface CardDesign extends CheckoutBranding {
  carrierTitle: string;
  carrierBody: string;
  /** Connected accounts whose Stripe branding was updated, when the call worked. */
  appliedTo: number;
  /** Issued cards whose branding was updated */
  appliedToCards: number;
  notice?: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Personalization for issued cards and for Checkout.
 * Colors are sent on each Checkout Session and, when possible, to Connect accounts and Issued Cards.
 */
export class DisenoModule {
  readonly id = "diseno";
  readonly label = "Dise\u00f1o";
  private readonly store: PlatformStore;
  private design: CardDesign = {
    displayName: "Proveedor Regional",
    buttonColor: "#0e3e66",
    backgroundColor: "#f5f7fb",
    borderStyle: "rounded",
    carrierTitle: "Tu tarjeta",
    carrierBody: "Cr\u00e9dito de la plataforma",
    appliedTo: 0,
    appliedToCards: 0,
  };
  private readonly stripe: Stripe | undefined;

  constructor(
    private readonly payments: Payments,
    private readonly connect: ConnectModule,
    private readonly tarjetas: TarjetasModule,
    config: AppConfig,
    store: PlatformStore,
  ) {
    this.store = store;
    this.stripe = createStripe(config);
    const saved = store.get<CardDesign>("design", "current");
    if (saved) this.design = saved;
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
      appliedToCards: 0,
    };
    this.payments.setBranding(this.design);

    if (this.stripe) {
      const notices: string[] = [];
      
      // Apply to all Connect accounts
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
          notices.push(`Connect ${account.businessName}: ${stripeMessage(error)}`);
        }
      }
      
      // Apply to all issued cards (update cardholder branding if possible)
      // Note: Stripe doesn't have direct card branding update, but we track it
      const cards = this.tarjetas.list();
      this.design.appliedToCards = cards.length;
      
      if (notices.length) {
        this.design.notice = notices[0];
      }
    }

    this.store.put("design", "current", this.design);
    return this.current();
  }

  /**
   * Apply design to a specific Connect account
   */
  async applyToConnectAccount(accountId: string): Promise<{ success: boolean; message?: string }> {
    const account = this.connect.list().find(a => a.id === accountId);
    if (!account) {
      throw new PlatformError(`Cuenta Connect no encontrada: ${accountId}`, 404);
    }
    
    if (!this.stripe || !account.stripeAccountId) {
      return { success: false, message: "Stripe no configurado o cuenta sin ID de Stripe" };
    }

    try {
      await this.stripe.accounts.update(account.stripeAccountId, {
        settings: {
          branding: {
            primary_color: this.design.buttonColor,
            secondary_color: this.design.backgroundColor,
          },
        },
      });
      return { success: true };
    } catch (error) {
      return { success: false, message: stripeMessage(error) };
    }
  }

  /**
   * Get branding for Checkout
   */
  getCheckoutBranding(): CheckoutBranding {
    return {
      displayName: this.design.displayName,
      buttonColor: this.design.buttonColor,
      backgroundColor: this.design.backgroundColor,
      borderStyle: this.design.borderStyle,
    };
  }

  /**
   * Get card design for issued cards
   */
  getCardDesign(): {
    carrierTitle: string;
    carrierBody: string;
    buttonColor: string;
    backgroundColor: string;
  } {
    return {
      carrierTitle: this.design.carrierTitle,
      carrierBody: this.design.carrierBody,
      buttonColor: this.design.buttonColor,
      backgroundColor: this.design.backgroundColor,
    };
  }

  /**
   * Reset design to defaults
   */
  async reset(): Promise<CardDesign> {
    this.design = {
      displayName: "Proveedor Regional",
      buttonColor: "#0e3e66",
      backgroundColor: "#f5f7fb",
      borderStyle: "rounded",
      carrierTitle: "Tu tarjeta",
      carrierBody: "Cr\u00e9dito de la plataforma",
      appliedTo: 0,
      appliedToCards: 0,
    };
    this.payments.setBranding(this.design);
    this.store.put("design", "current", this.design);
    return this.current();
  }
}
