import { describe, expect, it } from "vitest";
import type { KnowledgeNode } from "./model";
import { buildKnowledgeSpatialIndex, queryKnowledgeSpatialIndex } from "./spatialIndex";

describe("Knowledge Bridge spatial materialization", () => {
  it("limits a 5000-node first viewport without mutating coordinates", () => {
    const nodes: KnowledgeNode[] = Array.from({ length: 5_000 }, (_, index) => ({
      id: `node-${index}`,
      title: `Node ${index}`,
      role: index % 2 ? "L2" : "L1",
      status: "formal",
      content: "",
      x: (index % 100) * 100,
      y: Math.floor(index / 100) * 100,
    }));
    const before = nodes.map(({ id, x, y }) => ({ id, x, y }));
    const selected = queryKnowledgeSpatialIndex(
      buildKnowledgeSpatialIndex(nodes),
      { centerX: 500, centerY: 500, width: 1_200, height: 800 },
      700,
    );
    expect(selected.size).toBeGreaterThan(0);
    expect(selected.size).toBeLessThanOrEqual(700);
    expect(nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(before);
  });
});
