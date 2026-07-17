import type { DB } from '../db/client'
import type { ContentIndex, QuestionContent } from '../content/types'
import type {
  StartSessionInput, StartSessionResult, PresentedQuestion, PresentedPassage,
  SubmitAnswerInput, SubmitAnswerResult, SessionSummary, SessionSummaryRow,
  ChoiceLetter, ServiceResult, Tag
} from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import { DIAGNOSTIC_CONFIG } from '../../shared/qbank/diagnostic'
import { DISCIPLINES } from '../db/seed/taxonomy-data'
import { createSession } from '../repositories/qbank-sessions'
import { recordAttempt, attemptExists, latestIncorrectQuestionIds, getSessionAttempts } from '../repositories/qbank-attempts'
import { listFlaggedIds } from '../repositories/qbank-flags'
import { creditActivitySafely, type RecordActivityFn } from '../repositories/activity'

export type Rng = () => number // [0,1)
export interface PlanOptions { now: Date; rng: Rng }

// Re-exported (not re-declared) from the activity repo, which owns the injectable-recorder seam.
// Kept as a named export here because existing importers/tests reference `RecordActivityFn` from this module.
export type { RecordActivityFn }
export interface GradeOptions { now: Date; recordActivityFn?: RecordActivityFn }

/** Eligible question ids for the requested scope (mixed → everything). */
function scopeIds(index: ContentIndex, input: StartSessionInput): string[] {
  if (input.scopeKind === 'topic') return index.byTopic.get(input.scopeCode ?? '') ?? []
  if (input.scopeKind === 'discipline') return index.byDiscipline.get(input.scopeCode ?? '') ?? []
  return index.allQuestionIds
}

/** Keep only ids whose question carries ≥1 of the selected tags (union/OR semantics).
 *  An empty/absent filter is a no-op. */
function applyTagFilter(index: ContentIndex, ids: string[], tagFilter: Tag[] | undefined): string[] {
  if (!tagFilter || tagFilter.length === 0) return ids
  const wanted = new Set(tagFilter.map((t) => `${t.vocab}:${t.code}`))
  return ids.filter((id) => {
    const tags = index.byId.get(id)?.tags ?? []
    return tags.some((t) => wanted.has(`${t.vocab}:${t.code}`))
  })
}

/** Strip a stored question to its renderer-facing shape: topic + section for display,
 *  the stem/choices to answer, and the persisted flag state — never the answer key. */
export function presentQuestion(q: QuestionContent, flaggedSet: Set<string>): PresentedQuestion {
  return {
    id: q.id,
    topic: q.topic,
    section: q.section,
    passageId: q.passageId,
    stem: q.stem,
    choices: [...q.choices],
    flagged: flaggedSet.has(q.id)
  }
}

/** In-place Fisher–Yates over `items` driven by the injected rng. `j` ranges over
 *  [0, i] inclusive; `rng()===0` maps to `j===i` (a self-swap), so a constant-0 rng
 *  is the identity permutation — matching the repo-wide `rng 0 → first` convention. */
function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = i - Math.floor(rng() * (i + 1))
    const a = out[i]
    const b = out[j]
    if (a !== undefined && b !== undefined) { out[i] = b; out[j] = a }
  }
  return out
}

export async function planSession(
  index: ContentIndex,
  db: DB,
  input: StartSessionInput,
  opts: PlanOptions
): Promise<StartSessionResult> {
  // The flagged set is needed both for the optional `flagged` refine and to mark each presented
  // question's persisted flag state (so a previously-flagged question shows ★ on re-encounter).
  const flaggedSet = new Set(await listFlaggedIds(db))

  // 1. eligible ids by scope, narrow by the optional tag filter, then intersect with the refine set.
  let eligible = applyTagFilter(index, scopeIds(index, input), input.tagFilter)
  if (input.refine === 'incorrect') {
    const allow = new Set(await latestIncorrectQuestionIds(db))
    eligible = eligible.filter((id) => allow.has(id))
  } else if (input.refine === 'flagged') {
    eligible = eligible.filter((id) => flaggedSet.has(id))
  }

  // 2. group eligible ids into units (standalone = 1 question; a passage question pulls
  //    its whole passage's ordered questionIds — siblings included even if not eligible —
  //    deduped by passage). Units preserve first-seen order of the eligible list.
  //    Passage atomicity: passage siblings ride along even if filtered out by scope/tag/refine,
  //    so a passage is always presented whole once any one of its questions is eligible.
  const units: string[][] = []
  const seenPassage = new Set<string>()
  const seenStandalone = new Set<string>()
  for (const id of eligible) {
    const q = index.byId.get(id)
    if (!q) continue
    if (q.passageId) {
      if (seenPassage.has(q.passageId)) continue
      seenPassage.add(q.passageId)
      const passage = index.passagesById.get(q.passageId)
      units.push(passage ? [...passage.questionIds] : [id])
    } else {
      if (seenStandalone.has(id)) continue
      seenStandalone.add(id)
      units.push([id])
    }
  }

  // 3. shuffle units, then take whole units until `count` questions are collected.
  const shuffled = shuffle(units, opts.rng)
  const chosenIds: string[] = []
  for (const unit of shuffled) {
    if (chosenIds.length >= input.count) break
    chosenIds.push(...unit)
  }

  // 4. persist the session row.
  const session = await createSession(db, {
    scopeKind: input.scopeKind,
    scopeCode: input.scopeCode ?? null,
    refine: input.refine,
    requestedCount: input.count,
    now: opts.now
  })

  // 5. strip to PresentedQuestion[] + a passages map for referenced passages (no answers).
  return { sessionId: session.id, mode: session.mode, ...presentChosen(index, chosenIds, flaggedSet) }
}

/** Strip chosen ids to the renderer-facing payload: presented questions plus every referenced
 *  passage (never the answer key). Shared by both composers. */
function presentChosen(
  index: ContentIndex,
  chosenIds: string[],
  flaggedSet: Set<string>
): { questions: PresentedQuestion[]; passages: Record<string, PresentedPassage> } {
  const questions: PresentedQuestion[] = []
  const passages: Record<string, PresentedPassage> = {}
  for (const id of chosenIds) {
    const q = index.byId.get(id)
    if (!q) continue
    questions.push(presentQuestion(q, flaggedSet))
    if (q.passageId && !passages[q.passageId]) {
      const p = index.passagesById.get(q.passageId)
      if (p) passages[q.passageId] = { id: p.id, passage: p.passage }
    }
  }
  return { questions, passages }
}

/**
 * Preference-ordered candidate units for one discipline's diagnostic picks: mid-difficulty
 * standalones first (round-robin across topics for spread), then the other standalones, then whole
 * passage units — a last resort so a passage-only discipline still gets probed, at the cost of the
 * passage's full length riding along (atomicity, as everywhere).
 */
function diagnosticUnits(index: ContentIndex, discipline: string, rng: Rng): string[][] {
  const mediumByTopic = new Map<string, string[]>()
  const otherByTopic = new Map<string, string[]>()
  const passageIds: string[] = []
  const seenPassage = new Set<string>()
  for (const id of index.byDiscipline.get(discipline) ?? []) {
    const q = index.byId.get(id)
    if (!q) continue
    if (q.passageId) {
      if (!seenPassage.has(q.passageId)) {
        seenPassage.add(q.passageId)
        passageIds.push(q.passageId)
      }
      continue
    }
    const bucket = q.difficulty === 'medium' ? mediumByTopic : otherByTopic
    const arr = bucket.get(q.topic) ?? []
    arr.push(id)
    bucket.set(q.topic, arr)
  }
  // Interleave topics (shuffled within and across) so consecutive picks from one discipline probe
  // DIFFERENT topics — the whole point of a diagnostic is spread, not depth.
  const roundRobin = (byTopic: Map<string, string[]>): string[] => {
    const lanes = shuffle([...byTopic.values()].map((arr) => shuffle(arr, rng)), rng)
    const out: string[] = []
    for (let i = 0; lanes.some((l) => i < l.length); i++) {
      for (const lane of lanes) {
        const id = lane[i]
        if (id !== undefined) out.push(id)
      }
    }
    return out
  }
  const units: string[][] = [...roundRobin(mediumByTopic), ...roundRobin(otherByTopic)].map((id) => [id])
  for (const pid of shuffle(passageIds, rng)) {
    const p = index.passagesById.get(pid)
    if (p) units.push([...p.questionIds])
  }
  return units
}

/**
 * Compose the cold-start diagnostic (roadmap Phase 4): a few mid-difficulty questions from EVERY
 * discipline, so the planner's comfort priors meet real evidence early. Round-robin across
 * disciplines up to `perDisciplineCap` questions each and `targetTotal` overall — a thin bank
 * degrades to whatever exists (never blocks on missing content). The mode is server-assigned:
 * no IPC input can request 'diagnostic'. Attempts recorded here are ordinary mastery evidence by
 * design — nothing anywhere filters attempts by session mode.
 */
export async function planDiagnosticSession(
  index: ContentIndex,
  db: DB,
  opts: PlanOptions
): Promise<StartSessionResult> {
  const flaggedSet = new Set(await listFlaggedIds(db))

  const lanes = shuffle(
    DISCIPLINES.map((d) => ({ units: diagnosticUnits(index, d.slug, opts.rng), taken: 0 })),
    opts.rng
  )
  const chosenIds: string[] = []
  let progressed = true
  while (chosenIds.length < DIAGNOSTIC_CONFIG.targetTotal && progressed) {
    progressed = false
    for (const lane of lanes) {
      if (chosenIds.length >= DIAGNOSTIC_CONFIG.targetTotal) break
      if (lane.taken >= DIAGNOSTIC_CONFIG.perDisciplineCap) continue
      const unit = lane.units.shift()
      if (!unit) continue
      chosenIds.push(...unit)
      lane.taken += unit.length
      progressed = true
    }
  }

  const session = await createSession(db, {
    mode: 'diagnostic',
    scopeKind: 'mixed',
    scopeCode: null,
    refine: 'all',
    requestedCount: DIAGNOSTIC_CONFIG.targetTotal,
    now: opts.now
  })
  return { sessionId: session.id, mode: session.mode, ...presentChosen(index, chosenIds, flaggedSet) }
}

export async function gradeAndRecord(
  index: ContentIndex,
  db: DB,
  input: SubmitAnswerInput,
  opts: GradeOptions
): Promise<ServiceResult<SubmitAnswerResult>> {
  const q = index.byId.get(input.questionId)
  if (!q) return err('not-found')

  const isCorrect = q.correct === input.choice
  // A replayed/duplicate submit (double-click, renderer remount, any caller bypassing the UI latch)
  // upserts the attempt below but must NOT re-award gamification. Detect a prior attempt for this
  // (session, question) before the upsert; only a genuinely new answer credits activity.
  const alreadyAnswered = await attemptExists(db, input.sessionId, q.id)
  await recordAttempt(db, {
    sessionId: input.sessionId,
    questionId: q.id,
    passageId: q.passageId,
    topic: q.topic,
    discipline: q.discipline,
    section: q.section,
    chosen: input.choice,
    isCorrect,
    timeMs: input.timeMs ?? null,
    now: opts.now
  })

  // Gamification is a side-effect, in its own transaction — never block or fail grading on it, and
  // credit it only on the first answer for this question (a replay must not double-award coins/xp/streak).
  let activity: SubmitAnswerResult['activity'] = null
  if (!alreadyAnswered) {
    activity = await creditActivitySafely(db, { kind: 'qbank.answer', taxonomyRef: q.topic, now: opts.now }, opts.recordActivityFn)
  }

  return ok({
    correct: isCorrect,
    correctChoice: q.correct,
    explanation: q.explanation,
    choiceExplanations: q.choiceExplanations,
    activity
  })
}

export async function summarize(db: DB, sessionId: number): Promise<SessionSummary> {
  const attempts = await getSessionAttempts(db, sessionId)
  const rows: SessionSummaryRow[] = attempts.map((a) => ({
    questionId: a.questionId,
    chosen: a.chosen as ChoiceLetter,
    isCorrect: a.isCorrect
  }))
  const correct = rows.reduce((n, r) => n + (r.isCorrect ? 1 : 0), 0)
  return { sessionId, total: rows.length, correct, rows }
}
