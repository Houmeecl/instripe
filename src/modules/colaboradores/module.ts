import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { PlatformError } from "../../errors.js";
import type { Payments } from "../../payments/service.js";
import type { PlatformStore } from "../../store/db.js";
import type { Role } from "../../auth/module.js";

export interface Colaborador {
  id: string;
  companyId: string;
  userId: string;
  name: string;
  email: string;
  role: "colaborador" | "administrador_empresa";
  roleLabel: string;
  ledgerAccountId: string;
  cardId?: string;
  spendLimit: number;
  categories: string[];
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
}

export interface ColaboradorView {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  cardLast4: string;
  balance: number;
  displayBalance: string;
  spendLimit: number;
  displaySpendLimit: string;
  status: string;
  categories: string[];
  createdAt: string;
}

export interface TransferenciaColaborador {
  id: string;
  fromColaboradorId: string;
  fromColaboradorName: string;
  toColaboradorId: string;
  toColaboradorName: string;
  amount: number;
  displayAmount: string;
  description: string;
  companyId: string;
  createdAt: string;
}

const MODULE = "colaboradores";

/**
 * M\u00f3dulo de Colaboradores para empresas
 * Permite crear colaboradores con tarjetas virtuales y transferencias internas
 */
export class ColaboradoresModule {
  readonly id = MODULE;
  readonly label = "Colaboradores";

  private readonly colaboradores = new Map<string, Colaborador>();
  private readonly transferencias: TransferenciaColaborador[] = [];
  private readonly store: PlatformStore;

  constructor(
    private readonly payments: Payments,
    config: AppConfig,
    store: PlatformStore,
  ) {
    this.store = store;
    for (const colab of store.list<Colaborador>("colaboradores")) {
      this.colaboradores.set(colab.id, colab);
    }
    for (const transfer of store.list<TransferenciaColaborador>("colaborador_transfers")) {
      this.transferencias.push(transfer);
    }
  }

  /**
   * Crear un nuevo colaborador para una empresa
   */
  create(actor: { id: string; email: string; role: Role; companyId?: string }, input: {
    companyId: string;
    name: string;
    email: string;
    role: "colaborador" | "administrador_empresa";
    spendLimit?: number;
    categories?: string[];
  }): ColaboradorView {
    // Validar permisos
    if (actor.role !== "operacion" && actor.role !== "administrador_empresa" && actor.role !== "titular") {
      throw new PlatformError("No tiene permiso para crear colaboradores", 403);
    }

    // Validar que el actor pertenece a la empresa
    if (actor.role !== "operacion" && actor.companyId !== input.companyId) {
      throw new PlatformError("No tiene permiso para agregar colaboradores a esta empresa", 403);
    }

    const ledger = this.payments.ledger.createAccount({
      name: input.name,
      email: input.email,
      currency: this.payments.walletAccount.currency,
    });

    const colaborador: Colaborador = {
      id: `col_${randomUUID().slice(0, 8)}`,
      companyId: input.companyId,
      userId: `usr_col_${randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      roleLabel: input.role === "administrador_empresa" ? "Administrador" : "Colaborador",
      ledgerAccountId: ledger.id,
      cardId: `crd_${randomUUID().slice(0, 8)}`,
      spendLimit: input.spendLimit || 1000000,
      categories: input.categories || ["alimentacion", "transporte", "oficina", "combustible", "salud", "otros"],
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.colaboradores.set(colaborador.id, colaborador);
    this.store.put("colaboradores", colaborador.id, colaborador);

    return this.present(colaborador);
  }

  /**
   * Listar todos los colaboradores de una empresa
   */
  listByCompany(companyId: string, actor?: { id: string; role: Role; companyId?: string }): ColaboradorView[] {
    // Validar permisos
    if (actor && actor.role !== "operacion" && actor.role !== "administrador_empresa" && actor.role !== "titular") {
      throw new PlatformError("No tiene permiso para ver colaboradores", 403);
    }

    return [...this.colaboradores.values()]
      .filter(c => c.companyId === companyId)
      .map(c => this.present(c));
  }

  /**
   * Obtener un colaborador espec\u00edfico
   */
  get(colaboradorId: string, actor?: { id: string; role: Role; companyId?: string }): ColaboradorView | undefined {
    const colab = this.colaboradores.get(colaboradorId);
    
    if (!colab) return undefined;
    
    // Validar permisos
    if (actor && actor.role !== "operacion") {
      if (actor.role === "administrador_empresa" || actor.role === "titular") {
        if (actor.companyId !== colab.companyId) {
          throw new PlatformError("No tiene permiso para ver este colaborador", 403);
        }
      } else if (actor.role === "colaborador") {
        if (actor.id !== colab.userId) {
          throw new PlatformError("No tiene permiso para ver este colaborador", 403);
        }
      } else {
        throw new PlatformError("No tiene permiso para ver colaboradores", 403);
      }
    }

    return this.present(colab);
  }

  /**
   * Transferir fondos entre colaboradores de la misma empresa
   */
  transfer(actor: { id: string; email: string; role: Role; companyId?: string }, input: {
    fromColaboradorId: string;
    toColaboradorId: string;
    amount: number;
    description: string;
  }): { success: boolean; message: string; transferencia: TransferenciaColaborador } {
    const from = this.colaboradores.get(input.fromColaboradorId);
    const to = this.colaboradores.get(input.toColaboradorId);

    if (!from || !to) {
      throw new PlatformError("Colaborador no encontrado", 404);
    }

    // Verificar que los colaboradores son de la misma empresa
    if (from.companyId !== to.companyId) {
      throw new PlatformError("Los colaboradores deben ser de la misma empresa", 400);
    }

    // Validar permisos del actor
    if (actor.role !== "operacion") {
      if (actor.role === "administrador_empresa" || actor.role === "titular") {
        if (actor.companyId !== from.companyId) {
          throw new PlatformError("No tiene permiso para transferir en esta empresa", 403);
        }
      } else if (actor.role === "colaborador") {
        if (actor.id !== from.userId) {
          throw new PlatformError("Solo puede transferir desde su propia cuenta", 403);
        }
      } else {
        throw new PlatformError("No tiene permiso para realizar transferencias", 403);
      }
    }

    // Verificar saldo suficiente
    const fromBalance = this.payments.ledger.getAccount(from.ledgerAccountId)?.balance ?? 0;
    if (fromBalance < input.amount) {
      throw new PlatformError("Saldo insuficiente", 422);
    }

    // Realizar la transferencia en el libro mayor
    this.payments.ledger.post("debit", from.ledgerAccountId, input.amount, input.description);
    this.payments.ledger.post("credit", to.ledgerAccountId, input.amount, input.description);

    // Registrar la transferencia
    const transferencia: TransferenciaColaborador = {
      id: `tfr_${randomUUID().slice(0, 8)}`,
      fromColaboradorId: from.id,
      fromColaboradorName: from.name,
      toColaboradorId: to.id,
      toColaboradorName: to.name,
      amount: input.amount,
      displayAmount: this.formatAmount(input.amount),
      description: input.description,
      companyId: from.companyId,
      createdAt: new Date().toISOString(),
    };

    this.transferencias.push(transferencia);
    this.store.put("colaborador_transfers", transferencia.id, transferencia);

    return {
      success: true,
      message: "Transferencia realizada exitosamente",
      transferencia,
    };
  }

  /**
   * Listar transferencias de un colaborador
   */
  listTransferencias(colaboradorId: string, actor?: { id: string; role: Role; companyId?: string }): TransferenciaColaborador[] {
    const colab = this.colaboradores.get(colaboradorId);
    
    if (!colab) {
      throw new PlatformError("Colaborador no encontrado", 404);
    }

    // Validar permisos
    if (actor && actor.role !== "operacion") {
      if (actor.role === "administrador_empresa" || actor.role === "titular") {
        if (actor.companyId !== colab.companyId) {
          throw new PlatformError("No tiene permiso para ver estas transferencias", 403);
        }
      } else if (actor.role === "colaborador") {
        if (actor.id !== colab.userId) {
          throw new PlatformError("No tiene permiso para ver estas transferencias", 403);
        }
      } else {
        throw new PlatformError("No tiene permiso para ver transferencias", 403);
      }
    }

    return this.transferencias.filter(
      t => t.fromColaboradorId === colaboradorId || t.toColaboradorId === colaboradorId
    );
  }

  /**
   * Listar todas las transferencias de una empresa
   */
  listTransferenciasByCompany(companyId: string, actor?: { id: string; role: Role; companyId?: string }): TransferenciaColaborador[] {
    // Validar permisos
    if (actor && actor.role !== "operacion") {
      if (actor.role !== "administrador_empresa" && actor.role !== "titular") {
        throw new PlatformError("No tiene permiso para ver transferencias de la empresa", 403);
      }
      if (actor.companyId !== companyId) {
        throw new PlatformError("No tiene permiso para ver transferencias de esta empresa", 403);
      }
    }

    return this.transferencias.filter(t => t.companyId === companyId);
  }

  /**
   * Bloquear o desbloquear un colaborador
   */
  toggleStatus(colaboradorId: string, status: "active" | "suspended", actor: { id: string; role: Role; companyId?: string }): ColaboradorView {
    const colab = this.colaboradores.get(colaboradorId);
    if (!colab) {
      throw new PlatformError("Colaborador no encontrado", 404);
    }

    // Validar permisos
    if (actor.role !== "operacion") {
      if (actor.role !== "administrador_empresa" && actor.role !== "titular") {
        throw new PlatformError("No tiene permiso para modificar colaboradores", 403);
      }
      if (actor.companyId !== colab.companyId) {
        throw new PlatformError("No tiene permiso para modificar este colaborador", 403);
      }
    }

    colab.status = status;
    colab.updatedAt = new Date().toISOString();
    this.colaboradores.set(colab.id, colab);
    this.store.put("colaboradores", colab.id, colab);

    return this.present(colab);
  }

  /**
   * Actualizar l\u00edmite de gasto de un colaborador
   */
  updateSpendLimit(colaboradorId: string, spendLimit: number, actor: { id: string; role: Role; companyId?: string }): ColaboradorView {
    const colab = this.colaboradores.get(colaboradorId);
    if (!colab) {
      throw new PlatformError("Colaborador no encontrado", 404);
    }

    // Validar permisos
    if (actor.role !== "operacion") {
      if (actor.role !== "administrador_empresa" && actor.role !== "titular") {
        throw new PlatformError("No tiene permiso para modificar colaboradores", 403);
      }
      if (actor.companyId !== colab.companyId) {
        throw new PlatformError("No tiene permiso para modificar este colaborador", 403);
      }
    }

    colab.spendLimit = spendLimit;
    colab.updatedAt = new Date().toISOString();
    this.colaboradores.set(colab.id, colab);
    this.store.put("colaboradores", colab.id, colab);

    return this.present(colab);
  }

  /**
   * Actualizar categor\u00edas permitidas
   */
  updateCategories(colaboradorId: string, categories: string[], actor: { id: string; role: Role; companyId?: string }): ColaboradorView {
    const colab = this.colaboradores.get(colaboradorId);
    if (!colab) {
      throw new PlatformError("Colaborador no encontrado", 404);
    }

    // Validar permisos
    if (actor.role !== "operacion") {
      if (actor.role !== "administrador_empresa" && actor.role !== "titular") {
        throw new PlatformError("No tiene permiso para modificar colaboradores", 403);
      }
      if (actor.companyId !== colab.companyId) {
        throw new PlatformError("No tiene permiso para modificar este colaborador", 403);
      }
    }

    colab.categories = categories;
    colab.updatedAt = new Date().toISOString();
    this.colaboradores.set(colab.id, colab);
    this.store.put("colaboradores", colab.id, colab);

    return this.present(colab);
  }

  /**
   * Eliminar un colaborador
   */
  delete(colaboradorId: string, actor: { id: string; role: Role; companyId?: string }): boolean {
    const colab = this.colaboradores.get(colaboradorId);
    if (!colab) {
      throw new PlatformError("Colaborador no encontrado", 404);
    }

    // Validar permisos
    if (actor.role !== "operacion") {
      if (actor.role !== "administrador_empresa" && actor.role !== "titular") {
        throw new PlatformError("No tiene permiso para eliminar colaboradores", 403);
      }
      if (actor.companyId !== colab.companyId) {
        throw new PlatformError("No tiene permiso para eliminar este colaborador", 403);
      }
    }

    this.colaboradores.delete(colab.id);
    this.store.delete("colaboradores", colab.id);

    return true;
  }

  /**
   * Obtener estad\u00edsticas de una empresa
   */
  getStats(companyId: string, actor?: { id: string; role: Role; companyId?: string }): {
    total: number;
    administradores: number;
    colaboradores: number;
    activos: number;
    suspendidos: number;
    totalBalance: number;
    totalSpendLimit: number;
  } {
    // Validar permisos
    if (actor && actor.role !== "operacion") {
      if (actor.role !== "administrador_empresa" && actor.role !== "titular") {
        throw new PlatformError("No tiene permiso para ver estad\u00edsticas", 403);
      }
      if (actor.companyId !== companyId) {
        throw new PlatformError("No tiene permiso para ver estad\u00edsticas de esta empresa", 403);
      }
    }

    const companyColaboradores = [...this.colaboradores.values()].filter(
      c => c.companyId === companyId
    );

    return {
      total: companyColaboradores.length,
      administradores: companyColaboradores.filter(c => c.role === "administrador_empresa").length,
      colaboradores: companyColaboradores.filter(c => c.role === "colaborador").length,
      activos: companyColaboradores.filter(c => c.status === "active").length,
      suspendidos: companyColaboradores.filter(c => c.status === "suspended").length,
      totalBalance: companyColaboradores.reduce(
        (sum, c) => sum + (this.payments.ledger.getAccount(c.ledgerAccountId)?.balance ?? 0),
        0
      ),
      totalSpendLimit: companyColaboradores.reduce((sum, c) => sum + c.spendLimit, 0),
    };
  }

  /**
   * Formatear monto seg\u00fan currency
   */
  private formatAmount(amount: number): string {
    const currency = this.payments.walletAccount.currency.toUpperCase();
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Presentar colaborador en formato View
   */
  private present(colaborador: Colaborador): ColaboradorView {
    const balance = this.payments.ledger.getAccount(colaborador.ledgerAccountId)?.balance ?? 0;
    const last4 = colaborador.cardId ? colaborador.cardId.slice(-4) : "0000";

    return {
      id: colaborador.id,
      companyId: colaborador.companyId,
      name: colaborador.name,
      email: colaborador.email,
      role: colaborador.role,
      roleLabel: colaborador.roleLabel,
      cardLast4: last4,
      balance,
      displayBalance: this.formatAmount(balance),
      spendLimit: colaborador.spendLimit,
      displaySpendLimit: this.formatAmount(colaborador.spendLimit),
      status: colaborador.status,
      categories: colaborador.categories,
      createdAt: colaborador.createdAt,
    };
  }
}
