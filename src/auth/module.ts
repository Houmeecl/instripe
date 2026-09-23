import { randomBytes, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { PlatformError } from "../errors.js";
import type { PlatformStore } from "../store/db.js";

export const OPTIONS = [
  "overview",
  "accounts",
  "cobros",
  "plans",
  "policies",
  "claims",
  "connect",
  "empresas",
  "treasury",
  "cards",
  "design",
  "apps",
  "payments",
] as const;

export type Option = (typeof OPTIONS)[number];
export type Role = "operacion" | "comercio" | "titular";

const ROLE_OPTIONS: Record<Role, readonly Option[]> = {
  operacion: OPTIONS,
  comercio: ["overview", "accounts", "cobros", "connect", "empresas"],
  titular: ["overview", "plans", "policies", "claims", "cards", "empresas"],
};

const ROLE_LABEL: Record<Role, string> = {
  operacion: "Operación",
  comercio: "Comercio",
  titular: "Titular",
};

const KEYLEN = 32;
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 12 * 60 * 60 * 1000;

interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  memberId?: string;
  salt: string;
  passwordHash: string;
}

interface AuthSessionRecord {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  roleLabel: string;
  memberId?: string;
  options: Option[];
}

const SEED: Array<Omit<AuthUserRecord, "salt" | "passwordHash">> = [
  { id: "usr_operacion", email: "operacion@proveedorregional.cl", name: "Fundación Entretodos", role: "operacion" },
  { id: "usr_taller", email: "caja@taller.cl", name: "Taller Sur", role: "comercio", memberId: "reg_taller" },
  { id: "usr_norte", email: "pago@norte.cl", name: "Oficina Norte", role: "comercio", memberId: "reg_norte" },
  { id: "usr_ana", email: "ana@proveedorregional.cl", name: "Ana Díaz", role: "titular", memberId: "reg_ana" },
];

/**
 * Which dashboard option an API path needs.
 * `any` is every signed-in role. `deny` is an unknown API path.
 */
export function requiredOption(pathname: string): Option | "any" | "deny" {
  if (pathname === "/api/gateways" || pathname === "/api/session/password") return "any";
  if (/^\/api\/checkout\/sessions\/[^/]+$/.test(pathname)) return "any";
  const rules: Array<[RegExp, Option]> = [
    [/^\/api\/overview$/, "overview"],
    [/^\/api\/cuentas(?:\/.*)?$/, "accounts"],
    [/^\/api\/cobros$/, "cobros"],
    [/^\/api\/plans$/, "plans"],
    [/^\/api\/policies$/, "policies"],
    [/^\/api\/claims$/, "claims"],
    [/^\/api\/connect(?:\/.*)?$/, "connect"],
    [/^\/api\/empresas(?:\/.*)?$/, "empresas"],
    [/^\/api\/treasury(?:\/.*)?$/, "treasury"],
    [/^\/api\/tarjetas$/, "cards"],
    [/^\/api\/diseno$/, "design"],
    [/^\/api\/apps$/, "apps"],
    [/^\/api\/payments$/, "payments"],
    [/^\/api\/stripe\/events$/, "payments"],
  ];
  for (const [pattern, option] of rules) {
    if (pattern.test(pathname)) return option;
  }
  return "deny";
}

export class AuthModule {
  constructor(
    private readonly store: PlatformStore,
    seedPassword: string,
  ) {
    if (store.list<AuthUserRecord>("auth_users").length > 0) return;
    for (const row of SEED) {
      const salt = randomBytes(16);
      const passwordHash = scryptSync(seedPassword, salt, KEYLEN, SCRYPT).toString("hex");
      this.store.put("auth_users", row.id, {
        ...row,
        salt: salt.toString("hex"),
        passwordHash,
      });
    }
  }

  login(email: string, password: string): { token: string; user: SessionUser } {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password) throw new PlatformError("Correo y clave son requeridos", 400);
    const record = this.store
      .list<AuthUserRecord>("auth_users")
      .find((user) => user.email.toLowerCase() === normalized);
    if (!record) {
      burnUnknownPassword(password);
      throw new PlatformError("Correo o clave incorrectos", 401);
    }
    if (!passwordMatches(password, record)) {
      throw new PlatformError("Correo o clave incorrectos", 401);
    }
    const token = randomBytes(32).toString("hex");
    const session: AuthSessionRecord = {
      token,
      userId: record.id,
      expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
    };
    this.store.put("auth_sessions", token, session);
    return { token, user: toSessionUser(record) };
  }

  logout(token: string | undefined): void {
    if (!token) return;
    this.store.delete("auth_sessions", token);
  }

  userFromCookie(token: string | undefined): SessionUser | null {
    const session = this.liveSession(token);
    if (!session) return null;
    const record = this.store.get<AuthUserRecord>("auth_users", session.userId);
    return record ? toSessionUser(record) : null;
  }

  changePassword(token: string | undefined, currentPassword: string, newPassword: string): void {
    const session = this.liveSession(token);
    if (!session) throw new PlatformError("Inicia sesión", 401);
    const record = this.store.get<AuthUserRecord>("auth_users", session.userId);
    if (!record || !passwordMatches(currentPassword, record)) {
      throw new PlatformError("La clave actual no coincide", 401);
    }
    const next = newPassword.trim();
    if (next.length < 8) throw new PlatformError("La clave nueva necesita al menos 8 caracteres", 400);
    const salt = randomBytes(16);
    this.store.put("auth_users", record.id, {
      ...record,
      salt: salt.toString("hex"),
      passwordHash: scryptSync(next, salt, KEYLEN, SCRYPT).toString("hex"),
    });
  }

  private liveSession(token: string | undefined): AuthSessionRecord | undefined {
    if (!token) return undefined;
    const session = this.store.get<AuthSessionRecord>("auth_sessions", token);
    if (!session) return undefined;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.store.delete("auth_sessions", token);
      return undefined;
    }
    return session;
  }
}

function toSessionUser(record: AuthUserRecord): SessionUser {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    roleLabel: ROLE_LABEL[record.role],
    memberId: record.memberId,
    options: [...ROLE_OPTIONS[record.role]],
  };
}

let dummyHash: Buffer | undefined;
let dummySalt: Buffer | undefined;

function passwordMatches(password: string, record: AuthUserRecord): boolean {
  const actual = scryptSync(password, Buffer.from(record.salt, "hex"), KEYLEN, SCRYPT);
  const expected = Buffer.from(record.passwordHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function burnUnknownPassword(password: string): void {
  if (!dummySalt || !dummyHash) {
    dummySalt = randomBytes(16);
    dummyHash = scryptSync("not-a-user", dummySalt, KEYLEN, SCRYPT);
  }
  const actual = scryptSync(password, dummySalt, KEYLEN, SCRYPT);
  timingSafeEqual(actual, dummyHash);
}
