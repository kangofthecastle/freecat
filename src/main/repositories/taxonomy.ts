import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { taxonomyNode, topicAamcCategory } from '../db/schema'
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

/** Idempotent seed of disciplines, topics, and AAMC mappings. */
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

  const topicRows = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'topic'))
  const topicId = new Map(topicRows.map((r) => [r.slug, r.id]))

  const mapValues: { topicId: number; aamcCode: string }[] = []
  for (const t of TOPICS) {
    const id = topicId.get(t.slug)
    if (id === undefined) throw new Error(`seedTaxonomy: missing topic id for ${t.slug}`)
    for (const code of t.aamcCodes) mapValues.push({ topicId: id, aamcCode: code })
  }
  if (mapValues.length > 0) await db.insert(topicAamcCategory).values(mapValues).onConflictDoNothing()
}

async function codesByTopicId(db: DB): Promise<Map<number, string[]>> {
  const maps = await db.select().from(topicAamcCategory)
  const byId = new Map<number, string[]>()
  for (const m of maps) {
    const arr = byId.get(m.topicId) ?? []
    arr.push(m.aamcCode)
    byId.set(m.topicId, arr)
  }
  return byId
}

export async function listDisciplinesWithTopics(db: DB): Promise<DisciplineView[]> {
  const disciplines = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'discipline')).orderBy(taxonomyNode.sortOrder)
  const topics = await db.select().from(taxonomyNode).where(eq(taxonomyNode.kind, 'topic')).orderBy(taxonomyNode.sortOrder)
  const codes = await codesByTopicId(db)
  return disciplines.map((d) => ({
    discipline: d.slug as DisciplineKey,
    title: d.title,
    topics: topics
      .filter((t) => t.parentId === d.id)
      .map((t) => ({ slug: t.slug, title: t.title, aamcCodes: codes.get(t.id) ?? [] }))
  }))
}

export async function getTopicBySlug(db: DB, slug: string): Promise<TopicView | null> {
  const [topic] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.slug, slug))
  if (!topic || topic.kind !== 'topic' || topic.parentId === null) return null
  const [parent] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.id, topic.parentId))
  if (!parent) return null
  const codes = await codesByTopicId(db)
  return { slug: topic.slug, title: topic.title, discipline: parent.slug as DisciplineKey, aamcCodes: codes.get(topic.id) ?? [] }
}

export async function topicsForAamcCode(db: DB, code: string): Promise<TopicView[]> {
  const maps = await db.select().from(topicAamcCategory).where(eq(topicAamcCategory.aamcCode, code))
  const out: TopicView[] = []
  for (const m of maps) {
    const [topic] = await db.select().from(taxonomyNode).where(eq(taxonomyNode.id, m.topicId))
    if (!topic) continue
    const view = await getTopicBySlug(db, topic.slug)
    if (view) out.push(view)
  }
  return out
}

/** Resolve a Qbank ref — a topic slug first, else an AAMC code (first match). */
export async function topicForTaxonomyRef(db: DB, ref: string): Promise<TopicView | null> {
  const bySlug = await getTopicBySlug(db, ref)
  if (bySlug) return bySlug
  const byCode = await topicsForAamcCode(db, ref)
  return byCode[0] ?? null
}
