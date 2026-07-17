import type { ErrorMode } from '../../shared/dto'
import { PLAN_CONFIG, examWeight } from './config'
import { comfortNeedFactor, type Comfort } from './comfort'
import { allocateTrackBudget, mistakeShareCap } from './track-budget'

/**
 * Pure adaptive-plan core — the sat-world planner reshaped for FreeCAT's tracks (roadmap Phase 2):
 * flashcards (self-paced FSRS), questions (self-paced, exam-date driven; one topic per task, since a
 * qbank session has one scope), spaced mistake review (a questions task with refine='incorrect'),
 * and always-optional lesson offers. No mocks, no teacher, no feature gates — deleted, not stubbed.
 * DB-free so it is exhaustively unit-testable; the repository gathers inputs and calls this for
 * today+6, then materializes the returned tasks into `plan_task` rows.
 */

/** A topic with everything the planner needs to rank + compose it. DB-free input; the repository
 *  resolves comfort inheritance and applies the planner-only mastery re-shrinkage BEFORE this. */
export interface PlanTopic {
  topic: string
  title: string
  discipline: string
  disciplineTitle: string
  mastery: number // comfort-shrunk success rate in [0,1] (planner-only view)
  needsData: boolean
  stale: boolean
  coverage: number // distinct attempted / published in [0,1]
  publishedCount: number // questions available; 0 ⇒ unplannable for practice
  dominantMode: ErrorMode | null // biases lesson pairing (reteach), not priority
  lessonAvailable: boolean // an authored lesson exists for this topic
  lessonCompleted: boolean
  excluded?: boolean // self-set opt-out: drop from practice + its mistake candidates
  comfort?: Comfort | null // scales the NEEDS-DATA need only (priors applied upstream)
  offerLesson?: boolean // repository decided (no plan_lesson_offer row yet): attach the one-time offer
}

/** A missed/flagged question eligible for spaced mistake review. */
export interface MistakeCandidate {
  questionId: string
  topic: string
  daysSinceMiss: number | null // days since the latest miss; null = never missed (flagged-only)
  flagged: boolean
}

export type PlanTaskKind = 'flashcards' | 'questions' | 'lesson'
/** Skip-guard keys: mistake review skips independently of ordinary practice. */
export type PlanSkipKind = PlanTaskKind | 'mistakes'

/** One planned task, shaped for a `plan_task` row. */
export interface PlannedTask {
  kind: PlanTaskKind
  taxonomyRef: string | null // topic slug (questions/lesson); null = global (flashcards, mistake review)
  refine: 'incorrect' | null // 'incorrect' = spaced mistake review (maps onto qbank's refine)
  targetCount: number
  minutes: number
  optional: boolean // lessons only — budget-exempt
  why: string
}

export interface MaterializeDayInput {
  day: string
  budgetMinutes: number
  usedMinutes?: number // minutes of the day's surviving (started/completed) tasks — regen respects work done
  topics: PlanTopic[]
  dueCardCount: number
  newCardCount: number
  mistakeCandidates: MistakeCandidate[] // repository passes [] for future (speculative) days
  questionsStarted: boolean // false before the questions-track start day
  behindPace: boolean // scales the exploration boost (coverage is the schedulable target)
  // Same-day skip guards (ported): a regen must never resurrect something skipped that day.
  // Lesson skips are tracked SEPARATELY from practice skips — declining a 10-minute lesson must
  // never cost the topic its questions practice (and vice versa).
  skippedTopics?: string[] // topics whose PRACTICE was skipped: drop from practice + mistake candidates
  skippedLessonTopics?: string[] // topics whose LESSON task was skipped: suppress the pairing only
  skippedKinds?: PlanSkipKind[]
  /** Topics whose lesson already exists elsewhere in this regeneration's horizon (an earlier day's
   *  emission or a surviving row) — a lesson appears at most once across the whole horizon. */
  lessonAlreadyPlanned?: string[]
}

const QUESTION_MIN = PLAN_CONFIG.questionSeconds / 60

/** Ported §6.2 priority: examWeight(discipline) × need × stalenessBoost × explorationBoost.
 *  The needs-data need is comfort-aware (×1.0 when unrated). Higher ⇒ study sooner. */
export function priority(t: PlanTopic, explorationScale = 1): number {
  const need = t.needsData ? PLAN_CONFIG.needsDataNeed * comfortNeedFactor(t.comfort) : 1 - t.mastery
  const staleBoost = t.stale ? PLAN_CONFIG.stalenessBoost : 1
  const exploreBoost =
    t.coverage < PLAN_CONFIG.explorationCoverageThreshold ? PLAN_CONFIG.explorationBoost * explorationScale : 1
  return examWeight(t.discipline) * need * staleBoost * exploreBoost
}

/** Eligible spaced-review candidates: latest miss ≥ spacedGapDays old, OR flagged regardless. */
export function eligibleMistakes(candidates: MistakeCandidate[]): MistakeCandidate[] {
  return candidates.filter(
    (c) => (c.daysSinceMiss != null && c.daysSinceMiss >= PLAN_CONFIG.spacedGapDays) || c.flagged
  )
}

/** The one-line "why this task" (ported), composed here so no consumer re-derives it. */
export function whyLine(t: PlanTopic): string {
  if (t.stale && !t.needsData) return `Getting stale — time to revisit ${t.title}`
  if (t.needsData || t.coverage < PLAN_CONFIG.explorationCoverageThreshold) return `New territory — build a base in ${t.title}`
  return `One of your weakest ${t.disciplineTitle} topics`
}

/**
 * The ordered task list for ONE day, filled to the day's remaining budget. Order: flashcards first
 * (the SRS schedule is already optimal — the plan defers to it), spaced mistake review, then
 * topic-scoped practice by priority, each optionally preceded by a budget-exempt lesson offer.
 * Greedy fill stops after the first required task that crosses the budget, so a day never exceeds
 * budget by more than the last task's overflow. Habit mode (no exam date) takes this exact path —
 * the difference lives entirely in the inputs (no triangle-driven new target, never behind pace).
 */
export function materializeDay(input: MaterializeDayInput): PlannedTask[] {
  if (input.budgetMinutes <= 0) return []

  const suppressKinds = new Set(input.skippedKinds ?? [])
  const skippedTopics = new Set(input.skippedTopics ?? [])
  const lessonSuppressed = new Set([...(input.skippedLessonTopics ?? []), ...(input.lessonAlreadyPlanned ?? [])])
  const candidates: PlannedTask[] = []

  // (a) Flashcards — due reviews + the day's new-card allowance.
  const due = Math.max(0, input.dueCardCount)
  const newCards = Math.max(0, input.newCardCount)
  const dueMinutes = (due * PLAN_CONFIG.cardSecondsPerDue) / 60
  const newMinutes = (newCards * PLAN_CONFIG.newCardSeconds) / 60
  const flashcardsEmitted = (due > 0 || newCards > 0) && !suppressKinds.has('flashcards')
  if (flashcardsEmitted) {
    const raw = Math.ceil(dueMinutes + newMinutes)
    const minutes = Math.min(Math.max(1, raw), PLAN_CONFIG.flashcardsMaxMinutes)
    const parts = [
      due > 0 ? `${due} card${due === 1 ? '' : 's'} due` : null,
      newCards > 0 ? `${newCards} new` : null
    ].filter(Boolean)
    candidates.push({
      kind: 'flashcards', taxonomyRef: null, refine: null,
      targetCount: due + newCards, minutes, optional: false,
      why: `${parts.join(' + ')} today`
    })
  }

  // Excluded topics drop from practice AND their mistake candidates; same for topics skipped today.
  const droppedTopics = new Set<string>([
    ...input.topics.filter((t) => t.excluded).map((t) => t.topic),
    ...skippedTopics
  ])

  const eligible = suppressKinds.has('mistakes')
    ? []
    : eligibleMistakes(input.mistakeCandidates.filter((c) => !droppedTopics.has(c.topic)))

  const trackBudget = allocateTrackBudget({
    budgetMinutes: input.budgetMinutes,
    flashcards: flashcardsEmitted
      ? { dueMinutes, newMinutes, capMinutes: PLAN_CONFIG.flashcardsMaxMinutes }
      : undefined,
    mistakes: {
      eligibleMinutes: eligible.length * QUESTION_MIN,
      shareCap: mistakeShareCap(input.budgetMinutes),
      minMinutes: PLAN_CONFIG.mistakeReviewMinEligible * QUESTION_MIN
    },
    questions: { enabled: input.questionsStarted, behindPace: input.behindPace }
  })

  // (b) Spaced mistake review — one task when enough are eligible; capped at the mistake budget.
  if (eligible.length >= PLAN_CONFIG.mistakeReviewMinEligible) {
    const maxQ = Math.max(1, Math.floor(trackBudget.mistakes / QUESTION_MIN))
    const count = Math.min(eligible.length, maxQ)
    const flaggedCount = eligible.slice(0, count).filter((c) => c.flagged).length
    candidates.push({
      kind: 'questions', taxonomyRef: null, refine: 'incorrect',
      targetCount: count, minutes: Math.round(count * QUESTION_MIN), optional: false,
      why: flaggedCount >= PLAN_CONFIG.mistakeReviewMinEligible
        ? `You flagged ${flaggedCount} of these`
        : 'Spaced review — misses worth another look'
    })
  }

  // (c) Topic practice by priority (+ optional lesson offers), gated on the questions-track start.
  if (input.questionsStarted) {
    const explorationScale = input.behindPace ? PLAN_CONFIG.behindPaceExplorationScale : 1
    const prio = (t: PlanTopic): number => priority(t, explorationScale)
    const ranked = input.topics
      .filter((t) => !droppedTopics.has(t.topic) && t.publishedCount > 0 && prio(t) > 0)
      .sort((a, b) => prio(b) - prio(a) || a.topic.localeCompare(b.topic))

    for (const t of ranked.slice(0, PLAN_CONFIG.maxQuestionTasksPerDay)) {
      // Lesson pairing BEFORE the practice set — always optional, budget-exempt. Two ported
      // triggers: the one-time new-topic OFFER (repository consulted plan_lesson_offer) and the
      // repeated-distractor RETEACH (the misconception wants the concept, not more reps).
      const reteach = t.dominantMode === 'repeated_distractor'
      if (t.lessonAvailable && !t.lessonCompleted && !lessonSuppressed.has(t.topic) && (t.offerLesson || reteach)) {
        candidates.push({
          kind: 'lesson', taxonomyRef: t.topic, refine: null,
          targetCount: 1, minutes: PLAN_CONFIG.lessonMinutes, optional: true,
          why: reteach
            ? 'You keep picking the same wrong answer — revisit the concept'
            : 'New topic — a quick lesson to get you started'
        })
      }
      const count = Math.min(PLAN_CONFIG.questionsPerTask, t.publishedCount)
      candidates.push({
        kind: 'questions', taxonomyRef: t.topic, refine: null,
        targetCount: count, minutes: Math.round(count * QUESTION_MIN), optional: false,
        why: whyLine(t)
      })
    }
  }

  return greedyFill(candidates, input.budgetMinutes - (input.usedMinutes ?? 0))
}

/** Take tasks in order while budget remains, stopping AFTER the first required task that crosses it
 *  (last-task overflow). OPTIONAL tasks (lessons) are budget-EXEMPT and ALWAYS kept — ported
 *  semantics: an ignored optional lesson must not starve practice, and a busy day (flashcards +
 *  mistakes filling the budget) must not silently swallow a first-encounter lesson offer that costs
 *  zero budget minutes. A standalone lesson without its practice set is still a sensible suggestion. */
function greedyFill(candidates: PlannedTask[], remainingBudget: number): PlannedTask[] {
  const out: PlannedTask[] = []
  let rem = remainingBudget
  for (const t of candidates) {
    if (t.optional) {
      out.push(t)
      continue
    }
    if (rem <= 0) break
    out.push(t)
    rem -= t.minutes
  }
  return out
}
