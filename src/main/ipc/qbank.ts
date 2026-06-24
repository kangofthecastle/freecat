import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import type { ContentIndex } from '../content/types'
import { CH } from '../../shared/channels'
import { ok } from '../../shared/dto'
import type { QuestionRef } from '../../shared/dto'
import { planSession, gradeAndRecord, summarize } from '../qbank/sessions'
import { toggleFlag } from '../repositories/qbank-flags'
import { getDashboard } from '../repositories/qbank-analytics'

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

export function registerQbankIpc(db: DB, index: ContentIndex): void {
  ipcMain.handle(CH.qbankStartSession, (_e, raw: unknown) =>
    planSession(index, db, startSessionSchema.parse(raw), { now: new Date(), rng: Math.random }))
  ipcMain.handle(CH.qbankSubmitAnswer, (_e, raw: unknown) =>
    gradeAndRecord(index, db, submitAnswerSchema.parse(raw), { now: new Date() }))
  ipcMain.handle(CH.qbankCompleteSession, (_e, raw: unknown) =>
    summarize(db, completeSessionSchema.parse(raw)))
  ipcMain.handle(CH.qbankToggleFlag, async (_e, raw: unknown) =>
    ok(await toggleFlag(db, toggleFlagSchema.parse(raw), new Date())))
  ipcMain.handle(CH.qbankDashboard, () => getDashboard(db, index))
  ipcMain.handle(CH.qbankQuestionsForTaxonomy, (_e, raw: unknown): QuestionRef[] => {
    const topic = questionsForTaxonomySchema.parse(raw)
    return (index.byTopic.get(topic) ?? []).map((id) => ({ id, topic }))
  })
}
