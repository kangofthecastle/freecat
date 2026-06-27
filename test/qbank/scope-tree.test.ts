// test/qbank/scope-tree.test.ts
import { describe, it, expect } from 'vitest'
import type { DisciplineTreeDto } from '../../src/shared/dto'
import {
  buildScopeTree,
  parseScopeValue,
  scopeValue,
  type Scope
} from '../../src/renderer/src/qbank/scope-tree'

describe('scopeValue ↔ parseScopeValue round-trip', () => {
  const cases: Scope[] = [
    { scopeKind: 'mixed' },
    { scopeKind: 'discipline', scopeCode: 'chem-phys' },
    { scopeKind: 'topic', scopeCode: 'acid-base' },
    // A code containing a colon must survive (parse splits on the FIRST colon only).
    { scopeKind: 'topic', scopeCode: 'ns:weird:slug' }
  ]
  for (const scope of cases) {
    it(`round-trips ${JSON.stringify(scope)}`, () => {
      expect(parseScopeValue(scopeValue(scope))).toEqual(scope)
    })
  }

  it('serializes mixed to the bare "mixed" token (no colon)', () => {
    expect(scopeValue({ scopeKind: 'mixed' })).toBe('mixed')
  })

  it('serializes discipline/topic as "kind:code"', () => {
    expect(scopeValue({ scopeKind: 'discipline', scopeCode: 'bio' })).toBe('discipline:bio')
    expect(scopeValue({ scopeKind: 'topic', scopeCode: 'enzymes' })).toBe('topic:enzymes')
  })
})

describe('parseScopeValue fallbacks', () => {
  it('falls back to mixed for an empty string', () => {
    expect(parseScopeValue('')).toEqual({ scopeKind: 'mixed' })
  })

  it('falls back to mixed for an unknown bare token', () => {
    expect(parseScopeValue('garbage')).toEqual({ scopeKind: 'mixed' })
  })

  it('falls back to mixed for an unknown kind even with a code', () => {
    expect(parseScopeValue('section:bb')).toEqual({ scopeKind: 'mixed' })
  })

  it('falls back to mixed when the kind is valid but the code is empty', () => {
    expect(parseScopeValue('topic:')).toEqual({ scopeKind: 'mixed' })
    expect(parseScopeValue('discipline:')).toEqual({ scopeKind: 'mixed' })
  })

  it('parses the literal "mixed" token to mixed (and ignores any code given to it)', () => {
    expect(parseScopeValue('mixed')).toEqual({ scopeKind: 'mixed' })
  })
})

describe('buildScopeTree', () => {
  const disciplines: DisciplineTreeDto[] = [
    {
      discipline: 'chem-phys' as DisciplineTreeDto['discipline'],
      title: 'Chemical & Physical',
      topics: [
        { slug: 'acid-base', title: 'Acid–Base', aamcCodes: ['5A'] },
        { slug: 'thermo', title: 'Thermodynamics', aamcCodes: ['4A'] }
      ]
    },
    {
      discipline: 'bio-biochem' as DisciplineTreeDto['discipline'],
      title: 'Biological & Biochemical',
      topics: [{ slug: 'enzymes', title: 'Enzymes', aamcCodes: ['1A'] }]
    }
  ]

  it('preserves discipline seed order and carries each discipline its topics', () => {
    const tree = buildScopeTree(disciplines)
    expect(tree.disciplines.map((d) => d.discipline)).toEqual(['chem-phys', 'bio-biochem'])
    expect(tree.disciplines[0]?.topics.map((t) => t.slug)).toEqual(['acid-base', 'thermo'])
    expect(tree.disciplines[1]?.topics.map((t) => t.slug)).toEqual(['enzymes'])
  })

  it('indexes topic slug -> title across all disciplines', () => {
    const tree = buildScopeTree(disciplines)
    expect(tree.titleByTopic.get('acid-base')).toBe('Acid–Base')
    expect(tree.titleByTopic.get('thermo')).toBe('Thermodynamics')
    expect(tree.titleByTopic.get('enzymes')).toBe('Enzymes')
    expect(tree.titleByTopic.size).toBe(3)
  })

  it('indexes discipline key -> title', () => {
    const tree = buildScopeTree(disciplines)
    expect(tree.titleByDiscipline.get('chem-phys')).toBe('Chemical & Physical')
    expect(tree.titleByDiscipline.get('bio-biochem')).toBe('Biological & Biochemical')
  })

  it('returns empty structures for an empty discipline list', () => {
    const tree = buildScopeTree([])
    expect(tree.disciplines).toEqual([])
    expect(tree.titleByTopic.size).toBe(0)
    expect(tree.titleByDiscipline.size).toBe(0)
  })
})
