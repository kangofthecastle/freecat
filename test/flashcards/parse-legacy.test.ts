import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'; import { rmSync } from 'node:fs'
import { writeLegacyCollection } from './fixtures/legacy'
import { parseLegacyCollection } from '../../src/main/flashcards/parse-legacy'

let path: string
beforeEach(() => { path = join(tmpdir(), `fc-parse-${randomUUID()}.db`) })
afterEach(() => { try { rmSync(path) } catch { /* ignore */ } })

describe('parseLegacyCollection', () => {
  it('parses note types (cloze kind), decks, notes (0x1F split + tags), and cards', async () => {
    await writeLegacyCollection(path, {
      models: [
        { id: 100, name: 'Basic', type: 0, css: '.card{}', flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }] },
        { id: 200, name: 'Cloze', type: 1, css: '', flds: [{ name: 'Text', ord: 0 }], tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }
      ],
      decks: [{ id: 1, name: 'Default' }, { id: 2, name: 'MCAT::Bio' }],
      notes: [
        { id: 10, guid: 'g1', mid: 100, flds: ['Hello', 'World'], tags: ' a b ' },
        { id: 11, guid: 'g2', mid: 200, flds: ['{{c1::x}} {{c2::y}}'] }
      ],
      cards: [{ id: 1, nid: 10, did: 2, ord: 0 }, { id: 2, nid: 11, did: 2, ord: 0 }, { id: 3, nid: 11, did: 2, ord: 1 }]
    })
    const pc = await parseLegacyCollection(path)
    expect(pc.noteTypes.find((n) => n.ankiId === 200)?.kind).toBe('cloze')
    expect(pc.noteTypes.find((n) => n.ankiId === 100)?.fields.map((f) => f.name)).toEqual(['Front', 'Back'])
    const note = pc.notes.find((n) => n.ankiId === 10)
    expect(note?.fields).toEqual(['Hello', 'World'])
    expect(note?.tags).toEqual(['a', 'b'])
    expect(pc.cards).toHaveLength(3)
    expect(pc.decks.map((d) => d.name).sort()).toEqual(['Default', 'MCAT::Bio'])
  })
})
