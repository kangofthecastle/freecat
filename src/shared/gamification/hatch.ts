import { RARITY_WEIGHTS } from './config'
import type { Rarity, Rng } from './types'

/** Weighted pick by rarity. `rng()` is in [0,1). Deterministic for a fixed rng. */
export function rollSpecies(
  rng: Rng,
  species: { key: string; rarity: Rarity }[],
  weights: Record<Rarity, number> = RARITY_WEIGHTS,
): string {
  const total = species.reduce((sum, s) => sum + weights[s.rarity], 0)
  let r = rng() * total
  for (const s of species) {
    const w = weights[s.rarity]
    if (r < w) return s.key
    r -= w
  }
  const last = species[species.length - 1]
  if (!last) throw new Error('rollSpecies: empty species list')
  return last.key
}
