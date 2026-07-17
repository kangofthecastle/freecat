import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { ok } from '../../shared/dto'
import type { LessonDetail, LessonRef, Outline, ServiceResult, MarkCompleteResult } from '../../shared/dto'
import { listDisciplinesWithTopics, getTopicBySlug, topicForTaxonomyRef } from '../repositories/taxonomy'
import {
  getAllProgress, getProgressForSlug, markViewed, setCompleted, completeLesson, deriveStatus
} from '../repositories/lesson-progress'
import { composeOutline } from '../content/outline'
import type { LessonStore } from '../content/lessons'

export const slugSchema = z.string().min(1).max(128)
export const markCompleteSchema = z.object({ slug: z.string().min(1).max(128), completed: z.boolean() })

export interface ContentReviewIpcOptions {
  /** Fired after a lesson is marked complete — main/index.ts wires the plan's debounced
   *  regeneration here (this module knows a callback, not the Plan module). */
  onActivity?: () => void
}

export function registerContentReviewIpc(db: DB, store: LessonStore, opts: ContentReviewIpcOptions = {}): void {
  ipcMain.handle(CH.contentGetOutline, async (): Promise<Outline> => {
    const [taxonomy, progress] = await Promise.all([listDisciplinesWithTopics(db), getAllProgress(db)])
    return composeOutline(taxonomy, store.list(), progress)
  })

  ipcMain.handle(CH.contentGetLesson, async (_e, raw: unknown): Promise<LessonDetail | null> => {
    const slug = slugSchema.parse(raw)
    const lesson = store.get(slug)
    if (!lesson) return null
    const topic = await getTopicBySlug(db, slug)
    if (!topic) return null
    const progress = await getProgressForSlug(db, slug)
    // Aggregate aamc tags from the lesson's sections when present; otherwise fall
    // back to the topic's aamcCodes so section-less seeds keep their footer.
    const fromSections = lesson.sections?.flatMap((s) => s.tags.filter((t) => t.vocab === 'aamc').map((t) => t.code))
    const aamcCategories = fromSections && fromSections.length ? [...new Set(fromSections)] : topic.aamcCodes
    return {
      slug,
      title: lesson.title,
      discipline: topic.discipline,
      aamcCategories,
      html: lesson.html,
      status: deriveStatus(progress)
    }
  })

  ipcMain.handle(CH.contentMarkViewed, async (_e, raw: unknown): Promise<void> => {
    await markViewed(db, slugSchema.parse(raw))
  })

  ipcMain.handle(CH.contentMarkComplete, async (_e, raw: unknown): Promise<ServiceResult<MarkCompleteResult>> => {
    const p = markCompleteSchema.parse(raw)
    if (p.completed) {
      const result = await completeLesson(db, p.slug)
      if (result.ok) opts.onActivity?.()
      return result
    }
    await setCompleted(db, p.slug, false)
    const row = await getProgressForSlug(db, p.slug)
    return ok({ status: deriveStatus(row) })
  })

  ipcMain.handle(CH.contentLessonForTaxonomy, async (_e, raw: unknown): Promise<LessonRef | null> => {
    const ref = slugSchema.parse(raw)
    const topic = await topicForTaxonomyRef(db, ref)
    if (!topic || !store.has(topic.slug)) return null
    return { slug: topic.slug, title: topic.title, discipline: topic.discipline }
  })
}
