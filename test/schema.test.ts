import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { type DB } from '../src/main/db/client'
import { createTestDb } from './helpers/db'

let db: DB
beforeEach(async () => {
  db = await createTestDb()
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
