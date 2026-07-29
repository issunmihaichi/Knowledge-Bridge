import type {
  AgentExecutionTrace,
  GraphChangeProposal,
  KnowledgeNode,
  LearningRole,
  PaperBridgeDraft,
  PaperBridgeStep,
  VaultSnapshot,
} from "./model";

const roleByStep: Record<PaperBridgeStep["role"], LearningRole> = {
  "frontier-concept": "L3",
  "bridge-mechanism": "L2",
  "learning-anchor": "L1",
  "high-school-anchor": "L1",
  "scale-gap": "L4",
};

const defaultX: Record<LearningRole, number> = { L1: -360, L2: -80, L3: 220, L4: 460 };

function fallbackTrace(draft: PaperBridgeDraft, now: number): AgentExecutionTrace {
  return {
    id: `agent-trace:${crypto.randomUUID()}`,
    startedAt: draft.createdAt,
    completedAt: now,
    llm: { provider: draft.provider },
    mcp: { servers: [], availableTools: [], invokedTools: [] },
    skills: { available: [], activated: [] },
    warnings: draft.diagnostic ? [draft.diagnostic] : [],
  };
}

function positionFor(snapshot: VaultSnapshot, role: LearningRole, offset: number): { x: number; y: number } {
  const peers = snapshot.nodes.filter((node) => node.role === role);
  if (peers.length === 0) return { x: defaultX[role], y: offset * 120 };
  return {
    x: Math.round(peers.reduce((sum, node) => sum + node.x, 0) / peers.length),
    y: Math.round(peers.reduce((sum, node) => sum + node.y, 0) / peers.length + (offset + 1) * 120),
  };
}

function proposalNode(
  proposalId: string,
  step: PaperBridgeStep,
  snapshot: VaultSnapshot,
  offset: number,
  now: number,
): KnowledgeNode {
  const role = roleByStep[step.role];
  const position = positionFor(snapshot, role, offset);
  return {
    id: `agent-node:${proposalId}:${offset}`,
    title: step.title,
    role,
    status: "pending",
    content: step.explanation,
    x: position.x,
    y: position.y,
    ...(role === "L1" ? { sourceKind: "ai-inferred" as const } : {}),
    ...(role === "L3" ? { l3Lifecycle: "ai-suggested" as const } : {}),
    ai: {
      status: "draft",
      reason: `Proposed by the learning-chain agent from step ${step.id}.`,
      evidence: [step.explanation],
      confidence: 0.5,
      alternatives: [],
      createdAt: now,
    },
  };
}

export function createGraphChangeProposal(
  draft: PaperBridgeDraft,
  snapshot: VaultSnapshot,
  now = Date.now(),
  proposalId = `graph-proposal:${crypto.randomUUID()}`,
): GraphChangeProposal {
  const knownNodes = new Set(snapshot.nodes.map((node) => node.id));
  const nodeIds: string[] = [];
  const operations: GraphChangeProposal["operations"] = [];
  let createdNodeCount = 0;

  for (const step of draft.chain) {
    if (step.nodeId && knownNodes.has(step.nodeId)) {
      nodeIds.push(step.nodeId);
      continue;
    }
    const node = proposalNode(proposalId, step, snapshot, createdNodeCount++, now);
    nodeIds.push(node.id);
    knownNodes.add(node.id);
    operations.push({ type: "create-node", node });
  }

  const existingPairs = new Set(snapshot.relations.map((relation) => `${relation.source}\0${relation.target}`));
  const reversed = [...nodeIds].reverse();
  for (let index = 0; index < reversed.length - 1; index++) {
    const source = reversed[index];
    const target = reversed[index + 1];
    if (source === target || existingPairs.has(`${source}\0${target}`)) continue;
    const relationId = `agent-relation:${proposalId}:${index}`;
    operations.push({
      type: "create-relation",
      relation: {
        id: relationId,
        source,
        target,
        label: index === 0 ? "学习桥梁" : "解释新知",
        layer: "cognitive",
        cognitiveKind: "explanation",
        status: "pending",
        confidence: draft.confidence,
        ai: {
          status: "draft",
          reason: draft.summary,
          evidence: [draft.anchorReason],
          confidence: draft.confidence,
          alternatives: [],
          createdAt: now,
        },
      },
    });
  }

  return {
    id: proposalId,
    title: draft.title,
    summary: draft.summary,
    sourceDraftId: draft.id,
    status: "draft",
    operations,
    trace: draft.agentTrace ?? fallbackTrace(draft, now),
    createdAt: now,
  };
}

export function applyGraphChangeProposal(snapshot: VaultSnapshot, proposalId: string, now = Date.now()): VaultSnapshot {
  const proposal = snapshot.graphProposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "draft") return snapshot;

  const nodes = [...snapshot.nodes];
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const operation of proposal.operations) {
    if (operation.type !== "create-node" || nodeIds.has(operation.node.id)) continue;
    nodes.push({
      ...operation.node,
      ai: operation.node.ai ? { ...operation.node.ai, status: "adopted", adoptedAt: now } : undefined,
    });
    nodeIds.add(operation.node.id);
  }

  const relations = [...snapshot.relations];
  const relationIds = new Set(relations.map((relation) => relation.id));
  for (const operation of proposal.operations) {
    if (operation.type !== "create-relation" || relationIds.has(operation.relation.id)) continue;
    if (!nodeIds.has(operation.relation.source) || !nodeIds.has(operation.relation.target)) continue;
    relations.push({
      ...operation.relation,
      ai: operation.relation.ai ? { ...operation.relation.ai, status: "adopted", adoptedAt: now } : undefined,
    });
    relationIds.add(operation.relation.id);
  }

  return {
    ...snapshot,
    nodes,
    relations,
    graphProposals: snapshot.graphProposals.map((item) =>
      item.id === proposalId ? { ...item, status: "applied", appliedAt: now } : item,
    ),
  };
}

export function rejectGraphChangeProposal(
  snapshot: VaultSnapshot,
  proposalId: string,
  now = Date.now(),
): VaultSnapshot {
  return {
    ...snapshot,
    graphProposals: snapshot.graphProposals.map((item) =>
      item.id === proposalId && item.status === "draft" ? { ...item, status: "rejected", rejectedAt: now } : item,
    ),
  };
}
