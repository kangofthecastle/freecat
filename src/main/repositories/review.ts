import { eq, and, inArray, lte, asc, isNull, sql } from 'drizzle-orm'
import { getTableColumns } from 'drizzle-orm'
import type { DB } from '../db/client'
import { cards, decks, cardScheduling, reviewLog } from '../db/schema'
import type { CardSchedulingRow } from '../db/schema'
import type { ReviewCounts, RatingPreview, ReviewCardResult, ReviewRating, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import { State, applyRating, previewIntervals } from '../flashcards/fsrs'
import { creditActivitySafely, appTz, type RecordActivityFn } from './activity'
import { dayKeyInTz } from '../../shared/gamification/dates'

// New cards introduced per day, per studied deck subtree (no settings UI in M2). Bucketed by the
// gamification module's app-tz dayKey, stamped as `introducedDay` when a card's scheduling row is born.
export const NEW_PER_DAY = 20

// Anki-style learn-ahead: when nothing is strictly actionable, a learning/relearning card whose `due`
// is within this window is served early (and, symmetrically, a submit is accepted for any card inside
// it — the double-submit guard's tolerance). 20 minutes.
export const LEARN_AHEAD_MS = 20 * 60 * 1000

// Only these render kinds can actually be shown in the sandboxed iframe, so only they may enter a
// queue or a count. Image-occlusion/unsupported cards rejoin automatically once their renderKind
// becomes renderable in a later milestone — no data migration needed.
export const REVIEWABLE = ['basic', 'cloze'] as const
const LEARNING_STATES = [State.Learning, State.Relearning]

/** Grading options, mirroring qbank's `GradeOptions`: an injectable gamification recorder so tests
 *  can assert it fires exactly once per applied review (and never on a rejection). */
export interface ReviewGradeOptions {
  recordActivityFn?: RecordActivityFn
}

/** The repo-level "what to show next" shape. The IPC layer swaps `cardId` for a full `CardView`
 *  (built exactly like `fcGetCard`) before it reaches the renderer. */
export type NextReviewCard =
  | { done: false; cardId: number; counts: ReviewCounts; preview: RatingPreview }
  | { done: true; counts: ReviewCounts; nextLearningDueMs: number | null }

/** All deck ids in the subtree rooted at `deckId` (Anki "study includes subdecks" semantics), or
 *  `null` if the deck does not exist. The tree lives only in `decks.parentDeckId`, so we BFS it in JS
 *  over the deck-set's rows rather than a recursive CTE. */
export async function deckSubtreeIds(db: DB, deckId: number): Promise<number[] | null> {
  const [root] = await db.select({ deckSetId: decks.deckSetId }).from(decks).where(eq(decks.id, deckId))
  if (!root) return null
  const all = await db.select({ id: decks.id, parentDeckId: decks.parentDeckId })
    .from(decks).where(eq(decks.deckSetId, root.deckSetId))
  const childrenByParent = new Map<number, number[]>()
  for (const d of all) {
    if (d.parentDeckId == null) continue
    const arr = childrenByParent.get(d.parentDeckId)
    if (arr) arr.push(d.id)
    else childrenByParent.set(d.parentDeckId, [d.id])
  }
  const result: number[] = []
  const seen = new Set<number>()
  const queue = [deckId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    for (const child of childrenByParent.get(id) ?? []) queue.push(child)
  }
  return result
}

async function countRows(db: DB, where: ReturnType<typeof and>): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` })
    .from(cardScheduling).innerJoin(cards, eq(cardScheduling.cardId, cards.id))
    .where(where)
  return row?.n ?? 0
}

/** Counts for a studied subtree, all scoped to the subtree AND renderable kinds:
 *  - `due`         — Review-state rows whose `due <= now`.
 *  - `learning`    — Learning/Relearning rows regardless of due (they belong to the active session).
 *  - `newRemaining`— `max(0, NEW_PER_DAY − introducedToday)` capped by the remaining unscheduled pool. */
async function computeCounts(db: DB, subtree: number[], now: Date): Promise<ReviewCounts> {
  const inSubtree = inArray(cardScheduling.deckId, subtree)
  const reviewable = inArray(cards.renderKind, [...REVIEWABLE])

  const due = await countRows(db, and(inSubtree, reviewable, eq(cardScheduling.state, State.Review), lte(cardScheduling.due, now)))
  const learning = await countRows(db, and(inSubtree, reviewable, inArray(cardScheduling.state, LEARNING_STATES)))
  const introducedToday = await countRows(db, and(inSubtree, reviewable, eq(cardScheduling.introducedDay, dayKeyInTz(now, appTz()))))

  // Remaining new pool = reviewable cards in the subtree with NO scheduling row (absence = 'new').
  const [poolRow] = await db.select({ n: sql<number>`count(*)` })
    .from(cards).leftJoin(cardScheduling, eq(cardScheduling.cardId, cards.id))
    .where(and(inArray(cards.deckId, subtree), inArray(cards.renderKind, [...REVIEWABLE]), isNull(cardScheduling.id)))
  const remainingPool = poolRow?.n ?? 0

  const newRemaining = Math.min(Math.max(0, NEW_PER_DAY - introducedToday), remainingPool)
  return { newRemaining, learning, due }
}

/** Public counts entrypoint; `null` when the deck does not exist. */
export async function reviewCounts(db: DB, deckId: number, now: Date): Promise<ReviewCounts | null> {
  const subtree = await deckSubtreeIds(db, deckId)
  if (subtree === null) return null
  return computeCounts(db, subtree, now)
}

// Pick the earliest scheduling row matching `extra` (already anchored to subtree + reviewable),
// returning the full row so the caller can build its rating preview.
async function earliestSched(db: DB, subtree: number[], extra: ReturnType<typeof and>): Promise<CardSchedulingRow | undefined> {
  const [row] = await db.select(getTableColumns(cardScheduling))
    .from(cardScheduling).innerJoin(cards, eq(cardScheduling.cardId, cards.id))
    .where(and(inArray(cardScheduling.deckId, subtree), inArray(cards.renderKind, [...REVIEWABLE]), extra))
    .orderBy(asc(cardScheduling.due)).limit(1)
  return row
}

/** The next card to study, in Anki-like priority order (see the numbered steps). `null` = deck not
 *  found. Every branch carries fresh `counts` so the renderer's header updates in lockstep. */
export async function nextReviewCard(db: DB, deckId: number, now: Date): Promise<NextReviewCard | null> {
  const subtree = await deckSubtreeIds(db, deckId)
  if (subtree === null) return null
  const counts = await computeCounts(db, subtree, now)

  // 1. Learning/relearning that is actually due — the active session's short-term ladder comes first.
  const learningDue = await earliestSched(db, subtree, and(inArray(cardScheduling.state, LEARNING_STATES), lte(cardScheduling.due, now)))
  if (learningDue) return { done: false, cardId: learningDue.cardId, counts, preview: previewIntervals(learningDue, now) }

  // 2. Due reviews (graduated cards whose interval has elapsed).
  const reviewDue = await earliestSched(db, subtree, and(eq(cardScheduling.state, State.Review), lte(cardScheduling.due, now)))
  if (reviewDue) return { done: false, cardId: reviewDue.cardId, counts, preview: previewIntervals(reviewDue, now) }

  // 3. A new card (no scheduling row) — only while today's new budget for this subtree remains.
  if (counts.newRemaining > 0) {
    const [newCard] = await db.select({ cardId: cards.id })
      .from(cards).leftJoin(cardScheduling, eq(cardScheduling.cardId, cards.id))
      .where(and(inArray(cards.deckId, subtree), inArray(cards.renderKind, [...REVIEWABLE]), isNull(cardScheduling.id)))
      .orderBy(asc(cards.id)).limit(1)
    if (newCard) return { done: false, cardId: newCard.cardId, counts, preview: previewIntervals(null, now) }
  }

  // 4. Learn-ahead: nothing is strictly due, so pull a learning/relearning card due within the window.
  const ahead = new Date(now.getTime() + LEARN_AHEAD_MS)
  const learnAhead = await earliestSched(db, subtree, and(inArray(cardScheduling.state, LEARNING_STATES), lte(cardScheduling.due, ahead)))
  if (learnAhead) return { done: false, cardId: learnAhead.cardId, counts, preview: previewIntervals(learnAhead, now) }

  // 5. Done — but surface when the earliest still-pending learning card returns, so the UI can offer
  //    "N cards back in X min". All remaining learning cards are strictly future here (step 4 drained
  //    the window), so `due - now` is positive.
  const nextLearning = await earliestSched(db, subtree, inArray(cardScheduling.state, LEARNING_STATES))
  const nextLearningDueMs = nextLearning ? nextLearning.due.getTime() - now.getTime() : null
  return { done: true, counts, nextLearningDueMs }
}

/** Apply a rating to one card: reschedule via FSRS, append the review log, then credit gamification.
 *  Rejections (`card-not-found` / `not-reviewable` / `not-due`) never touch the DB or gamification. */
export async function gradeReview(
  db: DB,
  cardId: number,
  rating: ReviewRating,
  now: Date,
  opts: ReviewGradeOptions = {}
): Promise<ServiceResult<ReviewCardResult>> {
  const [card] = await db.select({
    id: cards.id, deckSetId: cards.deckSetId, deckId: cards.deckId, renderKind: cards.renderKind
  }).from(cards).where(eq(cards.id, cardId))
  if (!card) return err('card-not-found')
  // Same renderable-kind gate as the counts/queue use — one REVIEWABLE source of truth (the readonly
  // cast keeps `.includes` happy for a non-member string without widening REVIEWABLE's element type).
  if (!(REVIEWABLE as readonly string[]).includes(card.renderKind)) return err('not-reviewable')

  const [existing] = await db.select().from(cardScheduling).where(eq(cardScheduling.cardId, cardId))

  // Actionability / double-submit guard: a card is gradeable only if it is new (no row) or its `due`
  // sits within the learn-ahead window. A duplicate submit lands after the first push its `due` past
  // the window → `not-due`, so gamification is never double-awarded (see spec's accepted 1m-step gap).
  const actionable = existing === undefined || existing.due.getTime() <= now.getTime() + LEARN_AHEAD_MS
  if (!actionable) return err('not-due')

  const { next, log } = applyRating(existing ?? null, rating, now)
  // A row is born on the FIRST review (the card leaves 'new'); `introducedDay` is stamped once then
  // preserved, so the daily new-limit accounting is stable across the card's later reviews.
  const introducedDay = existing?.introducedDay ?? dayKeyInTz(now, appTz())

  await db.transaction(async (tx) => {
    await tx.insert(cardScheduling)
      .values({ cardId, deckSetId: card.deckSetId, deckId: card.deckId, introducedDay, ...next })
      .onConflictDoUpdate({ target: cardScheduling.cardId, set: next })
    await tx.insert(reviewLog).values({ cardId, deckSetId: card.deckSetId, ...log })
  })

  // Gamification is a side-effect in its OWN transaction — one activity per applied rating, never
  // blocking or failing the review. On any error the review still succeeds with `activity: null`.
  const activity = await creditActivitySafely(db, { kind: 'flashcard.review', now }, opts.recordActivityFn)
  return ok({ activity })
}
