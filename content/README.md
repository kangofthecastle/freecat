# Authoring FreeCAT content

This folder holds FreeCAT's **authored content**: original MCAT-style practice
questions and passages. Everything here is loaded at app startup, validated in CI,
and rendered in the Qbank. This guide is the contract for contributing it.

> **License & origin (hard rule).** All content under `content/` is **CC BY-SA 4.0**
> (see [`../CONTENT-LICENSE.md`](../CONTENT-LICENSE.md)). Every item must be either
> **original** (written for FreeCAT, e.g. AI-drafted then human-reviewed) or
> **openly licensed** and CC BY-SA-compatible with attribution recorded. **Never**
> copy, paraphrase, or adapt questions from AAMC, UWorld, Kaplan, Princeton Review,
> Blueprint, or any other copyrighted exam-prep material. Such contributions are
> rejected in review.

## Folder layout

One folder per item. The folder holds the YAML envelope and any co-located images.

```
content/
  questions/<id>/question.yaml   # a standalone (discrete) question
  passages/<id>/passage.yaml     # a passage + its set of questions
  ...            figure-*.svg     # images live beside the .yaml that uses them
  README.md                      # this guide
```

The loader walks `content/questions/**` for `question.yaml` files and
`content/passages/**` for `passage.yaml` files at **any nesting depth**, so you may
group items into sub-folders for your own organization if you like — grouping is
**not** trusted for taxonomy. The MCAT **section** an item belongs to is **derived**
from the item's `topic` (below), never from the folder it sits in.

`<id>` is a stable, globally unique slug (e.g. `cp-0001-sound-intensity`). It is the key
under which attempts and flags are stored, so **never reuse or rename an `id`** once it has
shipped — that would orphan a user's history.

## The YAML envelope

Every **prose field is Markdown** (see *Markdown & math* below). YAML's block scalar
(`|`) is the friendly way to write multi-line Markdown.

Each item declares exactly one **`topic`** — a slug from the seeded discipline→topic
taxonomy (`src/main/db/seed/taxonomy-data.ts`, e.g. `physics.waves-sound-light`,
`biochem.enzymes`). The item's discipline and MCAT section are derived from that topic.
Items may also carry zero or more **`tags`**, each `{ vocab, code }` (e.g.
`{ vocab: aamc, code: '4D' }`), used for cross-cutting analytics and filtering.

### Standalone question — `question.yaml`

```yaml
id: cp-0001-sound-intensity          # stable, globally unique; the attempt/flag key
topic: physics.waves-sound-light     # REQUIRED — one primary taxonomy topic slug
tags: [{ vocab: aamc, code: '4D' }]  # OPTIONAL — 0+ { vocab, code } tags; defaults to []
stem: |
  Markdown prose for the question. May embed math and images:
  ![alt text](figure-1.svg)
choices:                             # EXACTLY 4. Each is Markdown (may contain math/images).
  - "First choice"
  - "Second choice"
  - "Third choice"
  - "Fourth choice"
correct: A                           # one letter A–D. A = the first choice, D = the fourth.
explanation: |                       # REQUIRED main rationale (Markdown).
  Why the correct answer is correct.
choiceExplanations:                  # OPTIONAL, may be partial. Keys must be A/B/C/D.
  B: "Why choice B is wrong."
  C: "Why choice C is wrong."
  D: "Why choice D is wrong."
```

### Passage set — `passage.yaml`

A passage holds shared prose plus an **ordered** list of its questions. **Passage sets are
always served whole** in a session, so order the questions the way they should be read.
Sub-questions **inherit the passage's `topic`**; each may carry its own `tags` (which
override the passage's tags for that question), otherwise it inherits the passage's tags.

```yaml
id: bb-0001-competitive-inhibition   # passage id (also stable + unique)
topic: biochem.enzymes               # REQUIRED — the passage's primary topic (inherited by its questions)
tags: [{ vocab: aamc, code: '1A' }]  # OPTIONAL — default tags for the passage and its questions
passage: |
  Markdown prose for the passage. May embed math and ![](figure-1.svg).
questions:                           # ordered list; each item is a question MINUS its passage
  - id: bb-0001-q1                    # each question id is also stable + globally unique
    # tags optional here — inherits the passage's tags unless this question sets its own
    stem: |
      ...
    choices: ["...", "...", "...", "..."]
    correct: A
    explanation: |
      ...
    choiceExplanations:
      B: "..."
  - id: bb-0001-q2
    tags: [{ vocab: aamc, code: '1D' }]   # a question MAY override the passage tags
    stem: |
      ...
    choices: ["...", "...", "...", "..."]
    correct: B
    explanation: |
      ...
```

## The rules `content:validate` enforces

The validator (`npm run content:validate`) runs the same Zod schemas + loader the app uses,
loading the taxonomy seed so it can resolve topics and tags. It **fails the build** (non-zero
exit) on any error and prints the offending file with a clear reason. The rules:

- **A required `topic`** per item, which must be a **known** taxonomy topic slug. The
  discipline and MCAT section are derived from it (no section folders, no section field).
- **Every `tag` is known**: each `{ vocab, code }` must exist in the content tag vocabulary
  (`src/main/content/tags.ts`). `tags` is optional and defaults to `[]`.
- **Exactly 4 choices** per question — no more, no fewer.
- **`correct` is a single letter `A`–`D`**, where `A` is the first choice … `D` is the fourth.
- **A required `explanation`** (the main rationale).
- **`choiceExplanations` is optional and may be partial**, but every key must be one of
  `A`/`B`/`C`/`D` (no `E`, no lowercase).
- **Unknown envelope keys are rejected** (the schema is strict): the legacy
  `contentCategory`, `skill`, and free-form `topics` keys are no longer accepted.
- **Every referenced relative image exists** on disk, co-located in the item's folder.
- **`id`s are unique** across the whole tree (passage sub-question ids included).

## Topics & tags

- **`topic`** is the single primary classification — a slug from the merged
  discipline→topic taxonomy seeded in `src/main/db/seed/taxonomy-data.ts`. Disciplines are
  `gen-chem`, `o-chem`, `physics`, `biology`, `biochem`, and `behavioral-sci`; topic slugs are
  `<discipline>.<name>` (e.g. `physics.mechanics`, `behavioral-sci.learning-memory-cognition`).
  The MCAT section follows the discipline: `gen-chem`/`o-chem`/`physics` → Chem/Phys,
  `biology`/`biochem` → Bio/Biochem, `behavioral-sci` → Psych/Soc.
- **`tags`** are cross-cutting labels in `{ vocab, code }` form. The shipped vocabulary is the
  31 AAMC content categories under `vocab: aamc` (`1A`–`1D`, `2A`–`2C`, `3A`–`3B`, `4A`–`4E`,
  `5A`–`5E`, `6A`–`6C`, `7A`–`7C`, `8A`–`8C`, `9A`–`9B`, `10A`). Quote the code as a string
  (e.g. `code: '4D'`) so YAML never reads `1A`/`10A` oddly. Tags drive the dashboard's AAMC
  breakdown and the Composer's optional tag filter.

## Markdown & math

- **Markdown** renders via `react-markdown`. **Raw HTML is disabled** — do not write `<div>`,
  `<script>`, etc.; they will not render (this keeps community content safe). Use Markdown
  constructs (emphasis, lists, tables, code) instead.
- **LaTeX math** is supported via `remark-math` + KaTeX. Use `$...$` for inline math and
  `$$...$$` for display math, e.g. `$v_0 = \frac{V_{\max}[S]}{K_m + [S]}$`. Inside a
  *double-quoted* YAML string, escape backslashes (`\\frac`); inside a `|` block scalar you
  do not need to.

## Images

- Images are **co-located** files in the item's folder, referenced by **relative path**:
  `![alt text](figure-1.svg)`. No absolute paths, no `../` escapes, no remote URLs.
- **Image filenames must NOT contain parentheses or spaces.** The Markdown image syntax
  `![alt](path)` ends the path at the first `)`, so a name like `figure (1).svg` truncates
  to `figure ` and the image fails to resolve. Use simple names such as `figure-1.svg`,
  `diagram-cell.png`, or `plot-2.svg` — letters, digits, hyphens, and a single extension.
- The format is up to you (`.svg`, `.png`, `.jpg`). **SVG is preferred** when a figure can be
  drawn as text/vector: it is authorable directly in the repo, diffs cleanly, and scales
  crisply. The loader rewrites the relative path to the internal `freecat-content://` protocol,
  which serves the file from the content root only (path-escape-guarded). Always write
  meaningful `alt` text.
- Images may appear **anywhere prose appears** — the stem, the passage, any of the four
  choices, and the explanation.

## Adding an item — quick checklist

1. Copy an existing item folder under `content/questions/` or `content/passages/`.
2. Give it a new stable `id` (and new question ids for a passage set).
3. Write the prose (Markdown), set exactly 4 choices, set `correct`, write the explanation.
4. Set the `topic` (a known taxonomy slug) and any `tags` (known `{ vocab, code }` entries).
5. Add any images into the same folder and reference them relatively.
6. Run `npm run content:validate` until it reports **0 errors**, then open a PR. CI runs the
   same validation and will block the PR on any failure.
