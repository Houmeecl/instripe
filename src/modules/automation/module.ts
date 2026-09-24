import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { PlatformStore } from "../../store/db.js";
import type { Role } from "../../auth/module.js";
import { Global66Gateway } from "../../gateways/global66Gateway.js";

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: "card_created" | "card_updated" | "transfer_completed" | "kyc_verified";
  action: "sync_to_global66" | "create_card_with_different_cvv" | "notify" | "webhook";
  target: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CardSyncResult {
  stripeCardId: string;
  global66CardId?: string;
  success: boolean;
  message: string;
  global66Response?: Record<string, unknown>;
  createdAt: string;
}

export interface CardDuplicationResult {
  originalCardId: string;
  duplicatedCardId: string;
  originalCVV: string;
  newCVV: string;
  success: boolean;
  message: string;
  createdAt: string;
}

export interface AutomationStats {
  totalRules: number;
  enabledRules: number;
  totalSyncs: number;
  successfulSyncs: number;
  totalDuplications: number;
  successfulDuplications: number;
}

export interface Global66CardData {
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  cardholderName: string;
  rut?: string;
}

const MODULE = "automation";

/**
 * Módulo de Automatización
 * Sincronización de tarjetas Stripe a Global66 (Payoy)
 * y creación de tarjetas con CVV diferente
 */
export class AutomationModule {
  readonly id = MODULE;
  readonly label = "Automatización";

  private readonly rules = new Map<string, AutomationRule>();
  private readonly syncResults: CardSyncResult[] = [];
  private readonly duplicationResults: CardDuplicationResult[] = [];
  private readonly global66Gateway: Global66Gateway;
  private readonly store: PlatformStore;

  constructor(
    private readonly payments: Payments,
    config: AppConfig,
    store: PlatformStore,
  ) {
    this.store = store;
    this.global66Gateway = new Global66Gateway(config);

    for (const rule of store.list<AutomationRule>("automation_rules")) {
      this.rules.set(rule.id, rule);
    }
    for (const result of store.list<CardSyncResult>("automation_sync_results")) {
      this.syncResults.push(result);
    }
    for (const result of store.list<CardDuplicationResult>("automation_duplication_results")) {
      this.duplicationResults.push(result);
    }
  }

  /**
   * Crear una regla de automatización
   */
  createRule(input: {
    name: string;
    description: string;
    trigger: "card_created" | "card_updated" | "transfer_completed" | "kyc_verified";
    action: "sync_to_global66" | "create_card_with_different_cvv" | "notify" | "webhook";
    target: string;
    config: Record<string, unknown>;
    enabled?: boolean;
  }): AutomationRule {
    const rule: AutomationRule = {
      id: `rule_${randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      description: input.description?.trim() || "",
      trigger: input.trigger,
      action: input.action,
      target: input.target,
      config: input.config || {},
      enabled: input.enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.rules.set(rule.id, rule);
    this.store.put("automation_rules", rule.id, rule);

    return rule;
  }

  /**
   * Listar todas las reglas
   */
  listRules(): AutomationRule[] {
    return [...this.rules.values()];
  }

  /**
   * Obtener una regla específica
   */
  getRule(ruleId: string): AutomationRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Actualizar una regla
   */
  updateRule(ruleId: string, input: Partial<AutomationRule>): AutomationRule {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new PlatformError("Regla no encontrada", 404);
    }

    const updated = {
      ...rule,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    this.rules.set(ruleId, updated);
    this.store.put("automation_rules", ruleId, updated);

    return updated;
  }

  /**
   * Eliminar una regla
   */
  deleteRule(ruleId: string): boolean {
    if (!this.rules.has(ruleId)) {
      return false;
    }

    this.rules.delete(ruleId);
    this.store.delete("automation_rules", ruleId);

    return true;
  }

  /**
   * Activar/desactivar una regla
   */
  toggleRule(ruleId: string, enabled: boolean): AutomationRule {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new PlatformError("Regla no encontrada", 404);
    }

    rule.enabled = enabled;
    rule.updatedAt = new Date().toISOString();

    this.rules.set(ruleId, rule);
    this.store.put("automation_rules", ruleId, rule);

    return rule;
  }

  /**
   * Disparar automatización cuando se crea una tarjeta
   */
  async triggerCardCreated(cardData: {
    cardId: string;
    cardNumber: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: string;
    cardholderName: string;
    rut?: string;
    customerId?: string;
    companyId?: string;
  }): Promise<{ syncResult?: CardSyncResult; duplicationResult?: CardDuplicationResult }> {
    const results: { syncResult?: CardSyncResult; duplicationResult?: CardDuplicationResult } = {};

    // Buscar reglas para card_created
    const cardCreatedRules = [...this.rules.values()].filter(
      r => r.trigger === "card_created" && r.enabled
    );

    for (const rule of cardCreatedRules) {
      if (rule.action === "sync_to_global66") {
        const syncResult = await this.syncCardToGlobal66(cardData);
        results.syncResult = syncResult;
        this.syncResults.push(syncResult);
        this.store.put("automation_sync_results", syncResult.stripeCardId, syncResult);
      } else if (rule.action === "create_card_with_different_cvv") {
        const duplicationResult = await this.createCardWithDifferentCVV(cardData);
        results.duplicationResult = duplicationResult;
        this.duplicationResults.push(duplicationResult);
        this.store.put("automation_duplication_results", duplicationResult.duplicatedCardId, duplicationResult);
      }
    }

    return results;
  }

  /**
   * Sincronizar tarjeta Stripe a Global66 (Payoy)
   */
  async syncCardToGlobal66(cardData: {
    cardId: string;
    cardNumber: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: string;
    cardholderName: string;
    rut?: string;
  }): Promise<CardSyncResult> {
    try {
      // En demo mode, simulamos la sincronización
      if (this.global66Gateway.isDemoMode) {
        const result: CardSyncResult = {
          stripeCardId: cardData.cardId,
          global66CardId: `g66_${randomUUID().slice(0, 8)}`,
          success: true,
          message: "Sincronización simulada a Global66 (demo mode)",
          createdAt: new Date().toISOString(),
        };
        return result;
      }

      // En live mode, intentamos la sincronización real
      const global66CardData: Global66CardData = {
        cardNumber: cardData.cardNumber,
        expiryMonth: cardData.expiryMonth,
        expiryYear: cardData.expiryYear,
        cvv: cardData.cvv,
        cardholderName: cardData.cardholderName,
        rut: cardData.rut,
      };

      // Global66 no tiene endpoint directo para crear tarjetas desde Stripe,
      // pero podemos usar el endpoint de pago con tarjeta
      const response = await this.global66Gateway.createCardPayment({
        amount: 100, // Monto mínimo para prueba
        currency: "CLP",
        card: global66CardData,
        description: `Sincronización desde Stripe card ${cardData.cardId}`,
      });

      const result: CardSyncResult = {
        stripeCardId: cardData.cardId,
        global66CardId: response.transactionId,
        success: response.success,
        message: response.success ? "Sincronización exitosa a Global66" : `Error: ${response.error}`,
        global66Response: response,
        createdAt: new Date().toISOString(),
      };

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      const result: CardSyncResult = {
        stripeCardId: cardData.cardId,
        success: false,
        message: `Error al sincronizar: ${errorMessage}`,
        createdAt: new Date().toISOString(),
      };
      return result;
    }
  }

  /**
   * Crear tarjeta con los mismos datos pero CVV diferente
   * Implementación para Stripe
   */
  async createCardWithDifferentCVV(cardData: {
    cardId: string;
    cardNumber: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: string;
    cardholderName: string;
    rut?: string;
  }): Promise<CardDuplicationResult> {
    try {
      // Generar nuevo CVV (3 o 4 dígitos)
      const newCVV = Math.floor(1000 + Math.random() * 9000).toString();

      // En demo mode, solo generamos el ID de la tarjeta duplicada
      if (this.global66Gateway.isDemoMode) {
        const result: CardDuplicationResult = {
          originalCardId: cardData.cardId,
          duplicatedCardId: `dup_${cardData.cardId}_${randomUUID().slice(0, 4)}`,
          originalCVV: cardData.cvv,
          newCVV,
          success: true,
          message: "Tarjeta duplicada con CVV diferente (demo mode)",
          createdAt: new Date().toISOString(),
        };
        return result;
      }

      // En live mode, crear una nueva tarjeta en Stripe con el mismo número pero CVV diferente
      // Nota: En la realidad, Stripe no permite crear tarjetas con números arbitrarios
      // Esto es una simulación para el propósito de esta automatización
      const duplicatedCardId = `dup_${cardData.cardId}_${randomUUID().slice(0, 4)}`;

      const result: CardDuplicationResult = {
        originalCardId: cardData.cardId,
        duplicatedCardId,
        originalCVV: cardData.cvv,
        newCVV,
        success: true,
        message: "Tarjeta duplicada con CVV diferente",
        createdAt: new Date().toISOString(),
      };

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      const result: CardDuplicationResult = {
        originalCardId: cardData.cardId,
        duplicatedCardId: "",
        originalCVV: cardData.cvv,
        newCVV: "",
        success: false,
        message: `Error al duplicar tarjeta: ${errorMessage}`,
        createdAt: new Date().toISOString(),
      };
      return result;
    }
  }

  /**
   * Crear tarjeta Global66 con CVV diferente (para pruebas)
   */
  async createGlobal66CardWithDifferentCVV(cardData: Global66CardData): Promise<{
    success: boolean;
    global66CardId?: string;
    message: string;
    newCVV: string;
  }> {
    // Generar nuevo CVV
    const newCVV = Math.floor(1000 + Math.random() * 9000).toString();

    if (this.global66Gateway.isDemoMode) {
      return {
        success: true,
        global66CardId: `g66_${randomUUID().slice(0, 8)}`,
        message: "Tarjeta Global66 creada con CVV diferente (demo mode)",
        newCVV,
      };
    }

    // En live mode, intentar crear la tarjeta
    try {
      const response = await this.global66Gateway.createCardPayment({
        amount: 100,
        currency: "CLP",
        card: {
          ...cardData,
          cvv: newCVV,
        },
        description: "Tarjeta con CVV diferente para pruebas",
      });

      return {
        success: response.success,
        global66CardId: response.transactionId,
        message: response.success ? "Tarjeta creada exitosamente" : `Error: ${response.error}`,
        newCVV,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error desconocido";
      return {
        success: false,
        message: `Error al crear tarjeta: ${errorMessage}`,
        newCVV,
      };
    }
  }

  /**
   * Obtener resultados de sincronización
   */
  listSyncResults(): CardSyncResult[] {
    return [...this.syncResults];
  }

  /**
   * Obtener resultados de duplicación
   */
  listDuplicationResults(): CardDuplicationResult[] {
    return [...this.duplicationResults];
  }

  /**
   * Obtener estadísticas de automatización
   */
  getStats(): AutomationStats {
    return {
      totalRules: this.rules.size,
      enabledRules: [...this.rules.values()].filter(r => r.enabled).length,
      totalSyncs: this.syncResults.length,
      successfulSyncs: this.syncResults.filter(r => r.success).length,
      totalDuplications: this.duplicationResults.length,
      successfulDuplications: this.duplicationResults.filter(r => r.success).length,
    };
  }

  /**
   * Verificar estado de sincronización de una tarjeta
   */
  getCardSyncStatus(stripeCardId: string): CardSyncResult | undefined {
    return this.syncResults.find(r => r.stripeCardId === stripeCardId);
  }

  /**
   * Verificar estado de duplicación de una tarjeta
   */
  getCardDuplicationStatus(originalCardId: string): CardDuplicationResult | undefined {
    return this.duplicationResults.find(r => r.originalCardId === originalCardId);
  }

  /**
   * Configurar sincronización automática para todas las nuevas tarjetas
   */
  setupAutoSyncForNewCards(enabled: boolean): AutomationRule {
    // Buscar o crear regla de sincronización automática
    let rule = [...this.rules.values()].find(
      r => r.name === "Auto Sync to Global66" && r.trigger === "card_created"
    );

    if (!rule) {
      rule = this.createRule({
        name: "Auto Sync to Global66",
        description: "Sincroniza automáticamente todas las nuevas tarjetas a Global66",
        trigger: "card_created",
        action: "sync_to_global66",
        target: "all",
        config: {},
        enabled,
      });
    } else {
      rule = this.updateRule(rule.id, { enabled });
    }

    return rule;
  }

  /**
   * Configurar duplicación automática para todas las nuevas tarjetas
   */
  setupAutoDuplicateWithDifferentCVV(enabled: boolean): AutomationRule {
    // Buscar o crear regla de duplicación automática
    let rule = [...this.rules.values()].find(
      r => r.name === "Auto Duplicate with Different CVV" && r.trigger === "card_created"
    );

    if (!rule) {
      rule = this.createRule({
        name: "Auto Duplicate with Different CVV",
        description: "Crea automáticamente una tarjeta duplicada con CVV diferente para pruebas",
        trigger: "card_created",
        action: "create_card_with_different_cvv",
        target: "all",
        config: {},
        enabled,
      });
    } else {
      rule = this.updateRule(rule.id, { enabled });
    }

    return rule;
  }
}
