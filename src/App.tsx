import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, Files, FolderOpen, LayoutGrid, Maximize2, Minus, MousePointer2, PanelRight, Pencil, RotateCcw, ScanSearch, Settings, Waypoints, X } from 'lucide-react'
import { FileTree } from './components/FileTree'
import { Inspector } from './components/Inspector'
import { KnowledgeCanvas } from './components/KnowledgeCanvas'
import { demoNodes, demoPending, demoRelations } from './domain/demo'
import { newId } from './domain/ids'
import { contentHash } from './domain/hash'
import { appendManagedLink, upsertKbId } from './domain/markdown'
import { reconcileManagedLink } from './domain/sync'
import type { IndexProgress, KnowledgeNode, KnowledgeRelation, PendingMention } from './domain/types'
import { GraphLedger } from './storage/graphLedger'
import { collectVaultFiles, indexInWorker, toPending } from './storage/indexVault'
import { DemoVaultAdapter, pickVault, type VaultAdapter } from './storage/vaultAdapter'
import { suggestBridge } from './services/bridgeAi'
import './styles.css'

function gridSuggestion(nodes: KnowledgeNode[]): Record<string, { x: number; y: number }> {
  const ordered = [...nodes].sort((a, b) => a.role.localeCompare(b.role) || a.title.localeCompare(b.title))
  return Object.fromEntries(ordered.map((node, index) => [node.id, {
    x: 80 + (index % 3) * 350,
    y: 90 + Math.floor(index / 3) * 190,
  }]))
}

export default function App() {
  const [nodes, setNodes] = useState<KnowledgeNode[]>(demoNodes)
  const [relations, setRelations] = useState<KnowledgeRelation[]>(demoRelations)
  const [pending, setPending] = useState<PendingMention[]>(demoPending)
  const [selectedId, setSelectedId] = useState('scrna')
  const [vault, setVault] = useState<VaultAdapter>(() => new DemoVaultAdapter())
  const [ledger, setLedger] = useState<GraphLedger>()
  const [progress, setProgress] = useState<IndexProgress>({ phase: 'idle', current: 0, total: 0 })
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'note' | 'pending'>('note')
  const [layout, setLayout] = useState<Record<string, { x: number; y: number }>>()
  const [notice, setNotice] = useState<string>()
  const [showFiles, setShowFiles] = useState(true)
  const [showInspector, setShowInspector] = useState(true)
  const [canvasTool, setCanvasTool] = useState<'select' | 'draw' | 'connect'>('select')
  const abortRef = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    void GraphLedger.open().then((next) => {
      const saved = next.load()
      if (saved.nodes.length) { setNodes(saved.nodes); setRelations(saved.relations) }
      else next.save(demoNodes, demoRelations, 'seed-demo')
      setLedger(next)
    })
  }, [])

  const selected = nodes.find((node) => node.id === selectedId)
  const persisted = (nextNodes: KnowledgeNode[], nextRelations = relations, kind = 'graph-change') => {
    setNodes(nextNodes); setRelations(nextRelations); ledger?.save(nextNodes, nextRelations, kind)
  }

  async function openVault() {
    try {
      const nextVault = await pickVault()
      const bytes = await nextVault.readBinary('.knowledge-bridge/graph.db')
      const nextLedger = await GraphLedger.open(bytes, (data) => nextVault.writeBinary('.knowledge-bridge/graph.db', data))
      const snapshot = nextLedger.load()
      setVault(nextVault); setLedger(nextLedger); setNodes(snapshot.nodes); setRelations(snapshot.relations); setPending([]); setSelectedId(snapshot.nodes[0]?.id ?? '')
      setNotice(`已打开 ${nextVault.name}`)
      await scanVault(nextVault, snapshot.nodes, nextLedger, snapshot.relations)
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setNotice((error as Error).message)
    }
  }

  async function scanVault(targetVault = vault, knownNodes = nodes, targetLedger = ledger, knownRelations = relations) {
    abortRef.current?.abort()
    const controller = new AbortController(); abortRef.current = controller
    try {
      const files = await collectVaultFiles(targetVault, controller.signal, setProgress)
      const indexed = await indexInWorker(files, controller.signal, setProgress)
      const discovered = toPending(indexed, new Set(knownNodes.map((node) => node.id)))
      let reconciled = knownRelations
      for (const relation of knownRelations.filter((item) => item.managed && item.status === 'formal')) {
        const snapshot = targetLedger?.getSnapshot(relation.id)
        const file = snapshot && files.find((item) => item.path === snapshot.filePath)
        if (!snapshot || !file) continue
        const decision = await reconcileManagedLink(file.content, snapshot)
        if (decision.kind === 'severed') {
          reconciled = reconciled.map((item) => item.id === relation.id ? { ...item, status: 'severed' } : item)
          if (decision.remainingTarget) discovered.push({ id: newId('mention'), filePath: file.path, sourceId: snapshot.fileId, targetTitle: decision.remainingTarget, kind: 'wikilink', raw: `[[${decision.remainingTarget}]]` })
        }
        if (decision.kind === 'retargeted') {
          reconciled = reconciled.map((item) => item.id === relation.id ? { ...item, status: 'historical' } : item)
          discovered.push({ id: newId('retarget'), filePath: file.path, sourceId: snapshot.fileId, targetTitle: decision.newTarget, kind: 'wikilink', raw: `[[${decision.newTarget}]]` })
        }
      }
      if (reconciled !== knownRelations) { setRelations(reconciled); targetLedger?.save(knownNodes, reconciled, 'sync-reconciliation') }
      setPending(discovered)
      setTab('pending')
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') setNotice((error as Error).message)
    }
  }

  function moveNode(id: string, x: number, y: number) {
    persisted(nodes.map((node) => node.id === id ? { ...node, x, y } : node), relations, 'manual-move')
  }

  async function saveNote(id: string, content: string) {
    const node = nodes.find((item) => item.id === id)
    if (!node) return
    const next = nodes.map((item) => item.id === id ? { ...item, content } : item)
    persisted(next, relations, 'note-save')
    if (node.path) await vault.write(node.path, content)
  }

  async function writeManagedLink(sourceId: string, targetId: string, existingId?: string) {
    const source = nodes.find((item) => item.id === sourceId)
    const target = nodes.find((item) => item.id === targetId)
    if (!source || !target || !ledger) return
    const path = source.path ?? `Notes/${source.title}.md`
    const current = source.path ? await vault.read(path) : upsertKbId(source.content, source.id)
    const edgeId = existingId ?? newId('edge')
    const nextContent = appendManagedLink(current, target.title, edgeId)
    await vault.write(path, nextContent)
    ledger.saveSnapshot({ edgeId, fileId: source.id, filePath: path, target: target.title, beforeHash: await contentHash(current), afterHash: await contentHash(nextContent), writtenAt: Date.now() })
    const nextNodes = nodes.map((item) => item.id === source.id ? { ...item, path, content: nextContent } : item)
    const nextRelations = existingId
      ? relations.map((item) => item.id === edgeId ? { ...item, status: 'formal' as const } : item)
      : [...relations, { id: edgeId, source: source.id, target: target.id, label: '提及', layer: 'cognitive' as const, status: 'formal' as const, managed: true }]
    persisted(nextNodes, nextRelations, existingId ? 'restore-managed-link' : 'create-managed-link')
    setNotice(existingId ? '托管双链已恢复并写回 Markdown' : '托管双链已写回 Markdown')
  }

  function restoreManagedLink(relationId: string) {
    const relation = relations.find((item) => item.id === relationId)
    if (relation) void writeManagedLink(relation.source, relation.target, relation.id)
  }

  async function askAi() {
    if (!selected) return
    const suggestion = await suggestBridge(selected, nodes)
    const candidate = suggestion && nodes.find((node) => node.id === suggestion.bridgeId)
    if (!candidate || !suggestion) return setNotice('当前知识库中没有可复用的 L2 候选')
    setPending((items) => [{
      id: newId('ai'), filePath: 'AI/桥梁草案', sourceId: selected.id,
      targetTitle: `${candidate.title} → ${selected.title}`, kind: 'ai-bridge', raw: 'AI inferred',
      candidates: [{ id: candidate.id, title: candidate.title, reason: suggestion.reason, confidence: suggestion.confidence }, ...suggestion.alternatives.map((item) => ({ id: item.id, title: nodes.find((node) => node.id === item.id)?.title ?? item.id, reason: item.reason, confidence: Math.max(0.4, suggestion.confidence - 0.12) }))],
    }, ...items])
    setTab('pending')
  }

  async function acceptPending(id: string) {
    const item = pending.find((entry) => entry.id === id)
    if (!item) return
    if (item.kind === 'ai-bridge' && item.sourceId && item.candidates?.[0]) {
      const relation: KnowledgeRelation = { id: newId('rel'), source: item.candidates[0].id, target: item.sourceId, label: '帮助解释', layer: 'cognitive', status: 'formal', confidence: item.candidates[0].confidence }
      persisted(nodes, [...relations, relation], 'accept-ai-bridge')
    } else if (item.kind === 'wikilink') {
      let target = nodes.find((node) => node.title === item.targetTitle)
      let nextNodes = nodes
      if (!target) {
        target = { id: newId('node'), title: item.targetTitle, role: 'L3', status: 'formal', content: `# ${item.targetTitle}\n`, x: 820, y: 520 }
        nextNodes = [...nodes, target]
      }
      if (item.sourceId) {
        const relation: KnowledgeRelation = { id: newId('rel'), source: item.sourceId, target: target.id, label: '提及', layer: 'cognitive', status: 'formal' }
        persisted(nextNodes, [...relations, relation], 'accept-wikilink')
      } else persisted(nextNodes, relations, 'accept-wikilink-node')
    } else {
      const fileContent = await vault.read(item.filePath)
      const id = newId('node')
      const content = upsertKbId(fileContent, id)
      await vault.write(item.filePath, content)
      const node: KnowledgeNode = { id, title: item.targetTitle, role: 'L3', status: 'formal', content, path: item.filePath, x: 760, y: 520 }
      persisted([...nodes, node], relations, 'bind-new-source')
    }
    setPending((items) => items.filter((entry) => entry.id !== id))
  }

  function applyMigration(node: KnowledgeNode) {
    const replacementId = newId('l2')
    const replacement: KnowledgeNode = { id: replacementId, title: '动态细胞状态模型', role: 'L2', status: 'formal', content: '# 动态细胞状态模型\n\n替代冻结机制的高置信路径族。', x: node.x + 260, y: node.y }
    const migrated = relations.map((relation) => {
      if (relation.source !== node.id && relation.target !== node.id) return relation
      if ((relation.confidence ?? 0.9) < 0.85) return { ...relation, status: 'frozen' as const }
      return { ...relation, id: newId('migrated'), source: relation.source === node.id ? replacementId : relation.source, target: relation.target === node.id ? replacementId : relation.target }
    })
    persisted([...nodes, replacement], migrated, 'l2-migration')
    setSelectedId(replacementId); setNotice('已迁移高置信路径；该事务可整体撤销')
  }

  function undo() {
    const snapshot = ledger?.undo()
    if (snapshot) { setNodes(snapshot.nodes); setRelations(snapshot.relations); setNotice('已撤销上一项图谱操作') }
  }

  return <div className="app-shell pg-shell">
    <header className="pg-titlebar">
      <div className="pg-appmark">KB</div>
      <nav><button>文件</button><button>编辑</button><button>视图</button><button>知识</button><button>帮助</button></nav>
      <div className="pg-drag-title">Knowledge Bridge · {vault.name}</div>
      <div className="pg-window-tools"><button title="设置"><Settings size={13} /></button><button><Minus size={13} /></button><button><Maximize2 size={12} /></button><button className="close"><X size={13} /></button></div>
    </header>
    <div className="pg-tabs">
      <button className="pg-menu-button" onClick={openVault}><FolderOpen size={14} /></button>
      <button className="pg-tab active"><span className="tab-dot" />知识桥梁图 <i>●</i><X size={12} /></button>
      <button className="pg-tab" onClick={() => setShowFiles(true)}><Files size={12} />Vault 文件</button>
      <div className="pg-tabs-spacer" />
      <button className="pg-lens"><span>科研共识</span><ChevronDown size={11} /></button>
    </div>
    {layout && <div className="layout-banner"><LayoutGrid size={15} /><span>正在预览建议坐标，当前物理坐标尚未改变。</span><button onClick={() => { const next = nodes.map((node) => ({ ...node, ...layout[node.id] })); persisted(next, relations, 'accept-layout'); setLayout(undefined) }}><Check size={14} /> 采纳布局</button><button onClick={() => setLayout(undefined)}><X size={14} /> 取消</button></div>}
    {notice && <button className="notice" onClick={() => setNotice(undefined)}>{notice}<X size={13} /></button>}
    <main className="workspace pg-stage">
      <KnowledgeCanvas nodes={nodes} relations={relations} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setTab('note') }} onMove={moveNode} suggestions={layout} />
      {showFiles && <div className="pg-floating-panel pg-files-window"><div className="pg-panel-title"><span>Vault</span><button onClick={() => setShowFiles(false)}><X size={13} /></button></div><FileTree vaultName={vault.name} nodes={nodes} selectedId={selectedId} search={search} onSearch={setSearch} onSelect={(id) => { setSelectedId(id); setTab('note'); setShowInspector(true) }} /></div>}
      {showInspector && <div className="pg-floating-panel pg-inspector-window"><div className="pg-panel-title"><span>{tab === 'pending' ? '待整理' : '节点详情'}</span><button onClick={() => setShowInspector(false)}><X size={13} /></button></div><Inspector node={selected} nodes={nodes} relations={relations} pending={pending} progress={progress} activeTab={tab} onTab={setTab} onSave={(id, content) => void saveNote(id, content)} onAcceptPending={(id) => void acceptPending(id)} onDismissPending={(id) => setPending((items) => items.filter((item) => item.id !== id))} onApplyMigration={applyMigration} onCreateManagedLink={(source, target) => void writeManagedLink(source, target)} onRestoreLink={restoreManagedLink} /></div>}
      <div className="pg-left-tools">
        <button className={showFiles ? 'active' : ''} title="Vault 文件" onClick={() => setShowFiles((value) => !value)}><Files size={17} /></button>
        <button title="后台索引" onClick={() => void scanVault()}><ScanSearch size={17} /></button>
        <button title="AI 搭桥" onClick={() => { void askAi(); setShowInspector(true) }}><Bot size={17} /></button>
        <button title="撤销" onClick={undo}><RotateCcw size={17} /></button>
      </div>
      <div className="pg-right-tools">
        <button className={showInspector && tab === 'note' ? 'active' : ''} title="节点详情" onClick={() => { setTab('note'); setShowInspector(true) }}><PanelRight size={17} /></button>
        <button className={showInspector && tab === 'pending' ? 'active' : ''} title={`待整理 ${pending.length}`} onClick={() => { setTab('pending'); setShowInspector(true) }}><Bot size={17} /><em>{pending.length}</em></button>
        <button title="布局建议" onClick={() => setLayout(gridSuggestion(nodes))}><LayoutGrid size={17} /></button>
      </div>
      <div className="pg-bottom-tools">
        <button className={canvasTool === 'select' ? 'active' : ''} title="选择与移动" onClick={() => setCanvasTool('select')}><MousePointer2 size={18} /></button>
        <button className={canvasTool === 'draw' ? 'active' : ''} title="自由绘制" onClick={() => setCanvasTool('draw')}><Pencil size={18} /></button>
        <button className={canvasTool === 'connect' ? 'active' : ''} title="连接与剪断" onClick={() => setCanvasTool('connect')}><Waypoints size={18} /></button>
      </div>
      <div className="pg-status"><span>{nodes.length} 节点</span><span>{relations.length} 关系</span><span>{progress.phase === 'scanning' ? '正在索引…' : '已保存到本地'}</span></div>
    </main>
  </div>
}
