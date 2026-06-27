// test/flashcards/import.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'

// Mock electron's dialog so importViaDialog is unit-testable in a node environment. showOpenDialog
// is overridden per-test below.
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({ dialog: { showOpenDialog: () => showOpenDialog() } }))

import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { buildLegacyApkg, type LegacySpec } from './fixtures/legacy'
import { importFromFile, importViaDialog, removeTempCollection } from '../../src/main/flashcards/import'
import { cards, media } from '../../src/main/db/schema'

const MAX_PER_MEMBER = 2 * 1024 * 1024 * 1024 // mirror zip.ts cap

// A minimal valid legacy spec for crafting corrupt/oversized variants around it.
const minimalSpec: LegacySpec = {
  models: [{ id: 100, name: 'Basic', type: 0, css: '', flds: [{ name: 'Front', ord: 0 }], tmpls: [{ name: 'C', ord: 0, qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
  decks: [{ id: 1, name: 'Default' }],
  notes: [{ id: 10, guid: 'g', mid: 100, flds: ['F'] }],
  cards: [{ id: 1, nid: 10, did: 1, ord: 0 }]
}

/** Patch a member's central-directory uncompressedSize so assertWithinCaps sees an oversized member
 *  WITHOUT materializing 2 GiB — the cap check reads central-dir sizes only (no inflation). */
function forgeOversizedMember(zip: Uint8Array, member: string, size: number): Uint8Array {
  const buf = new Uint8Array(zip)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break } }
  if (eocd < 0) throw new Error('no eocd')
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen))
    if (name === member) dv.setUint32(off + 24, size >>> 0, true) // uncompressedSize (low 32 bits)
    off += 46 + nameLen + extraLen + commentLen
  }
  return buf
}

let db: DB, dir: string
beforeEach(async () => { db = await createTestDb(); dir = join(tmpdir(), `fc-imp-${randomUUID()}`); mkdirSync(dir, { recursive: true }) })
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('importFromFile (legacy .apkg, end-to-end)', () => {
  it('imports a synthetic .apkg into rows + media files', async () => {
    const apkg = await buildLegacyApkg(
      {
        models: [{ id: 100, name: 'Basic', type: 0, css: '', flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }], tmpls: [{ name: 'C', ord: 0, qfmt: '{{Front}}<img src="pic.png">', afmt: '{{Back}}' }] }],
        decks: [{ id: 1, name: 'Default' }],
        notes: [{ id: 10, guid: 'g', mid: 100, flds: ['F', 'B'] }],
        cards: [{ id: 1, nid: 10, did: 1, ord: 0 }]
      },
      { 'pic.png': strToU8('PNGBYTES') }
    )
    const file = join(dir, 'deck.apkg'); writeFileSync(file, apkg)

    const res = await importFromFile(db, file, join(dir, 'media'))
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.cardCount).toBe(1)
    expect(res.data.sourceFilename).toBe('deck.apkg')
    expect(await db.select().from(cards)).toHaveLength(1)
    expect((await db.select().from(media))[0]?.filename).toBe('pic.png')
    expect(readdirSync(join(dir, 'media'))).toHaveLength(1)
  })

  it('rejects a non-Anki zip as unsupported-format', async () => {
    const file = join(dir, 'x.apkg'); writeFileSync(file, zipSync({ 'random.txt': strToU8('hi') }))
    expect(await importFromFile(db, file, join(dir, 'media'))).toEqual({ ok: false, error: 'unsupported-format' })
  })

  it('maps an Anki zip whose central directory advertises an oversized member to import-too-large', async () => {
    const apkg = await buildLegacyApkg(minimalSpec)
    const forged = forgeOversizedMember(apkg, 'collection.anki2', MAX_PER_MEMBER + 1)
    const file = join(dir, 'big.apkg'); writeFileSync(file, forged)
    expect(await importFromFile(db, file, join(dir, 'media'))).toEqual({ ok: false, error: 'import-too-large' })
  })

  it('rejects an archive larger than the on-disk size ceiling before reading it into memory', async () => {
    const apkg = await buildLegacyApkg(minimalSpec)
    const file = join(dir, 'oversized.apkg'); writeFileSync(file, apkg)
    // A ceiling one byte below the real file size must reject on the stat() precheck — before readFile.
    const res = await importFromFile(db, file, join(dir, 'media'), { maxArchiveBytes: apkg.length - 1 })
    expect(res).toEqual({ ok: false, error: 'import-too-large' })
  })

  it('imports a file exactly at the size ceiling (strict >, no off-by-one)', async () => {
    const apkg = await buildLegacyApkg(minimalSpec)
    const file = join(dir, 'atcap.apkg'); writeFileSync(file, apkg)
    const res = await importFromFile(db, file, join(dir, 'media'), { maxArchiveBytes: apkg.length })
    expect(res.ok).toBe(true)
  })

  it('maps an Anki-shaped zip with a garbage collection member to corrupt-package', async () => {
    // Valid container (detect → legacy1), but collection.anki2 is not a SQLite db → libsql open/parse fails.
    const file = join(dir, 'bad.apkg'); writeFileSync(file, zipSync({ 'collection.anki2': strToU8('NOT A SQLITE DB'), 'media': strToU8('{}') }))
    expect(await importFromFile(db, file, join(dir, 'media'))).toEqual({ ok: false, error: 'corrupt-package' })
  })

  it('maps truncated/garbage bytes (no zip central directory) to corrupt-package', async () => {
    const file = join(dir, 'garbage.apkg'); writeFileSync(file, strToU8('not a zip at all'))
    expect(await importFromFile(db, file, join(dir, 'media'))).toEqual({ ok: false, error: 'corrupt-package' })
  })

  it('imports without media when the legacy media map is malformed JSON (does not fail the deck)', async () => {
    const apkg = await buildLegacyApkg(minimalSpec, { 'pic.png': strToU8('PNG') })
    const { unzipSync } = await import('fflate')
    const members = unzipSync(apkg)
    members['media'] = strToU8('{not valid json') // replace the valid map with garbage
    const file = join(dir, 'badmedia.apkg'); writeFileSync(file, zipSync(members))
    const res = await importFromFile(db, file, join(dir, 'media'))
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.cardCount).toBe(1)
    expect(await db.select().from(media)).toHaveLength(0) // bad map → import without media
  })

  it('rejects a legacy media JSON map larger than the manifest cap as import-too-large', async () => {
    // The legacy 'media' map is otherwise bounded only by the 2 GiB per-member ZIP cap; a multi-GB map
    // would force a huge UTF-8 decode + JSON.parse. The cap mirrors the modern manifest bound (64 MiB).
    const MAX_ZSTD_MANIFEST = 64 * 1024 * 1024
    const apkg = await buildLegacyApkg(minimalSpec, { 'pic.png': strToU8('PNG') })
    const { unzipSync } = await import('fflate')
    const members = unzipSync(apkg)
    // A syntactically-irrelevant blob just over the cap (parse is never reached — the size guard fires first).
    members['media'] = new Uint8Array(MAX_ZSTD_MANIFEST + 1).fill(0x20)
    const file = join(dir, 'hugemedia.apkg'); writeFileSync(file, zipSync(members))
    expect(await importFromFile(db, file, join(dir, 'media'))).toEqual({ ok: false, error: 'import-too-large' })
  })

  it('accepts a legacy media JSON map exactly at the manifest cap (strict >, no off-by-one)', async () => {
    // Boundary: a map of EXACTLY the cap must NOT be rejected by the size guard (it uses strict >).
    const MAX_ZSTD_MANIFEST = 64 * 1024 * 1024
    const apkg = await buildLegacyApkg(minimalSpec, { 'pic.png': strToU8('PNG') })
    const { unzipSync } = await import('fflate')
    const members = unzipSync(apkg)
    // Valid JSON map padded with whitespace to land exactly on the cap; JSON.parse ignores the padding.
    const head = JSON.stringify({ '0': 'pic.png' })
    const pad = ' '.repeat(MAX_ZSTD_MANIFEST - head.length)
    members['media'] = strToU8(head + pad)
    expect(strToU8(head + pad).length).toBe(MAX_ZSTD_MANIFEST)
    const file = join(dir, 'capmedia.apkg'); writeFileSync(file, zipSync(members))
    const res = await importFromFile(db, file, join(dir, 'media'))
    expect(res.ok).toBe(true) // at-cap map is accepted, parsed, and the one blob stored
    if (!res.ok) throw new Error(res.error)
    expect((await db.select().from(media)).map((r) => r.filename)).toEqual(['pic.png'])
  })

  it('silently drops a legacy media entry whose numbered blob is absent', async () => {
    // media map names two files but only blob "0" exists; "1" → missing.png must be dropped.
    const apkg = await buildLegacyApkg(minimalSpec, { 'pic.png': strToU8('PNG') })
    const { unzipSync } = await import('fflate')
    const members = unzipSync(apkg)
    members['media'] = strToU8(JSON.stringify({ '0': 'pic.png', '1': 'missing.png' }))
    const file = join(dir, 'gapmedia.apkg'); writeFileSync(file, zipSync(members))
    const res = await importFromFile(db, file, join(dir, 'media'))
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    const rows = await db.select().from(media)
    expect(rows.map((r) => r.filename)).toEqual(['pic.png']) // missing.png dropped
  })
})

describe('importViaDialog (envelope around the open dialog)', () => {
  beforeEach(() => { showOpenDialog.mockReset() })

  it('resolves to err(invalid) when the dialog is canceled (never throws)', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(importViaDialog(db, join(dir, 'media'))).resolves.toEqual({ ok: false, error: 'invalid' })
  })

  it('resolves to err(invalid) when showOpenDialog REJECTS (does not reject to the renderer)', async () => {
    showOpenDialog.mockRejectedValue(new Error('window destroyed mid-dialog'))
    // Must resolve to a ServiceResult, not reject — the importDeck channel never throws (design spec).
    await expect(importViaDialog(db, join(dir, 'media'))).resolves.toEqual({ ok: false, error: 'invalid' })
  })
})

describe('removeTempCollection', () => {
  it('deletes the collection temp file and its -wal/-shm sidecars (read-only WAL leaves these behind)', async () => {
    const base = join(dir, `c-${randomUUID()}.anki2`)
    for (const p of [base, `${base}-wal`, `${base}-shm`]) writeFileSync(p, strToU8('x'))
    await removeTempCollection(base)
    for (const p of [base, `${base}-wal`, `${base}-shm`]) expect(existsSync(p)).toBe(false)
  })

  it('does not throw when the sidecars are absent (rollback-journal collection)', async () => {
    const base = join(dir, `c-${randomUUID()}.anki2`)
    writeFileSync(base, strToU8('x')) // main file only, no sidecars
    await expect(removeTempCollection(base)).resolves.toBeUndefined()
    expect(existsSync(base)).toBe(false)
  })
})
