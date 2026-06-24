import type { TaxonomyNodeDto } from '../../../shared/dto'

export interface ScopeOption {
  /** The taxonomy code to send as StartSessionInput.scopeCode. */
  code: string
  /** Human label, e.g. '4A — Translational motion'. */
  label: string
}

export interface TaxonomyTree {
  /** All section nodes, in seed order. */
  sections: TaxonomyNodeDto[]
  /** Content-category options grouped under each section code (science sections). */
  contentCategoriesBySection: Map<string, ScopeOption[]>
  /** CARS skill options (skills live anywhere under the CARS section). */
  carsSkills: ScopeOption[]
  /** code -> title, for every node (used to label dashboard rows). */
  titleByCode: Map<string, string>
  /** code -> section code, for any content-category or skill code. */
  sectionByCode: Map<string, string>
}

const CARS_CODE = 'cars'

function ancestorSectionId(node: TaxonomyNodeDto, byId: Map<string, TaxonomyNodeDto>): string | null {
  let cur: TaxonomyNodeDto | undefined = node
  while (cur) {
    if (cur.kind === 'section') return cur.id
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

/** Build the grouped tree the UI needs from the flat node list. */
export function buildTaxonomyTree(nodes: TaxonomyNodeDto[]): TaxonomyTree {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const sections = nodes.filter((n) => n.kind === 'section')
  const sectionIdToCode = new Map(sections.map((s) => [s.id, s.code]))

  const titleByCode = new Map<string, string>()
  const sectionByCode = new Map<string, string>()
  for (const n of nodes) titleByCode.set(n.code, n.title)

  const contentCategoriesBySection = new Map<string, ScopeOption[]>()
  for (const s of sections) contentCategoriesBySection.set(s.code, [])
  const carsSkills: ScopeOption[] = []

  for (const n of nodes) {
    if (n.kind !== 'content_category' && n.kind !== 'skill') continue
    const secId = ancestorSectionId(n, byId)
    if (!secId) continue
    const secCode = sectionIdToCode.get(secId)
    if (!secCode) continue
    sectionByCode.set(n.code, secCode)
    const option: ScopeOption = { code: n.code, label: `${n.code} — ${n.title}` }
    if (n.kind === 'skill' && secCode === CARS_CODE) {
      carsSkills.push(option)
    } else if (n.kind === 'content_category') {
      contentCategoriesBySection.get(secCode)?.push(option)
    } else {
      // A skill outside CARS has no scope bucket today and would otherwise vanish silently —
      // surface it so a future science-section skill isn't invisibly dropped from the Composer.
      console.warn(
        `taxonomy-tree: skill "${n.code}" under non-CARS section "${secCode}" has no scope bucket and was dropped`
      )
    }
  }

  return { sections, contentCategoriesBySection, carsSkills, titleByCode, sectionByCode }
}
