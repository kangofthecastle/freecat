import { describe, expect, test } from 'vitest'
import { rollSpecies } from '../../src/shared/gamification/hatch'
import type { Species } from '../../src/shared/gamification/types'

const SPECIES: Pick<Species, 'key' | 'rarity'>[] = [
  { key: 'a', rarity: 'common' },   // weight 60
  { key: 'b', rarity: 'uncommon' }, // weight 30
  { key: 'c', rarity: 'rare' },     // weight 10
]
// total weight = 100

describe('rollSpecies (weighted by rarity)', () => {
  test('rng 0 → first species', () => expect(rollSpecies(() => 0, SPECIES)).toBe('a'))
  test('rng just below common cutoff → common', () => expect(rollSpecies(() => 0.59, SPECIES)).toBe('a'))
  test('rng in uncommon band → uncommon', () => expect(rollSpecies(() => 0.7, SPECIES)).toBe('b'))
  test('rng in rare band → rare', () => expect(rollSpecies(() => 0.95, SPECIES)).toBe('c'))
  test('rng at the very top → last species (no overflow)', () => expect(rollSpecies(() => 0.999999, SPECIES)).toBe('c'))
})
