import { describe, it, expect } from 'vitest'
import { DISCIPLINES, TOPICS, AAMC_CODES, AAMC_CONTENT_CATEGORIES } from '../../src/main/db/seed/taxonomy-data'

describe('taxonomy seed data', () => {
  it('has 5 disciplines and 25 topics', () => {
    expect(DISCIPLINES).toHaveLength(5)
    expect(TOPICS).toHaveLength(25)
  })

  it('uses unique topic slugs', () => {
    const slugs = TOPICS.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('every topic belongs to a known discipline', () => {
    const known = new Set(DISCIPLINES.map((d) => d.slug))
    for (const t of TOPICS) expect(known.has(t.discipline)).toBe(true)
  })

  it('every AAMC code on a topic is a real content category', () => {
    for (const t of TOPICS) {
      expect(t.aamcCodes.length).toBeGreaterThan(0)
      for (const code of t.aamcCodes) expect(AAMC_CODES.has(code)).toBe(true)
    }
  })

  it('AAMC reference has unique codes', () => {
    expect(AAMC_CODES.size).toBe(AAMC_CONTENT_CATEGORIES.length)
  })

  it('every topic slug is prefixed by its discipline', () => {
    for (const t of TOPICS) expect(t.slug.startsWith(t.discipline + '.')).toBe(true)
  })
})
