export const MANAGED_LINK_PATTERN = /\[\[([^\]]+)\]\]\s*<!--\s*kb-link:([\w-]+)\s*-->/g
export const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g

export interface ParsedLink {
  target: string
  edgeId?: string
  raw: string
  index: number
}

export function parseKbId(content: string): string | undefined {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)
  return frontmatter?.[1].match(/^kb-id:\s*['"]?([^'"\n]+)['"]?\s*$/m)?.[1].trim()
}

export function parseTitle(content: string, path: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

export function parseLinks(content: string): ParsedLink[] {
  const managedRanges: Array<[number, number]> = []
  const links: ParsedLink[] = []
  for (const match of content.matchAll(MANAGED_LINK_PATTERN)) {
    managedRanges.push([match.index, match.index + match[0].length])
    links.push({ target: match[1].trim(), edgeId: match[2], raw: match[0], index: match.index })
  }
  for (const match of content.matchAll(WIKILINK_PATTERN)) {
    if (managedRanges.some(([start, end]) => match.index >= start && match.index < end)) continue
    links.push({ target: match[1].trim(), raw: match[0], index: match.index })
  }
  return links.sort((a, b) => a.index - b.index)
}

export function appendManagedLink(content: string, target: string, edgeId: string): string {
  const suffix = content.endsWith('\n') ? '' : '\n'
  return `${content}${suffix}\n[[${target}]] <!-- kb-link:${edgeId} -->\n`
}

export function upsertKbId(content: string, id: string): string {
  if (parseKbId(content)) return content
  if (content.startsWith('---\n')) return content.replace('---\n', `---\nkb-id: ${id}\n`)
  return `---\nkb-id: ${id}\n---\n\n${content}`
}
