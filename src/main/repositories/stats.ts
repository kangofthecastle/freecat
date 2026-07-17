import { isNotNull } from 'drizzle-orm'
import type { DB } from '../db/client'
import { reviewLog, cardScheduling, lessonProgress, dailyActivity } from '../db/schema'
import type {
  StatsOverview, SectionStatsDto, DisciplineStatsDto, TopicStatsDto, MasteryDto,
  TopicFingerprintDto, SectionPacingDto, AamcAccuracy, DisciplineKey
} from '../../shared/dto'
import { loadAttempts, latestPerQuestion } from './attempt-evidence'
import type { ContentIndex, SectionCode } from '../content/types'
import { CONTENT_TAG_VOCAB } from '../content/tags'
import {
  DISCIPLINES, TOPICS, SECTIONS, SECTION_TITLE, SECTION_BY_DISCIPLINE
} from '../db/seed/taxonomy-data'
import { dayKeyInTz, addDaysToKey } from '../../shared/gamification/dates'
import { STATS_CONFIG } from '../stats/config'
import { computeMastery, type MasteryAttempt, type MasteryResult } from '../stats/mastery'
import {
  classifyFingerprints, timeBaselines, fingerprintEvidence, median, selectRecencyWindow,
  type FingerprintAttempt
} from '../stats/fingerprints'
import { buildMasteryTrend, type TrendAttempt } from '../stats/mastery-trend'
import { buildEffortTrend } from '../stats/effort'
import { summarizeFlashcards } from '../stats/flashcard-load'
import { listFlaggedIds } from './qbank-flags'
import { appTz } from './activity'

const TOPIC_TITLE: ReadonlyMap<string, string> = new Map(TOPICS.map((t) => [t.slug, t.title]))
const TOPIC_DISCIPLINE: ReadonlyMap<string, DisciplineKey> = new Map(TOPICS.map((t) => [t.slug, t.discipline]))
const AAMC_TITLE: ReadonlyMap<string, string> = new Map(
  CONTENT_TAG_VOCAB.map((t) => [`${t.vocab}:${t.code}`, t.title])
)

const toMasteryDto = (r: MasteryResult, published: number): MasteryDto => ({
  mastery: r.mastery,
  nEff: r.nEff,
  coverage: r.coverage,
  attempted: r.attempted,
  published,
  needsData: r.needsData,
  stale: r.stale
})

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

  // The six reads are independent — issue them together rather than serializing round trips.
  const [attempts, flaggedList, reviews, lessonsDone, activityRows, scheduling] = await Promise.all([
    loadAttempts(db),
    listFlaggedIds(db),
    db.select({ rating: reviewLog.rating, reviewedAt: reviewLog.reviewedAt }).from(reviewLog),
    db
      .select({ completedAt: lessonProgress.completedAt })
      .from(lessonProgress)
      .where(isNotNull(lessonProgress.completedAt)),
    db.select({ dayKey: dailyActivity.dayKey, count: dailyActivity.count }).from(dailyActivity),
    db
      .select({
        state: cardScheduling.state,
        due: cardScheduling.due,
        introducedDay: cardScheduling.introducedDay,
        lapses: cardScheduling.lapses
      })
      .from(cardScheduling)
  ])
  const flaggedIds = new Set(flaggedList)

  // ── Latest attempt per question (mastery evidence; shared reduction with the Plan module) ──
  const latestByQuestion = latestPerQuestion(attempts)
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

  // ── As-of-day mastery trend (Phase 4) — recomputed from the same attempt stream ──
  const publishedBySection = {} as Record<SectionCode, number>
  for (const s of sections) publishedBySection[s.section] = s.mastery.published
  const trendAttempts: TrendAttempt[] = attempts.map((a) => ({
    id: a.id,
    questionId: a.questionId,
    section: a.section as SectionCode,
    isCorrect: a.isCorrect,
    answeredAt: a.answeredAt,
    flagged: flaggedIds.has(a.questionId)
  }))
  const masteryTrend = buildMasteryTrend(trendAttempts, publishedBySection, todayKey, tz)

  // ── Fingerprints over the ADAPTIVE recency window (Phase 4: widens when usage is thin) ──
  const fpWindow = selectRecencyWindow(attempts, todayKey, tz)
  const windowed: FingerprintAttempt[] = fpWindow.attempts.map((a) => ({
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
  // Discipline comes from the canonical taxonomy seed; the attempt row's denormalized column is
  // only a fallback for a topic that has since left the seed (content drift), never the primary.
  const attemptDiscipline = new Map<string, DisciplineKey>()
  for (const a of attempts) attemptDiscipline.set(a.topic, a.discipline as DisciplineKey)
  const fingerprints: TopicFingerprintDto[] = classifyFingerprints(windowed, flaggedIds, baselines)
    .filter((fp) => fp.dominantMode !== null || fp.unsureCorrectCount > 0)
    .flatMap((fp) => {
      const discipline = TOPIC_DISCIPLINE.get(fp.topic) ?? attemptDiscipline.get(fp.topic)
      if (!discipline) return []
      return [{
        topic: fp.topic,
        title: TOPIC_TITLE.get(fp.topic) ?? fp.topic,
        discipline,
        mode: fp.dominantMode,
        evidence: fingerprintEvidence(fp),
        totalErrors: fp.totalErrors,
        unsureCorrect: fp.unsureCorrectCount
      }]
    })
    .sort((a, b) => b.totalErrors - a.totalErrors)

  // Pacing has its OWN fixed window — the fingerprint window now ADAPTS (widens when thin), so
  // the two can no longer share a filter even while their configured day counts match.
  const paceWindowStart = addDaysToKey(todayKey, -(STATS_CONFIG.pacing.windowDays - 1))
  const paceAttempts = attempts.filter((a) => dayKeyInTz(a.answeredAt, tz) >= paceWindowStart)
  const pacing: SectionPacingDto[] = SECTIONS.map((section) => {
    const times = paceAttempts.filter((a) => a.section === section && a.timeMs != null).map((a) => a.timeMs!)
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
    masteryTrend,
    fingerprints,
    fingerprintWindow: { days: fpWindow.days, widened: fpWindow.widened },
    pacing,
    effortTrend,
    heatmap: { byDay, todayKey, weeks: STATS_CONFIG.heatmapWeeks },
    aamc,
    flashcards
  }
}
