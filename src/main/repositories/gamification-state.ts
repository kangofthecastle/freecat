import { sql, eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { gamificationState, coinLedger } from '../db/schema'
import { canAfford } from '../../shared/gamification/economy'
import type { CoinReason, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'

// Accepts either the top-level DB or a transaction handle, so callers in later tasks can reuse
// credit/spend inside db.transaction(...).
type Exec = DB | Parameters<Parameters<DB['transaction']>[0]>[0]

export async function getState(db: Exec): Promise<{ coins: number; xp: number }> {
  const [row] = await db
    .select({ coins: gamificationState.coins, xp: gamificationState.xp })
    .from(gamificationState)
    .where(eq(gamificationState.id, 1))
  return { coins: row?.coins ?? 0, xp: row?.xp ?? 0 }
}

export async function credit(
  db: Exec,
  p: { coins: number; xp: number; reason: CoinReason; kind: string | null; taxonomyRef?: string | null; now: Date }
): Promise<{ coins: number; xp: number }> {
  await db
    .insert(gamificationState)
    .values({ id: 1, coins: p.coins, xp: p.xp, updatedAt: p.now })
    .onConflictDoUpdate({
      target: gamificationState.id,
      set: {
        coins: sql`${gamificationState.coins} + ${p.coins}`,
        xp: sql`${gamificationState.xp} + ${p.xp}`,
        updatedAt: p.now
      }
    })
  if (p.coins !== 0) {
    await db.insert(coinLedger).values({ amount: p.coins, reason: p.reason, kind: p.kind, taxonomyRef: p.taxonomyRef ?? null, createdAt: p.now })
  }
  return getState(db)
}

export async function spend(
  db: Exec,
  p: { amount: number; reason: CoinReason; now: Date }
): Promise<ServiceResult<number>> {
  const { coins } = await getState(db)
  if (!canAfford(coins, p.amount)) return err('insufficient-coins')
  await db.update(gamificationState).set({ coins: coins - p.amount, updatedAt: p.now }).where(eq(gamificationState.id, 1))
  await db.insert(coinLedger).values({ amount: -p.amount, reason: p.reason, kind: null, taxonomyRef: null, createdAt: p.now })
  return ok(coins - p.amount)
}
