import { describe, it, expect, beforeEach } from 'vitest'
import { createDb, type DB } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'
import { getOrCreateProfile, setProfileName } from '../src/main/repositories/profile'

let db: DB

beforeEach(async () => {
  db = createDb(':memory:')
  await runMigrations(db, 'drizzle')
})

describe('profile repository', () => {
  it('creates a default profile on first call', async () => {
    const profile = await getOrCreateProfile(db)
    expect(profile.id).toBeGreaterThan(0)
    expect(profile.displayName).toBe('Student')
  })

  it('returns the same profile on subsequent calls (single profile)', async () => {
    const first = await getOrCreateProfile(db)
    const second = await getOrCreateProfile(db)
    expect(second.id).toBe(first.id)
  })

  it('updates the display name', async () => {
    await getOrCreateProfile(db)
    const updated = await setProfileName(db, 'Warren')
    expect(updated.displayName).toBe('Warren')
    const reread = await getOrCreateProfile(db)
    expect(reread.displayName).toBe('Warren')
  })

  it('creates the profile when setProfileName is called first', async () => {
    const updated = await setProfileName(db, 'Warren')
    expect(updated.id).toBeGreaterThan(0)
    expect(updated.displayName).toBe('Warren')
  })
})
