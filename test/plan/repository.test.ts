import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq, gte } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import type { ContentIndex, QuestionContent } from '../../src/main/content/types'
import { createSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import { toggleFlag } from '../../src/main/repositories/qbank-flags'
import {
  getPlanSettings, savePlanSettings, savePlanPrefs, getPlanPrefs,
  regeneratePlan, getPlanView, setPlanTaskStatus, type PlanContext
} from '../../src/main/repositories/plan'
import { computeRampDays } from '../../src/main/plan/fsrs-ramp'
import { NEW_PER_DAY } from '../../src/main/repositories/review'
import { planTask, planLessonOffer, lessonProgress } from '../../src/main/db/schema'

const NOW = new Date('2026-07-17T12:00:00Z')
const TZ = 'UTC'
const TODAY = '2026-07-17'
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

function q(id: string, topic: string, discipline: string, section: string): QuestionContent {
  return {
    id, topic, discipline: discipline as QuestionContent['discipline'], section: section as QuestionContent['section'],
    tags: [], passageId: null, stem: `stem ${id}`, choices: ['a', 'b', 'c', 'd'],
    correct: 'A', explanation: 'e', choiceExplanations: {}
  }
}

/** 12 mechanics + 8 enzymes published questions. */
function makeIndex(): ContentIndex {
  const byId = new Map<string, QuestionContent>()
  const mech: string[] = []
  const enz: string[] = []
  for (let i = 0; i < 12; i++) {
    const id = `cp-${i}`
    byId.set(id, q(id, 'physics.mechanics', 'physics', 'chem-phys'))
    mech.push(id)
  }
  for (let i = 0; i < 8; i++) {
    const id = `bb-${i}`
    byId.set(id, q(id, 'biochem.enzymes', 'biochem', 'bio-biochem'))
    enz.push(id)
  }
  return {
    byId, passagesById: new Map(),
    byTopic: new Map([['physics.mechanics', mech], ['biochem.enzymes', enz]]),
    byDiscipline: new Map(), byTag: new Map(),
    allQuestionIds: [...byId.keys()], errors: []
  }
}

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  index: makeIndex(),
  lessonSlugs: new Set(['physics.mechanics']),
  now: NOW,
  tz: TZ,
  ...over
})

async function seedAttempts(): Promise<void> {
  // Old misses (past the spaced gap) + a fresh correct, so mistakes and mastery both have material.
  const s0 = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: daysAgo(5) })
  for (let i = 0; i < 5; i++) {
    await recordAttempt(db, {
      sessionId: s0.id, questionId: `cp-${i}`, passageId: null, topic: 'physics.mechanics',
      discipline: 'physics', section: 'chem-phys', chosen: 'B', isCorrect: false, now: daysAgo(5)
    })
  }
  const s1 = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 10, now: NOW })
  await recordAttempt(db, {
    sessionId: s1.id, questionId: 'bb-0', passageId: null, topic: 'biochem.enzymes',
    discipline: 'biochem', section: 'bio-biochem', chosen: 'A', isCorrect: true, now: NOW
  })
}

describe('plan settings', () => {
  it('defaults when no row exists; simple fields persist', async () => {
    expect(await getPlanSettings(db)).toMatchObject({ examDate: null, dailyBudgetMinutes: 60 })
    await savePlanSettings(db, { dailyBudgetMinutes: 90, examDate: '2026-12-01' }, { now: NOW, tz: TZ })
    expect(await getPlanSettings(db)).toMatchObject({ examDate: '2026-12-01', dailyBudgetMinutes: 90 })
  })

  it('goalPct edit without an exam date is refused with guidance', async () => {
    const r = await savePlanSettings(db, { pacingEdit: { field: 'goalPct', value: 80 } }, { now: NOW, tz: TZ })
    expect(r.pacing?.ok).toBe(false)
    expect(r.pacing?.refusalReason).toContain('exam date')
    expect((await getPlanSettings(db)).masteryGoalPct).toBe(null)
  })

  it('dailyNew edit stores directly in habit mode, clamped to the reviewer ceiling', async () => {
    const r = await savePlanSettings(db, { pacingEdit: { field: 'dailyNew', value: 99 } }, { now: NOW, tz: TZ })
    expect(r.pacing?.ok).toBe(true)
    expect((await getPlanSettings(db)).dailyNewTarget).toBe(NEW_PER_DAY)
  })

  it('exam-date change keeps dailyNewTarget and re-derives the goal (never raises workload)', async () => {
    // Empty pool ⇒ reachable goal is vacuously 100; the mechanism (recompute on exam move) is what's under test.
    await savePlanSettings(db, { examDate: '2026-12-01', pacingEdit: { field: 'dailyNew', value: 10 } }, { now: NOW, tz: TZ })
    const before = await getPlanSettings(db)
    const r = await savePlanSettings(db, { examDate: '2026-08-01' }, { now: NOW, tz: TZ })
    expect(r.pacing).not.toBe(null)
    expect((await getPlanSettings(db)).dailyNewTarget).toBe(before.dailyNewTarget)
  })
})

describe('plan prefs', () => {
  it('upserts and reads back comfort/exclusions', async () => {
    await savePlanPrefs(db, [
      { taxonomyRef: 'physics', comfort: 2, excluded: false },
      { taxonomyRef: 'physics.mechanics', comfort: 4, excluded: false }
    ], NOW)
    await savePlanPrefs(db, [{ taxonomyRef: 'physics', comfort: 1, excluded: false }], NOW)
    const prefs = await getPlanPrefs(db)
    expect(prefs.find((p) => p.taxonomyRef === 'physics')?.comfort).toBe(1)
    expect(prefs.find((p) => p.taxonomyRef === 'physics.mechanics')?.comfort).toBe(4)
  })
})

describe('regeneratePlan', () => {
  it('materializes today+6 with mistake review today only, and records lesson offers once', async () => {
    await seedAttempts()
    await regeneratePlan(db, ctx())
    const rows = await db.select().from(planTask)
    const days = [...new Set(rows.map((r) => r.day))].sort()
    expect(days).toHaveLength(7)
    expect(days[0]).toBe(TODAY)

    // Mistake review (5 old misses ≥ gap) exists today, never on speculative future days.
    const mistakes = rows.filter((r) => r.refine === 'incorrect')
    expect(mistakes).toHaveLength(1)
    expect(mistakes[0]!.day).toBe(TODAY)
    expect(mistakes[0]!.targetCount).toBe(5)

    // The mechanics lesson offer landed as an optional task AND a durable offer row.
    const lessons = rows.filter((r) => r.kind === 'lesson')
    expect(lessons.length).toBeGreaterThan(0)
    expect(lessons.every((l) => l.optional)).toBe(true)
    const offers = await db.select().from(planLessonOffer)
    expect(offers.map((o) => o.lessonSlug)).toEqual(['physics.mechanics'])

    // Re-regenerating is idempotent for offers and keeps exactly one pending set.
    await regeneratePlan(db, ctx())
    expect(await db.select().from(planLessonOffer)).toHaveLength(1)
    const after = await db.select().from(planTask).where(gte(planTask.day, TODAY))
    expect(after.every((r) => r.status === 'pending')).toBe(true)
    expect([...new Set(after.map((r) => r.day))]).toHaveLength(7)
  })

  it('a completed lesson stops offering; an offered-but-unbuilt lesson never re-offers', async () => {
    await seedAttempts()
    await db.insert(lessonProgress).values({ lessonSlug: 'physics.mechanics', completedAt: NOW, lastViewedAt: NOW, countedForReward: true })
    await regeneratePlan(db, ctx())
    const rows = await db.select().from(planTask)
    expect(rows.filter((r) => r.kind === 'lesson')).toHaveLength(0)
  })

  it('preserves completed/skipped/started rows and honors same-day skip guards', async () => {
    await seedAttempts()
    await regeneratePlan(db, ctx())
    const rows = await db.select().from(planTask).where(eq(planTask.day, TODAY))
    const mistake = rows.find((r) => r.refine === 'incorrect')!
    const practice = rows.find((r) => r.kind === 'questions' && r.refine == null)!
    await setPlanTaskStatus(db, { taskId: mistake.id, status: 'skipped' }, NOW)
    await setPlanTaskStatus(db, { taskId: practice.id, status: 'completed' }, NOW)

    await regeneratePlan(db, ctx())
    const after = await db.select().from(planTask).where(eq(planTask.day, TODAY))
    // The skipped mistake review did not resurrect; the completed practice row survived untouched.
    expect(after.filter((r) => r.refine === 'incorrect')).toHaveLength(1)
    expect(after.find((r) => r.refine === 'incorrect')!.status).toBe('skipped')
    expect(after.find((r) => r.id === practice.id)!.status).toBe('completed')
    // And its topic did not re-materialize as a duplicate pending task.
    expect(after.filter((r) => r.taxonomyRef === practice.taxonomyRef && r.kind === 'questions')).toHaveLength(1)
  })

  it('expires yesterday\'s pending on the next roll', async () => {
    await seedAttempts()
    await regeneratePlan(db, ctx())
    const tomorrow = new Date(NOW.getTime() + 86_400_000)
    await regeneratePlan(db, ctx({ now: tomorrow }))
    const stale = await db
      .select()
      .from(planTask)
      .where(and(eq(planTask.day, TODAY), eq(planTask.status, 'expired')))
    expect(stale.length).toBeGreaterThan(0)
  })

  it('excluded discipline suppresses its topics\' practice (inheritance)', async () => {
    await seedAttempts()
    await savePlanPrefs(db, [{ taxonomyRef: 'physics', comfort: null, excluded: true }], NOW)
    await regeneratePlan(db, ctx())
    const rows = await db.select().from(planTask)
    expect(rows.some((r) => r.taxonomyRef === 'physics.mechanics' && r.kind === 'questions')).toBe(false)
    expect(rows.some((r) => r.taxonomyRef === 'biochem.enzymes')).toBe(true)
  })

  it('questions start gate: no practice before the start day; flashcards unaffected', async () => {
    await seedAttempts()
    await savePlanSettings(db, { questionsStartDay: '2026-07-19' }, { now: NOW, tz: TZ })
    await regeneratePlan(db, ctx())
    const rows = await db.select().from(planTask)
    const practiceDays = rows.filter((r) => r.kind === 'questions' && r.refine == null).map((r) => r.day)
    expect(practiceDays.every((d) => d >= '2026-07-19')).toBe(true)
    expect(practiceDays.length).toBeGreaterThan(0)
  })
})

describe('getPlanView', () => {
  it('assembles days, triangle (exam mode), and progress', async () => {
    await seedAttempts()
    await savePlanSettings(db, { examDate: '2026-12-01' }, { now: NOW, tz: TZ })
    await regeneratePlan(db, ctx())
    const view = await getPlanView(db, ctx())
    expect(view.days).toHaveLength(7)
    expect(view.days[0]!.day).toBe(TODAY)
    expect(view.days[0]!.tasks.length).toBeGreaterThan(0)
    expect(view.triangle).not.toBe(null)
    expect(view.triangle!.rampDays).toBe(computeRampDays())
    expect(view.progress.streak).toBe(0)
    expect(view.settings.examDate).toBe('2026-12-01')
    // titles resolve for the debug surface
    const titles = view.days[0]!.tasks.map((t) => t.title)
    expect(titles).toContain('Mistake review')
  })

  it('habit mode: no triangle, plan still materializes', async () => {
    await seedAttempts()
    await regeneratePlan(db, ctx())
    const view = await getPlanView(db, ctx())
    expect(view.triangle).toBe(null)
    expect(view.days.flatMap((d) => d.tasks).length).toBeGreaterThan(0)
  })
})

describe('setPlanTaskStatus', () => {
  it('guards: unknown id, expired rows immutable', async () => {
    await seedAttempts()
    await regeneratePlan(db, ctx())
    expect((await setPlanTaskStatus(db, { taskId: 99_999, status: 'completed' }, NOW)).ok).toBe(false)
    const [row] = await db.select().from(planTask).where(eq(planTask.day, TODAY))
    await db.update(planTask).set({ status: 'expired' }).where(eq(planTask.id, row!.id))
    const res = await setPlanTaskStatus(db, { taskId: row!.id, status: 'completed' }, NOW)
    expect(res.ok).toBe(false)
  })
})
