import type { DisciplineKey } from '../../shared/dto'
import { STATS_CONFIG } from '../stats/config'

/**
 * Tunable Plan constants (roadmap Phase 2). Pure + DB-free — every knob in one place so the planner
 * stays re-derivable, same philosophy as STATS_CONFIG and the sat-world PLAN_CONFIG this ports.
 */
export const PLAN_CONFIG = {
  /**
   * MCAT blueprint weights (roadmap resolution 3): AAMC discipline-level constants, uniform within a
   * discipline's topics. Within-section shares approximate the AAMC section outlines (C/P ≈ 30% gen
   * chem / 25% physics / 15% o-chem, renormalized over the disciplines FreeCAT maps to that section;
   * B/B ≈ 65% bio / 25% biochem renormalized). Each covered section weighs equally (no CARS content),
   * so examWeight sums to 1.0 across all disciplines and priorities are comparable everywhere.
   * Deliberately editable constants, not data — revisit when AAMC revises the outlines.
   */
  disciplineWeightWithinSection: {
    // chem-phys (sums to 1.0)
    'gen-chem': 0.43,
    physics: 0.36,
    'o-chem': 0.21,
    // bio-biochem (sums to 1.0)
    biology: 0.72,
    biochem: 0.28,
    // psych-soc (sums to 1.0)
    'behavioral-sci': 1.0
  } as Record<DisciplineKey, number>,
  sectionWeight: 1 / 3, // three covered sections, equally weighted
  examWeightFallback: 0.02, // defensive: an unknown discipline still surfaces, faintly

  // priority(topic) = examWeight × need × stalenessBoost × explorationBoost (ported verbatim)
  needsDataNeed: 0.75, // need for a needs-data topic (no reliable mastery yet); comfort-scaled
  stalenessBoost: 1.5, // × when the topic is stale (>14d since last attempt)
  explorationBoost: 1.25, // × when coverage < explorationCoverageThreshold
  explorationCoverageThreshold: 0.25,
  behindPaceExplorationScale: 1.5, // questions behind pace ⇒ exploration boost scaled by this
  behindPaceSlack: 0.1, // attained coverage may trail expected by this fraction before "behind"

  // Budgeting (minutes / per-item estimates). The plan speaks in COUNTS (roadmap resolution 4);
  // minutes exist only inside the budget split.
  questionSeconds: 90, // ≈ 90s per practice question
  lessonMinutes: 10,
  cardSecondsPerDue: 6, // SRS due-count → minutes
  newCardSeconds: 18, // a NEW card ≈ 3 learning-step exposures in one session (3 × 6s)
  flashcardsMaxMinutes: 20, // cap so a huge backlog can't eat the whole day (SRS schedule still leads)
  questionsPerTask: 6, // questions per topic-scoped practice task
  maxQuestionTasksPerDay: 3, // depth beats breadth on a personal daily plan

  // Spaced mistake review (kind='questions' + refine='incorrect'): a miss enters review only after
  // this many days; flagged questions always join. Only materialized for TODAY (future days are
  // speculative — the ported sat-world behavior).
  mistakeReviewBudgetShare: 0.4,
  spacedGapDays: 3,
  mistakeReviewMinEligible: 5,

  // On-track indicator thresholds (progress helpers; surfaced in Phase 3 UI).
  onTrackAt: 0.8,
  fallingBehindAt: 0.5,

  // Comfort re-shrinkage (planner-only): m' = m + k(p0'−p0)/(nEff+k). Same k as the Stats mastery
  // prior so the two models stay coherent — this is a PRIOR swap, not a different model.
  priorK: STATS_CONFIG.mastery.priorK,

  horizonDays: 7 // materialize today + 6
} as const

/** examWeight(discipline): within-section blueprint share × sectionWeight — sums to 1.0 across all
 *  disciplines, so priorities are comparable across sections. */
export function examWeight(discipline: string): number {
  const w = PLAN_CONFIG.disciplineWeightWithinSection[discipline as DisciplineKey]
  return w == null ? PLAN_CONFIG.examWeightFallback : w * PLAN_CONFIG.sectionWeight
}
