import fs from "node:fs";
import { PlatformError } from "../../errors.js";

export type DistributionType = "private" | "public";

export interface StripeAppPermission {
  permission: string;
  purpose: string;
}

export interface StripeAppUIExtension {
  views: Array<{
    type: "customer_detail" | "customer_list" | "product_detail" | "product_list" | "price_detail" | "price_list" | "invoice_detail" | "invoice_list" | "payment_intent_detail" | "payment_intent_list" | "checkout_session_detail" | "checkout_session_list";
    url: string;
  }>;
}

export interface StripeAppManifest {
  id: string;
  version: string;
  name: string;
  icon?: string;
  description?: string;
  distribution_type: DistributionType;
  sandbox_install_compatible: boolean;
  permissions: StripeAppPermission[];
  ui_extension?: StripeAppUIExtension;
  doc_url?: string;
  support_email?: string;
}

export interface CreateAppInput {
  name: string;
  icon?: string;
  description?: string;
  distribution_type?: DistributionType;
  permissions?: StripeAppPermission[];
}

export interface UpdateAppInput {
  name?: string;
  version?: string;
  icon?: string;
  description?: string;
  distribution_type?: DistributionType;
  permissions?: StripeAppPermission[];
  ui_extension?: StripeAppUIExtension;
  doc_url?: string;
  support_email?: string;
}

/**
 * Known Stripe permissions for reference
 */
export const STRIPE_PERMISSIONS = {
  customer_read: "Read customer data",
  customer_write: "Write customer data",
  balance_read: "Read balance and transactions",
  balance_write: "Write balance (transfers, etc.)",
  payment_intent_read: "Read payment intents",
  payment_intent_write: "Write payment intents",
  charge_read: "Read charges",
  charge_write: "Write charges",
  invoice_read: "Read invoices",
  invoice_write: "Write invoices",
  product_read: "Read products",
  product_write: "Write products",
  price_read: "Read prices",
  price_write: "Write prices",
  checkout_session_read: "Read checkout sessions",
  checkout_session_write: "Write checkout sessions",
  transfer_read: "Read transfers",
  transfer_write: "Write transfers",
  refund_read: "Read refunds",
  refund_write: "Write refunds",
  dispute_read: "Read disputes",
  dispute_write: "Write disputes",
  connected_account_read: "Read connected accounts",
  connected_account_write: "Write connected accounts",
  payout_read: "Read payouts",
  payout_write: "Write payouts",
  issuing_card_read: "Read issued cards",
  issuing_card_write: "Write issued cards",
  issuing_cardholder_read: "Read cardholders",
  issuing_cardholder_write: "Write cardholders",
  treasury_account_read: "Read treasury accounts",
  treasury_account_write: "Write treasury accounts",
  treasury_transaction_read: "Read treasury transactions",
  treasury_transaction_write: "Write treasury transactions",
} as const;

/**
 * Stripe App manifest. Creating the app writes stripe-app.json.
 * Uploading it to the Dashboard is `stripe apps upload`.
 */
export class AppsModule {
  readonly id = "apps";
  readonly label = "App";
  private manifest: StripeAppManifest;

  constructor(private readonly manifestPath: string) {
    this.manifest = defaultManifest("Instripe");
    this.loadManifest();
  }

  private loadManifest(): void {
    if (fs.existsSync(this.manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.manifestPath, "utf8")) as StripeAppManifest;
        if (parsed && typeof parsed.name === "string" && typeof parsed.id === "string") {
          this.manifest = parsed;
        }
      } catch {
        // Keep the default when the file is not a manifest yet.
      }
    }
  }

  private saveManifest(): void {
    fs.mkdirSync(this.manifestPath.replace(/[^/]+$/, "") || ".", { recursive: true });
    fs.writeFileSync(this.manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`);
  }

  current(): StripeAppManifest {
    return structuredClone(this.manifest);
  }

  list(): StripeAppManifest[] {
    return [this.current()];
  }

  create(input: CreateAppInput): StripeAppManifest {
    const name = input.name.trim();
    if (!name) throw new PlatformError("name es requerido", 400);
    if (/\b(stripe|free|paid)\b/i.test(name)) {
      throw new PlatformError("El nombre de la app no puede incluir Stripe, free ni paid", 400);
    }

    const distribution_type = input.distribution_type || "private";
    const permissions = input.permissions || this.getDefaultPermissions();

    this.manifest = {
      id: this.generateId(name),
      version: "0.1.0",
      name,
      icon: input.icon,
      description: input.description,
      distribution_type,
      sandbox_install_compatible: true,
      permissions,
      ui_extension: { views: [] },
    };

    this.saveManifest();
    return this.current();
  }

  update(input: UpdateAppInput): StripeAppManifest {
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new PlatformError("name es requerido", 400);
      if (/\b(stripe|free|paid)\b/i.test(name)) {
        throw new PlatformError("El nombre de la app no puede incluir Stripe, free ni paid", 400);
      }
      this.manifest.name = name;
      this.manifest.id = this.generateId(name);
    }

    if (input.version !== undefined) this.manifest.version = input.version;
    if (input.icon !== undefined) this.manifest.icon = input.icon;
    if (input.description !== undefined) this.manifest.description = input.description;
    if (input.distribution_type !== undefined) this.manifest.distribution_type = input.distribution_type;
    if (input.permissions !== undefined) this.manifest.permissions = input.permissions;
    if (input.ui_extension !== undefined) this.manifest.ui_extension = input.ui_extension;
    if (input.doc_url !== undefined) this.manifest.doc_url = input.doc_url;
    if (input.support_email !== undefined) this.manifest.support_email = input.support_email;

    this.saveManifest();
    return this.current();
  }

  addPermission(permission: string, purpose: string): StripeAppManifest {
    const existingIndex = this.manifest.permissions.findIndex(p => p.permission === permission);
    if (existingIndex >= 0) {
      this.manifest.permissions[existingIndex].purpose = purpose;
    } else {
      this.manifest.permissions.push({ permission, purpose });
    }
    this.saveManifest();
    return this.current();
  }

  removePermission(permission: string): StripeAppManifest {
    this.manifest.permissions = this.manifest.permissions.filter(p => p.permission !== permission);
    this.saveManifest();
    return this.current();
  }

  addUIExtensionView(view: { type: string; url: string }): StripeAppManifest {
    if (!this.manifest.ui_extension) {
      this.manifest.ui_extension = { views: [] };
    }
    this.manifest.ui_extension.views.push(view as any);
    this.saveManifest();
    return this.current();
  }

  setUIExtension(views: Array<{ type: string; url: string }>): StripeAppManifest {
    this.manifest.ui_extension = { views: views as any };
    this.saveManifest();
    return this.current();
  }

  delete(): void {
    if (fs.existsSync(this.manifestPath)) {
      fs.unlinkSync(this.manifestPath);
    }
    this.manifest = defaultManifest("Instripe");
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!this.manifest.name || this.manifest.name.trim().length === 0) {
      errors.push("El nombre de la app es requerido");
    }
    
    if (!this.manifest.id || !this.manifest.id.startsWith("com.")) {
      errors.push("El ID de la app debe empezar con com.");
    }
    
    if (!this.manifest.version || !/^\d+\.\d+\.\d+$/.test(this.manifest.version)) {
      errors.push("La version debe ser en formato semver (ej: 0.1.0)");
    }
    
    if (!this.manifest.permissions || this.manifest.permissions.length === 0) {
      errors.push("La app debe tener al menos un permiso");
    }
    
    if (this.manifest.ui_extension && this.manifest.ui_extension.views) {
      for (const view of this.manifest.ui_extension.views) {
        if (!view.type || !view.url) {
          errors.push("Todas las vistas de UI extension deben tener type y url");
          break;
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

  getDefaultPermissions(): StripeAppPermission[] {
    return [
      { permission: "customer_read", purpose: "Leer clientes para cuentas, cobros y tarjetas." },
      { permission: "balance_read", purpose: "Leer el saldo que liquida el nucleo de pagos." },
    ];
  }

  getStripePermissions(): StripeAppPermission[] {
    return [
      ...this.getDefaultPermissions(),
      { permission: "payment_intent_read", purpose: "Leer intenciones de pago" },
      { permission: "payment_intent_write", purpose: "Crear intenciones de pago" },
      { permission: "charge_read", purpose: "Leer cobros" },
      { permission: "charge_write", purpose: "Crear cobros" },
      { permission: "customer_write", purpose: "Crear y actualizar clientes" },
      { permission: "transfer_read", purpose: "Leer transferencias" },
      { permission: "transfer_write", purpose: "Crear transferencias" },
    ];
  }

  getFullPermissions(): StripeAppPermission[] {
    const allPermissions: StripeAppPermission[] = [];
    for (const [permission, purpose] of Object.entries(STRIPE_PERMISSIONS)) {
      allPermissions.push({ permission, purpose });
    }
    return allPermissions;
  }

  private generateId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || "instripe";
    return `com.houmeecl.${slug}`;
  }

  getUploadCommand(): string {
    return "stripe apps upload";
  }

  getInstallCommand(appId: string = this.manifest.id): string {
    return `stripe apps install ${appId}`;
  }
}

function defaultManifest(name: string): StripeAppManifest {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || "instripe";
  return {
    id: `com.houmeecl.${slug}`,
    version: "0.1.0",
    name,
    distribution_type: "private",
    sandbox_install_compatible: true,
    permissions: [
      { permission: "customer_read", purpose: "Leer clientes para cuentas, cobros y tarjetas." },
      { permission: "balance_read", purpose: "Leer el saldo que liquida el nucleo de pagos." },
    ],
    ui_extension: { views: [] },
  };
}
