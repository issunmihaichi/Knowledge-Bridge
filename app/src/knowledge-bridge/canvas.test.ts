import { describe, expect, it } from "vitest";
import { shouldApplyLedgerPosition } from "./canvasPosition";
import { emptyVaultSnapshot } from "./model";
import { projectSemanticZoom } from "./semanticZoom";

describe("Knowledge Bridge canvas synchronization", () => {
  it("does not overwrite a canvas drag that has not yet been persisted", () => {
    expect(shouldApplyLedgerPosition({ x: 100, y: 100 }, { x: 160, y: 100 }, { x: 100, y: 100 })).toBe(false);
  });

  it("uses a ledger coordinate when a committed operation changed it", () => {
    expect(shouldApplyLedgerPosition({ x: 160, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true);
  });

  it("places a newly materialized managed node at its ledger coordinate", () => {
    expect(shouldApplyLedgerPosition({ x: 10, y: 20 }, { x: 0, y: 0 }, undefined)).toBe(true);
  });

  it("hides L3/L4 without changing any saved coordinate", () => {
    const snapshot = {
      ...structuredClone(emptyVaultSnapshot),
      nodes: [
        { id: "l1", title: "Anchor", role: "L1" as const, status: "formal" as const, content: "", x: 10, y: 20 },
        { id: "l2", title: "Bridge", role: "L2" as const, status: "formal" as const, content: "", x: 30, y: 40 },
        { id: "l3", title: "Detail", role: "L3" as const, status: "formal" as const, content: "", x: 50, y: 60 },
      ],
      relations: [
        { id: "a", source: "l1", target: "l2", label: "bridge", layer: "logical" as const, status: "formal" as const },
        { id: "b", source: "l2", target: "l3", label: "detail", layer: "logical" as const, status: "formal" as const },
      ],
    };
    const coordinates = snapshot.nodes.map(({ id, x, y }) => ({ id, x, y }));
    const projection = projectSemanticZoom(snapshot, 0.2);
    expect(projection.hiddenNodeIds).toEqual(new Set(["l3"]));
    expect(projection.aggregateCounts.get("l1")).toBe(1);
    expect(projection.aggregateCounts.get("l2")).toBe(1);
    expect(snapshot.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(coordinates);
  });
});
