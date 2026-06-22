import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, type DB } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'

let db: DB
beforeEach(async () => {
  db = createDb(':memory:')
  await runMigrations(db, 'drizzle')
})

describe('gamification schema', () => {
  it('creates all gamification tables', async () => {
    const rows = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type='table' order by name`
    )
    const names = rows.map((r) => r.name)
    for (const t of ['profile', 'gamification_state', 'coin_ledger', 'pets', 'eggs', 'owned_items', 'daily_activity']) {
      expect(names).toContain(t)
    }
  })
})
