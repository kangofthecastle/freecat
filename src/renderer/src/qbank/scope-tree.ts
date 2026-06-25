import type { DisciplineTreeDto, TopicDto } from '../../../shared/dto'

/**
 * A primary-scope selection, matching `StartSessionInput`'s scope fields so a `Scope`
 * spreads straight into `startSession({ ...scope, refine, count })`.
 *   - `mixed`      → the whole bank
 *   - `discipline` → every topic under one discipline (`scopeCode` = discipline key)
 *   - `topic`      → a single topic (`scopeCode` = topic slug)
 */
export type Scope =
  | { scopeKind: 'mixed' }
  | { scopeKind: 'discipline'; scopeCode: string }
  | { scopeKind: 'topic'; scopeCode: string }

/** Serialize a `Scope` to a single radio value so the picker stays one flat control. */
export function scopeValue(scope: Scope): string {
  return scope.scopeKind === 'mixed' ? 'mixed' : `${scope.scopeKind}:${scope.scopeCode}`
}

/** Inverse of {@link scopeValue}. Unknown/empty input falls back to `mixed`. */
export function parseScopeValue(value: string): Scope {
  const idx = value.indexOf(':')
  if (idx === -1) return { scopeKind: 'mixed' }
  const kind = value.slice(0, idx)
  const code = value.slice(idx + 1)
  if ((kind === 'discipline' || kind === 'topic') && code) return { scopeKind: kind, scopeCode: code }
  return { scopeKind: 'mixed' }
}

/** A discipline with its topics, ready for the Composer/Dashboard grouped render. */
export interface DisciplineGroup {
  discipline: string
  title: string
  topics: TopicDto[]
}

/** The grouped structure both the Composer (scope picker) and Dashboard (heatmap) render. */
export interface ScopeTree {
  /** Disciplines in seed order, each carrying its topics. */
  disciplines: DisciplineGroup[]
  /** topic slug -> title, for labeling dashboard rows from denormalized attempt slugs. */
  titleByTopic: Map<string, string>
  /** discipline key -> title. */
  titleByDiscipline: Map<string, string>
}

/** Build the grouped scope tree the UI needs from the discipline→topic DTO list. */
export function buildScopeTree(disciplines: DisciplineTreeDto[]): ScopeTree {
  const titleByTopic = new Map<string, string>()
  const titleByDiscipline = new Map<string, string>()
  const groups: DisciplineGroup[] = disciplines.map((d) => {
    titleByDiscipline.set(d.discipline, d.title)
    for (const t of d.topics) titleByTopic.set(t.slug, t.title)
    return { discipline: d.discipline, title: d.title, topics: d.topics }
  })
  return { disciplines: groups, titleByTopic, titleByDiscipline }
}
