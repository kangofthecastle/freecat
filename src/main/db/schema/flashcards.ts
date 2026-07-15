import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core'
import type { RenderKind, NoteTypeKind, SourceFormat } from '../../../shared/flashcards/types'

// One row per import — the independent "deck set" unit (no dedup across imports in M1).
export const deckSets = sqliteTable('deck_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceFilename: text('source_filename').notNull(),
  sourceFormat: text('source_format').$type<SourceFormat>().notNull(),
  importedAt: integer('imported_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})

export const decks = sqliteTable('decks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  ankiDeckId: integer('anki_deck_id').notNull(),        // preserved, unread in M1
  name: text('name').notNull(),                          // full '::'-joined Anki deck name
  parentDeckId: integer('parent_deck_id')                // nullable; tree resolved in the repo (not a self-FK)
}, (t) => [index('decks_deck_set_idx').on(t.deckSetId), index('decks_parent_idx').on(t.parentDeckId)])

export const noteTypes = sqliteTable('note_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  ankiNotetypeId: integer('anki_notetype_id').notNull(), // preserved
  name: text('name').notNull(),
  kind: text('kind').$type<NoteTypeKind>().notNull(),
  css: text('css').notNull().default(''),                // verbatim, full fidelity
  renderKind: text('render_kind').$type<RenderKind>().notNull()
}, (t) => [index('note_types_deck_set_idx').on(t.deckSetId)])

export const noteTypeFields = sqliteTable('note_type_fields', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  noteTypeId: integer('note_type_id').notNull().references(() => noteTypes.id, { onDelete: 'cascade' }),
  ord: integer('ord').notNull(),
  name: text('name').notNull()
}, (t) => [index('note_type_fields_nt_ord_idx').on(t.noteTypeId, t.ord)])

export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  noteTypeId: integer('note_type_id').notNull().references(() => noteTypes.id, { onDelete: 'cascade' }),
  ord: integer('ord').notNull(),
  name: text('name').notNull(),
  qfmt: text('qfmt').notNull(),                           // verbatim (conditionals preserved)
  afmt: text('afmt').notNull()
}, (t) => [index('templates_nt_ord_idx').on(t.noteTypeId, t.ord)])

export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  noteTypeId: integer('note_type_id').notNull().references(() => noteTypes.id, { onDelete: 'cascade' }),
  ankiGuid: text('anki_guid').notNull(),                  // preserved (future re-import matching)
  fieldsJson: text('fields_json', { mode: 'json' }).$type<string[]>().notNull(), // split on 0x1F
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  sortField: text('sort_field').notNull().default('')
}, (t) => [index('notes_deck_set_idx').on(t.deckSetId), index('notes_note_type_idx').on(t.noteTypeId)])

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  noteId: integer('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  templateOrd: integer('template_ord').notNull(),         // Anki cards.ord (cloze: ordinal − 1)
  renderKind: text('render_kind').$type<RenderKind>().notNull(), // denormalized from note_types for fast browse
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, (t) => [index('cards_deck_browse_idx').on(t.deckId, t.id), index('cards_deck_set_idx').on(t.deckSetId)])

// Original Anki media filename → content hash; lets Plan 2 serve a card's <img src> via freecat-media://.
export const media = sqliteTable('media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),  // as referenced inside card HTML
  hash: text('hash').notNull(),          // sha1 of bytes → on-disk file is <hash><ext>
  ext: text('ext').notNull().default('')
}, (t) => [index('media_deck_set_filename_idx').on(t.deckSetId, t.filename)])

// ── FSRS scheduling (M2) ──
// 1:1 with cards, created LAZILY on first review. The ABSENCE of a row IS the card's 'new' state —
// there is no backfill at import or migration (charter §"never a re-migration"), so `new` costs
// nothing to store and import stays untouched. Every column below mirrors a ts-fsrs `Card` field
// except `introducedDay` (daily new-limit accounting) and the denormalized deck ids (queue queries).
export const cardScheduling = sqliteTable('card_scheduling', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().unique().references(() => cards.id, { onDelete: 'cascade' }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }), // denormalized for queue queries
  state: integer('state').notNull(),            // ts-fsrs State enum (1 Learning, 2 Review, 3 Relearning; 0 New never persisted)
  due: integer('due', { mode: 'timestamp' }).notNull(),
  stability: real('stability').notNull(),
  difficulty: real('difficulty').notNull(),
  elapsedDays: integer('elapsed_days').notNull(),
  scheduledDays: integer('scheduled_days').notNull(),
  learningSteps: integer('learning_steps').notNull().default(0), // ts-fsrs Card.learning_steps
  reps: integer('reps').notNull(),
  lapses: integer('lapses').notNull(),
  lastReviewAt: integer('last_review_at', { mode: 'timestamp' }),
  introducedDay: text('introduced_day').notNull() // dayKey when the card left 'new' (daily new-limit accounting)
}, (t) => [
  index('card_scheduling_deck_due_idx').on(t.deckId, t.state, t.due),
  index('card_scheduling_deck_set_idx').on(t.deckSetId)
])

// Append-only review history (stats now; undo/export/revlog-merge later). One row per applied rating.
export const reviewLog = sqliteTable('review_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),          // 1 Again · 2 Hard · 3 Good · 4 Easy
  stateBefore: integer('state_before').notNull(),
  dueAfter: integer('due_after', { mode: 'timestamp' }).notNull(),
  stabilityAfter: real('stability_after').notNull(),
  difficultyAfter: real('difficulty_after').notNull(),
  elapsedDays: integer('elapsed_days').notNull(),
  scheduledDays: integer('scheduled_days').notNull(),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull()
}, (t) => [
  index('review_log_card_idx').on(t.cardId, t.reviewedAt),
  index('review_log_deck_set_idx').on(t.deckSetId)
])

export type DeckSetRow = typeof deckSets.$inferSelect
export type DeckRow = typeof decks.$inferSelect
export type NoteTypeRow = typeof noteTypes.$inferSelect
export type TemplateRow = typeof templates.$inferSelect
export type NoteRow = typeof notes.$inferSelect
export type CardRow = typeof cards.$inferSelect
export type MediaRow = typeof media.$inferSelect
export type CardSchedulingRow = typeof cardScheduling.$inferSelect
export type ReviewLogRow = typeof reviewLog.$inferSelect
