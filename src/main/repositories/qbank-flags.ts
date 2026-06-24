import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { qbankFlag } from '../db/schema'

/** Toggle a per-question flag: insert if absent (flagged), delete if present (unflagged). */
export async function toggleFlag(db: DB, questionId: string, now: Date): Promise<{ flagged: boolean }> {
  const [existing] = await db.select({ id: qbankFlag.id }).from(qbankFlag).where(eq(qbankFlag.questionId, questionId))
  if (existing) {
    await db.delete(qbankFlag).where(eq(qbankFlag.questionId, questionId))
    return { flagged: false }
  }
  await db.insert(qbankFlag).values({ questionId, createdAt: now })
  return { flagged: true }
}

export async function listFlaggedIds(db: DB): Promise<string[]> {
  const rows = await db.select({ questionId: qbankFlag.questionId }).from(qbankFlag)
  return rows.map((r) => r.questionId)
}

export async function isFlagged(db: DB, questionId: string): Promise<boolean> {
  const [row] = await db.select({ id: qbankFlag.id }).from(qbankFlag).where(eq(qbankFlag.questionId, questionId))
  return row !== undefined
}
