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
  questions/<section>/<id>/question.yaml   # a standalone (discrete) question
  passages/<section>/<id>/passage.yaml     # a passage + its set of questions
  ...                       figure-*.svg   # images live beside the .yaml that uses them
  README.md                                # this guide
```

`<section>` is one of:

| `<section>` | MCAT section |
| --- | --- |
| `chem-phys`    | Chemical and Physical Foundations of Biological Systems |
| `cars`         | Critical Analysis and Reasoning Skills |
| `bio-biochem`  | Biological and Biochemical Foundations of Living Systems |
| `psych-soc`    | Psychological, Social, and Biological Foundations of Behavior |

The `<section>` folder is **organizational**, but it is not trusted blindly: the loader
**derives** the section from the item's taxonomy tag (below) and rejects the item if the
derived section does not match the folder it sits in. Pick the folder that matches the tag.

`<id>` is a stable, globally unique slug (e.g. `cp-0001-sound-intensity`). It is the key
under which attempts and flags are stored, so **never reuse or rename an `id`** once it has
shipped — that would orphan a user's history.

## The YAML envelope

Every **prose field is Markdown** (see *Markdown & math* below). YAML's block scalar
(`|`) is the friendly way to write multi-line Markdown.

### Standalone question — `question.yaml`

```yaml
id: cp-0001-sound-intensity          # stable, globally unique; the attempt/flag key
contentCategory: "4D"                # taxonomy tag (science). XOR `skill`. Section derives from it.
topics: [sound-intensity, decibels]  # optional free-form tags (NOT taxonomy nodes)
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

```yaml
id: bb-0001-competitive-inhibition   # passage id (also stable + unique)
contentCategory: "1A"                # passage-level tag → section + the DEFAULT tag for its questions
topics: [enzyme-kinetics]
passage: |
  Markdown prose for the passage. May embed math and ![](figure-1.svg).
questions:                           # ordered list; each item is a question MINUS its passage
  - id: bb-0001-q1                    # each question id is also stable + globally unique
    # contentCategory / skill optional here — inherits the passage's tag unless overridden
    stem: |
      ...
    choices: ["...", "...", "...", "..."]
    correct: C
    explanation: |
      ...
    choiceExplanations:
      A: "..."
  - id: bb-0001-q2
    skill: cars-reasoning-beyond      # a question MAY override the passage tag (common in CARS)
    stem: |
      ...
    choices: ["...", "...", "...", "..."]
    correct: B
    explanation: |
      ...
```

## The rules `content:validate` enforces

The validator (`npm run content:validate`) runs the same Zod schemas + loader the app uses,
loading the taxonomy seed so it can resolve codes. It **fails the build** (non-zero exit) on
any error and prints the offending file with a clear reason. The rules:

- **Exactly 4 choices** per question — no more, no fewer.
- **`correct` is a single letter `A`–`D`**, where `A` is the first choice … `D` is the fourth.
- **A required `explanation`** (the main rationale).
- **`choiceExplanations` is optional and may be partial**, but every key must be one of
  `A`/`B`/`C`/`D` (no `E`, no lowercase).
- **Exactly one taxonomy tag** per item: `contentCategory` **or** `skill`, never both, never
  neither. The code must be a **known** taxonomy code.
- **Section derivation matches the folder**: the section implied by the tag must equal the
  `<section>` folder the file lives in.
- **Every referenced relative image exists** on disk, co-located in the item's folder.
- **`id`s are unique** across the whole tree.

## Taxonomy tags

Tag science items with a **content-category code** (`contentCategory`) and CARS items with a
**CARS skill code** (`skill`). The full hierarchy is the AAMC outline seeded in
`src/main/db/taxonomy-seed-data.ts`; the codes are:

- **Content categories (science):** `1A`–`1D`, `2A`–`2C`, `3A`–`3B`, `4A`–`4E`, `5A`–`5E`
  (Chem/Phys & Bio/Biochem), and `6A`–`6C`, `7A`–`7C`, `8A`–`8C`, `9A`–`9B`, `10A` (Psych/Soc).
  Quote them as strings (e.g. `contentCategory: "4D"`) so YAML never reads `1A`/`10A` oddly.
- **CARS skills:** `cars-foundations` (Foundations of Comprehension),
  `cars-reasoning-within` (Reasoning Within the Text),
  `cars-reasoning-beyond` (Reasoning Beyond the Text).

`topics` is a **free-form** list of slugs for your own grouping. Topics are **not** taxonomy
nodes and are not validated against the taxonomy — they are stored on attempts but are not
surfaced in the v1 dashboard.

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

1. Copy an existing item folder under the right `content/<questions|passages>/<section>/`.
2. Give it a new stable `id` (and new question ids for a passage set).
3. Write the prose (Markdown), set exactly 4 choices, set `correct`, write the explanation.
4. Set the taxonomy tag (`contentCategory` or `skill`) that matches the `<section>` folder.
5. Add any images into the same folder and reference them relatively.
6. Run `npm run content:validate` until it reports **0 errors**, then open a PR. CI runs the
   same validation and will block the PR on any failure.
