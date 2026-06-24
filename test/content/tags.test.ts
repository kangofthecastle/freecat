import { describe, it, expect } from 'vitest'
import { CONTENT_TAG_VOCAB, isKnownTag } from '../../src/main/content/tags'

describe('content tag vocab', () => {
  it('seeds the 31 AAMC categories under vocab aamc', () => {
    const aamc = CONTENT_TAG_VOCAB.filter((t) => t.vocab === 'aamc')
    expect(aamc).toHaveLength(31)
    expect(aamc.find((t) => t.code === '1A')!.title).toMatch(/proteins/i)
  })
  it('validates known/unknown tags', () => {
    expect(isKnownTag({ vocab: 'aamc', code: '4D' })).toBe(true)
    expect(isKnownTag({ vocab: 'aamc', code: 'ZZ' })).toBe(false)
    expect(isKnownTag({ vocab: 'kaplan', code: '1A' })).toBe(false)
  })
})
