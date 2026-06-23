import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

// Foundation-owned: the single local user profile.
export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  displayName: text('display_name').notNull().default('Student'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
})

export type Profile = typeof profile.$inferSelect
