export type LearningRole = 'L1' | 'L2' | 'L3' | 'L4'
export type NodeStatus = 'formal' | 'pending' | 'missing-source' | 'frozen'
export type RelationLayer = 'logical' | 'cognitive'
export type RelationStatus = 'formal' | 'pending' | 'severed' | 'historical' | 'frozen'

export interface KnowledgeNode {
  id: string
  title: string
  role: LearningRole
  status: NodeStatus
  path?: string
  content: string
  x: number
  y: number
  sourceKind?: 'user-confirmed' | 'behavior' | 'ai-inferred' | 'denied'
  hiddenCount?: number
}

export interface KnowledgeRelation {
  id: string
  source: string
  target: string
  label: string
  layer: RelationLayer
  status: RelationStatus
  managed?: boolean
  context?: string
  confidence?: number
}

export interface PendingMention {
  id: string
  filePath: string
  sourceId?: string
  targetTitle: string
  kind: 'wikilink' | 'orphan' | 'lineage' | 'ai-bridge'
  raw: string
  candidates?: Array<{ id: string; title: string; reason: string; confidence: number }>
}

export interface VaultFile {
  path: string
  content: string
  modifiedAt: number
  size: number
}

export interface ManagedLinkSnapshot {
  edgeId: string
  fileId: string
  filePath: string
  target: string
  beforeHash: string
  afterHash: string
  writtenAt: number
}

export interface IndexProgress {
  phase: 'idle' | 'scanning' | 'complete' | 'cancelled'
  current: number
  total: number
}

export interface VaultSnapshot {
  nodes: KnowledgeNode[]
  relations: KnowledgeRelation[]
  pending: PendingMention[]
}
