import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { join } from 'node:path'
import {
  scanContent,
  loadContent,
  loadContentType,
  readBody
} from '../../src/main/content/loader'

const FIX = join(__dirname, 'fixtures')

describe('scanContent — good tree', () => {
  it('loads with no errors and the right index sizes', () => {
    const index = scanContent(join(FIX, 'good'))
    expect(index.errors).toEqual([])
    // 1 standalone + 2 passage questions = 3
    expect(index.allQuestionIds).toHaveLength(3)
    expect(index.byId.size).toBe(3)
    expect(index.passagesById.size).toBe(1)
  })

  it('indexes byTopic / byDiscipline / byTag and derives the section', () => {
    const index = scanContent(join(FIX, 'good'))
    // Topic axis.
    expect(index.byTopic.get('physics.mechanics')).toEqual(['cp-0001-kinematics'])
    expect(index.byTopic.get('biochem.enzymes')).toEqual(['bb-0001-q1', 'bb-0001-q2'])
    // Discipline derived from the topic's parent.
    expect(index.byDiscipline.get('physics')).toEqual(['cp-0001-kinematics'])
    expect(index.byDiscipline.get('biochem')).toEqual(['bb-0001-q1', 'bb-0001-q2'])
    // Tags: q2 carries its own 5E; q1 inherits the passage's 1A.
    expect(index.byTag.get('aamc:4A')).toEqual(['cp-0001-kinematics'])
    expect(index.byTag.get('aamc:1A')).toEqual(['bb-0001-q1'])
    expect(index.byTag.get('aamc:5E')).toEqual(['bb-0001-q2'])
    // Section derived from the discipline.
    expect(index.byId.get('cp-0001-kinematics')?.section).toBe('chem-phys')
    expect(index.byId.get('bb-0001-q1')?.section).toBe('bio-biochem')
  })

  it('stamps passageId and inherits the passage topic/discipline/section', () => {
    const index = scanContent(join(FIX, 'good'))
    const q1 = index.byId.get('bb-0001-q1')
    expect(q1?.passageId).toBe('bb-0001-kinetics')
    expect(q1?.topic).toBe('biochem.enzymes')
    expect(q1?.discipline).toBe('biochem')
    expect(q1?.section).toBe('bio-biochem')
    expect(q1?.tags).toEqual([{ vocab: 'aamc', code: '1A' }])
    const passage = index.passagesById.get('bb-0001-kinetics')
    expect(passage?.questionIds).toEqual(['bb-0001-q1', 'bb-0001-q2'])
    expect(passage?.topic).toBe('biochem.enzymes')
    expect(passage?.discipline).toBe('biochem')
    expect(passage?.section).toBe('bio-biochem')
  })

  it('rewrites a relative image path to the content protocol', () => {
    const index = scanContent(join(FIX, 'good'))
    const q = index.byId.get('cp-0001-kinematics')
    expect(q?.stem).toContain('freecat-content://')
    expect(q?.stem).not.toContain('](figure-1.png)')
  })

  it('loadContent returns the index for a clean tree', () => {
    const index = loadContent(join(FIX, 'good'))
    expect(index.allQuestionIds).toHaveLength(3)
  })
})

describe('scanContent — bad trees each yield a ContentError naming the file', () => {
  it('unknown topic (not in the taxonomy)', () => {
    const index = scanContent(join(FIX, 'bad-unknown-topic'))
    expect(index.errors).toHaveLength(1)
    expect(index.errors[0]?.file).toContain('question.yaml')
    expect(index.errors[0]?.message).toMatch(/unknown topic|physics\.does-not-exist/i)
    // The bad item never lands in the index.
    expect(index.allQuestionIds).toHaveLength(0)
  })

  it('unknown tag (not in the AAMC vocab)', () => {
    const index = scanContent(join(FIX, 'bad-unknown-tag'))
    expect(index.errors).toHaveLength(1)
    expect(index.errors[0]?.message).toMatch(/unknown tag|9Z/i)
    expect(index.allQuestionIds).toHaveLength(0)
  })

  it('missing correct letter', () => {
    const index = scanContent(join(FIX, 'bad-missing-correct'))
    expect(index.errors).toHaveLength(1)
    expect(index.errors[0]?.file).toContain('question.yaml')
    expect(index.errors[0]?.message).toMatch(/correct/i)
  })

  it('wrong number of choices', () => {
    const index = scanContent(join(FIX, 'bad-choices'))
    expect(index.errors).toHaveLength(1)
    expect(index.errors[0]?.message).toMatch(/choices/i)
  })

  it('broken image path', () => {
    const index = scanContent(join(FIX, 'bad-image'))
    expect(index.errors).toHaveLength(1)
    expect(index.errors[0]?.message).toMatch(/image|does-not-exist/i)
  })

  it('loadContent throws when any error is present', () => {
    expect(() => loadContent(join(FIX, 'bad-choices'))).toThrow()
  })
})

describe('scanContent — partial-commit atomicity & isolation', () => {
  it('rejects a whole passage atomically when one sub-question is invalid', () => {
    // Passage bb-bad-subquestion: q1 is valid, q2 carries an unknown tag.
    const index = scanContent(join(FIX, 'bad-passage-subquestion'))
    // The bad sub-question's tag error is reported.
    expect(index.errors.some((e) => /unknown tag|9Z/i.test(e.message))).toBe(true)
    // Neither the valid sub-question nor the passage half-commits.
    expect(index.byId.has('bb-bad-q1')).toBe(false)
    expect(index.byId.has('bb-bad-q2')).toBe(false)
    expect(index.passagesById.has('bb-bad-subquestion')).toBe(false)
    expect(index.allQuestionIds).toHaveLength(0)
  })

  it('keeps a good question while skipping a bad sibling in the same scan', () => {
    // mixed-good-bad: cp-good-survivor (valid) + cp-bad-skipped (unknown topic).
    const index = scanContent(join(FIX, 'mixed-good-bad'))
    // The good question is fully indexed.
    expect(index.byId.has('cp-good-survivor')).toBe(true)
    expect(index.allQuestionIds).toEqual(['cp-good-survivor'])
    expect(index.byTopic.get('physics.mechanics')).toEqual(['cp-good-survivor'])
    // The bad question is skipped (errors-only), proving "skipped" ≠ "empty index".
    expect(index.byId.has('cp-bad-skipped')).toBe(false)
    expect(index.errors).toHaveLength(1)
    expect(index.errors[0]?.message).toMatch(/unknown topic|physics\.does-not-exist/i)
  })

  it('rejects a duplicate standalone question id and keeps the first-seen', () => {
    // dup-standalone: dup-a and dup-b both declare id cp-dup-standalone.
    const index = scanContent(join(FIX, 'dup-standalone'))
    // First-seen (sorted dir order: dup-a) wins; only one id is indexed.
    expect(index.byId.has('cp-dup-standalone')).toBe(true)
    expect(index.allQuestionIds).toEqual(['cp-dup-standalone'])
    expect(index.byId.get('cp-dup-standalone')?.topic).toBe('physics.mechanics')
    // The duplicate is reported and not committed.
    expect(index.errors).toHaveLength(1)
    expect(index.errors[0]?.message).toMatch(/duplicate question id/i)
  })

  it('rejects a passage with a duplicate sub-question id (whole passage skipped)', () => {
    // dup-passage-subquestion: bb-dup lists bb-dup-q1 twice.
    const index = scanContent(join(FIX, 'dup-passage-subquestion'))
    expect(index.errors.some((e) => /duplicate question id/i.test(e.message))).toBe(true)
    // Neither occurrence nor the passage commits.
    expect(index.byId.has('bb-dup-q1')).toBe(false)
    expect(index.passagesById.has('bb-dup-subquestion')).toBe(false)
    expect(index.allQuestionIds).toHaveLength(0)
  })
})

const VALID = join(__dirname, '../fixtures/content-valid')
const INVALID = join(__dirname, '../fixtures/content-invalid')
const MULTI = join(__dirname, '../fixtures/content-multi')
const schema = z.object({ slug: z.string().min(1), title: z.string().min(1), summary: z.string().optional() })

describe('content loader', () => {
  it('loads + validates envelopes under a subdir', () => {
    const recs = loadContentType({ root: VALID, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema })
    expect(recs).toHaveLength(1)
    const rec = recs[0]
    if (!rec) throw new Error('no record')
    expect(rec.data.slug).toBe('biochem.enzymes')
    expect(rec.data.title).toBe('Enzymes')
  })

  it('reads a co-located body file', () => {
    const recs = loadContentType({ root: VALID, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema })
    const rec = recs[0]
    if (!rec) throw new Error('no record')
    expect(readBody(rec.dir, 'body.html')).toContain('<h1>Enzymes</h1>')
  })

  it('returns [] when the subdir is absent', () => {
    expect(loadContentType({ root: VALID, subdir: 'nope', envelopeFile: 'lesson.yaml', schema })).toEqual([])
  })

  it('throws on an envelope that fails the schema', () => {
    expect(() => loadContentType({ root: INVALID, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema })).toThrow(/lesson\.yaml/)
  })

  it('loads multiple items in deterministic (sorted) order', () => {
    const recs = loadContentType({ root: MULTI, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema })
    expect(recs.map((r) => r.data.slug)).toEqual(['a.one', 'b.two'])
  })
})
