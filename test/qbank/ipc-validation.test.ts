import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import {
  startSessionSchema,
  submitAnswerSchema,
  completeSessionSchema,
  toggleFlagSchema
} from '../../src/main/ipc/qbank'
import type { ContentIndex } from '../../src/main/content/types'
import type { DB } from '../../src/main/db/client'
import { CH } from '../../src/shared/channels'
import type { QuestionRef } from '../../src/shared/dto'

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

/** Minimal index stub: only `byTopic` matters for questionsForTaxonomy. */
function stubIndex(byTopic: Record<string, string[]>): ContentIndex {
  return {
    byId: new Map(),
    passagesById: new Map(),
    byTopic: new Map(Object.entries(byTopic)),
    byDiscipline: new Map(),
    byTag: new Map(),
    allQuestionIds: [],
    errors: []
  }
}

describe('qbank IPC validation', () => {
  it('startSession scope accepts mixed/discipline/topic (with and without scopeCode)', () => {
    expect(startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 10 }))
      .toEqual({ scopeKind: 'mixed', refine: 'all', count: 10 })
    expect(
      startSessionSchema.parse({ scopeKind: 'topic', scopeCode: 'biochem.enzymes', refine: 'incorrect', count: 5 })
    ).toEqual({ scopeKind: 'topic', scopeCode: 'biochem.enzymes', refine: 'incorrect', count: 5 })
    expect(
      startSessionSchema.parse({ scopeKind: 'discipline', scopeCode: 'biochem', refine: 'all', count: 5 })
    ).toEqual({ scopeKind: 'discipline', scopeCode: 'biochem', refine: 'all', count: 5 })
  })

  it('startSession rejects the retired scope kinds (skill / content_category / section)', () => {
    expect(() => startSessionSchema.parse({ scopeKind: 'skill', refine: 'all', count: 5 })).toThrow()
    expect(() => startSessionSchema.parse({ scopeKind: 'content_category', scopeCode: '4A', refine: 'all', count: 5 })).toThrow()
    expect(() => startSessionSchema.parse({ scopeKind: 'section', refine: 'all', count: 5 })).toThrow()
  })

  it('rejects a bad refine enum', () => {
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'starred', count: 5 })).toThrow()
  })

  it('rejects count < 1, count > 100, and a non-integer count', () => {
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 0 })).toThrow()
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 101 })).toThrow()
    expect(() => startSessionSchema.parse({ scopeKind: 'mixed', refine: 'all', count: 2.5 })).toThrow()
  })

  it('accepts a valid submitAnswer payload and rejects malformed ones', () => {
    expect(submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1', choice: 'A', timeMs: 1200 }))
      .toEqual({ sessionId: 1, questionId: 'cp-q1', choice: 'A', timeMs: 1200 })
    expect(() => submitAnswerSchema.parse({ sessionId: 0, questionId: 'cp-q1', choice: 'A' })).toThrow() // non-positive
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: '', choice: 'A' })).toThrow() // empty id
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1', choice: 'E' })).toThrow() // bad letter
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1' })).toThrow() // missing choice
    expect(() => submitAnswerSchema.parse({ sessionId: 1, questionId: 'cp-q1', choice: 'A', timeMs: -1 })).toThrow() // negative time
  })

  it('validates completeSession + toggleFlag scalar schemas', () => {
    expect(completeSessionSchema.parse(7)).toBe(7)
    expect(() => completeSessionSchema.parse(0)).toThrow()
    expect(toggleFlagSchema.parse('cp-q1')).toBe('cp-q1')
    expect(() => toggleFlagSchema.parse('')).toThrow()
  })

  describe('questionsForTaxonomy handler', () => {
    beforeEach(() => handlers.clear())

    it('returns QuestionRef[] for a known topic and [] for an unknown one', async () => {
      const { registerQbankIpc } = await import('../../src/main/ipc/qbank')
      const index = stubIndex({ 'biochem.enzymes': ['bb-0001-q1', 'bb-0001-q2'] })
      registerQbankIpc({} as DB, index)

      const refs = await invoke<QuestionRef[]>(CH.qbankQuestionsForTaxonomy, 'biochem.enzymes')
      expect(refs).toEqual([
        { id: 'bb-0001-q1', topic: 'biochem.enzymes' },
        { id: 'bb-0001-q2', topic: 'biochem.enzymes' }
      ])

      const none = await invoke<QuestionRef[]>(CH.qbankQuestionsForTaxonomy, 'physics.fluids')
      expect(none).toEqual([])
    })

    it('rejects an empty topic slug', async () => {
      const { registerQbankIpc } = await import('../../src/main/ipc/qbank')
      registerQbankIpc({} as DB, stubIndex({}))
      await expect(invoke<QuestionRef[]>(CH.qbankQuestionsForTaxonomy, '')).rejects.toThrow()
    })
  })
})
