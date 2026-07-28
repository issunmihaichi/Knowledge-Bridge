import type { Project } from "@/core/Project";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { DetailsManager } from "@/core/stage/stageObject/tools/entityDetailsManager";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { relationBundles, type RelationBundle } from "./governance";
import type { KnowledgeNode, KnowledgeRelation, VaultSnapshot } from "./model";

const managedGraphs = new WeakMap<Project, { signature: string; nodes: TextNode[]; edges: LineEdge[] }>();

const roleColors: Record<KnowledgeNode["role"], Color> = {
  L1: new Color(23, 129, 173, 0.94),
  L2: new Color(35, 141, 104, 0.94),
  L3: new Color(86, 99, 132, 0.86),
  L4: new Color(129, 89, 163, 0.9),
};

const secondaryColor = new Color(255, 255, 255, 0.54);

function canvasSignature(snapshot: VaultSnapshot): string {
  return JSON.stringify({ nodes: snapshot.nodes, relations: snapshot.relations });
}

function titleFor(node: KnowledgeNode): string {
  return `${node.role}  ${node.title}`;
}

function detailsFor(node: KnowledgeNode): string {
  const lines = [`# ${node.title}`, "", node.content];
  if (node.definition) lines.push("", "## 定义", "", node.definition);
  if (node.scope) lines.push("", "## 适用范围", "", node.scope);
  if (node.boundary) lines.push("", "## 边界", "", node.boundary);
  if (node.status === "frozen") lines.push("", "## 状态", "", "该节点已逻辑冻结；历史关系仅供回溯。");
  return lines.join("\n");
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

function primaryLabel(bundle: RelationBundle, relation: KnowledgeRelation): string {
  return bundle.label ? `${bundle.label} · ${relation.label}` : relation.label;
}

function secondaryPorts(index: number): { source: Vector; target: Vector } {
  const ports = [
    [new Vector(0.5, 0.01), new Vector(0.5, 0.01)],
    [new Vector(0.5, 0.99), new Vector(0.5, 0.99)],
    [new Vector(0.01, 0.5), new Vector(0.01, 0.5)],
    [new Vector(0.99, 0.5), new Vector(0.99, 0.5)],
  ] as const;
  const [source, target] = ports[index % ports.length];
  return { source: source.clone(), target: target.clone() };
}

function addEdge(
  project: Project,
  source: TextNode,
  target: TextNode,
  relation: KnowledgeRelation,
  bundle: RelationBundle,
  secondaryIndex?: number,
): LineEdge {
  const ports = secondaryIndex === undefined ? undefined : secondaryPorts(secondaryIndex);
  const edge = new LineEdge(project, {
    uuid: `kb:relation:${secondaryIndex === undefined ? "primary" : `secondary:${secondaryIndex}`}:${relation.id}`,
    associationList: [source, target],
    text: secondaryIndex === undefined ? primaryLabel(bundle, relation) : relation.label,
    color: secondaryIndex === undefined ? primaryColor(relation) : secondaryColor.clone(),
    lineType: secondaryIndex === undefined ? "solid" : "knowledge-bridge-secondary",
    arrowType: "none",
    sourceRectangleRate: ports?.source,
    targetRectangleRate: ports?.target,
  });
  project.stageManager.add(edge, true);
  return edge;
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

  for (const edge of previous?.edges ?? []) project.stageManager.delete(edge);
  for (const node of previous?.nodes ?? []) project.stageManager.delete(node);

  const nodes = new Map<string, TextNode>();
  const createdNodes: TextNode[] = [];
  for (const item of snapshot.nodes) {
    const node = new TextNode(project, {
      uuid: `kb:node:${item.id}`,
      text: titleFor(item),
      collisionBox: new CollisionBox([new Rectangle(new Vector(item.x, item.y), Vector.getZero())]),
      color: item.status === "frozen" ? new Color(128, 132, 141, 0.72) : roleColors[item.role].clone(),
      fontScaleLevel: item.role === "L1" ? 0 : -1,
      details: DetailsManager.markdownToDetails(detailsFor(item)),
      openDetailsOnClick: true,
    });
    project.stageManager.add(node, true);
    nodes.set(item.id, node);
    createdNodes.push(node);
  }

  const createdEdges: LineEdge[] = [];
  for (const bundle of relationBundles(snapshot)) {
    if (!bundle.primary) continue;
    const source = nodes.get(bundle.primary.source);
    const target = nodes.get(bundle.primary.target);
    if (!source || !target) continue;
    createdEdges.push(addEdge(project, source, target, bundle.primary, bundle));
    bundle.secondary.forEach((relation, index) => {
      const secondarySource = nodes.get(relation.source);
      const secondaryTarget = nodes.get(relation.target);
      if (secondarySource && secondaryTarget) {
        createdEdges.push(addEdge(project, secondarySource, secondaryTarget, relation, bundle, index));
      }
    });
  }

  project.stageManager.updateReferences();
  managedGraphs.set(project, { signature, nodes: createdNodes, edges: createdEdges });
}

export function clearKnowledgeBridgeCanvas(project: Project): void {
  const previous = managedGraphs.get(project);
  if (!previous) return;
  for (const edge of previous.edges) project.stageManager.delete(edge);
  for (const node of previous.nodes) project.stageManager.delete(node);
  project.stageManager.updateReferences();
  managedGraphs.delete(project);
}
