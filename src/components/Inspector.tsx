import { useEffect, useRef, useState } from 'react'
import { Archive, Bot, Check, GitBranch, History, Link2, Link2Off, Pin, RotateCcw, Save, X } from 'lucide-react'
import type { IndexProgress, KnowledgeNode, KnowledgeRelation, PendingMention } from '../domain/types'

interface Props {
  node?: KnowledgeNode
  relations: KnowledgeRelation[]
  pending: PendingMention[]
  nodes: KnowledgeNode[]
  progress: IndexProgress
  activeTab: 'note' | 'pending'
  onTab: (tab: 'note' | 'pending') => void
  onSave: (nodeId: string, content: string) => void
  onAcceptPending: (id: string) => void
  onDismissPending: (id: string) => void
  onApplyMigration: (node: KnowledgeNode) => void
  onCreateManagedLink: (sourceId: string, targetId: string) => void
  onRestoreLink: (relationId: string) => void
}

export function Inspector({ node, nodes, relations, pending, progress, activeTab, onTab, onSave, onAcceptPending, onDismissPending, onApplyMigration, onCreateManagedLink, onRestoreLink }: Props) {
  const [draft, setDraft] = useState(node?.content ?? '')
  const [dirty, setDirty] = useState(false)
  const [linkTarget, setLinkTarget] = useState('')
  const previous = useRef<{ id: string; content: string; dirty: boolean } | undefined>(undefined)
  useEffect(() => {
    if (previous.current?.dirty) onSave(previous.current.id, previous.current.content)
    setDraft(node?.content ?? '')
    setDirty(false)
    previous.current = node ? { id: node.id, content: node.content, dirty: false } : undefined
  }, [node?.id])
  useEffect(() => { if (previous.current) previous.current = { ...previous.current, content: draft, dirty } }, [draft, dirty])
  const related = node ? relations.filter((relation) => relation.source === node.id || relation.target === node.id) : []
  const cognitiveHidden = related.filter((relation) => relation.layer === 'cognitive').length

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        <button className={activeTab === 'note' ? 'active' : ''} onClick={() => onTab('note')}>笔记</button>
        <button className={activeTab === 'pending' ? 'active' : ''} onClick={() => onTab('pending')}>待整理 <span>{pending.length}</span></button>
      </div>
      {activeTab === 'note' ? (
        node ? <div className="note-pane">
          <div className="note-heading"><div><span>{node.role} · {node.status === 'formal' ? '已复核' : node.status === 'frozen' ? '逻辑冻结' : '待处理'}</span><h2>{node.title}</h2></div><button className="icon-button" title="固定只读摘要"><Pin size={16} /></button></div>
          {node.status === 'missing-source' && <div className="warning-box">来源文件缺失。该节点已退出正式推理，等待重新绑定。</div>}
          {node.status === 'frozen' && <div className="migration-card">
            <div className="migration-title"><Archive size={16} /> 冻结机制迁移</div>
            <p>历史路径已折叠。AI 已按语义与条件分为 3 个路径族，其中 14 条可高置信迁移。</p>
            <div className="candidate"><div><strong>动态细胞状态模型</strong><span>覆盖 14/18 · 语义损失低</span></div><b>92%</b></div>
            <button className="primary-button" onClick={() => onApplyMigration(node)}><GitBranch size={15} /> 应用高置信替代</button>
          </div>}
          <textarea aria-label="Markdown 编辑器" value={draft} onChange={(event) => { setDraft(event.target.value); setDirty(true) }} />
          <div className="editor-actions"><span>{node.path ?? '尚未绑定文件'}</span><button disabled={!dirty} onClick={() => { onSave(node.id, draft); setDirty(false) }}><Save size={14} /> 保存</button></div>
          <section className="relation-section"><header><strong>关系详情</strong><span>{related.length}</span></header>
            <div className="managed-link-form"><select aria-label="托管双链目标" value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)}><option value="">选择双链目标</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><button disabled={!linkTarget} title="写回 Obsidian 双链" onClick={() => { onCreateManagedLink(node.id, linkTarget); setLinkTarget('') }}><Link2 size={14} /></button></div>
            {related.filter((relation) => relation.layer === 'logical').map((relation) => <div className="relation-row" key={relation.id}><span className="relation-type">逻辑</span><b>{relation.label}</b><small>{relation.status}</small></div>)}
            {cognitiveHidden > 0 && <div className="hidden-scaffold">隐藏有 {cognitiveHidden} 条认知脚手架（类比/先修等）</div>}
            {related.filter((relation) => relation.status === 'severed').map((relation) => <div className="severed-row" key={relation.id}><Link2Off size={13} /><span>用户已剪断 · {relation.label}</span><button onClick={() => onRestoreLink(relation.id)}><RotateCcw size={12} /> 恢复</button></div>)}
          </section>
        </div> : <div className="empty-pane">从画布或文件树选择一个节点</div>
      ) : (
        <div className="pending-pane">
          <div className="pending-summary"><Bot size={18} /><div><strong>{progress.phase === 'scanning' ? '正在后台整理' : `发现 ${pending.length} 个未处理提及`}</strong><span>{progress.phase === 'scanning' ? `${progress.current}${progress.total ? ` / ${progress.total}` : ''}` : '不会自动加入主画布'}</span></div></div>
          {progress.phase === 'scanning' && <div className="progress-track"><i style={{ width: progress.total ? `${progress.current / progress.total * 100}%` : '35%' }} /></div>}
          {pending.map((item) => <article className="pending-item" key={item.id}>
            <div className="pending-icon">{item.kind === 'lineage' ? <History size={16} /> : item.kind === 'wikilink' || item.kind === 'ai-bridge' ? <GitBranch size={16} /> : <Link2Off size={16} />}</div>
            <div><span>{item.kind === 'lineage' ? '血缘待确认' : item.kind === 'wikilink' ? 'Obsidian 提及' : item.kind === 'ai-bridge' ? 'AI 桥梁草案' : '未绑定来源'}</span><strong>{item.targetTitle}</strong><small>{item.filePath}</small>
              {item.candidates?.map((candidate) => <p key={candidate.id}>{candidate.title} · {Math.round(candidate.confidence * 100)}% · {candidate.reason}</p>)}
            </div>
            <div className="pending-actions"><button title="接受" onClick={() => onAcceptPending(item.id)}><Check size={14} /></button><button title="稍后处理" onClick={() => onDismissPending(item.id)}><X size={14} /></button></div>
          </article>)}
          {pending.length === 0 && <div className="empty-pending"><Check size={20} />待整理区已清空</div>}
        </div>
      )}
    </aside>
  )
}
