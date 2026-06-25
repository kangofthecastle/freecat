import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core'
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

export type DeckSetRow = typeof deckSets.$inferSelect
export type DeckRow = typeof decks.$inferSelect
export type NoteTypeRow = typeof noteTypes.$inferSelect
export type TemplateRow = typeof templates.$inferSelect
export type NoteRow = typeof notes.$inferSelect
export type CardRow = typeof cards.$inferSelect
export type MediaRow = typeof media.$inferSelect
