import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { Global66Gateway, type Global66PaymentRequest } from "../src/gateways/global66Gateway.js";

const payment: Global66PaymentRequest = {
  externalReferenceId: "ext-001",
  transactionType: "REMITTANCE",
  originCurrency: "CLP",
  amount: 1000,
  way: "ORIGIN",
  description: "Pago a proveedor",
  paymentType: "WIRE_TRANSFER",
  purposeCode: [{ purposeCode: 64, amount: 1000 }],
  beneficiary: {
    operationType: "BANK_TRANSFER",
    destinationCurrency: "CLP",
    beneficiaryName: "Ana",
    beneficiaryLastName: "Díaz",
    typeBeneficiary: "INDIVIDUAL",
    email: "ana@example.com",
    countryCode: "CL",
    accountType: "SAVING",
    bankId: 1,
    accountNumber: "123456",
    documentNumber: "111111111",
    documentType: "RUT",
  },
};

function configuredGateway() {
  return new Global66Gateway(
    loadConfig({
      GLOBAL66_CLIENT_ID: "client-id",
      GLOBAL66_CLIENT_SECRET: "client-secret",
      GLOBAL66_API_URL: "https://api.example.test/business-api",
      DATABASE_PATH: ":memory:",
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Global66 B2B gateway", () => {
  it("authenticates and sends the official multipart payment request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-1", refreshToken: "refresh-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, status: "PROCESSING", transactionId: 99 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await configuredGateway().createPayment(payment);

    expect(response.transactionId).toBe(99);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/business-api/b2b/auth",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(new Headers(init.headers).get("Authorization"))).toBe("token-1");
    expect(String(new Headers(init.headers).get("Content-Type"))).toContain("multipart/form-data; boundary=");
    expect(String(init.body)).toContain('name="request"');
    expect(String(init.body)).toContain('"externalReferenceId":"ext-001"');
  });

  it("refreshes once after a 401 and keeps the authorization header without Bearer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-1", refreshToken: "refresh-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "token-2", refreshToken: "refresh-2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ totalElements: 0, totalPages: 0, page: 1, size: 50, movements: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await configuredGateway().listMovements(123, { page: 1 });

    const [, retryInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(new Headers(retryInit.headers).get("Authorization")).toBe("token-2");
  });

  it("does not send card data to Global66 in live mode", async () => {
    const result = await configuredGateway().createCardPayment({
      amount: 1000,
      currency: "CLP",
      card: {
        cardNumber: "4242424242424242",
        expiryMonth: 12,
        expiryYear: 2030,
        cvv: "123",
        cardholderName: "Ana Díaz",
      },
      description: "No enviar",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("no admite");
  });
});
