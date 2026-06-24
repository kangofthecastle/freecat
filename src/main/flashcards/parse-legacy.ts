import { createClient } from '@libsql/client'
import type { ParsedCollection, ParsedNoteType, ParsedDeck, ParsedNote, ParsedCard } from './parsed-collection'

interface RawModel { id: number | string; name: string; type: number; css?: string; flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number; qfmt: string; afmt: string }[] }
interface RawDeck { id: number | string; name: string }

const SEP = ''

/** Read a legacy collection.anki2 (raw libsql, NOT drizzle) into a ParsedCollection. */
export async function parseLegacyCollection(collectionPath: string): Promise<ParsedCollection> {
  const client = createClient({ url: `file:${collectionPath}` })
  try {
    const colRes = await client.execute('SELECT models, decks FROM col LIMIT 1')
    const col = colRes.rows[0]
    if (!col) throw new Error('empty col table')
    const models = JSON.parse(String(col.models)) as Record<string, RawModel>
    const decksRaw = JSON.parse(String(col.decks)) as Record<string, RawDeck>

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
