// test/flashcards/media-protocol.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { mintMediaToken, resolveMediaToken, __resetMediaTokens } from '../../src/main/flashcards/media-tokens'
import { resolveMedia, MIME_BY_EXT } from '../../src/main/flashcards/media-protocol'
import type { ParsedCollection } from '../../src/main/flashcards/parsed-collection'

const minimal: ParsedCollection = {
  noteTypes: [{ ankiId: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
  decks: [{ ankiId: 1, name: 'D' }],
  notes: [{ ankiId: 100, guid: 'g', noteTypeAnkiId: 1, fields: ['x'], tags: [], sortField: 'x' }],
  cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }]
}

let db: DB
beforeEach(async () => { db = await createTestDb(); __resetMediaTokens() })

describe('media tokens', () => {
  it('mints unique tokens that resolve to their deck-set', () => {
    const a = mintMediaToken(1)
    const b = mintMediaToken(2)
    expect(a).not.toBe(b)
    expect(resolveMediaToken(a)).toBe(1)
    expect(resolveMediaToken(b)).toBe(2)
    expect(resolveMediaToken('nope')).toBeUndefined()
  })
})

describe('resolveMedia', () => {
  it('resolves a token+filename to an on-disk path and MIME', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'pic.png': { hash: 'deadbeef', ext: '.png' } } })
    const token = mintMediaToken(ds.id)
    const r = await resolveMedia(db, '/media', token, 'pic.png')
    expect(r).toEqual({ path: '/media/deadbeef.png', mime: 'image/png' })
  })

  it('returns null for an unknown token, unknown filename, or disallowed extension', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'doc.exe': { hash: 'abc', ext: '.exe' }, 'good.png': { hash: 'aaa', ext: '.png' } } })
    const token = mintMediaToken(ds.id)
    expect(await resolveMedia(db, '/media', 'badtoken', 'good.png')).toBeNull()
    expect(await resolveMedia(db, '/media', token, 'missing.png')).toBeNull()
    expect(await resolveMedia(db, '/media', token, 'doc.exe')).toBeNull() // ext not on allowlist
  })

  it('rejects a non-hex hash (defends against a poisoned media row)', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'x.png': { hash: '../etc/passwd', ext: '.png' } } })
    const token = mintMediaToken(ds.id)
    expect(await resolveMedia(db, '/media', token, 'x.png')).toBeNull()
  })

  it('a token for deck-set A cannot resolve deck-set B media', async () => {
    const dsA = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'a.png': { hash: 'aaa', ext: '.png' } } })
    const dsB = await writeCollection(db, { sourceFilename: 'b.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'b.png': { hash: 'bbb', ext: '.png' } } })
    const tokenA = mintMediaToken(dsA.id)
    expect(await resolveMedia(db, '/media', tokenA, 'b.png')).toBeNull() // B's file, A's token → denied
    expect(await resolveMedia(db, '/media', tokenA, 'a.png')).not.toBeNull()
    expect(dsB.id).toBeGreaterThan(dsA.id)
  })

  it('the MIME allowlist is closed (no echoing of the filename)', () => {
    expect(MIME_BY_EXT['.svg']).toBe('image/svg+xml')
    expect(MIME_BY_EXT['.exe']).toBeUndefined()
  })
})
