# Reconcile Qbank onto the shared discipline→topic backbone

## Context update — read this first
Content Review was finished and **merged to `main` ahead of you (PR #5)**. In that work, Warren settled the shared MCAT taxonomy as **discipline→topic** — which **supersedes the AAMC-48-node taxonomy and the standalone content pipeline you built on this branch.** Your Qbank module itself (session engine, grading, flags, dashboard, renderer, seed questions) is solid and stays. What changed is the **shared backbone underneath it**, and the tagging model has grown. This task adapts Qbank onto that backbone per the decided model below — don't rebuild the module, and don't re-litigate the model (it's settled with Warren).

## How to run this session
1. `git fetch origin` so you can see the merged `main`. Re-read `docs/freecat-charter.md` and **the Content Review spec now on `main`** (`docs/superpowers/specs/2026-06-23-content-review-design.md`) to see the taxonomy + loader you're adopting. (You already know your own Qbank spec.)
2. Superpowers flow: `brainstorming` → `writing-plans` → `subagent-driven-development`. Code subagents: **Opus 4.8, max effort.** **The model below is decided with Warren — the brainstorm designs its *implementation*; do not re-open the model.**
3. Bring your branch up to the merged `main` with ONE merge (keep your history):
   `git merge origin/main`  — NOTE: your local `main` ref is stale (points at the Foundation skeleton); merge `origin/main`, not `main`.
   Resolve conflicts once. The real conflict set (verified via `git merge-tree origin/main HEAD`) is all shared pieces:
   - `src/main/db/schema/taxonomy.ts` (add/add): take main's discipline→topic; drop your AAMC version.
   - `drizzle/`: resolve to main's state (CR's `0002_conscious_iron_man.sql` + its `meta/` journal & snapshots). Then delete BOTH migrations your branch added above the shared `0001` baseline — `0002_gorgeous_speed.sql` (your taxonomy) and `0003_aberrant_red_hulk.sql` (your qbank tables) — plus their `meta/` entries, and `npm run db:generate` ONCE on the merged schema to emit a fresh `0003` with your qbank tables + the new tag tables. (Don't try to keep `0003_aberrant_red_hulk.sql`: its snapshot chains off your old `0002` taxonomy and breaks once main's `0002` replaces it.)
   - `src/main/content/loader.ts`, `src/main/db/schema/index.ts`, `src/main/index.ts`, `src/main/repositories/taxonomy.ts`, `src/shared/{dto,channels,api}.ts`, `src/preload/index.ts`, `test/content/{loader,schema}.test.ts`: merge additively — keep CR's base, fold in your pipeline features + the `qbank` namespace. (`package.json`/`package-lock.json` also conflict — take the dependency union.)
   - **Renderer — git WON'T flag these, but they auto-merge into a broken state, so reconcile by hand:** `src/renderer/src/App.tsx` (untouched on your branch) cleanly takes main's version, which owns the cross-link infra (`NavPayload`/`navigate`/`ROUTES`) — keep it. `src/renderer/src/pages/Qbank.tsx` cleanly takes YOUR version, which currently ignores props (`Qbank(_props: PageProps)`). The merged tree compiles, but the cross-link is dead until your Qbank page consumes `navPayload.topicSlug` (see "Reconcile specifics").
   Then do the rework as new commits and PR `feat/qbank` → `main`. Don't rebase; don't merge into `main` until reconciled + green.

## The model (decided — implement, don't relitigate)
- **Primary spine = discipline→topic** (the ~25 categories already seeded on `main`), canonical for **both** lessons and questions.
- **Content tags are per-item and multi-vocabulary** (AAMC + Kaplan, extensible). Tags live on the **items themselves**, not on topics. **Retire the topic→AAMC bridge** (`topic_aamc_category`).
- **Questions:** exactly **one primary topic** for v1 (model question↔topic as a join so multi-topic needs no migration later) + **multiple AAMC/Kaplan tags**.
- **Lessons:** one per topic, with **internal AAMC-tagged sections** — the lesson envelope declares `sections: [{ title, anchor, tags: [{vocab, code}] }]`; the body stays self-contained HTML with matching anchors.
- **Qbank Composer + Dashboard:** organized **by discipline→topic** (scope + accuracy breakdown); **AAMC/Kaplan are optional secondary filters.** Rebuild your AAMC-only browse/dashboard around topics.
- **Cross-link (v1) is topic-level both ways:** "Practice this topic" → a session of that topic's questions; "missed question → lesson" → the **top** of that topic's lesson. (Section-level deep-links are a later enhancement the section tags make possible.)
- **One shared content pipeline:** your richer loader (`freecat-content://` image protocol, `content:validate` CLI, per-type Zod schemas + indices) becomes the single loader in `src/main/content/`, serving **both** questions (co-located figures) and lessons (self-contained HTML + section anchors).

## On `main` already — consume/extend, don't recreate
- Taxonomy: `src/main/db/schema/taxonomy.ts` (discipline/topic; you'll retire `topic_aamc_category`), seed `src/main/db/seed/taxonomy-data.ts`, repo `src/main/repositories/taxonomy.ts`, seeded in `src/main/index.ts`.
- The lesson type `src/main/content/lessons.ts` + `loader.ts` + `root.ts`.
- `contentReview` IPC, `lesson_progress`, the `navigate(key, payload?)` shell extension (`NavPayload = { lessonSlug?, topicSlug? }`). Content Review's lesson reader **feature-detects** `window.freecat.qbank?.questionsForTaxonomy` (presence only — it never calls it) to un-grey its "Practice this topic" button; on click the button runs `navigate('qbank', { topicSlug })`. The `ContentReview` page reads `navPayload.lessonSlug` (inbound deep-links); the symmetric channel you consume is `navPayload.topicSlug`.

## Shared-model evolution (part of this reconcile)
- **Generalize tagging:** replace `topic_aamc_category` with a per-item system — e.g. `content_tag { vocab, code, title }` (seed AAMC + Kaplan vocabularies; keep the existing AAMC reference) + join tables tagging **questions** and **lesson sections**. Many-to-many.
- **Question schema:** `topic` (slug, primary) + `tags: [{vocab, code}]`; section derived from the topic; question↔topic via a join (1 today).
- **Lesson schema (a Content Review change you make here):** add `sections: [{ title, anchor, tags }]` to the lesson envelope; `getLesson` aggregates a lesson's tags from its sections (replacing the old topic-derived `aamcCategories`). Keep the sandboxed-iframe reader; anchors enable future section jumps.

## Your existing code — keep it, adapt only where the model requires
- Keep as-is: the Qbank tables/repos (`qbank_session/attempt/flag` + sessions/attempts/flags/analytics), the session engine (planner, authoritative grading, `recordActivity({ kind: 'qbank.answer', taxonomyRef })` — under the new spine `taxonomyRef` should carry the **topic slug** so streak/analytics attribute to the right topic), the `qbank` IPC, the renderer screens (Session/QuestionView/ChoiceList/PassagePane/Explanation/SessionSummary + Markdown/KaTeX), and the CI workflow.
- Fold your pipeline features (image protocol, `content:validate`, schemas/indices) into the single shared loader in `src/main/content/` rather than keeping a second loader.

## Reconcile specifics
- Re-tag your seed questions to **primary topic + AAMC tags**; update the content schema + section-derivation accordingly.
- Rebuild the Composer + Dashboard around **discipline→topic** with AAMC/Kaplan **tag filters**; accuracy breakdown by topic.
- Build the cross-link both ways. **Inbound (CR → Qbank) is two parts:** (a) expose `window.freecat.qbank.questionsForTaxonomy` on the bridge — the reader only checks it *exists* to enable "Practice this topic"; it never calls it, so the function existing is necessary but not sufficient. (b) Make your Qbank **page read `navPayload.topicSlug` on mount** and scope a session to that topic (call your own `questionsForTaxonomy(topicSlug)` from there). This (b) is what actually carries the click — skip it and the button lights up but lands on an unscoped Qbank: a silent no-op. **Outbound (Qbank → CR), "missed → lesson":** pass the question's **topic slug** to `window.freecat.contentReview.lessonForTaxonomy(topicSlug)`, then `navigate('content', { lessonSlug: ref.slug })`. (The cross-link rides the shared topic slug, so `lessonForTaxonomy` simplifies to topic-slug resolution; the old AAMC-bridge fallback goes away with the bridge.)
- Migrations (same as the `drizzle/` conflict note): keep CR's `0002_conscious_iron_man.sql`; delete your `0002_gorgeous_speed.sql` (taxonomy) AND `0003_aberrant_red_hulk.sql` (qbank tables) + their `meta/` entries; regenerate your qbank tables + the new tag tables as one fresh `0003` via `npm run db:generate`.

## Open for the brainstorm (implementation detail — NOT the model)
- The tag-table shape + how lesson-section tags are stored and queried.
- How the composer's tag filters compose with the primary topic scope (UI + query).
- The single-loader mechanics serving two content types (questions w/ figures, lessons w/ HTML + anchors).
- How `getLesson` surfaces section tags to the reader.

## Don't
- Don't recreate the taxonomy table/seed, keep the `topic_aamc_category` bridge, or keep two content loaders.
- Don't make AAMC the primary browse axis.
- Don't rebase `feat/qbank`; don't merge it into `main` until it's reconciled and green.
