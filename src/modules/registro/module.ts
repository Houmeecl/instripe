import type { CuentasModule } from "../cuentas/module.js";

export interface PreRegistered {
  id: string;
  name: string;
  email: string;
  city: string;
  role: "comercio" | "titular";
  status: "preinscrito";
  accountId: string;
}

const SEED: Array<Omit<PreRegistered, "status" | "accountId">> = [
  { id: "reg_taller", name: "Taller Sur", email: "caja@taller.cl", city: "Antofagasta", role: "comercio" },
  { id: "reg_norte", name: "Oficina Norte", email: "pago@norte.cl", city: "Antofagasta", role: "comercio" },
  { id: "reg_ana", name: "Ana Díaz", email: "ana@proveedorregional.cl", city: "Antofagasta", role: "titular" },
];

/**
 * People and businesses already enrolled on proveedorregional.cl.
 * Opening their wallet is local. Nothing is created in the payment processor.
 */
export class RegistroModule {
  readonly id = "registro";
  readonly label = "Preinscritos";
  private readonly members: PreRegistered[];

  constructor(cuentas: CuentasModule) {
    this.members = SEED.map((row) => {
      const account = cuentas.open({ name: row.name, email: row.email });
      return { ...row, status: "preinscrito" as const, accountId: account.id };
    });
  }

  list(): PreRegistered[] {
    return this.members.map((member) => ({ ...member }));
  }
}
