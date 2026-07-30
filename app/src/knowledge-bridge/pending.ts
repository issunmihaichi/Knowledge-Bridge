import type { BridgeModule, KnowledgeNode, KnowledgeRelation, PendingMention, VaultSnapshot } from "./model";
import { upsertKbId } from "./sync";
import type { VaultAdapter } from "./vault";

export type PendingResolutionAction =
  | "accept"
  | "dismiss"
  | "lineage-rebind"
  | "lineage-new"
  | "lineage-defer"
  | "restore-managed-link";

export interface PendingResolution {
  pendingId: string;
  action: PendingResolutionAction;
  candidateId?: string;
  newNodeId?: string;
  sourceMarkdown?: string;
  now: number;
}

function normalizedTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function withoutPending(snapshot: VaultSnapshot, pendingId: string): PendingMention[] {
  return snapshot.pending.filter((item) => item.id !== pendingId);
}

function proposedPosition(snapshot: VaultSnapshot, sourceId?: string): { x: number; y: number } {
  const source = snapshot.nodes.find((node) => node.id === sourceId);
  if (source) return { x: source.x + 260, y: source.y + 100 };
  const pendingCount = snapshot.nodes.filter((node) => node.status === "pending").length;
  return { x: 220, y: pendingCount * 120 };
}

function createTargetNode(
  snapshot: VaultSnapshot,
  item: PendingMention,
  id: string,
  now: number,
  sourceMarkdown?: string,
): KnowledgeNode {
  const role = item.suggestedRole ?? (item.kind === "ai-bridge" ? "L2" : "L3");
  return {
    id,
    title: item.targetTitle,
    role,
    status: "pending",
    path: item.kind === "lineage" ? item.filePath : undefined,
    content:
      item.kind === "ai-bridge" ? `用户采用的 AI 桥梁草案：${item.raw}` : `从 ${item.filePath} 捕获的待解析概念。`,
    ...(sourceMarkdown !== undefined ? { detailsMarkdown: sourceMarkdown } : {}),
    ...(item.kind === "ai-bridge" ? { definition: item.definition, scope: item.scope, boundary: item.boundary } : {}),
    ...proposedPosition(snapshot, item.sourceId),
    ...(role === "L3" ? { l3Lifecycle: "captured" as const } : {}),
    ...(item.kind === "ai-bridge"
      ? {
          ai: {
            status: "adopted" as const,
            reason: item.raw,
            evidence: [item.filePath],
            confidence: item.candidates?.[0]?.confidence ?? 0.5,
            alternatives: (item.candidates ?? []).slice(1).map((candidate) => ({
              id: candidate.id,
              reason: candidate.reason,
              confidence: candidate.confidence,
            })),
            createdAt: now,
            adoptedAt: now,
          },
        }
      : {}),
  };
}

function findTarget(snapshot: VaultSnapshot, item: PendingMention): KnowledgeNode | undefined {
  const title = normalizedTitle(item.targetTitle);
  return snapshot.nodes.find(
    (node) => normalizedTitle(node.title) === title && node.status !== "frozen" && node.status !== "missing-source",
  );
}

function pendingRelation(
  snapshot: VaultSnapshot,
  item: PendingMention,
  target: KnowledgeNode,
  now: number,
): KnowledgeRelation | undefined {
  const source = snapshot.nodes.find((node) => node.id === item.sourceId);
  if (!source || source.id === target.id) return undefined;
  const aiBridge = item.kind === "ai-bridge";
  const [sourceId, targetId] = aiBridge && target.role === "L2" ? [target.id, source.id] : [source.id, target.id];
  return {
    id: `pending-relation:${item.id}`,
    source: sourceId,
    target: targetId,
    label: aiBridge ? "AI 桥梁草案" : "提及",
    layer: "cognitive",
    cognitiveKind: aiBridge ? "explanation" : "mention",
    status: "pending",
    context: item.filePath,
    ...(aiBridge
      ? {
          confidence: item.candidates?.[0]?.confidence ?? 0.5,
          ai: {
            status: "adopted" as const,
            reason: item.raw,
            evidence: [item.filePath],
            confidence: item.candidates?.[0]?.confidence ?? 0.5,
            alternatives: (item.candidates ?? []).slice(1).map((candidate) => ({
              id: candidate.id,
              reason: candidate.reason,
              confidence: candidate.confidence,
            })),
            createdAt: now,
            adoptedAt: now,
          },
        }
      : {}),
  };
}

function pendingAnchorRelation(
  snapshot: VaultSnapshot,
  item: PendingMention,
  bridge: KnowledgeNode,
  now: number,
): KnowledgeRelation | undefined {
  if (item.kind !== "ai-bridge" || !item.anchorId || bridge.role !== "L2") return undefined;
  const anchor = snapshot.nodes.find((node) => node.id === item.anchorId && node.role === "L1");
  if (!anchor) return undefined;
  const confidence = item.candidates?.[0]?.confidence ?? 0.5;
  return {
    id: `pending-anchor:${item.id}`,
    source: anchor.id,
    target: bridge.id,
    label: "AI 锚点草案",
    layer: "cognitive",
    cognitiveKind: "explanation",
    status: "pending",
    confidence,
    ai: {
      status: "adopted",
      reason: item.anchorReason ?? "AI 未提供锚点理由。",
      evidence: item.anchorEvidence ?? [],
      confidence,
      alternatives: item.anchorAlternatives ?? [],
      createdAt: now,
      adoptedAt: now,
    },
  };
}

function createPendingBridgeModule(
  snapshot: VaultSnapshot,
  item: PendingMention,
  now: number,
): BridgeModule | undefined {
  if (item.kind !== "ai-bridge" || !item.bridgeModule || !item.sourceId || !item.anchorId) return undefined;
  const target = snapshot.nodes.find(
    (node) => node.id === item.sourceId && node.status !== "frozen" && node.status !== "missing-source",
  );
  const source = snapshot.nodes.find(
    (node) =>
      node.id === item.anchorId && node.role === "L1" && node.status !== "frozen" && node.status !== "missing-source",
  );
  if (!source || !target || source.id === target.id || item.bridgeModule.steps.length < 2) return undefined;
  const count = item.bridgeModule.steps.length;
  const confidence = item.candidates?.[0]?.confidence ?? 0.5;
  return {
    id: `bridge-module:pending:${item.id}`,
    title: item.bridgeModule.title,
    definition: item.bridgeModule.definition,
    scope: item.bridgeModule.scope,
    boundary: item.bridgeModule.boundary,
    status: "pending",
    sourceId: source.id,
    targetId: target.id,
    x: Math.round((source.x + target.x) / 2),
    y: Math.round((source.y + target.y) / 2 - 110),
    collapsed: false,
    steps: item.bridgeModule.steps.map((step, index) => {
      const ratio = (index + 1) / (count + 1);
      return {
        ...step,
        x: Math.round(source.x + (target.x - source.x) * ratio),
        y: Math.round(source.y + (target.y - source.y) * ratio),
      };
    }),
    ai: {
      status: "adopted",
      reason: item.raw,
      evidence: item.anchorEvidence ?? [item.filePath],
      confidence,
      alternatives: (item.anchorAlternatives ?? []).map((candidate) => ({
        id: candidate.id,
        reason: candidate.reason,
        confidence: candidate.confidence,
      })),
      createdAt: now,
      adoptedAt: now,
    },
  };
}

function pendingModuleRelation(item: PendingMention, module: BridgeModule, now: number): KnowledgeRelation {
  const confidence = item.candidates?.[0]?.confidence ?? 0.5;
  return {
    id: `pending-module-relation:${item.id}`,
    source: module.sourceId!,
    target: module.targetId!,
    label: module.title,
    layer: "cognitive",
    cognitiveKind: "explanation",
    status: "pending",
    bridgeModuleId: module.id,
    confidence,
    context: item.filePath,
    ai: {
      status: "adopted",
      reason: item.raw,
      evidence: item.anchorEvidence ?? [item.filePath],
      confidence,
      alternatives: (item.anchorAlternatives ?? []).map((candidate) => ({
        id: candidate.id,
        reason: candidate.reason,
        confidence: candidate.confidence,
      })),
      createdAt: now,
      adoptedAt: now,
    },
  };
}

/** Resolve one pending item without promoting it to formal scientific truth. */
export function applyPendingResolution(snapshot: VaultSnapshot, resolution: PendingResolution): VaultSnapshot {
  const item = snapshot.pending.find((entry) => entry.id === resolution.pendingId);
  if (!item) return snapshot;
  if (resolution.action === "dismiss") return { ...snapshot, pending: withoutPending(snapshot, item.id) };
  if (resolution.action === "lineage-defer") {
    return {
      ...snapshot,
      pending: snapshot.pending.map((entry) =>
        entry.id === item.id ? { ...entry, deferredAt: resolution.now } : entry,
      ),
    };
  }
  if (resolution.action === "lineage-rebind") {
    if (item.kind !== "lineage" || !resolution.candidateId) return snapshot;
    const candidate = snapshot.nodes.find((node) => node.id === resolution.candidateId);
    if (!candidate) return snapshot;
    return {
      ...snapshot,
      nodes: snapshot.nodes.map((node) =>
        node.id === candidate.id
          ? {
              ...node,
              path: item.filePath,
              detailsMarkdown: resolution.sourceMarkdown ?? node.detailsMarkdown,
              status: node.status === "missing-source" ? "formal" : node.status,
            }
          : node,
      ),
      pending: withoutPending(snapshot, item.id),
    };
  }
  if (resolution.action === "lineage-new") {
    if (item.kind !== "lineage" || !resolution.newNodeId) return snapshot;
    if (snapshot.nodes.some((node) => node.id === resolution.newNodeId)) return snapshot;
    return {
      ...snapshot,
      nodes: [
        ...snapshot.nodes,
        createTargetNode(snapshot, item, resolution.newNodeId, resolution.now, resolution.sourceMarkdown),
      ],
      pending: withoutPending(snapshot, item.id),
    };
  }
  if (item.kind === "lineage" || item.kind === "scale-gap" || item.kind === "severed-link") return snapshot;

  if (item.kind === "ai-bridge" && item.bridgeModule) {
    const module = createPendingBridgeModule(snapshot, item, resolution.now);
    if (!module) return snapshot;
    const bridgeModules = snapshot.bridgeModules?.some((entry) => entry.id === module.id)
      ? snapshot.bridgeModules
      : [...(snapshot.bridgeModules ?? []), module];
    const relation = pendingModuleRelation(item, module, resolution.now);
    const relations = snapshot.relations.some((entry) => entry.id === relation.id)
      ? snapshot.relations
      : [...snapshot.relations, relation];
    return { ...snapshot, bridgeModules, relations, pending: withoutPending(snapshot, item.id) };
  }

  const existing = findTarget(snapshot, item);
  const targetId = existing?.id ?? resolution.newNodeId;
  if (!targetId) return snapshot;
  const target = existing ?? createTargetNode(snapshot, item, targetId, resolution.now);
  const nodes = existing ? snapshot.nodes : [...snapshot.nodes, target];
  const relation = pendingRelation({ ...snapshot, nodes }, item, target, resolution.now);
  let relations =
    relation && !snapshot.relations.some((existingRelation) => existingRelation.id === relation.id)
      ? [...snapshot.relations, relation]
      : snapshot.relations;
  const anchorRelation = pendingAnchorRelation({ ...snapshot, nodes, relations }, item, target, resolution.now);
  if (anchorRelation && !relations.some((existingRelation) => existingRelation.id === anchorRelation.id)) {
    relations = [...relations, anchorRelation];
  }
  return { ...snapshot, nodes, relations, pending: withoutPending(snapshot, item.id) };
}

/** Persist a deliberate lineage choice into Markdown before committing the graph binding. */
export async function writeLineageBinding(
  adapter: VaultAdapter,
  item: PendingMention,
  nodeId: string,
): Promise<{ path: string; before: string; after: string }> {
  if (item.kind !== "lineage") throw new Error("Only lineage items can bind a source file.");
  const before = await adapter.read(item.filePath);
  const after = upsertKbId(before, nodeId);
  if (after !== before) await adapter.write(item.filePath, after);
  return { path: item.filePath, before, after };
}
