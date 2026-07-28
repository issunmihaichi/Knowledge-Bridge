import type { KnowledgeNode, KnowledgeRelation, PendingMention } from './types'

export const demoNodes: KnowledgeNode[] = [
  { id: 'dna', title: 'DNA 与基因', role: 'L1', status: 'formal', content: '# DNA 与基因\n\n遗传信息储存在 DNA 的碱基序列中。', x: 80, y: 210, sourceKind: 'user-confirmed' },
  { id: 'expression', title: '信息传递机制', role: 'L2', status: 'formal', content: '# 信息传递机制\n\n信息经过转录、翻译并受到调控。', x: 390, y: 130 },
  { id: 'feedback', title: '反馈调节', role: 'L2', status: 'formal', content: '# 反馈调节\n\n系统输出反过来影响过程本身。', x: 390, y: 330 },
  { id: 'scrna', title: '单细胞 RNA 测序', role: 'L3', status: 'formal', content: '# 单细胞 RNA 测序\n\n在单细胞尺度测量转录本。', x: 760, y: 120 },
  { id: 'heterogeneity', title: '细胞异质性', role: 'L3', status: 'formal', content: '# 细胞异质性\n\n同类细胞仍可能处于不同表达状态。', x: 760, y: 320 },
  { id: 'paper', title: '肿瘤细胞状态研究', role: 'L4', status: 'formal', content: '# 肿瘤细胞状态研究\n\n研究观察到肿瘤内部存在多个表达亚群。', x: 1100, y: 220 },
  { id: 'old-model', title: '统一细胞状态模型', role: 'L2', status: 'frozen', content: '# 统一细胞状态模型\n\n已降级：忽略了群体内部差异。', x: 390, y: 500, hiddenCount: 18 },
]

export const demoRelations: KnowledgeRelation[] = [
  { id: 'r1', source: 'dna', target: 'expression', label: '解释基础', layer: 'logical', status: 'formal' },
  { id: 'r2', source: 'expression', target: 'scrna', label: '实现', layer: 'logical', status: 'formal' },
  { id: 'r3', source: 'feedback', target: 'heterogeneity', label: '帮助解释', layer: 'logical', status: 'formal' },
  { id: 'r4', source: 'scrna', target: 'paper', label: '提供方法', layer: 'logical', status: 'formal' },
  { id: 'r5', source: 'heterogeneity', target: 'paper', label: '支持 ×2', layer: 'logical', status: 'formal' },
  { id: 'r6', source: 'dna', target: 'scrna', label: '先修于', layer: 'cognitive', status: 'formal' },
]

export const demoPending: PendingMention[] = [
  { id: 'p1', filePath: 'Sources/Cell_Atlas.md', sourceId: 'paper', targetTitle: '空间转录组', kind: 'wikilink', raw: '[[空间转录组]]' },
  { id: 'p2', filePath: 'Notes/表观遗传.md', targetTitle: '染色质可及性', kind: 'orphan', raw: '染色质可及性' },
  { id: 'p3', filePath: 'Notes/旧概念重写.md', targetTitle: '未知文件', kind: 'lineage', raw: 'kb-id missing', candidates: [
    { id: 'expression', title: '信息传递机制', reason: '标题与链接邻居相似', confidence: 0.81 },
    { id: 'feedback', title: '反馈调节', reason: '历史路径相近', confidence: 0.57 },
  ] },
]
