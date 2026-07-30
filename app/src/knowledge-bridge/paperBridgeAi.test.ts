import { afterEach, describe, expect, it, vi } from "vitest";
import { demoVaultSnapshot } from "./model";
import { draftPaperBridge, draftPaperBridgeLocally } from "./paperBridgeAi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("source bridge drafting", () => {
  it("returns from a frontier concept through an L2 to an auditable learning anchor", () => {
    const draft = draftPaperBridgeLocally(
      "CRISPR-Cas9 editing improves a molecular phenotype in a cancer model",
      structuredClone(demoVaultSnapshot),
      1,
    );
    expect(draft.provider).toBe("local-fallback");
    expect(draft.status).toBe("draft");
    expect(draft.chain.map((step) => step.role)).toEqual(["frontier-concept", "bridge-mechanism", "learning-anchor"]);
    expect(draft.chain.at(-1)?.nodeId).toBe("l1-cell");
    expect(draft.bridgeModule).toMatchObject({
      steps: expect.arrayContaining([expect.objectContaining({ kind: "mechanism" })]),
    });
    expect(draft.bridgeModule?.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a remote bridge decomposed into inspectable module steps", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Decomposed draft",
                  summary: "A provisional path",
                  anchorReason: "The anchor is audited",
                  confidence: 0.8,
                  chain: [
                    { role: "frontier-concept", title: "New topic", explanation: "New source concept" },
                    { role: "bridge-mechanism", title: "Module summary", explanation: "Stepwise connection" },
                    { role: "learning-anchor", nodeId: "l1-cell", title: "Cell", explanation: "Audited anchor" },
                  ],
                  bridgeModule: {
                    title: "Expression-to-phenotype bridge",
                    steps: [
                      { id: "map", title: "Map variables", kind: "mapping", explanation: "Match variables." },
                      { id: "cause", title: "Trace mechanism", kind: "mechanism", explanation: "Trace the change." },
                    ],
                  },
                }),
              },
            },
          ],
        }),
      ),
    );

    const draft = await draftPaperBridge("A new source", structuredClone(demoVaultSnapshot), 100, {
      endpoint: "https://example.test/v1",
      model: "test-model",
      apiKey: "",
    });

    expect(draft.provider).toBe("remote-ai");
    expect(draft.bridgeModule?.steps.map((step) => step.kind)).toEqual(["mapping", "mechanism"]);
  });

  it("uses the configured service and preserves the audited anchor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "CRISPR 论文",
                  summary: "草拟学习链。",
                  anchorReason: "课程笔记已确认细胞与遗传。",
                  confidence: 0.78,
                  chain: [
                    {
                      role: "frontier-concept",
                      nodeId: "l3-crispr",
                      title: "CRISPR-Cas9",
                      explanation: "分子编辑工具。",
                    },
                    {
                      role: "bridge-mechanism",
                      nodeId: "l2-flow",
                      title: "信息流与调控",
                      explanation: "从 DNA 改变连接到表达。",
                    },
                    {
                      role: "learning-anchor",
                      nodeId: "l1-cell",
                      title: "细胞与遗传",
                      explanation: "回到高中遗传信息流。",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    );
    globalThis.fetch = fetchMock;

    const draft = await draftPaperBridge("CRISPR 摘要", structuredClone(demoVaultSnapshot), 100, {
      endpoint: "https://example.test/v1",
      model: "test-model",
      apiKey: "test-key",
    });

    expect(draft.provider).toBe("remote-ai");
    expect(draft.chain.map((step) => step.role)).toEqual(["frontier-concept", "bridge-mechanism", "learning-anchor"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
    );
  });

  it("rejects a known node id when the model assigns it the wrong learning role", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Role validation",
                  summary: "Draft only",
                  anchorReason: "The anchor is audited",
                  confidence: 0.7,
                  chain: [
                    { role: "frontier-concept", title: "New topic", explanation: "New" },
                    {
                      role: "bridge-mechanism",
                      nodeId: "l1-cell",
                      title: "Incorrectly reused anchor",
                      explanation: "Wrong role",
                    },
                    {
                      role: "learning-anchor",
                      nodeId: "l1-cell",
                      title: "Cell",
                      explanation: "Audited",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    );
    globalThis.fetch = fetchMock;

    const draft = await draftPaperBridge("Role test", structuredClone(demoVaultSnapshot), 100, {
      endpoint: "https://example.test/v1",
      model: "test-model",
      apiKey: "",
    });

    expect(draft.provider).toBe("remote-ai");
    expect(draft.chain.find((step) => step.role === "bridge-mechanism")?.nodeId).toBeUndefined();
    expect(draft.chain.find((step) => step.role === "learning-anchor")?.nodeId).toBe("l1-cell");
  });

  it("keeps valid MCP calls as approval requests instead of claiming they ran", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "A frontier paper",
                  summary: "A provisional learning chain",
                  anchorReason: "The cell anchor is user-confirmed",
                  confidence: 0.7,
                  chain: [
                    { role: "frontier-concept", title: "New mechanism", explanation: "Needs source context" },
                    { role: "bridge-mechanism", title: "Information flow", explanation: "Connects the levels" },
                    {
                      role: "learning-anchor",
                      nodeId: "l1-cell",
                      title: "Cell and heredity",
                      explanation: "Audited anchor",
                    },
                  ],
                  mcpRequests: [
                    {
                      server: "papers",
                      name: "lookup",
                      arguments: { doi: "10.0000/example" },
                      reason: "Check the paper metadata",
                    },
                    { server: "unknown", name: "unsafe", arguments: {}, reason: "Not in the catalog" },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    );

    const draft = await draftPaperBridge(
      "A frontier paper",
      structuredClone(demoVaultSnapshot),
      100,
      { endpoint: "https://example.test/v1", model: "test-model", apiKey: "" },
      {
        skills: [],
        mcpTools: [
          {
            server: "papers",
            name: "lookup",
            modelName: "mcp__papers__lookup",
            description: "Look up a paper",
            inputSchema: { type: "object", properties: { doi: { type: "string" } } },
          },
        ],
      },
    );

    expect(draft.plannedMcpRequests).toHaveLength(1);
    expect(draft.plannedMcpRequests?.[0]).toMatchObject({
      server: "papers",
      tool: "lookup",
      modelName: "mcp__papers__lookup",
      status: "pending-approval",
    });
  });
});
