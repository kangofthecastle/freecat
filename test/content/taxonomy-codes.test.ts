import { describe, it, expect } from 'vitest'
import {
  buildSectionByCode,
  contentCategoryCodes,
  skillCodes
} from '../../src/main/content/taxonomy-codes'

describe('taxonomy-codes', () => {
  it('maps a content-category code to its derived section', () => {
    const byCode = buildSectionByCode()
    expect(byCode.get('4A')).toBe('chem-phys')
    expect(byCode.get('1A')).toBe('bio-biochem')
    expect(byCode.get('6A')).toBe('psych-soc')
  })

  it('maps a CARS skill code to the cars section', () => {
    const byCode = buildSectionByCode()
    expect(byCode.get('cars-foundations')).toBe('cars')
    expect(byCode.get('cars-reasoning-within')).toBe('cars')
    expect(byCode.get('cars-reasoning-beyond')).toBe('cars')
  })

  it('returns all 31 content-category codes', () => {
    const codes = contentCategoryCodes()
    expect(codes.size).toBe(31)
    expect(codes.has('4A')).toBe(true)
    expect(codes.has('10A')).toBe(true)
    expect(codes.has('1')).toBe(false) // foundational concept, not a content category
  })

  it('returns the 3 CARS skill codes', () => {
    const codes = skillCodes()
    expect(codes.size).toBe(3)
    expect(codes.has('cars-foundations')).toBe(true)
    expect(codes.has('4A')).toBe(false)
  })

  it('does not include section/FC codes as keys in buildSectionByCode', () => {
    const byCode = buildSectionByCode()
    expect(byCode.size).toBe(34) // 31 content categories + 3 skills
    expect(byCode.has('chem-phys')).toBe(false)
    expect(byCode.has('1')).toBe(false)
  })
})
