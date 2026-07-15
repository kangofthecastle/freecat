// The ONLY file in the app that imports `ts-fsrs`. Everything else speaks in the plain row-value
// shapes below, so the scheduling engine stays swappable and the rest of the codebase never learns
// the library's `Card`/`Rating`/`State` surface. All functions here are pure and deterministic:
// fuzz is OFF (single local user + reproducible tests) and short-term (re)learning steps are ON
// (the default 1m/10m ladder), so a given (row, rating, now) always yields the same schedule.
import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card, type Grade } from 'ts-fsrs'
// ReviewRating / RatingPreview are shared DTOs (src/shared/dto.ts is the source of truth); this module
// consumes them rather than re-declaring, so the renderer and the engine agree by construction.
import type { ReviewRating, RatingPreview } from '../../shared/dto'

// Re-export the numeric enums so review.ts (and its tests) can name states/ratings without importing
// ts-fsrs directly — keeping this module the single import boundary.
export { State, Rating } from 'ts-fsrs'

// Constructed once — the parameters never change (no per-deck tuning in M2).
export const SCHEDULER = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: true }))

/** The mutable scheduling fields of a `card_scheduling` row — everything ts-fsrs owns. The persisted
 *  row adds cardId/deckSetId/deckId/introducedDay context that the engine never touches. */
export interface SchedulingRowValues {
  state: number
  due: Date
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  lastReviewAt: Date | null
}

/** One `review_log` row's engine-derived values (context columns added by the repo). */
export interface ReviewLogValues {
  rating: number
  stateBefore: number
  dueAfter: Date
  stabilityAfter: number
  difficultyAfter: number
  elapsedDays: number
  scheduledDays: number
  reviewedAt: Date
}

/** The subset of a `card_scheduling` row this module reads back into a ts-fsrs `Card`. */
export type SchedulingInput = Pick<
  SchedulingRowValues,
  'state' | 'due' | 'stability' | 'difficulty' | 'elapsedDays' | 'scheduledDays' | 'learningSteps' | 'reps' | 'lapses' | 'lastReviewAt'
>

/** Rehydrate a ts-fsrs `Card` from a persisted scheduling row, or an empty (New) card when there is
 *  no row yet. `null → createEmptyCard(now)` is what makes "no row = new" work end to end. */
export function toFsrsCard(row: SchedulingInput | null, now: Date): Card {
  if (row === null) return createEmptyCard(now)
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.lastReviewAt ?? undefined
  }
}

/** Apply a rating at `now`, returning the next scheduling values plus the log entry to append.
 *  Pure wrapper over `SCHEDULER.next(card, now, rating)`. `stateBefore` is the card's state at review
 *  time (New for a first review) — ts-fsrs reports it as `log.state`. */
export function applyRating(
  row: SchedulingInput | null,
  rating: ReviewRating,
  now: Date
): { next: SchedulingRowValues; log: ReviewLogValues } {
  const { card, log } = SCHEDULER.next(toFsrsCard(row, now), now, rating as Grade)
  const next: SchedulingRowValues = {
    state: card.state,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    // A rated card always has a last_review; fall back to `now` only to satisfy the type.
    lastReviewAt: card.last_review ?? now
  }
  return {
    next,
    log: {
      rating,
      stateBefore: log.state,
      dueAfter: card.due,
      stabilityAfter: card.stability,
      difficultyAfter: card.difficulty,
      elapsedDays: log.elapsed_days,
      scheduledDays: log.scheduled_days,
      reviewedAt: now
    }
  }
}

/** Humanize a future interval (ms from now) the way Anki labels its rating buttons:
 *  `<60s → "<1m"`, `<1h → "Xm"`, `<24h → "Xh"`, else `"Xd"` (rounded). Rounding happens BEFORE the
 *  unit label is chosen, so a value that rounds up to the next unit's boundary is promoted to it
 *  (e.g. 59m30s → "1h", not "60m"; 23.7h → "1d", not "24h"). */
export function humanizeInterval(ms: number): string {
  if (ms < 60_000) return '<1m'
  if (ms < 3_600_000) {
    const m = Math.round(ms / 60_000)
    return m >= 60 ? '1h' : `${m}m`
  }
  if (ms < 86_400_000) {
    const h = Math.round(ms / 3_600_000)
    return h >= 24 ? '1d' : `${h}h`
  }
  return `${Math.round(ms / 86_400_000)}d`
}

/** Preview the interval each rating would produce, without mutating anything — the labels the four
 *  review buttons show. Wraps `SCHEDULER.repeat(card, now)` (`f.repeat` = all-ratings preview). */
export function previewIntervals(
  row: SchedulingInput | null,
  now: Date
): RatingPreview {
  const preview = SCHEDULER.repeat(toFsrsCard(row, now), now)
  const label = (g: Grade): string => humanizeInterval(preview[g].card.due.getTime() - now.getTime())
  return {
    again: label(Rating.Again),
    hard: label(Rating.Hard),
    good: label(Rating.Good),
    easy: label(Rating.Easy)
  }
}
