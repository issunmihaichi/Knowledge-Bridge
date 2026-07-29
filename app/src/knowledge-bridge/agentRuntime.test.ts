import { describe, expect, it } from "vitest";
import { runKnowledgeBridgeAgent } from "./agentRuntime";
import { emptyVaultSnapshot } from "./model";

describe("Knowledge Bridge agent runtime", () => {
  it("records the LLM, MCP, and Skill backend components on a local run", async () => {
    const draft = await runKnowledgeBridgeAgent({
      input: "A new concept to connect to prior knowledge",
      snapshot: structuredClone(emptyVaultSnapshot),
      connection: { endpoint: "", model: "test-model", apiKey: "" },
      now: 100,
    });

    expect(draft.provider).toBe("local-fallback");
    expect(draft.agentTrace?.llm.provider).toBe("local-fallback");
    expect(draft.agentTrace?.mcp.invokedTools).toEqual([]);
    expect(draft.agentTrace?.mcp.requests).toEqual([]);
    expect(draft.agentTrace?.skills.activated).toEqual([]);
  });
});
