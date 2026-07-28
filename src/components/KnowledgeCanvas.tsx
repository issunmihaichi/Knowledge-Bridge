import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Anchor, BookOpen, LockKeyhole, Microscope, Sparkles } from 'lucide-react'
import type { KnowledgeNode, KnowledgeRelation } from '../domain/types'

interface CardData extends Record<string, unknown> {
  knowledge: KnowledgeNode
  relationCount: number
  onHover: (node: KnowledgeNode | null, position?: { x: number; y: number }) => void
}

const roleIcons = { L1: Anchor, L2: Sparkles, L3: Microscope, L4: BookOpen }

function KnowledgeCard({ data, selected }: NodeProps<Node<CardData>>) {
  const item = data.knowledge
  const Icon = item.status === 'frozen' ? LockKeyhole : roleIcons[item.role]
  const timer = useRef<number | undefined>(undefined)

  return (
    <div
      className={`knowledge-node role-${item.role.toLowerCase()} status-${item.status} ${selected ? 'is-selected' : ''}`}
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        timer.current = window.setTimeout(() => data.onHover(item, { x: rect.right + 12, y: rect.top }), 800)
      }}
      onMouseLeave={() => { window.clearTimeout(timer.current); data.onHover(null) }}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-kicker"><Icon size={13} /> {item.status === 'frozen' ? '已冻结' : item.role}</div>
      <strong>{item.title}</strong>
      <div className="node-meta">{data.relationCount} 条关系{item.hiddenCount ? ` · 历史路径 ${item.hiddenCount}` : ''}</div>
      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  )
}

const nodeTypes = { knowledge: KnowledgeCard }

function bundleRelations(relations: KnowledgeRelation[]): KnowledgeRelation[] {
  const groups = new Map<string, KnowledgeRelation[]>()
  for (const relation of relations.filter((item) => item.status !== 'severed' && item.status !== 'historical')) {
    const key = `${relation.source}->${relation.target}`
    groups.set(key, [...(groups.get(key) ?? []), relation])
  }
  return [...groups.values()].map((group) => {
    const logical = group.filter((item) => item.layer === 'logical')
    if (logical.length === 0) return group[0]
    if (logical.length === 1) return logical[0]
    const opposing = logical.some((a) => logical.some((b) =>
      (a.label.includes('促进') && b.label.includes('抑制')) ||
      (a.label.includes('导致') && b.label.includes('阻止')),
    ))
    const conditional = logical.some((item) => Boolean(item.context))
    return {
      ...logical[0],
      id: `bundle:${logical.map((item) => item.id).join(':')}`,
      label: opposing ? `冲突 ×${logical.length}` : conditional ? `条件分支 ×${logical.length}` : `兼容 ×${logical.length}`,
    }
  })
}

interface Props {
  nodes: KnowledgeNode[]
  relations: KnowledgeRelation[]
  selectedId?: string
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
  suggestions?: Record<string, { x: number; y: number }>
}

export function KnowledgeCanvas({ nodes, relations, selectedId, onSelect, onMove, suggestions }: Props) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 0.82 })
  const [preview, setPreview] = useState<{ node: KnowledgeNode; x: number; y: number } | null>(null)
  const visibleIds = useMemo(() => new Set(nodes
    .filter((node) => viewport.zoom >= 0.48 || node.role === 'L1' || node.role === 'L2')
    .map((node) => node.id)), [nodes, viewport.zoom])
  const counts = useMemo(() => relations.reduce<Record<string, number>>((result, item) => {
    result[item.source] = (result[item.source] ?? 0) + 1
    result[item.target] = (result[item.target] ?? 0) + 1
    return result
  }, {}), [relations])
  const handleHover = useCallback((node: KnowledgeNode | null, position?: { x: number; y: number }) => {
    setPreview(node && position ? { node, ...position } : null)
  }, [])

  const flowNodes = useMemo<Node<CardData>[]>(() => {
    const primary = nodes
    .filter((node) => visibleIds.has(node.id))
    .map((node) => ({
      id: node.id, type: 'knowledge', position: { x: node.x, y: node.y },
      selected: node.id === selectedId, draggable: node.status !== 'frozen',
      data: { knowledge: node, relationCount: counts[node.id] ?? 0, onHover: handleHover },
    }))
    const ghosts = suggestions ? nodes.filter((node) => suggestions[node.id] && visibleIds.has(node.id)).map((node) => ({
      id: `suggestion:${node.id}`, type: 'knowledge', position: suggestions[node.id],
      selectable: false, draggable: false, className: 'suggestion-node',
      data: { knowledge: node, relationCount: counts[node.id] ?? 0, onHover: () => undefined },
    })) : []
    return [...primary, ...ghosts]
  }, [nodes, visibleIds, selectedId, counts, handleHover, suggestions])

  const flowEdges = useMemo<Edge[]>(() => bundleRelations(relations)
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge) => ({
      id: edge.id, source: edge.source, target: edge.target, label: edge.label,
      className: edge.layer === 'cognitive' ? 'cognitive-edge' : edge.status === 'frozen' ? 'frozen-edge' : 'logical-edge',
      animated: edge.status === 'pending',
      markerEnd: edge.layer === 'logical' ? { type: MarkerType.ArrowClosed, width: 14, height: 14 } : undefined,
      style: edge.layer === 'cognitive' ? { strokeDasharray: '5 5' } : undefined,
    })), [relations, visibleIds])

  return (
    <div className="canvas-shell" onScroll={() => setPreview(null)}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        viewport={viewport}
        onViewportChange={setViewport}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDragStop={(_, node) => onMove(node.id, node.position.x, node.position.y)}
        minZoom={0.25}
        maxZoom={1.8}
        onlyRenderVisibleElements
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 0.92 }}
      >
        <Background color="#c8cbc4" gap={24} size={1} />
      </ReactFlow>
      <div className="zoom-hint">{viewport.zoom < 0.48 ? '概览层 · L3/L4 已隐藏' : '知识层 · 全部节点'}</div>
      {preview && (
        <div className="hover-preview" style={{ left: Math.min(preview.x, window.innerWidth - 310), top: Math.max(64, preview.y) }}>
          <span>{preview.node.role} · {preview.node.status === 'missing-source' ? '来源缺失' : '本地笔记'}</span>
          <strong>{preview.node.title}</strong>
          <p>{preview.node.content.split('\n').filter((line) => line && !line.startsWith('#') && line !== '---' && !line.startsWith('kb-id')).slice(0, 3).join(' ') || '暂无正文'}</p>
          <small>{counts[preview.node.id] ?? 0} 条关系</small>
        </div>
      )}
    </div>
  )
}
