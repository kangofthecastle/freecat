import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  buildSectionByCode,
  contentCategoryCodes,
  skillCodes
} from '../../src/main/content/taxonomy-codes'
import { scanContent, loadContent, type LoaderOptions } from '../../src/main/content/loader'

const FIX = join(__dirname, 'fixtures')

function opts(): LoaderOptions {
  return {
    sectionByCode: buildSectionByCode(),
    contentCategoryCodes: contentCategoryCodes(),
    skillCodes: skillCodes()
  }
}

describe('scanContent — good tree', () => {
  it('loads with no errors and the right index sizes', () => {
    const { index, errors } = scanContent(join(FIX, 'good'), opts())
    expect(errors).toEqual([])
    // 1 standalone + 2 passage questions = 3
    expect(index.allQuestionIds).toHaveLength(3)
    expect(index.byId.size).toBe(3)
    expect(index.passagesById.size).toBe(1)
    expect(index.bySection.get('chem-phys')).toEqual(['cp-0001-kinematics'])
    expect(index.bySection.get('bio-biochem')).toEqual(['bb-0001-q1', 'bb-0001-q2'])
    expect(index.byContentCategory.get('4A')).toEqual(['cp-0001-kinematics'])
    expect(index.byContentCategory.get('1A')).toEqual(['bb-0001-q1', 'bb-0001-q2'])
  })

  it('stamps passageId on passage questions and inherits the passage tag', () => {
    const { index } = scanContent(join(FIX, 'good'), opts())
    const q1 = index.byId.get('bb-0001-q1')
    expect(q1?.passageId).toBe('bb-0001-kinetics')
    expect(q1?.section).toBe('bio-biochem')
    expect(q1?.contentCategory).toBe('1A')
    expect(q1?.skill).toBeNull()
    const passage = index.passagesById.get('bb-0001-kinetics')
    expect(passage?.questionIds).toEqual(['bb-0001-q1', 'bb-0001-q2'])
    expect(passage?.section).toBe('bio-biochem')
  })

  it('rewrites a relative image path to the content protocol', () => {
    const { index } = scanContent(join(FIX, 'good'), opts())
    const q = index.byId.get('cp-0001-kinematics')
    expect(q?.stem).toContain('freecat-content://')
    expect(q?.stem).not.toContain('](figure-1.png)')
  })

  it('loadContent returns the index for a clean tree', () => {
    const index = loadContent(join(FIX, 'good'), opts())
    expect(index.allQuestionIds).toHaveLength(3)
  })
})

describe('scanContent — bad trees each yield a ContentError naming the file', () => {
  it('missing correct letter', () => {
    const { errors } = scanContent(join(FIX, 'bad-missing-correct'), opts())
    expect(errors).toHaveLength(1)
    expect(errors[0]?.file).toContain('question.yaml')
    expect(errors[0]?.message).toMatch(/correct/i)
  })

  it('wrong number of choices', () => {
    const { errors } = scanContent(join(FIX, 'bad-choices'), opts())
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/choices/i)
  })

  it('unknown taxonomy code', () => {
    const { errors } = scanContent(join(FIX, 'bad-unknown-code'), opts())
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/9Z|unknown|known/i)
  })

  it('broken image path', () => {
    const { errors } = scanContent(join(FIX, 'bad-image'), opts())
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/image|does-not-exist/i)
  })

  it('section folder does not match the derived section', () => {
    const { errors } = scanContent(join(FIX, 'bad-section-mismatch'), opts())
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/section/i)
  })

  it('loadContent throws when any error is present', () => {
    expect(() => loadContent(join(FIX, 'bad-choices'), opts())).toThrow()
  })
})
