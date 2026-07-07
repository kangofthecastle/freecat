# Flashcards M2 — FSRS scheduling + review UI + gamification hookup

> Milestone 2 of Module 3 (Flashcards). Read `docs/freecat-charter.md`, `docs/handoffs/flashcards.md`, and the M1 spec (`2026-06-23-flashcards-m1-design.md`) first. M1 delivered import + browse + faithful render; M2 makes imported decks *studyable*: FSRS spaced repetition, a review session UI, and the `flashcard.review` gamification hookup. Scheduling-history import (honoring an imported deck's existing revlog) is **M3**, image occlusion and audio playback later still.

## Goal

Pick a deck → "Study" → be served due + new cards one at a time (question → reveal → rate Again/Hard/Good/Easy) → each rating reschedules the card via FSRS, logs the review, and credits gamification — with the same trust posture as M1 (untrusted card content stays in the sandboxed iframe; all new IPC is Zod-validated).

## Decisions (locked)

- **Engine: `ts-fsrs` ^5.4.1** (MIT, TS-native) — the handoff's candidate. Config: `generatorParameters({ enable_fuzz: false, enable_short_term: true })` — fuzz off for determinism (tests + local-first single user), default learning steps (`1m`, `10m`). Default FSRS parameters; per-deck tuning/optimizer is out of scope.
- **Fresh scheduling for every card.** No revlog import in M2 (M3). Every imported card starts `new`.
- **Lazy scheduling rows.** No backfill at import or migration: a card with no `card_scheduling` row IS `new`. The row is created on first review. Import stays untouched; the migration is purely additive (charter §"never a re-migration").
- **Reviewable = `renderKind IN ('basic','cloze')`.** Image-occlusion/unsupported cards are excluded from queues and counts (they can't render); they rejoin automatically in later milestones when their renderKind becomes renderable.
- **Deck scope = subtree.** Studying a deck includes all its subdecks (Anki semantics). Subtree resolved in JS from the deck-set's `parentDeckId` rows.
- **New-card limit: 20/day per studied deck subtree** (constant `NEW_PER_DAY = 20`, no settings UI in M2). "Introduced today" is tracked by an `introducedDay` dayKey column stamped when the scheduling row is created; day bucketing uses the gamification module's `dayKeyInTz(now, appTz())`.
- **Timestamps, not day-granularity due.** A review card is due when `due <= now`. Learn-ahead like Anki: when nothing is actionable, a learning/relearning card due within **20 min** (`LEARN_AHEAD_MS`) is served early.
- **Gamification: one `recordActivity({ kind: 'flashcard.review' })` per applied rating** (a learning card reviewed 3× in a session = 3 activities, matching "reviews done" effort). Same posture as qbank grading: side effect in its own transaction, `try/catch`, never blocks or fails the review; the `ActivityResult` rides back in the response (`activity: null` on failure).
- **Double-submit guard:** `reviewCard` only applies to an *actionable* card — no scheduling row (new), or `due <= now + LEARN_AHEAD_MS`. A duplicate submit lands after the first one pushed `due` past the window → `err('not-due')`, no double award. (UI also latches buttons while a submit is pending.) Known accepted gap: a Good-rated 1m→10m learning step stays inside the learn-ahead window, so a bypassing caller could double-review that one card; the UI latch covers the real UI.

## Schema (additive → `npm run db:generate` → migration `0006`)

In `src/main/db/schema/flashcards.ts`:

```ts
// 1:1 with cards, created on first review. Absence of a row = the card is 'new'.
export const cardScheduling = sqliteTable('card_scheduling', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().unique().references(() => cards.id, { onDelete: 'cascade' }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }), // denormalized for queue queries
  state: integer('state').notNull(),            // ts-fsrs State enum (1 Learning, 2 Review, 3 Relearning; 0 New never persisted)
  due: integer('due', { mode: 'timestamp' }).notNull(),
  stability: real('stability').notNull(),
  difficulty: real('difficulty').notNull(),
  elapsedDays: integer('elapsed_days').notNull(),
  scheduledDays: integer('scheduled_days').notNull(),
  learningSteps: integer('learning_steps').notNull().default(0), // ts-fsrs Card.learning_steps
  reps: integer('reps').notNull(),
  lapses: integer('lapses').notNull(),
  lastReviewAt: integer('last_review_at', { mode: 'timestamp' }),
  introducedDay: text('introduced_day').notNull() // dayKey when the card left 'new' (daily new-limit accounting)
}, (t) => [
  index('card_scheduling_deck_due_idx').on(t.deckId, t.state, t.due),
  index('card_scheduling_deck_set_idx').on(t.deckSetId)
])

// Append-only review history (stats now; undo/export/revlog-merge later).
export const reviewLog = sqliteTable('review_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  deckSetId: integer('deck_set_id').notNull().references(() => deckSets.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),          // 1 Again · 2 Hard · 3 Good · 4 Easy
  stateBefore: integer('state_before').notNull(),
  dueAfter: integer('due_after', { mode: 'timestamp' }).notNull(),
  stabilityAfter: real('stability_after').notNull(),
  difficultyAfter: real('difficulty_after').notNull(),
  elapsedDays: integer('elapsed_days').notNull(),
  scheduledDays: integer('scheduled_days').notNull(),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull()
}, (t) => [
  index('review_log_card_idx').on(t.cardId, t.reviewedAt),
  index('review_log_deck_set_idx').on(t.deckSetId)
])
```

`deleteDeckSet` (repo) adds `cardScheduling` + `reviewLog` deletes at the top of its transaction (before `cards`), keeping the explicit-delete pattern.

## Main-process modules

**`src/main/flashcards/fsrs.ts`** — the only file that imports `ts-fsrs`. Exports:
- `SCHEDULER` (module-level `fsrs(generatorParameters({...}))` instance) or a factory — either, but constructed once.
- `toFsrsCard(row | null, now)` → ts-fsrs `Card` (null → `createEmptyCard(now)`).
- `applyRating(row | null, rating, now)` → `{ next: SchedulingRowValues, log: ReviewLogValues }` (pure; wraps `f.next(card, now, rating)`).
- `previewIntervals(row | null, now)` → `{ again, hard, good, easy }` humanized strings from `f.repeat(card, now)` due deltas. Humanize: `<60s → "<1m"`, `<1h → "Xm"`, `<24h → "Xh"`, else `"Xd"` (round).

**`src/main/repositories/review.ts`** — queue + grading:
- `deckSubtreeIds(db, deckId)` → `number[] | null` (null = deck not found). BFS over the deck-set's decks in JS.
- `reviewCounts(db, deckId, now)` → `ReviewCounts { newRemaining, learning, due } | null`:
  - `due` = scheduling rows in subtree, `state = Review`, `due <= now`.
  - `learning` = scheduling rows in subtree, `state IN (Learning, Relearning)` (regardless of due — they belong to the active session).
  - `newRemaining` = `max(0, NEW_PER_DAY − introducedToday(subtree))` capped by remaining new cards (reviewable cards in subtree with no scheduling row).
- `nextReviewCard(db, deckId, now)` → `{ cardId, counts, preview } | { done: true, counts, nextLearningDueMs: number | null } | null` (null = deck not found). Priority:
  1. learning/relearning with `due <= now`, earliest first;
  2. review with `due <= now`, earliest first;
  3. new (reviewable, no scheduling row, `newRemaining > 0`), by `cards.id`;
  4. learn-ahead: earliest learning/relearning with `due <= now + LEARN_AHEAD_MS`;
  5. done (`nextLearningDueMs` = ms until the earliest pending learning card, if any — the UI shows "N cards back in X min").
- `gradeReview(db, cardId, rating, now, opts?)` → `ServiceResult<ReviewResult>`:
  - card missing → `err('card-not-found')`; renderKind not reviewable → `err('not-reviewable')`; actionability guard fails → `err('not-due')`.
  - In one transaction: upsert `card_scheduling` from `applyRating`, insert `review_log`.
  - Then `recordActivity({ kind: 'flashcard.review', now })` (injectable like qbank's `recordActivityFn`, try/catch → `activity: null`).
  - Returns `{ counts (recomputed for the card's studied deck? No — counts are deck-scoped; return nothing deck-scoped), activity }` → **keep it simple: returns `{ activity }`;** the renderer refetches `nextReviewCard` (which carries fresh counts) to advance.

**IPC (`src/main/ipc/flashcards.ts`)** — extend `registerFlashcardsIpc(db, opts?)` with injectable `now` (mirror `QbankIpcOptions`):
- `fcReviewCounts` (`flashcards:reviewCounts`), payload `deckId` (positive int) → `ServiceResult<ReviewCounts>` (`err('deck-not-found')`).
- `fcNextReviewCard` (`flashcards:nextReviewCard`), payload `deckId` → `ServiceResult<ReviewQueueItem>` where `ReviewQueueItem = { card: CardView, counts, preview } | { done: true, counts, nextLearningDueMs }`. The card view is built exactly like `fcGetCard` (getCard → mintMediaToken → toCardView) so media/CSP behavior is identical.
- `fcReviewCard` (`flashcards:reviewCard`), payload `{ cardId: positive int, rating: 1|2|3|4 }` → `ServiceResult<{ activity: ActivityResult | null }>`.
- Exported Zod schemas: `reviewDeckIdSchema`, `reviewCardSchema`.

Shared DTOs (`src/shared/dto.ts`): `ReviewCounts`, `ReviewRating` (1|2|3|4), `RatingPreview`, `ReviewQueueItem`, `ReviewCardResult`. `api.ts` + `preload/index.ts` + `channels.ts` extended accordingly.

## Renderer

**Extract `CardFrame`** (`src/renderer/src/flashcards/CardFrame.tsx`) from `CardViewer`: props `{ view: CardView, side: 'question' | 'answer' }`, owns the iframe + hardened height shim + `buildCardHtml` try/catch. `CardViewer` (browse) and the new review session both render it — one iframe implementation, the C4b invariant (engine output only ever assigned to `iframe.srcdoc`) enforced in one place.

**`src/renderer/src/flashcards/ReviewSession.tsx`**: props `{ deckId, deckName, onExit }`.
- Fetch `nextReviewCard` → question side; "Show answer" → answer side + four rating buttons (Again red / Hard amber / Good green / Easy blue), each showing its `preview` interval; keyboard `Space` = show answer, `1..4` = rate (nice-to-have, keep if cheap).
- Rating submit: latch buttons, `reviewCard`, then `nextReviewCard` to advance (counts refresh with it). Errors: `not-due`/`card-not-found` → skip forward silently (refetch next); IPC throw → inline "could not save" with retry.
- Done state: "Session complete — N reviewed" plus "M learning card(s) return in ~X min" when `nextLearningDueMs` is set (with a "check again" button); Exit returns to browse.
- Header: deck name, live counts (`new · learning · due` chips), Exit button.

**`Flashcards.tsx`**: when a deck is selected, the main pane header gains a **Study** button with the deck's counts (from `fcReviewCounts`, refetched on deck change and on review-session exit). Clicking swaps the main pane (card list + viewer stay as-is; the review session takes over the viewer/main area; the browse list may remain visible or be hidden — implementer's choice, keep it clean). Counts of zero everywhere → button disabled with "Nothing to study".

## Testing (all Vitest, patterns per existing suites)

- **fsrs.ts unit**: new→learning on first rate; Good/Good graduates to Review with future due; Again from Review → Relearning + lapse increment; preview strings sane; determinism (fuzz off).
- **review repo** (real temp DB via `createTestDb` + `writeCollection` fixtures): subtree scoping (parent deck study pulls child-deck cards); renderKind filter; queue priority order; new-limit (21 new cards → 20 introduced today, 21st refused; next "day" → available); learn-ahead; `not-due` double-submit rejection; gamification called once per applied review and NOT on rejection (inject `recordActivityFn` spy); log rows written; `deleteDeckSet` removes scheduling + log rows.
- **IPC validation**: new schemas reject bad payloads (pattern: `test/flashcards/ipc-validation.test.ts`).
- **UI** (jsdom): ReviewSession happy path (question → show answer → rate → next → done), latch under a slow submit, done state with learning-return note; Flashcards page shows Study button with counts and enters/exits the session; CardViewer still renders after the CardFrame extraction (existing viewer tests keep passing).

## Out of scope (M2)

Revlog/scheduling-history import (M3); image occlusion; audio playback; per-deck FSRS params/optimizer/settings UI; undo; deck-level daily *review* limits; MathJax-as-subresource optimization (M1 note, still deferred); Anki sibling burying.
