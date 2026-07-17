import { STATS_CONFIG } from './config'

/** One question's LATEST attempt for a topic's mastery computation. Pure + DB-free input —
 *  the caller (repository) selects latest-per-question; feeding all attempts would double-count. */
export interface MasteryAttempt {
  questionId: string
  isCorrect: boolean
  answeredAt: Date
  flagged: boolean // currently flagged (qbank_flag) — a shaky right answer is weaker proof
  /** Question difficulty weight. FreeCAT content has no difficulty tag yet, so callers feed the
   *  default 1.0; the parameter ports so real weights arrive free when the content schema grows one. */
  difficultyWeight?: number
}

export interface MasteryResult {
  mastery: number // (Σ w·correct + k·p₀) / (Σ w + k) — Bayesian-shrunk success rate in [0,1]
  nEff: number // Σ w — evidence mass
  coverage: number // distinct attempted / publishedCount, clamped to [0,1]
  stale: boolean // latest attempt older than the staleness threshold (false when no attempts)
  needsData: boolean // n_eff below the "needs data" threshold ⇒ don't render as a score
  attempted: number // distinct questions with a latest attempt
}

const DAY_MS = 86_400_000

/**
 * Pure mastery math for one node (topic, discipline, or section) — ported verbatim from
 * sat-world's `computeMastery`, minus the exam-only branch (no mocks here, ever).
 *
 *   w_q = exp(-ageDays/τ) × difficultyWeight     # recency × difficulty
 *   mastery = (Σ w_q·correct_q + k·p₀) / (Σ w_q + k)
 *   n_eff   = Σ w_q
 *
 * Flag discount: a currently-flagged CORRECT answer contributes at half weight
 * (flaggedCorrectWeight); incorrect evidence is NEVER discounted. The discount carries into
 * n_eff so numerator and mass stay coherent. Staleness/decay is emergent: old weights shrink →
 * n_eff shrinks → mastery drifts toward p₀ and eventually re-flags as needs-data.
 *
 * Rollups (discipline/section) must call this over the UNION of child attempt streams with summed
 * published counts — never average child mastery values, which would leak empty topics' prior into
 * the parent and defeat needsData honesty (spec: Decisions).
 */
export function computeMastery(attempts: MasteryAttempt[], publishedCount: number, now: Date): MasteryResult {
  const { tauDays, priorK, priorP0, stalenessDays, flaggedCorrectWeight, needsDataNEff } = STATS_CONFIG.mastery
  let sumW = 0
  let sumWCorrect = 0
  let latestMs = -Infinity
  for (const a of attempts) {
    const ageDays = Math.max(0, (now.getTime() - a.answeredAt.getTime()) / DAY_MS)
    const base = Math.exp(-ageDays / tauDays) * (a.difficultyWeight ?? 1.0)
    const w = a.isCorrect && a.flagged ? base * flaggedCorrectWeight : base
    sumW += w
    if (a.isCorrect) sumWCorrect += w
    if (a.answeredAt.getTime() > latestMs) latestMs = a.answeredAt.getTime()
  }

  const nEff = sumW
  const mastery = (sumWCorrect + priorK * priorP0) / (sumW + priorK)
  const attempted = attempts.length
  const coverage = publishedCount > 0 ? Math.min(1, attempted / publishedCount) : 0
  const stale = attempted > 0 && (now.getTime() - latestMs) / DAY_MS > stalenessDays
  const needsData = nEff < needsDataNEff
  return { mastery, nEff, coverage, stale, needsData, attempted }
}
