# FreeCAT Flashcards — Milestone 1, Plan 2 (Card Render + Browse UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Standing constraint for this repo: every code-writing subagent runs Opus 4.8 at max effort.**

**Goal:** Render imported Anki cards faithfully (Basic + Cloze, conditionals, `{{hint:}}`/`{{text:}}`, images, MathJax, per-note-type CSS) inside an opaque-origin sandboxed iframe fed media through a privileged `freecat-media://` protocol, and ship the browse UI (empty state + import, deck/subdeck tree, keyset-paged card list, single iframe viewer with front/back flip, graceful-degradation placeholders).

**Architecture:** A pure, dependency-free template+cloze engine (`src/shared/flashcards/`) turns a `CardView` DTO into a full HTML string that is assigned **only** to `<iframe sandbox="allow-scripts">` `srcdoc` (opaque origin; never parent `innerHTML`). The card's CSS + a self-contained MathJax SVG build run **inside** the iframe under a strict `default-src 'none'` CSP. Card `<img src>` is rewritten to `freecat-media://<token>/<filename>`; a MAIN-process protocol handler authorizes each request through a per-card capability token scoped to one deck-set (no global hash lookup) and serves content-addressed files with a closed extension→MIME allowlist. The renderer stays fully sandboxed and reaches MAIN only through `window.freecat.flashcards.*`.

**Tech Stack:** Electron (main: `protocol`, `session`) · React 19 + TypeScript (renderer) · Tailwind v4 · Drizzle ORM + `@libsql/client` · Zod (IPC boundary) · Vitest (node + per-file jsdom pragma) · MathJax 3 `tex-svg-full` (inlined via Vite `?raw`).

**Source of truth:** `docs/superpowers/specs/2026-06-23-flashcards-m1-design.md` (Components C3 `getCard`, C4a–e, C5; Security; resolved O1–O5). Plan 1 (import backend) is built and green; this plan is purely additive on top of it.

---

## Pre-resolved low-level decisions (intentional; not drift from the spec)

These are implementation mechanics decided up front. Reviewers: treat them as the spec for this plan.

1. **MathJax = `tex-svg-full`** (not `tex-chtml-full`). SVG output embeds glyph paths in the JS bundle → no `@font-face`, no network, renders under `default-src 'none'`. Still needs `script-src 'unsafe-eval'` (O5 accepts). Inlined via `import … from 'mathjax/es5/tex-svg-full.js?raw'` in a **renderer-only** module; the shared engine takes the MathJax source as a parameter so node unit tests stay fast and asset-free. MathJax is inlined **only when the rendered card contains math** (`\(` or `\[` after preprocessing).
2. **App-document CSP (O4) is applied in MAIN via `session.defaultSession.webRequest.onHeadersReceived`, gated on `app.isPackaged`.** A static `<meta>` CSP in `index.html` would break Vite dev HMR (inline scripts + `eval` + `ws:`). Production gets the minimal hardened slice (`script-src 'self'; frame-src 'self'; …`); dev is unaffected. The iframe's own CSP (the load-bearing isolation) is active in both.
3. **Iframe CSP `img-src` uses the scheme-source `freecat-media:`** (not `freecat-media://media`). Capability-token URLs carry a random token in the host, so a host-pinned source can't match. Authorization is enforced by the MAIN handler's token→deck-set map, never by CSP host.
4. **Unknown template filters are identity, unknown bare fields render empty** (Anki-faithful, total parser). E.g. `{{tts en_US:Front}}` → the `Front` value; `{{CardFlag}}` → `""`.
5. **Capability token is deck-set-scoped** (the spec's "minimum acceptable" bar): a token minted for deck-set A can never resolve deck-set B's media, which is the cross-deck-set confidentiality guarantee. The `CardView.mediaMap` carries only the filenames *this card* references (kept small for AnKing-scale decks), but the token would authorize any filename in its own deck-set.
6. **`{{hint:Field}}` renders a no-JS `<details><summary>Field</summary>value</details>`** (pragmatic, accessible, works without AnKing's hint add-on JS). Empty field → renders nothing.

---

## File Structure

**Created — shared pure engine (`src/shared/flashcards/`):**
- `cloze.ts` — `renderClozeField(text, ordinal, side)`. Anki `rslib/cloze.rs`-matched: shared-ordinal reveal-all, `data-cloze` on the active question span, `.cloze-inactive` spans, nesting, `::hint`.
- `template.ts` — `renderTemplate(fmt, ctx)` + `TemplateContext`. Field substitution (raw HTML), `{{text:}}`/`{{hint:}}`/`{{type:}}`/`{{cloze:}}` filters, `{{#}}/{{^}}/{{/}}` sections, special fields, `{{FrontSide}}`, filter-chain identity for unknowns.
- `render.ts` — `buildCardHtml(view, side, mathjaxSrc?)` + `IFRAME_CSP`, `preprocessMath`, `rewriteMedia`, `replaceSound`. Assembles the full `srcdoc` string.
- `index.ts` — barrel re-export.

**Created — MAIN:**
- `src/main/flashcards/media-tokens.ts` — `mintMediaToken(deckSetId)` / `resolveMediaToken(token)`, bounded in-memory map.
- `src/main/flashcards/media-protocol.ts` — `MIME_BY_EXT`, `resolveMedia(db, mediaDir, token, filename)`, `createMediaHandler(db, mediaDir)`.
- `src/main/flashcards/card-view.ts` — `mediaUrl(token, filename)`, `toCardView(source, token)` (pure, electron-free).
- `src/main/flashcards/paths.ts` — `flashcardsMediaDir()` (shared by IPC + protocol handler).

**Created — renderer:**
- `src/renderer/src/flashcards/mathjax-asset.ts` — `MATHJAX_SVG_SRC` (`?raw` import; renderer-only).
- `src/renderer/src/flashcards/CardViewer.tsx` — single sandboxed iframe, front/back flip, height postMessage shim, degradation placeholders.

**Created — tests:** `test/flashcards/cloze.test.ts`, `template.test.ts`, `render.test.ts`, `media-protocol.test.ts`, `card-view.test.ts`, `getcard.repo.test.ts`, `viewer.test.tsx` (jsdom), `flashcards-page.test.tsx` (jsdom).

**Modified:**
- `src/shared/dto.ts` — add `CardField`, `CardMedia`, `CardView`.
- `src/shared/channels.ts` — add `fcGetCard`.
- `src/shared/api.ts` — add `flashcards.getCard`.
- `src/preload/index.ts` — add `getCard` mapping.
- `src/main/repositories/flashcards.ts` — add `CardSource` + `getCard(db, cardId)`.
- `src/main/ipc/flashcards.ts` — add `getCardSchema`, the `fcGetCard` handler (mint token + `toCardView`), switch `mediaDir()` → `flashcardsMediaDir()`.
- `src/main/index.ts` — `protocol.registerSchemesAsPrivileged` (top-level) + `protocol.handle('freecat-media', …)` and the prod-gated app CSP (inside `whenReady`).
- `src/renderer/src/pages/Flashcards.tsx` — replace the stub with the browse UI.
- `test/flashcards/contracts.test.ts` — expect 6 channels incl. `fcGetCard`.
- `test/flashcards/ipc-validation.test.ts` — add `getCardSchema` cases.
- `package.json` — `mathjax` (dependencies); `jsdom`, `@testing-library/react`, `@testing-library/dom` (devDependencies).
- `vitest.config.ts` — widen `include` to collect `.test.tsx`.

**Not modified:** `src/renderer/index.html` (app CSP is delivered via MAIN headers, decision 2).

---

## Task 1: Shared contracts — `CardView` DTO + `fcGetCard` channel + api/preload

**Files:**
- Modify: `src/shared/dto.ts`
- Modify: `src/shared/channels.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `test/flashcards/contracts.test.ts`

- [ ] **Step 1: Update the channels contract test to expect six channels**

Replace the body of `test/flashcards/contracts.test.ts`:

```ts
// test/flashcards/contracts.test.ts
import { describe, it, expect } from 'vitest'
import { CH } from '../../src/shared/channels'

describe('flashcards channels', () => {
  it('defines the six M1 channels, all unique', () => {
    const fc = [CH.fcImportDeck, CH.fcListDeckSets, CH.fcListDecks, CH.fcListCards, CH.fcGetCard, CH.fcDeleteDeckSet]
    expect(fc).toEqual([
      'flashcards:importDeck', 'flashcards:listDeckSets', 'flashcards:listDecks',
      'flashcards:listCards', 'flashcards:getCard', 'flashcards:deleteDeckSet'
    ])
    expect(new Set(Object.values(CH)).size).toBe(Object.values(CH).length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/contracts.test.ts`
Expected: FAIL — `CH.fcGetCard` is `undefined` (channel not added yet).

- [ ] **Step 3: Add the `fcGetCard` channel**

In `src/shared/channels.ts`, insert `fcGetCard` between `fcListCards` and `fcDeleteDeckSet`:

```ts
  fcListCards:     'flashcards:listCards',
  fcGetCard:       'flashcards:getCard',
  fcDeleteDeckSet: 'flashcards:deleteDeckSet'
```

- [ ] **Step 4: Add the `CardView` DTOs**

In `src/shared/dto.ts`, append to the `// --- Flashcards DTOs ---` block (after `CardListPage`):

```ts
export interface CardField { name: string; value: string }
export interface CardMedia { filename: string; url: string }
export interface CardView {
  cardId: number
  renderKind: RenderKind
  css: string
  qfmt: string
  afmt: string
  fields: CardField[]
  tags: string[]
  noteTypeName: string
  deckName: string
  subdeckName: string
  templateName: string
  clozeOrdinal: number | null
  mediaMap: CardMedia[]
}
```

(`RenderKind` is already imported at the top of `dto.ts`.)

- [ ] **Step 5: Add `getCard` to the API surface and preload**

In `src/shared/api.ts`, extend the import and the `flashcards` block:

```ts
import type { ProfileDto, GamificationState, ActivityResult, RecordActivityInput, ServiceResult, PetView, DeckSetSummary, DeckNode, ListCardsInput, CardListPage, CardView } from './dto'
```

```ts
  flashcards: {
    importDeck: () => Promise<ServiceResult<DeckSetSummary>>
    listDeckSets: () => Promise<DeckSetSummary[]>
    listDecks: (deckSetId: number) => Promise<DeckNode[]>
    listCards: (input: ListCardsInput) => Promise<CardListPage>
    getCard: (cardId: number) => Promise<ServiceResult<CardView>>
    deleteDeckSet: (deckSetId: number) => Promise<ServiceResult<null>>
  }
```

In `src/preload/index.ts`, add the `getCard` arrow to the `flashcards` block (after `listCards`):

```ts
    listCards: (input) => ipcRenderer.invoke(CH.fcListCards, input),
    getCard: (cardId) => ipcRenderer.invoke(CH.fcGetCard, cardId),
    deleteDeckSet: (deckSetId) => ipcRenderer.invoke(CH.fcDeleteDeckSet, deckSetId)
```

- [ ] **Step 6: Run the test + typecheck**

Run: `npx vitest run test/flashcards/contracts.test.ts && npx tsc --noEmit`
Expected: contracts test PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/dto.ts src/shared/channels.ts src/shared/api.ts src/preload/index.ts test/flashcards/contracts.test.ts
git commit -m "feat(flashcards): CardView DTO + flashcards:getCard channel contract"
```

---

## Task 2: `getCard` repository + `CardSource`

**Files:**
- Modify: `src/main/repositories/flashcards.ts`
- Test: `test/flashcards/getcard.repo.test.ts`

Render needs the full card: note-type CSS, the right template (for cloze, the single `ord 0` template — `card.templateOrd` encodes the cloze ordinal, **not** a template index), fields zipped to their names, tags, deck name + leaf, the active cloze ordinal, and the media this card references. The repo is electron-free and returns an internal `CardSource` (with content hashes + `deckSetId`); the IPC layer (Task 8) mints a capability token and maps it to the public `CardView`.

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/getcard.repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { getCard, listDecks, listCards } from '../../src/main/repositories/flashcards'
import type { ParsedCollection } from '../../src/main/flashcards/parsed-collection'

// A deck-set with: a Basic note (image in Front), and a Cloze note (two c1 + one c2).
const collection: ParsedCollection = {
  noteTypes: [
    {
      ankiId: 1, name: 'Basic', kind: 'standard', css: '.card{color:red}',
      fields: [{ ord: 0, name: 'Front' }, { ord: 1, name: 'Back' }],
      templates: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }]
    },
    {
      ankiId: 2, name: 'Cloze', kind: 'cloze', css: '.cloze{font-weight:bold}',
      fields: [{ ord: 0, name: 'Text' }, { ord: 1, name: 'Extra' }],
      templates: [{ ord: 0, name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }]
    }
  ],
  decks: [{ ankiId: 1, name: 'Deck' }, { ankiId: 2, name: 'Deck::Sub' }],
  notes: [
    { ankiId: 100, guid: 'g1', noteTypeAnkiId: 1, fields: ['<img src="pic.png"> front', 'the back'], tags: ['tagA', 'tagB'], sortField: 'front' },
    { ankiId: 200, guid: 'g2', noteTypeAnkiId: 2, fields: ['{{c1::aaa}} and {{c2::bbb}} and {{c1::ccc}}', 'note'], tags: [], sortField: 'cloze' }
  ],
  // basic card (ord 0); two cloze cards: ord 0 (=c1) and ord 1 (=c2)
  cards: [
    { noteAnkiId: 100, deckAnkiId: 2, ord: 0 },
    { noteAnkiId: 200, deckAnkiId: 1, ord: 0 },
    { noteAnkiId: 200, deckAnkiId: 1, ord: 1 }
  ]
}

let db: DB
beforeEach(async () => { db = await createTestDb() })

async function seed(): Promise<void> {
  await writeCollection(db, {
    sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: collection,
    media: { 'pic.png': { hash: 'abc123def456', ext: '.png' } }
  })
}

describe('getCard', () => {
  it('404s an unknown card', async () => {
    await seed()
    expect(await getCard(db, 99999)).toEqual({ ok: false, error: 'card-not-found' })
  })

  it('returns a Basic card with fields, css, template, deck leaf, and referenced media', async () => {
    await seed()
    const sub = (await listDecks(db, 1))[0]?.children[0]
    if (!sub) throw new Error('no sub deck')
    const first = (await listCards(db, { deckId: sub.deckId })).cards[0]
    if (!first) throw new Error('no card')
    const res = await getCard(db, first.cardId)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const v = res.data
    expect(v.renderKind).toBe('basic')
    expect(v.css).toBe('.card{color:red}')
    expect(v.qfmt).toBe('{{Front}}')
    expect(v.noteTypeName).toBe('Basic')
    expect(v.deckName).toBe('Deck::Sub')
    expect(v.subdeckName).toBe('Sub')
    expect(v.templateName).toBe('Card 1')
    expect(v.clozeOrdinal).toBeNull()
    expect(v.tags).toEqual(['tagA', 'tagB'])
    expect(v.fields).toEqual([
      { name: 'Front', value: '<img src="pic.png"> front' },
      { name: 'Back', value: 'the back' }
    ])
    // only the media this card references, with its hash+ext for the protocol handler
    expect(v.media).toEqual([{ filename: 'pic.png', hash: 'abc123def456', ext: '.png' }])
  })

  it('maps a cloze card to its ordinal and the single ord-0 template', async () => {
    await seed()
    // both cloze cards live in deck ankiId 1 → our decks[0]
    const deckTop = (await listDecks(db, 1))[0]
    if (!deckTop) throw new Error('no top deck')
    const page = await listCards(db, { deckId: deckTop.deckId })
    const ordinals: (number | null)[] = []
    for (const c of page.cards) {
      const res = await getCard(db, c.cardId)
      if (res.ok) { ordinals.push(res.data.clozeOrdinal); expect(res.data.qfmt).toBe('{{cloze:Text}}') }
    }
    expect(ordinals.sort()).toEqual([1, 2]) // templateOrd 0 → ordinal 1, templateOrd 1 → ordinal 2
  })

  it('returns no media for a card that references none', async () => {
    await seed()
    const deckTop = (await listDecks(db, 1))[0]
    if (!deckTop) throw new Error('no top deck')
    const c = (await listCards(db, { deckId: deckTop.deckId })).cards[0]
    if (!c) throw new Error('no card')
    const res = await getCard(db, c.cardId)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data.media).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/getcard.repo.test.ts`
Expected: FAIL — `getCard` is not exported.

- [ ] **Step 3: Implement `CardSource` + `getCard`**

In `src/main/repositories/flashcards.ts`, add the `RenderKind` type import at the top (after the existing imports):

```ts
import type { RenderKind } from '../../shared/flashcards/types'
```

Then append:

```ts
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
```

(`eq`, `and`, `asc`, `inArray` are already imported in this file; `media`, `notes`, `noteTypes`, `decks`, `noteTypeFields`, `templates`, `cards` are already imported; `ok`/`err` are already imported.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/flashcards/getcard.repo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/repositories/flashcards.ts test/flashcards/getcard.repo.test.ts
git commit -m "feat(flashcards): getCard repository returns CardSource (cloze ordinal, fields, referenced media)"
```

---

## Task 3: Pure cloze engine (`renderClozeField`)

**Files:**
- Create: `src/shared/flashcards/cloze.ts`
- Test: `test/flashcards/cloze.test.ts`

Matched to Anki's `rslib/cloze.rs`. Active ordinal `N`: **all** deletions numbered `N` reveal together; the active **question** span carries `data-cloze="<HTML-attr-encoded answer>" data-ordinal="N"` and shows `[hint or …]`; the active **answer** span shows the answer; **inactive** deletions become `.cloze-inactive` spans (both sides). Nesting and `::hint` supported.

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/cloze.test.ts
import { describe, it, expect } from 'vitest'
import { renderClozeField } from '../../src/shared/flashcards/cloze'

describe('renderClozeField', () => {
  it('question side: active deletion → data-cloze + [...] placeholder', () => {
    const out = renderClozeField('the {{c1::answer}} here', 1, 'question')
    expect(out).toBe('the <span class="cloze" data-cloze="answer" data-ordinal="1">[…]</span> here')
  })

  it('question side: uses the hint when present', () => {
    const out = renderClozeField('{{c1::answer::my hint}}', 1, 'question')
    expect(out).toBe('<span class="cloze" data-cloze="answer" data-ordinal="1">[my hint]</span>')
  })

  it('answer side: active deletion reveals the answer', () => {
    const out = renderClozeField('the {{c1::answer}} here', 1, 'answer')
    expect(out).toBe('the <span class="cloze" data-ordinal="1">answer</span> here')
  })

  it('two c1 in one field both reveal together for ordinal 1', () => {
    const q = renderClozeField('{{c1::a}} x {{c1::b}}', 1, 'question')
    expect(q).toBe('<span class="cloze" data-cloze="a" data-ordinal="1">[…]</span> x <span class="cloze" data-cloze="b" data-ordinal="1">[…]</span>')
  })

  it('inactive ordinal renders as .cloze-inactive on the question side', () => {
    const q = renderClozeField('{{c1::a}} {{c2::b}}', 1, 'question')
    expect(q).toBe('<span class="cloze" data-cloze="a" data-ordinal="1">[…]</span> <span class="cloze-inactive" data-ordinal="2">b</span>')
  })

  it('HTML-attr-encodes the answer in data-cloze', () => {
    const q = renderClozeField('{{c1::a<b> & "c"}}', 1, 'question')
    expect(q).toBe('<span class="cloze" data-cloze="a&lt;b&gt; &amp; &quot;c&quot;" data-ordinal="1">[…]</span>')
  })

  it('nested cloze: outer active, inner inactive shows inner content', () => {
    const q = renderClozeField('{{c1::outer {{c2::inner}}}}', 1, 'question')
    // active c1 reveals into data-cloze (answer-side render of the inner c2 = inactive span)
    expect(q).toBe('<span class="cloze" data-cloze="outer &lt;span class=&quot;cloze-inactive&quot; data-ordinal=&quot;2&quot;&gt;inner&lt;/span&gt;" data-ordinal="1">[…]</span>')
  })

  it('nested cloze: inner active while inside an inactive outer still renders active', () => {
    const a = renderClozeField('{{c1::outer {{c2::inner}}}}', 2, 'answer')
    expect(a).toBe('<span class="cloze-inactive" data-ordinal="1">outer <span class="cloze" data-ordinal="2">inner</span></span>')
  })

  it('leaves a malformed/unbalanced deletion as literal text', () => {
    expect(renderClozeField('{{c1::oops', 1, 'question')).toBe('{{c1::oops')
  })

  it('passes through text with no clozes unchanged', () => {
    expect(renderClozeField('plain text', 1, 'question')).toBe('plain text')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/cloze.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cloze.ts`**

```ts
// src/shared/flashcards/cloze.ts

/** HTML-attribute-encode a string for use inside data-cloze="…". */
function encodeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface ParsedDeletion { ordinal: number; answer: string; hint: string | null; next: number }

/**
 * Parse a single `{{c<digits>::…}}` starting at `open` (index of the leading `{{`),
 * matching the closing `}}` across nested `{{…}}`. Returns null if not a cloze opener
 * or if unbalanced.
 */
function parseDeletion(text: string, open: number): ParsedDeletion | null {
  const m = /^\{\{c(\d+)::/.exec(text.slice(open))
  if (!m) return null
  const numStr = m[1]
  if (numStr === undefined) return null
  const ordinal = Number(numStr)
  const contentStart = open + m[0].length
  let i = contentStart
  let depth = 1 // inside this deletion's braces
  let splitIndex = -1 // index of the first top-level '::' (answer/hint boundary)
  while (i < text.length) {
    if (text.startsWith('{{', i)) { depth++; i += 2; continue }
    if (text.startsWith('}}', i)) {
      depth--
      if (depth === 0) {
        const inner = text.slice(contentStart, i)
        const rel = splitIndex === -1 ? -1 : splitIndex - contentStart
        const answer = rel === -1 ? inner : inner.slice(0, rel)
        const hint = rel === -1 ? null : inner.slice(rel + 2)
        return { ordinal, answer, hint, next: i + 2 }
      }
      i += 2
      continue
    }
    if (depth === 1 && splitIndex === -1 && text.startsWith('::', i)) { splitIndex = i; i += 2; continue }
    i++
  }
  return null // unbalanced
}

function renderDeletion(n: number, answer: string, hint: string | null, active: number, side: 'question' | 'answer'): string {
  if (n === active) {
    if (side === 'question') {
      const revealed = renderClozeField(answer, active, 'answer')
      const placeholder = hint && hint.length > 0 ? hint : '…'
      return `<span class="cloze" data-cloze="${encodeAttr(revealed)}" data-ordinal="${n}">[${placeholder}]</span>`
    }
    const revealed = renderClozeField(answer, active, 'answer')
    return `<span class="cloze" data-ordinal="${n}">${revealed}</span>`
  }
  // inactive: show the content; recurse so a nested active cloze still resolves.
  const shown = renderClozeField(answer, active, side)
  return `<span class="cloze-inactive" data-ordinal="${n}">${shown}</span>`
}

/** Render Anki cloze markup for a given active ordinal and side. Total: never throws. */
export function renderClozeField(text: string, ordinal: number, side: 'question' | 'answer'): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('{{c', i)) {
      const d = parseDeletion(text, i)
      if (d) {
        out += renderDeletion(d.ordinal, d.answer, d.hint, ordinal, side)
        i = d.next
        continue
      }
    }
    out += text.charAt(i)
    i++
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/flashcards/cloze.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/flashcards/cloze.ts test/flashcards/cloze.test.ts
git commit -m "feat(flashcards): pure cloze engine (rslib-matched reveal-all, data-cloze, nesting)"
```

---

## Task 4: Pure template engine (`renderTemplate`)

**Files:**
- Create: `src/shared/flashcards/template.ts`
- Test: `test/flashcards/template.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/template.test.ts
import { describe, it, expect } from 'vitest'
import { renderTemplate, type TemplateContext } from '../../src/shared/flashcards/template'

function ctx(over: Partial<TemplateContext> = {}): TemplateContext {
  return {
    fields: { Front: '<b>F</b>', Back: 'B', Empty: '   ', Hintable: 'secret' },
    clozeOrdinal: null,
    side: 'question',
    frontSide: 'FRONT_HTML',
    special: { Tags: 'a b', Type: 'Basic', Deck: 'Deck::Sub', Subdeck: 'Sub', Card: 'Card 1' },
    ...over
  }
}

describe('renderTemplate', () => {
  it('substitutes a field as raw HTML', () => {
    expect(renderTemplate('{{Front}}', ctx())).toBe('<b>F</b>')
  })

  it('unknown bare field → empty string', () => {
    expect(renderTemplate('x{{Nope}}y', ctx())).toBe('xy')
  })

  it('{{text:Field}} strips HTML', () => {
    expect(renderTemplate('{{text:Front}}', ctx())).toBe('F')
  })

  it('{{hint:Field}} renders a collapsible details for non-empty, nothing for empty', () => {
    expect(renderTemplate('{{hint:Hintable}}', ctx())).toBe('<details class="hint"><summary>Hintable</summary>secret</details>')
    expect(renderTemplate('{{hint:Empty}}', ctx())).toBe('')
  })

  it('positive section shows when field non-empty, hides when empty/whitespace', () => {
    expect(renderTemplate('{{#Back}}has back{{/Back}}', ctx())).toBe('has back')
    expect(renderTemplate('{{#Empty}}x{{/Empty}}', ctx())).toBe('')
  })

  it('negative section is the inverse', () => {
    expect(renderTemplate('{{^Empty}}is empty{{/Empty}}', ctx())).toBe('is empty')
    expect(renderTemplate('{{^Back}}x{{/Back}}', ctx())).toBe('')
  })

  it('nested sections', () => {
    expect(renderTemplate('{{#Front}}A{{#Back}}B{{/Back}}C{{/Front}}', ctx())).toBe('ABC')
  })

  it('special fields resolve', () => {
    expect(renderTemplate('{{Deck}}|{{Subdeck}}|{{Tags}}|{{Type}}|{{Card}}', ctx()))
      .toBe('Deck::Sub|Sub|a b|Basic|Card 1')
  })

  it('{{FrontSide}} resolves to the rendered question', () => {
    expect(renderTemplate('{{FrontSide}}', ctx())).toBe('FRONT_HTML')
  })

  it('unknown filter is identity over the resolved field', () => {
    expect(renderTemplate('{{tts en_US:Front}}', ctx())).toBe('<b>F</b>')
  })

  it('{{cloze:Field}} runs the cloze engine when an ordinal is set', () => {
    const c = ctx({ fields: { Text: '{{c1::a}} {{c2::b}}' }, clozeOrdinal: 1, side: 'question' })
    expect(renderTemplate('{{cloze:Text}}', c))
      .toBe('<span class="cloze" data-cloze="a" data-ordinal="1">[…]</span> <span class="cloze-inactive" data-ordinal="2">b</span>')
  })

  it('leaves an unbalanced tag as literal', () => {
    expect(renderTemplate('a{{Front', ctx())).toBe('a{{Front')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `template.ts`**

```ts
// src/shared/flashcards/template.ts
import { renderClozeField } from './cloze'

export interface TemplateContext {
  /** Field name → raw field value (HTML). */
  fields: Record<string, string>
  /** Active cloze ordinal for {{cloze:}} (null on non-cloze cards). */
  clozeOrdinal: number | null
  side: 'question' | 'answer'
  /** Rendered question HTML, for {{FrontSide}} (empty on the question side). */
  frontSide: string
  special: { Tags: string; Type: string; Deck: string; Subdeck: string; Card: string }
}

const SPECIAL = new Set(['Tags', 'Type', 'Deck', 'Subdeck', 'Card'])

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

/** Anki emptiness: no non-whitespace content after removing HTML tags and &nbsp;. */
function isEmptyField(value: string): boolean {
  return stripHtml(value).replace(/&nbsp;/gi, ' ').replace(/ /g, ' ').trim().length === 0
}

function resolveValue(name: string, ctx: TemplateContext): string | undefined {
  if (name === 'FrontSide') return ctx.frontSide
  if (SPECIAL.has(name)) return ctx.special[name as 'Tags' | 'Type' | 'Deck' | 'Subdeck' | 'Card']
  if (Object.prototype.hasOwnProperty.call(ctx.fields, name)) return ctx.fields[name]
  return undefined
}

function applyFilter(filter: string, fieldName: string, value: string, ctx: TemplateContext): string {
  switch (filter) {
    case 'text': return stripHtml(value)
    case 'hint': return isEmptyField(value) ? '' : `<details class="hint"><summary>${fieldName}</summary>${value}</details>`
    case 'type': return `<div class="type-answer">${stripHtml(value)}</div>`
    case 'cloze': return ctx.clozeOrdinal == null ? value : renderClozeField(value, ctx.clozeOrdinal, ctx.side)
    default: return value // unknown filter → identity (total, Anki-faithful)
  }
}

/** Render a `{{…}}` substitution tag (not a section open/close). */
function renderTag(inner: string, ctx: TemplateContext): string {
  const parts = inner.split(':')
  const fieldName = parts[parts.length - 1] ?? ''
  const filters = parts.slice(0, -1)
  const base = resolveValue(fieldName, ctx)
  if (base === undefined && filters.length === 0) return '' // unknown bare field → empty
  let value = base ?? ''
  for (let k = filters.length - 1; k >= 0; k--) {
    const f = filters[k]
    if (f === undefined || f.length === 0) continue
    value = applyFilter(f.trim(), fieldName, value, ctx)
  }
  return value
}

function sectionFieldEmpty(field: string, ctx: TemplateContext): boolean {
  const v = resolveValue(field, ctx)
  return v === undefined ? true : isEmptyField(v)
}

/**
 * Render from `start` until EOF, or until the `{{/stopField}}` that closes the section
 * we are inside. Returns the rendered text and the index just past that close.
 */
function renderNodes(fmt: string, start: number, ctx: TemplateContext, stopField: string | null): { out: string; end: number } {
  let out = ''
  let i = start
  while (i < fmt.length) {
    const open = fmt.indexOf('{{', i)
    if (open === -1) { out += fmt.slice(i); return { out, end: fmt.length } }
    out += fmt.slice(i, open)
    const close = fmt.indexOf('}}', open + 2)
    if (close === -1) { out += fmt.slice(open); return { out, end: fmt.length } } // unbalanced → literal tail
    const inner = fmt.slice(open + 2, close).trim()
    const after = close + 2
    if (inner.startsWith('#') || inner.startsWith('^')) {
      const field = inner.slice(1).trim()
      const body = renderNodes(fmt, after, ctx, field)
      const include = inner.startsWith('#') ? !sectionFieldEmpty(field, ctx) : sectionFieldEmpty(field, ctx)
      if (include) out += body.out
      i = body.end
    } else if (inner.startsWith('/')) {
      const field = inner.slice(1).trim()
      if (stopField !== null && field === stopField) return { out, end: after }
      i = after // stray close → ignore
    } else {
      out += renderTag(inner, ctx)
      i = after
    }
  }
  return { out, end: i }
}

export function renderTemplate(fmt: string, ctx: TemplateContext): string {
  return renderNodes(fmt, 0, ctx, null).out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/flashcards/template.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/flashcards/template.ts test/flashcards/template.test.ts
git commit -m "feat(flashcards): pure template engine (fields, filters, sections, special, FrontSide)"
```

---

## Task 5: srcdoc assembler (`buildCardHtml`) + barrel

**Files:**
- Create: `src/shared/flashcards/render.ts`
- Create: `src/shared/flashcards/index.ts`
- Test: `test/flashcards/render.test.ts`

Assemble the complete iframe `srcdoc`: question or answer body (answer passes the rendered question as `{{FrontSide}}`), Anki `[$]`/`[$$]` math markup converted to `\(`/`\[`, `<img src>` rewritten via `mediaMap`, `[sound:]` → inert chip, the card CSS, MathJax inlined **only** when math is present **and** a MathJax source was supplied, the strict iframe CSP, and the height postMessage shim.

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/render.test.ts
import { describe, it, expect } from 'vitest'
import { buildCardHtml, preprocessMath, rewriteMedia, replaceSound, IFRAME_CSP } from '../../src/shared/flashcards/render'
import type { CardView } from '../../src/shared/dto'

function view(over: Partial<CardView> = {}): CardView {
  return {
    cardId: 1, renderKind: 'basic', css: '.card{color:red}',
    qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id="ans">{{Back}}',
    fields: [{ name: 'Front', value: 'Q' }, { name: 'Back', value: 'A' }],
    tags: [], noteTypeName: 'Basic', deckName: 'D', subdeckName: 'D', templateName: 'C',
    clozeOrdinal: null, mediaMap: [], ...over
  }
}

describe('preprocessMath', () => {
  it('converts [$]…[/$] → \\(…\\) and [$$]…[/$$] → \\[…\\]', () => {
    expect(preprocessMath('a [$]x^2[/$] b [$$]y[/$$] c')).toBe('a \\(x^2\\) b \\[y\\] c')
  })
})

describe('rewriteMedia', () => {
  it('rewrites a known src to its url and leaves unknown src alone', () => {
    const html = '<img src="a.png"><img src="b.png">'
    const out = rewriteMedia(html, [{ filename: 'a.png', url: 'freecat-media://tok/a.png' }])
    expect(out).toBe('<img src="freecat-media://tok/a.png"><img src="b.png">')
  })
})

describe('replaceSound', () => {
  it('replaces [sound:x] with an inert chip', () => {
    expect(replaceSound('[sound:hi.mp3]')).toContain('audio — playback coming in a later milestone')
    expect(replaceSound('[sound:hi.mp3]')).not.toContain('[sound:')
  })
})

describe('buildCardHtml', () => {
  it('question side embeds the strict CSP, the card CSS, and the question body', () => {
    const html = buildCardHtml(view(), 'question')
    expect(html).toContain(`content="${IFRAME_CSP}"`)
    expect(html).toContain('<style>.card{color:red}</style>')
    expect(html).toContain('>Q<') // body div wraps the rendered Front
    expect(html).not.toContain('id="ans"') // answer-only markup absent
  })

  it('answer side includes the rendered question as FrontSide', () => {
    const html = buildCardHtml(view(), 'answer')
    expect(html).toContain('id="ans"')
    expect(html).toContain('Q') // FrontSide
    expect(html).toContain('A') // Back
  })

  it('rewrites media via the mediaMap', () => {
    const html = buildCardHtml(view({ fields: [{ name: 'Front', value: '<img src="p.png">' }, { name: 'Back', value: '' }], mediaMap: [{ filename: 'p.png', url: 'freecat-media://tok/p.png' }] }), 'question')
    expect(html).toContain('src="freecat-media://tok/p.png"')
  })

  it('inlines MathJax only when math is present AND a source is supplied', () => {
    const mathCard = view({ fields: [{ name: 'Front', value: '[$]x[/$]' }, { name: 'Back', value: '' }] })
    expect(buildCardHtml(mathCard, 'question', 'MJ_SOURCE')).toContain('MJ_SOURCE')
    expect(buildCardHtml(mathCard, 'question', 'MJ_SOURCE')).toContain('window.MathJax')
    expect(buildCardHtml(view(), 'question', 'MJ_SOURCE')).not.toContain('MJ_SOURCE') // no math → no inline
    expect(buildCardHtml(mathCard, 'question')).not.toContain('window.MathJax') // no source → no inline
  })

  it('disables $…$ and $$…$$ delimiters in the MathJax config', () => {
    const mathCard = view({ fields: [{ name: 'Front', value: '[$]x[/$]' }, { name: 'Back', value: '' }] })
    const html = buildCardHtml(mathCard, 'question', 'MJ')
    expect(html).toContain("inlineMath:[['\\\\(','\\\\)']]")
    expect(html).toContain("displayMath:[['\\\\[','\\\\]']]")
  })

  it('always includes the height postMessage shim', () => {
    expect(buildCardHtml(view(), 'question')).toContain("type:'fc-height'")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `render.ts`**

```ts
// src/shared/flashcards/render.ts
import type { CardView } from '../dto'
import { renderTemplate, type TemplateContext } from './template'

/** Iframe-document CSP. default-src 'none' blocks fetch/XHR/connect (no connect-src);
 *  media is delivered subresource-only as <img src="freecat-media://…">. 'unsafe-eval'
 *  is required by MathJax (O5) and bounded by the opaque origin + no network. */
export const IFRAME_CSP = "default-src 'none'; img-src freecat-media:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'"

const HEIGHT_SHIM =
  "<script>(function(){function p(){try{parent.postMessage({type:'fc-height'," +
  "height:Math.ceil(document.documentElement.getBoundingClientRect().height)},'*')}catch(e){}}" +
  "window.addEventListener('load',p);if(window.ResizeObserver){new ResizeObserver(p).observe(document.documentElement)}" +
  "setTimeout(p,50);setTimeout(p,400)})();</script>"

function mathjaxBlock(src: string): string {
  const cfg =
    "<script>window.MathJax={tex:{inlineMath:[['\\\\(','\\\\)']],displayMath:[['\\\\[','\\\\]']]}," +
    "loader:{load:[]},startup:{typeset:true},options:{enableMenu:false,enableAssistiveMml:false}," +
    "svg:{fontCache:'local'}};</script>"
  return cfg + `<script>${src}</script>`
}

export function preprocessMath(html: string): string {
  return html
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_m, x: string) => `\\[${x}\\]`)
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_m, x: string) => `\\(${x}\\)`)
}

export function rewriteMedia(html: string, mediaMap: CardView['mediaMap']): string {
  if (mediaMap.length === 0) return html
  const byName = new Map(mediaMap.map((m) => [m.filename, m.url]))
  return html.replace(/(\bsrc\s*=\s*)(["'])([^"']*)\2/gi, (whole, pre: string, q: string, name: string) => {
    const url = byName.get(name)
    return url ? `${pre}${q}${url}${q}` : whole
  })
}

export function replaceSound(html: string): string {
  return html.replace(/\[sound:([^\]]+)\]/g, (_m, name: string) =>
    `<span class="fc-audio" title="${name.replace(/"/g, '&quot;')}">🔊 audio — playback coming in a later milestone</span>`)
}

function hasMath(html: string): boolean {
  return html.includes('\\(') || html.includes('\\[')
}

function buildContext(view: CardView, side: 'question' | 'answer', frontSide: string): TemplateContext {
  const fields: Record<string, string> = {}
  for (const f of view.fields) fields[f.name] = f.value
  return {
    fields,
    clozeOrdinal: view.clozeOrdinal,
    side,
    frontSide,
    special: { Tags: view.tags.join(' '), Type: view.noteTypeName, Deck: view.deckName, Subdeck: view.subdeckName, Card: view.templateName }
  }
}

/**
 * Build the complete iframe srcdoc for one side of a card. `mathjaxSrc` is the full
 * self-contained MathJax SVG build (supplied by the renderer); when omitted (e.g. node
 * tests) MathJax is never inlined.
 */
export function buildCardHtml(view: CardView, side: 'question' | 'answer', mathjaxSrc = ''): string {
  const question = renderTemplate(view.qfmt, buildContext(view, 'question', ''))
  const rendered = side === 'question' ? question : renderTemplate(view.afmt, buildContext(view, 'answer', question))
  let body = preprocessMath(rendered)
  body = rewriteMedia(body, view.mediaMap)
  body = replaceSound(body)
  const math = mathjaxSrc && hasMath(body) ? mathjaxBlock(mathjaxSrc) : ''
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${IFRAME_CSP}">` +
    `<style>${view.css}</style>${math}</head>` +
    `<body class="card"><div class="fc-card">${body}</div>${HEIGHT_SHIM}</body></html>`
  )
}
```

- [ ] **Step 4: Create the barrel `index.ts`**

```ts
// src/shared/flashcards/index.ts
export { renderClozeField } from './cloze'
export { renderTemplate, type TemplateContext } from './template'
export { buildCardHtml, preprocessMath, rewriteMedia, replaceSound, IFRAME_CSP } from './render'
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run test/flashcards/render.test.ts && npx tsc --noEmit`
Expected: render test PASS (8 tests); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/flashcards/render.ts src/shared/flashcards/index.ts test/flashcards/render.test.ts
git commit -m "feat(flashcards): srcdoc assembler (iframe CSP, math preprocess, media rewrite, conditional MathJax)"
```

---

## Task 6: Media capability tokens + MIME allowlist + `resolveMedia`

**Files:**
- Create: `src/main/flashcards/media-tokens.ts`
- Create: `src/main/flashcards/media-protocol.ts`
- Test: `test/flashcards/media-protocol.test.ts`

`resolveMedia` is the security core: it resolves a token → deck-set, looks up `(deckSetId, filename)` in the `media` table, validates the hash is a hex basename, maps the extension through a **closed** allowlist (never echoing the untrusted filename), and returns the on-disk path. A token minted for deck-set A can never resolve deck-set B's media.

- [ ] **Step 1: Write the failing test**

```ts
// test/flashcards/media-protocol.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { mintMediaToken, resolveMediaToken, __resetMediaTokens } from '../../src/main/flashcards/media-tokens'
import { resolveMedia, MIME_BY_EXT } from '../../src/main/flashcards/media-protocol'
import type { ParsedCollection } from '../../src/main/flashcards/parsed-collection'

const minimal: ParsedCollection = {
  noteTypes: [{ ankiId: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }] }],
  decks: [{ ankiId: 1, name: 'D' }],
  notes: [{ ankiId: 100, guid: 'g', noteTypeAnkiId: 1, fields: ['x'], tags: [], sortField: 'x' }],
  cards: [{ noteAnkiId: 100, deckAnkiId: 1, ord: 0 }]
}

let db: DB
beforeEach(async () => { db = await createTestDb(); __resetMediaTokens() })

describe('media tokens', () => {
  it('mints unique tokens that resolve to their deck-set', () => {
    const a = mintMediaToken(1)
    const b = mintMediaToken(2)
    expect(a).not.toBe(b)
    expect(resolveMediaToken(a)).toBe(1)
    expect(resolveMediaToken(b)).toBe(2)
    expect(resolveMediaToken('nope')).toBeUndefined()
  })
})

describe('resolveMedia', () => {
  it('resolves a token+filename to an on-disk path and MIME', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'pic.png': { hash: 'deadbeef', ext: '.png' } } })
    const token = mintMediaToken(ds.id)
    const r = await resolveMedia(db, '/media', token, 'pic.png')
    expect(r).toEqual({ path: '/media/deadbeef.png', mime: 'image/png' })
  })

  it('returns null for an unknown token, unknown filename, or disallowed extension', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'doc.exe': { hash: 'abc', ext: '.exe' }, 'good.png': { hash: 'aaa', ext: '.png' } } })
    const token = mintMediaToken(ds.id)
    expect(await resolveMedia(db, '/media', 'badtoken', 'good.png')).toBeNull()
    expect(await resolveMedia(db, '/media', token, 'missing.png')).toBeNull()
    expect(await resolveMedia(db, '/media', token, 'doc.exe')).toBeNull() // ext not on allowlist
  })

  it('rejects a non-hex hash (defends against a poisoned media row)', async () => {
    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'x.png': { hash: '../etc/passwd', ext: '.png' } } })
    const token = mintMediaToken(ds.id)
    expect(await resolveMedia(db, '/media', token, 'x.png')).toBeNull()
  })

  it('a token for deck-set A cannot resolve deck-set B media', async () => {
    const dsA = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'a.png': { hash: 'aaa', ext: '.png' } } })
    const dsB = await writeCollection(db, { sourceFilename: 'b.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'b.png': { hash: 'bbb', ext: '.png' } } })
    const tokenA = mintMediaToken(dsA.id)
    expect(await resolveMedia(db, '/media', tokenA, 'b.png')).toBeNull() // B's file, A's token → denied
    expect(await resolveMedia(db, '/media', tokenA, 'a.png')).not.toBeNull()
    expect(dsB.id).toBeGreaterThan(dsA.id)
  })

  it('the MIME allowlist is closed (no echoing of the filename)', () => {
    expect(MIME_BY_EXT['.svg']).toBe('image/svg+xml')
    expect(MIME_BY_EXT['.exe']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/media-protocol.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `media-tokens.ts`**

```ts
// src/main/flashcards/media-tokens.ts
import { randomBytes } from 'node:crypto'

// Per-card capability tokens → deck-set id. Bounded, insertion-ordered eviction.
// A token authorizes ONLY its own deck-set's media (no global hash lookup).
const MAX_TOKENS = 256
const tokens = new Map<string, number>()

export function mintMediaToken(deckSetId: number): string {
  const token = randomBytes(16).toString('hex')
  tokens.set(token, deckSetId)
  while (tokens.size > MAX_TOKENS) {
    const oldest = tokens.keys().next().value
    if (oldest === undefined) break
    tokens.delete(oldest)
  }
  return token
}

export function resolveMediaToken(token: string): number | undefined {
  return tokens.get(token)
}

/** Test-only: clear all tokens. */
export function __resetMediaTokens(): void {
  tokens.clear()
}
```

- [ ] **Step 4: Implement `media-protocol.ts` (resolver + MIME; handler added in Task 7)**

```ts
// src/main/flashcards/media-protocol.ts
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { media } from '../db/schema'
import { resolveMediaToken } from './media-tokens'

/** Closed extension→MIME allowlist. The Content-Type is derived ONLY from this map —
 *  the untrusted filename is never echoed into the response. */
export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac'
}

const HEX_RE = /^[0-9a-f]+$/

export interface ResolvedMedia { path: string; mime: string }

/** Authorize + locate one media file. Returns null for any failure (caller 404s). */
export async function resolveMedia(db: DB, mediaDir: string, token: string, filename: string): Promise<ResolvedMedia | null> {
  const deckSetId = resolveMediaToken(token)
  if (deckSetId === undefined) return null
  const [row] = await db.select({ hash: media.hash, ext: media.ext })
    .from(media).where(and(eq(media.deckSetId, deckSetId), eq(media.filename, filename)))
  if (!row) return null
  if (!HEX_RE.test(row.hash)) return null // poisoned hash → refuse (no traversal)
  const ext = row.ext.toLowerCase()
  const mime = MIME_BY_EXT[ext]
  if (!mime) return null // extension not on the allowlist
  return { path: join(mediaDir, `${row.hash}${ext}`), mime }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/flashcards/media-protocol.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/flashcards/media-tokens.ts src/main/flashcards/media-protocol.ts test/flashcards/media-protocol.test.ts
git commit -m "feat(flashcards): per-card media capability tokens + resolver + closed MIME allowlist"
```

---

## Task 7: `freecat-media://` protocol handler + scheme registration + main wiring

**Files:**
- Create: `src/main/flashcards/paths.ts`
- Modify: `src/main/flashcards/media-protocol.ts` (add `createMediaHandler`)
- Modify: `src/main/ipc/flashcards.ts` (use `flashcardsMediaDir`)
- Modify: `src/main/index.ts` (register scheme + handle)
- Test: extend `test/flashcards/media-protocol.test.ts`

- [ ] **Step 1: Add the handler test (extends the Task 6 file)**

Append to `test/flashcards/media-protocol.test.ts` (and add `writeFileSync`/`mkdirSync`/`tmpdir`/`join`/`randomUUID` imports at the top):

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createMediaHandler } from '../../src/main/flashcards/media-protocol'
```

```ts
describe('createMediaHandler', () => {
  it('streams an authorized file with its allowlisted MIME, 404s everything else', async () => {
    const dir = join(tmpdir(), `fc-media-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cafe01.png'), new Uint8Array([1, 2, 3, 4]))

    const ds = await writeCollection(db, { sourceFilename: 'a.apkg', sourceFormat: 'legacy1', parsed: minimal, media: { 'pic.png': { hash: 'cafe01', ext: '.png' } } })
    const token = mintMediaToken(ds.id)
    const handler = createMediaHandler(db, dir)

    const ok = await handler({ url: `freecat-media://${token}/pic.png` } as unknown as Request)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))

    const bad = await handler({ url: `freecat-media://${token}/missing.png` } as unknown as Request)
    expect(bad.status).toBe(404)

    const badToken = await handler({ url: 'freecat-media://nope/pic.png' } as unknown as Request)
    expect(badToken.status).toBe(404)
  })

  it('never throws on a malformed url', async () => {
    const handler = createMediaHandler(db, '/media')
    const res = await handler({ url: 'freecat-media://' } as unknown as Request)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/media-protocol.test.ts`
Expected: FAIL — `createMediaHandler` not exported.

- [ ] **Step 3: Add `createMediaHandler` to `media-protocol.ts`**

Add imports at the top of `src/main/flashcards/media-protocol.ts`:

```ts
import { readFile } from 'node:fs/promises'
```

Append:

```ts
/** Build the protocol.handle handler. Reads only `request.url`, so it is unit-testable
 *  with a plain { url } object. Never throws — any failure becomes a 404. */
export function createMediaHandler(db: DB, mediaDir: string): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const token = url.hostname
      const filename = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!token || !filename) return new Response(null, { status: 404 })
      const resolved = await resolveMedia(db, mediaDir, token, filename)
      if (!resolved) return new Response(null, { status: 404 })
      const bytes = await readFile(resolved.path)
      return new Response(bytes, { status: 200, headers: { 'Content-Type': resolved.mime, 'Cache-Control': 'no-store' } })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
}
```

- [ ] **Step 4: Create `paths.ts` and use it from the IPC module**

```ts
// src/main/flashcards/paths.ts
import { join } from 'node:path'
import { app } from 'electron'

/** Where content-addressed media blobs live: <userData>/flashcards/media. */
export function flashcardsMediaDir(): string {
  return join(app.getPath('userData'), 'flashcards', 'media')
}
```

In `src/main/ipc/flashcards.ts`, remove the private `mediaDir()` function and its now-unneeded `join`/`app` imports if unused elsewhere, and import the shared helper. The file's import block + dialog call become:

```ts
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { importViaDialog } from '../flashcards/import'
import { listDeckSets, listDecks, listCards, deleteDeckSet } from '../repositories/flashcards'
import { flashcardsMediaDir } from '../flashcards/paths'
```

and the import handler line becomes:

```ts
  ipcMain.handle(CH.fcImportDeck, () => importViaDialog(db, flashcardsMediaDir()))
```

(`app` is no longer imported here. Leave the `getCard` handler for Task 8.)

- [ ] **Step 5: Wire the scheme + handler into `src/main/index.ts`**

Add `protocol` and `session` to the electron import:

```ts
import { app, BrowserWindow, dialog, protocol, session } from 'electron'
```

Add the new imports:

```ts
import { createMediaHandler } from './flashcards/media-protocol'
import { flashcardsMediaDir } from './flashcards/paths'
```

At module top level, **before** `app.whenReady()` (e.g. directly after the imports/`createWindow` definition, outside any function):

```ts
// Privileged scheme for in-iframe card media. Must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'freecat-media', privileges: { standard: true, secure: true, supportFetchEnabled: true, bypassCSP: false } }
])
```

Inside `app.whenReady().then(async () => { … })`, after `registerFlashcardsIpc(db)` and **before** `createWindow()`:

```ts
  protocol.handle('freecat-media', createMediaHandler(db, flashcardsMediaDir()))
```

- [ ] **Step 6: Run tests + build to verify wiring compiles**

Run: `npx vitest run test/flashcards/media-protocol.test.ts && npx tsc --noEmit && npm run build`
Expected: media-protocol tests PASS (8 total); tsc clean; `electron-vite build` succeeds (main bundle includes the protocol handler).

- [ ] **Step 7: Commit**

```bash
git add src/main/flashcards/media-protocol.ts src/main/flashcards/paths.ts src/main/ipc/flashcards.ts src/main/index.ts test/flashcards/media-protocol.test.ts
git commit -m "feat(flashcards): register freecat-media:// privileged scheme + protocol handler in main"
```

---

## Task 8: `getCard` IPC handler + `CardView` mapping

**Files:**
- Create: `src/main/flashcards/card-view.ts`
- Modify: `src/main/ipc/flashcards.ts`
- Test: `test/flashcards/card-view.test.ts`
- Test: extend `test/flashcards/ipc-validation.test.ts`

`getCard` (repo) returns a `CardSource` (with content hashes + `deckSetId`). The IPC handler mints a deck-set-scoped capability token and maps it to the public `CardView`, turning each referenced filename into a `freecat-media://<token>/<filename>` URL. `toCardView` is a pure, electron-free function so it is unit-testable.

- [ ] **Step 1: Write the failing tests**

```ts
// test/flashcards/card-view.test.ts
import { describe, it, expect } from 'vitest'
import { toCardView, mediaUrl } from '../../src/main/flashcards/card-view'
import type { CardSource } from '../../src/main/repositories/flashcards'

const source: CardSource = {
  cardId: 7, deckSetId: 3, renderKind: 'basic', css: 'x', qfmt: 'q', afmt: 'a',
  fields: [{ name: 'Front', value: 'F' }], tags: ['t'], noteTypeName: 'Basic',
  deckName: 'D::S', subdeckName: 'S', templateName: 'C1', clozeOrdinal: null,
  media: [{ filename: 'a b.png', hash: 'aa', ext: '.png' }]
}

describe('mediaUrl', () => {
  it('URL-encodes the filename under the token host', () => {
    expect(mediaUrl('tok', 'a b.png')).toBe('freecat-media://tok/a%20b.png')
  })
})

describe('toCardView', () => {
  it('drops deckSetId/hash and builds tokenized media urls', () => {
    const v = toCardView(source, 'tok123')
    expect(v).toEqual({
      cardId: 7, renderKind: 'basic', css: 'x', qfmt: 'q', afmt: 'a',
      fields: [{ name: 'Front', value: 'F' }], tags: ['t'], noteTypeName: 'Basic',
      deckName: 'D::S', subdeckName: 'S', templateName: 'C1', clozeOrdinal: null,
      mediaMap: [{ filename: 'a b.png', url: 'freecat-media://tok123/a%20b.png' }]
    })
    expect('deckSetId' in v).toBe(false)
  })
})
```

Append to `test/flashcards/ipc-validation.test.ts`:

```ts
import { deckSetIdSchema, listCardsSchema, getCardSchema } from '../../src/main/ipc/flashcards'
```

(replace the existing import line) and add a case inside the describe block:

```ts
  it('getCardSchema requires a positive int', () => {
    expect(getCardSchema.safeParse(7).success).toBe(true)
    expect(getCardSchema.safeParse(0).success).toBe(false)
    expect(getCardSchema.safeParse('7').success).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/flashcards/card-view.test.ts test/flashcards/ipc-validation.test.ts`
Expected: FAIL — `card-view` module + `getCardSchema` not found.

- [ ] **Step 3: Implement `card-view.ts`**

```ts
// src/main/flashcards/card-view.ts
import type { CardView } from '../../shared/dto'
import type { CardSource } from '../repositories/flashcards'

export function mediaUrl(token: string, filename: string): string {
  return `freecat-media://${token}/${encodeURIComponent(filename)}`
}

/** Map the internal CardSource to the renderer-facing CardView, minting tokenized
 *  media URLs and dropping the deck-set id + content hashes. */
export function toCardView(source: CardSource, token: string): CardView {
  return {
    cardId: source.cardId,
    renderKind: source.renderKind,
    css: source.css,
    qfmt: source.qfmt,
    afmt: source.afmt,
    fields: source.fields,
    tags: source.tags,
    noteTypeName: source.noteTypeName,
    deckName: source.deckName,
    subdeckName: source.subdeckName,
    templateName: source.templateName,
    clozeOrdinal: source.clozeOrdinal,
    mediaMap: source.media.map((m) => ({ filename: m.filename, url: mediaUrl(token, m.filename) }))
  }
}
```

- [ ] **Step 4: Add the `getCard` IPC handler**

In `src/main/ipc/flashcards.ts`, add imports:

```ts
import { ok } from '../../shared/dto'
import { getCard } from '../repositories/flashcards'
import { mintMediaToken } from '../flashcards/media-tokens'
import { toCardView } from '../flashcards/card-view'
```

(merge `getCard` into the existing repositories import line). Add the schema next to the others:

```ts
export const getCardSchema = z.number().int().positive()
```

Add the handler inside `registerFlashcardsIpc`, after `fcListCards`:

```ts
  ipcMain.handle(CH.fcGetCard, async (_e, raw: unknown) => {
    const id = getCardSchema.parse(raw)
    const res = await getCard(db, id)
    if (!res.ok) return res
    const token = mintMediaToken(res.data.deckSetId)
    return ok(toCardView(res.data, token))
  })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/flashcards/card-view.test.ts test/flashcards/ipc-validation.test.ts && npx tsc --noEmit`
Expected: PASS (card-view 2; ipc-validation 3); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/flashcards/card-view.ts src/main/ipc/flashcards.ts test/flashcards/card-view.test.ts test/flashcards/ipc-validation.test.ts
git commit -m "feat(flashcards): flashcards:getCard IPC handler mints media token + maps CardView"
```

---

## Task 9: MathJax asset (renderer) + dependency

**Files:**
- Modify: `package.json`
- Create: `src/renderer/src/flashcards/mathjax-asset.ts`

- [ ] **Step 1: Install MathJax as a runtime dependency**

Run: `npm install mathjax@3`
Expected: `mathjax` added to `dependencies` in `package.json`; `node_modules/mathjax/es5/tex-svg-full.js` exists.

Verify the file is present:
Run: `ls node_modules/mathjax/es5/tex-svg-full.js`
Expected: the path prints (no error).

- [ ] **Step 2: Create the asset module**

```ts
// src/renderer/src/flashcards/mathjax-asset.ts
// The full self-contained MathJax 3 SVG build, inlined as a string at build time via
// Vite's ?raw. SVG output embeds glyph paths in this bundle — no @font-face, no network —
// so math typesets under the iframe's `default-src 'none'` CSP. ('?raw' is typed by
// vite/client, referenced in src/renderer/src/env.d.ts.)
import mathjaxSvg from 'mathjax/es5/tex-svg-full.js?raw'

export const MATHJAX_SVG_SRC: string = mathjaxSvg
```

- [ ] **Step 3: Verify the renderer build inlines it**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean (the `*?raw` ambient from `vite/client` resolves the import to `string`); `electron-vite build` succeeds and the renderer bundle grows by ~1.5 MB (the inlined MathJax).

> If tsc reports the `?raw` import is untyped, add this line to `src/renderer/src/env.d.ts` (above `export {}`): `declare module '*?raw' { const src: string; export default src }`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/src/flashcards/mathjax-asset.ts
git commit -m "feat(flashcards): bundle self-contained MathJax SVG build via ?raw"
```

---

## Task 10: `CardViewer` component + no-parent-DOM invariant test

**Files:**
- Modify: `package.json` (add `jsdom` devDependency)
- Modify: `vitest.config.ts` (collect `.test.tsx`)
- Create: `src/renderer/src/flashcards/CardViewer.tsx`
- Test: `test/flashcards/viewer.test.tsx` (jsdom)

The viewer loads `getCard`, builds the srcdoc with the shared engine, and assigns it **only** to `iframe.srcdoc` (never parent `innerHTML`). It handles front/back flip, degradation placeholders, and the hardened height postMessage listener (verify `event.source`, validate the payload shape, clamp ≤ 50000px).

- [ ] **Step 1: Install jsdom + React Testing Library, and let vitest collect `.test.tsx`**

Run: `npm install -D jsdom @testing-library/react @testing-library/dom`
Expected: added to `devDependencies`. (`@testing-library/react` drives the component tests; `jsdom` provides DOM via the per-file pragma.)

Then widen the test glob in `vitest.config.ts` (it currently matches only `*.test.ts`, so the new `.test.tsx` files would be silently skipped by `npm test`):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globalSetup: ['test/global-setup.ts']
  }
})
```

(`environment: 'node'` stays the global default; the two component files opt into jsdom via their first-line `// @vitest-environment jsdom` pragma.)

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
// test/flashcards/viewer.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type { CardView } from '../../src/shared/dto'

// Keep the 1.5 MB MathJax string out of the test.
vi.mock('../../src/renderer/src/flashcards/mathjax-asset', () => ({ MATHJAX_SVG_SRC: '' }))

import { CardViewer } from '../../src/renderer/src/flashcards/CardViewer'

const SENTINEL = 'INJECT_SENTINEL_DO_NOT_LEAK'

function cardView(over: Partial<CardView> = {}): CardView {
  return {
    cardId: 1, renderKind: 'basic', css: '.fc-card{}',
    qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}',
    fields: [{ name: 'Front', value: SENTINEL }, { name: 'Back', value: 'BACKTEXT' }],
    tags: [], noteTypeName: 'Basic', deckName: 'D', subdeckName: 'D', templateName: 'C',
    clozeOrdinal: null, mediaMap: [], ...over
  }
}

function stubFreecat(getCard: (id: number) => Promise<{ ok: true; data: CardView } | { ok: false; error: string }>): void {
  // @ts-expect-error partial stub of the preload bridge for tests
  globalThis.window.freecat = { flashcards: { getCard } }
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => cleanup())

describe('CardViewer', () => {
  it('renders card HTML ONLY inside iframe.srcdoc, never the parent DOM', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView() }))
    render(<CardViewer cardId={1} />)
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain(SENTINEL))
    // The card content lives ONLY as the srcdoc string — it is never parsed into the parent document.
    expect(document.querySelector('.fc-card')).toBeNull()
    expect(document.querySelector('iframe[srcdoc]')).toBe(iframe) // the one and only place the HTML lands
  })

  it('flips to the answer side and re-renders the srcdoc', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView() }))
    render(<CardViewer cardId={1} />)
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain(SENTINEL))
    expect(iframe.getAttribute('srcdoc') ?? '').not.toContain('BACKTEXT')
    fireEvent.click(screen.getByText('Show answer'))
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain('BACKTEXT'))
  })

  it('shows a placeholder for image-occlusion and unsupported, no iframe', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView({ renderKind: 'image-occlusion' }) }))
    render(<CardViewer cardId={1} />)
    await screen.findByText(/Image Occlusion/i)
    expect(screen.queryByTitle('card')).toBeNull()
  })

  it('shows a friendly error when getCard fails', async () => {
    stubFreecat(async () => ({ ok: false, error: 'card-not-found' }))
    render(<CardViewer cardId={1} />)
    await screen.findByText(/could not be loaded/i)
  })

  it('ignores postMessage from a foreign source and clamps height', async () => {
    stubFreecat(async () => ({ ok: true, data: cardView() }))
    render(<CardViewer cardId={1} />)
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain(SENTINEL))
    // Foreign source (window, not the iframe's contentWindow) → ignored, no throw.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'fc-height', height: 999999 }, source: window }))
    // Height stays at its default (clamp + source check both hold); component still mounted.
    expect(screen.getByTitle('card')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/viewer.test.tsx`
Expected: FAIL — `CardViewer` not found.

- [ ] **Step 4: Implement `CardViewer.tsx`**

```tsx
// src/renderer/src/flashcards/CardViewer.tsx
import { useEffect, useRef, useState } from 'react'
import type { CardView } from '../../../shared/dto'
import { buildCardHtml } from '../../../shared/flashcards/render'
import { MATHJAX_SVG_SRC } from './mathjax-asset'

const MAX_IFRAME_HEIGHT = 50000

export function CardViewer({ cardId }: { cardId: number }): React.JSX.Element {
  const [view, setView] = useState<CardView | null>(null)
  const [side, setSide] = useState<'question' | 'answer'>('question')
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(160)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Load the card whenever the selection changes; reset to the question side.
  useEffect(() => {
    let active = true
    setView(null); setFailed(false); setSide('question')
    window.freecat.flashcards
      .getCard(cardId)
      .then((res) => { if (active) { if (res.ok) setView(res.data); else setFailed(true) } })
      .catch((e) => { console.error('getCard failed', e); if (active) setFailed(true) })
    return () => { active = false }
  }, [cardId])

  // Hardened height shim: only our iframe, only the exact payload, clamped.
  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const d = e.data as unknown
      if (!d || typeof d !== 'object') return
      const msg = d as { type?: unknown; height?: unknown }
      if (msg.type !== 'fc-height' || typeof msg.height !== 'number' || !Number.isFinite(msg.height)) return
      setHeight(Math.max(40, Math.min(MAX_IFRAME_HEIGHT, Math.ceil(msg.height))))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (failed) return <div className="rounded-lg bg-amber-50 p-6 text-amber-800">This card could not be loaded.</div>
  if (!view) return <div className="p-6 text-gray-400">Loading…</div>

  if (view.renderKind === 'image-occlusion')
    return <Placeholder title="Image Occlusion card" body="Rendering coming in a later milestone." />
  if (view.renderKind === 'unsupported')
    return <Placeholder title="Unsupported note type" body="This note type isn't supported yet." />

  const srcDoc = buildCardHtml(view, side, MATHJAX_SVG_SRC)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSide(side === 'question' ? 'answer' : 'question')}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {side === 'question' ? 'Show answer' : 'Show question'}
        </button>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-500">{view.renderKind}</span>
        <span className="truncate text-xs text-gray-400">{view.deckName} · {view.noteTypeName}</span>
      </div>
      <iframe
        ref={iframeRef}
        title="card"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ width: '100%', height, border: 'none' }}
        className="rounded-lg bg-white ring-1 ring-gray-200"
      />
    </div>
  )
}

function Placeholder({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
      <p className="font-semibold text-gray-700">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/flashcards/viewer.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/renderer/src/flashcards/CardViewer.tsx test/flashcards/viewer.test.tsx
git commit -m "feat(flashcards): sandboxed CardViewer (srcdoc-only, flip, hardened height shim, placeholders)"
```

---

## Task 11: Browse page (`Flashcards.tsx`)

**Files:**
- Modify: `src/renderer/src/pages/Flashcards.tsx`
- Test: `test/flashcards/flashcards-page.test.tsx` (jsdom)

Empty state + import button; left deck/subdeck tree (collapse/expand, per-deck-set delete); center keyset-paged card list (load-more, renderKind badge, preview); right viewer (one live iframe). Reuses the shared `errorMessage` copy. The import dialog cancel is reported as `'invalid'` by `importViaDialog` — treat it as a silent no-op, not an error.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// test/flashcards/flashcards-page.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type { DeckSetSummary, DeckNode, CardListPage, CardView } from '../../src/shared/dto'

vi.mock('../../src/renderer/src/flashcards/mathjax-asset', () => ({ MATHJAX_SVG_SRC: '' }))
import Flashcards from '../../src/renderer/src/pages/Flashcards'

type Freecat = {
  flashcards: {
    listDeckSets: () => Promise<DeckSetSummary[]>
    listDecks: (id: number) => Promise<DeckNode[]>
    listCards: (input: { deckId: number; afterId?: number; limit?: number }) => Promise<CardListPage>
    getCard: (id: number) => Promise<{ ok: true; data: CardView } | { ok: false; error: string }>
    importDeck: () => Promise<{ ok: true; data: DeckSetSummary } | { ok: false; error: string }>
    deleteDeckSet: (id: number) => Promise<{ ok: true; data: null } | { ok: false; error: string }>
  }
}
function stub(over: Partial<Freecat['flashcards']> = {}): void {
  const base: Freecat['flashcards'] = {
    listDeckSets: async () => [],
    listDecks: async () => [],
    listCards: async () => ({ cards: [], nextAfterId: null }),
    getCard: async () => ({ ok: false, error: 'card-not-found' }),
    importDeck: async () => ({ ok: false, error: 'invalid' }),
    deleteDeckSet: async () => ({ ok: true, data: null })
  }
  // @ts-expect-error partial bridge stub
  globalThis.window.freecat = { flashcards: { ...base, ...over } }
}

afterEach(() => cleanup())
beforeEach(() => vi.restoreAllMocks())

const ds: DeckSetSummary = { id: 1, sourceFilename: 'deck.apkg', deckCount: 1, cardCount: 2, importedAt: new Date() }
const tree: DeckNode[] = [{ deckId: 10, name: 'MCAT', leafName: 'MCAT', cardCount: 2, children: [{ deckId: 11, name: 'MCAT::Bio', leafName: 'Bio', cardCount: 2, children: [] }] }]

describe('Flashcards page', () => {
  it('shows the empty state with an import button when there are no decks', async () => {
    stub()
    render(<Flashcards />)
    await screen.findByText(/No decks yet/i)
    expect(screen.getByText(/Import deck/i)).toBeTruthy()
  })

  it('renders the deck tree, lists cards on select, and previews a card', async () => {
    const card: CardView = {
      cardId: 100, renderKind: 'basic', css: '', qfmt: '{{Front}}', afmt: '{{Back}}',
      fields: [{ name: 'Front', value: 'HELLOQ' }, { name: 'Back', value: 'B' }], tags: [],
      noteTypeName: 'Basic', deckName: 'MCAT::Bio', subdeckName: 'Bio', templateName: 'C', clozeOrdinal: null, mediaMap: []
    }
    stub({
      listDeckSets: async () => [ds],
      listDecks: async () => tree,
      listCards: async () => ({ cards: [{ cardId: 100, renderKind: 'basic', preview: 'a preview' }], nextAfterId: null }),
      getCard: async () => ({ ok: true, data: card })
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/Bio/)) // button text is "Bio (2)" — regex matches the leaf
    fireEvent.click(await screen.findByText(/a preview/))
    const iframe = await screen.findByTitle('card') as HTMLIFrameElement
    await waitFor(() => expect(iframe.getAttribute('srcdoc') ?? '').toContain('HELLOQ'))
  })

  it('refreshes the deck list after a successful import', async () => {
    let sets: DeckSetSummary[] = []
    stub({
      listDeckSets: async () => sets,
      importDeck: async () => { sets = [ds]; return { ok: true, data: ds } }
    })
    render(<Flashcards />)
    fireEvent.click(await screen.findByText(/Import deck/i))
    await screen.findByText('deck.apkg')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/flashcards/flashcards-page.test.tsx`
Expected: FAIL — the stub page renders "Coming in Module 3", not the browse UI.

- [ ] **Step 3: Implement `Flashcards.tsx`**

```tsx
// src/renderer/src/pages/Flashcards.tsx
import { useCallback, useEffect, useState } from 'react'
import type { DeckSetSummary, DeckNode, CardListItem } from '../../../shared/dto'
import type { PageProps } from '../App'
import { errorMessage } from '../gamification/labels'
import { CardViewer } from '../flashcards/CardViewer'

export default function Flashcards(_props: PageProps): React.JSX.Element {
  const [deckSets, setDeckSets] = useState<DeckSetSummary[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)

  const loadDeckSets = useCallback(async () => {
    try { setDeckSets(await window.freecat.flashcards.listDeckSets()) }
    catch (e) { console.error('listDeckSets failed', e); setDeckSets([]) }
  }, [])

  useEffect(() => { void loadDeckSets() }, [loadDeckSets])

  const onImport = useCallback(async () => {
    setImporting(true); setError(null)
    try {
      const res = await window.freecat.flashcards.importDeck()
      if (res.ok) await loadDeckSets()
      else if (res.error !== 'invalid') setError(errorMessage(res.error)) // 'invalid' = dialog canceled
    } catch (e) {
      console.error('import failed', e); setError('Import failed. Please try again.')
    } finally { setImporting(false) }
  }, [loadDeckSets])

  if (deckSets === null) return <div className="p-8 text-gray-400">Loading…</div>

  if (deckSets.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center p-16 text-center">
        <div className="text-6xl" aria-hidden>🗂️</div>
        <h2 className="mt-4 text-2xl font-bold text-gray-800">No decks yet</h2>
        <p className="mt-2 text-gray-500">Import an Anki deck package (.apkg or .colpkg) to start browsing your cards.</p>
        <ImportButton importing={importing} onImport={onImport} />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 overflow-auto border-r border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Decks</h2>
          <ImportButton importing={importing} onImport={onImport} compact />
        </div>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="space-y-4">
          {deckSets.map((ds) => (
            <DeckSetBlock
              key={ds.id}
              ds={ds}
              selectedDeckId={selectedDeckId}
              onSelectDeck={(id) => { setSelectedDeckId(id); setSelectedCardId(null) }}
              onDeleted={() => { setSelectedDeckId(null); setSelectedCardId(null); void loadDeckSets() }}
            />
          ))}
        </div>
      </aside>

      <section className="w-80 shrink-0 overflow-auto border-r border-gray-200">
        {selectedDeckId === null
          ? <p className="p-4 text-sm text-gray-400">Select a deck to see its cards.</p>
          : <CardList deckId={selectedDeckId} selectedCardId={selectedCardId} onSelect={setSelectedCardId} />}
      </section>

      <main className="flex-1 overflow-auto p-4">
        {selectedCardId === null
          ? <p className="p-4 text-sm text-gray-400">Select a card to preview it.</p>
          : <CardViewer cardId={selectedCardId} />}
      </main>
    </div>
  )
}

function ImportButton({ importing, onImport, compact = false }: { importing: boolean; onImport: () => void; compact?: boolean }): React.JSX.Element {
  return (
    <button
      onClick={onImport}
      disabled={importing}
      className={`rounded-lg bg-blue-600 font-medium text-white hover:bg-blue-700 disabled:opacity-50 ${compact ? 'px-2 py-1 text-xs' : 'mt-6 px-5 py-2.5'}`}
    >
      {importing ? 'Importing…' : compact ? '+ Import' : 'Import deck (.apkg/.colpkg)'}
    </button>
  )
}

function DeckSetBlock({ ds, selectedDeckId, onSelectDeck, onDeleted }: {
  ds: DeckSetSummary
  selectedDeckId: number | null
  onSelectDeck: (id: number) => void
  onDeleted: () => void
}): React.JSX.Element {
  const [decks, setDecks] = useState<DeckNode[] | null>(null)

  useEffect(() => {
    let active = true
    window.freecat.flashcards.listDecks(ds.id)
      .then((d) => { if (active) setDecks(d) })
      .catch((e) => { console.error('listDecks failed', e); if (active) setDecks([]) })
    return () => { active = false }
  }, [ds.id])

  const onDelete = useCallback(async () => {
    try { await window.freecat.flashcards.deleteDeckSet(ds.id) }
    catch (e) { console.error('deleteDeckSet failed', e) }
    finally { onDeleted() }
  }, [ds.id, onDeleted])

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-400" title={ds.sourceFilename}>{ds.sourceFilename}</span>
        <button onClick={onDelete} title="Delete this import" className="text-gray-300 hover:text-red-500">✕</button>
      </div>
      <div className="mt-1">
        {decks === null
          ? <p className="text-xs text-gray-300">Loading…</p>
          : decks.map((d) => <DeckRow key={d.deckId} node={d} depth={0} selectedDeckId={selectedDeckId} onSelectDeck={onSelectDeck} />)}
      </div>
    </div>
  )
}

function DeckRow({ node, depth, selectedDeckId, onSelectDeck }: {
  node: DeckNode
  depth: number
  selectedDeckId: number | null
  onSelectDeck: (id: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
        {hasChildren
          ? <button onClick={() => setOpen(!open)} className="w-4 shrink-0 text-gray-400" aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
          : <span className="w-4 shrink-0" />}
        <button
          onClick={() => onSelectDeck(node.deckId)}
          className={`flex-1 truncate rounded px-2 py-1 text-left text-sm ${selectedDeckId === node.deckId ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
        >
          {node.leafName} <span className="text-xs opacity-60">({node.cardCount})</span>
        </button>
      </div>
      {hasChildren && open && node.children.map((c) => (
        <DeckRow key={c.deckId} node={c} depth={depth + 1} selectedDeckId={selectedDeckId} onSelectDeck={onSelectDeck} />
      ))}
    </div>
  )
}

function CardList({ deckId, selectedCardId, onSelect }: {
  deckId: number
  selectedCardId: number | null
  onSelect: (id: number) => void
}): React.JSX.Element {
  const [cards, setCards] = useState<CardListItem[]>([])
  const [nextAfterId, setNextAfterId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const loadPage = useCallback(async (after: number | null) => {
    setLoading(true)
    try {
      const page = await window.freecat.flashcards.listCards({ deckId, afterId: after ?? undefined, limit: 50 })
      setCards((prev) => (after === null ? page.cards : [...prev, ...page.cards]))
      setNextAfterId(page.nextAfterId)
    } catch (e) { console.error('listCards failed', e) }
    finally { setLoading(false) }
  }, [deckId])

  useEffect(() => { setCards([]); setNextAfterId(null); void loadPage(null) }, [deckId, loadPage])

  if (cards.length === 0 && !loading) return <p className="p-4 text-sm text-gray-400">No cards in this deck.</p>

  return (
    <ul className="divide-y divide-gray-100">
      {cards.map((c) => (
        <li key={c.cardId}>
          <button
            onClick={() => onSelect(c.cardId)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left ${selectedCardId === c.cardId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
          >
            <RenderKindBadge kind={c.renderKind} />
            <span className="flex-1 truncate text-sm text-gray-700">{c.preview || '(empty)'}</span>
          </button>
        </li>
      ))}
      {nextAfterId !== null && (
        <li className="p-2">
          <button
            onClick={() => void loadPage(nextAfterId)}
            disabled={loading}
            className="w-full rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </li>
      )}
    </ul>
  )
}

function RenderKindBadge({ kind }: { kind: CardListItem['renderKind'] }): React.JSX.Element {
  const cls: Record<CardListItem['renderKind'], string> = {
    basic: 'bg-emerald-100 text-emerald-700',
    cloze: 'bg-violet-100 text-violet-700',
    'image-occlusion': 'bg-amber-100 text-amber-700',
    unsupported: 'bg-gray-100 text-gray-500'
  }
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls[kind]}`}>{kind === 'image-occlusion' ? 'IO' : kind}</span>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/flashcards/flashcards-page.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Flashcards.tsx test/flashcards/flashcards-page.test.tsx
git commit -m "feat(flashcards): browse UI (empty state, import, deck tree, paged card list, viewer)"
```

---

## Task 12: App-document CSP (O4) + full sweep + acceptance checklist

**Files:**
- Modify: `src/main/index.ts`
- Create: `docs/handoffs/flashcards-m1-plan2-acceptance.md`

- [ ] **Step 1: Add the production app-document CSP**

In `src/main/index.ts`, add the policy constant near the top (after imports):

```ts
// Minimal app-document CSP (O4): production only — a static <meta> would break Vite dev
// HMR (inline scripts + eval + ws). The card iframe carries its own strict CSP regardless.
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; frame-src 'self'; connect-src 'self'; " +
  "object-src 'none'; base-uri 'self'"
```

Inside `app.whenReady().then(async () => { … })`, after `protocol.handle('freecat-media', …)` and **before** `createWindow()`:

```ts
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [APP_CSP] } })
    })
  }
```

- [ ] **Step 2: Typecheck + build + full test sweep**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: tsc clean; `electron-vite build` succeeds; **all** tests pass (Plan 1's 105 + Plan 2's new suites). Note the final counts.

- [ ] **Step 3: Write the manual acceptance checklist**

These gates need a real Electron run (jsdom cannot exercise a CSP/iframe sandbox). Create `docs/handoffs/flashcards-m1-plan2-acceptance.md`:

```markdown
# Flashcards M1 Plan 2 — manual acceptance gates

Run `npm run dev`, open the Flashcards tab.

## MathJax CSP confirmation
- [ ] Import a deck with a MathJax card (e.g. a `[$]x^2[/$]` note). Open it; confirm math typesets.
- [ ] DevTools console shows **no** "call to eval() blocked by CSP". (Iframe `script-src 'unsafe-inline' 'unsafe-eval'` is expected and required — O5.)

## Media subresource confirmation
- [ ] A card with an image paints the image (served via `freecat-media://`).
- [ ] In the iframe's DevTools console, `fetch('freecat-media://<token>/<file>')` is **rejected** (blocked by `default-src 'none'`, no `connect-src`). Media is subresource-only.
- [ ] An image referenced by another deck-set's filename does **not** load (cross-deck-set token denial).

## Isolation
- [ ] The iframe is `sandbox="allow-scripts"` (no `allow-same-origin`); card JS cannot read `window.parent.freecat` (opaque origin).

## Real-deck acceptance (O3)
- [ ] Download `https://ankiweb.net/shared/info/178384887` as `.apkg` (do NOT commit it — copyright), import it, and eyeball: Basic + Cloze render faithfully; image cards show images; `[sound:]` shows the inert chip; Image-Occlusion / unsupported notes show their placeholder and never crash or get skipped.

## Production CSP (optional, if packaging)
- [ ] In a packaged build, the app document response carries the `APP_CSP` header (`script-src 'self'`), and the card iframe still renders.
```

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts docs/handoffs/flashcards-m1-plan2-acceptance.md
git commit -m "feat(flashcards): production app-document CSP (O4) + M1 Plan 2 acceptance checklist"
```

---

## Final review (after all tasks)

Dispatch a final code reviewer over the whole Plan 2 diff (`git diff origin/main...HEAD -- 'src/**/flashcards*' 'src/shared/flashcards/**' 'src/renderer/src/flashcards/**' src/main/index.ts`), focusing on: the srcdoc-only invariant (no parent `innerHTML`), the token authorization path (no global hash lookup), the closed MIME allowlist, the cloze reveal-all/`data-cloze` fidelity, and the prod-gated CSP. Then run `superpowers:finishing-a-development-branch`.

---

## Spec coverage map (self-review)

- **C3 `getCard`** → Tasks 1 (DTO/channel/api/preload), 2 (repo), 8 (IPC, token mint, mapping). Zod `getCardSchema` ✓.
- **C4a render isolation** → Task 10 (`<iframe sandbox="allow-scripts">` srcdoc, opaque origin; height postMessage with source check + payload validation + ≤50000 clamp). Layer-1 app CSP → Task 12 (prod-gated). Layer-2 iframe CSP → Task 5 (`IFRAME_CSP`).
- **C4b template engine** → Tasks 3 (cloze), 4 (template), 5 (assembler). srcdoc-only invariant → Task 10 test.
- **C4c MathJax** → Tasks 5 (config: disabled `$`/`$$`, `\(`/`\[`, `[$]`/`[$$]` preprocess, conditional inline) + 9 (self-contained `tex-svg-full` via `?raw`). `'unsafe-eval'` accepted (O5); MathJax-CSP gate → Task 12 checklist.
- **C4d media protocol** → Tasks 6 (tokens + resolver + MIME), 7 (scheme reg + `protocol.handle` at the two pinned insertion points). Capability token, hex-basename validation, closed MIME allowlist, no global hash lookup ✓. Media-subresource gate → Task 12 checklist.
- **C4e graceful degradation** → renderKind badge in the list (Plan 1 `listCards`) + Task 10 placeholders + Task 5 `[sound:]` chip. Never crash/skip ✓.
- **C5 browse UI** → Task 11 (empty state + import, deck/subdeck tree, keyset-paged list, single viewer + flip). One live iframe ✓.
- **Security** → opaque-origin sandbox (10), no-parent-DOM tested invariant (10), protocol traversal/content-type allowlist/token (6, 7), postMessage hardening (10), both CSP layers (5, 12).
- **O1–O5** → O1 (read-write temp copy) Plan 1; O2 (dev wasm zstd) Plan 3; O3 (real-deck) Task 12 checklist; O4 (self-landed app CSP) Task 12; O5 (`'unsafe-eval'`) Tasks 5/9.
- **Out of scope (correctly absent):** FSRS/review/grading, gamification hooks, full image-occlusion masks, audio playback, modern `.colpkg` (Plan 3).
