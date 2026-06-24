import type { MoodState, Rarity, Item, CoinReason } from './gamification/types'

export type ServiceErrorCode =
  | 'not-found' | 'invalid' | 'insufficient-coins' | 'egg-exists'
  | 'no-pet' | 'already-owned' | 'not-owned' | 'not-ready' | 'name-too-long'
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

// ── Qbank + taxonomy DTOs (renderer-facing; no answer key leaves the main process) ──
export type ChoiceLetter = 'A' | 'B' | 'C' | 'D'
export type ScopeKind = 'mixed' | 'section' | 'content_category' | 'skill'
export type Refine = 'all' | 'incorrect' | 'flagged'

export interface TaxonomyNodeDto {
  id: string
  kind: 'section' | 'foundational_concept' | 'content_category' | 'skill' | 'topic'
  code: string
  title: string
  parentId: string | null
}

export interface PresentedQuestion {
  id: string
  section: string
  contentCategory: string | null
  skill: string | null
  passageId: string | null
  stem: string
  choices: string[] // always length 4
}
export interface PresentedPassage { id: string; passage: string }

export interface StartSessionInput {
  scopeKind: ScopeKind
  scopeCode?: string
  refine: Refine
  count: number
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

export interface SectionAccuracy { section: string; answered: number; correct: number }
export interface CategoryAccuracy { contentCategory: string; answered: number; correct: number }
export interface DashboardStats {
  overall: { answered: number; correct: number }
  bySection: SectionAccuracy[]
  byContentCategory: CategoryAccuracy[]
  flaggedCount: number
  incorrectCount: number
}
export interface ComposerData { totalQuestions: number; incorrectCount: number; flaggedCount: number }
