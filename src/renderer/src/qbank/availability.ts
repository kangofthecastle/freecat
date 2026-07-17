import type { AvailabilityQuestionDto, Refine } from '../../../shared/dto'
import type { Scope } from './scope-tree'

/**
 * Pure counting over the availability snapshot (`qbank:availability`) — the client half of the
 * sat-world composer pattern: one snapshot at load, then every control's count/disabled state is
 * plain arithmetic here, no round trips. The filters MIRROR `planSession`'s eligibility order
 * (scope → tag OR-filter → refine set); if these ever disagree with the engine, the composer's
 * promises go stale, so both sides keep the same shape deliberately.
 */

export interface ScopeCounts {
  total: number // matches for the CURRENT refine+tags at mixed scope
  byDiscipline: Map<string, number>
  byTopic: Map<string, number>
}

const passesTags = (q: AvailabilityQuestionDto, tagKeys: ReadonlySet<string>): boolean =>
  tagKeys.size === 0 || q.tags.some((t) => tagKeys.has(t))

const passesRefine = (q: AvailabilityQuestionDto, refine: Refine): boolean =>
  refine === 'all' ? true : refine === 'incorrect' ? q.incorrect : q.flagged

const passesScope = (q: AvailabilityQuestionDto, scope: Scope): boolean =>
  scope.scopeKind === 'mixed' ||
  (scope.scopeKind === 'discipline' ? q.discipline === scope.scopeCode : q.topic === scope.scopeCode)

/** One pass → the count for every scope radio under the current refine + tag selection. */
export function scopeCounts(
  rows: AvailabilityQuestionDto[],
  refine: Refine,
  tagKeys: ReadonlySet<string>
): ScopeCounts {
  const out: ScopeCounts = { total: 0, byDiscipline: new Map(), byTopic: new Map() }
  for (const q of rows) {
    if (!passesTags(q, tagKeys) || !passesRefine(q, refine)) continue
    out.total++
    out.byDiscipline.set(q.discipline, (out.byDiscipline.get(q.discipline) ?? 0) + 1)
    out.byTopic.set(q.topic, (out.byTopic.get(q.topic) ?? 0) + 1)
  }
  return out
}

/** Per-refine counts for the current scope + tag selection — labels the three refine buttons. */
export function refineCounts(
  rows: AvailabilityQuestionDto[],
  scope: Scope,
  tagKeys: ReadonlySet<string>
): Record<Refine, number> {
  const out: Record<Refine, number> = { all: 0, incorrect: 0, flagged: 0 }
  for (const q of rows) {
    if (!passesScope(q, scope) || !passesTags(q, tagKeys)) continue
    out.all++
    if (q.incorrect) out.incorrect++
    if (q.flagged) out.flagged++
  }
  return out
}

/** The count the Start button honors: current scope × refine × tags. */
export function availableCount(
  rows: AvailabilityQuestionDto[],
  scope: Scope,
  refine: Refine,
  tagKeys: ReadonlySet<string>
): number {
  let n = 0
  for (const q of rows) {
    if (passesScope(q, scope) && passesTags(q, tagKeys) && passesRefine(q, refine)) n++
  }
  return n
}

/** The refine-specific "why is this zero" hint (sat-world's mode-specific empty states). */
export function emptyHint(refine: Refine, tagsSelected: boolean): string {
  const tagSuffix = tagsSelected ? ' with the selected categories' : ''
  if (refine === 'incorrect') return `No previously-incorrect questions${tagSuffix} in this scope — answer more questions first, or switch to “All questions”.`
  if (refine === 'flagged') return `No flagged questions${tagSuffix} in this scope — flag questions during a session to build this pool.`
  return `No questions${tagSuffix} in this scope yet.`
}
