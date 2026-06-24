// test/flashcards/modern-fixture.smoke.test.ts
import { describe, it, expect } from 'vitest'
import { decompress } from 'fzstd'
import { readCentralDirectory } from '../../src/main/flashcards/central-dir'
import { extractMembers } from '../../src/main/flashcards/zip'
import { buildModernApkg } from './fixtures/modern'

describe('buildModernApkg', () => {
  it('produces a zip with a zstd collection.anki21b, a media manifest, and numbered blobs', async () => {
    const apkg = await buildModernApkg(
      {
        noteTypes: [{ id: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
        decks: [{ id: 1, name: 'D' }],
        notes: [{ id: 10, guid: 'g', mid: 1, flds: ['F'] }],
        cards: [{ id: 1, nid: 10, did: 1, ord: 0 }]
      },
      { 'pic.png': new TextEncoder().encode('PNGBYTES') }
    )
    const names = readCentralDirectory(apkg).map((e) => e.name).sort()
    expect(names).toContain('collection.anki21b')
    expect(names).toContain('media')
    expect(names).toContain('0') // first media blob
    // The collection member is a zstd stream that decodes to a SQLite file ("SQLite format 3\0").
    const members = extractMembers(apkg, (n) => n === 'collection.anki21b')
    const sqlite = decompress(members['collection.anki21b']!)
    expect(new TextDecoder().decode(sqlite.subarray(0, 15))).toBe('SQLite format 3')
  })
})
