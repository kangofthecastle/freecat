import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { lessonProgress, type LessonProgress } from '../db/schema'
import { recordActivity } from './activity'
import { deriveStatus } from '../content/outline'
import { ok, type ServiceResult, type MarkCompleteResult } from '../../shared/dto'

export async function getAllProgress(db: DB): Promise<LessonProgress[]> {
  return db.select().from(lessonProgress)
}

export async function getProgressForSlug(db: DB, slug: string): Promise<LessonProgress | undefined> {
  const [row] = await db.select().from(lessonProgress).where(eq(lessonProgress.lessonSlug, slug))
  return row
}

export async function markViewed(db: DB, slug: string, now = new Date()): Promise<void> {
  await db
    .insert(lessonProgress)
    .values({ lessonSlug: slug, lastViewedAt: now })
    .onConflictDoUpdate({ target: lessonProgress.lessonSlug, set: { lastViewedAt: now } })
}

/** Set/clear completion. `newlyCompleted` is true only the first time a lesson is
 *  ever completed (guarded by countedForReward), so XP is granted at most once. */
export async function setCompleted(
  db: DB,
  slug: string,
  completed: boolean,
  now = new Date()
): Promise<{ newlyCompleted: boolean }> {
  const existing = await getProgressForSlug(db, slug)
  if (!existing) {
    await db.insert(lessonProgress).values({
      lessonSlug: slug,
      lastViewedAt: now,
      completedAt: completed ? now : null,
      countedForReward: completed
    })
    return { newlyCompleted: completed }
  }
  const newlyCompleted = completed && !existing.countedForReward
  await db
    .update(lessonProgress)
    .set({
      completedAt: completed ? existing.completedAt ?? now : null,
      countedForReward: existing.countedForReward || completed
    })
    .where(eq(lessonProgress.id, existing.id))
  return { newlyCompleted }
}

/** Mark complete and, on the first-ever completion, credit gamification. */
export async function completeLesson(
  db: DB,
  slug: string,
  now = new Date()
): Promise<ServiceResult<MarkCompleteResult>> {
  // Deliberately two steps (not one transaction): mark counted, then credit. For a
  // single local user a rare recordActivity failure leaving a counted-but-unrewarded
  // lesson is acceptable; revisit if this ever needs to be atomic.
  const { newlyCompleted } = await setCompleted(db, slug, true, now)
  if (!newlyCompleted) return ok<MarkCompleteResult>({ status: 'completed' })
  const activity = await recordActivity(db, { kind: 'lesson.complete', taxonomyRef: slug, now })
  return ok<MarkCompleteResult>({ status: 'completed', activity: activity.ok ? activity.data : undefined })
}

export { deriveStatus }
