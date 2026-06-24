# Authoring Content Review lessons

A lesson is one folder under `content/lessons/<discipline>/<topic-slug>/`:

- `lesson.yaml` — `slug` (must match a taxonomy topic slug in `src/main/db/seed/taxonomy-data.ts`), `title`, optional `summary`, `order`, `bodyFile`.
- `body.html` — the lesson, as **fully self-contained interactive HTML**.

## Rules
- **Offline / no network.** Inline all CSS, JS, images (data URIs), and math (KaTeX/MathJax inlined or pre-rendered). No CDN links — the app runs with no network.
- **Sandboxed.** The HTML renders in `<iframe sandbox="allow-scripts">` with an opaque origin. It cannot access the app, your data, or other lessons. Only `allow-scripts` is granted (no forms/popups).
- **Cross-links** come from the taxonomy, not the lesson — tag the matching topic slug; the app supplies "Practice this topic" and related questions.

## Disciplines (v1)
`gen-chem`, `o-chem`, `biology`, `biochem`, `behavioral-sci`. (Physics and CARS are out of v1.)
