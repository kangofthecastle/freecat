import { describe, it, expect } from 'vitest'
import type { AvailabilityQuestionDto } from '../../src/shared/dto'
import { availableCount, emptyHint, refineCounts, scopeCounts } from '../../src/renderer/src/qbank/availability'

const q = (over: Partial<AvailabilityQuestionDto>): AvailabilityQuestionDto => ({
  id: 'x', topic: 'physics.mechanics', discipline: 'physics', tags: [], incorrect: false, flagged: false, ...over
})

const ROWS: AvailabilityQuestionDto[] = [
  q({ id: 'a', tags: ['aamc:4A'], incorrect: true }),
  q({ id: 'b', tags: ['aamc:4A', 'aamc:4B'] }),
  q({ id: 'c', topic: 'physics.fluids', flagged: true }),
  q({ id: 'd', topic: 'biochem.enzymes', discipline: 'biochem', incorrect: true, flagged: true })
]

const none: ReadonlySet<string> = new Set()

describe('scopeCounts (one pass → every scope radio)', () => {
  it('splits totals by discipline and topic under refine:all', () => {
    const c = scopeCounts(ROWS, 'all', none)
    expect(c.total).toBe(4)
    expect(c.byDiscipline.get('physics')).toBe(3)
    expect(c.byDiscipline.get('biochem')).toBe(1)
    expect(c.byTopic.get('physics.mechanics')).toBe(2)
  })

  it('refine and tag filters both narrow the counts (tags are OR within the set)', () => {
    expect(scopeCounts(ROWS, 'incorrect', none).total).toBe(2)
    expect(scopeCounts(ROWS, 'flagged', none).byDiscipline.get('physics')).toBe(1)
    const tagged = scopeCounts(ROWS, 'all', new Set(['aamc:4A', 'aamc:4B']))
    expect(tagged.total).toBe(2) // a + b; a question passes with ≥1 selected tag
  })
})

describe('refineCounts (labels the three refine buttons for the current scope)', () => {
  it('counts each refine pool inside the scope', () => {
    expect(refineCounts(ROWS, { scopeKind: 'mixed' }, none)).toEqual({ all: 4, incorrect: 2, flagged: 2 })
    expect(refineCounts(ROWS, { scopeKind: 'discipline', scopeCode: 'physics' }, none)).toEqual({ all: 3, incorrect: 1, flagged: 1 })
    expect(refineCounts(ROWS, { scopeKind: 'topic', scopeCode: 'physics.mechanics' }, none)).toEqual({ all: 2, incorrect: 1, flagged: 0 })
  })
})

describe('availableCount (the Start button gate)', () => {
  it('composes scope × refine × tags exactly like the session planner eligibility', () => {
    expect(availableCount(ROWS, { scopeKind: 'mixed' }, 'all', none)).toBe(4)
    expect(availableCount(ROWS, { scopeKind: 'topic', scopeCode: 'physics.mechanics' }, 'incorrect', new Set(['aamc:4A']))).toBe(1)
    expect(availableCount(ROWS, { scopeKind: 'topic', scopeCode: 'physics.mechanics' }, 'flagged', none)).toBe(0)
  })
})

describe('emptyHint', () => {
  it('is refine-specific and mentions tags only when they narrowed the pool', () => {
    expect(emptyHint('incorrect', false)).toContain('answer more questions')
    expect(emptyHint('flagged', false)).toContain('flag questions')
    expect(emptyHint('all', true)).toContain('selected categories')
    expect(emptyHint('all', false)).not.toContain('selected categories')
  })
})
