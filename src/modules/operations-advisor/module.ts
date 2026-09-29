import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { AppConfig } from "../../config.js";
import type { SessionUser } from "../../auth/module.js";

export interface AdvisorQuery {
  id: string;
  category: "accounts" | "payments" | "policies" | "exits" | "rules";
  question: string;
  context?: Record<string, unknown>;
  createdAt: string;
  requestedBy: string;
}

export interface AdvisorProposal {
  id: string;
  queryId: string;
  category: string;
  title: string;
  analysis: string;
  recommendation: string;
  requiredApprovals: ("operacion" | "administrador_empresa")[];
  metadata: Record<string, unknown>;
  createdAt: string;
  status: "draft" | "reviewed" | "approved" | "rejected" | "executed";
  reviewedBy?: string;
  appliedBy?: string;
}

const MODULE = "operations-advisor";

/**
 * Operations Advisor: a read-only Bedrock agent that analyzes platform state
 * and generates non-binding proposals for human approval.
 *
 * - Query categories: accounts, payments, policies, exits, rules
 * - Data access: role-filtered, masked PII (no full PAN, passwords, seeds)
 * - Output: proposals only (no execution)
 * - Approval: explicit human review required before any action
 */
export class OperationsAdvisorModule {
  readonly id = MODULE;
  readonly label = "Asesor de Operación";
  private readonly queries = new Map<string, AdvisorQuery>();
  private readonly proposals = new Map<string, AdvisorProposal>();
  private bedrockClient: BedrockRuntimeClient | null = null;

  constructor(private readonly config: AppConfig) {
    if (this.canUseBedrock()) {
      this.bedrockClient = new BedrockRuntimeClient({
        region: process.env.AWS_REGION ?? "us-east-1",
        maxAttempts: 3,
        retryMode: "adaptive",
      });
    }
  }

  private canUseBedrock(): boolean {
    return Boolean(
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.env.BEDROCK_REGION,
    );
  }

  async query(
    user: SessionUser,
    input: {
      category: "accounts" | "payments" | "policies" | "exits" | "rules";
      question: string;
      context?: Record<string, unknown>;
    },
  ): Promise<{ query: AdvisorQuery; proposal?: AdvisorProposal }> {
    if (user.role !== "operacion") {
      throw new Error("Solo operación puede hacer consultas al asesor");
    }

    const queryId = `aq_${Date.now().toString(36)}`;
    const query: AdvisorQuery = {
      id: queryId,
      category: input.category,
      question: input.question.trim(),
      context: input.context,
      createdAt: new Date().toISOString(),
      requestedBy: user.id,
    };
    this.queries.set(queryId, query);

    let proposal: AdvisorProposal | undefined;
    if (this.bedrockClient) {
      try {
        proposal = await this.generateProposal(user, query);
      } catch (error) {
        console.error(`[advisor] Bedrock proposal failed for query ${queryId}:`, error);
      }
    }

    return { query, proposal };
  }

  private async generateProposal(
    user: SessionUser,
    query: AdvisorQuery,
  ): Promise<AdvisorProposal> {
    if (!this.bedrockClient) {
      throw new Error("Bedrock client not available");
    }

    const prompt = this.buildContextualPrompt(query, user);

    const response = await this.bedrockClient.send(
      new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6",
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
        system: [
          {
            text: `You are an operations advisor for instripe, a Chilean fintech BaaS platform for insurance and payments.
Your role is ANALYSIS ONLY — you generate non-binding proposals and observations.
You NEVER execute actions, modify data, or approve operations.

Guidelines:
- Always respond in Spanish.
- Provide factual analysis grounded in the provided context.
- When you propose an action, clearly mark it as a proposal for human review.
- Never suggest changes that bypass authorization or approval workflows.
- Always remind the user that any action requires explicit human approval.
- Mask or omit sensitive data like full card numbers, passwords, or authentication tokens.
- If data is insufficient, ask for clarification rather than speculating.`,
          },
        ],
      }),
    );

    const textContent = response.output?.message?.content?.find(
      (c): c is { text: string } => "text" in c,
    );
    const analysisText = textContent?.text ?? "";

    const proposal: AdvisorProposal = {
      id: `ap_${Date.now().toString(36)}`,
      queryId: query.id,
      category: query.category,
      title: this.extractTitle(query.question),
      analysis: analysisText,
      recommendation: this.extractRecommendation(analysisText),
      requiredApprovals: ["operacion", "administrador_empresa"],
      metadata: {
        model: process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6",
        tokensUsed: response.usage?.outputTokens ?? 0,
      },
      createdAt: new Date().toISOString(),
      status: "draft",
    };

    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  private buildContextualPrompt(query: AdvisorQuery, user: SessionUser): string {
    const contextLines: string[] = [
      `Categoría: ${query.category}`,
      `Pregunta de ${user.name} (${user.email}):`,
      `"${query.question}"`,
      "",
    ];

    if (query.context) {
      contextLines.push("Contexto proporcionado:");
      for (const [key, value] of Object.entries(query.context)) {
        contextLines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
      contextLines.push("");
    }

    contextLines.push(
      "Analiza la situación y proporciona recomendaciones concretas.",
      "Recuerda: tu análisis es una propuesta y requiere aprobación humana antes de cualquier acción.",
    );

    return contextLines.join("\n");
  }

  private extractTitle(question: string): string {
    return question.split("\n")[0].slice(0, 100);
  }

  private extractRecommendation(analysis: string): string {
    const lines = analysis.split("\n");
    const recIndex = lines.findIndex((l) =>
      l.toLowerCase().includes("recomendación") ||
      l.toLowerCase().includes("propuesta") ||
      l.toLowerCase().includes("next step"),
    );
    if (recIndex >= 0) {
      return lines.slice(recIndex).join("\n").slice(0, 500);
    }
    return analysis.slice(0, 500);
  }

  getQuery(id: string): AdvisorQuery | undefined {
    return this.queries.get(id);
  }

  listQueries(limit = 50): AdvisorQuery[] {
    return Array.from(this.queries.values()).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ).slice(0, limit);
  }

  getProposal(id: string): AdvisorProposal | undefined {
    return this.proposals.get(id);
  }

  listProposals(status?: AdvisorProposal["status"]): AdvisorProposal[] {
    const all = Array.from(this.proposals.values()).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return status ? all.filter((p) => p.status === status) : all;
  }

  reviewProposal(
    proposalId: string,
    reviewer: SessionUser,
    approved: boolean,
    notes?: string,
  ): AdvisorProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error("Proposal not found");
    }
    if (proposal.status !== "draft") {
      throw new Error("Only draft proposals can be reviewed");
    }
    if (reviewer.role !== "operacion" && reviewer.role !== "administrador_empresa") {
      throw new Error("Only operacion or administrador_empresa can review proposals");
    }

    proposal.status = approved ? "approved" : "rejected";
    proposal.reviewedBy = reviewer.id;
    if (notes) {
      proposal.metadata = { ...proposal.metadata, reviewNotes: notes };
    }

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  destroy(): void {
    if (this.bedrockClient) {
      this.bedrockClient.destroy();
    }
  }
}
