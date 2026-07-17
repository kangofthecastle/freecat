import type { DB } from '../db/client'
import { qbankAttempt } from '../db/schema'
import type { ChoiceLetter } from '../../shared/dto'

/** The qbank_attempt projection Stats and Plan both consume. One loader + one latest-per-question
 *  reduction, shared so the two modules' evidence semantics can never drift. */
export interface AttemptRow {
  id: number
  questionId: string
  topic: string
  discipline: string
  section: string
  chosen: ChoiceLetter
  isCorrect: boolean
  timeMs: number | null
  answeredAt: Date
}

export async function loadAttempts(db: DB): Promise<AttemptRow[]> {
  return db
    .select({
      id: qbankAttempt.id,
      questionId: qbankAttempt.questionId,
      topic: qbankAttempt.topic,
      discipline: qbankAttempt.discipline,
      section: qbankAttempt.section,
      chosen: qbankAttempt.chosen,
      isCorrect: qbankAttempt.isCorrect,
      timeMs: qbankAttempt.timeMs,
      answeredAt: qbankAttempt.answeredAt
    })
    .from(qbankAttempt)
}

/** Latest attempt per question — mastery evidence semantics (answeredAt, then row id on ties). */
export function latestPerQuestion(attempts: AttemptRow[]): Map<string, AttemptRow> {
  const latest = new Map<string, AttemptRow>()
  for (const a of attempts) {
    const prev = latest.get(a.questionId)
    if (!prev) {
      latest.set(a.questionId, a)
      continue
    }
    const dt = a.answeredAt.getTime() - prev.answeredAt.getTime()
    if (dt > 0 || (dt === 0 && a.id > prev.id)) latest.set(a.questionId, a)
  }
  return latest
}
