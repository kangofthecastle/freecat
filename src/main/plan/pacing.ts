import { PLAN_CONFIG } from './config'
import { dayNumberOfKey } from '../../shared/gamification/dates'

/**
 * Questions-track pacing (main-only: it reads PLAN_CONFIG). The flashcard triangle itself lives in
 * `src/shared/plan/pacing.ts` — the renderer's wizard/settings run it live for pick-one-derive-the-
 * other feedback — and is re-exported here so engine code keeps one import site for pacing math.
 */
export {
  clampDailyNew, flashcardTriangle, validatePacing, habitPacing,
  type Triangle, type TriangleInput, type PacingEdit, type ValidatePacingInput, type PacingResult
} from '../../shared/plan/pacing'

export interface QuestionsPaceInput {
  publishedTotal: number
  attemptedDistinct: number
  startKey: string // questions-track start day (settings or first-attempt fallback)
  finishKey: string | null // examDate − questionsFinishBufferDays; null = no exam date
  todayKey: string
}

/**
 * Behind-pace signal for the questions track (self-paced version of sat-world's teacher warning):
 * coverage is the schedulable finish target, so expected progress is the elapsed fraction of the
 * start→finish window. Behind = attained coverage trails expectation by more than the slack.
 * No exam date, an unstarted window, or an empty bank ⇒ never behind.
 */
export function questionsBehindPace(input: QuestionsPaceInput): boolean {
  if (input.finishKey == null || input.publishedTotal <= 0) return false
  if (input.todayKey < input.startKey || input.finishKey <= input.startKey) return false
  const dayNum = dayNumberOfKey
  const elapsed = Math.min(1, (dayNum(input.todayKey) - dayNum(input.startKey)) / (dayNum(input.finishKey) - dayNum(input.startKey)))
  const attained = Math.min(1, input.attemptedDistinct / input.publishedTotal)
  return attained < elapsed - PLAN_CONFIG.behindPaceSlack
}
