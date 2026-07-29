import { applyGraphChangeProposal, createGraphChangeProposal } from "./graphProposal";
import { applyPendingResolution, type PendingResolution } from "./pending";
import type { KnowledgeGraphOperationMeta, PaperBridgeDraft, VaultSnapshot } from "./model";

export interface KnowledgeNodePosition {
  id: string;
  x: number;
  y: number;
}

export interface KnowledgeNodeDetails {
  id: string;
  markdown: string;
}

export interface ApplyAgentProposalOperation extends KnowledgeGraphOperationMeta {
  type: "agent-proposal-apply";
  origin: "agent" | "mcp" | "skill";
  draft: PaperBridgeDraft;
}

export interface SetCanvasPositionsOperation extends KnowledgeGraphOperationMeta {
  type: "set-canvas-positions";
  origin: "canvas";
  positions: KnowledgeNodePosition[];
}

export interface SetNodeDetailsOperation extends KnowledgeGraphOperationMeta {
  type: "set-node-details";
  origin: "canvas";
  details: KnowledgeNodeDetails[];
}

export interface ResolvePendingOperation extends KnowledgeGraphOperationMeta, PendingResolution {
  type: "pending-resolve";
  origin: "user";
}

export type KnowledgeGraphOperation =
  | ApplyAgentProposalOperation
  | SetCanvasPositionsOperation
  | SetNodeDetailsOperation
  | ResolvePendingOperation;

export interface AppliedKnowledgeGraphOperation {
  snapshot: VaultSnapshot;
  changed: boolean;
  meta: KnowledgeGraphOperationMeta;
  transactionKind: string;
}

function transactionKind(operation: KnowledgeGraphOperation): string {
  return `kb-operation:${operation.origin}:${operation.type}:${operation.id}`;
}

function applyAgentProposal(snapshot: VaultSnapshot, operation: ApplyAgentProposalOperation): VaultSnapshot {
  if (
    snapshot.graphProposals.some(
      (proposal) => proposal.sourceDraftId === operation.draft.id && proposal.status === "applied",
    )
  ) {
    return snapshot;
  }
  const adoptedDraft = { ...operation.draft, status: "adopted" as const };
  const paperDrafts = snapshot.paperDrafts.some((item) => item.id === operation.draft.id)
    ? snapshot.paperDrafts.map((item) => (item.id === operation.draft.id ? adoptedDraft : item))
    : [...snapshot.paperDrafts, adoptedDraft];
  const proposal = createGraphChangeProposal(
    operation.draft,
    snapshot,
    operation.createdAt,
    `graph-proposal:${operation.id}`,
  );
  return applyGraphChangeProposal(
    {
      ...snapshot,
      paperDrafts,
      graphProposals: [...snapshot.graphProposals, proposal],
    },
    proposal.id,
    operation.createdAt,
  );
}

function applyCanvasPositions(snapshot: VaultSnapshot, positions: KnowledgeNodePosition[]): VaultSnapshot {
  const nextPositions = new Map(positions.map((position) => [position.id, position]));
  let changed = false;
  const nodes = snapshot.nodes.map((node) => {
    const position = nextPositions.get(node.id);
    if (!position || (node.x === position.x && node.y === position.y)) return node;
    changed = true;
    return { ...node, x: position.x, y: position.y };
  });
  return changed ? { ...snapshot, nodes } : snapshot;
}

function applyNodeDetails(snapshot: VaultSnapshot, details: KnowledgeNodeDetails[]): VaultSnapshot {
  const values = new Map(details.map((item) => [item.id, item.markdown]));
  let changed = false;
  const nodes = snapshot.nodes.map((node) => {
    const markdown = values.get(node.id);
    if (markdown === undefined || node.detailsMarkdown === markdown) return node;
    changed = true;
    return { ...node, detailsMarkdown: markdown };
  });
  return changed ? { ...snapshot, nodes } : snapshot;
}

export function applyKnowledgeGraphOperation(
  snapshot: VaultSnapshot,
  operation: KnowledgeGraphOperation,
): AppliedKnowledgeGraphOperation {
  const next =
    operation.type === "agent-proposal-apply"
      ? applyAgentProposal(snapshot, operation)
      : operation.type === "set-canvas-positions"
        ? applyCanvasPositions(snapshot, operation.positions)
        : operation.type === "set-node-details"
          ? applyNodeDetails(snapshot, operation.details)
          : applyPendingResolution(snapshot, operation);
  return {
    snapshot: next,
    changed: next !== snapshot,
    meta: {
      id: operation.id,
      origin: operation.origin,
      type: operation.type,
      createdAt: operation.createdAt,
    },
    transactionKind: transactionKind(operation),
  };
}

export function createAgentProposalOperation(draft: PaperBridgeDraft, now = Date.now()): ApplyAgentProposalOperation {
  const origin: ApplyAgentProposalOperation["origin"] = draft.agentTrace?.mcp.invokedTools.length
    ? "mcp"
    : draft.agentTrace?.skills.activated.length
      ? "skill"
      : "agent";
  return {
    id: `kb-operation:${crypto.randomUUID()}`,
    origin,
    type: "agent-proposal-apply",
    draft,
    createdAt: now,
  };
}

export function createCanvasPositionOperation(
  positions: KnowledgeNodePosition[],
  now = Date.now(),
): SetCanvasPositionsOperation {
  return {
    id: `kb-operation:${crypto.randomUUID()}`,
    origin: "canvas",
    type: "set-canvas-positions",
    positions,
    createdAt: now,
  };
}

export function createNodeDetailsOperation(details: KnowledgeNodeDetails[], now = Date.now()): SetNodeDetailsOperation {
  return {
    id: `kb-operation:${crypto.randomUUID()}`,
    origin: "canvas",
    type: "set-node-details",
    details,
    createdAt: now,
  };
}

export function createPendingResolutionOperation(
  resolution: Omit<PendingResolution, "now"> & { now?: number },
): ResolvePendingOperation {
  const now = resolution.now ?? Date.now();
  return {
    id: `kb-operation:${crypto.randomUUID()}`,
    origin: "user",
    type: "pending-resolve",
    createdAt: now,
    now,
    pendingId: resolution.pendingId,
    action: resolution.action,
    candidateId: resolution.candidateId,
    newNodeId: resolution.newNodeId,
    sourceMarkdown: resolution.sourceMarkdown,
  };
}
