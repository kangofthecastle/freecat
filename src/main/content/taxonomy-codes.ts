import type { SectionCode } from './types'
import { taxonomySeed, type TaxonomySeedNode } from '../db/taxonomy-seed-data'

const SECTION_CODES: ReadonlySet<string> = new Set([
  'chem-phys',
  'cars',
  'bio-biochem',
  'psych-soc'
])

function isSectionCode(code: string): code is SectionCode {
  return SECTION_CODES.has(code)
}

/** Map every content-category and CARS-skill code to the `code` of its ancestor section node. */
export function buildSectionByCode(): Map<string, SectionCode> {
  const byId = new Map<string, TaxonomySeedNode>(taxonomySeed.map((n) => [n.id, n]))
  const out = new Map<string, SectionCode>()
  for (const node of taxonomySeed) {
    if (node.kind !== 'content_category' && node.kind !== 'skill') continue
    // Walk parentId to the section node.
    let cursor: TaxonomySeedNode | undefined = node
    while (cursor && cursor.kind !== 'section') {
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
    if (cursor && isSectionCode(cursor.code)) {
      out.set(node.code, cursor.code)
    }
  }
  return out
}

/** Codes of nodes whose kind is 'content_category'. */
export function contentCategoryCodes(): Set<string> {
  return new Set(taxonomySeed.filter((n) => n.kind === 'content_category').map((n) => n.code))
}

/** Codes of nodes whose kind is 'skill' (the CARS skills). */
export function skillCodes(): Set<string> {
  return new Set(taxonomySeed.filter((n) => n.kind === 'skill').map((n) => n.code))
}
