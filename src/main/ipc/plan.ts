import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import type { ContentIndex } from '../content/types'
import { CH } from '../../shared/channels'
import { ok } from '../../shared/dto'
import {
  getPlanView, savePlanSettings, savePlanPrefs, setPlanTaskStatus,
  type PlanRegenerator
} from '../repositories/plan'

const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const savePlanSettingsSchema = z
  .object({
    examDate: dayKeySchema.nullable().optional(),
    dailyBudgetMinutes: z.number().int().min(0).max(720).optional(),
    pacingEdit: z
      .object({ field: z.enum(['dailyNew', 'goalPct']), value: z.number().int().min(0).max(100) })
      .optional(),
    finishBufferDays: z.number().int().min(0).max(3650).optional(),
    questionsStartDay: dayKeySchema.nullable().optional(),
    questionsFinishBufferDays: z.number().int().min(0).max(3650).optional(),
    newCardOrder: z.enum(['deck', 'shuffled']).optional(),
    onboarded: z.boolean().optional()
  })
  .strict()

export const savePlanPrefsSchema = z
  .array(
    z
      .object({
        taxonomyRef: z.string().min(1).max(128),
        comfort: z.number().int().min(1).max(5).nullable(),
        excluded: z.boolean()
      })
      .strict()
  )
  .max(200)

export const setPlanTaskStatusSchema = z
  .object({
    taskId: z.number().int().positive(),
    status: z.enum(['pending', 'started', 'completed', 'skipped']) // 'expired' is system-only
  })
  .strict()

export interface PlanIpcOptions {
  /** Injected clock for testability; defaults to wall-clock. */
  now?: () => Date
}

/** Settings/prefs saves regenerate IMMEDIATELY (the user is waiting on the result); task-status
 *  changes ride the debounced path (a skip should re-plan, but not once per rapid-fire click). */
export function registerPlanIpc(
  db: DB,
  index: ContentIndex,
  lessonSlugs: ReadonlySet<string>,
  regen: PlanRegenerator,
  opts: PlanIpcOptions = {}
): void {
  const now = opts.now ?? (() => new Date())
  const ctx = { index, lessonSlugs }

  ipcMain.handle(CH.planGet, () => getPlanView(db, { ...ctx, now: now() }))

  ipcMain.handle(CH.planSaveSettings, async (_e, raw: unknown) => {
    const result = await savePlanSettings(db, savePlanSettingsSchema.parse(raw), { now: now() })
    await regen.regenerate()
    return ok(result)
  })

  ipcMain.handle(CH.planSavePrefs, async (_e, raw: unknown) => {
    await savePlanPrefs(db, savePlanPrefsSchema.parse(raw), now())
    await regen.regenerate()
    return ok(null)
  })

  ipcMain.handle(CH.planSetTaskStatus, async (_e, raw: unknown) => {
    const result = await setPlanTaskStatus(db, setPlanTaskStatusSchema.parse(raw), now())
    if (result.ok) regen.schedule()
    return result
  })

  ipcMain.handle(CH.planRegenerate, async () => {
    await regen.regenerate()
    return ok(null)
  })
}
