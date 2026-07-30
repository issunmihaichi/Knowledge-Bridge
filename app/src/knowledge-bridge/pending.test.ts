import { describe, expect, it } from "vitest";
import { applyPendingResolution, writeLineageBinding } from "./pending";
import type { VaultSnapshot } from "./model";
import { DemoVaultAdapter } from "./vault";

function snapshot(): VaultSnapshot {
  return {
    nodes: [
      { id: "source", title: "旧知", role: "L1", status: "formal", content: "", x: 0, y: 0 },
      {
        id: "missing",
        title: "遗失概念",
        role: "L3",
        status: "missing-source",
        content: "",
        x: 200,
        y: 0,
      },
    ],
    relations: [],
    pending: [
      {
        id: "mention",
        filePath: "Notes/source.md",
        sourceId: "source",
        targetTitle: "新概念",
        kind: "wikilink",
        raw: "[[新概念]]",
      },
      {
        id: "lineage",
        filePath: "Notes/unknown.md",
        targetTitle: "遗失概念",
        kind: "lineage",
        raw: "kb-id missing",
        candidates: [{ id: "missing", title: "遗失概念", reason: "标题一致", confidence: 0.9 }],
      },
    ],
    protocols: [],
    lenses: [],
    argumentRoles: [],
    migrationRecords: [],
    paperDrafts: [],
    graphProposals: [],
  };
}

describe("pending resolution", () => {
  it("turns a confirmed wikilink into a pending L3 and cognitive mention", () => {
    const next = applyPendingResolution(snapshot(), {
      pendingId: "mention",
      action: "accept",
      newNodeId: "new-concept",
      now: 10,
    });
    expect(next.nodes).toContainEqual(
      expect.objectContaining({ id: "new-concept", role: "L3", status: "pending", l3Lifecycle: "captured" }),
    );
    expect(next.relations).toContainEqual(
      expect.objectContaining({
        source: "source",
        target: "new-concept",
        layer: "cognitive",
        cognitiveKind: "mention",
        status: "pending",
      }),
    );
    expect(next.relations.some((relation) => relation.layer === "logical")).toBe(false);
    expect(next.pending.some((item) => item.id === "mention")).toBe(false);
  });

  it("requires an explicit lineage action and restores a missing source on rebind", () => {
    expect(applyPendingResolution(snapshot(), { pendingId: "lineage", action: "accept", now: 10 })).toEqual(snapshot());
    const rebound = applyPendingResolution(snapshot(), {
      pendingId: "lineage",
      action: "lineage-rebind",
      candidateId: "missing",
      sourceMarkdown: "# 遗失概念\n\n恢复的正文",
      now: 10,
    });
    expect(rebound.nodes.find((node) => node.id === "missing")).toEqual(
      expect.objectContaining({
        path: "Notes/unknown.md",
        status: "formal",
        detailsMarkdown: "# 遗失概念\n\n恢复的正文",
      }),
    );
    expect(rebound.pending.some((item) => item.id === "lineage")).toBe(false);
  });

  it("writes the chosen stable id into the source frontmatter", async () => {
    const adapter = new DemoVaultAdapter();
    await adapter.write("Notes/unknown.md", "# 遗失概念\n");
    const write = await writeLineageBinding(adapter, snapshot().pending[1], "missing");
    expect(await adapter.read("Notes/unknown.md")).toContain("kb-id: missing");
    expect(write).toEqual({
      path: "Notes/unknown.md",
      before: "# 遗失概念\n",
      after: "---\nkb-id: missing\n---\n\n# 遗失概念\n",
    });
  });

  it("keeps an adopted AI bridge and its traceable anchor as pending cognitive relations", () => {
    const current = snapshot();
    current.nodes.push({
      id: "bridge",
      title: "反馈调节",
      role: "L2",
      status: "formal",
      content: "状态变化经由反馈回路影响后续变化。",
      x: 100,
      y: 0,
    });
    current.nodes.push({
      id: "frontier",
      title: "合成基因回路",
      role: "L3",
      status: "pending",
      content: "待理解的新概念",
      x: 300,
      y: 0,
    });
    current.pending.push({
      id: "ai-bridge",
      filePath: "ai://remote-ai/bridge/frontier",
      sourceId: "frontier",
      targetTitle: "反馈调节",
      kind: "ai-bridge",
      raw: "该回路通过反馈改变表达输出。",
      suggestedRole: "L2",
      anchorId: "source",
      anchorReason: "旧知中已经包含稳态反馈。",
      anchorEvidence: ["用户确认的高中生物锚点"],
      anchorAlternatives: [{ id: "other-anchor", reason: "较弱备选", confidence: 0.4 }],
      candidates: [{ id: "bridge", title: "反馈调节", reason: "机制匹配", confidence: 0.86 }],
    });

    const next = applyPendingResolution(current, {
      pendingId: "ai-bridge",
      action: "accept",
      now: 20,
    });

    expect(next.nodes.find((node) => node.id === "bridge")?.status).toBe("formal");
    expect(next.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bridge",
          target: "frontier",
          layer: "cognitive",
          status: "pending",
          confidence: 0.86,
        }),
        expect.objectContaining({
          source: "source",
          target: "bridge",
          layer: "cognitive",
          status: "pending",
          confidence: 0.86,
          ai: expect.objectContaining({
            reason: "旧知中已经包含稳态反馈。",
            evidence: ["用户确认的高中生物锚点"],
            alternatives: [{ id: "other-anchor", reason: "较弱备选", confidence: 0.4 }],
          }),
        }),
      ]),
    );
    expect(next.relations.some((relation) => relation.layer === "logical")).toBe(false);
    expect(next.pending.some((item) => item.id === "ai-bridge")).toBe(false);
  });

  it("creates a pending L2 with the AI-proposed definition and boundary", () => {
    const current = snapshot();
    current.nodes.push({
      id: "frontier-new",
      title: "Spatial transcriptomics",
      role: "L3",
      status: "pending",
      content: "A new concept",
      x: 300,
      y: 0,
    });
    current.pending.push({
      id: "ai-new-bridge",
      filePath: "ai://remote-ai/bridge/frontier-new",
      sourceId: "frontier-new",
      targetTitle: "Spatially constrained regulation",
      kind: "ai-bridge",
      raw: "Local context constrains expression.",
      suggestedRole: "L2",
      definition: "Tissue position changes the regulatory context.",
      scope: "Spatial omics",
      boundary: "Association alone does not establish causality.",
      candidates: [
        {
          id: "proposed-l2:one",
          title: "Spatially constrained regulation",
          reason: "Mechanism candidate",
          confidence: 0.78,
        },
      ],
    });

    const next = applyPendingResolution(current, {
      pendingId: "ai-new-bridge",
      action: "accept",
      newNodeId: "accepted-l2",
      now: 20,
    });

    expect(next.nodes.find((node) => node.id === "accepted-l2")).toMatchObject({
      role: "L2",
      status: "pending",
      definition: "Tissue position changes the regulatory context.",
      scope: "Spatial omics",
      boundary: "Association alone does not establish causality.",
    });
  });

  it("adopts a decomposed AI bridge as a pending module without creating an L2 node", () => {
    const current = snapshot();
    current.nodes.push({
      id: "frontier-module",
      title: "New frontier concept",
      role: "L3",
      status: "pending",
      content: "New source material",
      x: 300,
      y: 0,
    });
    current.pending.push({
      id: "ai-module",
      filePath: "ai://remote-ai/bridge/frontier-module",
      sourceId: "frontier-module",
      targetTitle: "A decomposed bridge",
      kind: "ai-bridge",
      raw: "The bridge is stepwise.",
      anchorId: "source",
      anchorReason: "The anchor is auditable.",
      candidates: [{ id: "module", title: "A decomposed bridge", reason: "Stepwise", confidence: 0.81 }],
      bridgeModule: {
        title: "A decomposed bridge",
        steps: [
          { id: "map", title: "Map", kind: "mapping", explanation: "Align variables." },
          { id: "mechanism", title: "Mechanism", kind: "mechanism", explanation: "Explain the change." },
        ],
      },
    });

    const next = applyPendingResolution(current, { pendingId: "ai-module", action: "accept", now: 20 });

    expect(next.bridgeModules).toHaveLength(1);
    expect(next.bridgeModules?.[0]).toMatchObject({ sourceId: "source", targetId: "frontier-module" });
    expect(next.nodes.filter((node) => node.role === "L2")).toHaveLength(0);
    expect(next.relations).toContainEqual(
      expect.objectContaining({
        bridgeModuleId: next.bridgeModules?.[0].id,
        source: "source",
        target: "frontier-module",
      }),
    );
  });
});
