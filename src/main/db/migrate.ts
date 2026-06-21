import { migrate } from 'drizzle-orm/libsql/migrator'
import type { DB } from './client'

export async function runMigrations(db: DB, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder })
}
