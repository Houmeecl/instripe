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
  videos: CourseVideo[];
  tasks: CourseTask[];
  forum: ForumPostView[];
}

export interface CourseVideo {
  id: string;
  title: string;
  url: string;
  createdAt: string;
}

export interface CourseTask {
  id: string;
  title: string;
  instructions: string;
  dueAt: string | null;
  createdAt: string;
}

export interface CourseSubmissionView {
  id: string;
  courseId: string;
  courseTitle: string;
  taskId: string;
  taskTitle: string;
  studentName: string;
  studentEmail: string;
  answer: string;
  status: "pending" | "approved" | "rejected";
  feedback: string;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface ForumPostView {
  id: string;
  parentId: string | null;
  authorName: string;
  authorRole: string;
  message: string;
  createdAt: string;
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
  companyId?: string;
  enrolledAt: string;
}

interface Sicr3pRecord {
  id: "sicr3p";
  url: string;
  secret?: string;
}

interface CourseVideoRecord extends CourseVideo {
  courseId: string;
  companyId: string;
  createdBy: string;
}

interface CourseTaskRecord extends CourseTask {
  courseId: string;
  companyId: string;
  createdBy: string;
}

interface CourseSubmissionRecord extends CourseSubmissionView {
  companyId: string;
  studentId: string;
  reviewerId: string | null;
}

interface ForumPostRecord extends ForumPostView {
  courseId: string;
  companyId: string;
  authorId: string;
}

export interface CourseActor {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId?: string;
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
 * Company-scoped course content and assessment. SICR3P is only an external URL;
 * this module never fetches it and never returns its stored secret.
 */
export class LaboralModule {
  readonly id = "laboral";
  readonly label = "Cursos";
  private readonly enrollments: EnrollmentRecord[] = [];
  private readonly videos: CourseVideoRecord[] = [];
  private readonly tasks: CourseTaskRecord[] = [];
  private readonly submissions: CourseSubmissionRecord[] = [];
  private readonly forumPosts: ForumPostRecord[] = [];
  private sicr3p: Sicr3pRecord | undefined;
  private readonly ownHost: string;

  constructor(
    private readonly store: PlatformStore,
    publicBaseUrl: string,
  ) {
    this.enrollments.push(...store.list<EnrollmentRecord>("course_enrollments"));
    this.videos.push(...store.list<CourseVideoRecord>("course_videos"));
    this.tasks.push(...store.list<CourseTaskRecord>("course_tasks"));
    this.submissions.push(...store.list<CourseSubmissionRecord>("course_submissions"));
    this.forumPosts.push(...store.list<ForumPostRecord>("course_forum_posts"));
    this.sicr3p = store.get<Sicr3pRecord>("settings", "sicr3p");
    this.ownHost = hostnameOf(publicBaseUrl);
  }

  courses(scope?: { companyId?: string; allCompanies?: boolean }): { courses: CourseView[] } {
    return {
      courses: COURSES.map((course) => ({
        ...course,
        lessons: course.lessons.map((lesson) => ({ ...lesson })),
        students: this.enrollments
          .filter((row) => row.courseId === course.id && matchesScope(row.companyId, scope))
          .map((row) => ({ name: row.name, email: row.email, enrolledAt: row.enrolledAt })),
        videos: this.videos
          .filter((row) => row.courseId === course.id && matchesScope(row.companyId, scope))
          .map(({ id, title, url, createdAt }) => ({ id, title, url, createdAt })),
        tasks: this.tasks
          .filter((row) => row.courseId === course.id && matchesScope(row.companyId, scope))
          .map(({ id, title, instructions, dueAt, createdAt }) => ({ id, title, instructions, dueAt, createdAt })),
        forum: this.forumPosts
          .filter((row) => row.courseId === course.id && matchesScope(row.companyId, scope))
          .map(({ id, parentId, authorName, authorRole, message, createdAt }) => ({
            id, parentId, authorName, authorRole, message, createdAt,
          })),
      })),
    };
  }

  enroll(courseId: string, input: { name: string; email: string }, scope?: { companyId?: string }): CourseView {
    const course = COURSES.find((item) => item.id === courseId);
    if (!course) throw new PlatformError("Curso desconocido", 404);
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name || !email.includes("@")) throw new PlatformError("Nombre y correo del alumno son requeridos", 400);
    const existing = this.enrollments.find(
      (row) => row.courseId === course.id && row.email === email && row.companyId === scope?.companyId,
    );
    if (!existing) {
      const row: EnrollmentRecord = {
        id: `enr_${randomUUID().slice(0, 8)}`,
        courseId: course.id,
        name,
        email,
        ...(scope?.companyId ? { companyId: scope.companyId } : {}),
        enrolledAt: new Date().toISOString(),
      };
      this.enrollments.push(row);
      this.store.put("course_enrollments", row.id, row);
    }
    const view = this.courses(scope).courses.find((item) => item.id === course.id);
    if (!view) throw new PlatformError("Curso desconocido", 404);
    return view;
  }

  createVideo(actor: CourseActor, input: { courseId: string; title: string; url: string; companyId?: string }): CourseVideo {
    this.assertEvaluator(actor.role);
    const courseId = input.courseId.trim();
    this.requireCourse(courseId);
    const title = input.title.trim();
    if (!title || title.length > 120) throw new PlatformError("El título del video debe tener entre 1 y 120 caracteres", 400);
    const record: CourseVideoRecord = {
      id: `vid_${randomUUID().slice(0, 8)}`,
      courseId,
      companyId: this.requireCompany(actor, input.companyId),
      title,
      url: this.assertVideoUrl(input.url),
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    };
    this.videos.push(record);
    this.store.put("course_videos", record.id, record);
    return { id: record.id, title: record.title, url: record.url, createdAt: record.createdAt };
  }

  createTask(
    actor: CourseActor,
    input: { courseId: string; title: string; instructions: string; dueAt?: string; companyId?: string },
  ): CourseTask {
    this.assertEvaluator(actor.role);
    const courseId = input.courseId.trim();
    this.requireCourse(courseId);
    const title = input.title.trim();
    const instructions = input.instructions.trim();
    if (!title || title.length > 120) throw new PlatformError("El título de la tarea debe tener entre 1 y 120 caracteres", 400);
    if (!instructions || instructions.length > 5000) {
      throw new PlatformError("Las instrucciones son requeridas y no pueden superar 5000 caracteres", 400);
    }
    let dueAt: string | null = null;
    if (input.dueAt) {
      const parsed = Date.parse(input.dueAt);
      if (!Number.isFinite(parsed)) throw new PlatformError("La fecha de entrega no es válida", 400);
      dueAt = new Date(parsed).toISOString();
    }
    const record: CourseTaskRecord = {
      id: `task_${randomUUID().slice(0, 8)}`,
      courseId,
      companyId: this.requireCompany(actor, input.companyId),
      title,
      instructions,
      dueAt,
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(record);
    this.store.put("course_tasks", record.id, record);
    return { id: record.id, title, instructions, dueAt, createdAt: record.createdAt };
  }

  submitTask(actor: CourseActor, taskId: string, answer: string): CourseSubmissionView {
    if (actor.role !== "alumno") throw new PlatformError("Solo alumnos pueden entregar tareas", 403);
    const companyId = this.requireCompany(actor);
    const task = this.tasks.find((row) => row.id === taskId && row.companyId === companyId);
    if (!task) throw new PlatformError("Tarea no encontrada", 404);
    const enrolled = this.enrollments.some(
      (row) => row.courseId === task.courseId && row.companyId === companyId && row.email === actor.email.toLowerCase(),
    );
    if (!enrolled) throw new PlatformError("Inscríbete en el curso antes de entregar la tarea", 403);
    const normalizedAnswer = answer.trim();
    if (!normalizedAnswer || normalizedAnswer.length > 10000) {
      throw new PlatformError("La respuesta es requerida y no puede superar 10000 caracteres", 400);
    }
    const previous = this.submissions
      .filter((row) => row.taskId === taskId && row.studentId === actor.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    if (previous && previous.status !== "rejected") {
      throw new PlatformError("Ya hay una entrega pendiente o aprobada para esta tarea", 409);
    }
    const record: CourseSubmissionRecord = {
      id: `sub_${randomUUID().slice(0, 8)}`,
      courseId: task.courseId,
      courseTitle: this.requireCourse(task.courseId).title,
      taskId: task.id,
      taskTitle: task.title,
      companyId,
      studentId: actor.id,
      studentName: actor.name,
      studentEmail: actor.email.toLowerCase(),
      answer: normalizedAnswer,
      status: "pending",
      feedback: "",
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewerId: null,
    };
    this.submissions.push(record);
    this.store.put("course_submissions", record.id, record);
    return toSubmissionView(record);
  }

  listSubmissions(actor: CourseActor): CourseSubmissionView[] {
    if (!["alumno", "evaluador", "operacion"].includes(actor.role)) return [];
    const scope = { companyId: actor.companyId, allCompanies: actor.role === "operacion" };
    return this.submissions
      .filter((row) => actor.role === "alumno" ? row.studentId === actor.id : matchesScope(row.companyId, scope))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map(toSubmissionView);
  }

  reviewSubmission(
    actor: CourseActor,
    submissionId: string,
    input: { status: "approved" | "rejected"; feedback: string },
  ): CourseSubmissionView {
    this.assertEvaluator(actor.role);
    const index = this.submissions.findIndex((row) => row.id === submissionId);
    const current = this.submissions[index];
    const scope = { companyId: actor.companyId, allCompanies: actor.role === "operacion" };
    if (!current || !matchesScope(current.companyId, scope)) throw new PlatformError("Entrega no encontrada", 404);
    if (current.status !== "pending") throw new PlatformError("La entrega ya fue evaluada", 409);
    const feedback = input.feedback.trim();
    if (!feedback || feedback.length > 2000) {
      throw new PlatformError("El comentario del evaluador es requerido y no puede superar 2000 caracteres", 400);
    }
    if (input.status !== "approved" && input.status !== "rejected") {
      throw new PlatformError("El resultado de evaluación no es válido", 400);
    }
    const updated: CourseSubmissionRecord = {
      ...current,
      status: input.status,
      feedback,
      reviewerId: actor.id,
      reviewedAt: new Date().toISOString(),
    };
    this.submissions[index] = updated;
    this.store.put("course_submissions", updated.id, updated);
    return toSubmissionView(updated);
  }

  createForumPost(
    actor: CourseActor,
    input: { courseId: string; message: string; parentId?: string; companyId?: string },
  ): ForumPostView {
    if (!["alumno", "evaluador", "operacion"].includes(actor.role)) {
      throw new PlatformError("El rol no puede publicar en el foro", 403);
    }
    const courseId = input.courseId.trim();
    this.requireCourse(courseId);
    const companyId = actor.role === "operacion" ? input.companyId?.trim() : actor.companyId;
    if (!companyId) throw new PlatformError("El foro requiere una empresa", 400);
    if (actor.role === "alumno" && !this.enrollments.some(
      (row) => row.courseId === courseId && row.companyId === companyId && row.email === actor.email.toLowerCase(),
    )) {
      throw new PlatformError("Inscríbete en el curso antes de participar en el foro", 403);
    }
    const message = input.message.trim();
    if (!message || message.length > 5000) throw new PlatformError("El mensaje debe tener entre 1 y 5000 caracteres", 400);
    const parentId = input.parentId?.trim() || null;
    if (parentId && !this.forumPosts.some((row) => row.id === parentId && row.courseId === courseId && row.companyId === companyId)) {
      throw new PlatformError("La publicación a responder no existe", 404);
    }
    const record: ForumPostRecord = {
      id: `forum_${randomUUID().slice(0, 8)}`,
      courseId,
      companyId,
      parentId,
      authorId: actor.id,
      authorName: actor.name,
      authorRole: actor.role,
      message,
      createdAt: new Date().toISOString(),
    };
    this.forumPosts.push(record);
    this.store.put("course_forum_posts", record.id, record);
    return toForumView(record);
  }

  forgetDeletedCompany(companyId: string): void {
    this.removeCompanyRows(this.enrollments, "course_enrollments", companyId);
    this.removeCompanyRows(this.videos, "course_videos", companyId);
    this.removeCompanyRows(this.tasks, "course_tasks", companyId);
    this.removeCompanyRows(this.submissions, "course_submissions", companyId);
    this.removeCompanyRows(this.forumPosts, "course_forum_posts", companyId);
  }

  private removeCompanyRows<T extends { id: string; companyId?: string }>(rows: T[], collection: string, companyId: string): void {
    const removed = rows.filter((row) => row.companyId === companyId);
    for (const row of removed) this.store.delete(collection, row.id);
    rows.splice(0, rows.length, ...rows.filter((row) => row.companyId !== companyId));
  }

  private requireCourse(courseId: string): CourseDefinition {
    const course = COURSES.find((row) => row.id === courseId);
    if (!course) throw new PlatformError("Curso desconocido", 404);
    return course;
  }

  private requireCompany(actor: CourseActor, override?: string): string {
    const companyId = actor.role === "operacion" ? override?.trim() : actor.companyId;
    if (!companyId) throw new PlatformError("El usuario debe pertenecer a una empresa", 403);
    return companyId;
  }

  private assertEvaluator(role: Role): void {
    if (role !== "evaluador" && role !== "operacion") {
      throw new PlatformError("Solo un evaluador puede realizar esta acción", 403);
    }
  }

  private assertVideoUrl(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new PlatformError("El enlace del video debe ser una URL https válida", 400);
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new PlatformError("El enlace del video debe usar https y no incluir credenciales", 400);
    }
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY.test(key)) throw new PlatformError("El enlace del video no puede incluir secretos", 400);
    }
    return url.toString();
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

function matchesScope(rowCompanyId: string | undefined, scope?: { companyId?: string; allCompanies?: boolean }): boolean {
  if (scope?.allCompanies) return true;
  return scope?.companyId ? rowCompanyId === scope.companyId : !rowCompanyId;
}

function toSubmissionView(record: CourseSubmissionRecord): CourseSubmissionView {
  const { id, courseId, courseTitle, taskId, taskTitle, studentName, studentEmail, answer, status, feedback, submittedAt, reviewedAt } = record;
  return { id, courseId, courseTitle, taskId, taskTitle, studentName, studentEmail, answer, status, feedback, submittedAt, reviewedAt };
}

function toForumView(record: ForumPostRecord): ForumPostView {
  const { id, parentId, authorName, authorRole, message, createdAt } = record;
  return { id, parentId, authorName, authorRole, message, createdAt };
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}
