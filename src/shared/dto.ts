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

// ── Dashboard accuracy DTOs (by discipline/topic via SQL; by AAMC via JS over the content index) ──
export interface TopicAccuracy { topic: string; title: string; discipline: DisciplineKey; answered: number; correct: number }
export interface DisciplineAccuracy { discipline: DisciplineKey; title: string; answered: number; correct: number }
export interface AamcAccuracy { code: string; title: string; answered: number; correct: number }
export interface DashboardStats {
  totalAnswered: number
  totalCorrect: number
  byDiscipline: DisciplineAccuracy[]
  byTopic: TopicAccuracy[]
  byAamc: AamcAccuracy[] // computed in JS over the content index
  latestIncorrectQuestionIds: string[]
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
