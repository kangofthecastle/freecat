import { describe, it, expect } from 'vitest'
import { setNameSchema } from '../src/main/ipc/profile'

describe('profile IPC input validation', () => {
  it('accepts a valid name', () => {
    expect(setNameSchema.parse('Warren')).toBe('Warren')
  })

  it('rejects an empty name', () => {
    expect(() => setNameSchema.parse('')).toThrow()
  })

  it('rejects a name longer than 40 characters', () => {
    expect(() => setNameSchema.parse('x'.repeat(41))).toThrow()
  })
})
