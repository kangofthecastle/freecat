// test/flashcards/fixtures/modern.ts
import { createClient } from '@libsql/client'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { zipSync } from 'fflate'
import { NotetypeConfig, TemplateConfig, MediaEntries } from '../../../src/main/flashcards/anki-proto'

export interface ModernNoteType { id: number; name: string; kind: 'standard' | 'cloze'; css: string; fields: { ord: number; name: string }[]; templates: { ord: number; name: string; qfmt: string; afmt: string }[] }
export interface ModernDeck { id: number; name: string } // human '::' name; stored with \x1f
export interface ModernNote { id: number; guid: string; mid: number; flds: string[]; tags?: string; sfld?: string }
export interface ModernCard { id: number; nid: number; did: number; ord: number }
export interface ModernSpec { noteTypes: ModernNoteType[]; decks: ModernDeck[]; notes: ModernNote[]; cards: ModernCard[] }

const SEP = '\x1f' // 0x1F unit separator

/** Write a minimal schema-18 collection (notetypes/fields/templates/decks/notes/cards with protobuf config blobs). */
export async function writeModernCollection(path: string, spec: ModernSpec): Promise<void> {
  const client = createClient({ url: `file:${path}` })
  try {
    await client.execute('CREATE TABLE notetypes (id integer PRIMARY KEY, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL)')
    await client.execute('CREATE TABLE fields (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) WITHOUT ROWID')
    await client.execute('CREATE TABLE templates (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) WITHOUT ROWID')
    await client.execute('CREATE TABLE decks (id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, common blob NOT NULL, kind blob NOT NULL)')
    await client.execute('CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL)')
    await client.execute('CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL)')

    const empty = new Uint8Array()
    for (const nt of spec.noteTypes) {
      const config = NotetypeConfig.encode({ kind: nt.kind === 'cloze' ? 1 : 0, css: nt.css }).finish()
      await client.execute({ sql: 'INSERT INTO notetypes (id,name,mtime_secs,usn,config) VALUES (?,?,0,0,?)', args: [nt.id, nt.name, config] })
      for (const f of nt.fields) {
        await client.execute({ sql: 'INSERT INTO fields (ntid,ord,name,config) VALUES (?,?,?,?)', args: [nt.id, f.ord, f.name, empty] })
      }
      for (const t of nt.templates) {
        const tcfg = TemplateConfig.encode({ q_format: t.qfmt, a_format: t.afmt }).finish()
        await client.execute({ sql: 'INSERT INTO templates (ntid,ord,name,mtime_secs,usn,config) VALUES (?,?,?,0,0,?)', args: [nt.id, t.ord, t.name, tcfg] })
      }
    }
    for (const d of spec.decks) {
      await client.execute({ sql: 'INSERT INTO decks (id,name,mtime_secs,usn,common,kind) VALUES (?,?,0,0,?,?)', args: [d.id, d.name.replace(/::/g, SEP), empty, empty] })
    }
    for (const n of spec.notes) {
      await client.execute({ sql: 'INSERT INTO notes (id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data) VALUES (?,?,?,0,0,?,?,?,0,0,?)', args: [n.id, n.guid, n.mid, n.tags ?? '', n.flds.join(SEP), n.sfld ?? n.flds[0] ?? '', ''] })
    }
    for (const c of spec.cards) {
      await client.execute({ sql: 'INSERT INTO cards (id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data) VALUES (?,?,?,?,0,0,0,0,0,0,0,0,0,0,0,0,0,?)', args: [c.id, c.nid, c.did, c.ord, ''] })
    }
  } finally {
    client.close()
  }
}

/** Build a modern .apkg/.colpkg: zstd collection.anki21b + zstd protobuf `media` manifest + raw numbered blobs. */
export async function buildModernApkg(spec: ModernSpec, mediaFiles: Record<string, Uint8Array> = {}): Promise<Uint8Array> {
  const tmp = join(tmpdir(), `fc-modern-${randomUUID()}.anki21b`)
  await writeModernCollection(tmp, spec)
  let collection: Uint8Array
  try { collection = new Uint8Array(readFileSync(tmp)) } finally { rmSync(tmp, { force: true }) }

  // Store members uncompressed (level 0) to mirror real Anki packages, which zip with
  // CompressionMethod::Stored — the zstd/protobuf payloads are the only compression.
  const STORED = { level: 0 } as const
  const members: Record<string, [Uint8Array, typeof STORED]> = {
    'collection.anki21b': [new Uint8Array(zstdCompressSync(collection)), STORED]
  }
  const entries: { name: string }[] = []
  Object.entries(mediaFiles).forEach(([name, bytes], i) => { entries.push({ name }); members[String(i)] = [bytes, STORED] })
  const manifest = MediaEntries.encode({ entries }).finish()
  members['media'] = [new Uint8Array(zstdCompressSync(manifest)), STORED]
  return zipSync(members)
}
