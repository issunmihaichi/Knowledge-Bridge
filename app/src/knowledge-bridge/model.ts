export type LearningRole = "L1" | "L2" | "L3" | "L4";
export type NodeStatus = "formal" | "pending" | "missing-source" | "frozen";
export type RelationLayer = "logical" | "cognitive";
export type RelationStatus = "formal" | "pending" | "severed" | "historical" | "frozen";
export type EvidenceLevel = "E1" | "E2" | "E3" | "E4" | "undetermined";
export type L3Lifecycle = "captured" | "pending-parse" | "ai-suggested" | "adopted" | "reviewed" | "archived";
export type AiDraftStatus = "draft" | "adopted" | "recomputed" | "rejected";
/** Relations that can carry the logical graph's primary structural meaning. */
export type LogicalRelationKind = "structure" | "causality" | "temporal";
/**
 * Argumentation and scale transitions annotate a logical relation; they do not
 * replace its structural, causal, or temporal meaning.
 */
export type ReasoningRelationKind = "argument" | "cross-scale";
export type CognitiveRelationKind =
  | "prerequisite"
  | "analogy"
  | "translation"
  | "explanation"
  | "comparison"
  | "mention"
  | "related";
export type LogicalRelationOutcome = "compatible" | "conditional" | "conflicting";
export type ArgumentRole = "source" | "premise" | "evidence" | "intermediate-conclusion" | "conclusion";

export interface AiProvenance {
  status: AiDraftStatus;
  reason: string;
  evidence: string[];
  confidence: number;
  alternatives: Array<{ id: string; reason: string; confidence?: number }>;
  createdAt: number;
  adoptedAt?: number;
}

export interface AnchorLedgerEntry {
  source: "user-confirmed" | "behavior" | "ai-inferred" | "denied";
  rationale: string;
  evidence: string[];
  confidence?: number;
  recordedAt: number;
}

export interface KnowledgeNode {
  id: string;
  title: string;
  role: LearningRole;
  status: NodeStatus;
  path?: string;
  content: string;
  /** Canonical long-form editor value after the user edits generated details. */
  detailsMarkdown?: string;
  x: number;
  y: number;
  sourceKind?: "user-confirmed" | "behavior" | "ai-inferred" | "denied";
  hiddenCount?: number;
  l3Lifecycle?: L3Lifecycle;
  definition?: string;
  scope?: string;
  boundary?: string;
  anchorLedger?: AnchorLedgerEntry[];
  ai?: AiProvenance;
}

export interface EvidenceReading {
  perspective: string;
  level: EvidenceLevel;
  direction: "supports" | "challenges" | "mixed";
  note?: string;
  lensId?: string;
  evaluatedAt?: number;
  directness?: "direct" | "indirect" | "contextual";
  methodQuality?: "low" | "medium" | "high";
  verifiability?: "limited" | "reviewable" | "replicable";
  applicability?: string;
}

export interface ScaleConversionProtocol {
  id: string;
  sourceScale: string;
  targetScale: string;
  mechanismSteps: string[];
  status: "confirmed" | "gap";
  evidenceIds?: string[];
  boundary?: string;
}

export interface KnowledgeRelation {
  id: string;
  source: string;
  target: string;
  label: string;
  layer: RelationLayer;
  status: RelationStatus;
  managed?: boolean;
  managedFilePath?: string;
  managedTarget?: string;
  context?: string;
  /** Stable identity shared by the two edges of one concrete L1-L2-L3 bridge path. */
  bridgePathId?: string;
  confidence?: number;
  evidence?: EvidenceReading[];
  scaleProtocolId?: string;
  kind?: LogicalRelationKind;
  reasoningKind?: ReasoningRelationKind;
  /** A strong cross-scale claim requires a confirmed conversion protocol. */
  crossScaleStrength?: "strong" | "observation";
  cognitiveKind?: CognitiveRelationKind;
  /** Explicit display priority. The strongest relation in a bundle is rendered as its primary edge. */
  weight?: number;
  logicalOutcome?: LogicalRelationOutcome;
  ai?: AiProvenance;
}

export interface PendingMention {
  id: string;
  filePath: string;
  sourceId?: string;
  relationId?: string;
  targetTitle: string;
  kind: "wikilink" | "orphan" | "lineage" | "ai-bridge" | "scale-gap" | "severed-link";
  raw: string;
  suggestedRole?: LearningRole;
  deferredAt?: number;
  anchorId?: string;
  anchorReason?: string;
  anchorEvidence?: string[];
  anchorAlternatives?: Array<{ id: string; reason: string; confidence: number }>;
  candidates?: Array<{ id: string; title: string; reason: string; confidence: number }>;
}

export interface VaultFile {
  path: string;
  content: string;
  modifiedAt: number;
  size: number;
}

export interface VaultFileMetadata {
  path: string;
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

export interface KnowledgeLens {
  id: string;
  title: string;
  kind: "research-consensus" | "curriculum" | "exam" | "historical" | "personal";
  effectiveFrom?: number;
  effectiveTo?: number;
  description?: string;
  active?: boolean;
}

export interface ArgumentRoleAssignment {
  id: string;
  argumentId: string;
  nodeId: string;
  role: ArgumentRole;
  lensId?: string;
  validFrom?: number;
  validTo?: number;
}

export interface FrozenPath {
  id: string;
  l1Id: string;
  l3Id: string;
  relationIds: [string, string];
  family: string;
}

export interface MigrationCandidate {
  l2Id: string;
  confidence: number;
  reason: string;
  semanticLoss: "low" | "medium" | "high";
  conditionChange?: string;
  conflict?: string;
}

export interface FrozenL2MigrationPreview {
  id: string;
  frozenL2Id: string;
  paths: Array<{ path: FrozenPath; candidates: MigrationCandidate[] }>;
  createdAt: number;
}

export interface MigrationRecord {
  id: string;
  frozenL2Id: string;
  previewId: string;
  pathMappings: Array<{ pathId: string; replacementL2Id: string }>;
  operator: "user";
  reason: string;
  createdAt: number;
  undoneAt?: number;
}

export type McpToolRequestStatus = "pending-approval" | "completed" | "failed" | "rejected";

export interface McpToolRequest {
  id: string;
  server: string;
  tool: string;
  modelName: string;
  arguments: Record<string, unknown>;
  reason: string;
  status: McpToolRequestStatus;
  resultPreview?: string;
  error?: string;
  completedAt?: number;
}

export interface AgentExecutionTrace {
  id: string;
  startedAt: number;
  completedAt: number;
  llm: {
    provider: "remote-ai" | "local-fallback";
    model?: string;
  };
  mcp: {
    servers: string[];
    availableTools: string[];
    invokedTools: string[];
    requests?: McpToolRequest[];
  };
  skills: {
    available: string[];
    activated: string[];
  };
  warnings: string[];
}

export type KnowledgeGraphOperationOrigin = "agent" | "canvas" | "mcp" | "skill" | "user";

export interface KnowledgeGraphOperationMeta {
  id: string;
  origin: KnowledgeGraphOperationOrigin;
  type: string;
  createdAt: number;
}

export type GraphProposalOperation =
  | { type: "create-node"; node: KnowledgeNode }
  | { type: "create-relation"; relation: KnowledgeRelation };

export interface GraphChangeProposal {
  id: string;
  title: string;
  summary: string;
  sourceDraftId: string;
  status: "draft" | "applied" | "rejected";
  operations: GraphProposalOperation[];
  trace: AgentExecutionTrace;
  createdAt: number;
  appliedAt?: number;
  rejectedAt?: number;
}

export interface PaperBridgeStep {
  id: string;
  nodeId?: string;
  title: string;
  role: "frontier-concept" | "bridge-mechanism" | "learning-anchor" | "high-school-anchor" | "scale-gap";
  explanation: string;
  state: "existing" | "proposed";
}

export interface PaperBridgeDraft {
  id: string;
  title: string;
  input: string;
  summary: string;
  chain: PaperBridgeStep[];
  anchorReason: string;
  confidence: number;
  provider: "remote-ai" | "local-fallback";
  diagnostic?: string;
  agentTrace?: AgentExecutionTrace;
  status: "draft" | "adopted" | "dismissed";
  createdAt: number;
}

export interface VaultSnapshot {
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  pending: PendingMention[];
  protocols: ScaleConversionProtocol[];
  lenses: KnowledgeLens[];
  argumentRoles: ArgumentRoleAssignment[];
  migrationRecords: MigrationRecord[];
  paperDrafts: PaperBridgeDraft[];
  graphProposals: GraphChangeProposal[];
}

export const emptyVaultSnapshot: VaultSnapshot = {
  nodes: [],
  relations: [],
  pending: [],
  protocols: [],
  lenses: [],
  argumentRoles: [],
  migrationRecords: [],
  paperDrafts: [],
  graphProposals: [],
};

export const demoVaultSnapshot: VaultSnapshot = {
  nodes: [
    {
      id: "l1-cell",
      title: "细胞与遗传",
      role: "L1",
      status: "formal",
      content: "高中生物锚点",
      x: -380,
      y: -20,
      sourceKind: "user-confirmed",
      anchorLedger: [
        {
          source: "user-confirmed",
          rationale: "已确认高中生物学习锚点",
          evidence: ["课程笔记"],
          recordedAt: 1719792000000,
        },
      ],
    },
    {
      id: "l2-flow",
      title: "信息流与调控",
      role: "L2",
      status: "formal",
      content: "跨主题复用机制",
      x: -170,
      y: -190,
      definition: "信息在编码、读取和调控环路中被传递与修正的机制。",
      scope: "遗传表达、基因编辑与细胞调控。",
      boundary: "不能替代具体分子、环境或因果证据。",
    },
    {
      id: "l2-selection",
      title: "选择压力",
      role: "L2",
      status: "formal",
      content: "跨领域公约数",
      x: -170,
      y: 140,
      definition: "环境约束使不同变异获得不同保留机会的机制。",
      scope: "演化、肿瘤克隆与药物反应。",
      boundary: "必须说明环境、变异与可检验证据。",
    },
    {
      id: "l3-dogma",
      title: "中心法则",
      role: "L3",
      status: "formal",
      content: "DNA 到 RNA 到蛋白质",
      x: 100,
      y: -250,
      l3Lifecycle: "reviewed",
    },
    {
      id: "l3-crispr",
      title: "CRISPR-Cas9",
      role: "L3",
      status: "formal",
      content: "前沿分子工具",
      x: 100,
      y: -70,
      l3Lifecycle: "adopted",
    },
    {
      id: "l3-tumor",
      title: "肿瘤异质性",
      role: "L3",
      status: "pending",
      content: "论文关键词占位符",
      x: 100,
      y: 200,
      l3Lifecycle: "captured",
    },
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
      kind: "causality",
      reasoningKind: "cross-scale",
      crossScaleStrength: "strong",
    },
    {
      id: "edge-evidence",
      source: "l4-single-cell",
      target: "l3-tumor",
      label: "E3 支持 / E2 反驳",
      layer: "logical",
      status: "formal",
      evidence: [
        {
          perspective: "克隆演化",
          level: "E3",
          direction: "supports",
          lensId: "research-consensus",
          directness: "direct",
          methodQuality: "high",
          verifiability: "reviewable",
          applicability: "实体瘤队列",
        },
        {
          perspective: "微环境主导",
          level: "E2",
          direction: "challenges",
          lensId: "research-consensus",
          directness: "indirect",
          methodQuality: "medium",
          verifiability: "reviewable",
          applicability: "特定微环境",
        },
      ],
      kind: "structure",
      reasoningKind: "argument",
      logicalOutcome: "conflicting",
    },
    {
      id: "edge-dogma-crispr-structure",
      source: "l3-dogma",
      target: "l3-crispr",
      label: "结构关联",
      layer: "logical",
      status: "formal",
      kind: "structure",
      weight: 0.78,
    },
    {
      id: "edge-cognitive",
      source: "l3-dogma",
      target: "l3-crispr",
      label: "先修",
      layer: "cognitive",
      status: "formal",
      cognitiveKind: "prerequisite",
      weight: 0.52,
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
      evidenceIds: ["l4-single-cell"],
      boundary: "不将体外编辑效率直接等同于临床疗效。",
    },
  ],
  lenses: [
    { id: "research-consensus", title: "科研共识", kind: "research-consensus", active: true },
    { id: "high-school-curriculum", title: "高中课标", kind: "curriculum", description: "高中生物学习与考试适用范围" },
  ],
  argumentRoles: [
    {
      id: "argument-role-1",
      argumentId: "edge-evidence",
      nodeId: "l4-single-cell",
      role: "evidence",
      lensId: "research-consensus",
    },
    {
      id: "argument-role-2",
      argumentId: "edge-evidence",
      nodeId: "l3-tumor",
      role: "conclusion",
      lensId: "research-consensus",
    },
  ],
  migrationRecords: [],
  paperDrafts: [],
  graphProposals: [],
};
