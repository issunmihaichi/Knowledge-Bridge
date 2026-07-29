import { afterEach, describe, expect, it, vi } from "vitest";
import { suggestBridge } from "./bridgeAi";
import { demoVaultSnapshot, type KnowledgeNode } from "./model";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function snapshotWithoutBridge(): KnowledgeNode[] {
  return [
    {
      id: "anchor",
      title: "Cell signaling",
      role: "L1",
      status: "formal",
      content: "Signals change cell behavior.",
      x: 0,
      y: 0,
      sourceKind: "user-confirmed",
      anchorLedger: [
        {
          source: "user-confirmed",
          rationale: "Confirmed in prior study",
          evidence: ["course notes"],
          recordedAt: 1,
        },
      ],
    },
    {
      id: "frontier",
      title: "Spatial transcriptomics",
      role: "L3",
      status: "pending",
      content: "Maps gene expression to tissue position.",
      x: 300,
      y: 0,
    },
  ];
}

describe("bridge suggestions", () => {
  it("accepts a new L2 candidate when no reusable mechanism exists", async () => {
    const nodes = snapshotWithoutBridge();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  bridgeId: null,
                  bridgeTitle: "Spatially constrained regulation",
                  bridgeDefinition: "Local tissue context constrains gene regulation.",
                  bridgeScope: "Spatial omics in structured tissues",
                  bridgeBoundary: "Does not establish causality without perturbation evidence.",
                  reason: "Connects tissue location to regulated expression.",
                  confidence: 0.78,
                  alternatives: [],
                  anchorId: "anchor",
                  anchorReason: "Extends known cell signaling into spatial context.",
                  anchorEvidence: ["course notes"],
                  anchorAlternatives: [],
                }),
              },
            },
          ],
        }),
      ),
    );

    const suggestion = await suggestBridge(nodes[1], nodes, {
      endpoint: "https://example.test/v1",
      model: "test-model",
      apiKey: "test-key",
    });

    expect(suggestion).toMatchObject({
      bridgeTitle: "Spatially constrained regulation",
      isNewBridge: true,
      provider: "remote-ai",
      anchorId: "anchor",
    });
    expect(suggestion?.bridgeId).toMatch(/^proposed-l2:/);
  });

  it("reports why generation cannot continue instead of returning no result", async () => {
    const nodes = snapshotWithoutBridge();
    await expect(suggestBridge(nodes[1], nodes, { endpoint: "", model: "test-model", apiKey: "" })).rejects.toThrow(
      "当前没有可复用的正式 L2",
    );
  });

  it("shows a diagnostic when remote AI fails and a local reusable L2 exists", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const snapshot = structuredClone(demoVaultSnapshot);
    const frontier = snapshot.nodes.find((node) => node.role === "L3");
    expect(frontier).toBeDefined();

    const suggestion = await suggestBridge(frontier!, snapshot.nodes, {
      endpoint: "https://example.test/v1",
      model: "test-model",
      apiKey: "",
    });

    expect(suggestion?.provider).toBe("local-fallback");
    expect(suggestion?.diagnostic).toContain("network unavailable");
  });
});
