import { sqliteTable, integer, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// Shared backbone established by Content Review (charter §5.2): disciplines + topics
// as a 2-level tree. Qbank consumes this table and does NOT create its own.
export const taxonomyNode = sqliteTable('taxonomy_node', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['discipline', 'topic'] }).notNull(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => taxonomyNode.id),
  sortOrder: integer('sort_order').notNull().default(0)
})

// Many-to-many bridge: a topic → its AAMC content-category code(s).
export const topicAamcCategory = sqliteTable(
  'topic_aamc_category',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    topicId: integer('topic_id')
      .notNull()
      .references(() => taxonomyNode.id),
    aamcCode: text('aamc_code').notNull()
  },
  (t) => ({ uq: uniqueIndex('topic_aamc_uq').on(t.topicId, t.aamcCode) })
)

export type TaxonomyNode = typeof taxonomyNode.$inferSelect
