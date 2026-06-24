import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../src/main/db/client'
import { createTestDb } from './helpers/db'
import { seedTaxonomy } from '../src/main/db/seed-taxonomy'
import { taxonomySeed } from '../src/main/db/taxonomy-seed-data'
import { taxonomyNode } from '../src/main/db/schema'

let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('taxonomy seed', () => {
  it('seed data has full AAMC coverage by kind (4/10/31/3 = 48)', () => {
    const count = (k: string): number => taxonomySeed.filter((n) => n.kind === k).length
    expect(count('section')).toBe(4)
    expect(count('foundational_concept')).toBe(10)
    expect(count('content_category')).toBe(31)
    expect(count('skill')).toBe(3)
    expect(taxonomySeed).toHaveLength(48)
  })

  it('every non-section node has a parent that exists in the seed', () => {
    const ids = new Set(taxonomySeed.map((n) => n.id))
    for (const n of taxonomySeed) {
      if (n.kind !== 'section') expect(ids.has(n.parentId!)).toBe(true)
    }
  })

  it('every code is unique', () => {
    expect(new Set(taxonomySeed.map((n) => n.code)).size).toBe(taxonomySeed.length)
  })

  it('seeds all 48 nodes into the table', async () => {
    await seedTaxonomy(db)
    const all = await db.select().from(taxonomyNode)
    expect(all).toHaveLength(48)
  })

  it('seeding twice is idempotent (still exactly 48 rows, same counts)', async () => {
    await seedTaxonomy(db)
    await seedTaxonomy(db)
    const all = await db.select().from(taxonomyNode)
    expect(all).toHaveLength(48)
    const byKind = (k: string): number => all.filter((n) => n.kind === k).length
    expect(byKind('section')).toBe(4)
    expect(byKind('foundational_concept')).toBe(10)
    expect(byKind('content_category')).toBe(31)
    expect(byKind('skill')).toBe(3)
  })
})
