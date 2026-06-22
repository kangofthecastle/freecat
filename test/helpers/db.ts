import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { createDb, type DB } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'

// @libsql/client's local in-memory db does NOT survive client.transaction() (the
// connection is dropped and a fresh, empty db reopens → "no such table"), and
// transactions are central to the gamification repos. So tests use a unique
// temp-file-backed db per call — same fresh/isolated semantics, but transaction-safe.
// Files are cleaned up in one shot by the vitest global teardown (see test/global-setup.ts);
// per-call cleanup races parallel workers, and process 'exit' hooks don't fire under vitest.
const TEST_DB_DIR = join(tmpdir(), 'freecat-test')

/** A migrated, isolated, transaction-safe db for a single test. */
export async function createTestDb(): Promise<DB> {
  mkdirSync(TEST_DB_DIR, { recursive: true })
  const db = createDb(`file:${join(TEST_DB_DIR, `${randomUUID()}.db`)}`)
  await runMigrations(db, 'drizzle')
  return db
}

/** Remove all temp test dbs. Call ONLY when none are open (vitest global teardown). */
export function cleanupTestDbs(): void {
  try { rmSync(TEST_DB_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
}
