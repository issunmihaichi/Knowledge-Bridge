import type {
  FrozenL2MigrationPreview,
  FrozenPath,
  KnowledgeNode,
  KnowledgeRelation,
  MigrationCandidate,
  MigrationRecord,
  RelationStatus,
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

  const inbound = snapshot.relations.filter(
    (relation) =>
      isActiveLogical(relation) && relation.target === l2Id && getNode(snapshot, relation.source)?.role === "L1",
  );
  const outbound = snapshot.relations.filter(
    (relation) =>
      isActiveLogical(relation) && relation.source === l2Id && getNode(snapshot, relation.target)?.role === "L3",
  );
  const independentPaths = new Set<string>();
  for (const left of inbound) {
    for (const right of outbound) independentPaths.add(`${left.source}:${right.target}`);
  }

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

export function normalizeCrossScaleRelation(relation: KnowledgeRelation, snapshot: VaultSnapshot): KnowledgeRelation {
  if (relation.reasoningKind !== "cross-scale") return relation;
  const protocol = relation.scaleProtocolId
    ? snapshot.protocols.find((item) => item.id === relation.scaleProtocolId)
    : undefined;
  if (protocol?.status === "confirmed" && protocol.mechanismSteps.length > 0) return relation;
  return {
    ...relation,
    status: relation.status === "formal" ? "pending" : relation.status,
  };
}

export interface RelationBundle {
  source: string;
  target: string;
  relations: KnowledgeRelation[];
  logical: KnowledgeRelation[];
  cognitive: KnowledgeRelation[];
  cognitiveCount: number;
  primary?: KnowledgeRelation;
  secondary: KnowledgeRelation[];
  label?: string;
}

function isRenderableRelation(relation: KnowledgeRelation): boolean {
  return relation.status !== "severed" && relation.status !== "historical";
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
  const ordered = [...relations].sort((left, right) => {
    const difference = relationDisplayWeight(right) - relationDisplayWeight(left);
    if (difference !== 0) return difference;
    return left.id.localeCompare(right.id);
  });
  const primary = ordered[0];
  const secondary = ordered.slice(1);
  const cognitiveCount = cognitive.length;
  if (logical.length === 0) return { source, target, relations, logical, cognitive, cognitiveCount, primary, secondary };
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
    primary,
    secondary,
    label: `${outcome} ×${logical.length}`,
  };
}

/**
 * One relation remains visually decisive, but every other relation stays in
 * the bundle as an expandable secondary edge. No layer is silently discarded.
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
    const ordered = [...relations].sort((left, right) => {
      const difference = relationDisplayWeight(right) - relationDisplayWeight(left);
      if (difference !== 0) return difference;
      return left.id.localeCompare(right.id);
    });
    const primary = ordered[0];
    return buildRelationBundle(primary?.source ?? "", primary?.target ?? "", relations);
  });
}

export function collectFrozenPaths(snapshot: VaultSnapshot, l2Id: string): FrozenPath[] {
  const inbound = snapshot.relations.filter(
    (relation) =>
      isActiveLogical(relation) && relation.target === l2Id && getNode(snapshot, relation.source)?.role === "L1",
  );
  const outbound = snapshot.relations.filter(
    (relation) =>
      isActiveLogical(relation) && relation.source === l2Id && getNode(snapshot, relation.target)?.role === "L3",
  );
  return inbound.flatMap((left) =>
    outbound.map((right) => ({
      id: `${l2Id}:${left.source}:${right.target}`,
      l1Id: left.source,
      l3Id: right.target,
      relationIds: [left.id, right.id],
      family: [left.context, right.context].filter(Boolean).join(" / ") || "未设条件",
    })),
  );
}

export function freezeL2(snapshot: VaultSnapshot, l2Id: string): VaultSnapshot {
  const paths = collectFrozenPaths(snapshot, l2Id);
  const frozenRelationIds = new Set(paths.flatMap((path) => path.relationIds));
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => (node.id === l2Id ? { ...node, status: "frozen" } : node)),
    relations: snapshot.relations.map((relation) =>
      frozenRelationIds.has(relation.id) && relation.status === "formal"
        ? { ...relation, status: "frozen" as RelationStatus }
        : relation,
    ),
  };
}

function relationConnects(snapshot: VaultSnapshot, source: string, target: string): boolean {
  return snapshot.relations.some(
    (relation) =>
      relation.source === source &&
      relation.target === target &&
      relation.layer === "logical" &&
      relation.status === "formal",
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

function migratedRelation(id: string, source: string, target: string, label: string): KnowledgeRelation {
  return {
    id,
    source,
    target,
    label,
    layer: "logical",
    status: "formal",
    kind: "structure",
    logicalOutcome: "compatible",
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
        migratedRelation(`${recordId}:${mapping.path.id}:in`, mapping.path.l1Id, mapping.replacementL2Id, "替代桥接"),
      );
    }
    if (!relationConnects({ ...snapshot, relations }, mapping.replacementL2Id, mapping.path.l3Id)) {
      relations.push(
        migratedRelation(`${recordId}:${mapping.path.id}:out`, mapping.replacementL2Id, mapping.path.l3Id, "替代桥接"),
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
