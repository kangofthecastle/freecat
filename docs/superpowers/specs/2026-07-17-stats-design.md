# Stats (Module 4) — the analytics port from sat-world

> Phase 1 of the SAT World port roadmap (`2026-07-17-satworld-port-roadmap.md` — read it first for the port-wide decisions; charter for module rules). Module 4 is read-only and needs **no migration**: every input it needs is already recorded by Qbank (`qbank_attempt`), Flashcards (`review_log`, `card_scheduling`), Content Review (`lesson_progress`), and Gamification (`daily_activity`). This spec covers the whole module (single milestone). The mastery-over-time trend view is **Phase 4**; Plan is Modules 5's problem. Deliverable: a Stats page whose every number would still be honest if Plan never shipped.

## Goal

Open Stats → see per-topic mastery (Bayesian-shrunk, recency-decayed, flagged when there isn't enough data to mean anything) rolled up topic→discipline→section, error fingerprints ("you rush and miss" vs "you're slow and still miss"), time-per-question pacing against your own median, a GitHub-style activity heatmap, an effort trend, and the FSRS workload ahead of you — computed live from raw tables on every open, no caches, no rollups. The qbank accuracy Dashboard is absorbed here: one analytics surface, not two.

## Decisions (locked)

- **Pure/adapter split, sat-world shape.** Pure DB-free engines in `src/main/stats/` (file-per-concern, "Pure + DB-free" header convention); one repository (`src/main/repositories/stats.ts`) translates Drizzle rows + content index → plain-object inputs → pure fns → `StatsOverview` DTO; `src/main/ipc/stats.ts` is a Zod-validated dumb pipe. Display-only helpers (heatmap geometry, insight copy) live renderer-side in `src/renderer/src/stats/`.
- **Mastery semantics ported verbatim from sat-world's `computeMastery`**: per-attempt weight `w = exp(-ageDays / 21) × difficultyWeight`, Bayesian shrinkage toward prior `p0 = 0.5` with strength `k = 3`, `needsData` when `nEff < 2`, `stale` when the latest attempt is >14 days old, coverage = distinct attempted questions ÷ published questions. `difficultyWeight` is a parameter fed **1.0** everywhere (content has no difficulty tag yet; the knob ports so real weights arrive for free later). All tunables in `STATS_CONFIG`, not inline.
- **Rollups recompute, never average.** Discipline/section mastery runs `computeMastery` over the **union** of the level's attempt stream (concatenated child-topic attempts, published counts summed) — not a weighted average of child mastery values. Averaging propagates the prior of empty topics into the parent; recomputing keeps `nEff`/`needsData` honest at every level.
- **Sections are the content model's three** — `chem-phys`, `bio-biochem`, `psych-soc` (`SectionCode`, `src/main/content/types.ts`). No CARS row: FreeCAT has no CARS content taxonomy, and an empty permanent row would be a lie. (The roadmap's "C/P, CARS, B/B, P/S" resolution is hereby corrected to the sections that exist.)
- **One time convention: local dayKeys.** Every window ("last 60 days", "last 7 days") means local calendar days via the existing `dayKeyInTz(date, appTz())` (`src/shared/gamification/dates.ts`, `src/main/repositories/activity.ts`). No rolling-instant cutoffs anywhere in the module (roadmap: B10/B13 fixed by construction).
- **Fingerprints get the roadmap's B9 fix**: classification runs over the last **60 local days** only (`STATS_CONFIG.fingerprints.windowDays = 60`), not all-time. Ported modes minus `timeout` (blank/timeout attempts are impossible by schema — `chosen` is non-null): `repeated_distractor` (≥2 same wrong letter on one topic), `careless_fast` (wrong at <0.5× own median time), `slow_wrong` (wrong at >1.5× own median), else `standard`. Per-section time baselines need ≥5 timed attempts (`timeMs` is nullable — untimed attempts join accuracy but never time baselines); below that, no time-based fingerprint is asserted.
- **Pacing is self-relative; AAMC lines are decoration.** Medians and outliers (>2× own median) compute from the user's own windowed `timeMs`. The AAMC per-section seconds-per-question (95 min/59 Q ≈ 97 s — identical for all three content sections, kept as a per-section map in config anyway) render as labeled reference lines, never thresholds, never judgments (roadmap resolution 2).
- **Two different "activity" sources, on purpose.** The **heatmap** reads `daily_activity` — the gamification module's own counter, so the heatmap agrees exactly with what the pet economy already rewarded. The **effort trend** computes from raw module tables (`qbank_attempt.answeredAt`, `review_log.reviewedAt`, `lesson_progress.completedAt`) with sat-world's weights minus mocks: `questions × 3 + flashcardReviews × 0.25 + lessonsCompleted × 10`. They answer different questions ("did I show up" vs "how much did it count") and deliberately don't reconcile.
- **Full-scan honesty.** The repository reads every attempt/review row on each Stats open — fine at personal scale (roadmap: no rollups), and the module makes no silent caps. If profiling ever objects, the escape hatch is the Phase 4 lazy cache, not a quiet `LIMIT`.
- **Qbank Dashboard absorbed, composer counts stay.** `qbank:dashboard` (`CH.qbankDashboard`), `getDashboard` in `qbank-analytics.ts`, and `src/renderer/src/qbank/Dashboard.tsx` are **deleted**; their accuracy + by-AAMC views move into Stats (AAMC double-count-per-tag behavior kept, with its explanatory caption). `getCounts` (incorrect/flagged counts feeding the session composer's refine options) is session-building, not analytics — it stays in qbank. The Qbank page gets a "Stats →" link via the existing `navigate('stats')`.
- **Module 4 owns no tables** (charter §5.2 update rides this PR: "Module 4 — Stats owns: nothing; read-only over qbank/flashcards/content/gamification data"). It also owns no writes — there is no `recordActivity` hookup here; looking at your stats is not study.

## Data sources (no migration)

| Table / source | Columns used | Feeds |
|---|---|---|
| `qbank_attempt` | `questionId`, `topic`, `discipline`, `section`, `chosen`, `isCorrect`, `timeMs`, `answeredAt` | mastery, fingerprints, pacing, effort |
| content index (`ContentIndex`) | `byTopic`/`byDiscipline` sizes → published counts; `byId(...).tags` → AAMC tallies; `correct` letter → distractor identification | coverage, by-AAMC, `repeated_distractor` |
| `review_log` | `rating`, `reviewedAt` | effort, again-rate |
| `card_scheduling` | `state`, `due`, `reps`, `lapses`, `introducedDay` | flashcard workload |
| `lesson_progress` | `completedAt` | effort |
| `daily_activity` | `dayKey`, `count` | heatmap |

## Main-process modules

**`src/main/stats/config.ts`** — `STATS_CONFIG`: `mastery { tauDays: 21, priorK: 3, priorP0: 0.5, needsDataNEff: 2, staleDays: 14 }`, `fingerprints { windowDays: 60, minTimedForBaseline: 5, carelessFastRatio: 0.5, slowWrongRatio: 1.5, repeatedDistractorMin: 2 }`, `pacing { windowDays: 60, outlierRatio: 2 }`, `effort { question: 3, flashcardReview: 0.25, lessonCompleted: 10, trendDays: 90 }`, `referenceSecPerQ: Record<SectionCode, number>`, `flashcards { horizonDays: 7, againRateDays: [7, 30] }`.

**`src/main/stats/mastery.ts`** — pure. `computeMastery(attempts: MasteryAttempt[], publishedCount: number, now: Date): MasteryResult` where `MasteryAttempt = { isCorrect: boolean; answeredAt: Date; difficultyWeight?: number }` and `MasteryResult = { mastery: number; nEff: number; coverage: number; needsData: boolean; stale: boolean; attempted: number }`. Ported semantics per Decisions; zero attempts ⇒ `mastery = p0`, `needsData = true`, `stale = false` (nothing to be stale *from*).

**`src/main/stats/fingerprints.ts`** — pure. `classifyFingerprint(attempts: FingerprintAttempt[], correctByQuestion: Map<string, ChoiceLetter>, medianTimeMs: number | null): Fingerprint` per topic, where `FingerprintAttempt = { questionId, chosen, isCorrect, timeMs }` (already window-filtered by the caller) and `Fingerprint = { mode: 'repeated_distractor' | 'careless_fast' | 'slow_wrong' | 'standard'; evidence: string }` — `evidence` is a short factual clause ("missed with (C) 3× in biochem.enzymes"), composed here so the renderer never re-derives it. Priority order when multiple match: repeated_distractor > careless_fast > slow_wrong (specific beats temporal).

**`src/main/stats/effort.ts`** — pure. `effortPoints(day: { questions: number; flashcardReviews: number; lessonsCompleted: number }, cfg): number` plus `buildEffortTrend(events, from, to, tz): EffortDay[]` bucketing raw timestamps into local dayKeys (zero-filled range).

**`src/main/stats/flashcard-load.ts`** — pure. `summarizeFlashcards(scheduling: SchedulingRow[], logs: ReviewLogRow[], now, tz): FlashcardLoad` → `{ dueNow, dueByDay: { day, count }[] /* 7-day horizon */, newIntroducedToday, states: { learning, review, relearning }, reviewsPerDay: { day, count }[], againRate7d, againRate30d, lapsesTotal }`. FreeCAT-original (sat-world had no FSRS) — kept deliberately descriptive: it reports the queue, it does not forecast (forecasting is the Plan module's triangle).

**`src/main/repositories/stats.ts`** — the one impure file. `getStatsOverview(db: DB, index: ContentIndex, now = new Date()): Promise<StatsOverview>`: (1) load all `qbank_attempt` rows once, partition by topic; (2) mastery per topic, then union-recompute per discipline and section (published counts from `index.byTopic`/`byDiscipline` sizes); (3) window to 60 local days for fingerprints (per topic, ≥3 attempts or mode is `null`) and pacing (per section + per discipline: median, outlier count); (4) AAMC tally ported from `getDashboard` unchanged; (5) effort trend (90 days) from the three raw event streams; (6) heatmap from `daily_activity` (365 dayKeys, zero-filled); (7) flashcard load from `card_scheduling` + `review_log`. Everything assembled into one `StatsOverview` DTO (defined in `src/shared/dto.ts` beside `DashboardStats`, which it replaces).

**`src/main/ipc/stats.ts`** — registers `CH.statsOverview = 'stats:overview'` (zero-arg; Zod `z.undefined()` guard per house pattern), returns `ok(overview)`; DB/index failures surface as the standard `err` codes. Wire into the same registration point as the other six IPC modules. `CH.qbankDashboard` and its handler are removed in this PR.

## Renderer

New page `src/renderer/src/pages/Stats.tsx` + `src/renderer/src/stats/` — `ROUTES` gains `stats: { label: 'Stats', component: Stats }` between `flashcards` and `nest`. One fetch of `stats:overview` on mount, pull-to-refresh button; all panels render from the single DTO.

- **`MasteryPanel`** — section → discipline → topic collapsible tree. Each row: mastery bar (0–100%), `nEff`-aware treatment: `needsData` rows render **muted with a "not enough data" badge instead of a bar** (a confident-looking 50% bar on 1 attempt is the exact false-precision this module exists to avoid); `stale` rows get a clock badge ("no attempts in N days"); coverage shown as `attempted/published`. Sorted weakest-first within each level.
- **`FingerprintsPanel`** — topics with a non-`standard` mode, evidence clause verbatim from the DTO, deep-link per row into a scoped qbank session via existing `navigate('qbank', { topicSlug })`.
- **`PacingPanel`** — per section: own median s/Q (60d), outlier count, AAMC reference line labeled "AAMC pace ≈97s/Q (reference)". Under `minTimedForBaseline` timed attempts: "not enough timed questions yet" — no bar.
- **`HeatmapPanel`** — 365-day calendar grid from `daily_activity`; geometry helper `src/renderer/src/stats/calendar-grid.ts` (ported from sat-world's `calendar-grid.ts`: week columns, month labels, 0–4 intensity from count quartiles).
- **`EffortTrend`** — 90-day effort-points line/bars with the weight legend spelled out (honest about what a point is).
- **`FlashcardsPanel`** — due-now count, 7-day due bars, state split, again-rate 7d vs 30d, introduced-today vs `NEW_PER_DAY`.
- **`AamcPanel`** — the ported by-AAMC accuracy table, caption noting a multi-tagged question counts once per tag.
- **Empty states everywhere**: a brand-new profile (zero attempts, zero reviews) must render a welcoming page — every panel has an explicit "nothing here yet" state pointing at the module that feeds it. Seed-scale content is the *expected* Phase-1 reality, not an edge case.

Insight copy helpers (`src/renderer/src/stats/insights.ts`) are rewritten for MCAT, not ported: mastery bands + short coaching lines keyed to fingerprint modes. Display-only; no math.

## Testing

- **`test/stats/mastery.test.ts`** — golden vectors: decay halves influence per 21d (exact `exp` checks), shrinkage toward 0.5 at low n, `needsData`/`stale` boundaries (`nEff` just under/over 2; attempt at exactly 14d), coverage with duplicate attempts on one question, zero-attempt case, difficultyWeight passthrough. Port sat-world's vector values where semantics are identical — divergence from them is a red flag, not a rounding note.
- **`test/stats/fingerprints.test.ts`** — fixture streams per mode, priority ordering, window exclusion (61-day-old attempt ignored), baseline gate (4 timed attempts ⇒ no time-based mode), null `timeMs` joins accuracy but not baselines.
- **`test/stats/flashcard-load.test.ts`** — due bucketing across a local-midnight boundary (dayKey correctness is the whole point), again-rate windows, state split.
- **`test/stats/repository.test.ts`** — `createTestDb` + seeded attempts across 2 sections / 3 topics + review_log + lesson_progress + daily_activity: full `StatsOverview` snapshot; union-rollup property (discipline `nEff` = sum of member streams, ≠ average of members); AAMC double-count behavior preserved from the old dashboard test.
- **IPC test** — `stats:overview` happy path + rejects non-undefined payload; `qbank:dashboard` is gone (registration test updated, old dashboard tests deleted with their subject).
- Renderer coverage per house pattern: Stats page renders the zero-data profile and a seeded snapshot without error; needsData rows show badge not bar.

## Out of scope (Module 4 M1)

Mastery-over-time trend and any caching (Phase 4); difficulty weights ≠ 1.0 (waits on content schema); per-deck flashcard stats drill-down; exporting stats; anything Plan-shaped (priority scores, pacing forecasts, comfort — Modules 5); CARS (no content taxonomy exists to hang it on).
