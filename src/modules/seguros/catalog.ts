export interface InsurancePlan {
  id: string;
  name: string;
  description: string;
  /** Premium as basis points of the card credit (cupo). 60 = 0,60%. */
  rateBps: number;
}

export interface Policy {
  id: string;
  planId: string;
  accountId: string;
  holderName: string;
  /** Card the credit belongs to, e.g. "Visa •••• 4242". */
  cardLabel: string;
  /** Credit limit insured by this policy, in the platform currency. */
  cupo: number;
  premium: number;
  /** Insured amount. For this product it is the card credit itself. */
  coverage: number;
  status: "pending_payment" | "active" | "lapsed";
  /** Payment recorded by the payments core (`pay_…`). */
  paymentId?: string;
  /** Stripe Checkout session that collects the premium, when applicable. */
  checkoutSessionId?: string;
  createdAt: string;
}

export interface Claim {
  id: string;
  policyId: string;
  amount: number;
  beneficiary: string;
  status: "paid" | "pending" | "rejected";
  /** Disbursement recorded by the payments core (`pay_…`). */
  paymentId?: string;
  payoutId: string;
  createdAt: string;
}

/** The only seguros product: a policy on a credit card's credit line. */
export const CREDITO_TC: InsurancePlan = {
  id: "credito-tc",
  name: "Crédito de tarjeta",
  description: "Póliza sobre el crédito (cupo) de una tarjeta de crédito.",
  rateBps: 60,
};

export const PLANS: InsurancePlan[] = [CREDITO_TC];

export function findPlan(id: string): InsurancePlan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

/** Monthly premium: 0,60% of the insured card credit. */
export function premiumForCupo(cupo: number): number {
  return Math.round((cupo * CREDITO_TC.rateBps) / 10_000);
}
