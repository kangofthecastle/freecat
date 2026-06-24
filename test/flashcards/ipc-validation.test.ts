import { describe, it, expect } from 'vitest'
import { deckSetIdSchema, listCardsSchema, getCardSchema } from '../../src/main/ipc/flashcards'

describe('flashcards IPC schemas', () => {
  it('deckSetIdSchema requires a positive int', () => {
    expect(deckSetIdSchema.safeParse(5).success).toBe(true)
    expect(deckSetIdSchema.safeParse(-1).success).toBe(false)
    expect(deckSetIdSchema.safeParse('5').success).toBe(false)
  })
  it('listCardsSchema validates deckId + optional paging', () => {
    expect(listCardsSchema.safeParse({ deckId: 1 }).success).toBe(true)
    expect(listCardsSchema.safeParse({ deckId: 1, afterId: 10, limit: 50 }).success).toBe(true)
    expect(listCardsSchema.safeParse({ deckId: 1, limit: 9999 }).success).toBe(false)
    expect(listCardsSchema.safeParse({}).success).toBe(false)
  })
  it('getCardSchema requires a positive int', () => {
    expect(getCardSchema.safeParse(7).success).toBe(true)
    expect(getCardSchema.safeParse(0).success).toBe(false)
    expect(getCardSchema.safeParse('7').success).toBe(false)
  })
})
