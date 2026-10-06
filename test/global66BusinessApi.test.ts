import { describe, expect, it } from "vitest";
import {
  decryptGlobal66Secret,
  encryptGlobal66Secret,
  Global66BusinessApi,
  type Global66Credentials,
} from "../src/gateways/global66BusinessApi.js";

const credentials: Global66Credentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  accountId: "account-123",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Global66BusinessApi", () => {
  it("encrypts secrets at rest and rejects a different master key", () => {
    const encrypted = encryptGlobal66Secret("top-secret", "test-master-key");
    expect(encrypted).not.toContain("top-secret");
    expect(decryptGlobal66Secret(encrypted, "test-master-key")).toBe("top-secret");
    expect(() => decryptGlobal66Secret(encrypted, "wrong-key")).toThrow("No se pudieron descifrar");
  });

  it("paginates wallet movements and derives balance only from a real movement", async () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") ?? undefined });
      if (url.endsWith("/b2b/auth")) return jsonResponse({ token: "access", refreshToken: "refresh" });
      const page = new URL(url).searchParams.get("page");
      return page === "1"
        ? jsonResponse({
            totalPages: 2,
            movements: [{
              id: 1,
              amount: 50,
              status: "PAID",
              transactionDate: "2026-01-01T10:00:00",
              accountBalance: 50,
              amountCurrency: "CLP",
            }],
          })
        : jsonResponse({
            totalPages: 2,
            movements: [{
              id: 2,
              amount: 20,
              status: "PAID",
              transactionDate: "2026-01-02T10:00:00",
              accountBalance: 70,
              amountCurrency: "CLP",
            }],
          });
    };

    const snapshot = await new Global66BusinessApi(undefined, fetcher).walletSnapshot(credentials);
    expect(snapshot.balance).toBe(70);
    expect(snapshot.currency).toBe("CLP");
    expect(snapshot.movements.map((movement) => movement.id)).toEqual(["2", "1"]);
    expect(requests.slice(1).map((request) => new URL(request.url).searchParams.get("page"))).toEqual(["1", "2"]);
    expect(requests.slice(1).every((request) => request.authorization === "access")).toBe(true);
  });

  it("does not invent a balance when the account has no movements", async () => {
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith("/b2b/auth")
        ? jsonResponse({ token: "access", refreshToken: "refresh" })
        : jsonResponse({ totalPages: 0, movements: [] });

    const snapshot = await new Global66BusinessApi(undefined, fetcher).walletSnapshot(credentials);
    expect(snapshot.balance).toBeNull();
    expect(snapshot.balanceAsOf).toBeNull();
    expect(snapshot.currency).toBeNull();
  });

  it("does not reuse an older balance when the newest movement has no balance", async () => {
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith("/b2b/auth")) return jsonResponse({ token: "access", refreshToken: "refresh" });
      return jsonResponse({
        totalPages: 1,
        movements: [
          {
            id: 1,
            amount: 50,
            status: "PAID",
            transactionDate: "2026-01-01T10:00:00",
            accountBalance: 50,
            amountCurrency: "CLP",
          },
          {
            id: 2,
            amount: 20,
            status: "PROCESSING",
            transactionDate: "2026-01-02T10:00:00",
            amountCurrency: "CLP",
          },
        ],
      });
    };

    const snapshot = await new Global66BusinessApi(undefined, fetcher).walletSnapshot(credentials);
    expect(snapshot.balance).toBeNull();
    expect(snapshot.currency).toBeNull();
    expect(snapshot.balanceAsOf).toBe("2026-01-02T10:00:00");
  });

  it("sends the transaction as the documented multipart request and preserves validation failures", async () => {
    let sentForm: FormData | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/b2b/auth")) return jsonResponse({ token: "access", refreshToken: "refresh" });
      expect(new Headers(init?.headers).get("Authorization")).toBe("access");
      sentForm = init?.body as FormData;
      return jsonResponse({ valid: false, status: "FAILED", violations: ["Monto fuera de rango"] });
    };
    const api = new Global66BusinessApi(undefined, fetcher);
    const result = await api.createBankTransfer(credentials, {
      amount: 1000,
      originCurrency: "CLP",
      destinationCurrency: "CLP",
      purposeCode: [1],
      beneficiaryName: "Ana",
      beneficiaryLastName: "Díaz",
      countryCode: "CL",
      accountType: "CA",
      accountNumber: "123456",
      documentNumber: "12345678",
      documentType: "DNI",
      externalReferenceId: "ref-123",
    });

    expect(sentForm).toBeInstanceOf(FormData);
    const request = JSON.parse(String(sentForm?.get("request")));
    expect(request.externalReferenceId).toBe("ref-123");
    expect(request.purposeCode).toEqual([{ purposeCode: 1 }]);
    expect(request.beneficiary.accountType).toBe("CA");
    expect(result.valid).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.violations).toEqual(["Monto fuera de rango"]);
  });

  it("refreshes once after an expired access token", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/b2b/auth")) return jsonResponse({ token: "expired", refreshToken: "refresh" });
      if (url.endsWith("/b2b/auth/refresh")) return jsonResponse({ token: "fresh", refreshToken: "new-refresh" });
      if (new Headers(init?.headers).get("Authorization") === "expired") return jsonResponse({}, 401);
      return jsonResponse({ totalPages: 0, movements: [] });
    };

    await new Global66BusinessApi(undefined, fetcher).walletSnapshot(credentials);
    expect(calls.filter((url) => url.endsWith("/b2b/auth/refresh"))).toHaveLength(1);
  });
});
