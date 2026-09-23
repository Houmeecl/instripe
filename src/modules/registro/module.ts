import { randomBytes } from "node:crypto";
import { PlatformError } from "../../errors.js";
import type { PlatformStore } from "../../store/db.js";
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

export interface TosAcceptance {
  id: string;
  name: string;
  email: string;
  acceptedAt: string;
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
  private readonly acceptances = new Map<string, TosAcceptance>();
  private readonly sessions = new Map<string, string>();
  private readonly store: PlatformStore;

  constructor(cuentas: CuentasModule, store: PlatformStore) {
    this.store = store;
    const saved = store.list<PreRegistered>("members");
    this.members = saved.length
      ? saved
      : SEED.map((row) => {
          const account = cuentas.open({ name: row.name, email: row.email, memberId: row.id });
          const member = { ...row, status: "preinscrito" as const, accountId: account.id };
          store.put("members", member.id, member);
          return member;
        });
    for (const member of this.members) cuentas.bindMember(member.accountId, member.id);
    for (const acceptance of store.list<TosAcceptance>("tos_acceptances")) this.acceptances.set(acceptance.id, acceptance);
    for (const session of store.list<{ token: string; acceptanceId: string }>("tos_sessions")) {
      this.sessions.set(session.token, session.acceptanceId);
    }
  }

  list(): PreRegistered[] {
    return this.members.map((member) => ({ ...member }));
  }

  /** The SaaS app and the dashboard already hold these members. */
  space(): "ocupado" {
    return "ocupado";
  }

  acceptTos(input: { name: string; email: string; accepted: boolean }): { token: string; acceptance: TosAcceptance } {
    const name = input.name.trim();
    const email = input.email.trim();
    if (!input.accepted) throw new PlatformError("Hay que aceptar los términos", 400);
    if (!name || !email.includes("@")) throw new PlatformError("Nombre y email son requeridos", 400);
    const acceptance: TosAcceptance = {
      id: `tos_${randomBytes(4).toString("hex")}`,
      name,
      email,
      acceptedAt: new Date().toISOString(),
    };
    const token = randomBytes(24).toString("hex");
    this.acceptances.set(acceptance.id, acceptance);
    this.sessions.set(token, acceptance.id);
    this.store.put("tos_acceptances", acceptance.id, acceptance);
    this.store.put("tos_sessions", token, { token, acceptanceId: acceptance.id });
    return { token, acceptance };
  }

  tosSession(token: string | undefined): TosAcceptance | undefined {
    if (!token) return undefined;
    const id = this.sessions.get(token);
    if (!id) return undefined;
    const acceptance = this.acceptances.get(id);
    return acceptance ? { ...acceptance } : undefined;
  }
}
