// test/flashcards/import.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { buildLegacyApkg } from './fixtures/legacy'
import { importFromFile } from '../../src/main/flashcards/import'
import { cards, media } from '../../src/main/db/schema'

let db: DB, dir: string
beforeEach(async () => { db = await createTestDb(); dir = join(tmpdir(), `fc-imp-${randomUUID()}`); mkdirSync(dir, { recursive: true }) })
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('importFromFile (legacy .apkg, end-to-end)', () => {
  it('imports a synthetic .apkg into rows + media files', async () => {
    const apkg = await buildLegacyApkg(
      {
        models: [{ id: 100, name: 'Basic', type: 0, css: '', flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ name: 'C', ord: 0, qfmt: '{{Front}}<img src="pic.png">', afmt: '{{Back}}' }] }],
        decks: [{ id: 1, name: 'Default' }],
        notes: [{ id: 10, guid: 'g', mid: 100, flds: ['F', 'B'] }],
        cards: [{ id: 1, nid: 10, did: 1, ord: 0 }]
      },
      { 'pic.png': strToU8('PNGBYTES') }
    )
    const file = join(dir, 'deck.apkg'); writeFileSync(file, apkg)

    const res = await importFromFile(db, file, join(dir, 'media'))
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.cardCount).toBe(1)
    expect(res.data.sourceFilename).toBe('deck.apkg')
    expect(await db.select().from(cards)).toHaveLength(1)
    expect((await db.select().from(media))[0]?.filename).toBe('pic.png')
    expect(readdirSync(join(dir, 'media'))).toHaveLength(1)
  })

  it('rejects a non-Anki zip as unsupported-format', async () => {
    const file = join(dir, 'x.apkg'); writeFileSync(file, zipSync({ 'random.txt': strToU8('hi') }))
    expect(await importFromFile(db, file, join(dir, 'media'))).toEqual({ ok: false, error: 'unsupported-format' })
  })
})
