import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { PlatformStore } from "../../store/db.js";
import type { Role } from "../../auth/module.js";

export interface PortalSession {
  id: string;
  customerId: string;
  email: string;
  companyId?: string;
  status: "pending" | "kyc_started" | "kyc_completed" | "connect_created" | "card_created" | "completed" | "failed";
  kycSessionId?: string;
  connectAccountId?: string;
  cardId?: string;
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProfile {
  id: string;
  email: string;
  name: string;
  phone?: string;
  address?: string;
  rut?: string;
  companyId?: string;
  kycVerified: boolean;
  connectAccountId?: string;
  cardId?: string;
  createdAt: string;
}

export interface OnboardingResult {
  success: boolean;
  session: PortalSession;
  customer?: CustomerProfile;
  message: string;
  nextStep?: string;
  kycUrl?: string;
  connectUrl?: string;
}

const MODULE = "portal";

/**
 * Módulo de Portal de Clientes
 * Orquesta el flujo de onboarding: KYC → Connect → Tarjeta
 */
export class PortalModule {
  readonly id = MODULE;
  readonly label = "Portal Clientes";

  private readonly sessions = new Map<string, PortalSession>();
  private readonly customers = new Map<string, CustomerProfile>();
  private readonly store: PlatformStore;

  constructor(
    private readonly payments: Payments,
    config: AppConfig,
    store: PlatformStore,
  ) {
    this.store = store;
    for (const session of store.list<PortalSession>("portal_sessions")) {
      this.sessions.set(session.id, session);
    }
    for (const customer of store.list<CustomerProfile>("portal_customers")) {
      this.customers.set(customer.id, customer);
    }
  }

  /**
   * Crear una nueva sesión de onboarding
   */
  createSession(email: string, companyId?: string): PortalSession {
    const session: PortalSession = {
      id: `ps_${randomUUID().slice(0, 8)}`,
      customerId: `cust_${randomUUID().slice(0, 8)}`,
      email: email.trim().toLowerCase(),
      companyId,
      status: "pending",
      currentStep: 0,
      totalSteps: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(session.id, session);
    this.store.put("portal_sessions", session.id, session);

    return session;
  }

  /**
   * Iniciar el flujo KYC para una sesión
   */
  startKYC(sessionId: string): { success: boolean; kycSessionId: string; kycUrl: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PlatformError("Sesión no encontrada", 404);
    }

    if (session.status !== "pending") {
      throw new PlatformError(`La sesión ya está en estado ${session.status}`, 400);
    }

    // Generar ID de sesión KYC
    const kycSessionId = `kyc_${randomUUID().slice(0, 8)}`;

    // Actualizar sesión
    session.kycSessionId = kycSessionId;
    session.status = "kyc_started";
    session.currentStep = 1;
    session.updatedAt = new Date().toISOString();

    this.sessions.set(session.id, session);
    this.store.put("portal_sessions", session.id, session);

    // URL demo para KYC
    const kycUrl = `/kyc?session_id=${kycSessionId}`;

    return {
      success: true,
      kycSessionId,
      kycUrl,
    };
  }

  /**
   * Completar verificación KYC
   */
  completeKYC(sessionId: string, customerData: {
    name: string;
    phone?: string;
    address?: string;
    rut?: string;
  }): OnboardingResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PlatformError("Sesión no encontrada", 404);
    }

    if (session.status !== "kyc_started") {
      throw new PlatformError(`Se esperaba estado kyc_started, pero está ${session.status}`, 400);
    }

    // Crear perfil de cliente
    const customer: CustomerProfile = {
      id: session.customerId,
      email: session.email,
      name: customerData.name.trim(),
      phone: customerData.phone?.trim(),
      address: customerData.address?.trim(),
      rut: customerData.rut?.trim(),
      companyId: session.companyId,
      kycVerified: true,
      createdAt: new Date().toISOString(),
    };

    this.customers.set(customer.id, customer);
    this.store.put("portal_customers", customer.id, customer);

    // Actualizar sesión
    session.status = "kyc_completed";
    session.currentStep = 2;
    session.updatedAt = new Date().toISOString();

    this.sessions.set(session.id, session);
    this.store.put("portal_sessions", session.id, session);

    return {
      success: true,
      session,
      customer,
      message: "KYC completado exitosamente",
      nextStep: "connect",
    };
  }

  /**
   * Crear cuenta Connect para el cliente
   */
  createConnectAccount(sessionId: string, businessType: "individual" | "company" = "individual"): OnboardingResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PlatformError("Sesión no encontrada", 404);
    }

    if (session.status !== "kyc_completed") {
      throw new PlatformError(`Se esperaba estado kyc_completed, pero está ${session.status}`, 400);
    }

    // Generar cuenta Connect (simulada)
    const connectAccountId = `acct_${randomUUID().slice(0, 8)}`;

    // Actualizar sesión
    session.connectAccountId = connectAccountId;
    session.status = "connect_created";
    session.currentStep = 3;
    session.updatedAt = new Date().toISOString();

    this.sessions.set(session.id, session);
    this.store.put("portal_sessions", session.id, session);

    // Actualizar cliente
    const customer = this.customers.get(session.customerId);
    if (customer) {
      customer.connectAccountId = connectAccountId;
      this.customers.set(customer.id, customer);
      this.store.put("portal_customers", customer.id, customer);
    }

    return {
      success: true,
      session,
      customer,
      message: "Cuenta Connect creada exitosamente",
      nextStep: "card",
    };
  }

  /**
   * Crear tarjeta para el cliente
   */
  createCard(sessionId: string, cardOptions: {
    cardType?: "virtual" | "physical";
    spendLimit?: number;
    categories?: string[];
  } = {}): OnboardingResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PlatformError("Sesión no encontrada", 404);
    }

    if (session.status !== "connect_created") {
      throw new PlatformError(`Se esperaba estado connect_created, pero está ${session.status}`, 400);
    }

    // Generar tarjeta (simulada)
    const cardId = `card_${randomUUID().slice(0, 8)}`;

    // Actualizar sesión
    session.cardId = cardId;
    session.status = "card_created";
    session.currentStep = 4;
    session.updatedAt = new Date().toISOString();

    this.sessions.set(session.id, session);
    this.store.put("portal_sessions", session.id, session);

    // Actualizar cliente
    const customer = this.customers.get(session.customerId);
    if (customer) {
      customer.cardId = cardId;
      this.customers.set(customer.id, customer);
      this.store.put("portal_customers", customer.id, customer);
    }

    return {
      success: true,
      session,
      customer,
      message: "Tarjeta creada exitosamente",
      nextStep: "complete",
    };
  }

  /**
   * Completar el onboarding completo
   */
  completeOnboarding(sessionId: string): OnboardingResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PlatformError("Sesión no encontrada", 404);
    }

    if (session.status !== "card_created") {
      throw new PlatformError(`Se esperaba estado card_created, pero está ${session.status}`, 400);
    }

    // Marcar como completado
    session.status = "completed";
    session.currentStep = 5;
    session.updatedAt = new Date().toISOString();

    this.sessions.set(session.id, session);
    this.store.put("portal_sessions", session.id, session);

    const customer = this.customers.get(session.customerId);

    return {
      success: true,
      session,
      customer,
      message: "Onboarding completado exitosamente",
      nextStep: "dashboard",
    };
  }

  /**
   * Crear onboarding completo en una sola llamada (KYC + Connect + Tarjeta)
   */
  createCompleteOnboarding(input: {
    email: string;
    name: string;
    phone?: string;
    address?: string;
    rut?: string;
    companyId?: string;
    businessType?: "individual" | "company";
    cardOptions?: {
      cardType?: "virtual" | "physical";
      spendLimit?: number;
      categories?: string[];
    };
  }): OnboardingResult {
    // Crear sesión
    const session = this.createSession(input.email, input.companyId);

    // Iniciar KYC
    this.startKYC(session.id);

    // Completar KYC
    const kycResult = this.completeKYC(session.id, {
      name: input.name,
      phone: input.phone,
      address: input.address,
      rut: input.rut,
    });

    // Crear Connect
    const connectResult = this.createConnectAccount(session.id, input.businessType || "individual");

    // Crear tarjeta
    const cardResult = this.createCard(session.id, input.cardOptions || {});

    // Completar
    return this.completeOnboarding(session.id);
  }

  /**
   * Obtener sesión de onboarding
   */
  getSession(sessionId: string): PortalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Obtener perfil de cliente
   */
  getCustomer(customerId: string): CustomerProfile | undefined {
    return this.customers.get(customerId);
  }

  /**
   * Listar todas las sesiones
   */
  listSessions(): PortalSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Listar todos los clientes
   */
  listCustomers(): CustomerProfile[] {
    return [...this.customers.values()];
  }

  /**
   * Obtener estadísticas del portal
   */
  getStats(): {
    totalSessions: number;
    completed: number;
    pending: number;
    failed: number;
    totalCustomers: number;
    kycVerified: number;
    withConnect: number;
    withCard: number;
  } {
    const allSessions = [...this.sessions.values()];
    const allCustomers = [...this.customers.values()];

    return {
      totalSessions: allSessions.length,
      completed: allSessions.filter(s => s.status === "completed").length,
      pending: allSessions.filter(s => s.status === "pending" || s.status === "kyc_started" || s.status === "kyc_completed" || s.status === "connect_created" || s.status === "card_created").length,
      failed: allSessions.filter(s => s.status === "failed").length,
      totalCustomers: allCustomers.length,
      kycVerified: allCustomers.filter(c => c.kycVerified).length,
      withConnect: allCustomers.filter(c => c.connectAccountId).length,
      withCard: allCustomers.filter(c => c.cardId).length,
    };
  }

  /**
   * Obtener progreso de una sesión
   */
  getProgress(sessionId: string): {
    session: PortalSession;
    progress: number;
    steps: Array<{
      name: string;
      status: "completed" | "current" | "pending";
      stepNumber: number;
    }>;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PlatformError("Sesión no encontrada", 404);
    }

    const progress = (session.currentStep / session.totalSteps) * 100;

    const steps: Array<{ name: string; status: "pending" | "current" | "completed"; stepNumber: number }> = [
      { name: "Iniciar", status: session.currentStep > 0 ? "completed" : "current", stepNumber: 0 },
      { name: "KYC", status: session.currentStep > 1 ? "completed" : session.currentStep === 1 ? "current" : "pending", stepNumber: 1 },
      { name: "Connect", status: session.currentStep > 2 ? "completed" : session.currentStep === 2 ? "current" : "pending", stepNumber: 2 },
      { name: "Tarjeta", status: session.currentStep > 3 ? "completed" : session.currentStep === 3 ? "current" : "pending", stepNumber: 3 },
      { name: "Completar", status: session.currentStep > 4 ? "completed" : session.currentStep === 4 ? "current" : "pending", stepNumber: 4 },
    ];

    return {
      session,
      progress,
      steps,
    };
  }
}
