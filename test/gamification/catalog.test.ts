import { describe, expect, test } from 'vitest'
import { ITEMS, SPECIES } from '../../src/shared/gamification/catalog'

const SLOTS = ['head', 'face', 'neck'] as const

describe('catalog integrity', () => {
  test('six species, no slime, unique keys, non-empty names', () => {
    expect(SPECIES).toHaveLength(6)
    expect(SPECIES.map((s) => s.key)).not.toContain('slime')
    expect(new Set(SPECIES.map((s) => s.key)).size).toBe(SPECIES.length)
    for (const s of SPECIES) expect(s.name.length).toBeGreaterThan(0)
  })

  test('every species has a valid anchor for every accessory slot', () => {
    for (const s of SPECIES) {
      for (const slot of SLOTS) {
        const a = s.anchors[slot]
        expect(a).toBeDefined()
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x).toBeLessThanOrEqual(1)
        expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y).toBeLessThanOrEqual(1)
        expect(a.scale).toBeGreaterThan(0)
      }
    }
  })

  test('every species has a valid rarity', () => {
    for (const s of SPECIES) expect(['common', 'uncommon', 'rare']).toContain(s.rarity)
  })

  test('4 items, unique keys, valid slot + positive price + /pets/ sprite', () => {
    expect(ITEMS.length).toBe(4)
    expect(new Set(ITEMS.map((i) => i.key)).size).toBe(4)
    for (const i of ITEMS) {
      expect(SLOTS).toContain(i.slot)
      expect(i.price).toBeGreaterThan(0)
      expect(i.sprite).toMatch(/^\/pets\//)
    }
  })
})
