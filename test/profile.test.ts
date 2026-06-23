import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../src/main/db/client'
import { createTestDb } from './helpers/db'
import { getOrCreateProfile, setProfileName } from '../src/main/repositories/profile'

let db: DB

beforeEach(async () => {
  db = await createTestDb()
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
