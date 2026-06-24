import { describe, it, expect } from 'vitest'
import { composeOutline, deriveStatus } from '../../src/main/content/outline'
import type { LessonProgress } from '../../src/main/db/schema'

const disciplines = [
  {
    discipline: 'biochem' as const,
    title: 'Biochemistry',
    topics: [
      { slug: 'biochem.enzymes', title: 'Enzymes', aamcCodes: ['1A'] },
      { slug: 'biochem.metabolic-reactions', title: 'Metabolic Reactions', aamcCodes: ['1D'] }
    ]
  }
]
const lessons = [{ slug: 'biochem.enzymes', title: 'Enzymes', summary: 'Catalysts' }]

function progress(partial: Partial<LessonProgress> & { lessonSlug: string }): LessonProgress {
  return { id: 1, completedAt: null, lastViewedAt: new Date(), countedForReward: false, ...partial }
}

describe('deriveStatus', () => {
  it('maps rows to status', () => {
    expect(deriveStatus(undefined)).toBe('not-started')
    expect(deriveStatus(progress({ lessonSlug: 'x' }))).toBe('in-progress')
    expect(deriveStatus(progress({ lessonSlug: 'x', completedAt: new Date() }))).toBe('completed')
  })
})

describe('composeOutline', () => {
  it('marks authored topics available and counts totals against them', () => {
    const out = composeOutline(disciplines, lessons, [])
    const group = out.groups[0]
    if (!group) throw new Error('no group')
    expect(group.total).toBe(1) // only the enzymes lesson is authored
    expect(group.lessons).toHaveLength(2) // both topics shown
    const enzymes = group.lessons.find((l) => l.slug === 'biochem.enzymes')
    const metabolic = group.lessons.find((l) => l.slug === 'biochem.metabolic-reactions')
    expect(enzymes?.available).toBe(true)
    expect(metabolic?.available).toBe(false)
  })

  it('counts completed lessons', () => {
    const out = composeOutline(disciplines, lessons, [progress({ lessonSlug: 'biochem.enzymes', completedAt: new Date() })])
    expect(out.completed).toBe(1)
    expect(out.total).toBe(1)
    expect(out.groups[0]?.completed).toBe(1)
  })
})
