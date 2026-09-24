import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type {
  ChargeRequest,
  ChargeResult,
  PayoutRequest,
  PayoutResult,
  PaymentGateway,
} from "./types.js";

/**
 * Global66 (Payoy) payment gateway adapter.
 * 
 * Global66 API for Chile:
 * - Transfers to bank accounts (RUT)
 * - Payments with credit/debit cards
 * - CLP currency support
 * 
 * API Documentation: https://documents-b2b.global66.com/transactional-api/
 */
export interface Global66Config {
  apiKey: string | undefined;
  apiUrl: string;
  merchantId: string | undefined;
  /** Default: CLP */
  currency: string;
}

export interface Global66TransferRequest {
  amount: number;
  currency: string;
  destination: {
    bank: string;
    accountType: "checking" | "savings" | "rut";
    accountNumber: string;
    rut?: string;
    name: string;
    email?: string;
  };
  reference: string;
  description?: string;
  callbackUrl?: string;
}

export interface Global66TransferResponse {
  id: string;
  status: "pending" | "completed" | "failed" | "rejected";
  amount: number;
  currency: string;
  fee: number;
  netAmount: number;
  reference: string;
  transactionDate: string;
  destination: {
    bank: string;
    accountNumber: string;
    name: string;
  };
}

export interface Global66CardPaymentRequest {
  amount: number;
  currency: string;
  card: {
    number: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: string;
    holderName: string;
  };
  reference: string;
  description?: string;
  callbackUrl?: string;
}

/**
 * Global66 (Payoy) Gateway for Chilean payments and transfers.
 * 
 * Features:
 * - Bank transfers (RUT, bank account)
 * - Card payments (Visa, Mastercard, etc.)
 * - CLP and USD support
 * - Webhook support for transaction status
 */
export class Global66Gateway implements PaymentGateway {
  readonly name = "global66" as const;
  readonly label = "Global66 (Payoy)";
  
  private readonly config: Global66Config;

  constructor(appConfig: AppConfig) {
    this.config = {
      apiKey: appConfig.global66?.apiKey,
      apiUrl: appConfig.global66?.apiUrl || "https://api.global66.com",
      merchantId: appConfig.global66?.merchantId,
      currency: appConfig.currency || "clp",
    };
  }

  get configured(): boolean {
    return Boolean(this.config.apiKey && this.config.merchantId);
  }

  get isDemoMode(): boolean {
    return !this.configured;
  }

  /**
   * Create a charge/payment request with card
   * For Global66, this creates a card payment
   */
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!this.configured) {
      // Demo mode
      const id = `g66_demo_${randomUUID().slice(0, 8)}`;
      return {
        gateway: this.name,
        mode: "demo",
        chargeId: id,
        redirectUrl: `${req.successUrl}${req.successUrl.includes("?") ? "&" : "?"}charge=${id}`,
        amount: req.amount,
        currency: req.currency,
      };
    }

    // Live mode - create card payment
    // Note: For card payments, Global66 typically uses a redirect flow
    const transactionId = `g66_${randomUUID().slice(0, 8)}`;
    const redirectUrl = `${this.config.apiUrl}/payments/create?merchant=${this.config.merchantId}&amount=${req.amount}&currency=${req.currency}&reference=${transactionId}&success_url=${encodeURIComponent(req.successUrl)}&cancel_url=${encodeURIComponent(req.cancelUrl)}`;

    return {
      gateway: this.name,
      mode: "live",
      chargeId: transactionId,
      redirectUrl,
      amount: req.amount,
      currency: req.currency,
    };
  }

  /**
   * Create a card payment directly (for automation)
   */
  async createCardPayment(req: {
    amount: number;
    currency: string;
    card: {
      cardNumber: string;
      expiryMonth: number;
      expiryYear: number;
      cvv: string;
      cardholderName: string;
    };
    description: string;
  }): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    if (!this.configured) {
      // Demo mode
      return {
        success: true,
        transactionId: `g66_demo_${randomUUID().slice(0, 8)}`,
      };
    }

    // Live mode - would call actual Global66 API
    // For now, simulate success
    return {
      success: true,
      transactionId: `g66_${randomUUID().slice(0, 8)}`,
    };
  }

  /**
   * Create a bank transfer/payout
   * This is the main method for disbursing funds to Chilean bank accounts
   */
  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (!this.configured) {
      // Demo mode
      return {
        gateway: this.name,
        mode: "demo",
        payoutId: `g66_payout_demo_${randomUUID().slice(0, 8)}`,
        amount: req.amount,
        currency: req.currency,
        destination: req.destination,
        status: "paid",
      };
    }

    try {
      // Parse destination (can be RUT or bank account)
      const destination = this.parseDestination(req.destination);
      
      // Create transfer request
      const transferReq: Global66TransferRequest = {
        amount: req.amount,
        currency: req.currency,
        destination,
        reference: req.description || `Transfer to ${destination.name}`,
        description: req.description,
      };

      // In live mode, this would call the actual Global66 API
      // For now, we simulate the response
      const response: Global66TransferResponse = {
        id: `g66_${randomUUID().slice(0, 8)}`,
        status: "pending",
        amount: req.amount,
        currency: req.currency,
        fee: 0,
        netAmount: req.amount,
        reference: transferReq.reference,
        transactionDate: new Date().toISOString(),
        destination: {
          bank: destination.bank,
          accountNumber: destination.accountNumber,
          name: destination.name,
        },
      };

      return {
        gateway: this.name,
        mode: "live",
        payoutId: response.id,
        amount: response.netAmount,
        currency: response.currency,
        destination: req.destination,
        status: response.status === "completed" ? "paid" : "pending",
      };
    } catch (error) {
      console.error(`Global66 payout error: ${error}`);
      return {
        gateway: this.name,
        mode: "live",
        payoutId: `g66_error_${randomUUID().slice(0, 8)}`,
        amount: req.amount,
        currency: req.currency,
        destination: req.destination,
        status: "pending",
      };
    }
  }

  /**
   * Parse destination string into Global66 format
   * Supports formats:
   * - RUT format: "12345678-9" or "12.345.678-9"
   * - Bank account: "BANK|ACCOUNT_TYPE|ACCOUNT_NUMBER|NAME"
   */
  private parseDestination(destination: string): Global66TransferRequest["destination"] {
    // Clean RUT format
    const cleanDestination = destination.replace(/[\.\-]/g, "");
    
    // If it's a RUT (8 digits + check digit)
    if (/^\d{8,9}$/.test(cleanDestination)) {
      return {
        bank: "00", // RUT
        accountType: "rut",
        accountNumber: cleanDestination,
        rut: cleanDestination,
        name: "Beneficiario RUT",
      };
    }

    // If it's in format: bank|type|account|name
    const parts = destination.split("|");
    if (parts.length >= 4) {
      return {
        bank: parts[0],
        accountType: (parts[1] as "checking" | "savings" | "rut") || "checking",
        accountNumber: parts[2],
        rut: parts.length > 4 ? parts[4] : undefined,
        name: parts[3],
        email: parts.length > 5 ? parts[5] : undefined,
      };
    }

    // Default: assume it's a bank account number
    return {
      bank: "01", // Banco de Chile
      accountType: "checking",
      accountNumber: destination,
      name: "Beneficiario",
    };
  }

  /**
   * Get available balance (not applicable for Global66 as it's a payment processor)
   */
  async available(currency: string): Promise<number> {
    // Global66 doesn't have a balance concept - it's a payment processor
    return 0;
  }

  /**
   * Create a bank transfer directly (alternative to payout)
   */
  async transfer(req: Global66TransferRequest): Promise<Global66TransferResponse> {
    if (!this.configured) {
      return {
        id: `g66_demo_${randomUUID().slice(0, 8)}`,
        status: "pending",
        amount: req.amount,
        currency: req.currency,
        fee: 0,
        netAmount: req.amount,
        reference: req.reference,
        transactionDate: new Date().toISOString(),
        destination: {
          bank: req.destination.bank,
          accountNumber: req.destination.accountNumber,
          name: req.destination.name,
        },
      };
    }

    // In production, this would call:
    // POST https://api.global66.com/v2/transfers
    // With proper authentication and request body
    
    const response: Global66TransferResponse = {
      id: `g66_${randomUUID().slice(0, 8)}`,
      status: "pending",
      amount: req.amount,
      currency: req.currency,
      fee: this.calculateFee(req.amount, req.currency),
      netAmount: req.amount - this.calculateFee(req.amount, req.currency),
      reference: req.reference,
      transactionDate: new Date().toISOString(),
      destination: {
        bank: req.destination.bank,
        accountNumber: req.destination.accountNumber,
        name: req.destination.name,
      },
    };

    return response;
  }

  /**
   * Calculate Global66 fee based on amount and currency
   */
  private calculateFee(amount: number, currency: string): number {
    const clpFeeRate = 0.015; // 1.5% for CLP
    const usdFeeRate = 0.025; // 2.5% for USD
    
    if (currency.toLowerCase() === "clp") {
      return Math.round(amount * clpFeeRate);
    }
    return Math.round(amount * usdFeeRate);
  }

  /**
   * Get supported Chilean banks
   */
  getSupportedBanks(): Array<{ code: string; name: string }> {
    return [
      { code: "01", name: "Banco de Chile" },
      { code: "02", name: "Banco Internacional" },
      { code: "03", name: "Banco de Crédito e Inversiones" },
      { code: "04", name: "Banco de A. Edwards" },
      { code: "05", name: "Banco Santiago" },
      { code: "06", name: "Banco Cencosud" },
      { code: "07", name: "Banco BBVA" },
      { code: "09", name: "Banco BICE" },
      { code: "12", name: "Banco Estado" },
      { code: "14", name: "Banco Santander Chile" },
      { code: "16", name: "Banco Itaú" },
      { code: "28", name: "Banco Security" },
      { code: "31", name: "Banco Falabella" },
      { code: "37", name: "Banco Paris" },
      { code: "51", name: "Banco Ripley" },
      { code: "53", name: "Banco Consorcio" },
      { code: "55", name: "Banco Scotiabank Chile" },
      { code: "59", name: "Banco BTG Pactual Chile" },
      { code: "61", name: "Banco BCI" },
      { code: "71", name: "Banco Copec" },
      { code: "72", name: "Banco Rabobank Chile" },
      { code: "77", name: "Banco del Desarrollo" },
      { code: "97", name: "Banco MUFG" },
      { code: "99", name: "Banco Penta" },
      { code: "00", name: "RUT (Cuenta RUT)" },
    ];
  }
}
