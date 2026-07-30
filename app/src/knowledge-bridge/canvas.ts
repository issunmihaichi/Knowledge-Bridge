import type { Project } from "@/core/Project";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { DetailsManager } from "@/core/stage/stageObject/tools/entityDetailsManager";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { collectFrozenPaths, relationBundles, type RelationBundle } from "./governance";
import { shouldApplyLedgerPosition } from "./canvasPosition";
import type { BridgeModule, BridgeModuleStep, KnowledgeNode, KnowledgeRelation, VaultSnapshot } from "./model";
import type { BridgeModulePosition, KnowledgeNodeDetails, KnowledgeNodePosition } from "./operations";
import { projectSemanticZoom } from "./semanticZoom";
import { buildKnowledgeSpatialIndex, queryKnowledgeSpatialIndex, type KnowledgeSpatialIndex } from "./spatialIndex";

type ManagedKnowledgeGraph = {
  signature: string;
  snapshot: VaultSnapshot;
  nodes: Map<string, TextNode>;
  baseNodeIds: Set<string>;
  edges: Array<{ edge: LineEdge; sourceId: string; targetId: string; relation?: KnowledgeRelation }>;
  mountedNodeIds: Set<string>;
  mountedEdgeIds: Set<string>;
  ledgerPositions: Map<string, { x: number; y: number }>;
  spatialIndex: KnowledgeSpatialIndex;
};

type BridgeCanvasEntity = {
  id: string;
  module: BridgeModule;
  step?: BridgeModuleStep;
  kind: "header" | "step";
  x: number;
  y: number;
};

const managedGraphs = new WeakMap<Project, ManagedKnowledgeGraph>();

const roleColors: Record<KnowledgeNode["role"], Color> = {
  L1: new Color(23, 129, 173, 0.94),
  L2: new Color(35, 141, 104, 0.94),
  L3: new Color(86, 99, 132, 0.86),
  L4: new Color(129, 89, 163, 0.9),
};

const roleAlpha: Record<KnowledgeNode["role"], number> = { L1: 0.94, L2: 0.94, L3: 0.86, L4: 0.9 };
const MAX_INITIAL_NODES = 700;

function canvasSignature(snapshot: VaultSnapshot): string {
  return JSON.stringify({
    nodes: snapshot.nodes,
    relations: snapshot.relations,
    bridgeModules: snapshot.bridgeModules ?? [],
  });
}

function titleFor(node: KnowledgeNode): string {
  if (node.status === "frozen") return `${node.role}  ${node.title}  ·  历史路径 ×${node.hiddenCount ?? 0}`;
  if (node.status === "missing-source") return `${node.role}  ${node.title}  ·  来源缺失`;
  return `${node.role}  ${node.title}`;
}

function nodeColor(node: KnowledgeNode, opacity = 1): Color {
  if (node.status === "frozen") return new Color(128, 132, 141, 0.72 * opacity);
  const alpha = node.status === "missing-source" ? 0.32 : roleAlpha[node.role];
  return roleColors[node.role].toNewAlpha(alpha * opacity);
}

function bridgeEntityId(moduleId: string, stepId?: string): string {
  return stepId ? `kb:bridge-step:${moduleId}:${stepId}` : `kb:bridge-module:${moduleId}:header`;
}

function bridgeEntityTitle(entity: BridgeCanvasEntity): string {
  if (entity.kind === "header") return `L2 模块  ${entity.module.title}  ·  ${entity.module.steps.length} 步`;
  const label =
    entity.step?.kind === "mapping"
      ? "映射"
      : entity.step?.kind === "mechanism"
        ? "机制"
        : entity.step?.kind === "constraint"
          ? "边界"
          : "尺度";
  return `L2 · ${label}  ${entity.step?.title ?? "桥梁步骤"}`;
}

function bridgeEntityColor(entity: BridgeCanvasEntity): Color {
  const opacity = entity.module.status === "pending" ? 0.72 : 0.94;
  if (entity.module.status === "frozen") return new Color(128, 132, 141, 0.7);
  if (entity.kind === "header") return new Color(30, 120, 105, opacity);
  if (entity.step?.kind === "mapping") return new Color(43, 127, 180, opacity);
  if (entity.step?.kind === "constraint") return new Color(187, 133, 51, opacity);
  if (entity.step?.kind === "scale-transition") return new Color(117, 104, 204, opacity);
  return new Color(35, 141, 104, opacity);
}

function bridgeEntityDetails(entity: BridgeCanvasEntity): string {
  if (entity.kind === "header") {
    const lines = [`# ${entity.module.title}`, "", entity.module.definition ?? "待补充桥梁模块定义。"];
    if (entity.module.scope) lines.push("", "## 适用范围", "", entity.module.scope);
    if (entity.module.boundary) lines.push("", "## 边界", "", entity.module.boundary);
    lines.push("", "## 步骤", "", ...entity.module.steps.map((step, index) => `${index + 1}. ${step.title}`));
    return lines.join("\n");
  }
  const step = entity.step!;
  const lines = [`# ${step.title}`, "", step.explanation];
  if (step.definition) lines.push("", "## 定义", "", step.definition);
  if (step.boundary) lines.push("", "## 边界", "", step.boundary);
  if (step.evidence?.length) lines.push("", "## 证据线索", "", ...step.evidence.map((evidence) => `- ${evidence}`));
  return lines.join("\n");
}

function bridgeCanvasEntities(snapshot: VaultSnapshot): BridgeCanvasEntity[] {
  return (snapshot.bridgeModules ?? []).flatMap((module) => {
    const header: BridgeCanvasEntity = {
      id: bridgeEntityId(module.id),
      module,
      kind: "header",
      x: module.x,
      y: module.y,
    };
    if (module.collapsed) return [header];
    return [
      header,
      ...module.steps.map((step) => ({
        id: bridgeEntityId(module.id, step.id),
        module,
        step,
        kind: "step" as const,
        x: step.x,
        y: step.y,
      })),
    ];
  });
}

function detailsFor(node: KnowledgeNode): string {
  if (node.detailsMarkdown !== undefined) return node.detailsMarkdown;
  const lines = [`# ${node.title}`, "", node.content];
  if (node.definition) lines.push("", "## 定义", "", node.definition);
  if (node.scope) lines.push("", "## 适用范围", "", node.scope);
  if (node.boundary) lines.push("", "## 边界", "", node.boundary);
  if (node.status === "frozen") lines.push("", "## 状态", "", "该节点已逻辑冻结；历史关系仅供回溯。");
  return lines.join("\n");
}

function projectedNode(snapshot: VaultSnapshot, item: KnowledgeNode): KnowledgeNode {
  return item.status === "frozen" ? { ...item, hiddenCount: collectFrozenPaths(snapshot, item.id).length } : item;
}

function primaryColor(relation: KnowledgeRelation): Color {
  if (relation.logicalOutcome === "conflicting") return new Color(222, 80, 80, 0.96);
  if (relation.reasoningKind === "argument") return new Color(211, 132, 67, 0.96);
  if (relation.reasoningKind === "cross-scale") return new Color(117, 104, 204, 0.96);
  if (relation.kind === "causality") return new Color(50, 171, 110, 0.96);
  if (relation.kind === "temporal") return new Color(206, 157, 58, 0.96);
  if (relation.layer === "cognitive") return new Color(112, 126, 146, 0.92);
  return new Color(51, 142, 188, 0.96);
}

function bundleHasEvidenceTension(bundle: RelationBundle): boolean {
  const directions = new Set(
    bundle.relations.flatMap((relation) => relation.evidence ?? []).map((item) => item.direction),
  );
  return directions.has("mixed") || (directions.has("supports") && directions.has("challenges"));
}

function evidenceTensionLabel(bundle: RelationBundle): string | undefined {
  if (!bundleHasEvidenceTension(bundle)) return undefined;
  const readings = bundle.relations.flatMap((relation) => relation.evidence ?? []);
  const supports = [...new Set(readings.filter((item) => item.direction !== "challenges").map((item) => item.level))];
  const challenges = [...new Set(readings.filter((item) => item.direction !== "supports").map((item) => item.level))];
  return [
    supports.length ? `${supports.join(";")} 支持` : undefined,
    challenges.length ? `${challenges.join(";")} 反驳` : undefined,
  ]
    .filter(Boolean)
    .join(" / ");
}

function primaryLabel(bundle: RelationBundle, relation: KnowledgeRelation): string {
  const tension = evidenceTensionLabel(bundle);
  if (tension) return bundle.label ? `${bundle.label} · ${tension}` : tension;
  return bundle.label ? `${bundle.label} · ${relation.label}` : relation.label;
}

function addEdge(
  project: Project,
  source: TextNode,
  target: TextNode,
  relation: KnowledgeRelation,
  bundle: RelationBundle,
): LineEdge {
  const edge = new LineEdge(project, {
    uuid: `kb:relation:bundle:${relation.id}`,
    associationList: [source, target],
    text: primaryLabel(bundle, relation),
    color: primaryColor(relation),
    lineType: bundleHasEvidenceTension(bundle)
      ? "knowledge-bridge-tension"
      : relation.layer === "cognitive"
        ? "dashed"
        : "solid",
    arrowType: "none",
  });
  project.stageManager.add(edge, true);
  return edge;
}

function addModuleEdge(project: Project, source: TextNode, target: TextNode, uuid: string, text: string): LineEdge {
  const edge = new LineEdge(project, {
    uuid,
    associationList: [source, target],
    text,
    color: new Color(35, 141, 104, 0.9),
    lineType: "solid",
    arrowType: "none",
  });
  project.stageManager.add(edge, true);
  return edge;
}

function createNode(project: Project, item: KnowledgeNode): TextNode {
  return new TextNode(project, {
    uuid: `kb:node:${item.id}`,
    text: titleFor(item),
    collisionBox: new CollisionBox([new Rectangle(new Vector(item.x, item.y), Vector.getZero())]),
    color: nodeColor(item),
    fontScaleLevel: item.role === "L1" ? 0 : -1,
    details: DetailsManager.markdownToDetails(detailsFor(item)),
    openDetailsOnClick: true,
  });
}

function createBridgeEntity(project: Project, entity: BridgeCanvasEntity): TextNode {
  return new TextNode(project, {
    uuid: entity.id,
    text: bridgeEntityTitle(entity),
    collisionBox: new CollisionBox([new Rectangle(new Vector(entity.x, entity.y), Vector.getZero())]),
    color: bridgeEntityColor(entity),
    fontScaleLevel: -1,
    details: DetailsManager.markdownToDetails(bridgeEntityDetails(entity)),
    openDetailsOnClick: true,
  });
}

function updateBridgeEntity(node: TextNode, entity: BridgeCanvasEntity): void {
  node.text = bridgeEntityTitle(entity);
  node.color = bridgeEntityColor(entity);
  node.details = DetailsManager.markdownToDetails(bridgeEntityDetails(entity));
  node.openDetailsOnClick = true;
  node.setFontScaleLevel(-1);
  node.moveTo(new Vector(entity.x, entity.y));
}

function updateNode(
  node: TextNode,
  item: KnowledgeNode,
  previousLedgerPosition: { x: number; y: number } | undefined,
): void {
  node.text = titleFor(item);
  node.color = nodeColor(item);
  node.details = DetailsManager.markdownToDetails(detailsFor(item));
  node.openDetailsOnClick = true;
  node.setFontScaleLevel(item.role === "L1" ? 0 : -1);

  const ledgerPosition = { x: item.x, y: item.y };
  const canvasPosition = node.rectangle.location;
  if (shouldApplyLedgerPosition(ledgerPosition, canvasPosition, previousLedgerPosition)) {
    node.moveTo(new Vector(item.x, item.y));
  }
}

function viewportNodeIds(project: Project, managedIndex: KnowledgeSpatialIndex): Set<string> {
  const scale = Math.max(project.camera.currentScale, 0.0001);
  return queryKnowledgeSpatialIndex(
    managedIndex,
    {
      centerX: project.camera.location.x,
      centerY: project.camera.location.y,
      width: project.renderer.w > 0 ? project.renderer.w / scale : 2_400,
      height: project.renderer.h > 0 ? project.renderer.h / scale : 1_600,
    },
    MAX_INITIAL_NODES,
  );
}

function rebuildManagedEdges(project: Project, managed: ManagedKnowledgeGraph): void {
  for (const { edge } of managed.edges) project.stageManager.delete(edge);
  const edges: ManagedKnowledgeGraph["edges"] = [];
  const directRelations = managed.snapshot.relations.filter((relation) => !relation.bridgeModuleId);
  for (const bundle of relationBundles({ ...managed.snapshot, relations: directRelations })) {
    if (!bundle.primary) continue;
    const source = managed.nodes.get(bundle.primary.source);
    const target = managed.nodes.get(bundle.primary.target);
    if (!source || !target) continue;
    edges.push({
      edge: addEdge(project, source, target, bundle.primary, bundle),
      sourceId: bundle.primary.source,
      targetId: bundle.primary.target,
      relation: bundle.primary,
    });
  }
  for (const module of managed.snapshot.bridgeModules ?? []) {
    const headerId = bridgeEntityId(module.id);
    const header = managed.nodes.get(headerId);
    if (module.collapsed) {
      const source = module.sourceId ? managed.nodes.get(module.sourceId) : undefined;
      const target = module.targetId ? managed.nodes.get(module.targetId) : undefined;
      if (source && header) {
        edges.push({
          edge: addModuleEdge(project, source, header, `kb:bridge-edge:${module.id}:source`, "桥梁模块"),
          sourceId: module.sourceId!,
          targetId: headerId,
        });
      }
      if (header && target) {
        edges.push({
          edge: addModuleEdge(project, header, target, `kb:bridge-edge:${module.id}:target`, ""),
          sourceId: headerId,
          targetId: module.targetId!,
        });
      }
      continue;
    }
    const stepIds = module.steps.map((step) => bridgeEntityId(module.id, step.id));
    const chain = [module.sourceId, ...stepIds, module.targetId].filter((id): id is string => Boolean(id));
    for (let index = 0; index < chain.length - 1; index++) {
      const sourceId = chain[index]!;
      const targetId = chain[index + 1]!;
      const source = managed.nodes.get(sourceId);
      const target = managed.nodes.get(targetId);
      if (!source || !target) continue;
      edges.push({
        edge: addModuleEdge(
          project,
          source,
          target,
          `kb:bridge-edge:${module.id}:${index}`,
          index === 0 ? "桥梁步骤" : "",
        ),
        sourceId,
        targetId,
      });
    }
  }
  managed.edges = edges;
  managed.mountedEdgeIds = new Set(edges.map(({ edge }) => edge.uuid));
}

function materializeViewportNodes(project: Project, managed: ManagedKnowledgeGraph): boolean {
  if (managed.snapshot.nodes.length <= MAX_INITIAL_NODES) return false;
  const desired = viewportNodeIds(project, managed.spatialIndex);
  let changed = false;
  for (const item of managed.snapshot.nodes) {
    if (!desired.has(item.id) || managed.nodes.has(item.id)) continue;
    const node = createNode(project, projectedNode(managed.snapshot, item));
    project.stageManager.add(node, true);
    managed.nodes.set(item.id, node);
    managed.baseNodeIds.add(item.id);
    managed.mountedNodeIds.add(item.id);
    managed.ledgerPositions.set(item.id, { x: item.x, y: item.y });
    changed = true;
  }
  if (changed) rebuildManagedEdges(project, managed);
  return changed;
}

/**
 * Mirrors the ledger into the active Project Graph canvas. The generated
 * objects are tracked separately, so hand-authored canvas objects are never
 * removed during a ledger refresh.
 */
export function synchronizeKnowledgeBridgeCanvas(project: Project, snapshot: VaultSnapshot): void {
  const signature = canvasSignature(snapshot);
  const previous = managedGraphs.get(project);
  if (previous?.signature === signature) return;

  for (const { edge } of previous?.edges ?? []) project.stageManager.delete(edge);
  const spatialIndex = buildKnowledgeSpatialIndex(snapshot.nodes);
  const initialNodeIds =
    snapshot.nodes.length <= MAX_INITIAL_NODES
      ? new Set(snapshot.nodes.map((node) => node.id))
      : new Set([...(previous?.nodes.keys() ?? []), ...viewportNodeIds(project, spatialIndex)]);
  const nodes = new Map<string, TextNode>();
  const baseNodeIds = new Set<string>();
  const mountedNodeIds = new Set<string>();
  const ledgerPositions = new Map<string, { x: number; y: number }>();
  for (const item of snapshot.nodes) {
    if (!initialNodeIds.has(item.id)) continue;
    const projectedItem = projectedNode(snapshot, item);
    const existing = previous?.nodes.get(item.id);
    const node = existing ?? createNode(project, projectedItem);
    if (!existing) {
      project.stageManager.add(node, true);
      mountedNodeIds.add(item.id);
    } else {
      updateNode(node, projectedItem, previous?.ledgerPositions.get(item.id));
      if (previous?.mountedNodeIds.has(item.id)) mountedNodeIds.add(item.id);
    }
    nodes.set(item.id, node);
    baseNodeIds.add(item.id);
    ledgerPositions.set(item.id, { x: item.x, y: item.y });
  }
  for (const entity of bridgeCanvasEntities(snapshot)) {
    const existing = previous?.nodes.get(entity.id);
    const node = existing ?? createBridgeEntity(project, entity);
    if (!existing) {
      project.stageManager.add(node, true);
      mountedNodeIds.add(entity.id);
    } else {
      updateBridgeEntity(node, entity);
      if (previous?.mountedNodeIds.has(entity.id)) mountedNodeIds.add(entity.id);
    }
    nodes.set(entity.id, node);
  }
  for (const [nodeId, node] of previous?.nodes ?? []) {
    if (!nodes.has(nodeId)) project.stageManager.delete(node);
  }

  const managed: ManagedKnowledgeGraph = {
    signature,
    snapshot,
    nodes,
    baseNodeIds,
    edges: [],
    mountedNodeIds,
    mountedEdgeIds: new Set(),
    ledgerPositions,
    spatialIndex,
  };
  managedGraphs.set(project, managed);
  rebuildManagedEdges(project, managed);
  project.stageManager.updateReferences();
  updateKnowledgeBridgeSemanticZoom(project);
}

/** Mount, fade, or remove only KB-managed objects as camera scale changes. */
export function updateKnowledgeBridgeSemanticZoom(project: Project): void {
  const managed = managedGraphs.get(project);
  if (!managed) return;
  const materialized = materializeViewportNodes(project, managed);
  const projection = projectSemanticZoom(managed.snapshot, project.camera.currentScale);
  let referencesChanged = materialized;

  for (const item of managed.snapshot.nodes) {
    const node = managed.nodes.get(item.id);
    if (!node) continue;
    const displayItem = projectedNode(managed.snapshot, item);
    const hidden = projection.hiddenNodeIds.has(item.id);
    const mounted = managed.mountedNodeIds.has(item.id);
    if (hidden && mounted) {
      project.stageManager.delete(node);
      managed.mountedNodeIds.delete(item.id);
      referencesChanged = true;
    } else if (!hidden && !mounted) {
      project.stageManager.add(node, true);
      managed.mountedNodeIds.add(item.id);
      referencesChanged = true;
    }
    if (!hidden) {
      const opacity = item.role === "L3" || item.role === "L4" ? projection.detailOpacity : 1;
      node.color = nodeColor(displayItem, opacity);
      const aggregate = projection.detailOpacity < 1 ? (projection.aggregateCounts.get(item.id) ?? 0) : 0;
      node.text = titleFor(displayItem);
      if (aggregate > 0 && displayItem.status !== "frozen") node.text += `  ·  +${aggregate} 细节`;
    }
  }

  for (const entry of managed.edges) {
    const hidden = projection.hiddenNodeIds.has(entry.sourceId) || projection.hiddenNodeIds.has(entry.targetId);
    const mounted = managed.mountedEdgeIds.has(entry.edge.uuid);
    if (hidden && mounted) {
      project.stageManager.delete(entry.edge);
      managed.mountedEdgeIds.delete(entry.edge.uuid);
      referencesChanged = true;
    } else if (!hidden && !mounted) {
      project.stageManager.add(entry.edge, true);
      managed.mountedEdgeIds.add(entry.edge.uuid);
      referencesChanged = true;
    }
    if (!hidden && entry.relation) {
      const involvesDetail =
        projection.detailOpacity < 1 &&
        managed.snapshot.nodes.some(
          (node) =>
            (node.id === entry.sourceId || node.id === entry.targetId) && (node.role === "L3" || node.role === "L4"),
        );
      const opacity = involvesDetail ? projection.detailOpacity : 1;
      entry.edge.color = primaryColor(entry.relation).toNewAlpha(0.96 * opacity);
    }
  }
  if (referencesChanged) project.stageManager.updateReferences();
}

export function readKnowledgeBridgeCanvasPositions(project: Project): KnowledgeNodePosition[] {
  const managed = managedGraphs.get(project);
  if (!managed) return [];
  return [...managed.nodes.entries()].flatMap(([id, node]) =>
    managed.baseNodeIds.has(id)
      ? [
          {
            id,
            x: node.rectangle.location.x,
            y: node.rectangle.location.y,
          },
        ]
      : [],
  );
}

export function readKnowledgeBridgeModulePositions(project: Project): BridgeModulePosition[] {
  const managed = managedGraphs.get(project);
  if (!managed) return [];
  return (managed.snapshot.bridgeModules ?? []).flatMap((module) => {
    const header = managed.nodes.get(bridgeEntityId(module.id));
    if (!header) return [];
    return [
      {
        id: module.id,
        x: header.rectangle.location.x,
        y: header.rectangle.location.y,
        steps: module.steps.flatMap((step) => {
          const node = managed.nodes.get(bridgeEntityId(module.id, step.id));
          return node ? [{ id: step.id, x: node.rectangle.location.x, y: node.rectangle.location.y }] : [];
        }),
      },
    ];
  });
}

export function readChangedKnowledgeBridgeCanvasDetails(project: Project): KnowledgeNodeDetails[] {
  const managed = managedGraphs.get(project);
  if (!managed) return [];
  return [...managed.nodes.entries()].flatMap(([id, node]) => {
    const item = managed.snapshot.nodes.find((candidate) => candidate.id === id);
    if (!item) return [];
    const markdown = DetailsManager.detailsToMarkdown(node.details);
    return markdown === detailsFor(projectedNode(managed.snapshot, item)) ? [] : [{ id, markdown }];
  });
}

export function clearKnowledgeBridgeCanvas(project: Project): void {
  const previous = managedGraphs.get(project);
  if (!previous) return;
  for (const { edge } of previous.edges) project.stageManager.delete(edge);
  for (const node of previous.nodes.values()) project.stageManager.delete(node);
  project.stageManager.updateReferences();
  managedGraphs.delete(project);
}
