import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPECIES, ITEMS } from '../../src/shared/gamification/catalog'

const ASSETS = fileURLToPath(new URL('../../src/renderer/src/assets/', import.meta.url))
const STATES = ['happy', 'sleeping', 'sad', 'angry', 'eating']

describe('sprite assets', () => {
  it('every species has all 5 state sprites on disk', () => {
    for (const s of SPECIES) for (const st of STATES) {
      expect(existsSync(join(ASSETS, 'pets', s.key, `${st}.png`)), `${s.key}/${st}.png`).toBe(true)
    }
  })
  it('every accessory item has a sprite', () => {
    for (const i of ITEMS) {
      expect(existsSync(join(ASSETS, i.sprite.replace(/^\//, ''))), i.key).toBe(true)
    }
  })
  it('the coin icon exists', () => {
    expect(existsSync(join(ASSETS, 'coin.svg'))).toBe(true)
  })
  it('the dropped slime species has no vendored sprites', () => {
    expect(existsSync(join(ASSETS, 'pets', 'slime'))).toBe(false)
  })
})
