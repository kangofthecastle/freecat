import type { Outline, OutlineGroup, LessonSummary, DisciplineKey, LessonStatus } from '../../shared/dto'
import type { LessonProgress } from '../db/schema'

export interface OutlineTopic {
  slug: string
  title: string
  aamcCodes: string[]
}
export interface OutlineDiscipline {
  discipline: DisciplineKey
  title: string
  topics: OutlineTopic[]
}
export interface OutlineLesson {
  slug: string
  title: string
  summary?: string
}

export function deriveStatus(row: LessonProgress | undefined): LessonStatus {
  if (!row) return 'not-started'
  return row.completedAt ? 'completed' : 'in-progress'
}

/** Merge taxonomy (all topics) + authored lessons + progress into the browse outline.
 *  Every topic is shown; only authored topics are `available` and counted in totals. */
export function composeOutline(
  disciplines: OutlineDiscipline[],
  lessons: OutlineLesson[],
  progress: LessonProgress[]
): Outline {
  const lessonBySlug = new Map(lessons.map((l) => [l.slug, l]))
  const progressBySlug = new Map(progress.map((p) => [p.lessonSlug, p]))
  const groups: OutlineGroup[] = []
  let completedAll = 0
  let totalAll = 0

  for (const d of disciplines) {
    const items: LessonSummary[] = []
    let completed = 0
    let total = 0
    for (const t of d.topics) {
      const lesson = lessonBySlug.get(t.slug)
      const available = lesson !== undefined
      const status = available ? deriveStatus(progressBySlug.get(t.slug)) : 'not-started'
      items.push({
        slug: t.slug,
        title: lesson?.title ?? t.title,
        discipline: d.discipline,
        summary: lesson?.summary,
        aamcCategories: t.aamcCodes,
        status,
        available
      })
      if (available) {
        total += 1
        if (status === 'completed') completed += 1
      }
    }
    groups.push({ discipline: d.discipline, title: d.title, completed, total, lessons: items })
    completedAll += completed
    totalAll += total
  }

  return { groups, completed: completedAll, total: totalAll }
}
