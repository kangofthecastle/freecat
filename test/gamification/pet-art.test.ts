import { describe, it, expect } from 'vitest'
import { resolveSprite, resolveAccessories, mouthAnchor } from '../../src/shared/gamification/pet-art'

describe('pet-art', () => {
  it('resolves a known species/state to frame metadata', () => {
    const s = resolveSprite('cat', 'happy')
    expect(s?.species).toBe('cat')
    expect(s?.state).toBe('happy')
    expect(s?.frames).toBeGreaterThan(0)
  })
  it('uses the action state when provided (eating)', () => {
    expect(resolveSprite('cat', 'happy', 'eating')?.state).toBe('eating')
  })
  it('returns null for unknown species (incl. the dropped slime)', () => {
    expect(resolveSprite('slime', 'happy')).toBeNull()
    expect(resolveSprite('dragon', 'happy')).toBeNull()
  })
  it('resolves accessory layers by itemKey, skipping unknown keys', () => {
    const layers = resolveAccessories('cat', ['cap', 'nonexistent'])
    expect(layers).toHaveLength(1)
    expect(layers[0]?.itemKey).toBe('cap')
    expect(layers[0]?.anchor).toBeDefined()
  })
  it('mouthAnchor nudges the face anchor downward', () => {
    const a = mouthAnchor('cat')
    expect(a).toBeDefined()
    expect(a!.y).toBeGreaterThan(0)
  })
})
