import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { validateContentTree } from '../../src/main/content/validate'

const FIX = join(__dirname, 'fixtures')

describe('validateContentTree', () => {
  it('returns no errors for the good fixture tree', () => {
    const errors = validateContentTree(join(FIX, 'good'))
    expect(errors).toEqual([])
  })

  it('returns a ContentError for an unknown topic', () => {
    const errors = validateContentTree(join(FIX, 'bad-unknown-topic'))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.file).toContain('question.yaml')
    expect(errors[0]?.message).toMatch(/unknown topic|physics\.does-not-exist/i)
  })

  it('returns a ContentError for an unknown tag', () => {
    const errors = validateContentTree(join(FIX, 'bad-unknown-tag'))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/unknown tag|9Z/i)
  })

  it('returns a ContentError for the wrong number of choices', () => {
    const errors = validateContentTree(join(FIX, 'bad-choices'))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.file).toContain('question.yaml')
    expect(errors[0]?.message).toMatch(/choices/i)
  })

  it('resolves real seeded topics (the good tree has no topic/tag errors)', () => {
    // If the topic→discipline map or AAMC vocab were wrong, the good tree would error.
    const errors = validateContentTree(join(FIX, 'good'))
    expect(errors.some((e) => /unknown topic|unknown tag/i.test(e.message))).toBe(false)
  })
})
