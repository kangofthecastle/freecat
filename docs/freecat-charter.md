# FreeCAT — Project Charter

> **This is the single set of goals for FreeCAT. Read it in full before starting any work session, then read the relevant module handoff in `docs/handoffs/`.** It defines what we are building, the architecture every module shares, and the contracts that let the modules be built independently without colliding.

_Last updated: 2026-06-22 · Status: Foundation app skeleton built (PR #1). The MCAT taxonomy + authored-content pipeline are deferred — defined in the Qbank brainstorm (§5.1, §5.5), not pre-built._

---

## 1. Vision

FreeCAT is a **free, open-source, local-first MCAT study app** for self-studying pre-meds. It is the open answer to expensive prep (UWorld, Kaplan, Princeton Review): the code is open, the question bank is an open content commons, and it runs entirely on the student's own machine.

Guiding principles:

1. **Local-first, zero-ops.** No hosted backend, no accounts, no server the maintainers operate. All data lives in one local SQLite file. Private by default.
2. **One-click for non-technical users.** A student downloads an installer, double-clicks, and it just works — no Node, no database setup, no terminal.
3. **Original or openly-licensed content only.** FreeCAT never ships copyrighted exam material. Questions are AI-drafted then human-reviewed; flashcards are bring-your-own.
4. **Leverage the existing ecosystem.** Don't reinvent flashcard content — let users import the excellent free Anki decks that already exist.
5. **Reuse sat-world.** This project deliberately reuses scaffolding, components, the SRS engine, and the gamification layer from the sibling `sat-world` project (`~/wrk/sat-world`).

## 2. Non-goals (explicit)

- ❌ **Full-length timed practice exams** — out of scope now and most likely forever.
- ❌ **Hosted backend / accounts / cloud sync / AnkiWeb sync** — nothing is hosted.
- ❌ **Multi-user / teacher-student / classroom** — single local profile only (multi-profile may come much later).
- ❌ **In-app question authoring** — authored content is contributed as files via GitHub PRs, not created in-app.
- ❌ **Content scraped or adapted from copyrighted prep material** — strictly prohibited (see `CONTENT-LICENSE.md`).
- ❌ **Linux builds** — not targeted for v1 (the stack is cross-platform, so this can be revisited).
- ❌ **Exporting decks back to `.apkg`** — import only.

## 3. Architecture overview

| Concern | Decision |
| --- | --- |
| App type | **Electron** desktop app (macOS + Windows) |
| Renderer | **Vite + React** (NOT Next.js) |
| Language | TypeScript |
| Styling / UI | Tailwind CSS v4 + components ported from sat-world |
| Database | **SQLite**, one file in Electron's `userData` dir, via **Drizzle ORM** (`drizzle-orm/libsql` + `@libsql/client` — N-API prebuilt, no per-ABI rebuild) |
| Data access | Drizzle runs in the **Electron main process**; the renderer reaches it only through a **typed IPC bridge** (preload + `contextBridge`) |
| Auth | **None.** Single local profile created on first run |
| Validation | **Zod** (shared between content pipeline and IPC payloads) |
| Math rendering | MathJax (Anki fidelity) / KaTeX acceptable for authored content |
| Distribution | **GitHub Releases**; installers built in CI (**GitHub Actions**, macOS + Windows runner matrix) via **electron-builder** |
| Code signing | Deferred. Ship unsigned first (accept Gatekeeper / SmartScreen warnings); revisit paid signing later |

Why Vite over Next.js: there is no server and no Postgres anymore, so Next's server-actions/RSC data layer can't port regardless — all data access is re-homed to in-process Drizzle calls exposed over IPC. Next would only add the friction of embedding a server in Electron. A Vite + React SPA reuses sat-world's components, Tailwind, Zod, Drizzle schema, and SRS logic while keeping the desktop integration clean.

## 4. Module map

FreeCAT is a **Foundation** (the shared substrate) plus **three independent modules**.

```
┌──────────────────────────────────────────────────────────────┐
│                        FOUNDATION (Phase 0)                    │
│  Electron+Vite shell · SQLite/Drizzle · IPC bridge ·           │
│  gamification · design system · single-user profile            │
└───────────────┬───────────────┬───────────────┬───────────────┘
                │               │               │
        ┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼────────┐
        │  1. Qbank    │ │ 2. Content   │ │ 3. Flashcards│
        │  (the heart) │ │    Review    │ │  (deep Anki) │
        └──────────────┘ └──────────────┘ └──────────────┘
```

**What lives where (and why parallel work is still safe):** the **module-agnostic** contracts live in the Foundation, built once up front — the base DB schema + repository/IPC conventions, the gamification API, navigation slots, and the design system. Two **shared, content-shaped** contracts — the **MCAT taxonomy** and the **authored-content pipeline** — are *not* pre-built: they encode product decisions, so they're defined in the **Qbank brainstorm** (the first content module, with Warren) and then reused by Content Review. Each module owns only its own tables and screens and otherwise consumes these shared pieces — never forking them. Consequence: **Qbank and Content Review share the content model and are sequenced Qbank-first; Flashcards is independent** (its content is imported) and can go anytime.

### Module briefs

- **Foundation (Phase 0).** The module-agnostic substrate only: the Electron+Vite app skeleton, local SQLite + Drizzle + migrations + first-run profile, the typed IPC data layer + repository convention, the ported gamification layer, and the app shell / design system with stubbed module screens. (The MCAT taxonomy + authored-content pipeline are **not** here — see §5.1 / §5.5.) Spec: `docs/superpowers/specs/2026-06-20-foundation-design.md` (now aligned with this division). **The app skeleton is built (PR #1);** the gamification port is the remaining module-agnostic piece.

- **Module 1 — Qbank** (the heart). Original MCAT practice questions delivered from bundled content files. **Qbank defines the shared content model in its brainstorm (with Warren) — the MCAT taxonomy and the authored-content pipeline — which Content Review then reuses.** Known so far: exactly **4 answer choices**, **passage-based + standalone** questions, **some with photos**. Plus practice sessions, answer + explanation flow, flagging/review, per-topic performance — feeding gamification. See `docs/handoffs/qbank.md`.

- **Module 2 — Content Review** (lessons). Readable topic lessons from bundled content files, tightly cross-linked to the Qbank through the shared taxonomy (miss a question → jump to the lesson; finish a lesson → practice it). Completion feeds gamification.

- **Module 3 — Flashcards** (deep Anki). A faithful local Anki reviewer; the most self-contained module — its content is user-imported (bring-your-own decks), so it integrates loosely (tag-based) rather than through the authored-content pipeline. **Deep-B scope:** import `.apkg`/`.colpkg` (legacy and modern zstd/protobuf formats), general note-type/template rendering, cloze, media (image + audio), MathJax, tags + deck/subdeck tree, **FSRS** scheduling, honoring a deck's existing scheduling history when present, and **image occlusion** (the single biggest lift). Out: AnkiWeb sync, export to `.apkg`, filtered decks, arbitrary add-ons. (`ts-fsrs` is a candidate library; sat-world's `src/lib/srs/*` is a reference/fallback, not FSRS.)

**Recommended build order:** Foundation → Qbank → Content Review → Flashcards. After the Foundation, order is flexible.

_Per-module handoff briefs are in `docs/handoffs/` (`qbank.md`, `content-review.md`, `flashcards.md`) — paste-in kickoffs for each module's own session._

## 5. Shared contracts

Most of these are **module-agnostic** and owned by the Foundation, built once up front: the DB/schema conventions (§5.2), the IPC contract (§5.3), the gamification API (§5.4), the app shell (§5.6). Two are **shared but content-shaped** — the **taxonomy (§5.1)** and the **authored-content pipeline (§5.5)** — and are **defined in the Qbank brainstorm (with Warren), not pre-built**, then reused by Content Review. Either way, modules consume these and must not fork them.

### 5.1 MCAT taxonomy (the integration backbone)

A single hierarchy that questions, lessons, and (loosely) flashcards all reference, so the modules cross-link.

- **Sections (4):** `chem-phys` (C/P), `cars` (CARS), `bio-biochem` (B/B), `psych-soc` (P/S).
- **Science sections** are organized as **Foundational Concept → Content Category → Topic**:
  - B/B: FC1 (`1A`–`1D`), FC2 (`2A`–`2C`), FC3 (`3A`–`3B`)
  - C/P: FC4 (`4A`–`4E`), FC5 (`5A`–`5E`)
  - P/S: FC6 (`6A`–`6C`), FC7 (`7A`–`7C`), FC8 (`8A`–`8C`), FC9 (`9A`–`9B`), FC10 (`10A`)
- **CARS** has no content categories; it uses **skill** nodes (Foundations of Comprehension; Reasoning Within the Text; Reasoning Beyond the Text) over humanities / social-science passages.
- **Cross-cutting:** the 4 Scientific Inquiry & Reasoning Skills (SIRS) and discipline tags (biochem, biology, gen-chem, org-chem, physics, psych, soc).

Modeled as taxonomy nodes `{ id, kind: 'section'|'foundational_concept'|'content_category'|'skill'|'topic', code, title, parentId }`, seeded from the published AAMC content outline; authored content references a `contentCategory` (or `skill` for CARS) plus free-form `topics`. **This is defined in the Qbank brainstorm (with Warren), not pre-built** — how it's used (browsing, tagging, granularity) is a product decision. A draft encoding of the full AAMC outline already exists in git history (commits `6b3880a`, `181bdec`) and can be reused as a starting point.

### 5.2 Database & schema ownership

One SQLite file, one Drizzle schema, split by ownership:

- **Foundation owns:** `profile` and the gamification tables (pet, XP/economy, streak, daily-goal).
- **Qbank owns:** question attempts, practice sessions, flags. As the first content module it also **establishes the shared `taxonomy` + content-registry tables** (metadata about loaded authored content), which Content Review then reuses.
- **Content Review owns:** lesson progress.
- **Flashcards owns:** imported decks, notes, note types/templates, cards, media references, and per-card scheduling/review state.

Modules add their own tables and migrations; they reference Foundation tables by id but never alter Foundation-owned tables' meaning.

**Repository convention:** data access lives in `src/main/repositories/*` functions that take the `DB` as a parameter (electron-free, so they're unit-testable against an in-memory libsql DB). Repositories use Drizzle `.returning()` on insert/update (not insert-then-select), and the project runs with TypeScript `noUncheckedIndexedAccess` enabled — so destructure query rows and narrow by guard-and-throw (`const [row] = await …; if (!row) throw …`) rather than unchecked `[0]` access or `!` assertions. Modules follow both.

### 5.3 IPC data-layer contract

The renderer never touches the database directly. The main process exposes namespaced, typed, async operations through the preload `contextBridge` (e.g. `window.freecat.gamification.recordActivity(...)`, `window.freecat.qbank.startSession(...)`). Payloads are validated with Zod at the boundary. Each module adds its own namespace following this pattern.

**Hardening to adopt when the second namespace is added** (lessons from the Foundation's `profile` IPC): introduce a shared module (e.g. `src/shared/`) holding (1) plain DTO types consumed by main, preload, and renderer, and (2) channel-name constants — and give the preload's exposed `api` an explicit type tied to the renderer's `window.freecat` contract, so the preload↔renderer shape is statically enforced instead of hand-asserted (today `ProfileDto` and the channel strings are duplicated by hand). **IPC error convention:** handlers validate with Zod and throw on invalid input (rejecting the `invoke` promise); thrown errors (including `ZodError`) do not survive structured-clone IPC with their structure intact, so renderers must treat a validation rejection as a generic failure unless/until a structured `{ ok, data | error }` result envelope is deliberately adopted.

### 5.4 Gamification API

A single interface all modules call to register study activity; the Foundation translates that into XP, streak, daily-goal progress, and pet state. Conceptually: `recordActivity({ kind, count, taxonomyRef? })`. Modules must not implement their own XP/streak logic — they only emit activity. (Ported from sat-world's `src/lib/rewards/*` and `src/lib/services/{pets,rewards}.ts`.)

### 5.5 Authored-content pipeline

For Qbank questions and Content Review lessons (NOT flashcards). **Defined in the Qbank brainstorm with Warren and reused by Content Review — not pre-built as foundation.** The shape below is the working sketch, to be finalized there:

- **On disk:** one folder per item under `content/`. A structured **YAML** envelope holds the fields; **Markdown** is allowed in all prose fields (stem, choices, explanation, lesson body) and supports LaTeX math and image embeds. Images are **co-located files** referenced by relative path.
- **Validation:** one **Zod schema per content type**; CI validates every file on each PR (missing answer, bad taxonomy code, broken image path → fail).
- **Bundling:** the whole `content/` tree ships inside the installer as an `electron-builder` extra resource; at runtime it is read from `process.resourcesPath` (prod) or the repo (dev). No network.

Sketch of a question on disk (the final schema is decided in the Qbank brainstorm):

```
content/questions/chem-phys/0042-doppler/
├── question.yaml      # id, section, contentCategory, topics, difficulty, stem, choices, correct, explanation
├── figure-1.png
└── figure-2.png
```

Passages get a folder holding the passage text + images + the questions that reference it.

### 5.6 App shell & design system

Navigation across the three module destinations, shared layout, and components/Tailwind config ported from sat-world. Modules render into provided shell slots/routes; they do not invent their own chrome.

### 5.7 Licensing

Code is **MIT** (`LICENSE`); content is **CC BY-SA 4.0** (`CONTENT-LICENSE.md`). All authored content must be original or openly-licensed — never copyrighted exam material.

## 6. Distribution & release model

- Source and authored content live in the public GitHub repo. Community contributes content via **pull requests**; PR review is the moderation, CI validates format.
- **GitHub Actions** builds installers on a `macos-latest` + `windows-latest` matrix with electron-builder and publishes them to **GitHub Releases**. GitHub is effectively the CMS + moderation + distribution — with nothing hosted by the maintainers.
- Builds are **unsigned** initially; users click through Gatekeeper / SmartScreen. Paid signing (Apple Developer ~$99/yr; a Windows cert) is a later decision.

## 7. Per-session workflow

Each work session — including each module — follows the superpowers flow:

1. **Read this charter**, then (for a module) its handoff brief in `docs/handoffs/`.
2. **Brainstorm** the module's internal design (`superpowers:brainstorming`) → write its spec to `docs/superpowers/specs/`.
3. **Plan** it (`superpowers:writing-plans`).
4. **Execute** with review checkpoints (`superpowers:executing-plans` / `subagent-driven-development`).
5. Respect the Foundation contracts in §5; do not modify them without updating this charter.

## 8. Glossary

- **C/P, CARS, B/B, P/S** — the four MCAT sections.
- **Foundational Concept / Content Category** — the AAMC outline's hierarchy for the science sections (e.g., `4A`).
- **SIRS** — Scientific Inquiry & Reasoning Skills (cross-cutting science skills).
- **SRS** — spaced-repetition scheduling. **FSRS** — the modern Free Spaced Repetition Scheduler algorithm the Anki community now favors.
- **`.apkg` / `.colpkg`** — Anki's deck / full-collection export formats (a ZIP wrapping a SQLite collection + media).
- **Cloze** — Anki fill-in-the-blank cards (`{{c1::...}}`).
- **Image occlusion** — Anki cards that hide regions of an image; a complex special note type.
