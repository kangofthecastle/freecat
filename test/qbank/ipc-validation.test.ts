import { describe, it, expect } from 'vitest'
import { startSessionSchema, submitAnswerSchema, completeSessionSchema, toggleFlagSchema } from '../../src/main/ipc/qbank'

describe('qbank IPC validation', () => {
  it('accepts a valid startSession payload (with and without scopeCode)', () => {
    expect(startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 10 }))
      .toEqual({ scopeKind: 'mixed', refine: 'all', count: 10 })
    expect(startSessionSchema.parse({ scopeKind: 'content_category', scopeCode: '4A', refine: 'incorrect', count: 5 }))
      .toEqual({ scopeKind: 'content_category', scopeCode: '4A', refine: 'incorrect', count: 5 })
  })

  it('rejects a bad scopeKind / refine enum', () => {
    expect(() => startSessionSchema.parse({ scopeKind: 'topic', refine: 'all', count: 5 })).toThrow()
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'starred', count: 5 })).toThrow()
  })

  it('rejects count < 1, count > 100, and a non-integer count', () => {
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 0 })).toThrow()
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 101 })).toThrow()
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 2.5 })).toThrow()
  })

  it('accepts a valid submitAnswer payload and rejects malformed ones', () => {
    expect(submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1', choice: 'A', timeMs: 1200 }))
      .toEqual({ sessionId: 1, questionId: 'cp-q1', choice: 'A', timeMs: 1200 })
    expect(() => submitAnswerSchema.parse({ sessionId: 0, questionId: 'cp-q1', choice: 'A' })).toThrow() // non-positive
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: '', choice: 'A' })).toThrow() // empty id
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1', choice: 'E' })).toThrow() // bad letter
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1' })).toThrow() // missing choice
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1', choice: 'A', timeMs: -1 })).toThrow() // negative time
  })

  it('validates completeSession + toggleFlag scalar schemas', () => {
    expect(completeSessionSchema.parse(7)).toBe(7)
    expect(() => completeSessionSchema.parse(0)).toThrow()
    expect(toggleFlagSchema.parse('cp-q1')).toBe('cp-q1')
    expect(() => toggleFlagSchema.parse('')).toThrow()
  })
})
