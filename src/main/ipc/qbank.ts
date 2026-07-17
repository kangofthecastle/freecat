import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import type { ContentIndex } from '../content/types'
import { CH } from '../../shared/channels'
import { ok } from '../../shared/dto'
import type { QuestionRef } from '../../shared/dto'
import { planSession, gradeAndRecord, summarize } from '../qbank/sessions'
import { completeSession } from '../repositories/qbank-sessions'
import { toggleFlag } from '../repositories/qbank-flags'
import { getAvailability } from '../repositories/qbank-analytics'

export const startSessionSchema = z
  .object({
    scopeKind: z.enum(['mixed', 'discipline', 'topic']),
    scopeCode: z.string().min(1).max(64).optional(),
    refine: z.enum(['all', 'incorrect', 'flagged']),
    count: z.number().int().min(1).max(100),
    tagFilter: z.array(z.object({ vocab: z.string().min(1), code: z.string().min(1) })).optional()
  })
  // A discipline/topic scope is meaningless without its code: scopeIds would look up `''`
  // and silently yield an empty session. Only 'mixed' (the whole bank) may omit scopeCode.
  .superRefine((v, ctx) => {
    if (v.scopeKind !== 'mixed' && (v.scopeCode === undefined || v.scopeCode.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopeCode'],
        message: `scopeCode is required when scopeKind is "${v.scopeKind}"`
      })
    }
  })
export const submitAnswerSchema = z.object({
  sessionId: z.number().int().positive(),
  questionId: z.string().min(1).max(128),
  choice: z.enum(['A', 'B', 'C', 'D']),
  timeMs: z.number().int().nonnegative().max(86_400_000).optional()
})
export const completeSessionSchema = z.number().int().positive()
export const toggleFlagSchema = z.string().min(1).max(128)
export const questionsForTaxonomySchema = z.string().min(1).max(128)

export interface QbankIpcOptions {
  /** Injected clock for testability; defaults to wall-clock. */
  now?: () => Date
  /** Fired after a successfully graded answer — main/index.ts wires the plan's debounced
   *  regeneration here (this module knows a callback, not the Plan module). */
  onActivity?: () => void
}

export function registerQbankIpc(db: DB, index: ContentIndex, opts: QbankIpcOptions = {}): void {
  const now = opts.now ?? (() => new Date())
  ipcMain.handle(CH.qbankStartSession, (_e, raw: unknown) =>
    planSession(index, db, startSessionSchema.parse(raw), { now: now(), rng: Math.random }))
  ipcMain.handle(CH.qbankSubmitAnswer, async (_e, raw: unknown) => {
    const result = await gradeAndRecord(index, db, submitAnswerSchema.parse(raw), { now: now() })
    if (result.ok) opts.onActivity?.()
    return result
  })
  // Mark the session complete (writes completedAt; throws if the row is missing) AND return the
  // summary the renderer expects. completeSession is the side-effect; summarize is the return value.
  // A missing-session throw propagates as an IPC rejection — the renderer's completeSession is typed
  // Promise<SessionSummary> and its caller (Session.tsx) catches and surfaces a retry, so we keep the
  // raw-summary return shape rather than wrapping in a ServiceResult.
  ipcMain.handle(CH.qbankCompleteSession, async (_e, raw: unknown) => {
    const sessionId = completeSessionSchema.parse(raw)
    await completeSession(db, sessionId, now())
    return summarize(db, sessionId)
  })
  ipcMain.handle(CH.qbankToggleFlag, async (_e, raw: unknown) => {
    const result = await toggleFlag(db, toggleFlagSchema.parse(raw), now())
    // Flags feed the plan's mistake-review eligibility (flagged = always eligible) — a flag toggle
    // must re-plan just like an answer does, or "flag it for tomorrow" silently does nothing.
    opts.onActivity?.()
    return ok(result)
  })
  ipcMain.handle(CH.qbankQuestionsForTaxonomy, (_e, raw: unknown): QuestionRef[] => {
    const topic = questionsForTaxonomySchema.parse(raw)
    return (index.byTopic.get(topic) ?? []).map((id) => ({ id, topic }))
  })
  // Zero-arg snapshot the composer counts against client-side (no per-control round trips).
  ipcMain.handle(CH.qbankAvailability, () => getAvailability(db, index))
}
