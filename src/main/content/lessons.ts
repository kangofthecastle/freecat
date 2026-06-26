import { z } from 'zod'
import { loadContentType, readBody } from './loader'

// Optional per-section tags. When present, getLesson aggregates the section
// aamc tags into LessonDetail.aamcCategories; otherwise it falls back to the
// lesson topic's aamcCodes (so section-less seeds render their footer unchanged).
const lessonSectionSchema = z.object({
  title: z.string().min(1),
  anchor: z.string().min(1),
  tags: z.array(z.object({ vocab: z.string().min(1), code: z.string().min(1) })).default([])
})

export const lessonSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  order: z.number().int().optional(),
  bodyFile: z.string().optional(),
  sections: z.array(lessonSectionSchema).optional()
})
export type LessonEnvelope = z.infer<typeof lessonSchema>
// Parsed (output) section shape: `tags` is always an array (the .default([]) has run).
export type LessonSection = z.output<typeof lessonSectionSchema>

export interface LessonRecord {
  slug: string
  title: string
  summary?: string
  dir: string
  bodyFile: string
  sections?: LessonSection[]
}
export interface LoadedLesson {
  slug: string
  title: string
  summary?: string
  html: string
  sections?: LessonSection[]
}

export function loadLessons(root: string): LessonRecord[] {
  return loadContentType({ root, subdir: 'lessons', envelopeFile: 'lesson.yaml', schema: lessonSchema }).map(
    ({ dir, data }) => ({
      slug: data.slug,
      title: data.title,
      summary: data.summary,
      dir,
      bodyFile: data.bodyFile ?? 'body.html',
      // .parse() has already applied the per-section tags default; map to the
      // output section shape so `tags` is a concrete array (not input-optional).
      sections: data.sections?.map((s) => ({ title: s.title, anchor: s.anchor, tags: s.tags ?? [] }))
    })
  )
}

export class LessonStore {
  private bySlug: Map<string, LessonRecord>
  private bodyCache = new Map<string, string>()

  constructor(records: LessonRecord[], validTopicSlugs?: ReadonlySet<string>) {
    this.bySlug = new Map()
    for (const r of records) {
      if (this.bySlug.has(r.slug)) throw new Error(`Duplicate lesson slug: ${r.slug} (${r.dir})`)
      // When the taxonomy slug set is supplied, fail loud on a lesson whose slug is not a known topic
      // (the lesson-slug === topic-slug invariant). Without this, such a lesson loads but is invisible
      // and unreachable: composeOutline keys lookups on topic slugs and contentGetLesson requires a
      // matching topic, so a typo'd slug would silently vanish with no error.
      if (validTopicSlugs && !validTopicSlugs.has(r.slug)) {
        throw new Error(`Lesson slug "${r.slug}" matches no taxonomy topic (${r.dir})`)
      }
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
    return { slug: r.slug, title: r.title, summary: r.summary, html, sections: r.sections }
  }
}

/**
 * Build a LessonStore from the on-disk content tree. Production callers MUST pass the taxonomy
 * topic-slug set so the lesson-slug === topic-slug invariant is enforced (see index.ts); omitting it
 * (tests/fixtures that exercise the runtime null path) skips validation.
 */
export function createLessonStore(root: string, validTopicSlugs?: ReadonlySet<string>): LessonStore {
  return new LessonStore(loadLessons(root), validTopicSlugs)
}
