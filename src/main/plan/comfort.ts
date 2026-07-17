import { PLAN_CONFIG } from './config'

/**
 * Comfort ratings → planner priors. Pure + DB-free, ported verbatim from sat-world. PLANNER-ONLY:
 * these feed the priority engine's inputs and MUST NEVER touch Stats (self-report must not
 * contaminate evidence-based analytics — the roadmap's locked firewall).
 *
 * Granularity (roadmap): comfort is collected per DISCIPLINE and inherited by its topics; a
 * per-topic rating overrides. The repository resolves inheritance; this module only maps values.
 */

export type Comfort = 1 | 2 | 3 | 4 | 5

const PRIOR_BY_COMFORT: Record<Comfort, number> = {
  1: 0.2,
  2: 0.35,
  3: 0.5,
  4: 0.65,
  5: 0.8
}

/** Unrated prior — the flat prior the Stats mastery model uses, so an unrated topic behaves exactly
 *  as if comfort didn't exist. */
export const UNRATED_PRIOR = 0.5

/** 1→0.2, 2→0.35, 3→0.5, 4→0.65, 5→0.8; null/undefined/out-of-range → 0.5. */
export function comfortToPrior(comfort: Comfort | null | undefined): number {
  if (comfort == null) return UNRATED_PRIOR
  return PRIOR_BY_COMFORT[comfort as Comfort] ?? UNRATED_PRIOR
}

/** Comfort-aware multiplier for the needs-data need: `1.5 − p0`. Comfort 1 → ×1.3 (study sooner),
 *  5 → ×0.7, UNRATED → exactly ×1.0 — bit-for-bit today's behavior when unrated. */
export function comfortNeedFactor(comfort: Comfort | null | undefined): number {
  return 1.5 - comfortToPrior(comfort)
}

/**
 * Planner-only mastery re-shrinkage (ported closed form): swap the flat 0.5 prior for the comfort
 * prior WITHOUT recomputing evidence — `m' = m + k(p0' − p0)/(nEff + k)`. Evidence washes the prior
 * out exactly as fast as it would have in the full model; with lots of evidence (large nEff) comfort
 * barely moves anything, which is the point.
 */
export function plannerShrunkMastery(
  mastery: number,
  nEff: number,
  comfort: Comfort | null | undefined
): number {
  const k = PLAN_CONFIG.priorK
  const p0 = comfortToPrior(comfort)
  return mastery + (k * (p0 - UNRATED_PRIOR)) / (nEff + k)
}
