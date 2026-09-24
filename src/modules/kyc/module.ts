import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import { createStripe, stripeMessage } from "../../stripe/client.js";
import type { PlatformStore } from "../../store/db.js";

/**
 * KYC (Know Your Customer) verification status
 */
export type KYCStatus = 
  | "not_started"
  | "pending"
  | "verified"
  | "failed";

/**
 * Document types for KYC verification
 */
export type DocumentType = 
  | "id_card"
  | "passport"
  | "driving_license";

/**
 * KYC verification document
 */
export interface KYCDocument {
  id: string;
  type: DocumentType;
  frontImageUrl?: string;
  backImageUrl?: string;
  status: "uploaded" | "processing" | "verified" | "failed";
  uploadedAt: string;
}

/**
 * KYC verification session
 */
export interface KYCSession {
  id: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  status: KYCStatus;
  documents: KYCDocument[];
  verificationUrl?: string;
  stripeVerificationId?: string;
  verifiedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Customer profile with KYC status
 */
export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  kycStatus: KYCStatus;
  kycSessionId?: string;
  stripeCustomerId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Required verification fields based on country
 */
export interface RequiredVerification {
  documents: DocumentType[];
  personalInfo: string[];
  addressRequired: boolean;
  selfieRequired: boolean;
}

/**
 * KYC configuration for different countries
 */
export const KYC_CONFIG: Record<string, RequiredVerification> = {
  CL: {
    documents: ["id_card"],
    personalInfo: ["first_name", "last_name", "dob", "email", "phone"],
    addressRequired: true,
    selfieRequired: true,
  },
  default: {
    documents: ["id_card", "passport"],
    personalInfo: ["first_name", "last_name", "dob", "email"],
    addressRequired: true,
    selfieRequired: false,
  },
};

const MODULE = "kyc";

/**
 * KYC Module for customer verification
 * Uses Stripe Identity API when available, falls back to local storage
 */
export class KYCModule {
  readonly id = MODULE;
  readonly label = "KYC";
  
  private readonly customers = new Map<string, CustomerProfile>();
  private readonly sessions = new Map<string, KYCSession>();
  private readonly stripe: Stripe | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly store: PlatformStore,
  ) {
    this.stripe = createStripe(config);
    
    for (const customer of store.list<CustomerProfile>("kyc_customers")) {
      this.customers.set(customer.id, customer);
    }
    for (const session of store.list<KYCSession>("kyc_sessions")) {
      this.sessions.set(session.id, session);
    }
  }

  getConfig(country: string = "CL"): RequiredVerification {
    return KYC_CONFIG[country.toUpperCase()] || KYC_CONFIG.default;
  }

  listCustomers(): CustomerProfile[] {
    return [...this.customers.values()].map(c => ({ ...c }));
  }

  getCustomer(customerId: string): CustomerProfile | undefined {
    return this.customers.get(customerId) ? { ...this.customers.get(customerId)! } : undefined;
  }

  getCustomerByEmail(email: string): CustomerProfile | undefined {
    const normalizedEmail = email.trim().toLowerCase();
    for (const customer of this.customers.values()) {
      if (customer.email.toLowerCase() === normalizedEmail) {
        return { ...customer };
      }
    }
    return undefined;
  }

  createOrUpdateCustomer(input: {
    id?: string;
    name: string;
    email: string;
    phone?: string;
    stripeCustomerId?: string;
  }): CustomerProfile {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    
    if (!name || !email) {
      throw new PlatformError("Nombre y email son requeridos", 400);
    }

    let existing = this.getCustomerByEmail(email);
    const customerId = input.id || existing?.id || `kyc_cus_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    
    const customer: CustomerProfile = {
      id: customerId,
      name,
      email,
      phone: input.phone?.trim(),
      kycStatus: existing?.kycStatus || "not_started",
      kycSessionId: existing?.kycSessionId,
      stripeCustomerId: input.stripeCustomerId || existing?.stripeCustomerId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.customers.set(customerId, customer);
    this.store.put("kyc_customers", customerId, customer);
    
    return { ...customer };
  }

  async createSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<KYCSession> {
    const customer = this.customers.get(input.customerId);
    if (!customer) {
      throw new PlatformError(`Cliente no encontrado: ${input.customerId}`, 404);
    }

    const sessionId = `kyc_sess_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const session: KYCSession = {
      id: sessionId,
      customerId: customer.id,
      customerEmail: customer.email,
      customerName: customer.name,
      status: "pending",
      documents: [],
      createdAt: now,
      updatedAt: now,
    };

    if (!this.stripe) {
      this.sessions.set(sessionId, session);
      this.store.put("kyc_sessions", sessionId, session);
      
      customer.kycStatus = "pending";
      customer.kycSessionId = sessionId;
      customer.updatedAt = now;
      this.customers.set(customer.id, customer);
      this.store.put("kyc_customers", customer.id, customer);
      
      return { ...session };
    }

    try {
      const params: Stripe.Identity.VerificationSessionCreateParams = {
        type: "document",
        metadata: {
          module: MODULE,
          customer_id: customer.id,
          customer_email: customer.email,
        },
        return_url: input.returnUrl,
      };

      const verificationSession = await this.stripe.identity.verificationSessions.create(
        params
      );

      session.verificationUrl = verificationSession.url ? verificationSession.url : undefined;
      session.stripeVerificationId = verificationSession.id ? verificationSession.id : undefined;

      this.sessions.set(sessionId, session);
      this.store.put("kyc_sessions", sessionId, session);

      customer.kycStatus = "pending";
      customer.kycSessionId = sessionId;
      customer.updatedAt = now;
      this.customers.set(customer.id, customer);
      this.store.put("kyc_customers", customer.id, customer);

      return { ...session };
    } catch (error) {
      throw new PlatformError(`No se pudo crear la sesion: ${stripeMessage(error)}`, 502);
    }
  }

  getSession(sessionId: string): KYCSession | undefined {
    return this.sessions.get(sessionId) ? { ...this.sessions.get(sessionId)! } : undefined;
  }

  getSessionByCustomer(customerId: string): KYCSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.customerId === customerId) {
        return { ...session };
      }
    }
    return undefined;
  }

  async uploadDocument(input: {
    sessionId: string;
    type: DocumentType;
    frontImageUrl: string;
    backImageUrl?: string;
  }): Promise<KYCDocument> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new PlatformError(`Sesion KYC no encontrada: ${input.sessionId}`, 404);
    }

    const docId = `kyc_doc_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const document: KYCDocument = {
      id: docId,
      type: input.type,
      frontImageUrl: input.frontImageUrl,
      backImageUrl: input.backImageUrl,
      status: "uploaded",
      uploadedAt: now,
    };

    session.documents.push({ ...document });
    session.updatedAt = now;
    this.sessions.set(input.sessionId, session);
    this.store.put("kyc_sessions", input.sessionId, session);

    return { ...document };
  }

  async verifySession(sessionId: string): Promise<KYCSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new PlatformError(`Sesion KYC no encontrada: ${sessionId}`, 404);
    }

    const customer = this.customers.get(session.customerId);
    if (!customer) {
      throw new PlatformError(`Cliente no encontrado: ${session.customerId}`, 404);
    }

    if (this.stripe && session.stripeVerificationId) {
      try {
        const verificationSession = await this.stripe.identity.verificationSessions.retrieve(
          session.stripeVerificationId
        );

        session.status = verificationSession.status as KYCStatus;
        session.verifiedAt = verificationSession.status === "verified" ? new Date().toISOString() : undefined;
        const errorCode = verificationSession.last_error?.code;
        session.failureReason = errorCode ? errorCode : undefined;
        session.updatedAt = new Date().toISOString();

        customer.kycStatus = session.status;
        customer.updatedAt = session.updatedAt;
        this.customers.set(customer.id, customer);
        this.store.put("kyc_customers", customer.id, customer);

        this.sessions.set(sessionId, session);
        this.store.put("kyc_sessions", sessionId, session);

        return { ...session };
      } catch (error) {
        throw new PlatformError(`No se pudo verificar: ${stripeMessage(error)}`, 502);
      }
    }

    if (session.documents.length > 0) {
      session.status = "verified";
      session.verifiedAt = new Date().toISOString();
      session.updatedAt = new Date().toISOString();

      customer.kycStatus = "verified";
      customer.updatedAt = session.updatedAt;
      this.customers.set(customer.id, customer);
      this.store.put("kyc_customers", customer.id, customer);

      this.sessions.set(sessionId, session);
      this.store.put("kyc_sessions", sessionId, session);
    }

    return { ...session };
  }

  async handleWebhook(event: Stripe.Event): Promise<{ processed: boolean; customerId?: string; status?: KYCStatus }> {
    if (!this.stripe) return { processed: false };

    const object = event.data.object as Stripe.Identity.VerificationSession;
    const eventType = event.type as string;

    if (eventType === "identity.verification_session.updated") {
      const session = object as Stripe.Identity.VerificationSession;
      const metadata = session.metadata as Record<string, string>;
      const customerId = metadata?.customer_id;

      if (customerId) {
        const kycSession = this.getSessionByCustomer(customerId);
        if (kycSession && kycSession.stripeVerificationId === session.id) {
          kycSession.status = session.status as KYCStatus;
          kycSession.verifiedAt = session.status === "verified" ? new Date().toISOString() : undefined;
          const errorCode = session.last_error?.code;
          kycSession.failureReason = errorCode ? errorCode : undefined;
          kycSession.updatedAt = new Date().toISOString();

          const customer = this.customers.get(customerId);
          if (customer) {
            customer.kycStatus = kycSession.status;
            customer.updatedAt = kycSession.updatedAt;
            this.customers.set(customerId, customer);
            this.store.put("kyc_customers", customerId, customer);
          }

          this.sessions.set(kycSession.id, kycSession);
          this.store.put("kyc_sessions", kycSession.id, kycSession);

          return { processed: true, customerId, status: kycSession.status };
        }
      }
    }

    if (eventType === "identity.verification_session.canceled") {
      const session = object as Stripe.Identity.VerificationSession;
      const metadata = session.metadata as Record<string, string>;
      const customerId = metadata?.customer_id;

      if (customerId) {
        const kycSession = this.getSessionByCustomer(customerId);
        if (kycSession && kycSession.stripeVerificationId === session.id) {
          kycSession.status = "failed";
          kycSession.failureReason = "User canceled verification";
          kycSession.updatedAt = new Date().toISOString();

          const customer = this.customers.get(customerId);
          if (customer) {
            customer.kycStatus = "failed";
            customer.updatedAt = kycSession.updatedAt;
            this.customers.set(customerId, customer);
            this.store.put("kyc_customers", customerId, customer);
          }

          this.sessions.set(kycSession.id, kycSession);
          this.store.put("kyc_sessions", kycSession.id, kycSession);

          return { processed: true, customerId, status: "failed" };
        }
      }
    }

    return { processed: false };
  }

  getRequiredDocuments(country: string = "CL"): DocumentType[] {
    return this.getConfig(country).documents;
  }

  isVerified(customerId: string): boolean {
    const customer = this.customers.get(customerId);
    return customer?.kycStatus === "verified";
  }

  getCustomerKYCStatus(customerId: string): { status: KYCStatus; sessionId?: string; verifiedAt?: string } {
    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new PlatformError(`Cliente no encontrado: ${customerId}`, 404);
    }

    return {
      status: customer.kycStatus,
      sessionId: customer.kycSessionId,
      verifiedAt: customer.updatedAt,
    };
  }

  async createStripeCustomer(input: {
    name: string;
    email: string;
    phone?: string;
    metadata?: Record<string, string>;
  }): Promise<{ customerId: string; stripeCustomerId: string }> {
    if (!this.stripe) {
      throw new PlatformError("Stripe no esta configurado", 409);
    }

    try {
      const stripeCustomer = await this.stripe.customers.create({
        name: input.name,
        email: input.email,
        phone: input.phone,
        metadata: input.metadata,
      });

      const customer = this.createOrUpdateCustomer({
        name: input.name,
        email: input.email,
        phone: input.phone,
        stripeCustomerId: stripeCustomer.id,
      });

      return {
        customerId: customer.id,
        stripeCustomerId: stripeCustomer.id,
      };
    } catch (error) {
      throw new PlatformError(`Error al crear cliente: ${stripeMessage(error)}`, 502);
    }
  }

  getStats(): {
    total: number;
    verified: number;
    pending: number;
    failed: number;
    notStarted: number;
  } {
    const stats = {
      total: this.customers.size,
      verified: 0,
      pending: 0,
      failed: 0,
      notStarted: 0,
    };

    for (const customer of this.customers.values()) {
      switch (customer.kycStatus) {
        case "verified":
          stats.verified++;
          break;
        case "pending":
          stats.pending++;
          break;
        case "failed":
          stats.failed++;
          break;
        default:
          stats.notStarted++;
          break;
      }
    }

    return stats;
  }
}
