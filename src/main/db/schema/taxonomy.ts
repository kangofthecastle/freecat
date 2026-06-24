import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Foundation-owned: the MCAT taxonomy tree (AAMC content outline).
export const taxonomyNode = sqliteTable('taxonomy_node', {
  // Stable string id, e.g. "section:chem-phys", "fc:4", "cc:4A", "skill:cars-comprehension", "topic:doppler-effect"
  id: text('id').primaryKey(),
  kind: text('kind', {
    enum: ['section', 'foundational_concept', 'content_category', 'skill', 'topic']
  }).notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  parentId: text('parent_id')
})

export type TaxonomyNode = typeof taxonomyNode.$inferSelect
