export type LearningRole = "L1" | "L2" | "L3" | "L4";
export type NodeStatus = "formal" | "pending" | "missing-source" | "frozen";
export type RelationLayer = "logical" | "cognitive";
export type RelationStatus = "formal" | "pending" | "severed" | "historical" | "frozen";
export type EvidenceLevel = "E1" | "E2" | "E3" | "E4" | "undetermined";

export interface KnowledgeNode {
  id: string;
  title: string;
  role: LearningRole;
  status: NodeStatus;
  path?: string;
  content: string;
  x: number;
  y: number;
  sourceKind?: "user-confirmed" | "behavior" | "ai-inferred" | "denied";
  hiddenCount?: number;
}

export interface EvidenceReading {
  perspective: string;
  level: EvidenceLevel;
  direction: "supports" | "challenges" | "mixed";
  note?: string;
}

export interface ScaleConversionProtocol {
  id: string;
  sourceScale: string;
  targetScale: string;
  mechanismSteps: string[];
  status: "confirmed" | "gap";
}

export interface KnowledgeRelation {
  id: string;
  source: string;
  target: string;
  label: string;
  layer: RelationLayer;
  status: RelationStatus;
  managed?: boolean;
  context?: string;
  confidence?: number;
  evidence?: EvidenceReading[];
  scaleProtocolId?: string;
}

export interface PendingMention {
  id: string;
  filePath: string;
  sourceId?: string;
  targetTitle: string;
  kind: "wikilink" | "orphan" | "lineage" | "ai-bridge";
  raw: string;
  candidates?: Array<{ id: string; title: string; reason: string; confidence: number }>;
}

export interface VaultFile {
  path: string;
  content: string;
  modifiedAt: number;
  size: number;
}

export interface IndexProgress {
  phase: "idle" | "scanning" | "complete" | "cancelled";
  current: number;
  total: number;
}

export interface ManagedLinkSnapshot {
  edgeId: string;
  fileId: string;
  filePath: string;
  target: string;
  beforeHash: string;
  afterHash: string;
  writtenAt: number;
}

export interface VaultSnapshot {
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  pending: PendingMention[];
  protocols: ScaleConversionProtocol[];
}

export const demoVaultSnapshot: VaultSnapshot = {
  nodes: [
    { id: "l1-cell", title: "细胞与遗传", role: "L1", status: "formal", content: "高中生物锚点", x: -380, y: -20 },
    { id: "l2-flow", title: "信息流与调控", role: "L2", status: "formal", content: "跨主题复用机制", x: -170, y: -190 },
    { id: "l2-selection", title: "选择压力", role: "L2", status: "formal", content: "跨领域公约数", x: -170, y: 140 },
    {
      id: "l3-dogma",
      title: "中心法则",
      role: "L3",
      status: "formal",
      content: "DNA 到 RNA 到蛋白质",
      x: 100,
      y: -250,
    },
    { id: "l3-crispr", title: "CRISPR-Cas9", role: "L3", status: "formal", content: "前沿分子工具", x: 100, y: -70 },
    { id: "l3-tumor", title: "肿瘤异质性", role: "L3", status: "pending", content: "论文关键词占位符", x: 100, y: 200 },
    {
      id: "l4-single-cell",
      title: "2024 单细胞证据",
      role: "L4",
      status: "formal",
      content: "来源与论证角色",
      x: 360,
      y: 200,
    },
    {
      id: "scale-protocol",
      title: "分子到个体换算协议",
      role: "L4",
      status: "formal",
      content: "尺度桥梁",
      x: 360,
      y: -70,
    },
  ],
  relations: [
    {
      id: "edge-anchor-flow",
      source: "l1-cell",
      target: "l2-flow",
      label: "抽象为",
      layer: "logical",
      status: "formal",
    },
    {
      id: "edge-anchor-selection",
      source: "l1-cell",
      target: "l2-selection",
      label: "解释框架",
      layer: "logical",
      status: "formal",
    },
    { id: "edge-flow-dogma", source: "l2-flow", target: "l3-dogma", label: "解释", layer: "logical", status: "formal" },
    {
      id: "edge-flow-crispr",
      source: "l2-flow",
      target: "l3-crispr",
      label: "机制桥梁",
      layer: "logical",
      status: "formal",
    },
    {
      id: "edge-selection-tumor",
      source: "l2-selection",
      target: "l3-tumor",
      label: "机制桥梁",
      layer: "logical",
      status: "formal",
    },
    {
      id: "edge-crispr-scale",
      source: "l3-crispr",
      target: "scale-protocol",
      label: "跨尺度",
      layer: "logical",
      status: "formal",
      scaleProtocolId: "protocol-molecule-person",
    },
    {
      id: "edge-evidence",
      source: "l4-single-cell",
      target: "l3-tumor",
      label: "E3 支持 / E2 反驳",
      layer: "logical",
      status: "formal",
      evidence: [
        { perspective: "克隆演化", level: "E3", direction: "supports" },
        { perspective: "微环境主导", level: "E2", direction: "challenges" },
      ],
    },
    {
      id: "edge-cognitive",
      source: "l3-dogma",
      target: "l3-crispr",
      label: "先修",
      layer: "cognitive",
      status: "formal",
    },
  ],
  pending: [
    {
      id: "pending-1",
      filePath: "Notes/肿瘤异质性.md",
      sourceId: "l3-tumor",
      targetTitle: "克隆演化",
      kind: "ai-bridge",
      raw: "建议以“选择压力”作为 L2 桥梁",
    },
    {
      id: "pending-2",
      filePath: "Sources/2024-single-cell.md",
      targetTitle: "单细胞转录组",
      kind: "wikilink",
      raw: "[[单细胞转录组]]",
    },
    {
      id: "pending-3",
      filePath: "Notes/未知文件.md",
      targetTitle: "旧概念：细胞命运",
      kind: "lineage",
      raw: "kb-id 缺失；标题与链接邻居相似",
    },
  ],
  protocols: [
    {
      id: "protocol-molecule-person",
      sourceScale: "分子",
      targetScale: "个体",
      mechanismSteps: ["编辑效率", "细胞克隆扩增", "组织表型", "临床终点"],
      status: "confirmed",
    },
  ],
};
