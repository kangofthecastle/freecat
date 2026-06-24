// test/flashcards/parse-modern.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { writeModernCollection, type ModernSpec } from './fixtures/modern'
import { parseModernCollection } from '../../src/main/flashcards/parse-modern'
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
})
