# FreeCAT Flashcards — Milestone 1 (Import + Browse + Pragmatic Render) — Design Spec

> Milestone 1 of Module 3 (Flashcards) for FreeCAT, the free, open-source, local-first Electron MCAT study app: a faithful local Anki reviewer for bring-your-own imported decks (`.apkg`/`.colpkg`). **Read `docs/freecat-charter.md` and `docs/handoffs/flashcards.md` first** for product context and the module charter; this spec assumes the Foundation contracts described in `docs/superpowers/specs/2026-06-20-foundation-design.md`.

## Goal (one sentence)

Let a user import a bring-your-own Anki deck package (`.apkg` or `.colpkg`, legacy or modern), normalize it once into our own full-fidelity Drizzle tables (discarding the original Anki SQLite), and **browse** every card — faithfully rendering Basic and Cloze note types (field-conditionals, `{{hint:}}`, images, MathJax, per-note-type CSS) and showing a clean "rendering coming in a later milestone" placeholder for everything we can't yet render — with **no reviews, no scheduling, and no gamification** in M1.

## Scope — In / Out

**IN (Milestone 1):**
- Import via a MAIN-process file dialog; full container-format detection across `VERSION_LEGACY_1` (`collection.anki2`), `VERSION_LEGACY_2` (`collection.anki21`), and `VERSION_LATEST` (`collection.anki21b`, zstd + protobuf media) — both `.apkg` and `.colpkg`.
- ETL of both SQLite schema generations (legacy `col` JSON blobs, `ver=11`; modern normalized `notetypes`/`fields`/`templates`/`decks` tables, `ver=18`) into our own clean, **full-fidelity** Drizzle tables.
- Preserve Anki stable IDs (note `guid`, note-type id, deck id) as columns even though M1 never reads them.
- Content-addressed media extraction + dedup (images **and** audio blobs stored, audio not yet played).
- Browse: deck/subdeck tree, keyset-paged card list, single sandboxed-iframe card viewer with front/back flip.
- Faithful render of Basic + Cloze (conditionals `{{#}}/{{^}}/{{/}}`, `{{hint:}}`, `{{text:}}`, `{{cloze:}}`, special fields), images, MathJax, and each note type's own CSS.
- Graceful degradation: image-occlusion (both families) and exotic/audio-reliant note types **browse** and show a placeholder/inert chip; never crash, never skip.
- Delete a deck-set.

**OUT of M1, deferred to later milestones (storage already accommodates them additively — no re-migration):**
- FSRS scheduling, the review UI, `reviewCard`/answer grading, scheduling-history import (M2+).
- Gamification: **no** `recordActivity`, no coins/XP, no `flashcard.review` activity kind (M2).
- Full image-occlusion mask rendering (M1 = detect + placeholder only; full IO is the **final** milestone).
- Audio playback, merge-on-reimport / dedup across imports, streamed import progress.

**OUT of the module entirely:** AnkiWeb sync, export to `.apkg`, filtered decks, add-ons.

## Architecture overview

All untrusted I/O and parsing live in the hardened Electron **main** process; the **renderer** stays fully sandboxed (`sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`) and receives only typed DTOs plus media via a privileged custom protocol.

```
[Renderer: Flashcards.tsx]
   │  window.freecat.flashcards.*  (typed IPC, FreecatApi)
   ▼
[MAIN: ipc/flashcards.ts]  ── Zod .parse(raw) at boundary
   │
   ├─ Import pipeline (src/main/flashcards/*)
   │     dialog.showOpenDialog → central-dir enumerate → format detect
   │     → streaming unzip (fflate) → streaming zstd (fzstd) → protobuf (protobufjs)
   │     → raw @libsql/client over temp collection (parse) → ParsedCollection
   │     → media: content-addressed hashed files (dedup) + filename→hash map
   │     → ETL: ONE db.transaction → normalized Drizzle tables → discard temp SQLite
   │
   ├─ Repository (src/main/repositories/flashcards.ts)  ── DB-param, .returning(), ServiceResult
   │     reads: deck_sets / decks / notes / cards (keyset paging) → View DTOs
   │
   └─ protocol.handle('freecat-media')  ── streams content-addressed media to the iframe

[Renderer card viewer]
   getCard → DTO (css, qfmt, afmt, fields, mediaMap, renderKind, clozeOrdinal)
   → pure template engine (src/shared/flashcards) builds an HTML string
   → assigned ONLY to <iframe sandbox="allow-scripts"> srcdoc (opaque origin)
   → card CSS + bundled MathJax run inside the iframe; <img src> rewritten to freecat-media://
```

Data flow (one line): **user picks file → MAIN detects format, unzips/decompresses, parses both SQLite schemas into a common `ParsedCollection`, hashes+stores media, ETLs into normalized tables in one transaction, discards the Anki SQLite → renderer browses via typed IPC and renders each card inside an opaque-origin sandboxed iframe fed media through `freecat-media://`.**

## Components

### C1 — Import pipeline & format readers (MAIN)

**Purpose:** Turn an untrusted package file into a validated, normalized `ParsedCollection` plus hashed media, then ETL it.

**Interface:** triggered by `importDeck()` IPC (no args from renderer). MAIN runs `dialog.showOpenDialog` (filters `.apkg`, `.colpkg`) so the renderer never touches the filesystem. Returns `ServiceResult<DeckSetSummary>`.

**Detection (two orthogonal axes):**
- **Container version** (governs unzip + whether zstd/protobuf is needed). *Phase A — metadata only:* read the ZIP **central directory** for member names + per-member compressed/uncompressed sizes **without** inflating payloads. Precedence: (1) if a `meta` member exists, decompress only that small member and protobuf-decode `PackageMetadata.version` (`1`=LEGACY_1, `2`=LEGACY_2, `3`=LATEST); (2) else infer newest-wins by collection member present: `collection.anki21b`→LATEST, `collection.anki21`→LEGACY_2, `collection.anki2`→LEGACY_1. LATEST always implies zstd collection + protobuf media + zstd media blobs (there is no uncompressed `anki21b`). *Precision note (web-verified against Anki's `meta.rs`):* a real LATEST/`anki21b` package **always** ships a `meta` member with `version=3`; Anki's own no-meta fallback only distinguishes `anki21` vs else and never probes `anki21b`. Our `anki21b` filename branch is a benign defensive **superset** — if it were ever hit without `meta`, attempt zstd-then-raw rather than assuming. Do not document it as "matching Anki's detection."
- **SQLite schema** (governs how note types/decks are read). *Phase B:* extract/decompress **only** the collection member to a temp file (streamed, size-capped per C-security), open it (see Library choices for the open mechanism), then read `SELECT ver FROM col` (11=legacy JSON, 18=modern normalized) and confirm via presence of the `notetypes` table in `sqlite_master`. `col.ver`/table-presence is the **authoritative ETL branch signal**, independent of the package version.

**ETL:** legacy → parse note types/templates/decks/CSS from `col.models`/`col.decks` JSON; modern → read normalized `notetypes`/`fields`/`templates`/`decks` and **ignore** the stale `col.models`/`decks` JSON. `notes.flds` split on the **0x1F** unit separator; `tags` space-separated, trimmed. Both parsers emit a common **`ParsedCollection`** interface so the writer/ETL is schema-agnostic (this is the seam that makes the modern path purely additive). Derive one **card row per generated card** (cloze expanded: `cards.ord` = ordinal − 1). The entire write runs in **one `db.transaction(...)`**; media is hashed to disk first (idempotent), transaction commits last; the temp SQLite is deleted in `finally`.

**Dependencies:** fflate, fzstd, protobufjs, `@libsql/client` (raw client), the data model (C2), the media store (C4).

**Error envelopes (never throw to renderer):** `unsupported-format` (no recognized collection member), `corrupt-package` (central-dir/parse failure), `import-too-large` (any cap exceeded).

### C2 — Normalized data model (MAIN)

**Purpose:** Full-fidelity storage from day one so render fidelity can fill in over later milestones without re-migrating.

**Interface:** `src/main/db/schema/flashcards.ts`, re-exported via `export * from './flashcards'` in `src/main/db/schema/index.ts`. Mirrors `gamification.ts` conventions exactly. See **Data model** below for the full table list. `.$inferSelect` row types exported at file bottom (`DeckSetRow`, `DeckRow`, `NoteTypeRow`, `NoteRow`, `CardRow`, …).

**Dependencies:** drizzle-orm; the shared `RenderKind` type imported `as type` from `../../../shared/flashcards/types`.

### C3 — `flashcards.*` IPC surface

**Purpose:** The renderer-facing typed contract; mirrors the `gamification` namespace exactly.

**Interface — channels (`src/shared/channels.ts`, added to `CH as const`):**
```
fcImportDeck:    'flashcards:importDeck'
fcListDeckSets:  'flashcards:listDeckSets'
fcListDecks:     'flashcards:listDecks'
fcListCards:     'flashcards:listCards'
fcGetCard:       'flashcards:getCard'
fcDeleteDeckSet: 'flashcards:deleteDeckSet'
```

**`FreecatApi.flashcards` (`src/shared/api.ts`):**
```ts
flashcards: {
  importDeck:    () => Promise<ServiceResult<DeckSetSummary>>
  listDeckSets:  () => Promise<DeckSetSummary[]>
  listDecks:     (deckSetId: number) => Promise<DeckNode[]>
  listCards:     (input: ListCardsInput) => Promise<CardListPage>
  getCard:       (cardId: number) => Promise<ServiceResult<CardView>>
  deleteDeckSet: (deckSetId: number) => Promise<ServiceResult<null>>
}
```

**DTOs (`src/shared/dto.ts`):**
- `DeckSetSummary { id, sourceFilename, deckCount, cardCount, importedAt }`
- `DeckNode { deckId, name, subdeckName, parentDeckId, cardCount, children? }`
- `ListCardsInput { deckId: number, afterId?: number, limit?: number }`
- `CardListPage { cards: CardListItem[], nextAfterId: number | null }`
- `CardListItem { cardId, renderKind, preview }`
- `CardView { cardId, renderKind, css, qfmt, afmt, fields: {name,value}[], tags, noteTypeName, deckName, subdeckName, templateName, clozeOrdinal: number | null, mediaMap: {filename, url}[] }`

**Closed `ServiceErrorCode` union extended with:** `'deck-not-found' | 'card-not-found' | 'deck-set-not-found' | 'unsupported-format' | 'corrupt-package' | 'import-too-large'`.

**IPC (`src/main/ipc/flashcards.ts`):** single `registerFlashcardsIpc(db)` export; thin handlers; **exported** Zod schemas with `.parse(raw: unknown)` on every payload (e.g. `listCardsSchema`, `getCardSchema`, `deckSetIdSchema`); inject `new Date()` from the handler. **No `reviewCard` channel and no `recordActivity` in M1** (C: gamification = NONE; the `flashcard.review` hookup is M2, documented in a code comment at the would-be grading point).

**Preload (`src/preload/index.ts`):** add a `flashcards` block, one arrow per channel mapping to `ipcRenderer.invoke(CH.xxx, arg)`; multi-arg methods send a single object.

**Bootstrap (`src/main/index.ts`):** in `app.whenReady().then(...)`, after `createDb → runMigrations → seed/grant` and alongside the other `register*Ipc(db)` calls, add `registerFlashcardsIpc(db)` **before** `createWindow()`. Plus the two **flagged** `freecat-media` protocol amendments in C4.

### C4 — Card rendering (iframe + template engine + MathJax + media protocol + graceful degradation)

**Purpose:** Faithfully execute arbitrary card CSS/JS + MathJax while keeping the hardened app fully quarantined.

**C4a — Render isolation (owns the minimal app-document CSP — see O4).** Render each card in an `<iframe sandbox="allow-scripts">` via **`srcdoc`** (NOT `allow-same-origin`) → opaque origin: the card's CSS + bundled MathJax run, but the card cannot reach our DOM, the `window.freecat` bridge, or other cards. **Two-layer CSP:**
- **Layer 1 — app document (owned by Foundation task #9, NOT this module):** the top-level renderer document keeps a strict CSP (`script-src 'self'`, no `'unsafe-inline'`/`'unsafe-eval'`) and adds `frame-src`/`child-src` permissive enough to host the opaque-origin `srcdoc` iframe (`frame-src 'self'` covers `srcdoc`). Foundation currently has **no** app-level CSP and task #9 (CSP hardening) is **pending**, so per **O4** flashcards M1 **lands this minimal app-document CSP itself** (`script-src 'self'` + `frame-src 'self'`); task #9 later subsumes/extends it. No merge gate.
- **Layer 2 — iframe document (owned by this module):** the `srcdoc` carries its own strict CSP `<meta>`: `default-src 'none'; img-src freecat-media://media; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'`. No `connect-src` → under `default-src 'none'`, `fetch()`/XHR to `freecat-media:` is blocked; media is delivered **only** as a subresource (`<img>`), never via `fetch`. `'unsafe-eval'` is the **expected** config (see C4c) and is bounded by the opaque-origin + no-network envelope.

Card height is reported back via a tiny bundled height-only `postMessage` shim. The parent handler **must** verify `event.source === iframeRef.contentWindow`, validate the payload is exactly `{type:'fc-height', height:number}`, **clamp** height to a sane max (≤ 50000px), and drop everything else silently.

**C4b — Template engine (pure, `src/shared/flashcards/`).** Dependency-free, unit-testable. **Hard isolation invariant:** the engine runs in the renderer to build the iframe `srcdoc` from DTOs, but its output is assigned **exclusively** to `iframe.srcdoc` (a plain string attribute) and **never** to parent-document `innerHTML`/`dangerouslySetInnerHTML`/`insertAdjacentHTML`. (Acceptable alternative: assemble the full `srcdoc` string in MAIN and ship one opaque HTML string.) This no-parent-DOM-injection rule is a **tested invariant**.

Tokens in M1: `{{Field}}` (raw HTML, **not** escaped), `{{text:Field}}` (strip HTML to plain text), `{{hint:Field}}` (collapsible), `{{#Field}}`/`{{^Field}}`/`{{/Field}}` (empty = absent/whitespace-only), `{{FrontSide}}`, `{{cloze:Field}}`, special fields `{{Tags}}`, `{{Type}}`, `{{Deck}}` (full `::`-joined name), `{{Subdeck}}` (leaf — computed `deckName.split('::').pop()`; for a top-level deck with no `::`, `{{Deck}}` and `{{Subdeck}}` are equal), `{{Card}}`. `{{type:Field}}` renders a **disabled/static** representation (no interactive typing in M1). Unknown tokens (furigana, tts, `{{CardFlag}}`) pass through harmlessly; the parser is total.

**Cloze (matched to Anki's `rslib/cloze.rs`):** active ordinal `N = card.templateOrd + 1`.
1. **ALL** deletions whose number `== N` are active and reveal **together** (two `{{c1::…}}` in one field both belong to card ord 0 and both render active — not just the first).
2. **Question side**, each active deletion → `<span class="cloze" data-cloze="<HTML-entity-encoded answer>" data-ordinal="N">[<hint or …>]</span>` — the `data-cloze` attribute is required (AnKing CSS/JS and reveal-on-tap add-ons read `[data-cloze]`).
3. **Answer side**, each active deletion → `<span class="cloze" data-ordinal="N">answer</span>`.
4. **Inactive** ordinals (number `!= N`), both sides → `<span class="cloze-inactive" data-ordinal="M">text</span>` (`.cloze-inactive` is a real Anki 2.1.56 hook).
`data-ordinal` is comma-joined in the rare multi-ordinal case (single value common). Supports nested/multiple clozes and the optional `::hint` segment.

**C4c — MathJax.** Bundle a **fully self-contained** MathJax 3 `tex-chtml-full` inside the iframe `srcdoc` (inline `<script>`, no CDN). Disable all runtime loading/menu/a11y and inline CHTML fonts so nothing fetches under the no-network CSP: `window.MathJax = { loader: { load: [] }, startup: { typeset: true }, options: { enableMenu: false, enableAssistiveMml: false } }` + inlined fonts. Delimiters match Anki: inline `\( \)`, display `\[ \]`. The engine pre-processes Anki bracket-dollar markup **before** MathJax: `[$]…[/$]` → `\(…\)`, `[$$]…[/$$]` → `\[…\]`. Do **not** enable `$…$`/`$$…$$`. **CSP posture:** the iframe is **expected** to need `script-src 'unsafe-inline' 'unsafe-eval'` — MathJax 3's CHTML core uses `new Function()` in shared code (MathJax issues #256/#1988/#3593), so under `default-src 'none'` without `'unsafe-eval'` typesetting throws "call to eval() blocked by CSP" and math silently fails (an L3 miss). Iframe-scoped `'unsafe-eval'` is the accepted default, bounded by opaque origin + `default-src 'none'` + no network. **Verification gate** (manual/integration, not a node unit test): render a MathJax fixture inside the real iframe under the exact final CSP to confirm **which** `script-src` is required (expected: `'unsafe-inline' 'unsafe-eval'`); only tighten if it happens to typeset without eval. SVG output is **not** a guaranteed eval-free escape hatch. KaTeX is the documented fallback only if eval-free ever becomes a hard requirement (lower macro coverage). *M1 tradeoff note:* inlining the full build into every `srcdoc` re-parses MathJax on every card flip/select — accepted for M1; a known M2 optimization is to serve MathJax + fonts as a cacheable subresource via a privileged scheme (add it to the iframe `script-src`/`font-src`).

**C4d — Media delivery (flagged Foundation-bootstrap amendment).** Register a privileged custom protocol `freecat-media` in MAIN. **Two exact insertion points (an explicit, reviewed amendment to the section-7 bootstrap contract):**
1. **Module top-level, before `app.whenReady`:** `protocol.registerSchemesAsPrivileged([{ scheme: 'freecat-media', privileges: { standard: true, secure: true, supportFetchEnabled: true, bypassCSP: false } }])`.
2. **Inside `app.whenReady`, after `register*Ipc(db)` and before `createWindow()`:** `protocol.handle('freecat-media', handler)` streaming files from the media store.

The engine rewrites card `<img src>` (and `srcset`) to `freecat-media://media/<hash>.<ext>` during `srcdoc` assembly using the DTO `mediaMap`. **Authorization (security fix — do NOT serve any hash globally):** resolve **exclusively** through the **active card's deck-set filename→hash map**; the "directly by hash" global lookup is **forbidden** because the iframe runs untrusted JS with `'unsafe-eval'` and could otherwise enumerate every other deck-set's blobs. Preferred: a per-card, short-lived **capability token** in the URL (`freecat-media://<cardToken>/<filename>`) minted by the viewer on `getCard`, with the handler 404ing anything not referenced by that card's note/template; minimum acceptable: resolve only via the active deck-set's map. Handler **must** also: validate the resolved path is a plain hex basename inside the media dir (no traversal); derive `Content-Type` from a **closed extension→MIME allowlist** (png/jpg/jpeg/gif/webp/svg/mp3/ogg/wav/…), **never** echoing the untrusted filename; 404 any extension not on the allowlist; serve SVG as `image/svg+xml` only via `<img>` (subresource-only, ties to C4a). Never throw; 404 unknown.

**C4e — Graceful degradation.** At ETL, classify each note type into `RenderKind = 'basic' | 'cloze' | 'image-occlusion' | 'unsupported'`, stored on `note_types` **and** denormalized onto `cards`. Detection: **built-in Image Occlusion** → note-type name `Image Occlusion` OR (`Image` field present AND an `Occlusion`/`Occlusions` field whose text uses `image-occlusion:`); **IOE add-on** → name `Image Occlusion Enhanced` OR the `Question Mask`/`Original Mask` field pair — both → `image-occlusion`. **Audio** is handled at the content level: `[sound:x]` tokens render an inert "audio — playback coming in a later milestone" chip rather than marking the whole card unsupported. Only mark `unsupported` when the template relies on features M1 cannot render at all. The browse list **always** shows the row with a `renderKind` badge; the viewer renders real cards for basic/cloze and a clean placeholder ("Image Occlusion card — rendering coming in a later milestone" / "This note type isn't supported yet") otherwise. **Never crash, never skip.**

**Dependencies:** C3 DTOs, C4 media protocol, Foundation task #9 CSP.

### C5 — Browse UI (renderer)

**Purpose:** The minimal faithful browse surface for an AnKing-class multi-deck import.

**Interface:** replace the `src/renderer/src/pages/Flashcards.tsx` stub (route already wired in `App.tsx`; `export default function Flashcards(props: PageProps): React.JSX.Element`). Layout: (a) **empty state** with an "Import deck (.apkg/.colpkg)" button → `window.freecat.flashcards.importDeck()` (blocking "Importing…" spinner until resolve/err); (b) **left pane** deck/subdeck tree from `listDeckSets` + `listDecks` (`DeckNode.children` form the `::` hierarchy; collapse/expand client-side); (c) **center** keyset-paged card list for the selected deck via `listCards` (load-more / infinite scroll on `nextAfterId`, `limit ~50`), each row = preview + `renderKind` badge; (d) **viewer** = the single sandboxed iframe (C4) from `getCard`, with a front/back flip toggle (re-render via the shared engine, `{{FrontSide}}` on the answer side). The viewer assigns engine output **only** to `iframe.srcdoc`, never parent `innerHTML` (the C4b invariant + enforcement point). Tailwind v4 utility classes; navigation stays the `App.tsx` `useState<RouteKey>` switch (no router lib). Only **one** live iframe at a time.

**Dependencies:** C3 (`window.freecat.flashcards.*`), C4 (engine + iframe + media).

### C6 — Testing

See **Testing strategy**. Pure engine/cloze/detection/reader/ETL tests under node; repo/ETL tests on the verified `createTestDb()` temp-file harness; DOM-needing tests under a per-file jsdom pragma; MathJax/CSP + media-subresource confirmation as manual/integration gates.

## Data model

New `src/main/db/schema/flashcards.ts` (bare snake_case table names, no domain prefix, matching `gamification.ts`; TS keys camelCase; timestamps via `integer({mode:'timestamp'}).notNull().$defaultFn(() => new Date())`; JSON via `text({mode:'json'}).$type<string[]>()`; `.$inferSelect` row types at file bottom). Single generated migration `drizzle/0002_*.sql` via `npm run db:generate` (never hand-edit SQL or `_journal.json`); auto-runs at boot via existing `runMigrations`.

| Table | Columns (camelCase key → `snake_case` col) | Notes |
|---|---|---|
| **deck_sets** | `id` PK autoinc · `sourceFilename` text · `sourceFormat` text `$type<'legacy1'\|'legacy2'\|'latest'>` · `importedAt` timestamp | **One row per import** — the independent deck-set unit (L2 no dedup). |
| **decks** | `id` PK autoinc · `deckSetId` FK→deck_sets · `ankiDeckId` integer (preserved, unread M1) · `name` text (full `::`-joined) · `parentDeckId` integer FK→decks nullable | Subdeck tree. |
| **note_types** | `id` PK autoinc · `deckSetId` FK · `ankiNotetypeId` integer (preserved) · `name` text · `kind` text `$type<'standard'\|'cloze'>` · `css` text · `renderKind` text `$type<RenderKind>` | `RenderKind` computed at ETL (C4e). CSS stored verbatim (full fidelity). |
| **note_type_fields** | `id` PK · `noteTypeId` FK · `ord` integer · `name` text | |
| **templates** | `id` PK · `noteTypeId` FK · `ord` integer · `name` text · `qfmt` text · `afmt` text | qfmt/afmt stored verbatim (conditionals preserved). |
| **notes** | `id` PK autoinc · `deckSetId` FK · `noteTypeId` FK · `ankiGuid` text (preserved) · `fieldsJson` text json `$type<string[]>` (split on 0x1F) · `tags` text json `$type<string[]>` · `sortField` text | |
| **cards** | `id` PK autoinc · `deckSetId` FK · `noteId` FK→notes · `deckId` FK→decks · `templateOrd` integer (`cards.ord`; cloze = ordinal−1) · `renderKind` text `$type<RenderKind>` (denormalized for fast browse) · `createdAt` timestamp | One row per generated card. |

**Indexes:** `cards(deckId, id)` (paged browse), `cards(deckSetId)`, `notes(noteTypeId)`, `decks(parentDeckId)`, `note_type_fields(noteTypeId, ord)`, `templates(noteTypeId, ord)`.

**Paging:** **keyset** over `cards` ordered by `id` within a deck (`WHERE deck_id = ? AND id > ? LIMIT n`), not `OFFSET` — scales to 35k+ cards.

**Note→card + cloze derivation (at ETL, materialized):** each note generates one card per its note type's templates; for cloze note types, one card per distinct cloze ordinal with `templateOrd = ordinal − 1`. "One card per distinct ordinal" is the card **count**; rendering of multiple same-ordinal deletions on one card (reveal-all) is C4b, not extra rows.

**Deferred columns (intentionally absent; additive later, never a re-migration):** FSRS scheduling state, review history, merge/dedup keys.

## Library choices

All readers are **pure JS, no new native modules**, and go in `package.json` **`dependencies`** (NOT `devDependencies`) — `electron.vite.config.ts` applies `externalizeDepsPlugin()` to the MAIN build, so every runtime main-process import must resolve from `node_modules` in the packaged app; a `devDependency` would compile in dev but break the packaged main process.

- **fflate** — ZIP central-directory enumerate + **streaming** inflate (`Unzip`/`AsyncUnzip`, per-file handler). Pure JS, Node + browser.
- **fzstd** — zstd **decompress-only**, streaming (collection `anki21b` + LATEST media blobs). Decompress-only is sufficient (M1 only reads).
- **protobufjs** — decode `PackageMetadata` + `MediaEntries`/`MediaEntry`. Vendor minimal hand-written `.proto` under `src/main/flashcards/`.
- **`@libsql/client` ^0.14** — **existing** dependency, Node build, MAIN-only — used to open the **foreign** Anki collection via a **separate raw** `createClient({ url: 'file:<temp-collection-path>' })` used only via `client.execute(rawSQL)`. Do **not** route the Anki SQLite through `createDb`/drizzle (binds the app schema/migrations to a foreign DB and mistypes raw `col`/`notes`/`cards` queries). `client.close()` + `unlink` the temp file in `finally`.

> **Open-file mechanism — blocking correction (see Open questions O1):** the originally-specified `?mode=ro` query param **does not work** with the installed `@libsql/client ^0.14` — its config parser whitelists only `tls`/`authToken` and **throws** `LibsqlError: Unsupported URL query parameter "mode"` at construction; the local sqlite3 client also drops the query string for `file:` URLs and passes no read-only flag. **Drop `?mode=ro`.** Because C1 already extracts the collection to a **throwaway temp copy** that is deleted after ETL, the user's original file is never touched regardless of mode, so opening the temp copy read-write is acceptable. If a true read-only handle is still wanted under the pinned deps, use `node:sqlite`'s `new DatabaseSync(path, { readOnly: true })` (requires bumping/guarding `engines >= 22`) or the native `libsql` `Database` read-only option. **Add a unit test that opens a real fixture collection to prove the chosen call does not throw.**

**Test-only:** generating the `.colpkg` fixture needs a zstd **compressor** (fzstd is decompress-only). Either check in a small pre-zstd'd `anki21b` fixture as opaque bytes, or add a wasm zstd **compressor** as the **only** zstd-related `devDependency`, used solely in fixture generation — app runtime stays decompress-only (Open question O2).

**Rejected:** `sql.js`/`node:sqlite`/native zstd/native protobuf/node-7z as primary readers — `@libsql/client` is already present and the three pure-JS readers cover the rest with zero new native surface.

## Security

The iframe runs **untrusted card CSS + JS** (AnKing decks ship arbitrary code). Faithful render (L3) requires executing it; the hardened app requires quarantining it.

- **Origin/DOM isolation:** opaque-origin `<iframe sandbox="allow-scripts">` via `srcdoc` (no `allow-same-origin`). Card JS cannot reach our DOM, the `window.freecat` bridge, or other cards. **Empirical gate** (alongside the MathJax-CSP gate): render a real card with a `freecat-media://` `<img>` inside the opaque-origin frame under the **exact** final CSP and assert (i) the image paints, **and** (ii) `fetch('freecat-media://…')` from in-iframe JS is **rejected**. Explicitly rely on `default-src 'none'` (no `connect-src`); document that media is subresource-only.
- **No parent-DOM injection:** engine output assigned **only** to `iframe.srcdoc`, never parent `innerHTML`/`dangerouslySetInnerHTML`/`insertAdjacentHTML` (tested invariant).
- **ZIP-slip:** output filenames are derived **purely** from our computed content hash — traversal is structurally impossible. Collection/media member names matched against an exact allowlist `^(meta|media|collection\.anki2|collection\.anki21|collection\.anki21b|[0-9]+)$`.
- **ZIP-bomb (metadata-first, streaming):** read the central directory for per-member uncompressed sizes + member count and **reject before materializing** on `sum-uncompressed > MAX_TOTAL` (~4 GiB), `member-count > MAX_MEMBERS`, or `any per-member uncompressed > MAX_PER_MEMBER`; then decompress **one member at a time** with fflate streaming, tracking running bytes and aborting mid-stream if a member exceeds its declared/cap size (defends a lying central directory). Never `fflate.unzipSync` (it eagerly inflates everything → bomb-in-RAM).
- **ZSTD-bomb:** decompress each `anki21b` collection member and each numbered media blob via fzstd **streaming** with a running output-byte cap, aborting (`err('import-too-large')`) the moment the cap is exceeded — never buffer full output. **Also cap the temp-file write** for the collection (a small member can expand into a multi-GB SQLite file → disk-fill): abort + `unlink` the partial temp collection the instant the cap is exceeded; `unlink` on any error in `finally`.
- **SQLite-level amplification (second-order bomb):** even a legitimately-sized collection can declare millions of rows or a multi-hundred-MB single field. Add cheap pre-ETL guards against the read-only collection: cap total note/card counts (`SELECT COUNT(*)`, e.g. the 35k+ target plus headroom) and per-field byte length (`length()`) **before** building DTOs / opening the write transaction; over-cap → `err('import-too-large')`.
- **Protocol traversal + content-type:** `freecat-media` handler resolves **only** through the active card/deck-set map (no global hash lookup — prevents cross-deck-set media reads by untrusted JS); validates a plain hex basename inside the media dir; sets `Content-Type` from a **closed extension→MIME allowlist** (never echoing the untrusted name); 404s unknown extensions; SVG served `image/svg+xml` subresource-only.
- **postMessage hardening:** verify `event.source === iframe.contentWindow`, validate `{type:'fc-height', height:number}` exactly, clamp height ≤ 50000px, drop anything else.
- **CSP:** app document strict `script-src 'self'` (Foundation task #9); iframe `default-src 'none'; img-src freecat-media://media; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'`. All inline-script + eval is confined to the opaque-origin, no-network iframe — the sole script-execution surface in the app.

## Suggested build sequence

**apkg (legacy) before colpkg (modern)** — the legacy path exercises the whole pipeline with the simplest encodings; the modern path is then purely additive behind the `ParsedCollection` seam.

1. **Schema + migration.** Write `src/main/db/schema/flashcards.ts`; `export * from './flashcards'` in `index.ts`; run `npm run db:generate`; commit `drizzle/0002_*.sql` + `meta/` together.
2. **Shared contracts.** Extend `ServiceErrorCode`; add View/Input DTOs in `dto.ts`; add `fc*` channels in `channels.ts`; add the `flashcards` block to `api.ts`.
3. **Pure template engine + cloze** in `src/shared/flashcards/` (TDD, no I/O): `data-cloze` on the active Q span, shared-ordinal reveal-all, conditionals, `{{hint:}}`/`{{text:}}`, `{{Subdeck}}` leaf logic, the `srcdoc`-only output invariant.
4. **LEGACY `.apkg` reader end-to-end (MAIN):** central-dir enumerate → detect LEGACY → streaming unzip with metadata-first caps → raw `createClient` over `collection.anki2` (no `?mode=ro` — O1) → parse `col` JSON into `ParsedCollection` → media (JSON map, uncompressed blobs, hashed store, filename→hash map) → ETL in one transaction.
5. **Repository + IPC + preload + bootstrap.** DB-param repo (`.returning()`, guard-and-throw, `ok`/`err`); `registerFlashcardsIpc(db)` before `createWindow()`; **plus the two flagged `freecat-media` amendments** (top-level `registerSchemesAsPrivileged` before `whenReady`; `protocol.handle` inside `whenReady` after `register*Ipc`, before `createWindow`).
6. **Browse UI (`Flashcards.tsx`):** import button + tree + paged list + single sandboxed iframe viewer + self-contained MathJax under the iframe CSP. **Lands the minimal app-document CSP itself** (`script-src 'self'` + `frame-src 'self'` for the iframe) per **O4**, rather than waiting on Foundation task #9.
7. **MODERN path:** detect LATEST → streaming zstd-decompress `collection.anki21b` (capped, temp-file cap too) → read V18 normalized tables via the **same** `ParsedCollection` seam → protobuf `MediaEntries` + streaming zstd media blobs (per-blob cap) → reuse the **same** ETL/store/transaction.
8. **Graceful-degradation classification** folded into ETL + viewer (C4e).
9. **Fixtures + full test sweep** (repo/ETL tests on `createTestDb()` temp-file dbs) + one **manual real-deck acceptance**.

**Dependency placement (explicit):** `fflate`, `fzstd`, `protobufjs` in `dependencies` (main is externalized; `devDependencies` would break the packaged main process). The test-only zstd **compressor** is the only zstd-related `devDependency`.

## Testing strategy

**No copyrighted decks committed.** Add a fixture **generator** (under `test/fixtures` or `scripts/`) that builds tiny synthetic packages with our own libs: (a) LEGACY `.apkg` = fflate-zipped hand-built `collection.anki2` (raw `createClient`, V11 `col`-JSON schema) + JSON media map + a couple of uncompressed blobs; (b) LATEST `.colpkg`/`.apkg` = `collection.anki21b` (V18 normalized tables) zstd-compressed — via a checked-in pre-zstd'd blob OR a dev-only wasm zstd compressor (O2).

**Database-test harness (binding, verified Foundation convention):** repository/ETL tests **must** use the existing `test/helpers/db.ts` `createTestDb()` (unique **temp-file-backed**, migrated, transaction-safe db per test) and **NOT** `createDb('file::memory:')` — `@libsql/client`'s in-memory db does **not** survive `client.transaction()` (connection drops, fresh empty db reopens → "no such table"), and the entire M1 ETL is one `db.transaction(...)`, so in-memory would fail on the first transactional test. Cleanup is the vitest global teardown only (`cleanupTestDbs()` wired into `test/global-setup.ts`); tests call `createTestDb()` and do **not** clean up per-test.

**Fixtures cover:** Basic; Cloze (multi-ordinal + `::hint` + nested + a **two-`{{c1::}}`-in-one-field** case asserting BOTH deletions reveal on card ord 0, AND an assertion that the active **question** span carries `data-cloze="<HTML-encoded answer>" data-ordinal="1"`); conditionals (`{{#}}`/`{{^}}`); an image card; a MathJax card; a built-in Image-Occlusion note; an IOE note; an audio `[sound:]` card; and an **over-cap zip/zstd** fixture asserting the streaming caps abort **early** (`err('import-too-large')`) without full materialization.

**Unit tests (node):** format detection (central-directory-first), zip/zstd/protobuf readers (incl. streaming-cap early-abort), ETL (both schemas → normalized rows, on a `createTestDb()` db), the pure template engine + cloze (exhaustive: `data-cloze` encoding, shared-ordinal reveal-all, conditionals, hint, `{{Subdeck}}` leaf + no-`::` equality), exported Zod schemas, and the open-collection call (O1) opening a real fixture without throwing.

**DOM-needing tests (per-file `// @vitest-environment jsdom` pragma; add jsdom/happy-dom as a `devDependency` — vitest's global default stays `node`):** the no-parent-DOM-injection invariant (engine output assigned to `.srcdoc`, never `innerHTML`) and any React component test.

**Manual / integration gates (NOT node unit tests — jsdom does not run a real CSP/iframe sandbox):**
- **MathJax CSP confirmation:** open a math card in the running Electron app (or a Playwright/Electron integration test) and read devtools to confirm the exact required `script-src` (expected `'unsafe-inline' 'unsafe-eval'`).
- **Media-subresource confirmation:** confirm `freecat-media://` `<img>` paints under the exact final CSP and in-iframe `fetch('freecat-media://…')` is rejected.
- **Real-deck acceptance:** import a user-supplied AnKing-style deck (O3) and eyeball faithful render + placeholders.

## Risks & notes

- **App-level CSP (O4):** flashcards M1 lands the **minimal** app-document CSP it needs itself (`script-src 'self'` + `frame-src 'self'` for the card iframe) rather than blocking on the broader Foundation task #9; #9 can later subsume/extend it. The iframe's own strict CSP is owned by this module.
- **`freecat-media` bootstrap amendment** is a real deviation from the section-7 contract — two pinned insertion points, reviewed as a Foundation amendment, not slipped in.
- **`'unsafe-eval'` in the iframe** broadens its script surface but is bounded by opaque origin + `default-src 'none'` + no network (no parent-DOM/bridge reach, no exfiltration). It never touches the app document (`script-src 'self'`).
- **MathJax srcdoc inflation:** inlining `tex-chtml-full` + fonts per card re-parses on each flip/select — accepted for M1; M2 optimization is a cacheable subresource scheme.
- **35k-card insert in one transaction** blocks main under a spinner — acceptable for M1; batch inserts; worker-thread/streamed progress deferred.
- **`'notes'`/`'cards'` are generic table names** — no collision now; a future collision is a cheap rename-migration.
- **sha1 content-addressing** is fine for dedup; upgradeable to sha256 without re-migration (hash is just a string column). Orphan-media GC deferred.

## Decisions on the open questions (resolved 2026-06-23, Warren)

All five settled; none remain blocking. **These supersede any "merge gate / depends on task #9" phrasing elsewhere in this doc.**

**O1 — libsql open mechanism → RESOLVED.** Open the throwaway temp collection copy **read-write**; `?mode=ro` is forbidden (it throws at construction with `@libsql/client ^0.14`). The user's original file is never opened, and the temp copy is `unlink`ed in `finally`, so a read-only handle buys nothing here. Keep the unit test that opens a real fixture collection to prove the chosen call doesn't throw. *(node:sqlite `readOnly:true` noted as a future option only if we ever bump `engines >= 22`.)*

**O2 — colpkg test fixture → RESOLVED.** Add a **dev-only wasm zstd compressor** to `devDependencies`, used solely by the fixture generator (readable fixture generation over an opaque committed binary). App runtime stays decompress-only (fzstd); the three app readers remain production `dependencies`.

**O3 — manual real-deck acceptance target → RESOLVED.** `https://ankiweb.net/shared/info/178384887` (Warren-supplied). Downloaded as `.apkg` at acceptance time, **not** committed (copyright). It is a holistic "does a real, messy deck import + render right" check; the IO / same-ordinal-cloze / audio edge cases are covered independently by the synthetic fixtures, so acceptance does not depend on this deck exercising every feature.

**O4 — app-CSP sequencing → RESOLVED.** Flashcards M1 **co-authors the minimal `script-src 'self'` + `frame-src 'self'` slice** it needs into the app-document CSP as part of its own work, rather than blocking on the broader Foundation task #9 (CSP hardening). It introduces only the narrow policy the card iframe requires; task #9 can later subsume/extend it. No external blocker, no merge gate.

**O5 — MathJax `'unsafe-eval'` in the iframe → ACCEPTED.** Faithful MathJax 3 rendering needs `'unsafe-eval'`, scoped **only** to the opaque-origin, `default-src 'none'`, no-network card iframe — it cannot reach the app document (`script-src 'self'`), the `window.freecat` bridge, or other cards. KaTeX remains the documented eval-free fallback if zero-eval ever becomes a hard requirement.