# FreeCAT Flashcards — Milestone 1, Plan 3 (Modern `.colpkg` reader) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Standing constraint for this repo: every code-writing subagent runs Opus 4.8 at max effort.**

**Goal:** Import the **modern** Anki package format (`collection.anki21b`, "schema 18", `VERSION_LATEST`) — zstd-compressed SQLite + protobuf-config note types + protobuf media manifest — into the exact same normalized Drizzle tables as the legacy path, behind the existing `ParsedCollection` seam, so browse/render (Plans 1+2) work on modern decks with **zero** schema, IPC, repository, or renderer changes.

**Architecture:** Detection already routes `collection.anki21b` to `format: 'latest'` (Plan 1's `detect.ts`, member-name based). This plan adds three pure-ish MAIN modules — a minimal vendored protobuf (`anki-proto.ts`), a capped zstd decompressor (`zstd.ts`, built on `fzstd`), and a modern collection parser (`parse-modern.ts`) — plus modern media-manifest resolution, then flips `import.ts`'s `latest → unsupported` stub into a real branch that reuses the legacy ETL/store/transaction unchanged.

**Tech Stack:** `fzstd` (zstd decompress-only, streaming, runtime dep) · `protobufjs` (decode the `config` blobs + media manifest, runtime dep) · `@libsql/client` raw reads (same as legacy) · `node:zlib` `zstdCompressSync` (test fixtures only — Node ≥ 22.15; the dev toolchain is Node 24) · Vitest.

**Source of truth:** the M1 design spec `docs/superpowers/specs/2026-06-23-flashcards-m1-design.md` (C1 detection/ETL, "Suggested build sequence" step 7, Library choices, Security, O2). All format specifics below were verified against Anki's `ankitects/anki` source (rslib proto + storage SQL); see the "Pre-resolved decisions" for the points where verification **corrected** the spec.

---

## Pre-resolved decisions (verified against Anki source; intentional, not drift)

1. **Detection stays member-name based — no `meta`/`PackageMetadata` parsing.** `collection.anki21b` present ⟹ `VERSION_LATEST` ⟹ zstd-compressed collection (Anki's `meta.rs`: `zstd_compressed() == !is_legacy()`). Plan 1's `detect.ts` already returns `{format:'latest', collectionMember:'collection.anki21b'}`; we keep it and do **not** decode the `meta` member. (The spec's "meta-first precedence" is a benign superset it already flagged as optional.)
2. **Modern media blobs are NOT individually zstd-compressed** — only the *collection* and the *media manifest* members are zstd; the numbered blob members (`0`,`1`,…) are stored raw. **This corrects the spec's build-sequence step 7** ("streaming zstd media blobs"). We zstd-decode only `collection.anki21b` and `media`.
3. **`css`/kind live in `notetypes.config`; `qfmt`/`afmt` in `templates.config`** (both prost-encoded `Config` sub-messages); field & template `name`/`ord` are plain SQL columns. We vendor a **minimal 3-message proto** (`NotetypeConfig{kind=1,css=3}`, `TemplateConfig{q_format=1,a_format=2}`, `MediaEntries{repeated MediaEntry{name=1} entries=1}`) — protobuf ignores the dozens of fields we don't read.
4. **`decks.name` uses the `\x1f` (U+001F) component separator** → normalize to `::`. The deck `kind` (normal vs filtered/dynamic) is a protobuf blob we **do not decode**: every deck is imported by name. Filtered-deck *semantics* are out of module scope, but treating a filtered deck as a plain named deck is correct for browse and avoids dropping its cards. (Drops the `Deck`/`DeckKind` proto entirely.)
5. **Cloze `ord = clozeNumber − 1`** (Anki `cardgen.rs`) — identical to legacy, so `classify.ts`, the cloze-ordinal logic in `getCard`, and the engine all work unchanged on modern decks.
6. **Fixtures compress with `node:zlib.zstdCompressSync`** (built-in on the Node 24 toolchain), not a wasm devDep. This is O2's intent (dev-only compression; runtime stays decompress-only via `fzstd`) with zero new dependency. Fixtures require Node ≥ 22.15 (well within the dev/CI env); the packaged app never compresses.
7. **SQLite-amplification guards** (row-count + max-field-byte caps, injectable for tests) run in `parse-modern.ts` before building DTOs — the modern path is exactly where a crafted `.colpkg` could declare millions of rows.

**No schema/migration, IPC, repository, preload, or renderer changes.** `deck_sets.sourceFormat` already accepts `'latest'`; `writeCollection` (ETL) is reused verbatim.

---

## File Structure

**Created — MAIN:**
- `src/main/flashcards/anki-proto.ts` — inline minimal `.proto`, parsed once via `protobufjs` (`keepCase`), exports `NotetypeConfig` / `TemplateConfig` / `MediaEntries` types.
- `src/main/flashcards/zstd.ts` — `zstdDecompressCapped(input, cap)` (fzstd streaming + output-byte cap → `ImportTooLargeError`) + `MAX_ZSTD_COLLECTION` / `MAX_ZSTD_MANIFEST`.
- `src/main/flashcards/parse-modern.ts` — `parseModernCollection(path, limits?)` → `ParsedCollection`; `DEFAULT_MODERN_LIMITS`.
- `src/main/flashcards/modern-media.ts` — `parseModernMedia(members)` → `Record<filename, bytes>`.

**Created — tests:**
- `test/flashcards/fixtures/modern.ts` — `writeModernCollection(path, spec)` + `buildModernApkg(spec, mediaFiles)` (V18 tables, protobuf `config` blobs, `\x1f` deck/flds, zstd via `node:zlib`).
- `test/flashcards/anki-proto.test.ts`, `test/flashcards/zstd.test.ts`, `test/flashcards/parse-modern.test.ts`, `test/flashcards/modern-import.test.ts`.

**Modified:**
- `src/main/flashcards/import.ts` — replace the `latest → unsupported` line with the modern branch.
- `package.json` — add `fzstd` + `protobufjs` to `dependencies`.

---

## Task 1: Runtime dependencies (`fzstd`, `protobufjs`)

**Files:** Modify `package.json`.

`electron.vite.config.ts` externalizes the MAIN build, so both must be in **`dependencies`** (a `devDependency` would break the packaged main process). `node:zlib` (used only by test fixtures) is built-in — no dep.

- [ ] **Step 1: Install**

Run: `npm install fzstd@^0.1.1 protobufjs@^7.4.0`
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Verify they import + the toolchain has zstd compression for fixtures**

Run:
```bash
node -e "const f=require('fzstd'); const p=require('protobufjs'); const z=require('node:zlib'); if(typeof f.decompress!=='function'||typeof f.Decompress!=='function') throw new Error('fzstd API missing'); if(typeof p.parse!=='function') throw new Error('protobufjs parse missing'); if(typeof z.zstdCompressSync!=='function'||typeof z.zstdDecompressSync!=='function') throw new Error('node:zlib zstd missing (need Node >=22.15)'); console.log('deps OK')"
```
Expected: prints `deps OK`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(flashcards): add fzstd + protobufjs deps for modern .colpkg reader"
```

---

## Task 2: Vendored protobuf (`anki-proto.ts`)

**Files:** Create `src/main/flashcards/anki-proto.ts`; Test `test/flashcards/anki-proto.test.ts`.

The three `config`/manifest messages we decode, with the exact Anki field numbers. `keepCase: true` keeps proto field names (`q_format`, not `qFormat`) on decoded objects.

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/anki-proto.test.ts
import { describe, it, expect } from 'vitest'
import { NotetypeConfig, TemplateConfig, MediaEntries } from '../../src/main/flashcards/anki-proto'

describe('anki-proto', () => {
  it('round-trips NotetypeConfig (kind=1, css=3)', () => {
    const bytes = NotetypeConfig.encode({ kind: 1, css: '.card{color:red}' }).finish()
    const msg = NotetypeConfig.decode(bytes) as unknown as { kind: number; css: string }
    expect(msg.kind).toBe(1)
    expect(msg.css).toBe('.card{color:red}')
  })

  it('defaults kind to 0 and css to "" when absent (proto3)', () => {
    const msg = NotetypeConfig.decode(NotetypeConfig.encode({}).finish()) as unknown as { kind: number; css: string }
    expect(msg.kind).toBe(0)
    expect(msg.css).toBe('')
  })

  it('round-trips TemplateConfig (q_format=1, a_format=2)', () => {
    const bytes = TemplateConfig.encode({ q_format: '{{Front}}', a_format: '{{FrontSide}}{{Back}}' }).finish()
    const msg = TemplateConfig.decode(bytes) as unknown as { q_format: string; a_format: string }
    expect(msg.q_format).toBe('{{Front}}')
    expect(msg.a_format).toBe('{{FrontSide}}{{Back}}')
  })

  it('round-trips MediaEntries (repeated entry name)', () => {
    const bytes = MediaEntries.encode({ entries: [{ name: 'a.png' }, { name: 'b.jpg' }] }).finish()
    const msg = MediaEntries.decode(bytes) as unknown as { entries: { name: string }[] }
    expect(msg.entries.map((e) => e.name)).toEqual(['a.png', 'b.jpg'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/flashcards/anki-proto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `anki-proto.ts`**

```ts
// src/main/flashcards/anki-proto.ts
import protobuf from 'protobufjs'

// Minimal subset of Anki's schema-18 protobufs — only the fields we read. Field numbers
// match ankitects/anki: notetypes.proto (Notetype.Config kind=1, css=3),
// (Template.Config q_format=1, a_format=2) and import_export.proto (MediaEntries).
// Unknown fields on the wire are ignored by protobuf, so this stays tiny and forward-compatible.
const PROTO = `
syntax = "proto3";
package fc;
message NotetypeConfig { uint32 kind = 1; string css = 3; }
message TemplateConfig { string q_format = 1; string a_format = 2; }
message MediaEntries {
  message MediaEntry { string name = 1; }
  repeated MediaEntry entries = 1;
}
`

const root = protobuf.parse(PROTO, { keepCase: true }).root
export const NotetypeConfig = root.lookupType('fc.NotetypeConfig')
export const TemplateConfig = root.lookupType('fc.TemplateConfig')
export const MediaEntries = root.lookupType('fc.MediaEntries')
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `npx vitest run test/flashcards/anki-proto.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/flashcards/anki-proto.ts test/flashcards/anki-proto.test.ts
git commit -m "feat(flashcards): vendor minimal Anki protobuf (notetype/template config + media manifest)"
```

---

## Task 3: Capped zstd decompressor (`zstd.ts`)

**Files:** Create `src/main/flashcards/zstd.ts`; Test `test/flashcards/zstd.test.ts`.

Streams output via `fzstd.Decompress`, counting bytes and refusing to retain more than `cap` (a zstd-bomb defense: a small compressed member can expand enormously). Input is already ZIP-capped (`zip.ts` caps), so total work is bounded; the cap bounds memory. Reuses `ImportTooLargeError` from `zip.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/zstd.test.ts
import { describe, it, expect } from 'vitest'
import { zstdCompressSync } from 'node:zlib'
import { zstdDecompressCapped } from '../../src/main/flashcards/zstd'
import { ImportTooLargeError } from '../../src/main/flashcards/zip'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('zstdDecompressCapped', () => {
  it('round-trips data under the cap', () => {
    const original = bytes('hello '.repeat(1000))
    const compressed = new Uint8Array(zstdCompressSync(original))
    const out = zstdDecompressCapped(compressed, 1024 * 1024)
    expect(out).toEqual(original)
  })

  it('throws ImportTooLargeError when output exceeds the cap', () => {
    const original = bytes('x'.repeat(5000))
    const compressed = new Uint8Array(zstdCompressSync(original))
    expect(() => zstdDecompressCapped(compressed, 100)).toThrow(ImportTooLargeError)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/flashcards/zstd.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `zstd.ts`**

```ts
// src/main/flashcards/zstd.ts
import { Decompress } from 'fzstd'
import { ImportTooLargeError } from './zip'

export const MAX_ZSTD_COLLECTION = 2 * 1024 * 1024 * 1024 // 2 GiB decompressed SQLite
export const MAX_ZSTD_MANIFEST = 64 * 1024 * 1024          // 64 MiB media manifest

/**
 * Decompress a complete zstd buffer, refusing to retain more than `cap` output bytes.
 * fzstd has no abort signal, so we stop accumulating once the cap is passed and throw
 * after the push completes (input size is already bounded by the ZIP caps).
 */
export function zstdDecompressCapped(input: Uint8Array, cap: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  let exceeded = false
  const stream = new Decompress((chunk) => {
    if (exceeded) return
    if (total + chunk.length > cap) { exceeded = true; return }
    total += chunk.length
    chunks.push(chunk)
  })
  stream.push(input, true)
  if (exceeded) throw new ImportTooLargeError('zstd output exceeds cap')
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/flashcards/zstd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/flashcards/zstd.ts test/flashcards/zstd.test.ts
git commit -m "feat(flashcards): capped streaming zstd decompressor (fzstd + bomb guard)"
```

---

## Task 4: Modern fixture builder (`test/flashcards/fixtures/modern.ts`)

**Files:** Create `test/flashcards/fixtures/modern.ts`; Test `test/flashcards/fixtures/modern` is exercised by a smoke test added here and consumed by Tasks 5–6.

Builds a synthetic schema-18 SQLite collection (protobuf `config` blobs, `\x1f` deck/flds) and packages it as a modern `.apkg`/`.colpkg` (zstd collection + zstd protobuf media manifest + raw numbered blobs). Mirrors `fixtures/legacy.ts`. **Synthetic only — never a real/copyrighted deck.**

- [ ] **Step 1: Write the failing smoke test**

```ts
// test/flashcards/modern-fixture.smoke.test.ts
import { describe, it, expect } from 'vitest'
import { decompress } from 'fzstd'
import { readCentralDirectory } from '../../src/main/flashcards/central-dir'
import { extractMembers } from '../../src/main/flashcards/zip'
import { buildModernApkg } from './fixtures/modern'

describe('buildModernApkg', () => {
  it('produces a zip with a zstd collection.anki21b, a media manifest, and numbered blobs', async () => {
    const apkg = await buildModernApkg(
      {
        noteTypes: [{ id: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
        decks: [{ id: 1, name: 'D' }],
        notes: [{ id: 10, guid: 'g', mid: 1, flds: ['F'] }],
        cards: [{ id: 1, nid: 10, did: 1, ord: 0 }]
      },
      { 'pic.png': new TextEncoder().encode('PNGBYTES') }
    )
    const names = readCentralDirectory(apkg).map((e) => e.name).sort()
    expect(names).toContain('collection.anki21b')
    expect(names).toContain('media')
    expect(names).toContain('0') // first media blob
    // The collection member is a zstd stream that decodes to a SQLite file ("SQLite format 3\0").
    const members = extractMembers(apkg, (n) => n === 'collection.anki21b')
    const sqlite = decompress(members['collection.anki21b']!)
    expect(new TextDecoder().decode(sqlite.subarray(0, 15))).toBe('SQLite format 3')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/flashcards/modern-fixture.smoke.test.ts`
Expected: FAIL — `./fixtures/modern` not found.

- [ ] **Step 3: Implement `fixtures/modern.ts`**

```ts
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

const SEP = '' // 0x1F unit separator

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

  const members: Record<string, Uint8Array> = { 'collection.anki21b': new Uint8Array(zstdCompressSync(collection)) }
  const entries: { name: string }[] = []
  Object.entries(mediaFiles).forEach(([name, bytes], i) => { entries.push({ name }); members[String(i)] = bytes })
  const manifest = MediaEntries.encode({ entries }).finish()
  members['media'] = new Uint8Array(zstdCompressSync(manifest))
  return zipSync(members)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/flashcards/modern-fixture.smoke.test.ts && npx tsc --noEmit`
Expected: PASS (1 test); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add test/flashcards/fixtures/modern.ts test/flashcards/modern-fixture.smoke.test.ts
git commit -m "test(flashcards): synthetic modern .colpkg fixture builder (schema-18 + protobuf + zstd)"
```

---

## Task 5: Modern collection parser (`parse-modern.ts`)

**Files:** Create `src/main/flashcards/parse-modern.ts`; Test `test/flashcards/parse-modern.test.ts`.

Reads a decompressed schema-18 SQLite into the same `ParsedCollection` the legacy parser produces — decoding `notetypes.config` (kind, css) and `templates.config` (qfmt, afmt), converting `\x1f`→`::` deck names, splitting `flds` on `\x1f`, with injectable amplification caps.

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/parse-modern.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { writeModernCollection, type ModernSpec } from './fixtures/modern'
import { parseModernCollection } from '../../src/main/flashcards/parse-modern'
import { ImportTooLargeError } from '../../src/main/flashcards/zip'

const spec: ModernSpec = {
  noteTypes: [
    { id: 1, name: 'Basic', kind: 'standard', css: '.card{color:red}', fields: [{ ord: 0, name: 'Front' }, { ord: 1, name: 'Back' }], templates: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }] },
    { id: 2, name: 'Cloze', kind: 'cloze', css: '.cloze{font-weight:bold}', fields: [{ ord: 0, name: 'Text' }], templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}' }] }
  ],
  decks: [{ id: 1, name: 'MCAT' }, { id: 2, name: 'MCAT::Bio' }],
  notes: [
    { id: 10, guid: 'g1', mid: 1, flds: ['front side', 'back side'], tags: 'tagA tagB', sfld: 'front side' },
    { id: 20, guid: 'g2', mid: 2, flds: ['{{c1::aaa}}'], sfld: 'aaa' }
  ],
  cards: [{ id: 1, nid: 10, did: 2, ord: 0 }, { id: 2, nid: 20, did: 1, ord: 0 }]
}

let path: string
beforeEach(() => { path = join(tmpdir(), `fc-pm-${randomUUID()}.anki21b`) })
afterEach(() => { try { rmSync(path, { force: true }) } catch { /* ignore */ } })

describe('parseModernCollection', () => {
  it('decodes note-type config (kind, css), template config (qfmt/afmt), fields, decks, notes, cards', async () => {
    await writeModernCollection(path, spec)
    const parsed = await parseModernCollection(path)

    const basic = parsed.noteTypes.find((n) => n.name === 'Basic')
    const cloze = parsed.noteTypes.find((n) => n.name === 'Cloze')
    expect(basic?.kind).toBe('standard')
    expect(basic?.css).toBe('.card{color:red}')
    expect(basic?.templates[0]?.qfmt).toBe('{{Front}}')
    expect(basic?.templates[0]?.afmt).toBe('{{FrontSide}}<hr>{{Back}}')
    expect(basic?.fields.map((f) => f.name)).toEqual(['Front', 'Back'])
    expect(cloze?.kind).toBe('cloze')

    // \x1f deck separator normalized to ::
    expect(parsed.decks.find((d) => d.ankiId === 2)?.name).toBe('MCAT::Bio')

    const note = parsed.notes.find((n) => n.ankiId === 10)
    expect(note?.fields).toEqual(['front side', 'back side'])
    expect(note?.tags).toEqual(['tagA', 'tagB'])
    expect(note?.noteTypeAnkiId).toBe(1)
    expect(parsed.cards).toHaveLength(2)
    expect(parsed.cards.find((c) => c.noteAnkiId === 10)?.deckAnkiId).toBe(2)
  })

  it('rejects a collection that exceeds the row cap', async () => {
    await writeModernCollection(path, spec) // 2 notes
    await expect(parseModernCollection(path, { maxRows: 1, maxFieldBytes: 1_000_000 })).rejects.toBeInstanceOf(ImportTooLargeError)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/flashcards/parse-modern.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parse-modern.ts`**

```ts
// src/main/flashcards/parse-modern.ts
import { createClient } from '@libsql/client'
import type { ParsedCollection, ParsedNoteType, ParsedDeck, ParsedNote, ParsedCard, ParsedField, ParsedTemplate } from './parsed-collection'
import { NotetypeConfig, TemplateConfig } from './anki-proto'
import { ImportTooLargeError } from './zip'

export interface ModernLimits { maxRows: number; maxFieldBytes: number }
export const DEFAULT_MODERN_LIMITS: ModernLimits = { maxRows: 500_000, maxFieldBytes: 25 * 1024 * 1024 }

const SEP = '' // 0x1F

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
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `npx vitest run test/flashcards/parse-modern.test.ts && npx tsc --noEmit`
Expected: PASS (2 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/flashcards/parse-modern.ts test/flashcards/parse-modern.test.ts
git commit -m "feat(flashcards): schema-18 modern collection parser → ParsedCollection"
```

---

## Task 6: Modern media resolution + wire the modern import branch

**Files:** Create `src/main/flashcards/modern-media.ts`; Modify `src/main/flashcards/import.ts`; Test `test/flashcards/modern-import.test.ts`.

`modern-media.ts` turns the protobuf manifest + numbered blobs into the same `{filename → bytes}` map the legacy JSON path produces; `storeMedia` + `writeCollection` are then reused unchanged. `import.ts` gains a `latest` branch (zstd-decompress the collection, parse modern, resolve modern media) while the legacy path stays byte-for-byte identical.

- [ ] **Step 1: Write the failing integration test**

```ts
// test/flashcards/modern-import.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { buildModernApkg, type ModernSpec } from './fixtures/modern'
import { importFromFile } from '../../src/main/flashcards/import'
import { listDeckSets, listDecks, listCards, getCard } from '../../src/main/repositories/flashcards'
import { cards, media } from '../../src/main/db/schema'

const spec: ModernSpec = {
  noteTypes: [{ id: 1, name: 'Basic', kind: 'standard', css: '.card{color:blue}', fields: [{ ord: 0, name: 'Front' }, { ord: 1, name: 'Back' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}<img src="pic.png">', afmt: '{{Back}}' }] }],
  decks: [{ id: 1, name: 'Default' }, { id: 2, name: 'Default::Sub' }],
  notes: [{ id: 10, guid: 'g', mid: 1, flds: ['the front', 'the back'], sfld: 'the front' }],
  cards: [{ id: 1, nid: 10, did: 2, ord: 0 }]
}

let db: DB, dir: string
beforeEach(async () => { db = await createTestDb(); dir = join(tmpdir(), `fc-mimp-${randomUUID()}`); mkdirSync(dir, { recursive: true }) })
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('importFromFile (modern .colpkg, end-to-end)', () => {
  it('imports a synthetic modern package into rows + media, renderable via getCard', async () => {
    const apkg = await buildModernApkg(spec, { 'pic.png': new TextEncoder().encode('PNGBYTES') })
    const file = join(dir, 'deck.colpkg'); writeFileSync(file, apkg)

    const res = await importFromFile(db, file, join(dir, 'media'))
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)

    const sets = await listDeckSets(db)
    expect(sets[0]?.cardCount).toBe(1)
    expect(await db.select().from(cards)).toHaveLength(1)
    expect((await db.select().from(media))[0]?.filename).toBe('pic.png')
    expect(readdirSync(join(dir, 'media'))).toHaveLength(1)

    // The protobuf-decoded css/qfmt + \x1f deck name survive into a renderable CardView.
    const setId = sets[0]?.id
    if (setId === undefined) throw new Error('no deck set')
    const sub = (await listDecks(db, setId)).find((d) => d.leafName === 'Default')?.children[0]
    if (!sub) throw new Error('no sub deck')
    const cardId = (await listCards(db, { deckId: sub.deckId })).cards[0]?.cardId
    if (cardId === undefined) throw new Error('no card')
    const view = await getCard(db, cardId)
    if (!view.ok) throw new Error(view.error)
    expect(view.data.css).toBe('.card{color:blue}')
    expect(view.data.qfmt).toBe('{{Front}}<img src="pic.png">')
    expect(view.data.deckName).toBe('Default::Sub')
    expect(view.data.media.map((m) => m.filename)).toEqual(['pic.png'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/flashcards/modern-import.test.ts`
Expected: FAIL — modern packages currently return `unsupported-format`.

- [ ] **Step 3: Implement `modern-media.ts`**

```ts
// src/main/flashcards/modern-media.ts
import { MediaEntries } from './anki-proto'
import { zstdDecompressCapped, MAX_ZSTD_MANIFEST } from './zstd'

/**
 * Resolve modern media: the `media` member is a zstd-compressed protobuf manifest; entry
 * index N maps to the (raw, uncompressed) numbered ZIP member "N". Returns originalName → bytes.
 */
export function parseModernMedia(members: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const manifest = members['media']
  if (!manifest) return {}
  const decoded = zstdDecompressCapped(manifest, MAX_ZSTD_MANIFEST)
  const entries = (MediaEntries.decode(decoded) as unknown as { entries?: { name?: string }[] }).entries ?? []
  const out: Record<string, Uint8Array> = {}
  entries.forEach((entry, i) => {
    const blob = members[String(i)]
    if (blob && entry.name) out[entry.name] = blob
  })
  return out
}
```

- [ ] **Step 4: Rewrite `import.ts` with the modern branch (legacy path unchanged)**

Replace the entire body of `src/main/flashcards/import.ts` with:

```ts
// src/main/flashcards/import.ts
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import type { DB } from '../db/client'
import type { DeckSetSummary, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import type { ParsedCollection } from './parsed-collection'
import { readCentralDirectory } from './central-dir'
import { detectFormat } from './detect'
import { extractMembers, ImportTooLargeError, CorruptPackageError } from './zip'
import { parseLegacyCollection } from './parse-legacy'
import { parseModernCollection } from './parse-modern'
import { parseModernMedia } from './modern-media'
import { zstdDecompressCapped, MAX_ZSTD_COLLECTION } from './zstd'
import { storeMedia } from './media-store'
import { writeCollection } from './etl'

/** Legacy media: a JSON map of numbered-blob → original filename. */
function legacyMedia(members: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const mediaFiles: Record<string, Uint8Array> = {}
  const mediaJson = members['media']
  if (mediaJson) {
    try {
      const map = JSON.parse(new TextDecoder().decode(mediaJson)) as Record<string, string>
      for (const [num, name] of Object.entries(map)) {
        const blob = members[num]
        if (blob) mediaFiles[name] = blob
      }
    } catch { /* malformed media map → import without media rather than fail the whole deck */ }
  }
  return mediaFiles
}

/** Import a deck package from a path into the db, persisting media under mediaDir. No dialog (unit-testable). */
export async function importFromFile(db: DB, filePath: string, mediaDir: string): Promise<ServiceResult<DeckSetSummary>> {
  let buf: Uint8Array
  try { buf = await readFile(filePath) } catch { return err('corrupt-package') }

  let entries
  try { entries = readCentralDirectory(buf) } catch { return err('corrupt-package') }
  const detected = detectFormat(entries)
  if (!detected) return err('unsupported-format')
  const isModern = detected.format === 'latest'

  let members: Record<string, Uint8Array>
  try {
    members = extractMembers(buf, (n) => n === detected.collectionMember || n === 'media' || /^[0-9]+$/.test(n))
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    if (e instanceof CorruptPackageError) return err('corrupt-package')
    return err('corrupt-package')
  }

  const rawCollection = members[detected.collectionMember]
  if (!rawCollection) return err('corrupt-package')

  // Modern collections are a single zstd stream over the SQLite file; legacy are raw SQLite.
  let collectionBytes: Uint8Array
  try {
    collectionBytes = isModern ? zstdDecompressCapped(rawCollection, MAX_ZSTD_COLLECTION) : rawCollection
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    return err('corrupt-package')
  }

  // Parse from a temp file (raw libsql needs a path); always clean it up.
  const tmpPath = join(tmpdir(), `fc-import-${randomUUID()}.anki2`)
  let parsed: ParsedCollection
  try {
    await writeFile(tmpPath, collectionBytes)
    parsed = isModern ? await parseModernCollection(tmpPath) : await parseLegacyCollection(tmpPath)
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    return err('corrupt-package')
  } finally {
    await unlink(tmpPath).catch(() => { /* ignore */ })
  }

  // Resolve media (modern: protobuf manifest + raw blobs; legacy: JSON map), then store on disk.
  let mediaFiles: Record<string, Uint8Array>
  try {
    mediaFiles = isModern ? parseModernMedia(members) : legacyMedia(members)
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    mediaFiles = {} // a bad media manifest should not fail the whole deck
  }
  const stored = storeMedia(mediaDir, mediaFiles)

  const summary = await writeCollection(db, {
    sourceFilename: basename(filePath),
    sourceFormat: detected.format,
    parsed,
    media: stored
  })
  return ok(summary)
}

/** Electron wrapper: open dialog, then import the chosen file. */
export async function importViaDialog(db: DB, mediaDir: string): Promise<ServiceResult<DeckSetSummary>> {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Anki deck', extensions: ['apkg', 'colpkg'] }] })
  const filePath = res.filePaths[0]
  if (res.canceled || !filePath) return err('invalid')
  return importFromFile(db, filePath, mediaDir)
}
```

- [ ] **Step 5: Run to verify it passes + the legacy test still passes**

Run: `npx vitest run test/flashcards/modern-import.test.ts test/flashcards/import.test.ts && npx tsc --noEmit`
Expected: PASS (modern 1 + legacy 2); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/flashcards/modern-media.ts src/main/flashcards/import.ts test/flashcards/modern-import.test.ts
git commit -m "feat(flashcards): import modern .colpkg (zstd collection + protobuf media) via the ParsedCollection seam"
```

---

## Task 7: Full sweep + acceptance note

**Files:** Modify `docs/handoffs/flashcards-m1-plan2-acceptance.md` (append a modern-deck gate).

- [ ] **Step 1: Typecheck + build + full test sweep**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: tsc clean; `electron-vite build` succeeds; **all** tests pass (Plans 1+2 + Plan 3's new suites). Note the final counts.

- [ ] **Step 2: Append the modern-deck manual gate**

Append to `docs/handoffs/flashcards-m1-plan2-acceptance.md`:

```markdown

## Modern .colpkg acceptance (Plan 3)
- [ ] Export a deck from a current Anki desktop as a **.colpkg** (and/or a modern .apkg), import it via the Flashcards tab, and confirm: decks/subdecks appear with the right `::` hierarchy; Basic + Cloze render; images load; nothing falls back to `unsupported-format`.
- [ ] (Optional) Re-export the same AnkiWeb deck (O3, `178384887`) as a modern .colpkg and confirm parity with its legacy .apkg import.
```

- [ ] **Step 3: Commit**

```bash
git add docs/handoffs/flashcards-m1-plan2-acceptance.md
git commit -m "docs(flashcards): modern .colpkg acceptance gate for M1"
```

---

## Final review (after all tasks)

Dispatch a final adversarial reviewer over the Plan 3 diff (`git diff <plan3-doc-commit>..HEAD`), focused on: protobuf field-number correctness (vs the cited Anki source), the zstd bomb cap actually bounding memory, the `\x1f`→`::` and `flds` split, the amplification guards, the modern-vs-legacy branch in `import.ts` leaving the legacy path unchanged, and error-code mapping (`import-too-large` vs `corrupt-package`). Then run `superpowers:finishing-a-development-branch` (the branch now carries the full M1: import legacy+modern, browse, render).

---

## Spec coverage map (self-review)

- **C1 modern detection/ETL** → detection already in place (Plan 1 `detect.ts`); Tasks 3/5/6 add zstd-decompress → `parseModernCollection` → reuse `writeCollection`. The `ParsedCollection` seam is honored (Task 5 emits the identical shape).
- **Modern media** → Task 6 (`parseModernMedia`: protobuf manifest + raw numbered blobs → `storeMedia`).
- **Library choices** → `fzstd` + `protobufjs` in `dependencies` (Task 1); minimal vendored proto (Task 2); raw `@libsql/client` reads (Task 5).
- **Security** → zstd-bomb cap (Task 3); SQLite-amplification guards (Task 5); ZIP-bomb/ZIP-slip already enforced by the reused `zip.ts`/content-hash `media-store.ts`.
- **O2** → fixtures compress via `node:zlib` (Task 4); runtime stays decompress-only.
- **Build sequence step 7** → implemented, with the verified correction that modern media blobs are NOT individually zstd-compressed (decision #2).
- **Out of scope (correctly absent):** FSRS/review/scheduling history, gamification, filtered-deck semantics (decision #4), full image-occlusion, audio playback. No schema/IPC/renderer change.
