import { ChevronRight, FileText, Folder, Search } from 'lucide-react'
import type { KnowledgeNode } from '../domain/types'

interface Props {
  vaultName: string
  nodes: KnowledgeNode[]
  selectedId?: string
  search: string
  onSearch: (value: string) => void
  onSelect: (id: string) => void
}

export function FileTree({ vaultName, nodes, selectedId, search, onSearch, onSelect }: Props) {
  const groups = nodes.filter((node) => node.title.toLowerCase().includes(search.toLowerCase())).reduce<Record<string, KnowledgeNode[]>>((acc, node) => {
    const folder = node.path?.split('/').slice(0, -1).join('/') || (node.role === 'L4' ? 'Sources' : 'Notes')
    acc[folder] = [...(acc[folder] ?? []), node]
    return acc
  }, {})
  return (
    <aside className="file-panel">
      <div className="vault-title"><div className="vault-mark">KB</div><div><strong>{vaultName}</strong><span>本地知识库</span></div></div>
      <label className="search-box"><Search size={15} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索笔记与概念" /></label>
      <div className="tree-scroll">
        {Object.entries(groups).map(([folder, items]) => (
          <div className="tree-group" key={folder}>
            <div className="tree-folder"><ChevronRight size={13} /><Folder size={15} /> {folder}</div>
            {items.map((node) => (
              <button className={`tree-file ${selectedId === node.id ? 'active' : ''}`} key={node.id} onClick={() => onSelect(node.id)}>
                <FileText size={14} /><span>{node.title}</span><em>{node.role}</em>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="vault-footer"><span className="status-dot" /> {nodes.length} 个正式节点</div>
    </aside>
  )
}
