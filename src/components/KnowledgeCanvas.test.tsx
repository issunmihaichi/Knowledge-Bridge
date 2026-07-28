import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KnowledgeCanvas } from './KnowledgeCanvas'
import { demoNodes, demoRelations } from '../domain/demo'

describe('KnowledgeCanvas', () => {
  it('does not mutate physical coordinates while rendering semantic layers', () => {
    const before = demoNodes.map(({ id, x, y }) => ({ id, x, y }))
    render(<div style={{ width: 900, height: 600 }}><KnowledgeCanvas nodes={demoNodes} relations={demoRelations} onSelect={() => undefined} onMove={() => undefined} /></div>)
    expect(demoNodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(before)
  })
})
