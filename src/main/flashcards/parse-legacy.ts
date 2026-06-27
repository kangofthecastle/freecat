import type { ParsedCollection, ParsedNoteType, ParsedDeck, ParsedNote, ParsedCard } from './parsed-collection'
import { assertCollectionWithinLimits, DEFAULT_LIMITS, openCollectionReadOnly, type CollectionLimits } from './parse-modern'
import { ImportTooLargeError } from './zip'

interface RawModel { id: number | string; name: string; type: number; css?: string; flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number; qfmt: string; afmt: string }[] }
interface RawDeck { id: number | string; name: string }

const SEP = ''

/** Read a legacy collection.anki2 (raw libsql, NOT drizzle) into a ParsedCollection. */
export async function parseLegacyCollection(collectionPath: string, limits: Partial<CollectionLimits> = {}): Promise<ParsedCollection> {
  const lim = { ...DEFAULT_LIMITS, ...limits }
  const client = openCollectionReadOnly(collectionPath)
  try {
    // Same amplification guards the modern parser runs (design spec): a legacy collection.anki2 is
    // raw SQLite bounded only by the 2 GiB per-member ZIP cap, so reject row/field bombs before
    // materializing every notes/cards row. Note types + decks live in the single col.models/col.decks
    // JSON blobs (not row-per-entity tables), so we bound the blob byte size before JSON.parse and the
    // entity count after — keeping the legacy path under the same maxFieldBytes/maxRows budget.
    await assertCollectionWithinLimits(client, lim, ['notes', 'cards'])

    const colRes = await client.execute('SELECT models, decks FROM col LIMIT 1')
    const col = colRes.rows[0]
    if (!col) throw new Error('empty col table')
    const modelsJson = String(col.models)
    const decksJson = String(col.decks)
    const byteLen = (s: string): number => new TextEncoder().encode(s).length
    if (byteLen(modelsJson) > lim.maxFieldBytes || byteLen(decksJson) > lim.maxFieldBytes) {
      throw new ImportTooLargeError('models/decks blob too large')
    }
    const models = JSON.parse(modelsJson) as Record<string, RawModel>
    const decksRaw = JSON.parse(decksJson) as Record<string, RawDeck>
    if (Object.keys(models).length > lim.maxRows || Object.keys(decksRaw).length > lim.maxRows) {
      throw new ImportTooLargeError('too many note types/decks')
    }

    const noteTypes: ParsedNoteType[] = Object.values(models).map((m) => ({
      ankiId: Number(m.id),
      name: m.name,
      kind: m.type === 1 ? 'cloze' : 'standard',
      css: m.css ?? '',
      fields: m.flds.map((f) => ({ ord: f.ord, name: f.name })),
      templates: m.tmpls.map((t) => ({ ord: t.ord, name: t.name, qfmt: t.qfmt, afmt: t.afmt }))
    }))
    const decks: ParsedDeck[] = Object.values(decksRaw).map((d) => ({ ankiId: Number(d.id), name: d.name }))

    const notesRes = await client.execute('SELECT id, guid, mid, flds, sfld, tags FROM notes')
    const notes: ParsedNote[] = notesRes.rows.map((r) => ({
      ankiId: Number(r.id),
      guid: String(r.guid),
      noteTypeAnkiId: Number(r.mid),
      fields: String(r.flds ?? '').split(SEP),
      tags: String(r.tags ?? '').trim().split(/\s+/).filter(Boolean),
      sortField: String(r.sfld ?? '')
    }))

    const cardsRes = await client.execute('SELECT nid, did, ord FROM cards')
    const cards: ParsedCard[] = cardsRes.rows.map((r) => ({ noteAnkiId: Number(r.nid), deckAnkiId: Number(r.did), ord: Number(r.ord) }))

    return { noteTypes, decks, notes, cards }
  } finally {
    client.close()
  }
}
