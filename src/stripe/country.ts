/**
 * What Stripe offers by the country of the platform's own Stripe account.
 * The country is fixed when the account is created; a different country is a new account.
 */

const COUNTRY_NAMES: Record<string, string> = {
  GB: "Reino Unido",
  US: "EE.UU.",
  ES: "España",
  AU: "Australia",
  CL: "Chile",
};

/** SEPA countries where Issuing is funded with a euro transfer. */
const SEPA = new Set([
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
]);

export function countryName(country: string): string {
  return COUNTRY_NAMES[country] ?? country;
}

/** How money reaches the Issuing balance that virtual cards spend. */
export function issuingFundingHint(country: string): string {
  if (country === "GB") {
    return "El saldo de Issuing se carga en GBP por FPS, CHAPS o Bacs desde un banco del Reino Unido. El sort code y el número de cuenta están en el Dashboard: Saldos → Issuing balance → Add to balance.";
  }
  if (country === "US") {
    return "El saldo de Issuing se carga en USD por ACH o wire desde un banco de EE.UU.; Stripe devuelve las transferencias internacionales. El routing y el número de cuenta están en el Dashboard: Saldos → Issuing balance → Add to balance.";
  }
  if (SEPA.has(country)) {
    return "El saldo de Issuing se carga en EUR por transferencia SEPA. El IBAN está en el Dashboard: Saldos → Issuing balance → Add to balance.";
  }
  return `Stripe no publica cómo cargar el saldo de Issuing para una cuenta de ${countryName(country)}.`;
}

/**
 * Treasury for the platform's own business.
 * US uses the v1 API this module calls. GB offers v2 financial accounts, which this module does not open yet.
 */
export function treasuryAvailability(country: string): { usable: boolean; detail?: string } {
  if (country === "US") return { usable: true };
  if (country === "GB") {
    return {
      usable: false,
      detail:
        "En Reino Unido, Treasury usa las cuentas financieras v2 de Stripe (vista previa pública). Se activan en el Dashboard, en Treasury, y esta plataforma todavía no las abre. El abono queda en el libro local.",
    };
  }
  return {
    usable: false,
    detail: `Stripe no ofrece Treasury para una cuenta de ${countryName(country)}. El abono queda en el libro local.`,
  };
}
