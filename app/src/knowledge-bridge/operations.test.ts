import { describe, expect, it } from "vitest";
import { demoVaultSnapshot } from "./model";
import {
  applyKnowledgeGraphOperation,
  createAgentProposalOperation,
  createCanvasPositionOperation,
} from "./operations";
import { draftPaperBridgeLocally } from "./paperBridgeAi";

describe("Knowledge Bridge operation protocol", () => {
  it("applies an AI proposal through one versioned operation", () => {
    const snapshot = structuredClone(demoVaultSnapshot);
    const draft = draftPaperBridgeLocally("A frontier concept", snapshot, 100);
    const operation = createAgentProposalOperation(draft, 200);

    const applied = applyKnowledgeGraphOperation(snapshot, operation);

    expect(applied.changed).toBe(true);
    expect(applied.meta).toMatchObject({ id: operation.id, origin: "agent", type: "agent-proposal-apply" });
    expect(applied.transactionKind).toContain(operation.id);
    expect(applied.snapshot.graphProposals).toHaveLength(1);
    expect(applied.snapshot.graphProposals[0].status).toBe("applied");
    expect(applied.snapshot.nodes.length).toBeGreaterThan(snapshot.nodes.length);
  });

  it("persists only changed managed-node positions", () => {
    const snapshot = structuredClone(demoVaultSnapshot);
    const operation = createCanvasPositionOperation(
      [
        { id: "l1-cell", x: 123, y: -45 },
        { id: "missing-node", x: 99, y: 99 },
      ],
      300,
    );

    const applied = applyKnowledgeGraphOperation(snapshot, operation);

    expect(applied.changed).toBe(true);
    expect(applied.meta).toMatchObject({ origin: "canvas", type: "set-canvas-positions" });
    expect(applied.snapshot.nodes.find((node) => node.id === "l1-cell")).toMatchObject({ x: 123, y: -45 });
    expect(applied.snapshot.relations).toEqual(snapshot.relations);
  });

  it("does not create a transaction for unchanged canvas coordinates", () => {
    const snapshot = structuredClone(demoVaultSnapshot);
    const node = snapshot.nodes[0];
    const applied = applyKnowledgeGraphOperation(
      snapshot,
      createCanvasPositionOperation([{ id: node.id, x: node.x, y: node.y }], 400),
    );

    expect(applied.changed).toBe(false);
    expect(applied.snapshot).toBe(snapshot);
  });

  it("does not apply an adopted AI draft a second time", () => {
    const snapshot = structuredClone(demoVaultSnapshot);
    const draft = draftPaperBridgeLocally("A frontier concept", snapshot, 500);
    const first = applyKnowledgeGraphOperation(snapshot, createAgentProposalOperation(draft, 510));
    const second = applyKnowledgeGraphOperation(first.snapshot, createAgentProposalOperation(draft, 520));

    expect(second.changed).toBe(false);
    expect(second.snapshot).toBe(first.snapshot);
    expect(second.snapshot.graphProposals).toHaveLength(1);
  });
});
