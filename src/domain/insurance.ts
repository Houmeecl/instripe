export interface InsurancePlan {
  id: string;
  name: string;
  description: string;
  /** Monthly premium in the smallest currency unit of the platform currency. */
  premium: number;
  /** Max coverage / payout ceiling in the smallest currency unit. */
  coverage: number;
}

export interface Policy {
  id: string;
  planId: string;
  accountId: string;
  holderName: string;
  premium: number;
  coverage: number;
  status: "pending_payment" | "active" | "lapsed";
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
  payoutId: string;
  createdAt: string;
}

export const PLANS: InsurancePlan[] = [
  {
    id: "salud-basico",
    name: "Salud Básico",
    description: "Cobertura ambulatoria esencial para trabajadores independientes.",
    premium: 9000,
    coverage: 1500000,
  },
  {
    id: "hogar-pro",
    name: "Hogar Pro",
    description: "Protección de hogar contra siniestros e incendios.",
    premium: 19000,
    coverage: 8000000,
  },
  {
    id: "pyme-total",
    name: "Pyme Total",
    description: "Responsabilidad civil y continuidad para pequeñas empresas.",
    premium: 49000,
    coverage: 25000000,
  },
];

export function findPlan(id: string): InsurancePlan | undefined {
  return PLANS.find((plan) => plan.id === id);
}
