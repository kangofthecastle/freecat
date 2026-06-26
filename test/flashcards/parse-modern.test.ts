// test/flashcards/parse-modern.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { writeModernCollection, type ModernSpec } from './fixtures/modern'
import { parseModernCollection, openCollectionReadOnly } from '../../src/main/flashcards/parse-modern'
import { ImportTooLargeError } from '../../src/main/flashcards/zip'

const spec: ModernSpec = {
  noteTypes: [
    { id: 1, name: 'Basic', kind: 'standard', css: '.card{color:red}', fields: [{ ord: 0, name: 'Front' }, { ord: 1, name: 'Back' }], templates: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }] },
    { id: 2, name: 'Cloze', kind: 'cloze', css: '.cloze{font-weight:bold}', fields: [{ ord: 0, name: 'Text' }], templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }
  ],
  decks: [{ id: 1, name: 'MCAT' }, { id: 2, name: 'MCAT::Bio' }],
  notes: [
    { id: 10, guid: 'g1', mid: 1, flds: ['front side', 'back side'], tags: 'tagA tagB', sfld: 'front side' },
    { id: 20, guid: 'g2', mid: 2, flds: ['{{c1::aaa}}'], sfld: 'aaa' }
  ],
  cards: [{ id: 1, nid: 10, did: 2, ord: 0 }, { id: 2, nid: 20, did: 1, ord: 0 }]
}

let path: string
beforeEach(() => { path = join(tmpdir(), `fc-pm-${randomUUID()}.anki21b`) })
afterEach(() => { try { rmSync(path, { force: true }) } catch { /* ignore */ } })

describe('parseModernCollection', () => {
  it('decodes note-type config (kind, css), template config (qfmt/afmt), fields, decks, notes, cards', async () => {
    await writeModernCollection(path, spec)
    const parsed = await parseModernCollection(path)

    const basic = parsed.noteTypes.find((n) => n.name === 'Basic')
    const cloze = parsed.noteTypes.find((n) => n.name === 'Cloze')
    expect(basic?.kind).toBe('standard')
    expect(basic?.css).toBe('.card{color:red}')
    expect(basic?.templates[0]?.qfmt).toBe('{{Front}}')
    expect(basic?.templates[0]?.afmt).toBe('{{FrontSide}}<hr>{{Back}}')
    expect(basic?.fields.map((f) => f.name)).toEqual(['Front', 'Back'])
    expect(cloze?.kind).toBe('cloze')

    // \x1f deck separator normalized to ::
    expect(parsed.decks.find((d) => d.ankiId === 2)?.name).toBe('MCAT::Bio')

    const note = parsed.notes.find((n) => n.ankiId === 10)
    expect(note?.fields).toEqual(['front side', 'back side'])
    expect(note?.tags).toEqual(['tagA', 'tagB'])
    expect(note?.noteTypeAnkiId).toBe(1)
    expect(parsed.cards).toHaveLength(2)
    expect(parsed.cards.find((c) => c.noteAnkiId === 10)?.deckAnkiId).toBe(2)
  })

  it('rejects a collection that exceeds the row cap', async () => {
    await writeModernCollection(path, spec) // 2 notes
    await expect(parseModernCollection(path, { maxRows: 1, maxFieldBytes: 1_000_000 })).rejects.toBeInstanceOf(ImportTooLargeError)
  })

  it('enforces the field cap in BYTES, not characters (multibyte field over the byte cap is rejected)', async () => {
    // 'é' is 1 character but 2 UTF-8 bytes. 5 of them = 5 chars / 10 bytes.
    await writeModernCollection(path, {
      ...spec,
      notes: [{ id: 30, guid: 'g3', mid: 1, flds: ['ééééé', ''], sfld: 'ééééé' }],
      cards: [{ id: 3, nid: 30, did: 1, ord: 0 }]
    })
    // char count (5) is under the cap but byte count (10) is over → must reject on bytes.
    await expect(parseModernCollection(path, { maxRows: 1000, maxFieldBytes: 8 })).rejects.toBeInstanceOf(ImportTooLargeError)
    // and a byte cap above the real byte length passes.
    await expect(parseModernCollection(path, { maxRows: 1000, maxFieldBytes: 64 })).resolves.toBeTruthy()
  })

  it('rejects a collection whose TOTAL field bytes exceed the aggregate budget (each field small)', async () => {
    await writeModernCollection(path, spec) // 2 small notes; each field is well under maxFieldBytes
    // Aggregate cap below the summed field bytes → reject, even though no single field is over the cap.
    await expect(parseModernCollection(path, { maxTotalFieldBytes: 5 })).rejects.toBeInstanceOf(ImportTooLargeError)
    // A generous aggregate cap passes.
    await expect(parseModernCollection(path, { maxTotalFieldBytes: 10_000_000 })).resolves.toBeTruthy()
  })
})

describe('openCollectionReadOnly', () => {
  it('allows reads but rejects writes against an untrusted collection file (OS-enforced read-only)', async () => {
    const p = join(tmpdir(), `fc-ro-${randomUUID()}.anki2`)
    const w = createClient({ url: `file:${p}` })
    await w.execute('CREATE TABLE t (x INTEGER)')
    await w.execute('INSERT INTO t (x) VALUES (1)')
    w.close()

    const ro = openCollectionReadOnly(p)
    try {
      expect((await ro.execute('SELECT x FROM t')).rows).toHaveLength(1)
      await expect(ro.execute('INSERT INTO t (x) VALUES (2)')).rejects.toThrow(/READONLY/i)
    } finally {
      ro.close()
      rmSync(p, { force: true })
    }
  })
})
