import { and, eq, gte, lt, lte, inArray, sql, count } from 'drizzle-orm'
import type { DB } from '../db/client'
import {
  planSettings, planTask, planTaxonomyPref, planLessonOffer, planDayAward,
  cardScheduling, cards, lessonProgress, qbankAttempt,
  type PlanSettingsRow, type PlanTaskRow
} from '../db/schema'
import type {
  PlanSettingsDto, SavePlanSettingsInput, SavePlanSettingsResult, PacingOutcomeDto,
  PlanPrefDto, PlanTaskDto, PlanTriangleDto, PlanView, SetPlanTaskStatusInput,
  SetPlanTaskStatusResult, ActivityResult, ServiceResult, DisciplineKey
} from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import type { ContentIndex } from '../content/types'
import { DISCIPLINES, TOPICS } from '../db/seed/taxonomy-data'
import { dayKeyInTz, addDaysToKey, dayNumberOfKey } from '../../shared/gamification/dates'
import { STATS_CONFIG } from '../stats/config'
import { computeMastery } from '../stats/mastery'
import { classifyFingerprints, type FingerprintAttempt } from '../stats/fingerprints'
import { PLAN_CONFIG } from '../plan/config'
import { computeRampDays } from '../plan/fsrs-ramp'
import { flashcardTriangle, validatePacing, questionsBehindPace, habitPacing, type Triangle } from '../plan/pacing'
import { plannerShrunkMastery, type Comfort } from '../plan/comfort'
import {
  materializeDay, type PlanTopic, type MistakeCandidate, type PlanSkipKind, type PlannedTask
} from '../plan/planner'
import {
  dayOutcome, planStreak, planCompletionRate, planSkipRate, onTrackStatus, onTrackWindowStatuses,
  type DayOutcome, type StatusLike
} from '../plan/progress'
import { loadAttempts, latestPerQuestion, type AttemptRow } from './attempt-evidence'
import { listFlaggedIds } from './qbank-flags'
import { NEW_PER_DAY, REVIEWABLE } from './review'
import { appTz, creditActivitySafely, type RecordActivityFn } from './activity'
import { REWARDS_CONFIG } from '../../shared/gamification/config'

const TOPIC_TITLE: ReadonlyMap<string, string> = new Map(TOPICS.map((t) => [t.slug, t.title]))
const DISCIPLINE_TITLE: ReadonlyMap<string, string> = new Map(DISCIPLINES.map((d) => [d.slug, d.title]))

const DAY_MS = 86_400_000
const dayNum = dayNumberOfKey

// ── Settings ──

const DEFAULT_SETTINGS: PlanSettingsDto = {
  examDate: null,
  dailyBudgetMinutes: 60,
  dailyNewTarget: null,
  masteryGoalPct: null,
  finishBufferDays: 0,
  questionsStartDay: null,
  questionsFinishBufferDays: 0,
  newCardOrder: 'deck',
  onboardedAt: null
}

const toSettingsDto = (row: PlanSettingsRow | undefined): PlanSettingsDto =>
  row
    ? {
        examDate: row.examDate,
        dailyBudgetMinutes: row.dailyBudgetMinutes,
        dailyNewTarget: row.dailyNewTarget,
        masteryGoalPct: row.masteryGoalPct,
        finishBufferDays: row.finishBufferDays,
        questionsStartDay: row.questionsStartDay,
        questionsFinishBufferDays: row.questionsFinishBufferDays,
        newCardOrder: row.newCardOrder as 'deck' | 'shuffled',
        onboardedAt: row.onboardedAt
      }
    : { ...DEFAULT_SETTINGS }

export async function getPlanSettings(db: DB): Promise<PlanSettingsDto> {
  const [row] = await db.select().from(planSettings).where(eq(planSettings.id, 1))
  return toSettingsDto(row)
}

/** Flashcards-pool aggregates the triangle plans against (all imported decks, reviewable cards).
 *  DELIBERATE SIMPLIFICATION: the reviewer's NEW_PER_DAY limit is per studied deck SUBTREE, but the
 *  plan paces globally at one NEW_PER_DAY — exact for the common one-big-deck MCAT setup, and
 *  conservative (never over-promises) for multi-deck users. Per-deck triangles are a Phase 3+ call. */
async function flashcardPool(db: DB, todayKey: string): Promise<{ deckSize: number; introducedSoFar: number; introducedToday: number }> {
  const [[size], [intro], [today]] = await Promise.all([
    db.select({ n: count() }).from(cards).where(inArray(cards.renderKind, [...REVIEWABLE])),
    db.select({ n: count() }).from(cardScheduling),
    db.select({ n: count() }).from(cardScheduling).where(eq(cardScheduling.introducedDay, todayKey))
  ])
  return { deckSize: size?.n ?? 0, introducedSoFar: intro?.n ?? 0, introducedToday: today?.n ?? 0 }
}

function triangleFor(settings: PlanSettingsDto, pool: { deckSize: number; introducedSoFar: number }, todayKey: string): Triangle | null {
  if (settings.examDate == null) return null
  const finishKey = addDaysToKey(settings.examDate, -settings.finishBufferDays)
  const daysToFinish = Math.max(0, dayNum(finishKey) - dayNum(todayKey))
  return flashcardTriangle({
    deckSize: pool.deckSize,
    introducedSoFar: pool.introducedSoFar,
    goalPct: settings.masteryGoalPct ?? 0,
    dailyNew: settings.dailyNewTarget ?? 0,
    daysToFinish,
    rampDays: computeRampDays(),
    dailyNewCeiling: NEW_PER_DAY
  })
}

/**
 * Save a partial settings patch. The triangle pair is only writable through `pacingEdit` (pick one,
 * derive the other). Ported rules: a dailyNew edit is always allowed (goal derives DOWN); a goalPct
 * edit is refused when it needs more than the reviewer's ceiling — the refusal is returned, nothing
 * pacing-related persists, other fields still save. An exam-date change keeps dailyNewTarget and
 * re-derives the goal down — the plan never silently raises workload.
 */
export async function savePlanSettings(
  db: DB,
  input: SavePlanSettingsInput,
  opts: { now?: Date; tz?: string } = {}
): Promise<SavePlanSettingsResult> {
  const now = opts.now ?? new Date()
  const tz = opts.tz ?? appTz()
  const todayKey = dayKeyInTz(now, tz)

  const current = await getPlanSettings(db)
  const next: PlanSettingsDto = { ...current }
  if (input.examDate !== undefined) next.examDate = input.examDate
  if (input.dailyBudgetMinutes !== undefined) next.dailyBudgetMinutes = input.dailyBudgetMinutes
  if (input.finishBufferDays !== undefined) next.finishBufferDays = input.finishBufferDays
  if (input.questionsStartDay !== undefined) next.questionsStartDay = input.questionsStartDay
  if (input.questionsFinishBufferDays !== undefined) next.questionsFinishBufferDays = input.questionsFinishBufferDays
  if (input.newCardOrder !== undefined) next.newCardOrder = input.newCardOrder
  if (input.onboarded) next.onboardedAt = current.onboardedAt ?? now

  const pool = await flashcardPool(db, todayKey)
  let pacing: PacingOutcomeDto | null = null

  const examChanged = next.examDate !== current.examDate || next.finishBufferDays !== current.finishBufferDays

  if (input.pacingEdit) {
    if (next.examDate == null) {
      // Shared habit-mode rule (the wizard/settings preview runs the same function).
      pacing = habitPacing(input.pacingEdit, NEW_PER_DAY, current.dailyNewTarget)
      if (pacing.ok) {
        next.dailyNewTarget = pacing.derived.dailyNew
        next.masteryGoalPct = null
      }
    } else {
      const finishKey = addDaysToKey(next.examDate, -next.finishBufferDays)
      const outcome = validatePacing({
        deckSize: pool.deckSize,
        introducedSoFar: pool.introducedSoFar,
        daysToFinish: Math.max(0, dayNum(finishKey) - dayNum(todayKey)),
        rampDays: computeRampDays(),
        dailyNewCeiling: NEW_PER_DAY,
        edit: input.pacingEdit.field === 'dailyNew'
          ? { field: 'dailyNew', value: input.pacingEdit.value }
          : { field: 'goalPct', value: input.pacingEdit.value }
      })
      pacing = outcome
      if (outcome.ok) {
        next.dailyNewTarget = outcome.derived.dailyNew
        next.masteryGoalPct = outcome.derived.goalPct
      }
    }
  } else if (examChanged && next.examDate != null && next.dailyNewTarget != null) {
    // Exam moved: keep the daily-new commitment, re-derive the goal (down when the runway shrank).
    const tri = triangleFor(next, pool, todayKey)!
    next.masteryGoalPct = tri.reachableGoalPct
    pacing = { ok: true, derived: { dailyNew: next.dailyNewTarget, goalPct: tri.reachableGoalPct } }
  }

  await db
    .insert(planSettings)
    .values({ id: 1, ...toRow(next), updatedAt: now })
    .onConflictDoUpdate({ target: planSettings.id, set: { ...toRow(next), updatedAt: now } })
  return { settings: next, pacing }
}

const toRow = (s: PlanSettingsDto): Omit<typeof planSettings.$inferInsert, 'id' | 'updatedAt'> => ({
  examDate: s.examDate,
  dailyBudgetMinutes: s.dailyBudgetMinutes,
  dailyNewTarget: s.dailyNewTarget,
  masteryGoalPct: s.masteryGoalPct,
  finishBufferDays: s.finishBufferDays,
  questionsStartDay: s.questionsStartDay,
  questionsFinishBufferDays: s.questionsFinishBufferDays,
  newCardOrder: s.newCardOrder,
  onboardedAt: s.onboardedAt
})

// ── Prefs (comfort + exclusions; discipline-level inherited by topics, topic-level overrides) ──

export async function getPlanPrefs(db: DB): Promise<PlanPrefDto[]> {
  const rows = await db.select().from(planTaxonomyPref)
  return rows.map((r) => ({ taxonomyRef: r.taxonomyRef, comfort: r.comfort, excluded: r.excluded }))
}

export async function savePlanPrefs(db: DB, prefs: PlanPrefDto[], now = new Date()): Promise<void> {
  if (prefs.length === 0) return
  // One transaction: an onboarding sweep (up to 200 rows) commits atomically, not row-by-row.
  await db.transaction(async (tx) => {
    for (const p of prefs) {
      await tx
        .insert(planTaxonomyPref)
        .values({ taxonomyRef: p.taxonomyRef, comfort: p.comfort, excluded: p.excluded, updatedAt: now })
        .onConflictDoUpdate({
          target: planTaxonomyPref.taxonomyRef,
          set: { comfort: p.comfort, excluded: p.excluded, updatedAt: now }
        })
    }
  })
}

// ── Task status ──

export async function setPlanTaskStatus(
  db: DB,
  input: SetPlanTaskStatusInput,
  now = new Date(),
  opts: { recordActivityFn?: RecordActivityFn; tz?: string } = {}
): Promise<ServiceResult<SetPlanTaskStatusResult>> {
  const [row] = await db.select().from(planTask).where(eq(planTask.id, input.taskId))
  if (!row) return err('not-found')
  if (row.status === 'expired') return err('invalid') // system-resolved; the day is gone
  await db.update(planTask).set({ status: input.status, updatedAt: now }).where(eq(planTask.id, input.taskId))

  // Only a completion can newly finish a day, so only completions bother checking for the bonus.
  const activity =
    input.status === 'completed'
      ? await maybeAwardPlanDay(db, row.day, now, opts.tz ?? appTz(), opts.recordActivityFn)
      : null
  return ok({ task: toTaskDto({ ...row, status: input.status }), activity })
}

/**
 * The `plan.day` bonus: fires when a status change leaves `day` fully complete (`dayOutcome`
 * semantics — every required task completed, skips excluded, optional lessons never counted).
 * Guards, in order:
 * - `day` must not be in the future: the IPC channel accepts any taskId, so without this a caller
 *   could complete the whole materialized horizon and bank a week of bonuses in seconds.
 * - The durable `plan_day_award` marker makes it at-most-once per dayKey — un-complete/re-complete
 *   cycles and regeneration rebuilds cannot re-trigger it (same reasoning as `plan_lesson_offer`),
 *   and only the call whose INSERT actually lands (checked via RETURNING) credits, so two
 *   completions racing on the same day cannot double-credit.
 * - Marker-before-credit is deliberate failure ordering: if the credit itself fails, the bonus for
 *   that day is forfeited (never retried) rather than ever risking a double award.
 * Credit rides the standard gamification pipeline via `creditActivitySafely`: its own transaction,
 * swallowed on failure, never blocking the status change itself.
 */
async function maybeAwardPlanDay(
  db: DB,
  day: string,
  now: Date,
  tz: string,
  recordActivityFn?: RecordActivityFn
): Promise<ActivityResult | null> {
  if (day > dayKeyInTz(now, tz)) return null
  const dayRows = await db.select({ status: planTask.status, optional: planTask.optional }).from(planTask).where(eq(planTask.day, day))
  if (dayOutcome(dayRows) !== 'complete') return null
  const inserted = await db
    .insert(planDayAward)
    .values({ day, awardedAt: now })
    .onConflictDoNothing()
    .returning({ id: planDayAward.id })
  if (inserted.length === 0) return null // an earlier (or concurrent) completion already awarded it
  return creditActivitySafely(db, { kind: 'plan.day', count: REWARDS_CONFIG.planDayBonus, now }, recordActivityFn)
}

const taskTitle = (row: Pick<PlanTaskRow, 'kind' | 'taxonomyRef' | 'refine'>): string => {
  if (row.kind === 'flashcards') return 'Flashcards'
  if (row.refine === 'incorrect') return 'Mistake review'
  const title = row.taxonomyRef ? TOPIC_TITLE.get(row.taxonomyRef) ?? row.taxonomyRef : 'Practice'
  return row.kind === 'lesson' ? `Lesson: ${title}` : title
}

const toTaskDto = (row: PlanTaskRow): PlanTaskDto => ({
  id: row.id,
  day: row.day,
  kind: row.kind as PlanTaskDto['kind'],
  taxonomyRef: row.taxonomyRef,
  refine: row.refine as PlanTaskDto['refine'],
  title: taskTitle(row),
  targetCount: row.targetCount,
  minutes: row.minutes,
  optional: row.optional,
  status: row.status as PlanTaskDto['status'],
  why: row.why,
  sortOrder: row.sortOrder
})

// ── Regeneration (the dynamic core) ──

export interface PlanContext {
  index: ContentIndex
  lessonSlugs: ReadonlySet<string> // authored lessons (slug === topic slug)
  now?: Date
  tz?: string
}

interface EvidenceInputs {
  topics: PlanTopic[]
  mistakeCandidates: MistakeCandidate[]
  attemptedDistinct: number
  firstAttemptKey: string | null
}

/** Assemble the planner's per-topic inputs: Stats' mastery math + the planner-only comfort layer. */
async function loadPlanEvidence(
  db: DB,
  ctx: { index: ContentIndex; lessonSlugs: ReadonlySet<string> },
  prefs: Map<string, { comfort: Comfort | null; excluded: boolean }>,
  offers: Set<string>,
  completedLessons: Set<string>,
  now: Date,
  tz: string
): Promise<EvidenceInputs> {
  const [attempts, flaggedList] = await Promise.all([loadAttempts(db), listFlaggedIds(db)])
  const flaggedIds = new Set(flaggedList)
  const latest = latestPerQuestion(attempts)

  const latestByTopic = new Map<string, AttemptRow[]>()
  for (const a of latest.values()) {
    const arr = latestByTopic.get(a.topic) ?? []
    arr.push(a)
    latestByTopic.set(a.topic, arr)
  }

  // Fingerprints (reteach trigger) over the same window Stats uses — one convention.
  const todayKey = dayKeyInTz(now, tz)
  const windowStart = addDaysToKey(todayKey, -(STATS_CONFIG.fingerprints.windowDays - 1))
  const windowed: FingerprintAttempt[] = attempts
    .filter((a) => dayKeyInTz(a.answeredAt, tz) >= windowStart)
    .map((a) => ({
      id: a.id, questionId: a.questionId, topic: a.topic, section: a.section as FingerprintAttempt['section'],
      chosen: a.chosen, isCorrect: a.isCorrect, timeMs: a.timeMs, answeredAt: a.answeredAt
    }))
  const modeByTopic = new Map(classifyFingerprints(windowed, flaggedIds).map((f) => [f.topic, f.dominantMode]))

  const comfortFor = (topic: string, discipline: string): Comfort | null =>
    prefs.get(topic)?.comfort ?? prefs.get(discipline)?.comfort ?? null
  const excludedFor = (topic: string, discipline: string): boolean =>
    prefs.get(topic)?.excluded === true || prefs.get(discipline)?.excluded === true

  const topics: PlanTopic[] = TOPICS.map((seed) => {
    const published = ctx.index.byTopic.get(seed.slug)?.length ?? 0
    const result = computeMastery(
      (latestByTopic.get(seed.slug) ?? []).map((a) => ({
        questionId: a.questionId, isCorrect: a.isCorrect, answeredAt: a.answeredAt, flagged: flaggedIds.has(a.questionId)
      })),
      published,
      now
    )
    const comfort = comfortFor(seed.slug, seed.discipline)
    return {
      topic: seed.slug,
      title: seed.title,
      discipline: seed.discipline,
      disciplineTitle: DISCIPLINE_TITLE.get(seed.discipline) ?? seed.discipline,
      // Planner-only comfort re-shrinkage — Stats never sees this number (the firewall).
      mastery: plannerShrunkMastery(result.mastery, result.nEff, comfort),
      needsData: result.needsData,
      stale: result.stale,
      coverage: result.coverage,
      publishedCount: published,
      dominantMode: modeByTopic.get(seed.slug) ?? null,
      lessonAvailable: ctx.lessonSlugs.has(seed.slug),
      lessonCompleted: completedLessons.has(seed.slug),
      excluded: excludedFor(seed.slug, seed.discipline),
      comfort,
      offerLesson: ctx.lessonSlugs.has(seed.slug) && !completedLessons.has(seed.slug) && !offers.has(seed.slug)
    }
  })

  // Spaced-review candidates: latest-incorrect questions (with age) ∪ flagged questions (always eligible).
  const mistakeCandidates: MistakeCandidate[] = []
  for (const a of latest.values()) {
    const flagged = flaggedIds.has(a.questionId)
    if (!a.isCorrect) {
      mistakeCandidates.push({
        questionId: a.questionId,
        topic: a.topic,
        daysSinceMiss: Math.floor((now.getTime() - a.answeredAt.getTime()) / DAY_MS),
        flagged
      })
    } else if (flagged) {
      mistakeCandidates.push({ questionId: a.questionId, topic: a.topic, daysSinceMiss: null, flagged: true })
    }
  }

  const facts = paceFacts(attempts, tz)
  return { topics, mistakeCandidates, attemptedDistinct: facts.attemptedDistinct, firstAttemptKey: facts.firstAttemptKey }
}

/** Questions-pace facts from a lightweight (questionId, answeredAt) projection — one implementation
 *  shared by evidence loading and the view, so the two behindPace computations can never disagree. */
function paceFacts(
  rows: { questionId: string; answeredAt: Date }[],
  tz: string
): { attemptedDistinct: number; firstAttemptKey: string | null } {
  const seen = new Set<string>()
  let firstMs = Infinity
  for (const r of rows) {
    seen.add(r.questionId)
    if (r.answeredAt.getTime() < firstMs) firstMs = r.answeredAt.getTime()
  }
  return {
    attemptedDistinct: seen.size,
    firstAttemptKey: Number.isFinite(firstMs) ? dayKeyInTz(new Date(firstMs), tz) : null
  }
}

/**
 * Materialize today+6 from current evidence and persist. The ported invariant: only `pending` rows
 * on/after today are replaced — started/completed/skipped survive, past pending expires. Today's
 * skipped rows feed the same-day skip guard, and today's surviving work discounts the budget.
 */
export async function regeneratePlan(db: DB, ctx: PlanContext): Promise<void> {
  const now = ctx.now ?? new Date()
  const tz = ctx.tz ?? appTz()
  const todayKey = dayKeyInTz(now, tz)

  const [settings, prefRows, offerRows, lessonRows, pool, scheduling] = await Promise.all([
    getPlanSettings(db),
    db.select().from(planTaxonomyPref),
    db.select({ lessonSlug: planLessonOffer.lessonSlug }).from(planLessonOffer),
    db.select({ lessonSlug: lessonProgress.lessonSlug }).from(lessonProgress).where(sql`${lessonProgress.completedAt} IS NOT NULL`),
    flashcardPool(db, todayKey),
    db.select({ due: cardScheduling.due }).from(cardScheduling)
  ])
  const prefs = new Map(prefRows.map((r) => [r.taxonomyRef, { comfort: (r.comfort ?? null) as Comfort | null, excluded: r.excluded }]))
  const offers = new Set(offerRows.map((r) => r.lessonSlug))
  const completedLessons = new Set(lessonRows.map((r) => r.lessonSlug))

  const evidence = await loadPlanEvidence(db, ctx, prefs, offers, completedLessons, now, tz)

  // FSRS due counts per horizon day (overdue clamps into today; future days assume today's dues get done).
  const dueCounts = new Map<string, number>()
  for (const s of scheduling) {
    const key = dayKeyInTz(s.due, tz)
    const bucket = key < todayKey ? todayKey : key
    dueCounts.set(bucket, (dueCounts.get(bucket) ?? 0) + 1)
  }

  // Daily-new pace: the user's setting, else triangle-required (when a goal exists), else the
  // reviewer's default — always capped at what /study will actually serve (NEW_PER_DAY).
  const triangle = triangleFor(settings, pool, todayKey)
  const dailyNewResolved = Math.min(
    NEW_PER_DAY,
    settings.dailyNewTarget ?? (triangle && settings.masteryGoalPct != null ? triangle.requiredDailyNew : NEW_PER_DAY)
  )

  // Questions pacing.
  const questionsFinishKey = settings.examDate != null ? addDaysToKey(settings.examDate, -settings.questionsFinishBufferDays) : null
  const behindPace = questionsBehindPace({
    publishedTotal: ctx.index.allQuestionIds.length,
    attemptedDistinct: evidence.attemptedDistinct,
    startKey: settings.questionsStartDay ?? evidence.firstAttemptKey ?? todayKey,
    finishKey: questionsFinishKey,
    todayKey
  })

  // Existing horizon rows (any status): the resurrect/duplicate guards are PER DAY, not today-only —
  // a task skipped or completed on day+2 must not come back when day+2 re-materializes.
  const horizonEnd = addDaysToKey(todayKey, PLAN_CONFIG.horizonDays - 1)
  const horizonRows = await db
    .select()
    .from(planTask)
    .where(and(gte(planTask.day, todayKey), lte(planTask.day, horizonEnd)))
  const rowsByDay = new Map<string, PlanTaskRow[]>()
  for (const r of horizonRows) {
    const arr = rowsByDay.get(r.day) ?? []
    arr.push(r)
    rowsByDay.set(r.day, arr)
  }
  const taskKey = (t: { kind: string; taxonomyRef: string | null; refine: string | null }): string =>
    `${t.kind}|${t.taxonomyRef ?? ''}|${t.refine ?? ''}`
  // A lesson appears at most once across the horizon: seed with surviving lesson rows anywhere in it.
  const lessonPlanned = new Set(
    horizonRows
      .filter((r) => r.kind === 'lesson' && r.status !== 'pending' && r.status !== 'expired' && r.taxonomyRef != null)
      .map((r) => r.taxonomyRef!)
  )

  const days: { day: string; tasks: PlannedTask[] }[] = []
  let poolRemaining = Math.max(0, pool.deckSize - pool.introducedSoFar)
  for (let i = 0; i < PLAN_CONFIG.horizonDays; i++) {
    const day = addDaysToKey(todayKey, i)
    const rows = rowsByDay.get(day) ?? []
    const skipped = rows.filter((r) => r.status === 'skipped')
    const surviving = rows.filter((r) => r.status !== 'pending' && r.status !== 'expired')
    const survivingKeys = new Set(surviving.map(taskKey))
    const usedMinutes = rows
      .filter((r) => (r.status === 'started' || r.status === 'completed') && !r.optional)
      .reduce((sum, r) => sum + r.minutes, 0)

    const questionsStarted = settings.questionsStartDay == null || day >= settings.questionsStartDay
    const newAllowance = i === 0 ? Math.max(0, dailyNewResolved - pool.introducedToday) : dailyNewResolved
    const newCardCount = Math.min(newAllowance, poolRemaining)
    poolRemaining -= newCardCount
    let tasks = materializeDay({
      day,
      budgetMinutes: settings.dailyBudgetMinutes,
      usedMinutes,
      topics: evidence.topics,
      dueCardCount: dueCounts.get(day) ?? 0,
      newCardCount,
      mistakeCandidates: i === 0 ? evidence.mistakeCandidates : [], // future days are speculative
      questionsStarted,
      behindPace,
      // Lesson skips are separate from practice skips: declining a lesson never costs the practice.
      skippedTopics: skipped
        .filter((r) => r.kind === 'questions' && r.refine == null && r.taxonomyRef != null)
        .map((r) => r.taxonomyRef!),
      skippedLessonTopics: skipped
        .filter((r) => r.kind === 'lesson' && r.taxonomyRef != null)
        .map((r) => r.taxonomyRef!),
      skippedKinds: skipped
        .map((r): PlanSkipKind | null =>
          r.refine === 'incorrect' ? 'mistakes' : r.kind === 'flashcards' ? 'flashcards' : null
        )
        .filter((k): k is PlanSkipKind => k != null),
      lessonAlreadyPlanned: [...lessonPlanned]
    })
    if (survivingKeys.size > 0) {
      tasks = tasks.filter((t) => !survivingKeys.has(taskKey(t)))
    }
    for (const t of tasks) if (t.kind === 'lesson' && t.taxonomyRef != null) lessonPlanned.add(t.taxonomyRef)
    days.push({ day, tasks })
  }

  await db.transaction(async (tx) => {
    // Past pending rows expire (the day is over; started work stays open for the user to finish).
    await tx
      .update(planTask)
      .set({ status: 'expired', updatedAt: now })
      .where(and(lt(planTask.day, todayKey), eq(planTask.status, 'pending')))
    // Replace the horizon's pending rows only.
    await tx
      .delete(planTask)
      .where(and(gte(planTask.day, todayKey), lte(planTask.day, horizonEnd), eq(planTask.status, 'pending')))
    for (const { day, tasks } of days) {
      for (let sortOrder = 0; sortOrder < tasks.length; sortOrder++) {
        const t = tasks[sortOrder]!
        await tx.insert(planTask).values({
          day, kind: t.kind, taxonomyRef: t.taxonomyRef, refine: t.refine,
          targetCount: t.targetCount, minutes: t.minutes, optional: t.optional,
          status: 'pending', why: t.why, sortOrder, createdAt: now, updatedAt: now
        })
        // Durable one-time offer marker — survives every future regeneration.
        if (t.kind === 'lesson' && t.taxonomyRef != null && !offers.has(t.taxonomyRef)) {
          offers.add(t.taxonomyRef)
          await tx
            .insert(planLessonOffer)
            .values({ lessonSlug: t.taxonomyRef, offeredAt: now })
            .onConflictDoNothing()
        }
      }
    }
  })
}

// ── The assembled view (the Plan page's data channel) ──

export async function getPlanView(db: DB, ctx: PlanContext): Promise<PlanView> {
  const now = ctx.now ?? new Date()
  const tz = ctx.tz ?? appTz()
  const todayKey = dayKeyInTz(now, tz)
  const horizonEnd = addDaysToKey(todayKey, PLAN_CONFIG.horizonDays - 1)
  const historyStart = addDaysToKey(todayKey, -30)

  const [settings, prefs, rows, pool] = await Promise.all([
    getPlanSettings(db),
    getPlanPrefs(db),
    db.select().from(planTask).where(and(gte(planTask.day, historyStart), lte(planTask.day, horizonEnd))),
    flashcardPool(db, dayKeyInTz(now, tz))
  ])

  const days: PlanView['days'] = []
  for (let i = 0; i < PLAN_CONFIG.horizonDays; i++) {
    const day = addDaysToKey(todayKey, i)
    days.push({
      day,
      tasks: rows.filter((r) => r.day === day).sort((a, b) => a.sortOrder - b.sortOrder).map(toTaskDto)
    })
  }

  const statusesByDay = new Map<string, StatusLike[]>()
  for (const r of rows) {
    if (r.day > todayKey) continue
    const arr = statusesByDay.get(r.day) ?? []
    arr.push({ status: r.status, optional: r.optional })
    statusesByDay.set(r.day, arr)
  }
  const outcomeByDay = new Map<string, DayOutcome>(
    [...statusesByDay.entries()].map(([day, statuses]) => [day, dayOutcome(statuses)])
  )
  const windowStatuses = onTrackWindowStatuses(statusesByDay, todayKey)
  const rate = planCompletionRate(windowStatuses)

  // A5: the skip-rate must cover the SAME span the streak can (the loaded 30-day history), not just
  // the 7-day on-track window — otherwise a heavy-skip stretch older than a week reads as a clean
  // streak with nothing disclosed. Same today-rule as the on-track window: an in-progress today
  // doesn't count until it's complete.
  const skipStatuses: StatusLike[] = []
  for (const [day, statuses] of statusesByDay) {
    if (day < todayKey || dayOutcome(statuses) === 'complete') skipStatuses.push(...statuses)
  }

  const triangleRaw = triangleFor(settings, pool, todayKey)
  const triangle: PlanTriangleDto | null = triangleRaw && settings.examDate != null
    ? {
        ...triangleRaw,
        deckSize: pool.deckSize,
        introducedSoFar: pool.introducedSoFar,
        daysToFinish: Math.max(0, dayNum(addDaysToKey(settings.examDate, -settings.finishBufferDays)) - dayNum(todayKey))
      }
    : null

  // Lightweight projection (not full rows) — the view only needs the pace facts.
  const paceRows = await db
    .select({ questionId: qbankAttempt.questionId, answeredAt: qbankAttempt.answeredAt })
    .from(qbankAttempt)
  const facts = paceFacts(paceRows, tz)
  const behindPace = questionsBehindPace({
    publishedTotal: ctx.index.allQuestionIds.length,
    attemptedDistinct: facts.attemptedDistinct,
    startKey: settings.questionsStartDay ?? facts.firstAttemptKey ?? todayKey,
    finishKey: settings.examDate != null ? addDaysToKey(settings.examDate, -settings.questionsFinishBufferDays) : null,
    todayKey
  })

  return {
    settings,
    days,
    prefs,
    progress: {
      streak: planStreak(outcomeByDay, todayKey),
      completionRate: rate,
      onTrack: onTrackStatus(rate),
      skipRate: planSkipRate(skipStatuses)
    },
    triangle,
    // Raw triangle material, exam date or not — the wizard runs the shared triangle live off these.
    pool: {
      deckSize: pool.deckSize,
      introducedSoFar: pool.introducedSoFar,
      rampDays: computeRampDays(),
      dailyNewCeiling: NEW_PER_DAY
    },
    questions: { publishedTotal: ctx.index.allQuestionIds.length, attemptedDistinct: facts.attemptedDistinct },
    behindPace
  }
}

// ── Regenerator: serialized + debounced (the three trigger paths call these) ──

export interface PlanRegenerator {
  /** Run now (launch + settings-change path). Serialized: overlapping calls coalesce into one rerun. */
  regenerate: () => Promise<void>
  /** Debounced trigger (activity-write path): many writes in a burst ⇒ one regeneration. */
  schedule: () => void
}

export function createPlanRegenerator(
  db: DB,
  ctx: Omit<PlanContext, 'now'>,
  opts: { debounceMs?: number; onError?: (e: unknown) => void } = {}
): PlanRegenerator {
  const debounceMs = opts.debounceMs ?? 3000
  const onError = opts.onError ?? ((e: unknown) => console.error('[plan] regeneration failed:', e))
  let running: Promise<void> | null = null
  let dirty = false
  let timer: NodeJS.Timeout | null = null

  // Failures PROPAGATE from `regenerate()` — an IPC save must not report ok over a stale plan.
  // The background `schedule()` path is the one that logs-and-swallows (nothing is waiting on it).
  const run = (): Promise<void> => {
    if (running) {
      dirty = true
      return running
    }
    running = (async () => {
      try {
        do {
          dirty = false
          await regeneratePlan(db, ctx)
        } while (dirty)
      } finally {
        running = null
      }
    })()
    return running
  }

  return {
    regenerate: run,
    schedule: (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        run().catch(onError)
      }, debounceMs)
    }
  }
}
