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

  it("does not let ordinary commits revive a severed managed edge", async () => {
    const ledger = await GraphLedger.open(undefined, undefined, false);
    const backend = new LocalKnowledgeBridgeBackend(ledger);
    const initial = structuredClone(demoVaultSnapshot);
    initial.relations[0].status = "severed";
    backend.commit({ snapshot: initial, kind: "user-severed" });

    const attempted = structuredClone(initial);
    attempted.relations[0].status = "formal";
    expect(backend.commit({ snapshot: attempted, kind: "agent-refresh" }).relations[0].status).toBe("severed");
    expect(backend.commit({ snapshot: attempted, kind: "managed-link-restore" }).relations[0].status).toBe("formal");
  });

  it("does not let any commit attach a visible relation to a frozen L2", async () => {
    const ledger = await GraphLedger.open(undefined, undefined, false);
    const backend = new LocalKnowledgeBridgeBackend(ledger);
    const initial = structuredClone(demoVaultSnapshot);
    const bridge = initial.nodes.find((node) => node.role === "L2")!;
    bridge.status = "frozen";
    backend.commit({ snapshot: initial, kind: "freeze" });

    const attempted = structuredClone(ledger.load());
    attempted.relations.push({
      id: "agent-late-link",
      source: bridge.id,
      target: "l3-crispr",
      label: "AI 草拟",
      layer: "cognitive",
      cognitiveKind: "explanation",
      status: "pending",
    });
    const persisted = backend.commit({ snapshot: attempted, kind: "agent-refresh" });
    expect(persisted.relations.find((relation) => relation.id === "agent-late-link")?.status).toBe("frozen");
  });
});
