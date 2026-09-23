import { randomBytes } from "node:crypto";
import { qrMatrix } from "./qr.js";

/**
 * Narrow Stripe surface for a virtual gift.
 * A gift is a Coupon plus a Promotion Code. It is not a charge, a Transfer,
 * an Issuing card, or a Treasury object, and it has no currency amount.
 */
export interface GiftStripe {
  coupons: {
    create(params: {
      name?: string;
      percent_off?: number;
      duration?: "once";
      max_redemptions?: number;
      metadata?: Record<string, string>;
    }): Promise<{ id: string }>;
  };
  promotionCodes: {
    create(params: {
      code?: string;
      max_redemptions?: number;
      metadata?: Record<string, string>;
      promotion: { type: "coupon"; coupon?: string };
    }): Promise<{ id: string; code: string }>;
  };
}

export interface IssuedGift {
  status: "pending" | "issued";
  code: string | null;
  stripeCouponId: string | null;
  stripePromotionCodeId: string | null;
  pendingMessage: string | null;
  nfcNote: string | null;
  qr: boolean[][] | null;
}

export const GIFT_DISCLAIMER = "Este regalo es virtual. No es una cuenta de débito y no es dinero.";
const PENDING = "Stripe no está configurado. El regalo queda pendiente, sin código y sin identificador de Stripe.";
const NFC = "Este código se puede copiar después en una etiqueta NFC.";

/**
 * Creates the Stripe Coupon and Promotion Code when a client is present.
 * Without a client the gift stays pending and no Stripe id is invented.
 */
export async function issueVirtualGift(stripe: GiftStripe | undefined, title: string): Promise<IssuedGift> {
  if (!stripe) {
    return {
      status: "pending",
      code: null,
      stripeCouponId: null,
      stripePromotionCodeId: null,
      pendingMessage: PENDING,
      nfcNote: null,
      qr: null,
    };
  }
  const code = shortCode();
  const coupon = await stripe.coupons.create({
    name: title.slice(0, 40),
    percent_off: 100,
    duration: "once",
    max_redemptions: 1,
    metadata: { kind: "regalo_virtual", money: "false" },
  });
  const promotion = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code,
    max_redemptions: 1,
    metadata: { kind: "regalo_virtual", money: "false" },
  });
  const shown = promotion.code || code;
  return {
    status: "issued",
    code: shown,
    stripeCouponId: coupon.id,
    stripePromotionCodeId: promotion.id,
    pendingMessage: null,
    nfcNote: NFC,
    qr: qrMatrix(shown),
  };
}

function shortCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let body = "";
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `RG-${body}`;
}
