import { isNotNull } from 'drizzle-orm'
import type { DB } from '../db/client'
import { qbankAttempt, reviewLog, cardScheduling, lessonProgress, dailyActivity } from '../db/schema'
import type {
  StatsOverview, SectionStatsDto, DisciplineStatsDto, TopicStatsDto, MasteryDto,
  TopicFingerprintDto, SectionPacingDto, AamcAccuracy, ChoiceLetter, DisciplineKey
} from '../../shared/dto'
import type { ContentIndex, SectionCode } from '../content/types'
import { SECTION_BY_DISCIPLINE } from '../content/loader'
import { CONTENT_TAG_VOCAB } from '../content/tags'
import { DISCIPLINES, TOPICS } from '../db/seed/taxonomy-data'
import { dayKeyInTz, addDaysToKey } from '../../shared/gamification/dates'
import { STATS_CONFIG } from '../stats/config'
import { computeMastery, type MasteryAttempt, type MasteryResult } from '../stats/mastery'
import { classifyFingerprints, timeBaselines, fingerprintEvidence, type FingerprintAttempt } from '../stats/fingerprints'
import { buildEffortTrend } from '../stats/effort'
import { summarizeFlashcards } from '../stats/flashcard-load'
import { listFlaggedIds } from './qbank-flags'
import { appTz } from './activity'

const SECTIONS: SectionCode[] = ['chem-phys', 'bio-biochem', 'psych-soc']
const SECTION_TITLE: Record<SectionCode, string> = {
  'chem-phys': 'Chem & Phys Foundations',
  'bio-biochem': 'Bio & Biochem Foundations',
  'psych-soc': 'Psych, Soc & Bio Foundations'
}
const DISCIPLINE_TITLE: ReadonlyMap<string, string> = new Map(DISCIPLINES.map((d) => [d.slug, d.title]))
const TOPIC_TITLE: ReadonlyMap<string, string> = new Map(TOPICS.map((t) => [t.slug, t.title]))
const AAMC_TITLE: ReadonlyMap<string, string> = new Map(
  CONTENT_TAG_VOCAB.map((t) => [`${t.vocab}:${t.code}`, t.title])
)

interface AttemptRow {
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

const toMasteryDto = (r: MasteryResult, published: number): MasteryDto => ({
  mastery: r.mastery,
  nEff: r.nEff,
  coverage: r.coverage,
  attempted: r.attempted,
  published,
  needsData: r.needsData,
  stale: r.stale
})

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

export interface StatsOptions {
  now?: Date
  tz?: string
}

/**
 * Assemble the whole Stats overview from raw tables + the content index — computed live on every
 * call, no rollups/caches by design (spec: Decisions). Full scans are the honest choice at
 * personal scale; if profiling ever objects, the escape hatch is a rebuildable cache, never a
 * silent LIMIT. Reads are strictly read-only across module tables (charter §5.2: Stats owns nothing).
 */
export async function getStatsOverview(db: DB, index: ContentIndex, opts: StatsOptions = {}): Promise<StatsOverview> {
  const now = opts.now ?? new Date()
  const tz = opts.tz ?? appTz()
  const todayKey = dayKeyInTz(now, tz)

  const attempts: AttemptRow[] = await db
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
  const flaggedIds = new Set(await listFlaggedIds(db))

  // ── Latest attempt per question (mastery evidence; answeredAt then row id breaks ties) ──
  const latestByQuestion = new Map<string, AttemptRow>()
  for (const a of attempts) {
    const prev = latestByQuestion.get(a.questionId)
    if (!prev) {
      latestByQuestion.set(a.questionId, a)
      continue
    }
    const dt = a.answeredAt.getTime() - prev.answeredAt.getTime()
    if (dt > 0 || (dt === 0 && a.id > prev.id)) latestByQuestion.set(a.questionId, a)
  }
  const latestByTopic = new Map<string, MasteryAttempt[]>()
  for (const a of latestByQuestion.values()) {
    const m: MasteryAttempt = {
      questionId: a.questionId,
      isCorrect: a.isCorrect,
      answeredAt: a.answeredAt,
      flagged: flaggedIds.has(a.questionId)
    }
    const arr = latestByTopic.get(a.topic) ?? []
    arr.push(m)
    latestByTopic.set(a.topic, arr)
  }

  // ── Mastery tree: topic → discipline → section, rollups recomputed over UNION streams ──
  const publishedByTopic = (slug: string): number => index.byTopic.get(slug)?.length ?? 0
  const disciplineDtos = new Map<DisciplineKey, DisciplineStatsDto>()
  for (const d of DISCIPLINES) {
    const topicSeeds = TOPICS.filter((t) => t.discipline === d.slug)
    const topics: TopicStatsDto[] = topicSeeds.map((t) => {
      const published = publishedByTopic(t.slug)
      const result = computeMastery(latestByTopic.get(t.slug) ?? [], published, now)
      return { topic: t.slug, title: t.title, mastery: toMasteryDto(result, published) }
    })
    const unionAttempts = topicSeeds.flatMap((t) => latestByTopic.get(t.slug) ?? [])
    const unionPublished = topicSeeds.reduce((sum, t) => sum + publishedByTopic(t.slug), 0)
    disciplineDtos.set(d.slug, {
      discipline: d.slug,
      title: d.title,
      mastery: toMasteryDto(computeMastery(unionAttempts, unionPublished, now), unionPublished),
      topics
    })
  }
  const sections: SectionStatsDto[] = SECTIONS.map((section) => {
    const members = DISCIPLINES.filter((d) => SECTION_BY_DISCIPLINE[d.slug] === section)
    const unionAttempts = members.flatMap((d) =>
      TOPICS.filter((t) => t.discipline === d.slug).flatMap((t) => latestByTopic.get(t.slug) ?? [])
    )
    const disciplines = members.map((d) => disciplineDtos.get(d.slug)!)
    const unionPublished = disciplines.reduce((sum, d) => sum + d.mastery.published, 0)
    return {
      section,
      title: SECTION_TITLE[section],
      mastery: toMasteryDto(computeMastery(unionAttempts, unionPublished, now), unionPublished),
      disciplines
    }
  })

  // ── Fingerprints + pacing over the recency window (whole local days) ──
  const fpWindowStart = addDaysToKey(todayKey, -(STATS_CONFIG.fingerprints.windowDays - 1))
  const windowed: FingerprintAttempt[] = attempts
    .filter((a) => dayKeyInTz(a.answeredAt, tz) >= fpWindowStart)
    .map((a) => ({
      id: a.id,
      questionId: a.questionId,
      topic: a.topic,
      section: a.section as SectionCode,
      chosen: a.chosen,
      isCorrect: a.isCorrect,
      timeMs: a.timeMs,
      answeredAt: a.answeredAt
    }))
  const baselines = timeBaselines(windowed)
  // Every fingerprint topic came from an attempt row, which carries its discipline denormalized.
  const attemptDiscipline = new Map<string, DisciplineKey>()
  for (const a of attempts) attemptDiscipline.set(a.topic, a.discipline as DisciplineKey)
  const fingerprints: TopicFingerprintDto[] = classifyFingerprints(windowed, flaggedIds, baselines)
    .filter((fp) => fp.dominantMode !== null || fp.unsureCorrectCount > 0)
    .map((fp) => ({
      topic: fp.topic,
      title: TOPIC_TITLE.get(fp.topic) ?? fp.topic,
      discipline: attemptDiscipline.get(fp.topic)!,
      mode: fp.dominantMode,
      evidence: fingerprintEvidence(fp),
      totalErrors: fp.totalErrors,
      unsureCorrect: fp.unsureCorrectCount
    }))
    .sort((a, b) => b.totalErrors - a.totalErrors)

  const pacing: SectionPacingDto[] = SECTIONS.map((section) => {
    const times = windowed.filter((a) => a.section === section && a.timeMs != null).map((a) => a.timeMs!)
    const hasBaseline = times.length >= STATS_CONFIG.pacing.minTimedForMedian
    const med = hasBaseline ? median(times) : null
    return {
      section,
      title: SECTION_TITLE[section],
      medianMs: med,
      timedCount: times.length,
      outlierCount: med != null ? times.filter((t) => t > med * STATS_CONFIG.pacing.outlierMultiplier).length : 0,
      referenceMs: STATS_CONFIG.pacing.referenceMsPerQ[section]
    }
  })

  // ── Effort trend from raw module event streams ──
  const reviews = await db
    .select({ rating: reviewLog.rating, reviewedAt: reviewLog.reviewedAt })
    .from(reviewLog)
  const lessonsDone = await db
    .select({ completedAt: lessonProgress.completedAt })
    .from(lessonProgress)
    .where(isNotNull(lessonProgress.completedAt))
  const effortFrom = addDaysToKey(todayKey, -(STATS_CONFIG.effort.trendDays - 1))
  const effortTrend = buildEffortTrend(
    {
      questionTimes: attempts.map((a) => a.answeredAt),
      reviewTimes: reviews.map((r) => r.reviewedAt),
      lessonTimes: lessonsDone.map((l) => l.completedAt!)
    },
    effortFrom,
    todayKey,
    tz
  )

  // ── Heatmap straight off daily_activity — agrees exactly with what the pet economy rewarded ──
  const heatFrom = addDaysToKey(todayKey, -(STATS_CONFIG.heatmapWeeks * 7 - 1))
  const activityRows = await db
    .select({ dayKey: dailyActivity.dayKey, count: dailyActivity.count })
    .from(dailyActivity)
  const byDay: Record<string, number> = {}
  for (const r of activityRows) {
    if (r.dayKey >= heatFrom && r.dayKey <= todayKey && r.count > 0) byDay[r.dayKey] = r.count
  }

  // ── by-AAMC accuracy: ported unchanged from the absorbed qbank dashboard — a question's AAMC
  //    tags each get a bucket, so a multi-tagged question is intentionally double-counted. ──
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
  const aamc: AamcAccuracy[] = [...aamcTally.entries()]
    .map(([key, v]) => ({
      code: key.slice(key.indexOf(':') + 1),
      title: AAMC_TITLE.get(key) ?? key,
      answered: v.answered,
      correct: v.correct
    }))
    .sort((a, b) => a.code.localeCompare(b.code))

  // ── FSRS queue ──
  const scheduling = await db
    .select({
      state: cardScheduling.state,
      due: cardScheduling.due,
      introducedDay: cardScheduling.introducedDay,
      lapses: cardScheduling.lapses
    })
    .from(cardScheduling)
  const flashcards = summarizeFlashcards(scheduling, reviews, now, tz)

  return {
    totals: {
      answered: attempts.length,
      correct: attempts.filter((a) => a.isCorrect).length,
      distinctQuestions: latestByQuestion.size,
      reviews: reviews.length,
      lessonsCompleted: lessonsDone.length
    },
    sections,
    fingerprints,
    pacing,
    effortTrend,
    heatmap: { byDay, todayKey, weeks: STATS_CONFIG.heatmapWeeks },
    aamc,
    flashcards
  }
}
