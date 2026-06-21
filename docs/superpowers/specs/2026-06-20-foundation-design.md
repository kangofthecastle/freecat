# Foundation (Phase 0) — Design Spec

_Date: 2026-06-20 · Project: FreeCAT · Read `docs/freecat-charter.md` first._

## Goal

Build the shared substrate every FreeCAT module depends on, and establish **all inter-module contracts** so the three modules (Qbank, Content Review, Flashcards) can be built independently afterward. "Done" means: the app installs and boots on macOS and Windows, navigates between three stubbed module screens, initializes its local database and profile, shows a working gamification surface, validates and bundles authored content, and produces signed-later installers from CI.

This phase writes **no module business logic** — only the skeleton, contracts, and the gamification layer (which is shared).

## Scope

**In:** Electron+Vite app skeleton · SQLite/Drizzle + migrations + first-run profile · typed IPC data layer · MCAT taxonomy + seed · authored-content pipeline (format, Zod validation, CI, bundling) · ported gamification layer · app shell / navigation / design system with stubbed module routes · packaging + release CI · repo hygiene.

**Out:** Qbank/Content Review/Flashcards business logic and screens (stubs only) · the SRS/FSRS engine (belongs to Flashcards) · Anki import (Flashcards) · code signing (deferred).

## Components

Each component lists **purpose / interface / dependencies**.

### C1 — Electron + Vite + React skeleton
- **Purpose:** the desktop app shell that boots a React renderer and a Node main process.
- **Interface:** `electron-vite` project (main / preload / renderer entry points); `npm run dev` (HMR) and `npm run build`; a single `BrowserWindow`.
- **Depends on:** nothing (the root).

### C2 — SQLite + Drizzle + migrations + first-run profile
- **Purpose:** the local datastore.
- **Interface:** Drizzle client (`drizzle-orm/libsql` + `@libsql/client`) opening one DB file in Electron's `userData` dir; `drizzle-kit` for migration generation; a startup migrator that applies pending migrations; first-run logic that creates the single `profile` row.
- **Depends on:** C1. **Note:** libsql ships N-API prebuilt binaries (ABI-stable), so it loads under both Electron and plain-Node Vitest with no per-ABI rebuild — only the platform-correct binary must be packaged (handled in C8).

### C3 — Typed IPC data layer
- **Purpose:** the only path from renderer to database.
- **Interface:** preload `contextBridge` exposes a namespaced async API on `window.freecat` (e.g. `profile.*`, `gamification.*`; modules later add `qbank.*`, `content.*`, `flashcards.*`). Main-process handlers own all Drizzle access; payloads validated with **Zod** at the boundary. Establish the pattern + a small typed helper so each module registers its namespace consistently.
- **Depends on:** C1, C2.

### C4 — MCAT taxonomy
- **Purpose:** the shared cross-linking backbone (charter §5.1).
- **Interface:** a `taxonomy_node` table + a typed accessor; seed data generated from the published **AAMC content outline** (sections → foundational concepts → content categories → topics; CARS skills; SIRS + discipline tags).
- **Depends on:** C2. **Note:** seed is a static, version-controlled dataset; include an integrity test (every content category has a parent section; codes unique).

### C5 — Authored-content pipeline
- **Purpose:** turn `content/` files into validated, bundled, in-app data (charter §5.5). Serves Qbank + Content Review (not Flashcards).
- **Interface:**
  - **Format:** one folder per item; **YAML** envelope + **Markdown** prose fields + co-located images.
  - **Schemas:** Zod schema per content type. Foundation ships the **question** schema and a **lesson** base schema (modules may extend via charter PR). Canonical question schema:
    ```
    id: string                         # unique, e.g. "cp-0042"
    section: 'chem-phys'|'cars'|'bio-biochem'|'psych-soc'
    contentCategory?: string           # e.g. "4A" (omit for CARS)
    skill?: string                     # CARS skill (omit for science)
    topics: string[]
    difficulty: 'easy'|'medium'|'hard'
    passageId?: string                 # if part of a passage set
    stem: string                       # Markdown (math + images allowed)
    choices: { id: 'A'|'B'|'C'|'D', text: string }[]   # exactly 4
    correct: 'A'|'B'|'C'|'D'
    explanation: string                # Markdown
    ```
  - **Loader:** reads `content/`, parses YAML, validates against Zod, resolves image paths.
  - **Validator CLI:** `npm run content:validate` — fails on missing answer, bad taxonomy code, broken image reference, duplicate id.
  - **Bundling:** `content/` ships as an electron-builder `extraResources`; runtime resolves from `process.resourcesPath` (prod) or repo (dev).
  - **CI:** a workflow runs the validator on every PR.
- **Depends on:** C4 (taxonomy codes), C2 (optional content registry table).

### C6 — Gamification layer (ported)
- **Purpose:** the shared pet/streak/XP/daily-goal loop all modules feed (charter §5.4).
- **Interface:** gamification tables; a `recordActivity({ kind, count, taxonomyRef? })` operation exposed over IPC; React components for the pet, streak, XP, and daily-goal surfaces.
- **Port from sat-world:** `src/lib/rewards/*` (economy, config, types; carry over hatch/incubation/wellbeing/catalog as desired for the core loop), `src/lib/services/{pets,rewards}.ts`, `src/actions/pets.ts` (re-homed from Next server actions to IPC handlers), and `src/components/pet/*` + `src/components/coin.tsx`. Keep the carried-over rewards unit tests.
- **Scope to the core loop:** pet that reacts to study activity + streak + XP + daily goal. Trim SAT-specific bits (vocabulary, students/teacher).
- **Depends on:** C2, C3, C7.

### C7 — App shell, navigation & design system
- **Purpose:** the chrome modules render into.
- **Interface:** top-level navigation across three module destinations + a home/dashboard surface (hosts gamification); shared layout; Tailwind v4 config + shared components ported from sat-world. Provide **stubbed routes/screens** for Qbank, Content Review, Flashcards so navigation works before modules exist.
- **Depends on:** C1.

### C8 — Packaging & release
- **Purpose:** deliver the one-click installers (charter §6).
- **Interface:** electron-builder config (macOS `.dmg`, Windows NSIS `.exe`); a **GitHub Actions** workflow with a `macos-latest` + `windows-latest` matrix that builds and publishes to GitHub Releases. **Unsigned** for now.
- **Depends on:** C1. **Note:** do not rely on local cross-building Windows from macOS — let CI build each OS natively.

### C9 — Repo hygiene
- **Purpose:** a contributor-ready open-source repo.
- **Interface:** `tsconfig`, ESLint, Vitest configs (ported/adapted from sat-world); `CONTRIBUTING.md` documenting the content format + PR flow + `content:validate`; one **example question** committed under `content/questions/...` as a living template that passes validation in CI; npm scripts (`dev`, `build`, `content:validate`, `db:generate`, `db:migrate`, `test`).
- **Depends on:** C5.

## Shared data model (Foundation-owned tables)

- `profile` — single local user (display name, created-at, preferences).
- `taxonomy_node` — `{ id, kind, code, title, parentId }`.
- `content_registry` — metadata about loaded authored content (id, type, taxonomy refs, source path) for fast lookup/joins.
- Gamification — pet state, XP/economy balance (+ ledger if ported), streak, daily-goal progress (final shape follows the sat-world port).

Modules add their own tables and migrations later; they never alter the meaning of these.

## Suggested internal build sequence

1. **F1** — C1 Electron+Vite skeleton boots an empty window.
2. **F2** — C2 SQLite/Drizzle + migrations + first-run profile; C3 IPC pattern (with `profile.*`).
3. **F3** — C7 shell/navigation + design-system port; three stubbed module routes.
4. **F4** — C4 taxonomy + seed.
5. **F5** — C5 content pipeline + example question + `content:validate` + CI.
6. **F6** — C6 gamification port wired through IPC and shown on the dashboard.
7. **F7** — C8 electron-builder + GitHub Actions release matrix.

## Testing

- **Unit (Vitest):** taxonomy seed integrity; content validator against the example + intentionally-broken fixtures; carried-over rewards/gamification tests from sat-world.
- **Smoke:** app boots, runs migrations, creates the profile, renders the shell, navigates all three stubs.
- **CI:** runs `content:validate` + unit tests on every PR; the release workflow builds both installers.

## Acceptance criteria

1. `npm run dev` boots the app on macOS; the window renders the shell and navigates between the three stubbed module screens.
2. On first run, the SQLite DB is created in `userData`, migrations apply, and a `profile` row exists.
3. The MCAT taxonomy is seeded and queryable over IPC; integrity test passes.
4. The example question validates; a deliberately broken fixture fails `content:validate`; CI runs the validator.
5. The gamification surface renders on the dashboard and updates when a test `recordActivity` call is made over IPC.
6. The GitHub Actions matrix produces a macOS `.dmg` and a Windows `.exe` and attaches them to a Release (unsigned).
7. No renderer code accesses SQLite directly — all data flows through the typed IPC layer.

## Risks & notes

- **Native dependency packaging:** libsql is N-API (no per-ABI rebuild), but the platform-correct prebuilt binary must be included and unpacked from the asar at packaging time (C8); verify on a packaged build early.
- **Content path resolution:** dev (repo) vs prod (`process.resourcesPath`) divergence is a classic Electron bug — abstract it behind one resolver and test the packaged build.
- **Cross-OS builds:** build natively per-OS in CI; treat local Windows builds from macOS as unsupported.
- **Unsigned warnings:** acceptable for now, but document the click-through for users in the README at release time.
- **Schema modularity:** structure the Drizzle schema so modules can add table files without painful merges (per-domain schema files re-exported from one index).
