import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { lessonSchema, createLessonStore, loadLessons, LessonStore } from '../../src/main/content/lessons'

const VALID = join(__dirname, '../fixtures/content-valid')

describe('lessonSchema', () => {
  it('accepts a minimal envelope', () => {
    expect(lessonSchema.parse({ slug: 'a.b', title: 'T' }).slug).toBe('a.b')
  })
  it('rejects a missing title', () => {
    expect(() => lessonSchema.parse({ slug: 'a.b' })).toThrow()
  })
})

describe('LessonStore', () => {
  it('lists loaded lessons', () => {
    const recs = loadLessons(VALID)
    expect(recs.map((r) => r.slug)).toContain('biochem.enzymes')
  })

  it('reads a lesson body via get()', () => {
    const store = createLessonStore(VALID)
    expect(store.has('biochem.enzymes')).toBe(true)
    const lesson = store.get('biochem.enzymes')
    expect(lesson?.title).toBe('Enzymes')
    expect(lesson?.html).toContain('<h1>Enzymes</h1>')
  })

  it('returns null for an unknown slug', () => {
    const store = createLessonStore(VALID)
    expect(store.get('nope.nope')).toBeNull()
    expect(store.has('nope.nope')).toBe(false)
  })

  it('throws on duplicate lesson slugs', () => {
    const rec = { slug: 'dup.x', title: 'X', dir: '/tmp/x', bodyFile: 'body.html' }
    expect(() => new LessonStore([rec, { ...rec, dir: '/tmp/y' }])).toThrow(/Duplicate/)
  })
})
