import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { PilotPlanner, PilotPlannerError } from "../src/modules/pilot/planner.js";

const pilot = {
  name: "Piloto inicial",
  objective: "Validar onboarding de empresas",
  companyCount: 1,
  workerCount: 5,
  durationWeeks: 4,
  constraints: "Sin emitir tarjetas durante la prueba",
};

describe("Databricks pilot planner", () => {
  it("gets an OAuth token and requests a bounded plan without persisting the response", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-lived-token", expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "Plan y checklist del piloto." })));
    const config = loadConfig({
      DATABRICKS_HOST: "https://dbc-example.cloud.databricks.com",
      DATABRICKS_CLIENT_ID: "service-client",
      DATABRICKS_CLIENT_SECRET: "service-secret",
    });
    const planner = new PilotPlanner(config, fetcher);

    await expect(planner.generate(pilot)).resolves.toBe("Plan y checklist del piloto.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toEqual(new URL("https://dbc-example.cloud.databricks.com/oidc/v1/token"));
    expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain("scope=model-serving-inference");
    expect(fetcher.mock.calls[1][0]).toEqual(
      new URL("https://dbc-example.cloud.databricks.com/serving-endpoints/responses"),
    );
    const requestBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(requestBody.model).toBe("databricks-gpt-6-luna");
    expect(requestBody.max_output_tokens).toBe(1800);
    expect(requestBody.store).toBeUndefined();
    expect(requestBody.input[1].content).toContain("Validar onboarding de empresas");
  });

  it("rejects non-workspace hosts before sending credentials", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const config = loadConfig({
      DATABRICKS_HOST: "https://attacker.example",
      DATABRICKS_CLIENT_ID: "service-client",
      DATABRICKS_CLIENT_SECRET: "service-secret",
    });
    const planner = new PilotPlanner(config, fetcher);

    await expect(planner.generate(pilot)).rejects.toMatchObject({
      name: "PilotPlannerError",
      status: 503,
    } satisfies Partial<PilotPlannerError>);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
