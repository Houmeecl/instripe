import { randomUUID } from "node:crypto";
import type { Role } from "../../auth/module.js";
import { PlatformError } from "../../errors.js";
import type { PlatformStore } from "../../store/db.js";

export interface Lesson {
  id: string;
  title: string;
}

export interface CourseDefinition {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface EnrolledStudent {
  name: string;
  email: string;
  enrolledAt: string;
}

export interface CourseView extends CourseDefinition {
  students: EnrolledStudent[];
}

export interface Sicr3pPublic {
  url: string | null;
  configured: boolean;
  secretStored: boolean;
}

interface EnrollmentRecord {
  id: string;
  courseId: string;
  name: string;
  email: string;
  enrolledAt: string;
}

interface Sicr3pRecord {
  id: "sicr3p";
  url: string;
  secret?: string;
}

/** Example courses from the institutional dossier formation chapter. */
export const COURSES: CourseDefinition[] = [
  {
    id: "gestion-financiera",
    title: "Gestión financiera",
    lessons: [
      { id: "gf-saldo", title: "Leer el saldo propio y el de la empresa" },
      { id: "gf-libro", title: "Separar el libro del dinero que Stripe ya liquidó" },
    ],
  },
  {
    id: "tarjeta-debito",
    title: "Uso de la tarjeta de débito",
    lessons: [
      { id: "td-virtual", title: "La tarjeta es virtual y de débito prepago" },
      { id: "td-opciones", title: "Límite, categorías, período y bloqueo" },
    ],
  },
  {
    id: "control-gastos",
    title: "Control de gastos",
    lessons: [
      { id: "cg-movimientos", title: "Movimientos y comprobantes de la propia tarjeta" },
      { id: "cg-alertas", title: "Alertas cuando el gasto se acerca al límite" },
    ],
  },
  {
    id: "seguros-riesgos",
    title: "Seguros y riesgos",
    lessons: [
      { id: "sr-clase", title: "Clases de riesgo y la prima por trabajador" },
      { id: "sr-credito", title: "Frosting no abre una línea de crédito" },
    ],
  },
];

const SECRET_QUERY = /secret|token|password|api[_-]?key|clave/i;

/**
 * Courses live in this panel. SICR3P is only an external https URL.
 * This module never fetches that URL and never returns the stored secret.
 */
export class LaboralModule {
  readonly id = "laboral";
  readonly label = "Cursos";
  private readonly enrollments: EnrollmentRecord[] = [];
  private sicr3p: Sicr3pRecord | undefined;
  private readonly ownHost: string;

  constructor(
    private readonly store: PlatformStore,
    publicBaseUrl: string,
  ) {
    this.enrollments.push(...store.list<EnrollmentRecord>("course_enrollments"));
    this.sicr3p = store.get<Sicr3pRecord>("settings", "sicr3p");
    this.ownHost = hostnameOf(publicBaseUrl);
  }

  courses(): { courses: CourseView[] } {
    return {
      courses: COURSES.map((course) => ({
        ...course,
        lessons: course.lessons.map((lesson) => ({ ...lesson })),
        students: this.enrollments
          .filter((row) => row.courseId === course.id)
          .map((row) => ({ name: row.name, email: row.email, enrolledAt: row.enrolledAt })),
      })),
    };
  }

  enroll(courseId: string, input: { name: string; email: string }): CourseView {
    const course = COURSES.find((item) => item.id === courseId);
    if (!course) throw new PlatformError("Curso desconocido", 404);
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name || !email.includes("@")) throw new PlatformError("Nombre y correo del alumno son requeridos", 400);
    const existing = this.enrollments.find((row) => row.courseId === course.id && row.email === email);
    if (!existing) {
      const row: EnrollmentRecord = {
        id: `enr_${randomUUID().slice(0, 8)}`,
        courseId: course.id,
        name,
        email,
        enrolledAt: new Date().toISOString(),
      };
      this.enrollments.push(row);
      this.store.put("course_enrollments", row.id, row);
    }
    const view = this.courses().courses.find((item) => item.id === course.id);
    if (!view) throw new PlatformError("Curso desconocido", 404);
    return view;
  }

  /**
   * Public shape of the SICR3P pointer. `secret` is never copied onto it.
   */
  configuration(actorRole: Role): { sicr3p: Sicr3pPublic } {
    this.assertOperacion(actorRole);
    return { sicr3p: this.publicConfig() };
  }

  saveConfiguration(actorRole: Role, input: { url: string; secret?: string }): { sicr3p: Sicr3pPublic } {
    this.assertOperacion(actorRole);
    const url = this.assertExternalHttps(input.url);
    const secret = typeof input.secret === "string" ? input.secret.trim() : "";
    if (secret.length > 500) throw new PlatformError("El secreto es demasiado largo", 400);
    const record: Sicr3pRecord = {
      id: "sicr3p",
      url,
      ...(secret ? { secret } : this.sicr3p?.secret ? { secret: this.sicr3p.secret } : {}),
    };
    if (input.secret !== undefined && !secret) delete record.secret;
    this.sicr3p = record;
    this.store.put("settings", record.id, record);
    return { sicr3p: this.publicConfig() };
  }

  private publicConfig(): Sicr3pPublic {
    if (!this.sicr3p) return { url: null, configured: false, secretStored: false };
    return {
      url: this.sicr3p.url,
      configured: true,
      secretStored: Boolean(this.sicr3p.secret),
    };
  }

  private assertOperacion(role: Role): void {
    if (role !== "operacion") throw new PlatformError("Solo operación configura SICR3P", 403);
  }

  private assertExternalHttps(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new PlatformError("La URL de SICR3P tiene que ser https de otro host", 400);
    }
    if (url.protocol !== "https:") throw new PlatformError("La URL de SICR3P tiene que ser https", 400);
    if (url.username || url.password) throw new PlatformError("La URL no puede llevar secretos", 400);
    const host = url.hostname.toLowerCase();
    if (host === this.ownHost || host === "proveedorregional.cl" || host.endsWith(".proveedorregional.cl")) {
      throw new PlatformError("SICR3P tiene que ser un sitio de otro host", 400);
    }
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY.test(key)) throw new PlatformError("La URL no puede llevar secretos", 400);
    }
    return url.toString();
  }
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}
