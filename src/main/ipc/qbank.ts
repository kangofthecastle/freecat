import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import type { ContentIndex } from '../content/types'
import { CH } from '../../shared/channels'
import { ok } from '../../shared/dto'
import { planSession, gradeAndRecord, summarize } from '../qbank/sessions'
import { toggleFlag } from '../repositories/qbank-flags'
import { getDashboard, getCounts } from '../repositories/qbank-analytics'

export const startSessionSchema = z.object({
  scopeKind: z.enum(['mixed', 'section', 'content_category', 'skill']),
  scopeCode: z.string().min(1).max(64).optional(),
  refine: z.enum(['all', 'incorrect', 'flagged']),
  count: z.number().int().min(1).max(100)
})
export const submitAnswerSchema = z.object({
  sessionId: z.number().int().positive(),
  questionId: z.string().min(1).max(128),
  choice: z.enum(['A', 'B', 'C', 'D']),
  timeMs: z.number().int().nonnegative().max(86_400_000).optional()
})
export const completeSessionSchema = z.number().int().positive()
export const toggleFlagSchema = z.string().min(1).max(128)

export function registerQbankIpc(db: DB, index: ContentIndex): void {
  ipcMain.handle(CH.qbankGetComposerData, async () => ({
    totalQuestions: index.allQuestionIds.length,
    ...(await getCounts(db))
  }))
  ipcMain.handle(CH.qbankStartSession, (_e, raw: unknown) =>
    planSession(index, db, startSessionSchema.parse(raw), { now: new Date(), rng: Math.random }))
  ipcMain.handle(CH.qbankSubmitAnswer, (_e, raw: unknown) =>
    gradeAndRecord(index, db, submitAnswerSchema.parse(raw), { now: new Date() }))
  ipcMain.handle(CH.qbankCompleteSession, (_e, raw: unknown) =>
    summarize(db, completeSessionSchema.parse(raw)))
  ipcMain.handle(CH.qbankToggleFlag, async (_e, raw: unknown) =>
    ok(await toggleFlag(db, toggleFlagSchema.parse(raw), new Date())))
  ipcMain.handle(CH.qbankGetDashboard, () => getDashboard(db))
}
