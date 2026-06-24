import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import {
  seedTaxonomy, listDisciplinesWithTopics, getTopicBySlug, topicsForAamcCode, topicForTaxonomyRef
} from '../../src/main/repositories/taxonomy'

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('taxonomy repository', () => {
  it('seeds disciplines, topics, and aamc mappings', async () => {
    await seedTaxonomy(db)
    const groups = await listDisciplinesWithTopics(db)
    expect(groups).toHaveLength(5)
    const totalTopics = groups.reduce((n, g) => n + g.topics.length, 0)
    expect(totalTopics).toBe(25)
    const biochem = groups.find((g) => g.discipline === 'biochem')
    expect(biochem?.topics.map((t) => t.slug)).toContain('biochem.enzymes')
  })

  it('is idempotent (re-seeding does not duplicate)', async () => {
    await seedTaxonomy(db)
    await seedTaxonomy(db)
    const groups = await listDisciplinesWithTopics(db)
    const totalTopics = groups.reduce((n, g) => n + g.topics.length, 0)
    expect(totalTopics).toBe(25)
  })

  it('resolves a topic by slug with discipline + aamc codes', async () => {
    await seedTaxonomy(db)
    const topic = await getTopicBySlug(db, 'biochem.enzymes')
    expect(topic).not.toBeNull()
    expect(topic?.discipline).toBe('biochem')
    expect(topic?.aamcCodes).toContain('1A')
  })

  it('finds topics for an AAMC code', async () => {
    await seedTaxonomy(db)
    const topics = await topicsForAamcCode(db, '1A')
    const slugs = topics.map((t) => t.slug)
    expect(slugs).toContain('biochem.enzymes')
    expect(slugs).toContain('biochem.amino-acids-proteins')
  })

  it('resolves a taxonomy ref by slug OR by AAMC code', async () => {
    await seedTaxonomy(db)
    const bySlug = await topicForTaxonomyRef(db, 'biochem.enzymes')
    expect(bySlug?.slug).toBe('biochem.enzymes')
    const byCode = await topicForTaxonomyRef(db, '3A')
    expect(byCode?.slug).toBe('biology.endocrine-nervous')
    const miss = await topicForTaxonomyRef(db, 'nope.nothing')
    expect(miss).toBeNull()
  })
})
