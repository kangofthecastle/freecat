# FreeCAT

An open-source, **local-first** MCAT study app. Free to download, runs entirely on your own machine, no account and no server required.

> **Status: in development.** The app skeleton (Electron + React + SQLite), Gamification, Content Review, Qbank M1, and Flashcards M1 (Anki import + browse + render) are built and tested on `main`. Flashcards spaced repetition (FSRS), audio playback, image occlusion, and packaged installers are still to come. Start with the charter linked below.

## What it is

- **Qbank** — original, openly-licensed MCAT practice questions with explanations (the core experience).
- **Flashcards** — a faithful Anki reviewer: import any `.apkg` / `.colpkg` deck and study it with spaced repetition.
- **Content Review** — readable lessons, tightly cross-linked with the Qbank.
- **Gamification** — a study pet, streaks, XP, and daily goals (ported from the sat-world project).

All progress lives in a single local SQLite file. FreeCAT is distributed as a one-click desktop installer for **macOS and Windows**.

## Read this first

👉 **[`docs/freecat-charter.md`](docs/freecat-charter.md)** — the single source of truth for goals, architecture, and module boundaries. Every work session (human or AI) should read it before touching anything.

## Repository layout

| Path | What |
| --- | --- |
| `docs/freecat-charter.md` | Project charter — vision, architecture, shared contracts, build order |
| `docs/handoffs/` | Per-module kickoff briefs |
| `docs/superpowers/specs/` | Detailed design specs, one per module/milestone |
| `docs/superpowers/plans/` | Implementation plans executed against those specs |
| `src/main/` | Electron main process — DB, IPC, content pipeline, Anki import |
| `src/renderer/` | React UI |
| `src/preload/` · `src/shared/` | IPC bridge and shared types/logic |
| `test/` | Vitest suites (`npm test`) |
| `content/` | Authored question / lesson content (YAML + Markdown + images) |

## Developing

```sh
npm install
npm run dev        # launch the app with hot reload
npm test           # run the test suite
npm run typecheck  # tsc --noEmit
```

## Licensing

- **Code:** MIT — see [`LICENSE`](LICENSE)
- **Content** (questions, lessons): CC BY-SA 4.0 — see [`CONTENT-LICENSE.md`](CONTENT-LICENSE.md)

FreeCAT ships **only original or openly-licensed** content. It never includes AAMC, UWorld, Kaplan, or other copyrighted exam material.
