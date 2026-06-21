import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { profile, type Profile } from '../db/schema'

export async function getOrCreateProfile(db: DB): Promise<Profile> {
  const existing = await db.select().from(profile).orderBy(profile.id).limit(1)
  if (existing.length > 0) return existing[0]

  await db.insert(profile).values({})
  const created = await db.select().from(profile).orderBy(profile.id).limit(1)
  return created[0]
}

export async function setProfileName(db: DB, name: string): Promise<Profile> {
  const current = await getOrCreateProfile(db)
  await db.update(profile).set({ displayName: name }).where(eq(profile.id, current.id))
  const updated = await db.select().from(profile).where(eq(profile.id, current.id)).limit(1)
  return updated[0]
}
