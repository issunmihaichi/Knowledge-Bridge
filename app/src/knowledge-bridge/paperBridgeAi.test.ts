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
    expect(draft.chain.map((step) => step.role)).toEqual([
      "frontier-concept",
      "bridge-mechanism",
      "learning-anchor",
    ]);
    expect(draft.chain.at(-1)?.nodeId).toBe("l1-cell");
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
    expect(draft.chain.map((step) => step.role)).toEqual([
      "frontier-concept",
      "bridge-mechanism",
      "learning-anchor",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
    );
  });
});
