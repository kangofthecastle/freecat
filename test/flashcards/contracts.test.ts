// test/flashcards/contracts.test.ts
import { describe, it, expect } from 'vitest'
import { CH } from '../../src/shared/channels'

describe('flashcards channels', () => {
  it('defines the six M1 channels, all unique', () => {
    const fc = [CH.fcImportDeck, CH.fcListDeckSets, CH.fcListDecks, CH.fcListCards, CH.fcGetCard, CH.fcDeleteDeckSet]
    expect(fc).toEqual([
      'flashcards:importDeck', 'flashcards:listDeckSets', 'flashcards:listDecks',
      'flashcards:listCards', 'flashcards:getCard', 'flashcards:deleteDeckSet'
    ])
    expect(new Set(Object.values(CH)).size).toBe(Object.values(CH).length)
  })
})
