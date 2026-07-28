import { describe, expect, it } from 'vitest'
import { contentHash } from './hash'
import { reconcileManagedLink } from './sync'
import type { ManagedLinkSnapshot } from './types'

async function snapshot(content: string): Promise<ManagedLinkSnapshot> {
  return {
    edgeId: 'edge_1', fileId: 'file_1', filePath: 'Notes/Test.md', target: '中心法则',
    beforeHash: 'old', afterHash: await contentHash(content), writtenAt: Date.now(),
  }
}

describe('managed link reconciliation', () => {
  const written = '# Test\n[[中心法则]] <!-- kb-link:edge_1 -->\n'

  it('acknowledges the app own write without generating work', async () => {
    expect(await reconcileManagedLink(written, await snapshot(written))).toEqual({ kind: 'self-write' })
  })

  it('marks a user-deleted managed link as severed', async () => {
    expect(await reconcileManagedLink('# Test\n', await snapshot(written))).toEqual({ kind: 'severed', edgeId: 'edge_1', remainingTarget: undefined })
  })

  it('keeps the plain wikilink as a new user-owned mention when only the marker is removed', async () => {
    expect(await reconcileManagedLink('# Test\n[[中心法则]]\n', await snapshot(written))).toEqual({ kind: 'severed', edgeId: 'edge_1', remainingTarget: '中心法则' })
  })

  it('moves a retargeted managed link into a new pending decision', async () => {
    expect(await reconcileManagedLink('# Test\n[[反馈调节]] <!-- kb-link:edge_1 -->\n', await snapshot(written))).toEqual({
      kind: 'retargeted', edgeId: 'edge_1', oldTarget: '中心法则', newTarget: '反馈调节',
    })
  })
})
