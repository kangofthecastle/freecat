import { eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { deckSets, decks, noteTypes, noteTypeFields, templates, notes, cards, media } from '../db/schema'
import type { ParsedCollection } from './parsed-collection'
import type { SourceFormat, RenderKind } from '../../shared/flashcards/types'
import type { DeckSetSummary } from '../../shared/dto'
import { classifyNoteType } from './classify'

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

    // Note types (classified) + their fields + templates.
    const ntIdByAnki = new Map<number, number>()
    const renderKindByNtAnki = new Map<number, RenderKind>()
    for (const nt of parsed.noteTypes) {
      const renderKind = classifyNoteType(nt)
      const [row] = await tx.insert(noteTypes).values({ deckSetId: ds.id, ankiNotetypeId: nt.ankiId, name: nt.name, kind: nt.kind, css: nt.css, renderKind }).returning()
      if (!row) throw new Error('note type insert failed')
      ntIdByAnki.set(nt.ankiId, row.id)
      renderKindByNtAnki.set(nt.ankiId, renderKind)
      for (const f of nt.fields) await tx.insert(noteTypeFields).values({ noteTypeId: row.id, ord: f.ord, name: f.name })
      for (const t of nt.templates) await tx.insert(templates).values({ noteTypeId: row.id, ord: t.ord, name: t.name, qfmt: t.qfmt, afmt: t.afmt })
    }

    // Notes.
    const noteIdByAnki = new Map<number, number>()
    const renderKindByNoteAnki = new Map<number, RenderKind>()
    for (const n of parsed.notes) {
      const noteTypeId = ntIdByAnki.get(n.noteTypeAnkiId)
      const rk = renderKindByNtAnki.get(n.noteTypeAnkiId)
      if (noteTypeId === undefined || rk === undefined) continue // note → missing note type: skip
      const [row] = await tx.insert(notes).values({ deckSetId: ds.id, noteTypeId, ankiGuid: n.guid, fieldsJson: n.fields, tags: n.tags, sortField: n.sortField }).returning()
      if (!row) throw new Error('note insert failed')
      noteIdByAnki.set(n.ankiId, row.id)
      renderKindByNoteAnki.set(n.ankiId, rk)
    }

    // Cards — one row per ParsedCard.
    let cardCount = 0
    for (const c of parsed.cards) {
      const noteId = noteIdByAnki.get(c.noteAnkiId)
      const deckId = deckIdByAnki.get(c.deckAnkiId)
      const renderKind = renderKindByNoteAnki.get(c.noteAnkiId)
      if (noteId === undefined || deckId === undefined || renderKind === undefined) continue // dangling card: skip
      await tx.insert(cards).values({ deckSetId: ds.id, noteId, deckId, templateOrd: c.ord, renderKind })
      cardCount++
    }

    // Media filename → hash map (bytes already written to disk by the orchestrator's storeMedia).
    for (const [filename, m] of Object.entries(input.media ?? {})) {
      await tx.insert(media).values({ deckSetId: ds.id, filename, hash: m.hash, ext: m.ext })
    }

    return { id: ds.id, sourceFilename, deckCount: parsed.decks.length, cardCount, importedAt: ds.importedAt }
  })
}
