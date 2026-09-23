import fs from "node:fs";
import { PlatformError } from "../../errors.js";

export interface StripeAppManifest {
  id: string;
  version: string;
  name: string;
  distribution_type: "private";
  sandbox_install_compatible: true;
  permissions: { permission: string; purpose: string }[];
  ui_extension: { views: [] };
}

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
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as StripeAppManifest;
        if (parsed && typeof parsed.name === "string" && typeof parsed.id === "string") {
          this.manifest = parsed;
        }
      } catch {
        // Keep the default when the file is not a manifest yet.
      }
    }
  }

  current(): StripeAppManifest {
    return structuredClone(this.manifest);
  }

  create(input: { name: string }): StripeAppManifest {
    const name = input.name.trim();
    if (!name) throw new PlatformError("name es requerido", 400);
    if (/\b(stripe|free|paid)\b/i.test(name)) {
      throw new PlatformError("El nombre de la app no puede incluir Stripe, free ni paid", 400);
    }
    this.manifest = defaultManifest(name);
    fs.mkdirSync(this.manifestPath.replace(/[^/]+$/, "") || ".", { recursive: true });
    fs.writeFileSync(this.manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`);
    return this.current();
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
      { permission: "balance_read", purpose: "Leer el saldo que liquida el núcleo de pagos." },
    ],
    ui_extension: { views: [] },
  };
}
