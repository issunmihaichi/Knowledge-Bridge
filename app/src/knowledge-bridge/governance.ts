import type {
  FrozenL2MigrationPreview,
  FrozenPath,
  KnowledgeNode,
  KnowledgeRelation,
  MigrationCandidate,
  MigrationRecord,
  VaultSnapshot,
} from "./model";

const NO_INFORMATION = /^(?:n\/?a|none|unknown|tbd|todo|暂无|待定|无)$/iu;

function isInformative(value?: string): boolean {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 8 && !NO_INFORMATION.test(normalized);
}

function getNode(snapshot: VaultSnapshot, id: string): KnowledgeNode | undefined {
  return snapshot.nodes.find((node) => node.id === id);
}

function hasReasoningSource(snapshot: VaultSnapshot, relation: KnowledgeRelation): boolean {
  return [relation.source, relation.target].every((id) => {
    const node = getNode(snapshot, id);
    return Boolean(node && node.status !== "missing-source");
  });
}

function isActiveLogical(relation: KnowledgeRelation): boolean {
  return relation.layer === "logical" && relation.status !== "severed" && relation.status !== "historical";
}

export interface L2AdmissionReport {
  l2Id: string;
  qualified: boolean;
  independentPathCount: number;
  reasons: string[];
  similarMechanisms: Array<{ id: string; title: string; overlap: number }>;
}

/**
 * L2 promotion is deliberately only an evaluation. A caller must still make a
 * separate, versioned user confirmation before changing the node to formal.
 */
export function evaluateL2Admission(snapshot: VaultSnapshot, l2Id: string): L2AdmissionReport {
  const node = getNode(snapshot, l2Id);
  if (!node || node.role !== "L2") {
    return { l2Id, qualified: false, independentPathCount: 0, reasons: ["目标不是 L2 节点"], similarMechanisms: [] };
  }

  const independentPaths = new Set(collectFrozenPaths(snapshot, l2Id).map((path) => `${path.l1Id}:${path.l3Id}`));

  const titleTerms = new Set(node.title.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  const similarMechanisms = snapshot.nodes
    .filter((candidate) => candidate.id !== node.id && candidate.role === "L2")
    .map((candidate) => {
      const candidateTerms = candidate.title.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
      return {
        id: candidate.id,
        title: candidate.title,
        overlap: candidateTerms.filter((term) => titleTerms.has(term)).length,
      };
    })
    .filter((candidate) => candidate.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap);

  const reasons: string[] = [];
  if (independentPaths.size < 2) reasons.push("至少需要两条不同的 L1-L3 桥接路径");
  if (!isInformative(node.definition)) reasons.push("需要可检验的机制定义，不能使用“暂无”等占位内容");
  if (!isInformative(node.boundary)) reasons.push("需要说明适用边界");
  if (similarMechanisms.length > 0) reasons.push("存在相似 L2，需完成替代比较后才能晋升");
  if (reasons.length === 0) reasons.push("满足路径、定义、边界和非冗余检查；仍等待用户复核");

  return {
    l2Id,
    qualified:
      independentPaths.size >= 2 &&
      isInformative(node.definition) &&
      isInformative(node.boundary) &&
      similarMechanisms.length === 0,
    independentPathCount: independentPaths.size,
    reasons,
    similarMechanisms,
  };
}

export function transitionL3(
  snapshot: VaultSnapshot,
  nodeId: string,
  lifecycle: NonNullable<KnowledgeNode["l3Lifecycle"]>,
): VaultSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) =>
      node.id === nodeId && node.role === "L3" ? { ...node, l3Lifecycle: lifecycle } : node,
    ),
  };
}

export function adoptAiDraft(snapshot: VaultSnapshot, relationId: string, now = Date.now()): VaultSnapshot {
  return {
    ...snapshot,
    relations: snapshot.relations.map((relation) =>
      relation.id === relationId && relation.ai
        ? { ...relation, ai: { ...relation.ai, status: "adopted", adoptedAt: now } }
        : relation,
    ),
  };
}

function hasCompleteScaleProtocol(relation: KnowledgeRelation, snapshot: VaultSnapshot): boolean {
  const protocol = relation.scaleProtocolId
    ? snapshot.protocols.find((item) => item.id === relation.scaleProtocolId)
    : undefined;
  return protocol?.status === "confirmed" && protocol.mechanismSteps.length > 0;
}

export function normalizeCrossScaleRelation(relation: KnowledgeRelation, snapshot: VaultSnapshot): KnowledgeRelation {
  if (relation.reasoningKind !== "cross-scale") return relation;
  if (hasCompleteScaleProtocol(relation, snapshot)) {
    return relation.crossScaleStrength ? relation : { ...relation, crossScaleStrength: "strong" };
  }
  return {
    ...relation,
    status: relation.status === "formal" ? "pending" : relation.status,
    crossScaleStrength: "observation",
  };
}

/** Enforce scale governance for every backend mutation, regardless of origin. */
export function enforceCrossScaleGovernance(snapshot: VaultSnapshot): VaultSnapshot {
  let changed = false;
  const missingProtocolIds = new Set<string>();
  const relations = snapshot.relations.map((relation) => {
    const normalized = normalizeCrossScaleRelation(relation, snapshot);
    if (normalized !== relation) changed = true;
    if (
      normalized.reasoningKind === "cross-scale" &&
      normalized.status !== "severed" &&
      normalized.status !== "historical" &&
      normalized.status !== "frozen" &&
      !hasCompleteScaleProtocol(normalized, snapshot)
    ) {
      missingProtocolIds.add(normalized.id);
    }
    return normalized;
  });
  let pending = snapshot.pending.filter((item) => {
    if (item.kind !== "scale-gap") return true;
    const keep = missingProtocolIds.has(item.id.replace(/^scale-gap:/, ""));
    if (!keep) changed = true;
    return keep;
  });
  for (const relation of relations) {
    if (!missingProtocolIds.has(relation.id)) continue;
    const id = `scale-gap:${relation.id}`;
    if (pending.some((item) => item.id === id)) continue;
    pending = [
      ...pending,
      {
        id,
        filePath: relation.context ?? ".knowledge-bridge/scale-gaps",
        sourceId: relation.source,
        targetTitle: `尺度鸿沟：${relation.label}`,
        kind: "scale-gap",
        raw: "缺少已确认且含中间机制步骤的尺度换算协议；当前关系仅作为观察相关保存。",
      },
    ];
    changed = true;
  }
  return changed ? { ...snapshot, relations, pending } : snapshot;
}

/** A frozen L2 is a historical summary and cannot acquire visible connections. */
export function enforceFrozenL2Governance(snapshot: VaultSnapshot): VaultSnapshot {
  const frozenIds = new Set(
    snapshot.nodes.filter((node) => node.role === "L2" && node.status === "frozen").map((node) => node.id),
  );
  if (frozenIds.size === 0) return snapshot;
  let changed = false;
  const relations = snapshot.relations.map((relation) => {
    if (!frozenIds.has(relation.source) && !frozenIds.has(relation.target)) return relation;
    if (relation.status === "severed" || relation.status === "historical" || relation.status === "frozen") {
      return relation;
    }
    changed = true;
    return { ...relation, status: "frozen" as const };
  });
  return changed ? { ...snapshot, relations } : snapshot;
}

export interface RelationBundle {
  source: string;
  target: string;
  relations: KnowledgeRelation[];
  logical: KnowledgeRelation[];
  cognitive: KnowledgeRelation[];
  /** Total cognitive relations on this node pair, including the visible one for a cognitive-only pair. */
  cognitiveCount: number;
  /** Cognitive relations intentionally omitted from the default canvas projection. */
  hiddenCognitiveCount: number;
  primary?: KnowledgeRelation;
  label?: string;
}

function isRenderableRelation(relation: KnowledgeRelation): boolean {
  return relation.status !== "severed" && relation.status !== "historical" && relation.status !== "frozen";
}

/**
 * The explicitly supplied weight wins. The fallback preserves a useful stable
 * order for imported data that predates relation weights.
 */
export function relationDisplayWeight(relation: KnowledgeRelation): number {
  if (typeof relation.weight === "number") return Math.max(0, Math.min(1, relation.weight));
  const confidence = typeof relation.confidence === "number" ? Math.max(0, Math.min(1, relation.confidence)) * 0.18 : 0;
  const status = relation.status === "formal" ? 0.64 : relation.status === "frozen" ? 0.46 : 0.26;
  const logical = relation.layer === "logical" ? 0.08 : 0;
  const decisiveKind = relation.kind === "causality" ? 0.08 : relation.kind ? 0.05 : 0;
  const reasoning = relation.reasoningKind ? 0.03 : 0;
  return Math.min(1, status + confidence + logical + decisiveKind + reasoning);
}

function buildRelationBundle(source: string, target: string, relations: KnowledgeRelation[]): RelationBundle {
  const logical = relations.filter((relation) => relation.layer === "logical");
  const cognitive = relations.filter((relation) => relation.layer === "cognitive");
  const byDisplayWeight = (left: KnowledgeRelation, right: KnowledgeRelation) => {
    const difference = relationDisplayWeight(right) - relationDisplayWeight(left);
    if (difference !== 0) return difference;
    return left.id.localeCompare(right.id);
  };
  const orderedLogical = [...logical].sort(byDisplayWeight);
  const orderedCognitive = [...cognitive].sort(byDisplayWeight);
  // Logical meaning always wins the default projection. Cognitive scaffolding
  // remains inspectable in the bundle but cannot obscure or replace it.
  const primary = orderedLogical[0] ?? orderedCognitive[0];
  const cognitiveCount = cognitive.length;
  const hiddenCognitiveCount = logical.length > 0 ? cognitive.length : Math.max(0, cognitive.length - 1);
  if (logical.length <= 1) {
    return { source, target, relations, logical, cognitive, cognitiveCount, hiddenCognitiveCount, primary };
  }
  const outcome = logical.some((relation) => relation.logicalOutcome === "conflicting")
    ? "冲突"
    : logical.some((relation) => relation.logicalOutcome === "conditional")
      ? "条件分支"
      : "兼容";
  return {
    source,
    target,
    relations,
    logical,
    cognitive,
    cognitiveCount,
    hiddenCognitiveCount,
    primary,
    label: `${outcome} ×${logical.length}`,
  };
}

/**
 * A node pair produces exactly one default canvas edge. All relations remain
 * in the bundle for details and auditing, but cognitive scaffolding is hidden
 * whenever logical meaning exists on the same pair.
 */
export function bundleRelations(snapshot: VaultSnapshot, source: string, target: string): RelationBundle {
  const relations = snapshot.relations.filter(
    (relation) => relation.source === source && relation.target === target && isRenderableRelation(relation),
  );
  return buildRelationBundle(source, target, relations);
}

export function relationBundles(snapshot: VaultSnapshot): RelationBundle[] {
  const pairs = new Map<string, KnowledgeRelation[]>();
  for (const relation of snapshot.relations) {
    if (!isRenderableRelation(relation)) continue;
    const [first, second] = [relation.source, relation.target].sort((left, right) => left.localeCompare(right));
    const key = `${first}\u0000${second}`;
    const pair = pairs.get(key) ?? [];
    pair.push(relation);
    pairs.set(key, pair);
  }
  return [...pairs.values()].map((relations) => {
    const representative = relations[0];
    return buildRelationBundle(representative?.source ?? "", representative?.target ?? "", relations);
  });
}

export function collectFrozenPaths(snapshot: VaultSnapshot, l2Id: string): FrozenPath[] {
  const inbound = snapshot.relations.filter(
    (relation) =>
      isActiveLogical(relation) &&
      hasReasoningSource(snapshot, relation) &&
      relation.target === l2Id &&
      getNode(snapshot, relation.source)?.role === "L1",
  );
  const outbound = snapshot.relations.filter(
    (relation) =>
      isActiveLogical(relation) &&
      hasReasoningSource(snapshot, relation) &&
      relation.source === l2Id &&
      getNode(snapshot, relation.target)?.role === "L3",
  );
  const pairs: Array<[KnowledgeRelation, KnowledgeRelation]> = [];
  const seen = new Set<string>();
  const appendPair = (left: KnowledgeRelation, right: KnowledgeRelation) => {
    const key = `${left.id}\u0000${right.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([left, right]);
  };

  for (const left of inbound) {
    for (const right of outbound) {
      const samePath = left.bridgePathId && left.bridgePathId === right.bridgePathId;
      const sameContext = !left.bridgePathId && !right.bridgePathId && left.context && left.context === right.context;
      if (samePath || sameContext) appendPair(left, right);
    }
  }
  if (inbound.length === 1) for (const right of outbound) appendPair(inbound[0], right);
  if (outbound.length === 1) for (const left of inbound) appendPair(left, outbound[0]);

  return pairs.map(([left, right]) => ({
    id: left.bridgePathId ?? right.bridgePathId ?? `${l2Id}:${left.source}:${right.target}:${left.id}:${right.id}`,
    l1Id: left.source,
    l3Id: right.target,
    relationIds: [left.id, right.id],
    family:
      [left.context, right.context]
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(" / ") || "未设条件",
  }));
}

export function freezeL2(snapshot: VaultSnapshot, l2Id: string): VaultSnapshot {
  return enforceFrozenL2Governance({
    ...snapshot,
    nodes: snapshot.nodes.map((node) => (node.id === l2Id ? { ...node, status: "frozen" } : node)),
  });
}

function relationConnects(snapshot: VaultSnapshot, source: string, target: string): boolean {
  return snapshot.relations.some(
    (relation) =>
      relation.source === source &&
      relation.target === target &&
      relation.layer === "logical" &&
      relation.status === "formal" &&
      hasReasoningSource(snapshot, relation),
  );
}

function rankReplacement(snapshot: VaultSnapshot, path: FrozenPath, candidate: KnowledgeNode): MigrationCandidate {
  const l1Coverage = relationConnects(snapshot, path.l1Id, candidate.id) ? 0.38 : 0;
  const l3Coverage = relationConnects(snapshot, candidate.id, path.l3Id) ? 0.38 : 0;
  const contextScore = candidate.scope?.includes(path.family) ? 0.12 : 0;
  const confidence = Math.min(0.96, 0.18 + l1Coverage + l3Coverage + contextScore);
  const conflict = confidence < 0.8 ? "缺少已复核的完整替代路径" : undefined;
  return {
    l2Id: candidate.id,
    confidence,
    reason: "依据现有正式路径、适用范围和条件匹配生成；未新增不存在的路径。",
    semanticLoss: confidence >= 0.8 ? "low" : confidence >= 0.55 ? "medium" : "high",
    conditionChange: path.family === "未设条件" ? undefined : `保留条件：${path.family}`,
    conflict,
  };
}

export function buildFrozenL2MigrationPreview(
  snapshot: VaultSnapshot,
  frozenL2Id: string,
  now = Date.now(),
): FrozenL2MigrationPreview {
  const candidates = snapshot.nodes.filter(
    (node) => node.role === "L2" && node.id !== frozenL2Id && node.status === "formal",
  );
  return {
    id: `migration-preview:${frozenL2Id}:${now}`,
    frozenL2Id,
    createdAt: now,
    paths: collectFrozenPaths(snapshot, frozenL2Id).map((path) => ({
      path,
      candidates: candidates
        .map((candidate) => rankReplacement(snapshot, path, candidate))
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, 3),
    })),
  };
}

function migratedRelation(
  id: string,
  source: string,
  target: string,
  label: string,
  bridgePathId: string,
): KnowledgeRelation {
  return {
    id,
    source,
    target,
    label,
    layer: "logical",
    status: "formal",
    kind: "structure",
    logicalOutcome: "compatible",
    bridgePathId,
  };
}

export function applyHighConfidenceMigration(
  snapshot: VaultSnapshot,
  preview: FrozenL2MigrationPreview,
  allowedPathIds: Set<string> = new Set(preview.paths.map((entry) => entry.path.id)),
  now = Date.now(),
): VaultSnapshot {
  const mappings = preview.paths.flatMap((entry) => {
    const best = entry.candidates[0];
    return allowedPathIds.has(entry.path.id) && best && best.confidence >= 0.8 && !best.conflict
      ? [{ path: entry.path, replacementL2Id: best.l2Id }]
      : [];
  });
  const recordId = `migration:${preview.frozenL2Id}:${now}`;
  const relations = [...snapshot.relations];
  for (const mapping of mappings) {
    if (!relationConnects({ ...snapshot, relations }, mapping.path.l1Id, mapping.replacementL2Id)) {
      relations.push(
        migratedRelation(
          `${recordId}:${mapping.path.id}:in`,
          mapping.path.l1Id,
          mapping.replacementL2Id,
          "替代桥接",
          `${recordId}:${mapping.path.id}`,
        ),
      );
    }
    if (!relationConnects({ ...snapshot, relations }, mapping.replacementL2Id, mapping.path.l3Id)) {
      relations.push(
        migratedRelation(
          `${recordId}:${mapping.path.id}:out`,
          mapping.replacementL2Id,
          mapping.path.l3Id,
          "替代桥接",
          `${recordId}:${mapping.path.id}`,
        ),
      );
    }
  }
  const record: MigrationRecord = {
    id: recordId,
    frozenL2Id: preview.frozenL2Id,
    previewId: preview.id,
    pathMappings: mappings.map((mapping) => ({ pathId: mapping.path.id, replacementL2Id: mapping.replacementL2Id })),
    operator: "user",
    reason: "用户应用高置信且无冲突的替代建议",
    createdAt: now,
  };
  return { ...snapshot, relations, migrationRecords: [...snapshot.migrationRecords, record] };
}
