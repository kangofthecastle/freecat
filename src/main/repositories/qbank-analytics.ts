import { sql, count } from 'drizzle-orm'
import type { DB } from '../db/client'
import { qbankAttempt } from '../db/schema'
import type {
  DashboardStats, DisciplineAccuracy, TopicAccuracy, AamcAccuracy, DisciplineKey
} from '../../shared/dto'
import type { ContentIndex } from '../content/types'
import { DISCIPLINES, TOPICS } from '../db/seed/taxonomy-data'
import { CONTENT_TAG_VOCAB } from '../content/tags'
import { latestIncorrectQuestionIds } from './qbank-attempts'
import { listFlaggedIds } from './qbank-flags'

// SUM(is_correct) over a boolean column counts the true rows; coalesce guards the empty-set NULL.
const correctExpr = sql<number>`coalesce(sum(${qbankAttempt.isCorrect}), 0)`

// Titles come from the static taxonomy constants (denormalized attempt rows carry only slugs).
const DISCIPLINE_TITLE: ReadonlyMap<string, string> = new Map(DISCIPLINES.map((d) => [d.slug, d.title]))
const TOPIC_TITLE: ReadonlyMap<string, string> = new Map(TOPICS.map((t) => [t.slug, t.title]))
const AAMC_TITLE: ReadonlyMap<string, string> = new Map(CONTENT_TAG_VOCAB.map((t) => [`${t.vocab}:${t.code}`, t.title]))

export async function getCounts(db: DB): Promise<{ incorrectCount: number; flaggedCount: number }> {
  const incorrect = await latestIncorrectQuestionIds(db)
  const flagged = await listFlaggedIds(db)
  return { incorrectCount: incorrect.length, flaggedCount: flagged.length }
}

/** Dashboard accuracy. by-discipline/by-topic are SQL group-bys on the denormalized columns;
 *  by-AAMC is computed in JS over the content index (a question's AAMC tags each get a bucket,
 *  so a question with two AAMC tags is intentionally double-counted). */
export async function getDashboard(db: DB, index: ContentIndex): Promise<DashboardStats> {
  const [overallRow] = await db
    .select({ answered: count(), correct: correctExpr })
    .from(qbankAttempt)
  const totalAnswered = overallRow?.answered ?? 0
  const totalCorrect = Number(overallRow?.correct ?? 0)

  const disciplineRows = await db
    .select({ discipline: qbankAttempt.discipline, answered: count(), correct: correctExpr })
    .from(qbankAttempt)
    .groupBy(qbankAttempt.discipline)
  const byDiscipline: DisciplineAccuracy[] = disciplineRows.map((r) => ({
    discipline: r.discipline as DisciplineKey,
    title: DISCIPLINE_TITLE.get(r.discipline) ?? r.discipline,
    answered: r.answered,
    correct: Number(r.correct)
  }))

  const topicRows = await db
    .select({ topic: qbankAttempt.topic, discipline: qbankAttempt.discipline, answered: count(), correct: correctExpr })
    .from(qbankAttempt)
    .groupBy(qbankAttempt.topic, qbankAttempt.discipline)
  const byTopic: TopicAccuracy[] = topicRows.map((r) => ({
    topic: r.topic,
    title: TOPIC_TITLE.get(r.topic) ?? r.topic,
    discipline: r.discipline as DisciplineKey,
    answered: r.answered,
    correct: Number(r.correct)
  }))

  // by-AAMC: load every attempt, look up its question's tags, and tally per `${vocab}:${code}`.
  const attempts = await db
    .select({ questionId: qbankAttempt.questionId, isCorrect: qbankAttempt.isCorrect })
    .from(qbankAttempt)
  const aamcTally = new Map<string, { answered: number; correct: number }>()
  for (const a of attempts) {
    const tags = index.byId.get(a.questionId)?.tags ?? []
    for (const t of tags) {
      if (t.vocab !== 'aamc') continue
      const key = `${t.vocab}:${t.code}`
      const bucket = aamcTally.get(key) ?? { answered: 0, correct: 0 }
      bucket.answered += 1
      if (a.isCorrect) bucket.correct += 1
      aamcTally.set(key, bucket)
    }
  }
  const byAamc: AamcAccuracy[] = [...aamcTally.entries()].map(([key, v]) => ({
    code: key.slice(key.indexOf(':') + 1),
    title: AAMC_TITLE.get(key) ?? key,
    answered: v.answered,
    correct: v.correct
  }))

  return {
    totalAnswered,
    totalCorrect,
    byDiscipline,
    byTopic,
    byAamc,
    latestIncorrectQuestionIds: await latestIncorrectQuestionIds(db)
  }
}
