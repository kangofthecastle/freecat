import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, and, gt, asc, inArray, sql } from 'drizzle-orm'
import type { DB } from '../db/client'
import { deckSets, decks, noteTypes, noteTypeFields, templates, notes, cards, media, cardScheduling, reviewLog } from '../db/schema'
import type { DeckSetSummary, DeckNode, ListCardsInput, CardListPage, CardListItem, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import type { RenderKind } from '../../shared/flashcards/types'
import { decodeHtmlEntities } from '../../shared/flashcards/render'
import { renderClozeField } from '../../shared/flashcards/cloze'

export async function listDeckSets(db: DB): Promise<DeckSetSummary[]> {
  const sets = await db.select().from(deckSets)
  // Two grouped aggregates instead of 2 counts per set (was 1 + 2N queries).
  const deckCounts = await db.select({ id: decks.deckSetId, n: sql<number>`count(*)` }).from(decks).groupBy(decks.deckSetId)
  const cardCounts = await db.select({ id: cards.deckSetId, n: sql<number>`count(*)` }).from(cards).groupBy(cards.deckSetId)
  const deckCountBySet = new Map(deckCounts.map((r) => [r.id, r.n]))
  const cardCountBySet = new Map(cardCounts.map((r) => [r.id, r.n]))
  return sets.map((ds) => ({
    id: ds.id,
    sourceFilename: ds.sourceFilename,
    deckCount: deckCountBySet.get(ds.id) ?? 0,
    cardCount: cardCountBySet.get(ds.id) ?? 0,
    importedAt: ds.importedAt
  }))
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
  // Reduce cloze syntax to just the answer ({{c1::mitochondria::hint}} → mitochondria) so the browse
  // list shows readable text for cloze note types (whose sort field is the raw cloze markup). Use the
  // balanced-brace cloze parser with a sentinel ordinal (0 — no real cloze uses c0) so EVERY deletion
  // renders inactive (answer only, hint dropped); a naive `{{c…::…}}` regex leaves residue like
  // `{{c2}}` on nested clozes ({{c1::outer {{c2::inner}}}}). HTML tags from the parser's spans are
  // stripped below.
  const text = renderClozeField(sortField, 0, 'answer')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Truncate on code points, not UTF-16 units — String.slice can split a surrogate pair
  // (e.g. an emoji at the boundary) and paint a replacement character before the ellipsis.
  const points = [...text]
  return points.length > 100 ? `${points.slice(0, 100).join('')}…` : text
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

// Same shape media-protocol enforces at serve time: only a lowercase-hex hash and a plain dotted
// extension may participate in an on-disk path (a poisoned row must never become a traversal).
const FILE_HASH_RE = /^[0-9a-f]+$/
const FILE_EXT_RE = /^(\.[0-9a-z]+)?$/

/** Unlink the deleted set's media blobs, keeping any blob still referenced by a remaining media row
 *  (blobs are content-hash deduped across deck sets). Best-effort: a failed unlink is ignored. */
async function removeOrphanedMediaFiles(
  db: DB,
  mediaDir: string,
  candidates: { hash: string; ext: string }[]
): Promise<void> {
  const remaining = await db.selectDistinct({ hash: media.hash, ext: media.ext }).from(media)
  const alive = new Set(remaining.map((r) => `${r.hash}${r.ext.toLowerCase()}`))
  await Promise.all(candidates.map(async (c) => {
    const ext = c.ext.toLowerCase()
    if (!FILE_HASH_RE.test(c.hash) || !FILE_EXT_RE.test(ext)) return
    const name = `${c.hash}${ext}`
    if (alive.has(name)) return
    await unlink(join(mediaDir, name)).catch(() => { /* already gone / locked — leave it */ })
  }))
}

export async function deleteDeckSet(db: DB, deckSetId: number, mediaDir?: string): Promise<ServiceResult<null>> {
  const [existing] = await db.select({ id: deckSets.id }).from(deckSets).where(eq(deckSets.id, deckSetId))
  if (!existing) return err('deck-set-not-found')
  // Snapshot this set's blob identities before the rows vanish; cleanup runs after the commit.
  const doomed = await db.selectDistinct({ hash: media.hash, ext: media.ext })
    .from(media).where(eq(media.deckSetId, deckSetId))
  await db.transaction(async (tx) => {
    const nts = await tx.select({ id: noteTypes.id }).from(noteTypes).where(eq(noteTypes.deckSetId, deckSetId))
    const ntIds = nts.map((n) => n.id)
    // Scheduling + review history first — same explicit-delete pattern; both cascade from `cards`
    // anyway, but we delete them up front so the invariant "no orphan scheduling/log rows" holds
    // regardless of PRAGMA foreign_keys, matching how the rest of this teardown is spelled out.
    await tx.delete(cardScheduling).where(eq(cardScheduling.deckSetId, deckSetId))
    await tx.delete(reviewLog).where(eq(reviewLog.deckSetId, deckSetId))
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
  // Disk cleanup is best-effort and post-commit: the rows are gone either way, and a leftover blob
  // is only wasted space (it can never be served — no media row authorizes it anymore).
  if (mediaDir !== undefined && doomed.length > 0) {
    try { await removeOrphanedMediaFiles(db, mediaDir, doomed) } catch { /* keep the delete's success */ }
  }
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
// `src` requires a PRECEDING WHITESPACE (`\ssrc`), mirroring rewriteMedia's `(\ssrc…)` rewrite
// pattern so the scan and the iframe rewriter agree on whitespace-anchored `src` within a field
// (and `data-src`/`*-src` are not treated as references). (M3)
// Caveat: this scan joins parts with `\n` (below), so a `src` that *begins* a non-first part is
// preceded by that synthetic separator and IS authorized here, even though rewriteMedia — which
// runs per-field — would not rewrite an offset-0 `src`. That is a benign over-authorization: the
// media row is still gated at serve time by deckSet + filename + content-hash + MIME, and such an
// <img> wouldn't render either way. It never under-authorizes (every `src` the rewriter rewrites
// is whitespace-preceded in the haystack too), so no real reference is missed.
const MEDIA_REF_RE = /(?:\ssrc\s*=\s*["']([^"']+)["'])|(?:\[sound:([^\]]+)\])|(?:url\(\s*["']?([^"')]+)["']?\s*\))/gi
// srcset="a.png 1x, b.png 2x" — captured whole, then split into candidate URLs below.
const SRCSET_REF_RE = /\bsrcset\s*=\s*["']([^"']+)["']/gi

// HTML-entity-decode the captured attribute value before lookup so it matches the decoded
// `media.filename` stored at import (e.g. `a&amp;b.png` → `a&b.png`). MUST mirror rewriteMedia's
// decode so the authorization scan and the iframe rewriter agree on the referenced filename.
export function referencedFilenames(parts: string[]): string[] {
  const hay = parts.join('\n')
  const found = new Set<string>()
  MEDIA_REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MEDIA_REF_RE.exec(hay)) !== null) {
    const name = m[1] ?? m[2] ?? m[3]
    if (name) found.add(decodeHtmlEntities(name.trim()))
  }
  SRCSET_REF_RE.lastIndex = 0
  while ((m = SRCSET_REF_RE.exec(hay)) !== null) {
    const list = m[1]
    if (!list) continue
    for (const part of list.split(',')) {
      const seg = part.trim()
      if (!seg) continue
      const sp = seg.indexOf(' ')
      const candidate = (sp === -1 ? seg : seg.slice(0, sp)).trim()
      if (candidate) found.add(decodeHtmlEntities(candidate))
    }
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
