// src/main/flashcards/parse-modern.ts
import { createClient } from '@libsql/client'
import type { ParsedCollection, ParsedNoteType, ParsedDeck, ParsedNote, ParsedCard, ParsedField, ParsedTemplate } from './parsed-collection'
import { NotetypeConfig, TemplateConfig } from './anki-proto'
import { ImportTooLargeError } from './zip'

export interface ModernLimits { maxRows: number; maxFieldBytes: number }
export const DEFAULT_MODERN_LIMITS: ModernLimits = { maxRows: 500_000, maxFieldBytes: 25 * 1024 * 1024 }

const SEP = '\x1f' // 0x1F

/** @libsql returns BLOB columns as ArrayBuffer (or Uint8Array) — normalize for protobuf decode. */
function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  return new Uint8Array(0)
}

/** Read a schema-18 collection (raw libsql) into the shared ParsedCollection. */
export async function parseModernCollection(path: string, limits: ModernLimits = DEFAULT_MODERN_LIMITS): Promise<ParsedCollection> {
  const client = createClient({ url: `file:${path}` })
  try {
    // Amplification guards before building DTOs.
    const noteCount = Number((await client.execute('SELECT COUNT(*) AS n FROM notes')).rows[0]?.n ?? 0)
    const cardCount = Number((await client.execute('SELECT COUNT(*) AS n FROM cards')).rows[0]?.n ?? 0)
    if (noteCount > limits.maxRows || cardCount > limits.maxRows) throw new ImportTooLargeError('too many rows')
    const maxFld = Number((await client.execute('SELECT COALESCE(MAX(LENGTH(flds)), 0) AS n FROM notes')).rows[0]?.n ?? 0)
    if (maxFld > limits.maxFieldBytes) throw new ImportTooLargeError('field too large')

    const fieldsByNt = new Map<number, ParsedField[]>()
    for (const r of (await client.execute('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')).rows) {
      const ntid = Number(r.ntid)
      const list = fieldsByNt.get(ntid) ?? []
      list.push({ ord: Number(r.ord), name: String(r.name) })
      fieldsByNt.set(ntid, list)
    }
    const tmplsByNt = new Map<number, ParsedTemplate[]>()
    for (const r of (await client.execute('SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')).rows) {
      const ntid = Number(r.ntid)
      const cfg = TemplateConfig.decode(toBytes(r.config)) as unknown as { q_format?: string; a_format?: string }
      const list = tmplsByNt.get(ntid) ?? []
      list.push({ ord: Number(r.ord), name: String(r.name), qfmt: cfg.q_format ?? '', afmt: cfg.a_format ?? '' })
      tmplsByNt.set(ntid, list)
    }
    const noteTypes: ParsedNoteType[] = (await client.execute('SELECT id, name, config FROM notetypes')).rows.map((r) => {
      const id = Number(r.id)
      const cfg = NotetypeConfig.decode(toBytes(r.config)) as unknown as { kind?: number; css?: string }
      return {
        ankiId: id,
        name: String(r.name),
        kind: cfg.kind === 1 ? 'cloze' : 'standard',
        css: cfg.css ?? '',
        fields: fieldsByNt.get(id) ?? [],
        templates: tmplsByNt.get(id) ?? []
      }
    })

    const decks: ParsedDeck[] = (await client.execute('SELECT id, name FROM decks')).rows.map((r) => ({
      ankiId: Number(r.id),
      name: String(r.name).split(SEP).join('::')
    }))

    const notes: ParsedNote[] = (await client.execute('SELECT id, guid, mid, flds, sfld, tags FROM notes')).rows.map((r) => ({
      ankiId: Number(r.id),
      guid: String(r.guid),
      noteTypeAnkiId: Number(r.mid),
      fields: String(r.flds ?? '').split(SEP),
      tags: String(r.tags ?? '').trim().split(/\s+/).filter(Boolean),
      sortField: String(r.sfld ?? '')
    }))

    const cards: ParsedCard[] = (await client.execute('SELECT nid, did, ord FROM cards')).rows.map((r) => ({
      noteAnkiId: Number(r.nid),
      deckAnkiId: Number(r.did),
      ord: Number(r.ord)
    }))

    return { noteTypes, decks, notes, cards }
  } finally {
    client.close()
  }
}
