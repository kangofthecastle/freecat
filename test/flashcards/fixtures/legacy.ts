import { createClient } from '@libsql/client'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'

export interface LegacyModel { id: number; name: string; type: 0 | 1; css: string; flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number; qfmt: string; afmt: string }[] }
export interface LegacyDeck { id: number; name: string }
export interface LegacyNote { id: number; guid: string; mid: number; flds: string[]; tags?: string }
export interface LegacyCard { id: number; nid: number; did: number; ord: number }
export interface LegacySpec { models: LegacyModel[]; decks: LegacyDeck[]; notes: LegacyNote[]; cards: LegacyCard[] }

const SEP = '' // Anki field separator (0x1F)

/** Write a minimal but schema-faithful legacy collection.anki2 (ver=11, JSON models/decks in `col`). */
export async function writeLegacyCollection(path: string, spec: LegacySpec): Promise<void> {
  const client = createClient({ url: `file:${path}` })
  try {
    await client.execute('CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text)')
    await client.execute('CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text)')
    await client.execute('CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text)')
    const models = Object.fromEntries(spec.models.map((m) => [String(m.id), m]))
    const decks = Object.fromEntries(spec.decks.map((d) => [String(d.id), d]))
    await client.execute({ sql: 'INSERT INTO col VALUES (1,0,0,0,11,0,0,0,?,?,?,?,?)', args: ['{}', JSON.stringify(models), JSON.stringify(decks), '{}', '{}'] })
    for (const n of spec.notes) {
      await client.execute({ sql: 'INSERT INTO notes (id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data) VALUES (?,?,?,0,0,?,?,?,0,0,?)', args: [n.id, n.guid, n.mid, n.tags ?? '', n.flds.join(SEP), n.flds[0] ?? '', ''] })
    }
    for (const c of spec.cards) {
      await client.execute({ sql: 'INSERT INTO cards (id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data) VALUES (?,?,?,?,0,0,0,0,0,0,0,0,0,0,0,0,0,?)', args: [c.id, c.nid, c.did, c.ord, ''] })
    }
  } finally {
    client.close()
  }
}

/** Build a full legacy .apkg (zip of collection.anki2 + a `media` JSON map + numbered media blobs). */
export async function buildLegacyApkg(spec: LegacySpec, mediaFiles: Record<string, Uint8Array> = {}): Promise<Uint8Array> {
  const tmp = join(tmpdir(), `fc-build-${randomUUID()}.anki2`)
  await writeLegacyCollection(tmp, spec)
  let collection: Uint8Array
  try { collection = new Uint8Array(readFileSync(tmp)) } finally { rmSync(tmp, { force: true }) }
  const entries: Record<string, Uint8Array> = { 'collection.anki2': collection }
  const mediaMap: Record<string, string> = {}
  Object.entries(mediaFiles).forEach(([name, bytes], i) => { mediaMap[String(i)] = name; entries[String(i)] = bytes })
  entries['media'] = strToU8(JSON.stringify(mediaMap))
  return zipSync(entries)
}
