import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../src/main/db/client'
import { createTestDb } from './helpers/db'
import { seedTaxonomy } from '../src/main/db/seed-taxonomy'
import { taxonomySeed } from '../src/main/db/taxonomy-seed-data'
import { taxonomyNode } from '../src/main/db/schema'
import { listAll, listSections, getByCode, getChildren } from '../src/main/repositories/taxonomy'

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

describe('taxonomy repository', () => {
  beforeEach(async () => {
    await seedTaxonomy(db)
  })

  it('listAll returns all 48 nodes', async () => {
    const all = await listAll(db)
    expect(all).toHaveLength(48)
  })

  it('listSections returns the 4 MCAT sections', async () => {
    const sections = await listSections(db)
    expect(sections).toHaveLength(4)
    expect(sections.map((s) => s.code).sort()).toEqual(['bio-biochem', 'cars', 'chem-phys', 'psych-soc'])
  })

  it("getByCode('4A') returns the content_category node under fc:4", async () => {
    const cc = await getByCode(db, '4A')
    expect(cc?.id).toBe('cc:4A')
    expect(cc?.kind).toBe('content_category')
    expect(cc?.parentId).toBe('fc:4')
  })

  it("getChildren('section:chem-phys') returns its foundational concepts (fc:4, fc:5)", async () => {
    const kids = await getChildren(db, 'section:chem-phys')
    expect(kids.map((k) => k.id).sort()).toEqual(['fc:4', 'fc:5'])
    expect(kids.every((k) => k.kind === 'foundational_concept')).toBe(true)
  })
})
