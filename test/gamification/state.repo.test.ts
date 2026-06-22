import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { getState, credit, spend } from '../../src/main/repositories/gamification-state'
import { coinLedger } from '../../src/main/db/schema'

let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('gamification-state repository', () => {
  it('lazily reports 0 coins / 0 xp before any credit', async () => {
    const s = await getState(db)
    expect(s.coins).toBe(0)
    expect(s.xp).toBe(0)
  })

  it('credit adds coins + xp and writes a positive ledger row', async () => {
    const s = await credit(db, { coins: 5, xp: 50, reason: 'activity', kind: 'test', now: new Date() })
    expect(s.coins).toBe(5)
    expect(s.xp).toBe(50)
    expect((await getState(db)).coins).toBe(5)
    const ledger = await db.select().from(coinLedger)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.amount).toBe(5)
    expect(ledger[0]?.reason).toBe('activity')
    expect(ledger[0]?.kind).toBe('test')
  })

  it('credit with coins:0 (xp-only) writes NO ledger row', async () => {
    await credit(db, { coins: 0, xp: 30, reason: 'activity', kind: null, now: new Date() })
    expect((await getState(db)).xp).toBe(30)
    expect(await db.select().from(coinLedger)).toHaveLength(0)
  })

  it('spend debits coins, returns remaining, writes a negative ledger row, and refuses overdraft', async () => {
    await credit(db, { coins: 30, xp: 0, reason: 'activity', kind: null, now: new Date() })
    const okRes = await spend(db, { amount: 20, reason: 'spend_egg', now: new Date() })
    expect(okRes).toEqual({ ok: true, data: 10 })
    expect((await getState(db)).coins).toBe(10)
    const spendRows = await db.select().from(coinLedger).where(eq(coinLedger.reason, 'spend_egg'))
    expect(spendRows).toHaveLength(1)
    expect(spendRows[0]?.amount).toBe(-20)
    const bad = await spend(db, { amount: 999, reason: 'spend_egg', now: new Date() })
    expect(bad).toEqual({ ok: false, error: 'insufficient-coins' })
  })
})
