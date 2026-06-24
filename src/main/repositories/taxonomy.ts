import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { taxonomyNode } from '../db/schema'
import { DISCIPLINES, TOPICS } from '../db/seed/taxonomy-data'
import type { DisciplineKey } from '../../shared/dto'

export interface TopicView {
  slug: string
  title: string
  discipline: DisciplineKey
  aamcCodes: string[]
}
export interface DisciplineView {
  discipline: DisciplineKey
  title: string
  topics: { slug: string; title: string; aamcCodes: string[] }[]
}

// AAMC codes are authored on the TOPICS seed constant (the `topic_aamc_category`
// bridge table is retired — see spec §4). Resolution is slug-only.
const AAMC_CODES_BY_SLUG: ReadonlyMap<string, string[]> = new Map(TOPICS.map((t) => [t.slug, t.aamcCodes]))

/** Idempotent seed of disciplines and topics (no AAMC bridge table). */
export async function seedTaxonomy(db: DB): Promise<void> {
  await db
    .insert(taxonomyNode)
    .values(DISCIPLINES.map((d, i) => ({ kind: 'discipline' as const, slug: d.slug, title: d.title, parentId: null, sortOrder: i })))
    .onConflictDoNothing()

  const disciplineRows = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'discipline'))
  const disciplineId = new Map(disciplineRows.map((r) => [r.slug, r.id]))

  const topicValues = TOPICS.map((t, i) => {
    const parentId = disciplineId.get(t.discipline)
    if (parentId === undefined) throw new Error(`seedTaxonomy: unknown discipline ${t.discipline} for ${t.slug}`)
    return { kind: 'topic' as const, slug: t.slug, title: t.title, parentId, sortOrder: i }
  })
  await db.insert(taxonomyNode).values(topicValues).onConflictDoNothing()
}

export async function listDisciplinesWithTopics(db: DB): Promise<DisciplineView[]> {
  const disciplines = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'discipline')).orderBy(taxonomyNode.sortOrder)
  const topics = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'topic')).orderBy(taxonomyNode.sortOrder)
  return disciplines.map((d) => ({
    discipline: d.slug as DisciplineKey,
    title: d.title,
    topics: topics
      .filter((t) => t.parentId === d.id)
      .map((t) => ({ slug: t.slug, title: t.title, aamcCodes: AAMC_CODES_BY_SLUG.get(t.slug) ?? [] }))
  }))
}

export async function getTopicBySlug(db: DB, slug: string): Promise<TopicView | null> {
  const [topic] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.slug, slug))
  if (!topic || topic.kind !== 'topic' || topic.parentId === null) return null
  const [parent] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.id, topic.parentId))
  if (!parent) return null
  return { slug: topic.slug, title: topic.title, discipline: parent.slug as DisciplineKey, aamcCodes: AAMC_CODES_BY_SLUG.get(topic.slug) ?? [] }
}

/** Resolve a Qbank ref — slug-only (the renderer only ever passes a topic slug). */
export async function topicForTaxonomyRef(db: DB, ref: string): Promise<TopicView | null> {
  return getTopicBySlug(db, ref)
}
