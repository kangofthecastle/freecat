import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { storeMedia } from '../../src/main/flashcards/media-store'
import { listDeckSets, listDecks, listCards, deleteDeckSet, referencedFilenames } from '../../src/main/repositories/flashcards'
import { rewriteMedia } from '../../src/shared/flashcards/render'
import type { ParsedCollection } from '../../src/main/flashcards/parsed-collection'

const make = (n: number): ParsedCollection => ({
  noteTypes: [{ ankiId: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
  decks: [{ ankiId: 1, name: 'MCAT' }, { ankiId: 2, name: 'MCAT::Bio' }],
  notes: Array.from({ length: n }, (_, i) => ({ ankiId: 100 + i, guid: `g${i}`, noteTypeAnkiId: 1, fields: [`Q${i}`], tags: [], sortField: `Q${i}` })),
  cards: Array.from({ length: n }, (_, i) => ({ noteAnkiId: 100 + i, deckAnkiId: 2, ord: 0 }))
})

let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('flashcards repository', () => {
  it('listDeckSets returns deck/card counts', async () => {
    await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(3) })
    const sets = await listDeckSets(db)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.deckCount).toBe(2)
    expect(sets[0]?.cardCount).toBe(3)
  })

  it('listDecks builds the :: tree with per-deck card counts', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(2) })
    const tree = await listDecks(db, ds.id)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.leafName).toBe('MCAT')
    expect(tree[0]?.children[0]?.leafName).toBe('Bio')
    expect(tree[0]?.children[0]?.cardCount).toBe(2)
  })

  it('listCards keyset-pages by id', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(5) })
    const bio = (await listDecks(db, ds.id))[0]?.children[0]
    if (!bio) throw new Error('no bio deck')
    const p1 = await listCards(db, { deckId: bio.deckId, limit: 2 })
    expect(p1.cards).toHaveLength(2)
    expect(p1.nextAfterId).not.toBeNull()
    const p2 = await listCards(db, { deckId: bio.deckId, afterId: p1.nextAfterId!, limit: 2 })
    expect(p2.cards[0]!.cardId).toBeGreaterThan(p1.cards[1]!.cardId)
    const p3 = await listCards(db, { deckId: bio.deckId, afterId: p2.nextAfterId!, limit: 2 })
    expect(p3.cards).toHaveLength(1)
    expect(p3.nextAfterId).toBeNull()
  })

  it('listCards reduces cloze markup in the preview to the answer text', async () => {
    const ds = await writeCollection(db, {
      sourceFilename: 'c.apkg', sourceFormat: 'legacy1',
      parsed: {
        noteTypes: [{ ankiId: 1, name: 'Cloze', kind: 'cloze', css: '', fields: [{ ord: 0, name: 'Text' }], templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }],
        decks: [{ ankiId: 1, name: 'D' }],
        notes: [{ ankiId: 100, guid: 'g', noteTypeAnkiId: 1, fields: ['{{c1::mitochondria::organelle}} is the powerhouse'], tags: [], sortField: '{{c1::mitochondria::organelle}} is the powerhouse' }],
        cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }]
      }
    })
    const deck = (await listDecks(db, ds.id))[0]
    if (!deck) throw new Error('no deck')
    const page = await listCards(db, { deckId: deck.deckId })
    expect(page.cards[0]?.preview).toBe('mitochondria is the powerhouse') // not the raw {{c1::…}} markup
  })

  it('listCards preview strips NESTED and multi cloze markup without leaving residue', async () => {
    const ds = await writeCollection(db, {
      sourceFilename: 'nested.apkg', sourceFormat: 'legacy1',
      parsed: {
        noteTypes: [{ ankiId: 1, name: 'Cloze', kind: 'cloze', css: '', fields: [{ ord: 0, name: 'Text' }], templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }],
        decks: [{ ankiId: 1, name: 'D' }],
        notes: [
          { ankiId: 100, guid: 'g1', noteTypeAnkiId: 1, fields: ['{{c1::outer {{c2::inner}}}}'], tags: [], sortField: '{{c1::outer {{c2::inner}}}}' },
          { ankiId: 101, guid: 'g2', noteTypeAnkiId: 1, fields: ['{{c1::aaa}} and {{c2::bbb}} and {{c1::ccc}}'], tags: [], sortField: '{{c1::aaa}} and {{c2::bbb}} and {{c1::ccc}}' }
        ],
        cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }, { noteAnkiId: 101, deckAnkiId: 1, ord: 0 }]
      }
    })
    const deck = (await listDecks(db, ds.id))[0]
    if (!deck) throw new Error('no deck')
    const previews = (await listCards(db, { deckId: deck.deckId })).cards.map((c) => c.preview)
    // nested: clean text, no stray '{{', '}}', or 'c2' residue
    expect(previews).toContain('outer inner')
    // multi-cloze on one line: every deletion's answer shown, none left as raw markup
    expect(previews).toContain('aaa and bbb and ccc')
    for (const p of previews) {
      expect(p).not.toContain('{{')
      expect(p).not.toContain('}}')
    }
  })

  it('referencedFilenames authorizes exactly what rewriteMedia rewrites (M3 offset-0 src)', () => {
    // A card whose first concatenated field begins with `src=` at offset 0 (no leading
    // whitespace). The scan must NOT over-authorize relative to the rewriter: rewriteMedia
    // only rewrites a `src` preceded by whitespace, so an offset-0 `src` it cannot reach must
    // also be left unauthorized by referencedFilenames (otherwise media loads but never renders).
    const body = 'src="lead.png"> middle <img src="mid.png">'
    const refs = referencedFilenames([body])
    const map = refs.map((f) => ({ filename: f, url: `fm://t/${f}` }))
    const rewritten = rewriteMedia(body, map)

    // The whitespace-preceded src IS authorized and IS rewritten.
    expect(refs).toContain('mid.png')
    expect(rewritten).toContain('fm://t/mid.png')

    // The offset-0 src is NOT authorized (the rewriter would never touch it anyway).
    expect(refs).not.toContain('lead.png')
    // Consistency: every authorized filename actually appears rewritten in the output, so the
    // scan never grants a media URL the iframe rewriter then fails to use.
    for (const f of refs) {
      expect(rewritten).toContain(`fm://t/${f}`)
      expect(rewritten).not.toContain(`"${f}"`)
    }
  })

  it('deleteDeckSet removes the set + all children, and 404s the second time', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(2) })
    expect(await deleteDeckSet(db, ds.id)).toEqual({ ok: true, data: null })
    expect(await listDeckSets(db)).toHaveLength(0)
    expect(await deleteDeckSet(db, ds.id)).toEqual({ ok: false, error: 'deck-set-not-found' })
  })

  it("deleteDeckSet unlinks the set's media blobs, keeping any blob another set still references", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-media-'))
    try {
      // ds1 references a unique blob and a shared blob; ds2 references only the shared one
      // (storeMedia dedupes on disk by content hash, so both sets point at the same file).
      const stored1 = storeMedia(dir, { 'only.png': new Uint8Array([1, 2, 3]), 'shared.png': new Uint8Array([9, 9]) })
      const stored2 = storeMedia(dir, { 'shared.png': new Uint8Array([9, 9]) })
      const ds1 = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: make(1), media: stored1 })
      const ds2 = await writeCollection(db, { sourceFilename: 'b.apkg', sourceFormat: 'legacy1', parsed: make(1), media: stored2 })
      const path = (m: { hash: string; ext: string }): string => join(dir, `${m.hash}${m.ext}`)

      expect(await deleteDeckSet(db, ds1.id, dir)).toEqual({ ok: true, data: null })
      expect(existsSync(path(stored1['only.png']!))).toBe(false) // unique to ds1 → removed
      expect(existsSync(path(stored1['shared.png']!))).toBe(true) // ds2 still references it

      expect(await deleteDeckSet(db, ds2.id, dir)).toEqual({ ok: true, data: null })
      expect(existsSync(path(stored1['shared.png']!))).toBe(false) // last reference gone
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('deleteDeckSet never unlinks through a poisoned hash/ext (no traversal)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'fc-media-'))
    try {
      const mediaDir = join(base, 'media')
      mkdirSync(mediaDir)
      const secret = join(base, 'secret.png')
      writeFileSync(secret, new Uint8Array([7]))
      // A media row whose hash escapes mediaDir; the cleanup's shape check must refuse it.
      const ds = await writeCollection(db, {
        sourceFilename: 'evil.apkg', sourceFormat: 'legacy1', parsed: make(1),
        media: { 'x.png': { hash: '../secret', ext: '.png' } }
      })
      expect(await deleteDeckSet(db, ds.id, mediaDir)).toEqual({ ok: true, data: null })
      expect(existsSync(secret)).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('listCards preview truncates on code points, never splitting a surrogate pair', async () => {
    const long = '🧬'.repeat(150) // 150 code points = 300 UTF-16 units
    const ds = await writeCollection(db, {
      sourceFilename: 'emoji.apkg', sourceFormat: 'legacy1',
      parsed: {
        noteTypes: [{ ankiId: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
        decks: [{ ankiId: 1, name: 'D' }],
        notes: [{ ankiId: 100, guid: 'g', noteTypeAnkiId: 1, fields: [long], tags: [], sortField: long }],
        cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }]
      }
    })
    const deck = (await listDecks(db, ds.id))[0]
    if (!deck) throw new Error('no deck')
    const preview = (await listCards(db, { deckId: deck.deckId })).cards[0]?.preview ?? ''
    expect(preview).toBe(`${'🧬'.repeat(100)}…`)
    expect(preview).not.toContain('�')
  })
})
