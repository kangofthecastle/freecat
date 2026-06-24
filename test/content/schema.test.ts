import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { standaloneQuestionSchema, passageSchema } from '../../src/main/content/schema'

const base = {
  id: 'cp-0042-doppler',
  stem: 'A sonographer measures blood flow toward the probe.',
  choices: [
    'Observed frequency rises',
    'Observed frequency falls',
    'Wavelength is unchanged',
    'Speed of sound doubles'
  ],
  correct: 'A',
  explanation: 'An approaching source compresses successive wavefronts.'
}

describe('standaloneQuestionSchema', () => {
  it('parses topic + tags', () => {
    const r = standaloneQuestionSchema.parse({
      ...base,
      topic: 'biochem.enzymes',
      tags: [{ vocab: 'aamc', code: '1A' }]
    })
    expect(r.topic).toBe('biochem.enzymes')
    expect(r.tags).toEqual([{ vocab: 'aamc', code: '1A' }])
  })

  it('defaults tags to []', () => {
    expect(standaloneQuestionSchema.parse({ ...base, topic: 'biochem.enzymes' }).tags).toEqual([])
  })

  it('requires topic', () => {
    expect(() => standaloneQuestionSchema.parse(base)).toThrow()
  })

  it('rejects legacy contentCategory key', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...base, topic: 'x', contentCategory: '1A' })
    ).toThrow()
  })

  it('rejects legacy skill key', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...base, topic: 'x', skill: 'cars-foundations' })
    ).toThrow()
  })

  it('rejects a tag missing its code', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...base, topic: 'x', tags: [{ vocab: 'aamc' }] })
    ).toThrow()
  })

  it('rejects a question with 3 choices', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...base, topic: 'x', choices: ['a', 'b', 'c'] })
    ).toThrow()
  })

  it('rejects a question with 5 choices', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...base, topic: 'x', choices: ['a', 'b', 'c', 'd', 'e'] })
    ).toThrow()
  })

  it('rejects a correct letter outside A-D', () => {
    expect(() => standaloneQuestionSchema.parse({ ...base, topic: 'x', correct: 'E' })).toThrow()
  })

  it('rejects an unknown choiceExplanations key', () => {
    expect(() =>
      standaloneQuestionSchema.parse({
        ...base,
        topic: 'x',
        choiceExplanations: { E: 'no such choice' }
      })
    ).toThrow()
  })

  it('rejects a missing explanation', () => {
    const { explanation, ...noExpl } = base
    void explanation
    expect(() => standaloneQuestionSchema.parse({ ...noExpl, topic: 'x' })).toThrow()
  })
})

const goodPassage = {
  id: 'bb-0007-enzyme-kinetics',
  topic: 'biochem.enzymes',
  tags: [{ vocab: 'aamc', code: '1A' }],
  passage: 'Markdown prose about enzymes.',
  questions: [
    {
      id: 'bb-0007-q1',
      stem: 'What is Km?',
      choices: ['a', 'b', 'c', 'd'],
      correct: 'C',
      explanation: 'Km is the substrate concentration at half Vmax.'
    },
    {
      id: 'bb-0007-q2',
      tags: [{ vocab: 'aamc', code: '5E' }],
      stem: 'A per-question tag override.',
      choices: ['a', 'b', 'c', 'd'],
      correct: 'B',
      explanation: 'Sub-questions may carry their own tags.'
    }
  ]
}

describe('passageSchema', () => {
  it('parses a well-formed passage set', () => {
    const parsed = passageSchema.parse(goodPassage)
    expect(parsed.topic).toBe('biochem.enzymes')
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.passage).toContain('enzymes')
  })

  it('defaults passage tags to []', () => {
    const { tags, ...noTags } = goodPassage
    void tags
    expect(passageSchema.parse(noTags).tags).toEqual([])
  })

  it('requires a passage topic', () => {
    const { topic, ...noTopic } = goodPassage
    void topic
    expect(() => passageSchema.parse(noTopic)).toThrow()
  })

  it('defaults a sub-question without its own tags to [] (inherits passage topic)', () => {
    const parsed = passageSchema.parse(goodPassage)
    expect(parsed.questions[0]?.tags).toEqual([])
  })

  it('keeps a sub-question that carries its own tags', () => {
    const parsed = passageSchema.parse(goodPassage)
    expect(parsed.questions[1]?.tags).toEqual([{ vocab: 'aamc', code: '5E' }])
  })

  it('rejects a sub-question that sets a legacy contentCategory key', () => {
    const bad = {
      ...goodPassage,
      questions: [{ ...goodPassage.questions[0], contentCategory: '1A' }]
    }
    expect(() => passageSchema.parse(bad)).toThrow()
  })

  it('rejects a passage with a legacy contentCategory key', () => {
    expect(() => passageSchema.parse({ ...goodPassage, contentCategory: '1A' })).toThrow()
  })

  it('rejects an empty questions array', () => {
    expect(() => passageSchema.parse({ ...goodPassage, questions: [] })).toThrow()
  })

  it('rejects a sub-question with 3 choices', () => {
    const bad = {
      ...goodPassage,
      questions: [{ ...goodPassage.questions[0], choices: ['a', 'b', 'c'] }]
    }
    expect(() => passageSchema.parse(bad)).toThrow()
  })
})

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
    // topic_aamc_category is retired (spec §4); the bridge table no longer exists.
    for (const t of ['taxonomy_node', 'lesson_progress']) {
      expect(names).toContain(t)
    }
    expect(names).not.toContain('topic_aamc_category')
  })
})
