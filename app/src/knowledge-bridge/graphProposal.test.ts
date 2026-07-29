import { describe, expect, it } from "vitest";
import { createGraphChangeProposal, applyGraphChangeProposal } from "./graphProposal";
import { emptyVaultSnapshot, type PaperBridgeDraft } from "./model";

const draft: PaperBridgeDraft = {
  id: "draft-1",
  title: "A learning chain",
  input: "new material",
  summary: "Connect a frontier concept through a reusable mechanism.",
  anchorReason: "The learner confirmed the anchor.",
  confidence: 0.72,
  provider: "remote-ai",
  status: "draft",
  createdAt: 100,
  chain: [
    {
      id: "frontier",
      title: "Frontier concept",
      role: "frontier-concept",
      explanation: "New concept from the source.",
      state: "proposed",
    },
    {
      id: "bridge",
      title: "Reusable mechanism",
      role: "bridge-mechanism",
      explanation: "Mechanism connecting new and old knowledge.",
      state: "proposed",
    },
    {
      id: "anchor",
      title: "Known concept",
      role: "learning-anchor",
      explanation: "User-confirmed prior knowledge.",
      state: "proposed",
    },
  ],
};

describe("Knowledge Bridge graph proposals", () => {
  it("keeps agent output outside the graph until the proposal is applied", () => {
    const snapshot = structuredClone(emptyVaultSnapshot);
    const proposal = createGraphChangeProposal(draft, snapshot, 200, "proposal-1");
    const staged = { ...snapshot, graphProposals: [proposal] };

    expect(staged.nodes).toHaveLength(0);
    expect(staged.relations).toHaveLength(0);
    expect(proposal.operations.filter((operation) => operation.type === "create-node")).toHaveLength(3);

    const applied = applyGraphChangeProposal(staged, proposal.id, 300);
    expect(applied.nodes).toHaveLength(3);
    expect(applied.relations).toHaveLength(2);
    expect(applied.nodes.every((node) => node.status === "pending")).toBe(true);
    expect(applied.graphProposals[0].status).toBe("applied");
  });

  it("reuses known node IDs instead of duplicating an anchor", () => {
    const snapshot = structuredClone(emptyVaultSnapshot);
    snapshot.nodes.push({
      id: "known-anchor",
      title: "Known concept",
      role: "L1",
      status: "formal",
      content: "Prior knowledge",
      x: -200,
      y: 0,
    });
    const withKnownAnchor = {
      ...draft,
      chain: draft.chain.map((step) =>
        step.role === "learning-anchor" ? { ...step, nodeId: "known-anchor", state: "existing" as const } : step,
      ),
    };

    const proposal = createGraphChangeProposal(withKnownAnchor, snapshot, 200, "proposal-2");
    const applied = applyGraphChangeProposal({ ...snapshot, graphProposals: [proposal] }, proposal.id, 300);

    expect(applied.nodes.filter((node) => node.role === "L1")).toHaveLength(1);
    expect(applied.relations.some((relation) => relation.source === "known-anchor")).toBe(true);
  });

  it("does not reuse a frozen or role-incompatible node from an agent draft", () => {
    const snapshot = structuredClone(emptyVaultSnapshot);
    snapshot.nodes.push({
      id: "wrong-role",
      title: "Anchor, not bridge",
      role: "L1",
      status: "formal",
      sourceKind: "user-confirmed",
      content: "Prior knowledge",
      x: -200,
      y: 0,
    });
    const malformed = {
      ...draft,
      chain: draft.chain.map((step) =>
        step.role === "bridge-mechanism" ? { ...step, nodeId: "wrong-role", state: "existing" as const } : step,
      ),
    };
    const proposal = createGraphChangeProposal(malformed, snapshot, 200, "proposal-invalid-role");
    const bridgeNode = proposal.operations.find(
      (operation) => operation.type === "create-node" && operation.node.role === "L2",
    );
    expect(bridgeNode).toEqual(expect.objectContaining({ type: "create-node" }));
    expect(
      proposal.operations.some(
        (operation) =>
          operation.type === "create-relation" &&
          (operation.relation.source === "wrong-role" || operation.relation.target === "wrong-role"),
      ),
    ).toBe(false);
  });
});
