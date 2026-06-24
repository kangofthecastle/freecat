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

export function registerContentReviewIpc(db: DB, store: LessonStore): void {
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
    return {
      slug,
      title: lesson.title,
      discipline: topic.discipline,
      aamcCategories: topic.aamcCodes,
      html: lesson.html,
      status: deriveStatus(progress)
    }
  })

  ipcMain.handle(CH.contentMarkViewed, async (_e, raw: unknown): Promise<void> => {
    await markViewed(db, slugSchema.parse(raw))
  })

  ipcMain.handle(CH.contentMarkComplete, async (_e, raw: unknown): Promise<ServiceResult<MarkCompleteResult>> => {
    const p = markCompleteSchema.parse(raw)
    if (p.completed) return completeLesson(db, p.slug)
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
