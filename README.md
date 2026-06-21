# FreeCAT

An open-source, **local-first** MCAT study app. Free to download, runs entirely on your own machine, no account and no server required.

> **Status: design phase.** There is no application code yet. This repository currently holds the project's design documents. Start with the charter linked below.

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
| `docs/handoffs/` | Per-module kickoff briefs — authored once the Foundation is planned |
| `docs/superpowers/specs/` | Detailed design specs (Foundation first) |
| `content/` | Authored question / lesson content (YAML + Markdown + images) |

## Licensing

- **Code:** MIT — see [`LICENSE`](LICENSE)
- **Content** (questions, lessons): CC BY-SA 4.0 — see [`CONTENT-LICENSE.md`](CONTENT-LICENSE.md)

FreeCAT ships **only original or openly-licensed** content. It never includes AAMC, UWorld, Kaplan, or other copyrighted exam material.
