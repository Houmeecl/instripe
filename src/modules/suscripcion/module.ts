import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { PlatformStore } from "../../store/db.js";
import type { Role } from "../../auth/module.js";
import type { SessionUser } from "../../auth/module.js";

/**
 * Tipos de suscripción (planes)
 * Cumple con Ley 19.628 (Protección de Datos Personales, Chile)
 * y regulaciones de suscripciones recurrentes
 */
export interface Plan {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: "monthly" | "quarterly" | "annual";
  trialDays?: number;
  features: string[];
  isActive: boolean;
  createdAt: string;
}

/**
 * Suscripción de un cliente
 * NO almacena datos de tarjeta (solo tokens de Stripe)
 * Cumple con PCI DSS (no maneja datos sensibles)
 */
export interface Suscripcion {
  id: string;
  planId: string;
  customerId: string; // Token de Stripe o ID interno
  customerEmail: string;
  customerName: string;
  customerRut?: string; // Opcional, para facturación electrónica (Chile)
  status: "active" | "pending" | "cancelled" | "paused" | "expired";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  billingCycle: "monthly" | "quarterly" | "annual";
  amount: number;
  currency: string;
  paymentMethodId?: string; // Token de Stripe, NO datos de tarjeta
  paymentGateway: "stripe" | "chile" | "none";
  invoiceNumber?: string;
  nextBillingDate: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, string | undefined>;
}

/**
 * Registro de pago de suscripción
 * Cumple con normativa contable chilena
 */
export interface PagoSuscripcion {
  id: string;
  suscripcionId: string;
  amount: number;
  currency: string;
  paymentDate: string;
  paymentMethod: string;
  transactionId?: string; // ID de transacción en el gateway
  status: "paid" | "pending" | "failed" | "refunded";
  invoiceNumber: string;
  boletaUrl?: string; // URL de boleta electrónica (Chile)
  createdAt: string;
}

/**
 * Formulario de registro con cumplimiento legal
 * Ley 19.628: Consentimiento explícito para tratamiento de datos
 * PCI DSS: No maneja datos de tarjeta
 */
export interface RegistroInput {
  // Datos personales (PII - protegido por Ley 19.628)
  name: string;
  email: string;
  phone?: string;
  rut?: string; // Opcional, para facturación
  city?: string;
  address?: string;
  
  // Datos de suscripción
  planId: string;
  billingCycle?: "monthly" | "quarterly" | "annual";
  
  // Consentimientos legales (requerido por Ley 19.628)
  aceptaTerminos: boolean;
  aceptaPoliticaPrivacidad: boolean;
  aceptaComunicaciones: boolean;
  
  // Datos de facturación (opcional)
  companyName?: string;
  companyRut?: string;
  
  // Token de pago (NO datos de tarjeta, solo referencia)
  paymentMethodToken?: string;
  gateway?: "stripe" | "chile";
  
  // Metadatos
  referrer?: string;
  campaign?: string;
}

/**
 * Respuesta de suscripción
 */
export interface SuscripcionResult {
  suscripcion: Suscripcion;
  pago?: PagoSuscripcion;
  success: boolean;
  message: string;
  nextStep?: string;
  checkoutUrl?: string; // URL de checkout para completar pago
}

/**
 * Estadísticas de suscripciones
 */
export interface SuscripcionStats {
  total: number;
  active: number;
  pending: number;
  cancelled: number;
  totalRevenue: number;
  monthlyRecurringRevenue: number;
  annualRecurringRevenue: number;
  churnRate: number;
  averageLifetime: number;
}

const MODULE = "suscripcion";

/**
 * Módulo de Suscripciones
 * 
 * Cumple con:
 * - PCI DSS: No almacena datos de tarjeta
 * - Ley 19.628 (Chile): Protección de Datos Personales
 * - Normativa de facturación electrónica (Chile)
 * - Regulaciones de suscripciones recurrentes
 * 
 * Características:
 * - Registro de clientes con consentimiento explícito
 * - Gestión de planes de suscripción
 * - Facturación electrónica (integración con sistemas chilenos)
 * - Historial de pagos
 * - Cancelación y pausado según normativa
 */
export class SuscripcionModule {
  readonly id = MODULE;
  readonly label = "Suscripciones";

  private readonly planes = new Map<string, Plan>();
  private readonly suscripciones = new Map<string, Suscripcion>();
  private readonly pagos = new Map<string, PagoSuscripcion[]>();
  private readonly store: PlatformStore;

  constructor(
    private readonly payments: Payments,
    config: AppConfig,
    store: PlatformStore,
  ) {
    this.store = store;
    
    // Cargar planes desde almacenamiento
    for (const plan of store.list<Plan>("suscripcion_planes")) {
      this.planes.set(plan.id, plan);
    }
    
    // Cargar suscripciones
    for (const sub of store.list<Suscripcion>("suscripciones")) {
      this.suscripciones.set(sub.id, sub);
    }
    
    // Cargar pagos
    for (const pago of store.list<PagoSuscripcion>("suscripcion_pagos")) {
      if (!this.pagos.has(pago.suscripcionId)) {
        this.pagos.set(pago.suscripcionId, []);
      }
      this.pagos.get(pago.suscripcionId)!.push(pago);
    }
    
    // Crear planes por defecto si no existen
    if (this.planes.size === 0) {
      this.createPlan({
        name: "Básico",
        description: "Plan básico para pequeñas empresas",
        price: 29990,
        currency: "CLP",
        billingCycle: "monthly",
        features: ["Hasta 5 colaboradores", "Transferencias ilimitadas", "Soporte básico"],
      });
      
      this.createPlan({
        name: "Profesional",
        description: "Plan profesional para empresas en crecimiento",
        price: 79990,
        currency: "CLP",
        billingCycle: "monthly",
        features: ["Hasta 20 colaboradores", "Transferencias ilimitadas", "Soporte prioritario", "Reportes avanzados"],
      });
      
      this.createPlan({
        name: "Empresarial",
        description: "Plan empresarial para grandes organizaciones",
        price: 199990,
        currency: "CLP",
        billingCycle: "monthly",
        features: ["Colaboradores ilimitados", "Transferencias ilimitadas", "Soporte 24/7", "API acceso", "Integración contable"],
      });
    }
  }

  // ============================================
  // PLANES
  // ============================================

  /**
   * Crear un nuevo plan de suscripción
   */
  createPlan(input: {
    name: string;
    description: string;
    price: number;
    currency?: string;
    billingCycle?: "monthly" | "quarterly" | "annual";
    trialDays?: number;
    features?: string[];
  }): Plan {
    const currency = input.currency || "CLP";
    const plan: Plan = {
      id: `plan_${randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      description: input.description.trim(),
      price: input.price,
      currency,
      billingCycle: input.billingCycle || "monthly",
      trialDays: input.trialDays || 0,
      features: input.features || [],
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    this.planes.set(plan.id, plan);
    this.store.put("suscripcion_planes", plan.id, plan);

    return plan;
  }

  /**
   * Listar todos los planes
   */
  listPlanes(): Plan[] {
    return [...this.planes.values()].filter(p => p.isActive);
  }

  /**
   * Obtener un plan específico
   */
  getPlan(planId: string): Plan | undefined {
    return this.planes.get(planId);
  }

  /**
   * Actualizar un plan
   */
  updatePlan(planId: string, input: Partial<Plan>): Plan {
    const plan = this.planes.get(planId);
    if (!plan) {
      throw new PlatformError("Plan no encontrado", 404);
    }

    const updated = {
      ...plan,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    this.planes.set(planId, updated);
    this.store.put("suscripcion_planes", planId, updated);

    return updated;
  }

  /**
   * Desactivar un plan
   */
  deactivatePlan(planId: string): boolean {
    const plan = this.planes.get(planId);
    if (!plan) {
      return false;
    }

    plan.isActive = false;
    this.planes.set(planId, plan);
    this.store.put("suscripcion_planes", planId, plan);

    return true;
  }

  // ============================================
  // SUSCRIPCIONES
  // ============================================

  /**
   * Validar consentimientos legales (Ley 19.628)
   */
  private validateConsent(input: RegistroInput): void {
    if (!input.aceptaTerminos) {
      throw new PlatformError("Debe aceptar los términos y condiciones", 400);
    }
    if (!input.aceptaPoliticaPrivacidad) {
      throw new PlatformError("Debe aceptar la política de privacidad", 400);
    }
    // El consentimiento de comunicaciones es opcional
  }

  /**
   * Validar RUT chileno (opcional)
   */
  private validateRut(rut?: string): boolean {
    if (!rut) return true;
    
    // Formato: 12345678-9 o 12.345.678-9
    const cleanRut = rut.replace(/[\.\-]/g, "");
    if (!/^\d{8,9}$/.test(cleanRut)) {
      return false;
    }
    
    // Validar dígito verificador
    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);
    
    let sum = 0;
    let multiplier = 2;
    
    for (let i = body.length - 1; i >= 0; i--) {
      sum += parseInt(body[i]) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    
    const calculatedDv = (11 - (sum % 11)) % 11;
    const dvChar = calculatedDv === 10 ? "K" : calculatedDv.toString();
    
    return dvChar === dv.toUpperCase();
  }

  /**
   * Crear una nueva suscripción
   * Cumple con:
   * - PCI DSS: No maneja datos de tarjeta
   * - Ley 19.628: Consentimiento explícito validado
   * - Normativa de facturación: Genera factura/boleta
   */
  createSuscripcion(actor: { id: string; email: string; role: Role; companyId?: string }, input: RegistroInput): SuscripcionResult {
    // Validar consentimientos legales
    this.validateConsent(input);
    
    // Validar RUT si se proporciona
    if (input.rut && !this.validateRut(input.rut)) {
      throw new PlatformError("RUT inválido", 400);
    }
    
    // Validar plan
    const plan = this.planes.get(input.planId);
    if (!plan) {
      throw new PlatformError("Plan no encontrado", 404);
    }
    
    // Validar email
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) {
      throw new PlatformError("Email inválido", 400);
    }
    
    // Calcular fechas del período
    const now = new Date();
    const billingCycle = input.billingCycle || plan.billingCycle;
    
    let periodEnd: Date;
    if (billingCycle === "monthly") {
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    } else if (billingCycle === "quarterly") {
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
    } else {
      periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }
    
    const nextBilling = new Date(periodEnd);
    
    // Crear suscripción
    const suscripcion: Suscripcion = {
      id: `sub_${randomUUID().slice(0, 8)}`,
      planId: plan.id,
      customerId: `cust_${randomUUID().slice(0, 8)}`,
      customerEmail: email,
      customerName: input.name.trim(),
      customerRut: input.rut ? input.rut.replace(/[\.\-]/g, "") : undefined,
      status: "pending",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      billingCycle,
      amount: plan.price,
      currency: plan.currency,
      paymentMethodId: input.paymentMethodToken,
      paymentGateway: input.gateway || "none",
      nextBillingDate: nextBilling.toISOString(),
      cancelAtPeriodEnd: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      metadata: Object.fromEntries(
        Object.entries({
          referrer: input.referrer,
          campaign: input.campaign,
          companyName: input.companyName,
          companyRut: input.companyRut ? input.companyRut.replace(/[\.\-]/g, "") : undefined,
          phone: input.phone,
        }).filter(([_, v]) => v !== undefined)
      ),
    };

    this.suscripciones.set(suscripcion.id, suscripcion);
    this.store.put("suscripciones", suscripcion.id, suscripcion);

    // Crear registro de pago inicial (pendiente)
    const pago: PagoSuscripcion = {
      id: `pago_${randomUUID().slice(0, 8)}`,
      suscripcionId: suscripcion.id,
      amount: plan.price,
      currency: plan.currency,
      paymentDate: now.toISOString(),
      paymentMethod: input.paymentMethodToken || "pending",
      transactionId: undefined,
      status: "pending",
      invoiceNumber: `FACT-${Date.now()}`,
      createdAt: now.toISOString(),
    };

    if (!this.pagos.has(suscripcion.id)) {
      this.pagos.set(suscripcion.id, []);
    }
    this.pagos.get(suscripcion.id)!.push(pago);
    this.store.put("suscripcion_pagos", pago.id, pago);

    return {
      suscripcion,
      pago,
      success: true,
      message: "Suscripción creada. Pendiente de pago.",
      nextStep: "payment",
    };
  }

  /**
   * Activar suscripción después del pago
   */
  activateSuscripcion(suscripcionId: string, paymentData: {
    transactionId: string;
    amount: number;
    paymentMethod: string;
    boletaUrl?: string;
  }): SuscripcionResult {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (suscripcion.status !== "pending") {
      throw new PlatformError(`La suscripción ya está en estado ${suscripcion.status}`, 400);
    }

    const now = new Date();
    suscripcion.status = "active";
    suscripcion.paymentMethodId = paymentData.paymentMethod;
    suscripcion.updatedAt = now.toISOString();

    this.suscripciones.set(suscripcionId, suscripcion);
    this.store.put("suscripciones", suscripcionId, suscripcion);

    // Actualizar pago
    const pagos = this.pagos.get(suscripcionId) || [];
    const pendingPayment = pagos.find(p => p.status === "pending");
    if (pendingPayment) {
      pendingPayment.status = "paid";
      pendingPayment.transactionId = paymentData.transactionId;
      pendingPayment.paymentDate = now.toISOString();
      pendingPayment.boletaUrl = paymentData.boletaUrl;
      this.store.put("suscripcion_pagos", pendingPayment.id, pendingPayment);
    }

    return {
      suscripcion,
      success: true,
      message: "Suscripción activada exitosamente",
    };
  }

  /**
   * Listar suscripciones
   */
  listSuscripciones(actor?: { id: string; role: Role; email?: string }): Suscripcion[] {
    if (actor && actor.role !== "operacion") {
      // Filtrar por email del actor si no es operacion
      return [...this.suscripciones.values()].filter(
        s => s.customerEmail === actor.email
      );
    }
    return [...this.suscripciones.values()];
  }

  /**
   * Obtener una suscripción específica
   */
  getSuscripcion(suscripcionId: string, actor?: { id: string; role: Role; email?: string }): Suscripcion | undefined {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) return undefined;
    
    if (actor && actor.role !== "operacion") {
      if (suscripcion.customerEmail !== actor.email) {
        throw new PlatformError("No tiene permiso para ver esta suscripción", 403);
      }
    }
    
    return suscripcion;
  }

  /**
   * Cancelar suscripción
   * Según normativa: puede cancelar en cualquier momento
   * Se respeta el período pagado
   */
  cancelSuscripcion(suscripcionId: string, actor: { id: string; role: Role; email: string }, immediate: boolean = false): Suscripcion {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (actor.role !== "operacion" && suscripcion.customerEmail !== actor.email) {
      throw new PlatformError("No tiene permiso para cancelar esta suscripción", 403);
    }

    if (suscripcion.status === "cancelled") {
      throw new PlatformError("La suscripción ya está cancelada", 400);
    }

    const now = new Date();
    suscripcion.status = "cancelled";
    suscripcion.cancelAtPeriodEnd = !immediate;
    suscripcion.cancelledAt = now.toISOString();
    suscripcion.updatedAt = now.toISOString();

    this.suscripciones.set(suscripcionId, suscripcion);
    this.store.put("suscripciones", suscripcionId, suscripcion);

    return suscripcion;
  }

  /**
   * Pausar suscripción
   */
  pauseSuscripcion(suscripcionId: string, actor: { id: string; role: Role; email: string }): Suscripcion {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (actor.role !== "operacion" && suscripcion.customerEmail !== actor.email) {
      throw new PlatformError("No tiene permiso para pausar esta suscripción", 403);
    }

    if (suscripcion.status !== "active") {
      throw new PlatformError(`No se puede pausar una suscripción en estado ${suscripcion.status}`, 400);
    }

    const now = new Date();
    suscripcion.status = "paused";
    suscripcion.updatedAt = now.toISOString();

    this.suscripciones.set(suscripcionId, suscripcion);
    this.store.put("suscripciones", suscripcionId, suscripcion);

    return suscripcion;
  }

  /**
   * Reanudar suscripción
   */
  resumeSuscripcion(suscripcionId: string, actor: { id: string; role: Role; email: string }): Suscripcion {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (actor.role !== "operacion" && suscripcion.customerEmail !== actor.email) {
      throw new PlatformError("No tiene permiso para reanudar esta suscripción", 403);
    }

    if (suscripcion.status !== "paused") {
      throw new PlatformError(`No se puede reanudar una suscripción en estado ${suscripcion.status}`, 400);
    }

    const now = new Date();
    suscripcion.status = "active";
    suscripcion.updatedAt = now.toISOString();

    this.suscripciones.set(suscripcionId, suscripcion);
    this.store.put("suscripciones", suscripcionId, suscripcion);

    return suscripcion;
  }

  /**
   * Cambiar plan de suscripción
   */
  changePlan(suscripcionId: string, newPlanId: string, actor: { id: string; role: Role; email: string }): Suscripcion {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (actor.role !== "operacion" && suscripcion.customerEmail !== actor.email) {
      throw new PlatformError("No tiene permiso para cambiar el plan", 403);
    }

    const newPlan = this.planes.get(newPlanId);
    if (!newPlan) {
      throw new PlatformError("Plan no encontrado", 404);
    }

    const now = new Date();
    suscripcion.planId = newPlan.id;
    suscripcion.amount = newPlan.price;
    suscripcion.billingCycle = newPlan.billingCycle;
    suscripcion.updatedAt = now.toISOString();

    // Recalcular período
    const billingCycle = newPlan.billingCycle;
    let periodEnd: Date;
    if (billingCycle === "monthly") {
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    } else if (billingCycle === "quarterly") {
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
    } else {
      periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }
    
    suscripcion.currentPeriodStart = now.toISOString();
    suscripcion.currentPeriodEnd = periodEnd.toISOString();
    suscripcion.nextBillingDate = periodEnd.toISOString();

    this.suscripciones.set(suscripcionId, suscripcion);
    this.store.put("suscripciones", suscripcionId, suscripcion);

    return suscripcion;
  }

  // ============================================
  // PAGOS
  // ============================================

  /**
   * Listar pagos de una suscripción
   */
  listPagos(suscripcionId: string, actor?: { id: string; role: Role; email: string }): PagoSuscripcion[] {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (actor && actor.role !== "operacion") {
      if (suscripcion.customerEmail !== actor.email) {
        throw new PlatformError("No tiene permiso para ver estos pagos", 403);
      }
    }

    return this.pagos.get(suscripcionId) || [];
  }

  /**
   * Registrar un pago
   */
  registerPago(suscripcionId: string, input: {
    amount: number;
    paymentMethod: string;
    transactionId?: string;
    status: "paid" | "pending" | "failed";
    boletaUrl?: string;
  }, actor: { id: string; role: Role }): PagoSuscripcion {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (actor.role !== "operacion" && actor.role !== "comercio") {
      throw new PlatformError("No tiene permiso para registrar pagos", 403);
    }

    const now = new Date();
    const pago: PagoSuscripcion = {
      id: `pago_${randomUUID().slice(0, 8)}`,
      suscripcionId,
      amount: input.amount,
      currency: suscripcion.currency,
      paymentDate: now.toISOString(),
      paymentMethod: input.paymentMethod,
      transactionId: input.transactionId,
      status: input.status,
      invoiceNumber: `FACT-${Date.now()}-${randomUUID().slice(0, 4)}`,
      boletaUrl: input.boletaUrl,
      createdAt: now.toISOString(),
    };

    if (!this.pagos.has(suscripcionId)) {
      this.pagos.set(suscripcionId, []);
    }
    this.pagos.get(suscripcionId)!.push(pago);
    this.store.put("suscripcion_pagos", pago.id, pago);

    // Si el pago es exitoso, actualizar período de suscripción
    if (input.status === "paid") {
      const billingCycle = suscripcion.billingCycle;
      let nextPeriodEnd: Date;
      
      const currentEnd = new Date(suscripcion.currentPeriodEnd);
      if (billingCycle === "monthly") {
        nextPeriodEnd = new Date(currentEnd.getFullYear(), currentEnd.getMonth() + 1, currentEnd.getDate());
      } else if (billingCycle === "quarterly") {
        nextPeriodEnd = new Date(currentEnd.getFullYear(), currentEnd.getMonth() + 3, currentEnd.getDate());
      } else {
        nextPeriodEnd = new Date(currentEnd.getFullYear() + 1, currentEnd.getMonth(), currentEnd.getDate());
      }
      
      suscripcion.currentPeriodStart = currentEnd.toISOString();
      suscripcion.currentPeriodEnd = nextPeriodEnd.toISOString();
      suscripcion.nextBillingDate = nextPeriodEnd.toISOString();
      suscripcion.status = "active";
      suscripcion.updatedAt = now.toISOString();
      
      this.suscripciones.set(suscripcionId, suscripcion);
      this.store.put("suscripciones", suscripcionId, suscripcion);
    }

    return pago;
  }

  // ============================================
  // ESTADÍSTICAS Y REPORTES
  // ============================================

  /**
   * Obtener estadísticas de suscripciones
   */
  getStats(actor?: { role: Role }): SuscripcionStats {
    const allSuscripciones = [...this.suscripciones.values()];
    const allPagos = [...this.pagos.values()].flat();
    
    const total = allSuscripciones.length;
    const active = allSuscripciones.filter(s => s.status === "active").length;
    const pending = allSuscripciones.filter(s => s.status === "pending").length;
    const cancelled = allSuscripciones.filter(s => s.status === "cancelled").length;
    
    const totalRevenue = allPagos
      .filter(p => p.status === "paid")
      .reduce((sum, p) => sum + p.amount, 0);
    
    const monthlyRecurring = allSuscripciones
      .filter(s => s.status === "active" && s.billingCycle === "monthly")
      .reduce((sum, s) => sum + s.amount, 0);
    
    const annualRecurring = allSuscripciones
      .filter(s => s.status === "active" && s.billingCycle === "annual")
      .reduce((sum, s) => sum + s.amount, 0);
    
    // Tasa de cancelación (churn rate)
    const churnRate = total > 0 ? (cancelled / total) * 100 : 0;
    
    // Vida promedio (simplificado)
    const activeDates = allSuscripciones
      .filter(s => s.status === "active")
      .map(s => new Date(s.createdAt));
    
    const now = new Date();
    const averageLifetime = activeDates.length > 0
      ? activeDates.reduce((sum, date) => sum + (now.getTime() - date.getTime()), 0) / activeDates.length / (1000 * 60 * 60 * 24)
      : 0;

    return {
      total,
      active,
      pending,
      cancelled,
      totalRevenue,
      monthlyRecurringRevenue: monthlyRecurring,
      annualRecurringRevenue: annualRecurring,
      churnRate,
      averageLifetime: Math.round(averageLifetime),
    };
  }

  /**
   * Formatear monto según currency
   */
  private formatAmount(amount: number, currency: string = "CLP"): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Generar boleta electrónica (simulada)
   * En producción, integrar con sistema de facturación electrónica chileno
   */
  generateBoleta(suscripcionId: string, actor: { id: string; role: Role; email: string }): { url: string; number: string } {
    const suscripcion = this.suscripciones.get(suscripcionId);
    if (!suscripcion) {
      throw new PlatformError("Suscripción no encontrada", 404);
    }

    if (actor.role !== "operacion" && actor.role !== "comercio") {
      throw new PlatformError("No tiene permiso para generar boletas", 403);
    }

    const invoiceNumber = `FACT-${Date.now()}-${randomUUID().slice(0, 4)}`;
    
    // En producción, aquí se integraría con:
    // - SII (Servicio de Impuestos Internos, Chile)
    // - Sistema de facturación electrónica
    // - Proveedor de boletas electrónicas
    
    // Para demo, generamos una URL simulada
    const url = `/boleta/${invoiceNumber}?customer=${encodeURIComponent(suscripcion.customerName)}&amount=${suscripcion.amount}&currency=${suscripcion.currency}`;

    // Actualizar suscripción con número de factura
    suscripcion.invoiceNumber = invoiceNumber;
    this.suscripciones.set(suscripcionId, suscripcion);
    this.store.put("suscripciones", suscripcionId, suscripcion);

    return { url, number: invoiceNumber };
  }

  /**
   * Exportar datos para contabilidad
   * Cumple con normativa chilena
   */
  exportForAccounting(actor: { role: Role; email: string }): Array<{
    suscripcionId: string;
    customerName: string;
    customerEmail: string;
    customerRut?: string;
    planName: string;
    amount: number;
    currency: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    invoiceNumber?: string;
  }> {
    if (actor.role !== "operacion") {
      throw new PlatformError("Solo operación puede exportar datos contables", 403);
    }

    return [...this.suscripciones.values()].map(sub => {
      const plan = this.planes.get(sub.planId);
      return {
        suscripcionId: sub.id,
        customerName: sub.customerName,
        customerEmail: sub.customerEmail,
        customerRut: sub.customerRut,
        planName: plan?.name || "Desconocido",
        amount: sub.amount,
        currency: sub.currency,
        status: sub.status,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        invoiceNumber: sub.invoiceNumber,
      };
    });
  }
}
