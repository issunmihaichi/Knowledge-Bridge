import type { IndexProgress, PendingMention, VaultFile } from '../domain/types'
import type { VaultAdapter } from './vaultAdapter'
import { newId } from '../domain/ids'

interface IndexedFile {
  path: string
  kbId?: string
  title: string
  links: Array<{ target: string; edgeId?: string; raw: string }>
}

export async function collectVaultFiles(
  adapter: VaultAdapter,
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<VaultFile[]> {
  const files: VaultFile[] = []
  let current = 0
  onProgress({ phase: 'scanning', current: 0, total: 0 })
  for await (const file of adapter.listMarkdown(signal)) {
    files.push(file)
    current += 1
    if (current % 50 === 0) onProgress({ phase: 'scanning', current, total: 0 })
  }
  return files
}

export function indexInWorker(
  files: VaultFile[],
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<IndexedFile[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/indexer.worker.ts', import.meta.url), { type: 'module' })
    signal.addEventListener('abort', () => {
      worker.terminate()
      onProgress({ phase: 'cancelled', current: 0, total: files.length })
      reject(new DOMException('Index cancelled', 'AbortError'))
    }, { once: true })
    worker.onerror = (event) => { worker.terminate(); reject(event.error) }
    worker.onmessage = (event) => {
      if (event.data.type === 'progress') onProgress({ phase: 'scanning', current: event.data.current, total: event.data.total })
      if (event.data.type === 'complete') {
        worker.terminate()
        onProgress({ phase: 'complete', current: event.data.total, total: event.data.total })
        resolve(event.data.results)
      }
    }
    worker.postMessage({ files })
  })
}

export function toPending(indexed: IndexedFile[], knownIds: Set<string>): PendingMention[] {
  const pending: PendingMention[] = []
  for (const file of indexed) {
    if (!file.kbId || !knownIds.has(file.kbId)) {
      pending.push({ id: newId('pending'), filePath: file.path, targetTitle: file.title, kind: file.kbId ? 'orphan' : 'lineage', raw: file.kbId ?? 'kb-id missing' })
    }
    for (const link of file.links) {
      if (!link.edgeId) pending.push({ id: newId('mention'), filePath: file.path, sourceId: file.kbId, targetTitle: link.target, kind: 'wikilink', raw: link.raw })
    }
  }
  return pending
}
