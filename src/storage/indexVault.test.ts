import { describe, expect, it } from 'vitest'
import { toPending } from './indexVault'

describe('large vault pending isolation', () => {
  it('keeps 5000 newly discovered notes out of the formal graph', () => {
    const indexed = Array.from({ length: 5000 }, (_, index) => ({
      path: `Notes/note-${index}.md`, title: `Note ${index}`, links: [],
    }))
    const started = performance.now()
    const pending = toPending(indexed, new Set())
    expect(pending).toHaveLength(5000)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
