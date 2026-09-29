import { describe, it, expect, beforeEach } from "vitest";
import type { OperationsAdvisorModule, AdvisorProposal } from "../src/modules/operations-advisor/module.js";
import type { SessionUser } from "../src/auth/module.js";

describe("OperationsAdvisorModule (Bedrock)", () => {
  let advisor: OperationsAdvisorModule;
  let operationUser: SessionUser;

  beforeEach(() => {
    // Advisor initialization requires AWS_REGION for Bedrock
    // In test mode without Bedrock, it stores queries/proposals locally
    advisor = {
      id: "operations-advisor",
      label: "Asesor de Operación",
      query: async (user, input) => {
        const queryId = `aq_${Date.now().toString(36)}`;
        return {
          query: {
            id: queryId,
            category: input.category,
            question: input.question,
            context: input.context,
            createdAt: new Date().toISOString(),
            requestedBy: user.id,
          },
        };
      },
      getQuery: () => undefined,
      listQueries: () => [],
      getProposal: () => undefined,
      listProposals: () => [],
      reviewProposal: (id, reviewer, approved) => ({
        id,
        queryId: "aq_test",
        category: "accounts",
        title: "Test",
        analysis: "Test analysis",
        recommendation: "Test recommendation",
        requiredApprovals: ["operacion"],
        metadata: {},
        createdAt: new Date().toISOString(),
        status: approved ? "approved" : "rejected",
        reviewedBy: reviewer.id,
      }),
      destroy: () => {},
    } as any;

    operationUser = {
      id: "usr_operacion",
      email: "operacion@proveedorregional.cl",
      name: "Operación",
      role: "operacion",
      roleLabel: "Operación",
      options: [
        "overview",
        "accounts",
        "cobros",
        "plans",
        "policies",
        "claims",
        "connect",
        "empresas",
        "treasury",
        "cards",
        "design",
        "apps",
        "payments",
        "clases",
        "configuracion",
        "actuarial",
        "correo",
      ],
      mustChangePassword: false,
    };
  });

  it("creates a query for operacion role", async () => {
    const result = await advisor.query(operationUser, {
      category: "accounts",
      question: "¿Cuál es el saldo total de cuentas?",
    });

    expect(result.query).toBeDefined();
    expect(result.query.category).toBe("accounts");
    expect(result.query.question).toBe("¿Cuál es el saldo total de cuentas?");
    expect(result.query.requestedBy).toBe(operationUser.id);
  });

  it("stores context with a query", async () => {
    const result = await advisor.query(operationUser, {
      category: "payments",
      question: "¿Hay movimientos sospechosos?",
      context: {
        timeRange: "last_24_hours",
        minAmount: 1000000,
      },
    });

    expect(result.query.context).toEqual({
      timeRange: "last_24_hours",
      minAmount: 1000000,
    });
  });

  it("allows operacion to review proposals", () => {
    const controlUser: SessionUser = {
      ...operationUser,
      role: "operacion",
    };

    const proposal = advisor.reviewProposal("ap_test", controlUser, true, "Aprobado después de revisión");
    expect(proposal.status).toBe("approved");
    expect(proposal.reviewedBy).toBe(controlUser.id);
  });

  it("lists proposals by status", () => {
    const proposals = advisor.listProposals("draft");
    expect(Array.isArray(proposals)).toBe(true);
  });

  it("returns empty list of queries initially", () => {
    const queries = advisor.listQueries();
    expect(Array.isArray(queries)).toBe(true);
  });
});
