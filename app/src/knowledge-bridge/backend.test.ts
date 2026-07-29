import { describe, expect, it } from "vitest";
import { LocalKnowledgeBridgeBackend } from "./backend";
import { GraphLedger } from "./ledger";
import { demoVaultSnapshot } from "./model";
import { createAgentProposalOperation } from "./operations";
import { draftPaperBridgeLocally } from "./paperBridgeAi";

describe("Knowledge Bridge backend facade", () => {
  it("persists an agent operation once and restores the prior ledger through undo", async () => {
    const ledger = await GraphLedger.open(undefined, undefined, false);
    const backend = new LocalKnowledgeBridgeBackend(ledger);
    const initial = structuredClone(demoVaultSnapshot);
    backend.commit({ snapshot: initial, kind: "test-initial" });

    const draft = draftPaperBridgeLocally("A frontier concept", initial, 10);
    const operation = createAgentProposalOperation(draft, 20);
    const applied = backend.applyOperation(initial, operation);

    expect(applied.changed).toBe(true);
    expect(ledger.load()).toEqual(applied.snapshot);
    expect(ledger.load().graphProposals).toHaveLength(1);
    expect(ledger.undo()).toEqual(initial);
    expect(ledger.load()).toEqual(initial);
  });

  it("does not create a persisted version for an unchanged canvas operation", async () => {
    const ledger = await GraphLedger.open(undefined, undefined, false);
    const backend = new LocalKnowledgeBridgeBackend(ledger);
    const initial = structuredClone(demoVaultSnapshot);
    backend.commit({ snapshot: initial, kind: "test-initial" });
    const node = initial.nodes[0];

    const applied = backend.applyOperation(initial, {
      id: "unchanged-position",
      origin: "canvas",
      type: "set-canvas-positions",
      createdAt: 30,
      positions: [{ id: node.id, x: node.x, y: node.y }],
    });

    expect(applied.changed).toBe(false);
    expect(ledger.undo()).toEqual(
      structuredClone({
        nodes: [],
        relations: [],
        pending: [],
        protocols: [],
        lenses: [],
        argumentRoles: [],
        migrationRecords: [],
        paperDrafts: [],
        graphProposals: [],
      }),
    );
  });
});
