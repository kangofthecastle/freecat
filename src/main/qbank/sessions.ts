import type { DB } from '../db/client'
import type { ContentIndex, QuestionContent } from '../content/types'
import type {
  StartSessionInput, StartSessionResult, PresentedQuestion, PresentedPassage,
  SubmitAnswerInput, SubmitAnswerResult, SessionSummary, SessionSummaryRow,
  ChoiceLetter, ServiceResult
} from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import { createSession } from '../repositories/qbank-sessions'
import { recordAttempt, latestIncorrectQuestionIds, getSessionAttempts } from '../repositories/qbank-attempts'
import { listFlaggedIds } from '../repositories/qbank-flags'
import { recordActivity } from '../repositories/activity'

export type Rng = () => number // [0,1)
export interface PlanOptions { now: Date; rng: Rng }

export type RecordActivityFn = typeof recordActivity
export interface GradeOptions { now: Date; recordActivityFn?: RecordActivityFn }

/** Eligible question ids for the requested scope (mixed → everything). */
function scopeIds(index: ContentIndex, input: StartSessionInput): string[] {
  if (input.scopeKind === 'topic') return index.byTopic.get(input.scopeCode ?? '') ?? []
  if (input.scopeKind === 'discipline') return index.byDiscipline.get(input.scopeCode ?? '') ?? []
  return index.allQuestionIds
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

  // 1. eligible ids by scope, then intersect with the refine set.
  let eligible = scopeIds(index, input)
  if (input.refine === 'incorrect') {
    const allow = new Set(await latestIncorrectQuestionIds(db))
    eligible = eligible.filter((id) => allow.has(id))
  } else if (input.refine === 'flagged') {
    eligible = eligible.filter((id) => flaggedSet.has(id))
  }

  // 2. group eligible ids into units (standalone = 1 question; a passage question pulls
  //    its whole passage's ordered questionIds — siblings included even if not eligible —
  //    deduped by passage). Units preserve first-seen order of the eligible list.
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

  return { sessionId: session.id, mode: session.mode, questions, passages }
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

  // Gamification is a side-effect, in its own transaction — never block or fail grading on it.
  let activity: SubmitAnswerResult['activity'] = null
  const record = opts.recordActivityFn ?? recordActivity
  try {
    const res = await record(db, {
      kind: 'qbank.answer',
      taxonomyRef: q.topic,
      now: opts.now
    })
    if (res.ok) activity = res.data
  } catch {
    activity = null
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
