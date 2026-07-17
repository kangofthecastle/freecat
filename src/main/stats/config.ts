import type { SectionCode } from '../content/types'

/** Tunable Stats constants (spec `2026-07-17-stats-design.md`). Pure + DB-free. One place, so every
 *  metric stays re-derivable if retuned — same philosophy as the sat-world original this ports. */
export const STATS_CONFIG = {
  /** Mastery model — ported verbatim from sat-world (spec: Decisions). */
  mastery: {
    tauDays: 21, // recency scale: w = exp(-ageDays/τ)
    priorK: 3, // Bayesian shrinkage pseudo-observations
    priorP0: 0.5, // prior success probability
    stalenessDays: 14, // latest attempt older than this ⇒ topic flagged stale
    flaggedCorrectWeight: 0.5, // a currently-flagged CORRECT answer counts at half evidence weight
    needsDataNEff: 2, // n_eff below this renders as "needs data", never a score
    trendDays: 90 // as-of-day mastery trend span (Phase 4) — recomputed live, no snapshots
  },

  /** Error-fingerprint classifier. Windowed (60 local days) — the deliberate fix for the
   *  all-time-aggregation flaw tracked as B9 in the sat-world findings catalogue. */
  fingerprints: {
    windowDays: 60,
    // Phase 4 tuning: at personal scale a fixed window can starve the classifier (a light month ⇒
    // nothing to diagnose). Fewer attempts than this inside the window ⇒ widen backward in whole
    // days until it holds this many (or all history). Pacing's window is deliberately NOT tied
    // to this — retuning one must never silently drag the other.
    minWindowAttempts: 20,
    minTimedAttemptsForBaseline: 5, // per-section median needs ≥ this many timed attempts, else time buckets inactive
    carelessFastMultiplier: 0.5, // wrong ∧ timeMs < 0.5× section median ⇒ careless-fast
    slowWrongMultiplier: 1.5, // wrong ∧ timeMs > 1.5× section median ⇒ slow-wrong
    repeatedDistractorMinCount: 2 // same wrong letter on ≥ this many attempts of a question ⇒ repeated distractor
  },

  /** Self-relative pacing. `referenceMsPerQ` is the AAMC pace (95 min / 59 Q ≈ 96.6 s — identical
   *  for all three content sections today, kept per-section so a divergence is a one-line retune).
   *  Reference line only — never a judgment threshold (spec: resolved question 2). */
  pacing: {
    windowDays: 60,
    minTimedForMedian: 5, // below this, report no median — no number beats a fake number
    outlierMultiplier: 2, // timed attempt slower than this × own median ⇒ outlier
    referenceMsPerQ: {
      'chem-phys': 96_600,
      'bio-biochem': 96_600,
      'psych-soc': 96_600
    } as Record<SectionCode, number>
  },

  /**
   * Daily effort points. Anchor: ≈ 2 points per focused minute, reading discounted — transparent
   * arithmetic, no magic. sat-world's weights minus the mock term (FreeCAT has no mock exams).
   *
   *   points(day) = questions×3 + flashcardReviews×0.25 + lessonsCompleted×10
   */
  effort: {
    questionPoints: 3, // a practice question ≈ 90s (1.5 min) × 2 ⇒ 3
    flashcardReviewPoints: 0.25, // a card ≈ 6–8s ⇒ ≈ 0.25
    lessonPoints: 10, // a lesson ≈ 10 min × 2, discounted 50% (reading < active recall) ⇒ 10
    trendDays: 90
  },

  /** FSRS queue summary windows. */
  flashcards: {
    dueHorizonDays: 7, // due-by-day bars: today + 6
    againRateWindows: { short: 7, long: 30 } as const
  },

  /** Activity heatmap span (weeks of daily_activity history sent to the renderer). */
  heatmapWeeks: 52
} as const
