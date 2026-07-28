import type { Project } from "@/core/Project";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { demoVaultSnapshot } from "./model";

const roleColors = {
  L1: new Color(20, 88, 120, 0.96),
  L2: new Color(20, 90, 76, 0.9),
  L3: Color.Transparent,
  L4: new Color(75, 67, 108, 0.76),
};

const displayTitles: Record<string, string> = {
  "l1-cell": "L1  细胞与遗传",
  "l2-flow": "L2  信息流与调控",
  "l2-selection": "L2  选择压力",
  "l3-dogma": "L3  中心法则",
  "l3-crispr": "L3  CRISPR-Cas9",
  "l3-tumor": "L3  肿瘤异质性",
  "l4-single-cell": "L4  单细胞证据",
  "scale-protocol": "L4  尺度换算协议",
};

const displayRelations: Record<string, string> = {
  "edge-anchor-flow": "抽象",
  "edge-anchor-selection": "解释",
  "edge-flow-dogma": "解释",
  "edge-flow-crispr": "机制",
  "edge-selection-tumor": "机制",
  "edge-crispr-scale": "换算",
  "edge-evidence": "证据张力",
};

export function seedKnowledgeBridgeDemo(project: Project): void {
  if (project.stage.length > 0) return;
  const nodes = new Map<string, TextNode>();

  for (const item of demoVaultSnapshot.nodes) {
    const node = new TextNode(project, {
      text: displayTitles[item.id] ?? `${item.role}  ${item.title}`,
      collisionBox: new CollisionBox([new Rectangle(new Vector(item.x, item.y), Vector.getZero())]),
      color: roleColors[item.role],
      fontScaleLevel: item.role === "L1" ? 0 : -1,
    });
    project.stageManager.add(node);
    nodes.set(item.id, node);
  }

  for (const relation of demoVaultSnapshot.relations.filter((item) => item.layer === "logical")) {
    const source = nodes.get(relation.source);
    const target = nodes.get(relation.target);
    if (source && target) {
      project.nodeConnector.connectEntityFast(source, target, displayRelations[relation.id] ?? relation.label);
    }
  }

  project.historyManager.recordStep();
}
