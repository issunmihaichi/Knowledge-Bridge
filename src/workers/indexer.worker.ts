import { parseKbId, parseLinks, parseTitle } from '../domain/markdown'

interface ScanInput { path: string; content: string; modifiedAt: number; size: number }

self.onmessage = (event: MessageEvent<{ files: ScanInput[] }>) => {
  const results = event.data.files.map((file, index) => {
    const result = {
      path: file.path,
      kbId: parseKbId(file.content),
      title: parseTitle(file.content, file.path),
      links: parseLinks(file.content),
      modifiedAt: file.modifiedAt,
      size: file.size,
    }
    if (index % 100 === 0) self.postMessage({ type: 'progress', current: index, total: event.data.files.length })
    return result
  })
  self.postMessage({ type: 'complete', results, total: event.data.files.length })
}
