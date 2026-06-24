import { eq, and, gt, asc, inArray, sql } from 'drizzle-orm'
import type { DB } from '../db/client'
import { deckSets, decks, noteTypes, noteTypeFields, templates, notes, cards, media } from '../db/schema'
import type { DeckSetSummary, DeckNode, ListCardsInput, CardListPage, CardListItem, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import type { RenderKind } from '../../shared/flashcards/types'

export async function listDeckSets(db: DB): Promise<DeckSetSummary[]> {
  const sets = await db.select().from(deckSets)
  const out: DeckSetSummary[] = []
  for (const ds of sets) {
    const [dc] = await db.select({ n: sql<number>`count(*)` }).from(decks).where(eq(decks.deckSetId, ds.id))
    const [cc] = await db.select({ n: sql<number>`count(*)` }).from(cards).where(eq(cards.deckSetId, ds.id))
    out.push({ id: ds.id, sourceFilename: ds.sourceFilename, deckCount: dc?.n ?? 0, cardCount: cc?.n ?? 0, importedAt: ds.importedAt })
  }
  return out
}

export async function listDecks(db: DB, deckSetId: number): Promise<DeckNode[]> {
  const rows = await db.select().from(decks).where(eq(decks.deckSetId, deckSetId))
  const counts = await db
    .select({ deckId: cards.deckId, n: sql<number>`count(*)` })
    .from(cards).where(eq(cards.deckSetId, deckSetId)).groupBy(cards.deckId)
  const countByDeck = new Map(counts.map((c) => [c.deckId, c.n]))
  const nodeById = new Map<number, DeckNode>()
  for (const d of rows) {
    nodeById.set(d.id, { deckId: d.id, name: d.name, leafName: d.name.split('::').pop() ?? d.name, cardCount: countByDeck.get(d.id) ?? 0, children: [] })
  }
  const roots: DeckNode[] = []
  for (const d of rows) {
    const node = nodeById.get(d.id)
    if (!node) continue
    const parent = d.parentDeckId != null ? nodeById.get(d.parentDeckId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

function preview(sortField: string): string {
  const text = sortField.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 100 ? `${text.slice(0, 100)}…` : text
}

export async function listCards(db: DB, input: ListCardsInput): Promise<CardListPage> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const after = input.afterId ?? 0
  const rows = await db
    .select({ cardId: cards.id, renderKind: cards.renderKind, sortField: notes.sortField })
    .from(cards)
    .innerJoin(notes, eq(cards.noteId, notes.id))
    .where(and(eq(cards.deckId, input.deckId), gt(cards.id, after)))
    .orderBy(asc(cards.id))
    .limit(limit + 1)
  const pageRows = rows.slice(0, limit)
  const items: CardListItem[] = pageRows.map((r) => ({ cardId: r.cardId, renderKind: r.renderKind, preview: preview(r.sortField) }))
  const last = pageRows[pageRows.length - 1]
  const nextAfterId = rows.length > limit && last ? last.cardId : null
  return { cards: items, nextAfterId }
}

export async function deleteDeckSet(db: DB, deckSetId: number): Promise<ServiceResult<null>> {
  const [existing] = await db.select({ id: deckSets.id }).from(deckSets).where(eq(deckSets.id, deckSetId))
  if (!existing) return err('deck-set-not-found')
  await db.transaction(async (tx) => {
    const nts = await tx.select({ id: noteTypes.id }).from(noteTypes).where(eq(noteTypes.deckSetId, deckSetId))
    const ntIds = nts.map((n) => n.id)
    await tx.delete(cards).where(eq(cards.deckSetId, deckSetId))
    await tx.delete(notes).where(eq(notes.deckSetId, deckSetId))
    await tx.delete(media).where(eq(media.deckSetId, deckSetId))
    if (ntIds.length) {
      await tx.delete(templates).where(inArray(templates.noteTypeId, ntIds))
      await tx.delete(noteTypeFields).where(inArray(noteTypeFields.noteTypeId, ntIds))
    }
    await tx.delete(noteTypes).where(eq(noteTypes.deckSetId, deckSetId))
    await tx.delete(decks).where(eq(decks.deckSetId, deckSetId))
    await tx.delete(deckSets).where(eq(deckSets.id, deckSetId))
  })
  return ok(null)
}

export interface CardSource {
  cardId: number
  deckSetId: number
  renderKind: RenderKind
  css: string
  qfmt: string
  afmt: string
  fields: { name: string; value: string }[]
  tags: string[]
  noteTypeName: string
  deckName: string
  subdeckName: string
  templateName: string
  clozeOrdinal: number | null
  media: { filename: string; hash: string; ext: string }[]
}

// Filenames referenced from card content: <img src="…">, [sound:…], and CSS url(…).
const MEDIA_REF_RE = /(?:\bsrc\s*=\s*["']([^"']+)["'])|(?:\[sound:([^\]]+)\])|(?:url\(\s*["']?([^"')]+)["']?\s*\))/gi

function referencedFilenames(parts: string[]): string[] {
  const hay = parts.join('\n')
  const found = new Set<string>()
  MEDIA_REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MEDIA_REF_RE.exec(hay)) !== null) {
    const name = m[1] ?? m[2] ?? m[3]
    if (name) found.add(name.trim())
  }
  return [...found]
}

export async function getCard(db: DB, cardId: number): Promise<ServiceResult<CardSource>> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId))
  if (!card) return err('card-not-found')
  const [note] = await db.select().from(notes).where(eq(notes.id, card.noteId))
  if (!note) return err('card-not-found')
  const [nt] = await db.select().from(noteTypes).where(eq(noteTypes.id, note.noteTypeId))
  if (!nt) return err('card-not-found')
  const [deck] = await db.select().from(decks).where(eq(decks.id, card.deckId))
  const deckName = deck?.name ?? ''

  const fieldDefs = await db.select().from(noteTypeFields)
    .where(eq(noteTypeFields.noteTypeId, nt.id)).orderBy(asc(noteTypeFields.ord))
  const tmpls = await db.select().from(templates)
    .where(eq(templates.noteTypeId, nt.id)).orderBy(asc(templates.ord))

  // Cloze note types have one template (ord 0); card.templateOrd encodes the cloze ordinal − 1.
  // Standard note types: card.templateOrd selects the template directly.
  const isCloze = nt.kind === 'cloze'
  const wantOrd = isCloze ? 0 : card.templateOrd
  const tmpl = tmpls.find((t) => t.ord === wantOrd) ?? tmpls[0]
  const clozeOrdinal = isCloze ? card.templateOrd + 1 : null

  const values = note.fieldsJson
  const fields = fieldDefs.map((f, i) => ({ name: f.name, value: values[i] ?? '' }))

  const refs = referencedFilenames([...values, tmpl?.qfmt ?? '', tmpl?.afmt ?? '', nt.css])
  let mediaRows: { filename: string; hash: string; ext: string }[] = []
  if (refs.length > 0) {
    mediaRows = await db.select({ filename: media.filename, hash: media.hash, ext: media.ext })
      .from(media).where(and(eq(media.deckSetId, card.deckSetId), inArray(media.filename, refs)))
  }

  return ok({
    cardId: card.id,
    deckSetId: card.deckSetId,
    renderKind: card.renderKind,
    css: nt.css,
    qfmt: tmpl?.qfmt ?? '',
    afmt: tmpl?.afmt ?? '',
    fields,
    tags: note.tags,
    noteTypeName: nt.name,
    deckName,
    subdeckName: deckName.split('::').pop() ?? deckName,
    templateName: tmpl?.name ?? '',
    clozeOrdinal,
    media: mediaRows
  })
}
