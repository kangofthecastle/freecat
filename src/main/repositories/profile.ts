import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { profile, type Profile } from '../db/schema'

export async function getOrCreateProfile(db: DB): Promise<Profile> {
  const [existing] = await db.select().from(profile).orderBy(profile.id).limit(1)
  if (existing) return existing

  const [created] = await db.insert(profile).values({}).returning()
  if (!created) throw new Error('Failed to create profile')
  return created
}

export async function setProfileName(db: DB, name: string): Promise<Profile> {
  const current = await getOrCreateProfile(db)
  const [updated] = await db
    .update(profile)
    .set({ displayName: name })
    .where(eq(profile.id, current.id))
    .returning()
  if (!updated) throw new Error('Profile not found')
  return updated
}
