import { cleanupTestDbs } from './helpers/db'

// Runs once in the main vitest process (not per-worker), so it can safely remove the
// temp-file-backed test dbs. Clear up front (in case a prior run aborted) and on teardown.
export function setup(): void { cleanupTestDbs() }
export function teardown(): void { cleanupTestDbs() }
