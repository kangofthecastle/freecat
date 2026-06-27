import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { createTestDb } from '../helpers/db'
import { seedTaxonomy } from '../../src/main/repositories/taxonomy'
import { LessonStore, type LessonRecord } from '../../src/main/content/lessons'
import { CH } from '../../src/shared/channels'
import type { LessonDetail, LessonRef, MarkCompleteResult, ServiceResult } from '../../src/shared/dto'

// Electron's `ipcMain` is undefined under the node-env test process, so we capture
// the handlers registered by registerContentReviewIpc into a map and invoke them
// directly (mirrors test/qbank/taxonomy-ipc.test.ts).
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

// Both synthetic lessons reuse the real fixture body so store.get() can read HTML
// from disk. The slugs map to seeded taxonomy topics (with known aamcCodes).
const BODY_DIR = join(__dirname, '../fixtures/content-valid/lessons/biochem/enzymes')

function record(slug: string, sections?: LessonRecord['sections']): LessonRecord {
  return { slug, title: slug, dir: BODY_DIR, bodyFile: 'body.html', sections }
}

describe('getLesson aamcCategories', () => {
  beforeEach(() => handlers.clear())

  it('aggregates the distinct aamc codes from a sectioned lesson', async () => {
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    // biology.cellular-biology has topic.aamcCodes ['2A','2C']; sections declare a
    // disjoint set so we can prove aggregation wins over the topic fallback.
    const store = new LessonStore([
      record('biology.cellular-biology', [
        { title: 'A', anchor: 'a', tags: [{ vocab: 'aamc', code: '1A' }] },
        { title: 'B', anchor: 'b', tags: [{ vocab: 'aamc', code: '1A' }, { vocab: 'aamc', code: '1B' }] },
        { title: 'C', anchor: 'c', tags: [{ vocab: 'kaplan', code: 'XX' }] } // non-aamc vocab ignored
      ])
    ])
    registerContentReviewIpc(db, store)

    const detail = await invoke<LessonDetail | null>(CH.contentGetLesson, 'biology.cellular-biology')
    expect(detail).not.toBeNull()
    expect(detail!.aamcCategories).toEqual(['1A', '1B']) // distinct, aamc-only, NOT topic's ['2A','2C']
  })

  it('falls back to topic.aamcCodes for a section-less lesson', async () => {
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    // biochem.enzymes has topic.aamcCodes ['1A']; no sections → fallback path.
    const store = new LessonStore([record('biochem.enzymes')])
    registerContentReviewIpc(db, store)

    const detail = await invoke<LessonDetail | null>(CH.contentGetLesson, 'biochem.enzymes')
    expect(detail).not.toBeNull()
    expect(detail!.aamcCategories).toEqual(['1A']) // topic fallback
  })

  it('falls back when sections carry no aamc tags', async () => {
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    const store = new LessonStore([
      record('biochem.enzymes', [{ title: 'A', anchor: 'a', tags: [{ vocab: 'kaplan', code: 'XX' }] }])
    ])
    registerContentReviewIpc(db, store)

    const detail = await invoke<LessonDetail | null>(CH.contentGetLesson, 'biochem.enzymes')
    expect(detail!.aamcCategories).toEqual(['1A']) // empty aamc aggregate → topic fallback
  })

  it('returns null when the slug does not resolve to a topic', async () => {
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    const store = new LessonStore([record('not.a-real-topic')])
    registerContentReviewIpc(db, store)

    const detail = await invoke<LessonDetail | null>(CH.contentGetLesson, 'not.a-real-topic')
    expect(detail).toBeNull()
  })

  it('returns null when the lesson is in the store but its topic is not in the taxonomy', async () => {
    // store.get() succeeds (body on disk) but getTopicBySlug() fails because the
    // slug was never seeded → the "no topic" guard short-circuits to null.
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    const store = new LessonStore([record('biochem.not-a-seeded-topic')])
    registerContentReviewIpc(db, store)

    const detail = await invoke<LessonDetail | null>(CH.contentGetLesson, 'biochem.not-a-seeded-topic')
    expect(detail).toBeNull()
  })
})

describe('lessonForTaxonomy handler', () => {
  beforeEach(() => handlers.clear())

  it('returns the ref when the topic exists and a lesson is authored', async () => {
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    const store = new LessonStore([record('biochem.enzymes')])
    registerContentReviewIpc(db, store)

    const ref = await invoke<LessonRef | null>(CH.contentLessonForTaxonomy, 'biochem.enzymes')
    expect(ref).toEqual({ slug: 'biochem.enzymes', title: 'Enzymes', discipline: 'biochem' })
  })

  it('returns null when the topic exists but no lesson is authored', async () => {
    // biochem.enzymes is a real seeded topic, but the store has no lesson for it
    // → store.has() is false and the handler returns null (not a partial ref).
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    const store = new LessonStore([]) // no authored lessons
    registerContentReviewIpc(db, store)

    const ref = await invoke<LessonRef | null>(CH.contentLessonForTaxonomy, 'biochem.enzymes')
    expect(ref).toBeNull()
  })
})

describe('markComplete handler', () => {
  beforeEach(() => handlers.clear())

  it('markComplete(false) returns the derived (un-completed) status', async () => {
    // completed:false routes through setCompleted(slug,false): it upserts a row
    // whose completedAt is null, so deriveStatus yields the un-completed state.
    const { registerContentReviewIpc } = await import('../../src/main/ipc/content-review')
    const db = await createTestDb()
    await seedTaxonomy(db)
    const store = new LessonStore([record('biochem.enzymes')])
    registerContentReviewIpc(db, store)

    const res = await invoke<ServiceResult<MarkCompleteResult>>(CH.contentMarkComplete, {
      slug: 'biochem.enzymes',
      completed: false
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.status).toBe('in-progress') // un-completed: viewed/derived, not 'completed'
  })
})
