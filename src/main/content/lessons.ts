import { z } from 'zod'
import { loadContentType, readBody } from './loader'

export const lessonSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  order: z.number().int().optional(),
  bodyFile: z.string().optional()
})
export type LessonEnvelope = z.infer<typeof lessonSchema>

export interface LessonRecord {
  slug: string
  title: string
  summary?: string
  dir: string
  bodyFile: string
}
export interface LoadedLesson {
  slug: string
  title: string
  summary?: string
  html: string
}

export function loadLessons(root: string): LessonRecord[] {
  return loadContentType({ root, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema: lessonSchema }).map(
    ({ dir, data }) => ({ slug: data.slug, title: data.title, summary: data.summary, dir, bodyFile: data.bodyFile ?? 'body.html' })
  )
}

export class LessonStore {
  private bySlug: Map<string, LessonRecord>
  private bodyCache = new Map<string, string>()

  constructor(records: LessonRecord[]) {
    this.bySlug = new Map()
    for (const r of records) {
      if (this.bySlug.has(r.slug)) throw new Error(`Duplicate lesson slug: ${r.slug} (${r.dir})`)
      this.bySlug.set(r.slug, r)
    }
  }

  list(): { slug: string; title: string; summary?: string }[] {
    return [...this.bySlug.values()].map((r) => ({ slug: r.slug, title: r.title, summary: r.summary }))
  }

  has(slug: string): boolean {
    return this.bySlug.has(slug)
  }

  get(slug: string): LoadedLesson | null {
    const r = this.bySlug.get(slug)
    if (!r) return null
    let html = this.bodyCache.get(slug)
    if (html === undefined) {
      html = readBody(r.dir, r.bodyFile)
      this.bodyCache.set(slug, html)
    }
    return { slug: r.slug, title: r.title, summary: r.summary, html }
  }
}

export function createLessonStore(root: string): LessonStore {
  return new LessonStore(loadLessons(root))
}
