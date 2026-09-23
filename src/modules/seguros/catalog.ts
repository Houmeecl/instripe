export interface InsurancePlan {
  id: string;
  name: string;
  description: string;
  /** Premium as basis points of the card credit (cupo). 60 = 0,60%. Unused when pricing is per worker. */
  rateBps: number;
  pricing: "cupo" | "workers";
  /** Frosting never opens a credit line. */
  opensCredit: boolean;
}

export interface RiskClass {
  id: string;
  name: string;
  /** Premium per worker, in the platform currency. */
  rate: number;
}

export interface Policy {
  id: string;
  planId: string;
  accountId: string;
  holderName: string;
  /** Card the credit belongs to, e.g. "Visa •••• 4242". Empty for Frosting. */
  cardLabel: string;
  /** Credit limit insured by a crédito TC policy. Zero for Frosting. */
  cupo: number;
  premium: number;
  /** Insured amount. For crédito TC it is the card credit. Frosting does not insure a credit line. */
  coverage: number;
  status: "pending_payment" | "active" | "lapsed";
  /** Payment recorded by the payments core (`pay_…`). */
  paymentId?: string;
  /** Stripe Checkout session that collects the premium, when applicable. */
  checkoutSessionId?: string;
  createdAt: string;
  workers?: number;
  riskClassId?: string;
  riskRate?: number;
  companyName?: string;
}

export interface Claim {
  id: string;
  policyId: string;
  amount: number;
  beneficiary: string;
  status: "paid" | "pending" | "rejected";
  /** Disbursement recorded by the payments core (`pay_…`). */
  paymentId?: string;
  /** Gateway payout id, present once the second operator confirms the exit. */
  payoutId?: string;
  createdAt: string;
}

/** Póliza sobre el crédito (cupo) de una tarjeta de crédito. */
export const CREDITO_TC: InsurancePlan = {
  id: "credito-tc",
  name: "Crédito de tarjeta",
  description: "Póliza sobre el crédito (cupo) de una tarjeta de crédito.",
  rateBps: 60,
  pricing: "cupo",
  opensCredit: true,
};

/** Worker cover priced by risk class. It does not open credit. */
export const FROSTING: InsurancePlan = {
  id: "frosting",
  name: "Frosting",
  description: "Seguro por trabajadores. No abre crédito. La prima es trabajadores por la tasa de la clase de riesgo.",
  rateBps: 0,
  pricing: "workers",
  opensCredit: false,
};

export const PLANS: InsurancePlan[] = [CREDITO_TC, FROSTING];

/** Default actuarial rates. Operación can replace them. */
export const RISK_CLASSES: RiskClass[] = [
  { id: "bajo", name: "Bajo", rate: 1_500 },
  { id: "medio", name: "Medio", rate: 3_200 },
  { id: "alto", name: "Alto", rate: 5_400 },
];

export function findPlan(id: string): InsurancePlan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

export function findRiskClass(id: string): RiskClass | undefined {
  return RISK_CLASSES.find((risk) => risk.id === id);
}

/** Monthly premium: 0,60% of the insured card credit. */
export function premiumForCupo(cupo: number): number {
  return Math.round((cupo * CREDITO_TC.rateBps) / 10_000);
}

/** Frosting premium. Workers times the rate of the chosen risk class. */
export function frostingPremium(workers: number, rate: number): number {
  return workers * rate;
}

export function planDisplayRate(plan: InsurancePlan): string {
  if (plan.pricing === "workers") return "trabajadores × tasa";
  return `${(plan.rateBps / 100).toFixed(2).replace(".", ",")}%`;
}
