import { describe, expect, it } from 'vitest'
import { appendManagedLink, parseKbId, parseLinks, upsertKbId } from './markdown'

describe('markdown identity and links', () => {
  it('parses managed and unmarked links independently', () => {
    const links = parseLinks('[[中心法则]] <!-- kb-link:edge_1 -->\n[[反馈调节]]')
    expect(links).toEqual([
      expect.objectContaining({ target: '中心法则', edgeId: 'edge_1' }),
      expect.objectContaining({ target: '反馈调节' }),
    ])
  })

  it('adds a stable kb-id without replacing frontmatter', () => {
    const content = upsertKbId('---\ntags: [biology]\n---\n# Note', 'node_1')
    expect(parseKbId(content)).toBe('node_1')
    expect(content).toContain('tags: [biology]')
  })

  it('writes a stable managed link marker', () => {
    expect(appendManagedLink('# Note', '中心法则', 'edge_1')).toContain('[[中心法则]] <!-- kb-link:edge_1 -->')
  })
})
