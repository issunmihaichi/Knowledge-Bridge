import type {
  AgentExecutionTrace,
  BridgeModule,
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

function reusableStepNode(step: PaperBridgeStep, node: KnowledgeNode | undefined): boolean {
  if (!node || node.status === "frozen" || node.status === "missing-source") return false;
  const expectedRole = roleByStep[step.role];
  if (node.role !== expectedRole) return false;
  if (expectedRole === "L2" && node.status !== "formal") return false;
  return expectedRole !== "L1" || node.sourceKind !== "denied";
}

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

function createBridgeModule(
  proposalId: string,
  draft: PaperBridgeDraft,
  source: KnowledgeNode,
  target: KnowledgeNode,
  now: number,
): BridgeModule | undefined {
  const bridgeModule = draft.bridgeModule;
  if (!bridgeModule || bridgeModule.steps.length < 2) return undefined;
  const stepCount = bridgeModule.steps.length;
  const middleX = Math.round((source.x + target.x) / 2);
  const middleY = Math.round((source.y + target.y) / 2);
  return {
    id: `bridge-module:${proposalId}`,
    title: bridgeModule.title,
    definition: bridgeModule.definition,
    scope: bridgeModule.scope,
    boundary: bridgeModule.boundary,
    status: "pending",
    sourceId: source.id,
    targetId: target.id,
    x: middleX,
    y: middleY - 110,
    collapsed: false,
    steps: bridgeModule.steps.map((step, index) => {
      const ratio = (index + 1) / (stepCount + 1);
      return {
        ...step,
        x: Math.round(source.x + (target.x - source.x) * ratio),
        y: Math.round(source.y + (target.y - source.y) * ratio),
      };
    }),
    ai: {
      status: "draft",
      reason: draft.summary,
      evidence: [draft.anchorReason],
      confidence: draft.confidence,
      alternatives: [],
      createdAt: now,
    },
  };
}

function isModuleSummaryStep(step: PaperBridgeStep): boolean {
  return step.role === "bridge-mechanism" || step.role === "scale-gap";
}

function createLegacyRelations(
  proposalId: string,
  draft: PaperBridgeDraft,
  snapshot: VaultSnapshot,
  nodeIds: string[],
  now: number,
): GraphChangeProposal["operations"] {
  const existingPairs = new Set(snapshot.relations.map((relation) => `${relation.source}\0${relation.target}`));
  const operations: GraphChangeProposal["operations"] = [];
  const reversed = [...nodeIds].reverse();
  for (let index = 0; index < reversed.length - 1; index++) {
    const source = reversed[index];
    const target = reversed[index + 1];
    if (source === target || existingPairs.has(`${source}\0${target}`)) continue;
    operations.push({
      type: "create-relation",
      relation: {
        id: `agent-relation:${proposalId}:${index}`,
        source,
        target,
        label: index === 0 ? "Learning bridge" : "Explains new knowledge",
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
  return operations;
}

/**
 * Modern AI drafts create a decomposed L2 bridge module between L1 and L3.
 * The legacy branch is retained only to keep historical paper drafts readable.
 */
export function createGraphChangeProposal(
  draft: PaperBridgeDraft,
  snapshot: VaultSnapshot,
  now = Date.now(),
  proposalId = `graph-proposal:${crypto.randomUUID()}`,
): GraphChangeProposal {
  const knownNodes = new Set(snapshot.nodes.map((node) => node.id));
  const resolvedNodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const nodeIds: string[] = [];
  const stepNodeIds = new Map<string, string>();
  const operations: GraphChangeProposal["operations"] = [];
  let createdNodeCount = 0;

  for (const step of draft.chain) {
    if (draft.bridgeModule && isModuleSummaryStep(step)) continue;
    const existing = step.nodeId ? snapshot.nodes.find((node) => node.id === step.nodeId) : undefined;
    if (step.nodeId && knownNodes.has(step.nodeId) && reusableStepNode(step, existing)) {
      nodeIds.push(step.nodeId);
      stepNodeIds.set(step.id, step.nodeId);
      continue;
    }
    const node = proposalNode(proposalId, step, snapshot, createdNodeCount++, now);
    nodeIds.push(node.id);
    stepNodeIds.set(step.id, node.id);
    knownNodes.add(node.id);
    resolvedNodes.set(node.id, node);
    operations.push({ type: "create-node", node });
  }

  if (draft.bridgeModule) {
    const anchorStep = draft.chain.find(
      (step) => step.role === "learning-anchor" || step.role === "high-school-anchor",
    );
    const frontierStep = draft.chain.find((step) => step.role === "frontier-concept");
    const source = anchorStep ? resolvedNodes.get(stepNodeIds.get(anchorStep.id) ?? "") : undefined;
    const target = frontierStep ? resolvedNodes.get(stepNodeIds.get(frontierStep.id) ?? "") : undefined;
    const module =
      source && target && source.id !== target.id
        ? createBridgeModule(proposalId, draft, source, target, now)
        : undefined;
    if (module && source && target) {
      operations.push({ type: "create-bridge-module", module });
      operations.push({
        type: "create-relation",
        relation: {
          id: `agent-module-relation:${proposalId}`,
          source: source.id,
          target: target.id,
          label: module.title,
          layer: "cognitive",
          cognitiveKind: "explanation",
          status: "pending",
          bridgeModuleId: module.id,
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
  } else {
    operations.push(...createLegacyRelations(proposalId, draft, snapshot, nodeIds, now));
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

  const bridgeModules = [...(snapshot.bridgeModules ?? [])];
  const moduleIds = new Set(bridgeModules.map((module) => module.id));
  for (const operation of proposal.operations) {
    if (operation.type !== "create-bridge-module" || moduleIds.has(operation.module.id)) continue;
    bridgeModules.push({
      ...operation.module,
      ai: operation.module.ai ? { ...operation.module.ai, status: "adopted", adoptedAt: now } : undefined,
    });
    moduleIds.add(operation.module.id);
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
    bridgeModules,
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
