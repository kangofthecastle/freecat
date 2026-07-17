import type { MoodState, Rarity, Item, CoinReason } from './gamification/types'
import type { RenderKind } from './flashcards/types'

export type ServiceErrorCode =
  | 'not-found' | 'invalid' | 'insufficient-coins' | 'egg-exists'
  | 'no-pet' | 'already-owned' | 'not-owned' | 'not-ready' | 'name-too-long'
  | 'deck-not-found' | 'card-not-found' | 'deck-set-not-found'
  | 'not-reviewable' | 'not-due'
  | 'unsupported-format' | 'corrupt-package' | 'import-too-large'
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceErrorCode }
export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data })
export const err = <T = never>(error: ServiceErrorCode): ServiceResult<T> => ({ ok: false, error })

export type { CoinReason } // single source: src/shared/gamification/types.ts

export interface ProfileDto { id: number; displayName: string; createdAt: Date }

export interface PetView {
  id: number; species: string; name: string | null; rarity: Rarity
  isActive: boolean; equipped: string[]; mood: MoodState
}
export interface EggView { incubationPoints: number; progress: number; ready: boolean }
export interface DailyProgress { count: number; goal: number; met: boolean }
export interface LevelInfo { level: number; into: number; toNext: number }

export interface GamificationState {
  coins: number; xp: number; level: LevelInfo; streak: number; daily: DailyProgress
  activePet: PetView | null; collection: PetView[]; egg: EggView | null
  ownedItemKeys: string[]; shop: { eggPrice: number; treatPrice: number; items: Item[] }
}
export interface ActivityResult { streak: number; daily: DailyProgress; eggBecameReady: boolean; goalJustMet: boolean }
export interface RecordActivityInput { kind: string; count?: number; taxonomyRef?: string }

// --- Content Review ---
export type DisciplineKey = 'gen-chem' | 'o-chem' | 'physics' | 'biology' | 'biochem' | 'behavioral-sci'
export type LessonStatus = 'not-started' | 'in-progress' | 'completed'

export interface LessonSummary {
  slug: string
  title: string
  discipline: DisciplineKey
  summary?: string
  aamcCategories: string[]
  status: LessonStatus
  available: boolean // false = topic exists in the taxonomy but no lesson is authored yet
}
export interface OutlineGroup {
  discipline: DisciplineKey
  title: string
  completed: number
  total: number // counts authored (available) lessons only
  lessons: LessonSummary[]
}
export interface Outline {
  groups: OutlineGroup[]
  completed: number
  total: number
}
export interface LessonDetail {
  slug: string
  title: string
  discipline: DisciplineKey
  aamcCategories: string[]
  html: string
  status: LessonStatus
}
export interface LessonRef {
  slug: string
  title: string
  discipline: DisciplineKey
}
export interface MarkCompleteResult {
  status: LessonStatus
  activity?: ActivityResult
}

// ── Shared taxonomy scope tree (served to the Qbank renderer) ──
/** MCAT test section, derived from a discipline (no CARS). */
export type SectionCode = 'chem-phys' | 'bio-biochem' | 'psych-soc'
/** A multi-vocabulary content tag, e.g. { vocab: 'aamc', code: '1A' }. */
export interface Tag { vocab: string; code: string }
/** A tag-vocabulary entry (a `Tag` plus its human title), served to populate filters. */
export interface TagVocabEntry { vocab: string; code: string; title: string }
export interface TopicDto { slug: string; title: string; aamcCodes: string[] }
export interface DisciplineTreeDto { discipline: DisciplineKey; title: string; topics: TopicDto[] }

// ── Qbank DTOs (renderer-facing; no answer key leaves the main process) ──
export type ChoiceLetter = 'A' | 'B' | 'C' | 'D'
export type ScopeKind = 'mixed' | 'discipline' | 'topic'
export type Refine = 'all' | 'incorrect' | 'flagged'

export interface PresentedQuestion {
  id: string
  topic: string // NEW — primary topic slug; drives the outbound cross-link
  section: SectionCode // derived (kept for display)
  passageId: string | null
  stem: string
  choices: [string, string, string, string]
  /** Whether this question is currently flagged (persisted across sessions). Never an answer-key field. */
  flagged: boolean
  // NOTE: no answer key; no `skill`; no `contentCategory`
}
export interface PresentedPassage { id: string; passage: string }
/** A lightweight question reference for cross-links (CR "Practice this topic"). */
export interface QuestionRef { id: string; topic: string }

export interface StartSessionInput {
  scopeKind: ScopeKind
  scopeCode?: string
  refine: Refine
  count: number
  /** Optional AAMC (or other-vocab) tag filter; a question passes with ≥1 selected tag. Empty/absent = no filter. */
  tagFilter?: Tag[]
}
export interface StartSessionResult {
  sessionId: number
  mode: string
  questions: PresentedQuestion[]
  passages: Record<string, PresentedPassage>
}

export interface SubmitAnswerInput {
  sessionId: number
  questionId: string
  choice: ChoiceLetter
  timeMs?: number
}
export interface AnswerResult {
  correct: boolean
  correctChoice: ChoiceLetter
  explanation: string
  choiceExplanations: Partial<Record<ChoiceLetter, string>>
}
export interface SubmitAnswerResult extends AnswerResult {
  activity: ActivityResult | null
}

export interface SessionSummaryRow { questionId: string; chosen: ChoiceLetter; isCorrect: boolean }
export interface SessionSummary { sessionId: number; total: number; correct: number; rows: SessionSummaryRow[] }

// ── Stats (Module 4) DTOs — read-only overview computed live from raw tables, no caches ──
/** Accuracy per AAMC content category (JS tally over the content index; a multi-tagged question
 *  counts once per tag — intentional double-count, captioned in the UI). */
export interface AamcAccuracy { code: string; title: string; answered: number; correct: number }

/** Dominant error mode for a topic's recent misses (60-local-day window). No 'timeout' mode:
 *  blank attempts are impossible by schema (`chosen` is non-null). */
export type ErrorMode = 'repeated_distractor' | 'careless_fast' | 'slow_wrong' | 'standard'

/** Bayesian mastery for one node of the section→discipline→topic tree. `needsData` means
 *  "don't render this as a score" — the whole point is refusing false precision. */
export interface MasteryDto {
  mastery: number // shrunk success rate in [0,1]
  nEff: number // evidence mass (recency-decayed)
  coverage: number // distinct attempted / published, clamped to [0,1]
  attempted: number // distinct questions with a latest attempt
  published: number
  needsData: boolean
  stale: boolean // latest attempt older than the staleness threshold
}
export interface TopicStatsDto { topic: string; title: string; mastery: MasteryDto }
export interface DisciplineStatsDto {
  discipline: DisciplineKey
  title: string
  mastery: MasteryDto
  topics: TopicStatsDto[]
}
export interface SectionStatsDto {
  section: SectionCode
  title: string
  mastery: MasteryDto
  disciplines: DisciplineStatsDto[]
}

export interface TopicFingerprintDto {
  topic: string
  title: string
  discipline: DisciplineKey
  mode: ErrorMode | null // null = no recent misses (row exists for its unsureCorrect signal)
  evidence: string // factual clause composed in the pure layer; renderer never re-derives
  totalErrors: number
  unsureCorrect: number // correct but currently flagged — a confidence signal, never an error
}

/** Per-section pacing, self-relative. `medianMs` is null under the baseline minimum —
 *  no number beats a fake number. `referenceMs` is the AAMC pace, rendered as a labeled
 *  reference line only, never a judgment threshold. */
export interface SectionPacingDto {
  section: SectionCode
  title: string
  medianMs: number | null
  timedCount: number
  outlierCount: number // timed attempts slower than outlierMultiplier × own median
  referenceMs: number
}

export interface EffortDayDto {
  day: string // local dayKey
  questions: number
  flashcardReviews: number
  lessonsCompleted: number
  points: number // questions×3 + reviews×0.25 + lessons×10 (weights in STATS_CONFIG)
}

/** FSRS queue description — deliberately descriptive, never a forecast (forecasting is Plan's job). */
export interface FlashcardLoadDto {
  totalCards: number // cards with a scheduling row (introduced, i.e. not 'new')
  dueNow: number
  dueByDay: { day: string; count: number }[] // horizon incl. today; overdue clamps into today
  states: { learning: number; review: number; relearning: number }
  introducedToday: number
  againRate7d: number | null // fraction of window reviews rated Again; null when no reviews
  againRate30d: number | null
  lapsesTotal: number
}

export interface StatsTotalsDto {
  answered: number // attempt rows (per-session grading events)
  correct: number
  distinctQuestions: number
  reviews: number // flashcard ratings applied, all-time
  lessonsCompleted: number
}

export interface StatsOverview {
  totals: StatsTotalsDto
  sections: SectionStatsDto[] // the 3 content sections (no CARS — no taxonomy to hang it on)
  fingerprints: TopicFingerprintDto[] // topics with recent misses or unsure-correct signal
  pacing: SectionPacingDto[]
  effortTrend: EffortDayDto[] // last trendDays local days, zero-filled, oldest→newest
  heatmap: { byDay: Record<string, number>; todayKey: string; weeks: number } // from daily_activity
  aamc: AamcAccuracy[]
  flashcards: FlashcardLoadDto
}

// --- Flashcards DTOs ---
export interface DeckSetSummary { id: number; sourceFilename: string; deckCount: number; cardCount: number; importedAt: Date }
export interface DeckNode { deckId: number; name: string; leafName: string; cardCount: number; children: DeckNode[] }
export interface ListCardsInput { deckId: number; afterId?: number; limit?: number }
export interface CardListItem { cardId: number; renderKind: RenderKind; preview: string }
export interface CardListPage { cards: CardListItem[]; nextAfterId: number | null }
export interface CardField { name: string; value: string }
export interface CardMedia { filename: string; url: string }
export interface CardView {
  cardId: number
  renderKind: RenderKind
  css: string
  qfmt: string
  afmt: string
  fields: CardField[]
  tags: string[]
  noteTypeName: string
  deckName: string
  subdeckName: string
  templateName: string
  clozeOrdinal: number | null
  mediaMap: CardMedia[]
}

// --- Flashcards review / FSRS DTOs (M2) ---
/** A rating a user gives a shown card: 1 Again · 2 Hard · 3 Good · 4 Easy. */
export type ReviewRating = 1 | 2 | 3 | 4
/** Live queue counts for a studied deck subtree (all renderable + subtree-scoped). */
export interface ReviewCounts { newRemaining: number; learning: number; due: number }
/** Humanized "next interval" label per rating, for the four review buttons. */
export interface RatingPreview { again: string; hard: string; good: string; easy: string }
/** What to show next: a card (with fresh counts + previews) or a done state that may name when the
 *  earliest still-pending learning card returns (ms), so the UI can offer "N cards back in ~X min". */
export type ReviewQueueItem =
  | { done: false; card: CardView; counts: ReviewCounts; preview: RatingPreview }
  | { done: true; counts: ReviewCounts; nextLearningDueMs: number | null }
/** Result of applying a rating: the gamification activity rides back (null if it failed/no-op). */
export interface ReviewCardResult { activity: ActivityResult | null }
