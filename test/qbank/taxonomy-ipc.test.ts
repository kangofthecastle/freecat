import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { createTestDb } from '../helpers/db'
import { seedTaxonomy } from '../../src/main/repositories/taxonomy'
import { CH } from '../../src/shared/channels'
import type { DisciplineTreeDto, TagVocabEntry } from '../../src/shared/dto'

// Electron's `ipcMain` is not available in the node-env test process (importing it
// yields undefined), so we capture the handlers registered by registerTaxonomyIpc
// into a map and invoke them directly.
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

describe('taxonomy IPC', () => {
  beforeEach(() => handlers.clear())

  it('taxonomy:list returns the discipline→topic tree including physics with four topics', async () => {
    const { registerTaxonomyIpc } = await import('../../src/main/ipc/taxonomy')
    const db = await createTestDb()
    await seedTaxonomy(db)
    registerTaxonomyIpc(db)

    const tree = await invoke<DisciplineTreeDto[]>(CH.taxonomyList)
    const physics = tree.find((d) => d.discipline === 'physics')
    expect(physics).toBeDefined()
    expect(physics!.topics).toHaveLength(4)
    expect(physics!.topics.map((t) => t.slug).sort()).toEqual([
      'physics.electrostatics-circuits',
      'physics.fluids',
      'physics.mechanics',
      'physics.waves-sound-light'
    ])
  })

  it('taxonomy:tags returns the 31 AAMC vocab entries', async () => {
    const { registerTaxonomyIpc } = await import('../../src/main/ipc/taxonomy')
    const db = await createTestDb()
    await seedTaxonomy(db)
    registerTaxonomyIpc(db)

    const tags = await invoke<TagVocabEntry[]>(CH.taxonomyTags)
    expect(tags).toHaveLength(31)
    expect(tags.every((t) => t.vocab === 'aamc')).toBe(true)
    expect(tags.find((t) => t.code === '1A')!.title).toMatch(/proteins/i)
  })
})
