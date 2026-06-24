import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('content-review schema', () => {
  it('creates the taxonomy + lesson-progress tables', async () => {
    const rows = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type='table' order by name`
    )
    const names = rows.map((r) => r.name)
    for (const t of ['taxonomy_node', 'topic_aamc_category', 'lesson_progress']) {
      expect(names).toContain(t)
    }
  })
})
