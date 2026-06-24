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

// --- Content Review ---
export type DisciplineKey = 'gen-chem' | 'o-chem' | 'biology' | 'biochem' | 'behavioral-sci'
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
