import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { join } from 'node:path'
import { loadContentType, readBody } from '../../src/main/content/loader'

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
