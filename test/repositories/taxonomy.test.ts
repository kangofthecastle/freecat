import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import {
  seedTaxonomy, listDisciplinesWithTopics, getTopicBySlug, topicForTaxonomyRef
} from '../../src/main/repositories/taxonomy'

let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('taxonomy repository', () => {
  it('seeds disciplines and topics', async () => {
    await seedTaxonomy(db)
    const groups = await listDisciplinesWithTopics(db)
    expect(groups).toHaveLength(6)
    const totalTopics = groups.reduce((n, g) => n + g.topics.length, 0)
    expect(totalTopics).toBe(29)
    const biochem = groups.find((g) => g.discipline === 'biochem')
    expect(biochem?.topics.map((t) => t.slug)).toContain('biochem.enzymes')
  })

  it('is idempotent (re-seeding does not duplicate)', async () => {
    await seedTaxonomy(db)
    await seedTaxonomy(db)
    const groups = await listDisciplinesWithTopics(db)
    const totalTopics = groups.reduce((n, g) => n + g.topics.length, 0)
    expect(totalTopics).toBe(29)
  })

  it('resolves a topic by slug with discipline + aamc codes', async () => {
    await seedTaxonomy(db)
    const topic = await getTopicBySlug(db, 'biochem.enzymes')
    expect(topic).not.toBeNull()
    expect(topic?.discipline).toBe('biochem')
    expect(topic?.aamcCodes).toContain('1A')
  })

  // The topic_aamc_category bridge is retired (spec §4): taxonomy refs resolve by
  // slug only. topicsForAamcCode no longer exists.
  it('resolves a taxonomy ref by slug', async () => {
    await seedTaxonomy(db)
    const bySlug = await topicForTaxonomyRef(db, 'biochem.enzymes')
    expect(bySlug?.slug).toBe('biochem.enzymes')
    expect(bySlug?.discipline).toBe('biochem')
    expect(bySlug?.aamcCodes).toContain('1A')
  })

  it('returns null for an unknown ref', async () => {
    await seedTaxonomy(db)
    expect(await topicForTaxonomyRef(db, 'nope.nothing')).toBeNull()
    // a bare AAMC code is no longer resolvable now the bridge is gone
    expect(await topicForTaxonomyRef(db, '3A')).toBeNull()
  })
})
