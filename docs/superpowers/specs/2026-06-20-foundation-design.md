# Foundation (Phase 0) — Design Spec

_Date: 2026-06-20 (updated 2026-06-22) · Project: FreeCAT · Read `docs/freecat-charter.md` first — it is the source of truth; this spec is a working reference._

> **Scope correction (2026-06-22):** The Foundation is the **module-agnostic substrate only**. The **MCAT taxonomy** and the **authored-content pipeline** (originally specced here as C4 and C5) have been **removed from the Foundation** — they're content-shaped contracts defined in the **Qbank brainstorm** (with Warren) and reused by Content Review (charter §5.1 / §5.5).
>
> **Built & shipped (PR #1):** C1 skeleton · C2 DB + profile · C3 IPC · C7 app shell + nav + stubs (plus Tailwind, Vitest, the repository convention). **Remaining Foundation work:** C6 gamification port · C8 packaging/release CI · the rest of C9 repo hygiene.

## Goal

Build the **module-agnostic substrate** every FreeCAT module depends on: a bootable Electron app with a local database, the typed IPC + repository conventions, the shared gamification loop, and the app shell — so each module can then be built in its own session against stable, non-content-specific contracts. Content-shaped contracts (taxonomy, content pipeline) are **out** — defined per-module starting with Qbank.

This phase writes **no module business logic** — only the skeleton, the module-agnostic shared contracts, and the gamification layer.

## Scope

**In:** Electron+Vite app skeleton · SQLite/Drizzle + migrations + first-run profile · typed IPC data layer + repository convention · ported gamification layer · app shell / navigation / design system with stubbed module routes · packaging + release CI · repo hygiene.

**Out (deferred):** the **MCAT taxonomy** and the **authored-content pipeline** (format, Zod schemas, loader, `content:validate`, bundling) → defined in the **Qbank brainstorm**, reused by Content Review. Also out: module business logic/screens (stubs only) · the SRS/FSRS engine + Anki import (Flashcards) · code signing.

## Components

Each component lists **purpose / interface / dependencies**.

### C1 — Electron + Vite + React skeleton ✅ built
- **Purpose:** the desktop app shell that boots a React renderer and a Node main process.
- **Interface:** `electron-vite` project (main / preload / renderer entry points); `npm run dev` (HMR) and `npm run build`; a single `BrowserWindow`.
- **Depends on:** nothing (the root).

### C2 — SQLite + Drizzle + migrations + first-run profile ✅ built
- **Purpose:** the local datastore.
- **Interface:** Drizzle client (`drizzle-orm/libsql` + `@libsql/client`) opening one DB file in Electron's `userData` dir; `drizzle-kit` for migration generation; a startup migrator that applies pending migrations; first-run logic that creates the single `profile` row.
- **Depends on:** C1. **Note:** libsql ships N-API prebuilt binaries (ABI-stable), so it loads under both Electron and plain-Node Vitest with no per-ABI rebuild — only the platform-correct binary must be packaged (handled in C8).

### C3 — Typed IPC data layer ✅ built
- **Purpose:** the only path from renderer to database.
- **Interface:** preload `contextBridge` exposes a namespaced async API on `window.freecat` (e.g. `profile.*`; modules later add `qbank.*`, `content.*`, `flashcards.*`). Main-process handlers own all Drizzle access; payloads validated with **Zod** at the boundary. A consistent per-namespace registration pattern. (See charter §5.3 for the hardening to adopt when the second namespace is added.)
- **Depends on:** C1, C2.

### C4 & C5 — REMOVED → deferred to the Qbank brainstorm
The **MCAT taxonomy** and the **authored-content pipeline** were originally specced here as Foundation components. They are *content-shaped* — they encode product decisions about how questions/lessons are structured and organized — so per the charter they're defined **with Warren in the Qbank brainstorm** (the first content module) and reused by Content Review, **not pre-built** in the Foundation. A draft taxonomy encoding (the full AAMC outline) exists in git history (commits `6b3880a`, `181bdec`) as a reusable starting point.

### C6 — Gamification layer (ported) ⏳ remaining
- **Purpose:** the shared pet/streak/XP/daily-goal loop all modules feed (charter §5.4).
- **Interface:** gamification tables; a `recordActivity({ kind, count, taxonomyRef? })` operation exposed over IPC; React components for the pet, streak, XP, and daily-goal surfaces.
- **Port from sat-world:** `src/lib/rewards/*` (economy, config, types; carry over hatch/incubation/wellbeing/catalog as desired for the core loop), `src/lib/services/{pets,rewards}.ts`, `src/actions/pets.ts` (re-homed from Next server actions to IPC handlers), and `src/components/pet/*` + `src/components/coin.tsx`. Keep the carried-over rewards unit tests.
- **Scope to the core loop:** pet that reacts to study activity + streak + XP + daily goal. Trim SAT-specific bits (vocabulary, students/teacher).
- **Depends on:** C2, C3, C7.

### C7 — App shell, navigation & design system ✅ built
- **Purpose:** the chrome modules render into.
- **Interface:** top-level navigation across three module destinations + a home/dashboard surface (will host gamification); shared layout; Tailwind v4 + shared components. **Stubbed routes/screens** for Qbank, Content Review, Flashcards so navigation works before modules exist.
- **Depends on:** C1.

### C8 — Packaging & release ⏳ remaining
- **Purpose:** deliver the one-click installers (charter §6).
- **Interface:** electron-builder config (macOS `.dmg`, Windows NSIS `.exe`); a **GitHub Actions** workflow with a `macos-latest` + `windows-latest` matrix that builds and publishes to GitHub Releases. **Unsigned** for now.
- **Depends on:** C1. **Note:** do not rely on local cross-building Windows from macOS — let CI build each OS natively.

### C9 — Repo hygiene (partial)
- **Purpose:** a contributor-ready open-source repo.
- **Interface:** `tsconfig`, ESLint, Vitest configs; a `CONTRIBUTING.md` documenting the contribution/PR flow; npm scripts (`dev`, `build`, `db:generate`, `db:migrate`, `test`). (Content-format docs + `content:validate` + an example question arrive with the content pipeline in the Qbank work.)
- **Depends on:** C1. **Status:** `tsconfig` + Vitest config + the repository convention are in; ESLint config + `CONTRIBUTING.md` remain.

## Shared data model (Foundation-owned tables)

- `profile` — single local user (display name, created-at, preferences).
- Gamification — pet state, XP/economy balance (+ ledger if ported), streak, daily-goal progress (final shape follows the sat-world port).

(The `taxonomy_node` + `content_registry` tables are established by **Qbank** — the first content module — not the Foundation.)

Modules add their own tables and migrations later; they never alter the meaning of these.

## Suggested internal build sequence

1. **F1** — C1 Electron+Vite skeleton boots an empty window. ✅
2. **F2** — C2 SQLite/Drizzle + migrations + first-run profile; C3 IPC pattern (with `profile.*`). ✅
3. **F3** — C7 shell/navigation + design system; three stubbed module routes. ✅
4. **F4** — C6 gamification port wired through IPC and shown on the dashboard. ⏳
5. **F5** — C8 electron-builder + GitHub Actions release matrix. ⏳

## Testing

- **Unit (Vitest):** the existing repository + IPC-validation tests; plus the carried-over rewards/gamification tests from sat-world (with C6).
- **Smoke:** app boots, runs migrations, creates the profile, renders the shell, navigates all three stubs. ✅
- **CI:** unit tests + typecheck + build on every PR. (The `content:validate` step is added with the content pipeline in the Qbank work.)

## Acceptance criteria

1. `npm run dev` boots the app; renders the shell; navigates the three stubbed module screens. ✅
2. On first run, the SQLite DB is created in `userData`, migrations apply, and a `profile` row exists. ✅
3. The gamification surface renders on the dashboard and updates when a test `recordActivity` call is made over IPC. ⏳ (C6)
4. The GitHub Actions matrix produces a macOS `.dmg` + Windows `.exe` and attaches them to a Release (unsigned). ⏳ (C8)
5. No renderer code accesses SQLite directly — all data flows through the typed IPC layer. ✅

## Risks & notes

- **Native dependency packaging:** libsql is N-API (no per-ABI rebuild), but the platform-correct prebuilt binary must be included and unpacked from the asar at packaging time (C8); verify on a packaged build early.
- **Cross-OS builds:** build natively per-OS in CI; treat local Windows builds from macOS as unsupported.
- **Unsigned warnings:** acceptable for now, but document the click-through for users in the README at release time.
- **Schema modularity:** structure the Drizzle schema so modules can add table files without painful merges (per-domain schema files re-exported from one index).
- _(The content path-resolution risk moves to the content-pipeline work in Qbank.)_
