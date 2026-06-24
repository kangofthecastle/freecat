import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { validateContentTree } from '../../src/main/content/validate'

const FIX = join(__dirname, 'fixtures')

describe('validateContentTree', () => {
  it('returns no errors for the good fixture tree', () => {
    const errors = validateContentTree(join(FIX, 'good'))
    expect(errors).toEqual([])
  })

  it('returns a ContentError for a tree with the wrong number of choices', () => {
    const errors = validateContentTree(join(FIX, 'bad-choices'))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.file).toContain('question.yaml')
    expect(errors[0]?.message).toMatch(/choices/i)
  })

  it('returns a ContentError for an unknown taxonomy code', () => {
    const errors = validateContentTree(join(FIX, 'bad-unknown-code'))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/9Z|unknown/i)
  })

  it('builds loader options from the real taxonomy seed (4A resolves, validates good tree)', () => {
    // If the seed-derived options were wrong, the good tree's 4A item would error.
    const errors = validateContentTree(join(FIX, 'good'))
    expect(errors.some((e) => e.message.includes('4A'))).toBe(false)
  })
})
