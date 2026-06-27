import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { createTestDb } from '../helpers/db'
import { createSession, getSession } from '../../src/main/repositories/qbank-sessions'
import { recordAttempt } from '../../src/main/repositories/qbank-attempts'
import type { ContentIndex } from '../../src/main/content/types'
import type { DB } from '../../src/main/db/client'
import { CH } from '../../src/shared/channels'
import type { SessionSummary } from '../../src/shared/dto'

// Electron's `ipcMain` is unavailable in the node-env test process, so capture the
// handlers registered by registerQbankIpc into a map and invoke them directly.
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    }
  }
}))

const fakeEvent = {} as IpcMainInvokeEvent
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return (await handler(fakeEvent, ...args)) as T
}

/** Minimal index stub: completeSession touches neither the index nor any topic map. */
function stubIndex(): ContentIndex {
  return {
    byId: new Map(),
    passagesById: new Map(),
    byTopic: new Map(),
    byDiscipline: new Map(),
    byTag: new Map(),
    allQuestionIds: [],
    errors: []
  }
}

const NOW = new Date('2026-06-22T12:00:00Z')
const DONE = new Date('2026-06-22T12:42:00Z')

async function seedAttempt(db: DB, sessionId: number, questionId: string, isCorrect: boolean): Promise<void> {
  await recordAttempt(db, {
    sessionId,
    questionId,
    passageId: null,
    topic: 'physics.mechanics',
    discipline: 'physics',
    section: 'chem-phys',
    chosen: 'A',
    isCorrect,
    now: NOW
  })
}

describe('qbank:completeSession handler', () => {
  beforeEach(() => handlers.clear())

  it('writes completedAt = injected now and returns the correct summary', async () => {
    const { registerQbankIpc } = await import('../../src/main/ipc/qbank')
    const db = await createTestDb()
    const session = await createSession(db, { scopeKind: 'mixed', refine: 'all', requestedCount: 2, now: NOW })
    await seedAttempt(db, session.id, 'cp-q1', true)
    await seedAttempt(db, session.id, 'cp-q2', false)

    // Inject `now` so we can assert completedAt deterministically.
    registerQbankIpc(db, stubIndex(), { now: () => DONE })

    const summary = await invoke<SessionSummary>(CH.qbankCompleteSession, session.id)

    // Renderer-facing return shape is unchanged: the SessionSummary, not a ServiceResult.
    expect(summary.sessionId).toBe(session.id)
    expect(summary.total).toBe(2)
    expect(summary.correct).toBe(1)
    expect(summary.rows).toEqual([
      { questionId: 'cp-q1', chosen: 'A', isCorrect: true },
      { questionId: 'cp-q2', chosen: 'A', isCorrect: false }
    ])

    // The session row is now actually completed at the injected `now`.
    const row = await getSession(db, session.id)
    expect(row?.completedAt).not.toBeNull()
    expect(row?.completedAt?.getTime()).toBe(DONE.getTime())
  })

  it('completing an unknown session rejects (handler surfaces the not-found throw)', async () => {
    const { registerQbankIpc } = await import('../../src/main/ipc/qbank')
    const db = await createTestDb()
    registerQbankIpc(db, stubIndex(), { now: () => DONE })

    await expect(invoke<SessionSummary>(CH.qbankCompleteSession, 99999)).rejects.toThrow(/not found/i)
  })
})
