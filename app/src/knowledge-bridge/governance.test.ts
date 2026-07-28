import { describe, expect, it } from "vitest";
import {
  adoptAiDraft,
  applyHighConfidenceMigration,
  buildFrozenL2MigrationPreview,
  bundleRelations,
  evaluateL2Admission,
  freezeL2,
  normalizeCrossScaleRelation,
  relationBundles,
  transitionL3,
} from "./governance";
import type { VaultSnapshot } from "./model";

function snapshot(): VaultSnapshot {
  return {
    nodes: [
      { id: "l1-a", title: "旧知 A", role: "L1", status: "formal", content: "old a", x: 0, y: 0 },
      { id: "l1-b", title: "旧知 B", role: "L1", status: "formal", content: "old b", x: 0, y: 0 },
      {
        id: "old-l2",
        title: "旧桥梁",
        role: "L2",
        status: "formal",
        content: "old bridge",
        definition: "一个可检验的旧桥梁机制。",
        boundary: "只适用于明确条件下的路径。",
        x: 0,
        y: 0,
      },
      {
        id: "new-l2",
        title: "替代机制",
        role: "L2",
        status: "formal",
        content: "new bridge",
        definition: "一个可检验的替代桥梁机制。",
        boundary: "只适用于明确条件下的路径。",
        x: 0,
        y: 0,
      },
      {
        id: "l3-a",
        title: "新知 A",
        role: "L3",
        status: "pending",
        content: "new a",
        x: 0,
        y: 0,
        l3Lifecycle: "captured",
      },
      {
        id: "l3-b",
        title: "新知 B",
        role: "L3",
        status: "pending",
        content: "new b",
        x: 0,
        y: 0,
        l3Lifecycle: "captured",
      },
    ],
    relations: [
      { id: "a-old", source: "l1-a", target: "old-l2", label: "解释", layer: "logical", status: "formal" },
      { id: "b-old", source: "l1-b", target: "old-l2", label: "解释", layer: "logical", status: "formal" },
      { id: "old-a", source: "old-l2", target: "l3-a", label: "桥接", layer: "logical", status: "formal" },
      { id: "old-b", source: "old-l2", target: "l3-b", label: "桥接", layer: "logical", status: "formal" },
      { id: "a-new", source: "l1-a", target: "new-l2", label: "解释", layer: "logical", status: "formal" },
      { id: "b-new", source: "l1-b", target: "new-l2", label: "解释", layer: "logical", status: "formal" },
      { id: "new-a", source: "new-l2", target: "l3-a", label: "桥接", layer: "logical", status: "formal" },
      { id: "new-b", source: "new-l2", target: "l3-b", label: "桥接", layer: "logical", status: "formal" },
      {
        id: "ai-draft",
        source: "l1-a",
        target: "l3-a",
        label: "草拟关系",
        layer: "logical",
        status: "pending",
        ai: { status: "draft", reason: "测试", evidence: [], confidence: 0.9, alternatives: [], createdAt: 1 },
      },
    ],
    pending: [],
    protocols: [{ id: "gap", sourceScale: "molecule", targetScale: "person", mechanismSteps: [], status: "gap" }],
    lenses: [],
    argumentRoles: [],
    migrationRecords: [],
    paperDrafts: [],
  };
}

describe("knowledge governance", () => {
  it("does not make batch adoption a formal relation", () => {
    const adopted = adoptAiDraft(snapshot(), "ai-draft", 2);
    const relation = adopted.relations.find((item) => item.id === "ai-draft");
    expect(relation?.ai?.status).toBe("adopted");
    expect(relation?.status).toBe("pending");
  });

  it("evaluates L2 admission without promoting it", () => {
    const report = evaluateL2Admission(snapshot(), "old-l2");
    expect(report.independentPathCount).toBe(4);
    expect(report.qualified).toBe(true);
    expect(snapshot().nodes.find((item) => item.id === "old-l2")?.status).toBe("formal");
  });

  it("freezes actual paths and only migrates high-confidence replacements", () => {
    const frozen = freezeL2(snapshot(), "old-l2");
    expect(frozen.nodes.find((item) => item.id === "old-l2")?.status).toBe("frozen");
    expect(
      frozen.relations
        .filter((item) => item.id.endsWith("-old") || item.id.startsWith("old-"))
        .every((item) => item.status === "frozen"),
    ).toBe(true);

    const preview = buildFrozenL2MigrationPreview(frozen, "old-l2", 10);
    expect(preview.paths).toHaveLength(4);
    expect(preview.paths.every((item) => item.candidates[0]?.l2Id === "new-l2")).toBe(true);
    const migrated = applyHighConfidenceMigration(frozen, preview, undefined, 11);
    expect(migrated.migrationRecords[0]?.pathMappings).toHaveLength(4);
    expect(migrated.relations.filter((item) => item.status === "frozen")).toHaveLength(4);
  });

  it("keeps contradictory logical relations in a single visible bundle", () => {
    const value = snapshot();
    value.relations.push(
      {
        id: "conflict-a",
        source: "l1-a",
        target: "l3-a",
        label: "导致",
        layer: "logical",
        status: "formal",
        logicalOutcome: "compatible",
        weight: 0.44,
      },
      {
        id: "conflict-b",
        source: "l1-a",
        target: "l3-a",
        label: "抑制",
        layer: "logical",
        status: "formal",
        logicalOutcome: "conflicting",
        weight: 0.91,
      },
      {
        id: "cognitive",
        source: "l1-a",
        target: "l3-a",
        label: "类比",
        layer: "cognitive",
        status: "formal",
        cognitiveKind: "analogy",
        weight: 0.66,
      },
    );
    const bundle = bundleRelations(value, "l1-a", "l3-a");
    expect(bundle.label).toBe("冲突 ×3");
    expect(bundle.cognitiveCount).toBe(1);
    expect(bundle.primary?.id).toBe("conflict-b");
    expect(bundle.secondary.map((relation) => relation.id)).toContain("cognitive");
    expect(relationBundles(value)).toContainEqual(expect.objectContaining({ source: "l1-a", target: "l3-a" }));
  });

  it("keeps a high-weight cognitive relation visible even beside logical relations", () => {
    const value = snapshot();
    value.relations.push(
      {
        id: "logical",
        source: "l1-a",
        target: "l3-b",
        label: "结构关联",
        layer: "logical",
        status: "formal",
        kind: "structure",
        weight: 0.4,
      },
      {
        id: "cognitive-primary",
        source: "l1-a",
        target: "l3-b",
        label: "先修",
        layer: "cognitive",
        status: "formal",
        cognitiveKind: "prerequisite",
        weight: 0.93,
      },
    );
    const bundle = bundleRelations(value, "l1-a", "l3-b");
    expect(bundle.primary?.id).toBe("cognitive-primary");
    expect(bundle.secondary.map((relation) => relation.id)).toContain("logical");
  });

  it("downgrades an incomplete cross-scale relation without changing its logical kind", () => {
    const relation = normalizeCrossScaleRelation(
      {
        id: "scale",
        source: "l1-a",
        target: "l3-a",
        label: "跨尺度",
        layer: "logical",
        status: "formal",
        kind: "causality",
        reasoningKind: "cross-scale",
        scaleProtocolId: "gap",
      },
      snapshot(),
    );
    expect(relation.kind).toBe("causality");
    expect(relation.reasoningKind).toBe("cross-scale");
    expect(relation.status).toBe("pending");
  });

  it("keeps an unbridged L3 as an explicit lifecycle state", () => {
    const updated = transitionL3(snapshot(), "l3-a", "archived");
    expect(updated.nodes.find((item) => item.id === "l3-a")?.l3Lifecycle).toBe("archived");
  });
});
