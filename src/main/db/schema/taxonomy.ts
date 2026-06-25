import { sqliteTable, integer, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

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

export type TaxonomyNode = typeof taxonomyNode.$inferSelect
