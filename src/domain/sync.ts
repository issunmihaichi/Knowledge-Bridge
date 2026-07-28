import type { KnowledgeRelation, ManagedLinkSnapshot } from './types'
import { contentHash } from './hash'
import { parseLinks } from './markdown'

export type SyncDecision =
  | { kind: 'self-write' }
  | { kind: 'unchanged' }
  | { kind: 'severed'; edgeId: string; remainingTarget?: string }
  | { kind: 'retargeted'; edgeId: string; oldTarget: string; newTarget: string }

export async function reconcileManagedLink(
  content: string,
  snapshot: ManagedLinkSnapshot,
): Promise<SyncDecision> {
  if ((await contentHash(content)) === snapshot.afterHash) return { kind: 'self-write' }
  const links = parseLinks(content)
  const managed = links.find((link) => link.edgeId === snapshot.edgeId)
  if (managed?.target === snapshot.target) return { kind: 'unchanged' }
  if (managed) {
    return { kind: 'retargeted', edgeId: snapshot.edgeId, oldTarget: snapshot.target, newTarget: managed.target }
  }
  const unmarked = links.find((link) => !link.edgeId && link.target === snapshot.target)
  return { kind: 'severed', edgeId: snapshot.edgeId, remainingTarget: unmarked?.target }
}

export function severRelation(relations: KnowledgeRelation[], edgeId: string): KnowledgeRelation[] {
  return relations.map((relation) =>
    relation.id === edgeId ? { ...relation, status: 'severed' as const } : relation,
  )
}
