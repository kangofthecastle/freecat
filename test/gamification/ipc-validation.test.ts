import { describe, it, expect } from 'vitest'
import { recordActivitySchema, itemKeySchema, petIdSchema, renameSchema } from '../../src/main/ipc/gamification'

describe('gamification IPC validation', () => {
  it('accepts a valid recordActivity payload', () => {
    expect(recordActivitySchema.parse({ kind: 'qbank.answer', count: 2 })).toEqual({ kind: 'qbank.answer', count: 2 })
  })
  it('rejects an empty kind / non-positive count', () => {
    expect(() => recordActivitySchema.parse({ kind: '' })).toThrow()
    expect(() => recordActivitySchema.parse({ kind: 'x', count: 0 })).toThrow()
  })
  it('validates item key + pet id + rename', () => {
    expect(itemKeySchema.parse('cap')).toBe('cap')
    expect(() => petIdSchema.parse(-1)).toThrow()
    expect(() => renameSchema.parse({ petId: 1, name: 'x'.repeat(25) })).toThrow()
  })
})
