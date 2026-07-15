import { describe, it, expect } from 'vitest'
import { deckSetIdSchema, listCardsSchema, getCardSchema, reviewDeckIdSchema, reviewCardSchema } from '../../src/main/ipc/flashcards'

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
  it('reviewDeckIdSchema requires a positive int', () => {
    expect(reviewDeckIdSchema.safeParse(3).success).toBe(true)
    expect(reviewDeckIdSchema.safeParse(-2).success).toBe(false)
    expect(reviewDeckIdSchema.safeParse(0).success).toBe(false)
    expect(reviewDeckIdSchema.safeParse('3').success).toBe(false)
  })
  it('reviewCardSchema requires a positive cardId and a rating in 1..4', () => {
    expect(reviewCardSchema.safeParse({ cardId: 1, rating: 1 }).success).toBe(true)
    expect(reviewCardSchema.safeParse({ cardId: 1, rating: 4 }).success).toBe(true)
    expect(reviewCardSchema.safeParse({ cardId: 1, rating: 0 }).success).toBe(false)
    expect(reviewCardSchema.safeParse({ cardId: 1, rating: 5 }).success).toBe(false)
    expect(reviewCardSchema.safeParse({ cardId: 1, rating: 2.5 }).success).toBe(false)
    expect(reviewCardSchema.safeParse({ cardId: 0, rating: 3 }).success).toBe(false)
    expect(reviewCardSchema.safeParse({ cardId: 1 }).success).toBe(false)
  })
})
