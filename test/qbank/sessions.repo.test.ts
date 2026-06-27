import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { createSession, getSession, completeSession } from '../../src/main/repositories/qbank-sessions'

const NOW = new Date('2026-06-22T12:00:00Z')
let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('qbank-sessions repository', () => {
  it('createSession inserts a row with mode defaulting to tutor and completedAt null', async () => {
    const s = await createSession(db, {
      scopeKind: 'mixed', scopeCode: null, refine: 'all', requestedCount: 10, now: NOW
    })
    expect(s.id).toBeGreaterThan(0)
    expect(s.mode).toBe('tutor')
    expect(s.scopeKind).toBe('mixed')
    expect(s.scopeCode).toBeNull()
    expect(s.refine).toBe('all')
    expect(s.requestedCount).toBe(10)
    expect(s.createdAt.getTime()).toBe(NOW.getTime())
    expect(s.completedAt).toBeNull()
  })

  it('createSession honors an explicit mode and scopeCode', async () => {
    const s = await createSession(db, {
      mode: 'timed', scopeKind: 'discipline', scopeCode: 'biochem', refine: 'incorrect', requestedCount: 5, now: NOW
    })
    expect(s.mode).toBe('timed')
    expect(s.scopeKind).toBe('discipline')
    expect(s.scopeCode).toBe('biochem')
    expect(s.refine).toBe('incorrect')
  })

  it('getSession returns the row by id, undefined when missing', async () => {
    const created = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 3, now: NOW })
    const got = await getSession(db, created.id)
    expect(got?.id).toBe(created.id)
    expect(await getSession(db, 99999)).toBeUndefined()
  })

  it('completeSession sets completedAt to the injected now and returns the row', async () => {
    const created = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 3, now: NOW })
    const DONE = new Date('2026-06-22T12:30:00Z')
    const done = await completeSession(db, created.id, DONE)
    expect(done.id).toBe(created.id)
    expect(done.completedAt?.getTime()).toBe(DONE.getTime())
    expect((await getSession(db, created.id))?.completedAt?.getTime()).toBe(DONE.getTime())
  })

  it('completeSession rejects when the session row is missing', async () => {
    await expect(completeSession(db, 99999, NOW)).rejects.toThrow(/not found/i)
  })
})
