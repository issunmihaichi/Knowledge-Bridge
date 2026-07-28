import type { Project } from "@/core/Project";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { DetailsManager } from "@/core/stage/stageObject/tools/entityDetailsManager";
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

const knowledgeDetails: Record<string, string> = {
  "l1-cell": `# 细胞与遗传

这是当前知识图的学习锚点。先从细胞结构、遗传信息和表达过程出发，再把新论文放回这个熟悉的框架。

## 已连接

- 信息流与调控：解释 DNA 到 RNA 到蛋白质的传递
- 选择压力：解释变异为何能在群体中保留

## 学习提醒

把前沿术语翻译成已学过的细胞过程，再判断它是否真的补上了机制。`,
  "l2-flow": `# 信息流与调控

这是连接高中遗传学与分子生物学的桥梁机制：信息被编码、读取、修正，并受到多层调控。

## 适用边界

它适合解释表达、编辑和反馈，不应被用作所有生物现象的泛化标签。

## 可复用路径

细胞与遗传 -> 信息流与调控 -> 中心法则 / CRISPR-Cas9`,
  "l2-selection": `# 选择压力

选择压力描述不同特征在环境约束下获得不同保留机会的机制。

## 它连接什么

把遗传变异、肿瘤异质性和克隆演化放进同一条可检验路径。

## 需要区分

选择压力不是结论；它必须指向具体环境、变异和证据。`,
  "l3-dogma": `# 中心法则

遗传信息通常沿 DNA -> RNA -> 蛋白质的路径被表达。

## 为什么在这里

它让 CRISPR 等前沿工具有可理解的落点：工具先改变信息层，再经表达和细胞过程显现结果。

## 不能简单化

逆转录、RNA 编辑和表观调控说明真实系统存在额外分支；这不是推翻基本框架，而是指定其边界。`,
  "l3-crispr": `# CRISPR-Cas9

CRISPR-Cas9 是可按目标序列进行 DNA 编辑的分子工具。

## 桥梁

它通过改变 DNA 信息进入中心法则，再以细胞行为和表型表现出来。

## 尺度提醒

从分子编辑到患者结局之间还需要克隆扩增、组织表型和临床终点等换算步骤。`,
  "l3-tumor": `# 肿瘤异质性

同一肿瘤内的细胞可具有不同基因、表达状态和治疗反应。

## 当前状态

这是一个占位概念：已保存论文线索，但尚未完成机制桥接。

## 下一步

比较克隆演化与微环境两种解释，分别记录它们支持或挑战这一主张的证据。`,
  "l4-single-cell": `# 2024 单细胞证据

这条来源可在不同论证中担任前提、证据或结论，而不是被固定成单一等级。

## 证据张力

- 克隆演化视角：E3 支持
- 微环境主导视角：E2 挑战

同一研究的不同解释必须保留，而不能用平均分掩盖分歧。`,
  "scale-protocol": `# 分子到个体换算协议

分子事件不能直接推出临床结局。此协议记录中间必经的机制步骤。

## 已确认步骤

编辑效率 -> 细胞克隆扩增 -> 组织表型 -> 临床终点

缺少任何一步时，关系只能保留为观察相关，不能晋升为跨尺度强关系。`,
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
      details: DetailsManager.markdownToDetails(knowledgeDetails[item.id] ?? item.content),
      openDetailsOnClick: true,
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
