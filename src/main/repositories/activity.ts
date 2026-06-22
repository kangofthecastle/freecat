import { eq, sql, gt } from 'drizzle-orm'
import type { DB } from '../db/client'
import { eggs, pets, dailyActivity } from '../db/schema'
import { REWARDS_CONFIG } from '../../shared/gamification/config'
import { advanceIncubation, isReady } from '../../shared/gamification/incubation'
import { streakDays } from '../../shared/gamification/streak'
import { dayKeyInTz } from '../../shared/gamification/dates'
import { credit } from './gamification-state'
import type { ActivityResult, ServiceResult } from '../../shared/dto'
import { ok } from '../../shared/dto'

type Exec = DB | Parameters<Parameters<DB['transaction']>[0]>[0]

/** App timezone for day bucketing — the local machine tz (single local user). */
export function appTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export async function recordActivity(
  db: DB,
  p: { kind: string; count?: number; taxonomyRef?: string; now?: Date; tz?: string }
): Promise<ServiceResult<ActivityResult>> {
  const count = Math.max(1, Math.floor(p.count ?? 1))
  const now = p.now ?? new Date()
  const tz = p.tz ?? appTz()
  const dayKey = dayKeyInTz(now, tz)

  return db.transaction(async (tx) => {
    // 1. coins + xp for the activity
    await credit(tx, {
      coins: count * REWARDS_CONFIG.coinsPerActivity,
      xp: count * REWARDS_CONFIG.xpPerActivity,
      reason: 'activity', kind: p.kind, taxonomyRef: p.taxonomyRef ?? null, now
    })

    // 2. advance the incubating egg
    let eggBecameReady = false
    const [egg] = await tx.select().from(eggs).where(eq(eggs.status, 'incubating'))
    if (egg) {
      let pts = egg.incubationPoints
      for (let i = 0; i < count; i++) pts = advanceIncubation(pts)
      const ready = isReady(pts)
      eggBecameReady = ready
      await tx.update(eggs).set({ incubationPoints: pts, status: ready ? 'ready' : 'incubating' }).where(eq(eggs.id, egg.id))
    }

    // 3. refresh the active pet (studying = full happiness)
    await tx.update(pets)
      .set({ baseHappiness: REWARDS_CONFIG.happinessStart, lastInteractionAt: now })
      .where(eq(pets.isActive, true))

    // 4. bump today's activity counter
    await tx.insert(dailyActivity).values({ dayKey, count })
      .onConflictDoUpdate({ target: dailyActivity.dayKey, set: { count: sql`${dailyActivity.count} + ${count}` } })
    const [today] = await tx.select().from(dailyActivity).where(eq(dailyActivity.dayKey, dayKey))
    const todayCount = today?.count ?? count

    // 5. daily-goal bonus (once/day)
    let goalJustMet = false
    if (todayCount >= REWARDS_CONFIG.dailyGoal && today && today.goalAwardedAt == null) {
      await credit(tx, { coins: REWARDS_CONFIG.dailyGoalBonus, xp: 0, reason: 'daily_goal', kind: null, now })
      await tx.update(dailyActivity).set({ goalAwardedAt: now }).where(eq(dailyActivity.dayKey, dayKey))
      goalJustMet = true
    }

    const keys = await activeDayKeys(tx)
    return ok<ActivityResult>({
      streak: streakDays(keys, now, tz),
      daily: { count: todayCount, goal: REWARDS_CONFIG.dailyGoal, met: todayCount >= REWARDS_CONFIG.dailyGoal },
      eggBecameReady, goalJustMet
    })
  })
}

export async function getStreak(db: DB, now = new Date(), tz = appTz()): Promise<number> {
  return streakDays(await activeDayKeys(db), now, tz)
}

export async function getDailyProgress(db: DB, now = new Date(), tz = appTz()): Promise<{ count: number; goal: number; met: boolean }> {
  const [row] = await db.select().from(dailyActivity).where(eq(dailyActivity.dayKey, dayKeyInTz(now, tz)))
  const count = row?.count ?? 0
  return { count, goal: REWARDS_CONFIG.dailyGoal, met: count >= REWARDS_CONFIG.dailyGoal }
}

async function activeDayKeys(db: Exec): Promise<Set<string>> {
  const rows = await db.select({ k: dailyActivity.dayKey }).from(dailyActivity).where(gt(dailyActivity.count, 0))
  return new Set(rows.map((r) => r.k))
}
