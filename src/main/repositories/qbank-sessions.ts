import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { qbankSession, type QbankSessionRow } from '../db/schema'
import type { ScopeKind, Refine } from '../../shared/dto'

export interface CreateSessionParams {
  mode?: string
  scopeKind: ScopeKind
  scopeCode?: string | null
  refine: Refine
  requestedCount: number
  now: Date
}

export async function createSession(db: DB, p: CreateSessionParams): Promise<QbankSessionRow> {
  const [row] = await db.insert(qbankSession).values({
    mode: p.mode ?? 'tutor',
    scopeKind: p.scopeKind,
    scopeCode: p.scopeCode ?? null,
    refine: p.refine,
    requestedCount: p.requestedCount,
    createdAt: p.now
  }).returning()
  if (!row) throw new Error('createSession failed to insert')
  return row
}

export async function getSession(db: DB, id: number): Promise<QbankSessionRow | undefined> {
  const [row] = await db.select().from(qbankSession).where(eq(qbankSession.id, id))
  return row
}

export async function completeSession(db: DB, id: number, now: Date): Promise<QbankSessionRow> {
  const [row] = await db.update(qbankSession).set({ completedAt: now }).where(eq(qbankSession.id, id)).returning()
  if (!row) throw new Error('completeSession: session not found')
  return row
}
