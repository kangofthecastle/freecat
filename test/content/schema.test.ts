import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { standaloneQuestionSchema, passageSchema } from '../../src/main/content/schema'

const goodQuestion = {
  id: 'cp-0042-doppler',
  contentCategory: '4A',
  topics: ['doppler-effect'],
  stem: 'A sonographer measures blood flow toward the probe.',
  choices: [
    'Observed frequency rises',
    'Observed frequency falls',
    'Wavelength is unchanged',
    'Speed of sound doubles'
  ],
  correct: 'A',
  explanation: 'An approaching source compresses successive wavefronts.',
  choiceExplanations: {
    B: 'Falling frequency is the receding case.',
    C: 'Wavelength shortens as the source approaches.'
  }
}

describe('standaloneQuestionSchema', () => {
  it('parses a well-formed question', () => {
    const parsed = standaloneQuestionSchema.parse(goodQuestion)
    expect(parsed.id).toBe('cp-0042-doppler')
    expect(parsed.choices).toHaveLength(4)
    expect(parsed.correct).toBe('A')
    expect(parsed.topics).toEqual(['doppler-effect'])
  })

  it('defaults topics to an empty array when omitted', () => {
    const { topics, ...noTopics } = goodQuestion
    void topics
    const parsed = standaloneQuestionSchema.parse(noTopics)
    expect(parsed.topics).toEqual([])
  })

  it('rejects a question with 3 choices', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...goodQuestion, choices: ['a', 'b', 'c'] })
    ).toThrow()
  })

  it('rejects a question with 5 choices', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...goodQuestion, choices: ['a', 'b', 'c', 'd', 'e'] })
    ).toThrow()
  })

  it('rejects a correct letter outside A-D', () => {
    expect(() => standaloneQuestionSchema.parse({ ...goodQuestion, correct: 'E' })).toThrow()
  })

  it('rejects both contentCategory and skill present', () => {
    expect(() =>
      standaloneQuestionSchema.parse({ ...goodQuestion, skill: 'cars-foundations' })
    ).toThrow()
  })

  it('rejects neither contentCategory nor skill present', () => {
    const { contentCategory, ...noTag } = goodQuestion
    void contentCategory
    expect(() => standaloneQuestionSchema.parse(noTag)).toThrow()
  })

  it('rejects an unknown choiceExplanations key', () => {
    expect(() =>
      standaloneQuestionSchema.parse({
        ...goodQuestion,
        choiceExplanations: { E: 'no such choice' }
      })
    ).toThrow()
  })

  it('rejects a missing explanation', () => {
    const { explanation, ...noExpl } = goodQuestion
    void explanation
    expect(() => standaloneQuestionSchema.parse(noExpl)).toThrow()
  })
})

const goodPassage = {
  id: 'bb-0007-enzyme-kinetics',
  contentCategory: '1A',
  topics: ['enzyme-kinetics'],
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
      skill: 'cars-foundations',
      stem: 'A per-question override.',
      choices: ['a', 'b', 'c', 'd'],
      correct: 'B',
      explanation: 'Sub-questions may override the tag.'
    }
  ]
}

describe('passageSchema', () => {
  it('parses a well-formed passage set', () => {
    const parsed = passageSchema.parse(goodPassage)
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.passage).toContain('enzymes')
  })

  it('allows passage questions without their own tag (inherit)', () => {
    const parsed = passageSchema.parse(goodPassage)
    expect(parsed.questions[0]?.contentCategory).toBeUndefined()
    expect(parsed.questions[0]?.skill).toBeUndefined()
  })

  it('rejects an empty questions array', () => {
    expect(() => passageSchema.parse({ ...goodPassage, questions: [] })).toThrow()
  })

  it('rejects a passage with both tags', () => {
    expect(() =>
      passageSchema.parse({ ...goodPassage, skill: 'cars-foundations' })
    ).toThrow()
  })

  it('rejects a passage with neither tag', () => {
    const { contentCategory, ...noTag } = goodPassage
    void contentCategory
    expect(() => passageSchema.parse(noTag)).toThrow()
  })

  it('rejects a sub-question that sets both tags', () => {
    const bad = {
      ...goodPassage,
      questions: [
        {
          ...goodPassage.questions[0],
          contentCategory: '1A',
          skill: 'cars-foundations'
        }
      ]
    }
    expect(() => passageSchema.parse(bad)).toThrow()
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
