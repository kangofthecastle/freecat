import { describe, it, expect } from 'vitest'
import { slugSchema, markCompleteSchema } from '../../src/main/ipc/content-review'

describe('content-review IPC validation', () => {
  it('accepts a valid slug', () => {
    expect(slugSchema.parse('biochem.enzymes')).toBe('biochem.enzymes')
  })
  it('rejects an empty slug', () => {
    expect(() => slugSchema.parse('')).toThrow()
  })
  it('validates the markComplete payload', () => {
    expect(markCompleteSchema.parse({ slug: 'a.b', completed: true })).toEqual({ slug: 'a.b', completed: true })
    expect(() => markCompleteSchema.parse({ slug: 'a.b' })).toThrow()
    expect(() => markCompleteSchema.parse({ slug: '', completed: true })).toThrow()
  })
})
