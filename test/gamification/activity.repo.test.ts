import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { recordActivity, getStreak, getDailyProgress } from '../../src/main/repositories/activity'
import { getState } from '../../src/main/repositories/gamification-state'
import { eggs, pets, dailyActivity } from '../../src/main/db/schema'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'

const TZ = 'UTC'
const NOW = new Date('2026-06-22T12:00:00Z')
let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('recordActivity', () => {
  it('credits coins + xp and logs the activity', async () => {
    const r = await recordActivity(db, { kind: 'qbank.answer', count: 1, now: NOW, tz: TZ })
    expect(r.ok).toBe(true)
    const s = await getState(db)
    expect(s.coins).toBe(REWARDS_CONFIG.coinsPerActivity)
    expect(s.xp).toBe(REWARDS_CONFIG.xpPerActivity)
  })

  it('advances an incubating egg and flips it to ready at threshold', async () => {
    await db.insert(eggs).values({ incubationPoints: REWARDS_CONFIG.incubationThreshold - 1, status: 'incubating' })
    await recordActivity(db, { kind: 'flashcard.review', count: 1, now: NOW, tz: TZ })
    const [egg] = await db.select().from(eggs)
    expect(egg?.incubationPoints).toBe(REWARDS_CONFIG.incubationThreshold)
    expect(egg?.status).toBe('ready')
  })

  it('refreshes the active pet (happiness reset, lastInteractionAt = now)', async () => {
    await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true, baseHappiness: 30, lastInteractionAt: new Date('2026-06-01T00:00:00Z') })
    await recordActivity(db, { kind: 'qbank.answer', count: 1, now: NOW, tz: TZ })
    const [pet] = await db.select().from(pets)
    expect(pet?.baseHappiness).toBe(REWARDS_CONFIG.happinessStart)
    expect(pet?.lastInteractionAt.getTime()).toBe(NOW.getTime())
  })

  it('awards the daily-goal bonus once when the goal is reached', async () => {
    await recordActivity(db, { kind: 'q', count: REWARDS_CONFIG.dailyGoal, now: NOW, tz: TZ })
    const afterGoal = await getState(db)
    expect(afterGoal.coins).toBe(REWARDS_CONFIG.dailyGoal * REWARDS_CONFIG.coinsPerActivity + REWARDS_CONFIG.dailyGoalBonus)
    const [row] = await db.select().from(dailyActivity).where(eq(dailyActivity.dayKey, '2026-06-22'))
    expect(row?.goalAwardedAt).not.toBeNull()
    const before = (await getState(db)).coins
    await recordActivity(db, { kind: 'q', count: 1, now: new Date(NOW.getTime() + 1000), tz: TZ })
    expect((await getState(db)).coins).toBe(before + REWARDS_CONFIG.coinsPerActivity)
  })

  it('tracks streak + daily progress', async () => {
    await recordActivity(db, { kind: 'q', count: 3, now: NOW, tz: TZ })
    expect(await getStreak(db, NOW, TZ)).toBe(1)
    expect(await getDailyProgress(db, NOW, TZ)).toEqual({ count: 3, goal: REWARDS_CONFIG.dailyGoal, met: false })
  })

  it('succeeds with no egg and no pet', async () => {
    const r = await recordActivity(db, { kind: 'q', count: 1, now: NOW, tz: TZ })
    expect(r.ok).toBe(true)
  })
})
