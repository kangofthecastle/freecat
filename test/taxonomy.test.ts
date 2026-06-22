import { describe, it, expect, beforeEach } from 'vitest'
import { createDb, type DB } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'
import { seedTaxonomy } from '../src/main/db/seed-taxonomy'
import { taxonomySeed } from '../src/main/db/taxonomy-seed-data'
import { taxonomyNode } from '../src/main/db/schema'
import { listSections, getByCode, getChildren } from '../src/main/repositories/taxonomy'

let db: DB
beforeEach(async () => {
  db = createDb(':memory:')
  await runMigrations(db, 'drizzle')
  await seedTaxonomy(db)
})

describe('taxonomy seed + repository', () => {
  it('seeds the 4 MCAT sections', async () => {
    const sections = await listSections(db)
    expect(sections.map((s) => s.code).sort()).toEqual(['bio-biochem', 'cars', 'chem-phys', 'psych-soc'])
  })

  it('has full AAMC coverage by kind', () => {
    const count = (k: string) => taxonomySeed.filter((n) => n.kind === k).length
    expect(count('section')).toBe(4)
    expect(count('foundational_concept')).toBe(10)
    expect(count('content_category')).toBe(31)
    expect(count('skill')).toBe(3)
  })

  it('every non-section node has a parent that exists', () => {
    const ids = new Set(taxonomySeed.map((n) => n.id))
    for (const n of taxonomySeed) {
      if (n.kind !== 'section') expect(ids.has(n.parentId!)).toBe(true)
    }
  })

  it('every code is unique', () => {
    expect(new Set(taxonomySeed.map((n) => n.code)).size).toBe(taxonomySeed.length)
  })

  it('looks up a content category by code', async () => {
    const cc = await getByCode(db, '4A')
    expect(cc?.kind).toBe('content_category')
    expect(cc?.parentId).toBe('fc:4')
  })

  it('lists children of a foundational concept (4A–4E)', async () => {
    const fc4 = await getByCode(db, '4')
    const kids = await getChildren(db, fc4!.id)
    expect(kids.length).toBe(5)
  })

  it('seeding twice is idempotent', async () => {
    await seedTaxonomy(db)
    const all = await db.select().from(taxonomyNode)
    expect(all.length).toBe(taxonomySeed.length)
  })
})
