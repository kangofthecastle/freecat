import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { deckSets, decks, noteTypes, noteTypeFields, templates, notes, cards, media } from '../db/schema'
import type { ParsedCollection } from './parsed-collection'
import type { SourceFormat, RenderKind } from '../../shared/flashcards/types'
import type { DeckSetSummary } from '../../shared/dto'
import { classifyNoteType } from './classify'

// Multi-row insert chunk. Widest row is 6 columns → 500 rows = 3000 bound variables, well under
// modern SQLite's 32766 limit; turns a 35k-card deck's ~70k statements into ~150.
const INSERT_CHUNK = 500

function* chunkBy<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size)
}

export async function writeCollection(
  db: DB,
  input: { sourceFilename: string; sourceFormat: SourceFormat; parsed: ParsedCollection; media?: Record<string, { hash: string; ext: string }> }
): Promise<DeckSetSummary> {
  const { sourceFilename, sourceFormat, parsed } = input
  return db.transaction(async (tx) => {
    const [ds] = await tx.insert(deckSets).values({ sourceFilename, sourceFormat }).returning()
    if (!ds) throw new Error('deck set insert failed')

    // Decks — insert, then link parents by '::' name.
    const deckIdByAnki = new Map<number, number>()
    const deckIdByName = new Map<string, number>()
    for (const d of parsed.decks) {
      const [row] = await tx.insert(decks).values({ deckSetId: ds.id, ankiDeckId: d.ankiId, name: d.name, parentDeckId: null }).returning()
      if (!row) throw new Error('deck insert failed')
      deckIdByAnki.set(d.ankiId, row.id)
      deckIdByName.set(d.name, row.id)
    }
    for (const d of parsed.decks) {
      if (!d.name.includes('::')) continue
      const selfId = deckIdByName.get(d.name)
      const parentId = deckIdByName.get(d.name.split('::').slice(0, -1).join('::'))
      if (selfId && parentId) await tx.update(decks).set({ parentDeckId: parentId }).where(eq(decks.id, selfId))
    }

    // Note types (classified) — chunked insert with .returning(). Map anki id → db id by the natural
    // key (ankiNotetypeId) returned alongside the new id, NOT by positional index: SQLite documents
    // RETURNING row order as undefined, so a positional zip could silently mislink every note type.
    const ntIdByAnki = new Map<number, number>()
    const renderKindByNtAnki = new Map<number, RenderKind>()
    const ntValues = parsed.noteTypes.map((nt) => {
      const renderKind = classifyNoteType(nt)
      renderKindByNtAnki.set(nt.ankiId, renderKind)
      return { deckSetId: ds.id, ankiNotetypeId: nt.ankiId, name: nt.name, kind: nt.kind, css: nt.css, renderKind }
    })
    const ntRows: { id: number; ankiNotetypeId: number }[] = []
    for (const chunk of chunkBy(ntValues, INSERT_CHUNK)) ntRows.push(...await tx.insert(noteTypes).values(chunk).returning({ id: noteTypes.id, ankiNotetypeId: noteTypes.ankiNotetypeId }))
    if (ntRows.length !== parsed.noteTypes.length) throw new Error('note type insert failed')
    for (const row of ntRows) ntIdByAnki.set(row.ankiNotetypeId, row.id)

    const fieldValues = parsed.noteTypes.flatMap((nt) => {
      const ntId = ntIdByAnki.get(nt.ankiId)
      return ntId === undefined ? [] : nt.fields.map((f) => ({ noteTypeId: ntId, ord: f.ord, name: f.name }))
    })
    for (const chunk of chunkBy(fieldValues, INSERT_CHUNK)) await tx.insert(noteTypeFields).values(chunk)
    const templateValues = parsed.noteTypes.flatMap((nt) => {
      const ntId = ntIdByAnki.get(nt.ankiId)
      return ntId === undefined ? [] : nt.templates.map((t) => ({ noteTypeId: ntId, ord: t.ord, name: t.name, qfmt: t.qfmt, afmt: t.afmt }))
    })
    for (const chunk of chunkBy(templateValues, INSERT_CHUNK)) await tx.insert(templates).values(chunk)

    // Notes — keep only those whose note type resolved, chunk-insert with .returning(). Recover the
    // new ids POSITIONALLY: within a single multi-row `INSERT ... VALUES (...),(...) RETURNING`, libsql
    // returns rows in VALUES order, so we zip each chunk's returned rows to that chunk's input rows by
    // index. We deliberately do NOT key recovery on guid: guid is user-controlled and not UNIQUE here,
    // so a collection with two notes sharing a guid (corrupt/hand-merged .apkg) would otherwise collapse
    // both to one db id, silently mis-linking the second note's cards to the first note's row.
    const noteIdByAnki = new Map<number, number>()
    const renderKindByNoteAnki = new Map<number, RenderKind>()
    const kept = parsed.notes.flatMap((n) => {
      const noteTypeId = ntIdByAnki.get(n.noteTypeAnkiId)
      const rk = renderKindByNtAnki.get(n.noteTypeAnkiId)
      if (noteTypeId === undefined || rk === undefined) return [] // note → missing note type: skip
      return [{ ankiId: n.ankiId, rk, values: { deckSetId: ds.id, noteTypeId, ankiGuid: n.guid, fieldsJson: n.fields, tags: n.tags, sortField: n.sortField } }]
    })
    let keptIdx = 0
    for (const chunk of chunkBy(kept, INSERT_CHUNK)) {
      const rows = await tx.insert(notes).values(chunk.map((k) => k.values)).returning({ id: notes.id })
      if (rows.length !== chunk.length) throw new Error('note insert failed')
      for (let i = 0; i < chunk.length; i++) {
        const k = chunk[i]
        const row = rows[i]
        if (k === undefined || row === undefined) throw new Error('note insert failed')
        noteIdByAnki.set(k.ankiId, row.id)
        renderKindByNoteAnki.set(k.ankiId, k.rk)
        keptIdx++
      }
    }
    if (keptIdx !== kept.length) throw new Error('note insert failed')

    // Cards — one row per ParsedCard; drop dangling cards, then bulk-insert (no returned ids needed).
    const cardValues = parsed.cards.flatMap((c) => {
      const noteId = noteIdByAnki.get(c.noteAnkiId)
      const deckId = deckIdByAnki.get(c.deckAnkiId)
      const renderKind = renderKindByNoteAnki.get(c.noteAnkiId)
      if (noteId === undefined || deckId === undefined || renderKind === undefined) return [] // dangling card: skip
      return [{ deckSetId: ds.id, noteId, deckId, templateOrd: c.ord, renderKind }]
    })
    for (const chunk of chunkBy(cardValues, INSERT_CHUNK)) await tx.insert(cards).values(chunk)
    const cardCount = cardValues.length

    // Media filename → hash map (bytes already written to disk by the orchestrator's storeMedia).
    const mediaValues = Object.entries(input.media ?? {}).map(([filename, m]) => ({ deckSetId: ds.id, filename, hash: m.hash, ext: m.ext }))
    for (const chunk of chunkBy(mediaValues, INSERT_CHUNK)) await tx.insert(media).values(chunk)

    return { id: ds.id, sourceFilename, deckCount: parsed.decks.length, cardCount, importedAt: ds.importedAt }
  })
}
