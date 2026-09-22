export interface Product {
  id: string;
  name: string;
  description: string;
  /** Price in the smallest currency unit (e.g. cents). */
  amount: number;
}

export const PRODUCTS: Product[] = [
  {
    id: "starter",
    name: "Starter Plan",
    description: "For individuals getting started with instripe.",
    amount: 900,
  },
  {
    id: "pro",
    name: "Pro Plan",
    description: "For growing teams that need more throughput.",
    amount: 2900,
  },
  {
    id: "enterprise",
    name: "Enterprise Plan",
    description: "Advanced controls, SSO, and priority support.",
    amount: 9900,
  },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}
