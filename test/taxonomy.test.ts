import { describe, it, expect } from 'vitest'
import { createTestDb } from './helpers/db'
// seedTaxonomy is exported from the taxonomy repository (Phase 0 standardized on
// this seeder, sourced from the TOPICS/DISCIPLINES constants in seed/taxonomy-data).
import { seedTaxonomy, listDisciplinesWithTopics } from '../src/main/repositories/taxonomy'

describe('physics discipline', () => {
  it('seeds physics with four topics under chem-phys disciplines', async () => {
    const db = await createTestDb()
    await seedTaxonomy(db)
    const tree = await listDisciplinesWithTopics(db)
    const physics = tree.find((d) => d.discipline === 'physics')
    expect(physics).toBeDefined()
    expect(physics!.topics.map((t) => t.slug).sort()).toEqual([
      'physics.electrostatics-circuits',
      'physics.fluids',
      'physics.mechanics',
      'physics.waves-sound-light'
    ])
    expect(
      physics!.topics.find((t) => t.slug === 'physics.waves-sound-light')!.aamcCodes
    ).toContain('4D')
  })
})
