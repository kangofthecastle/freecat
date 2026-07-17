import type { ChoiceLetter, ErrorMode } from '../../shared/dto'
import type { SectionCode } from '../content/types'
import { dayKeyInTz, addDaysToKey, dayNumberOfKey } from '../../shared/gamification/dates'
import { STATS_CONFIG } from './config'

/** One raw attempt for the fingerprint classifier — ALL (windowed) attempts, not just latest.
 *  Pure + DB-free input; the caller applies the recency window before calling. */
export interface FingerprintAttempt {
  id: number // attempt row id — deterministic latest-attempt tie-break when timestamps collide
  questionId: string
  topic: string
  section: SectionCode
  chosen: ChoiceLetter
  isCorrect: boolean
  timeMs: number | null // per-question thinking time; null when not captured
  answeredAt: Date
}

export interface TopicFingerprint {
  topic: string
  counts: Record<ErrorMode, number>
  dominantMode: ErrorMode | null // most frequent error mode; null when no incorrect latest attempts
  totalErrors: number
  unsureCorrectCount: number // correct AND currently flagged — a confidence signal, never an error
}

/** Tie-break priority for the dominant mode — favour the more actionable/specific diagnosis
 *  (ported order, minus 'timeout': blank attempts are impossible by schema here). */
const DOMINANCE_PRIORITY: ErrorMode[] = ['repeated_distractor', 'slow_wrong', 'careless_fast', 'standard']

/** The recency window actually applied to the classifier's input. */
export interface RecencyWindow<T> {
  attempts: T[]
  days: number // whole local days the window spans, ending today
  widened: boolean // true when the configured window was too thin and got extended backward
}

/**
 * Select the fingerprint recency window (Phase 4 tuning). The configured `windowDays` stays the
 * default — windowing itself is the deliberate B9 fix and is not up for debate — but real
 * personal-scale usage showed a fixed window can starve the classifier: one light month and there
 * is nothing left to diagnose. When the window holds fewer than `minWindowAttempts`, widen
 * backward in WHOLE DAYS to the day of the Nth-most-recent attempt (or all history when fewer
 * than N exist at all). Day-granular widening keeps every included question's attempt history
 * intact — a mid-day cut could hide the older attempts repeated-distractor counts across.
 */
export function selectRecencyWindow<T extends { id: number; answeredAt: Date }>(
  attempts: T[],
  todayKey: string,
  tz: string,
  cfg: { windowDays: number; minWindowAttempts: number } = STATS_CONFIG.fingerprints
): RecencyWindow<T> {
  const defaultStart = addDaysToKey(todayKey, -(cfg.windowDays - 1))
  const inWindow = attempts.filter((a) => dayKeyInTz(a.answeredAt, tz) >= defaultStart)
  // Enough signal — or nothing older exists to widen into — so the configured window stands.
  if (inWindow.length >= cfg.minWindowAttempts || inWindow.length === attempts.length) {
    return { attempts: inWindow, days: cfg.windowDays, widened: false }
  }
  const recentFirst = [...attempts].sort(
    (a, b) => b.answeredAt.getTime() - a.answeredAt.getTime() || b.id - a.id
  )
  const anchor = recentFirst[Math.min(cfg.minWindowAttempts, recentFirst.length) - 1]!
  const startKey = dayKeyInTz(anchor.answeredAt, tz)
  return {
    attempts: attempts.filter((a) => dayKeyInTz(a.answeredAt, tz) >= startKey),
    days: dayNumberOfKey(todayKey) - dayNumberOfKey(startKey) + 1,
    widened: true
  }
}

/** Midpoint median (average of the two middles on even length). Exported so the pacing panel's
 *  medians and the fingerprint time baselines share ONE implementation and can never drift. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

const emptyCounts = (): Record<ErrorMode, number> => ({
  repeated_distractor: 0, careless_fast: 0, slow_wrong: 0, standard: 0
})

/** Per-SECTION median timeMs baselines from attempts with a recorded time. sat-world keys these by
 *  question difficulty; FreeCAT has no difficulty tag, and section is the axis along which question
 *  style (and so pace) genuinely differs. A section below the minimum has no baseline — its time
 *  buckets stay inactive and those errors fall through to `standard`. */
export function timeBaselines(
  attempts: Pick<FingerprintAttempt, 'section' | 'timeMs'>[]
): Map<SectionCode, number> {
  const { minTimedAttemptsForBaseline } = STATS_CONFIG.fingerprints
  const bySection = new Map<SectionCode, number[]>()
  for (const a of attempts) {
    if (a.timeMs != null) {
      const arr = bySection.get(a.section) ?? []
      arr.push(a.timeMs)
      bySection.set(a.section, arr)
    }
  }
  const medianBySection = new Map<SectionCode, number>()
  for (const [section, times] of bySection) {
    if (times.length >= minTimedAttemptsForBaseline) medianBySection.set(section, median(times))
  }
  return medianBySection
}

/**
 * Classify error fingerprints per topic — ported from sat-world's `classifyFingerprints` with the
 * FreeCAT adaptations locked in the spec: string topic keys, section-keyed baselines, the timing
 * gate is `timeMs != null` (there is no timed/untimed session distinction to gate on), and no
 * 'timeout' mode. Each question's LATEST attempt is classified; repeated-distractor looks across
 * ALL attempts of that question (same wrong letter ≥ N times). Untimed attempts join accuracy but
 * never time buckets — an untimed slow wrong answer is `standard`, never `slow_wrong`.
 */
export function classifyFingerprints(
  attempts: FingerprintAttempt[],
  flaggedQuestionIds: Iterable<string>,
  baselines?: Map<SectionCode, number>
): TopicFingerprint[] {
  const { carelessFastMultiplier, slowWrongMultiplier, repeatedDistractorMinCount } = STATS_CONFIG.fingerprints
  const flagged = flaggedQuestionIds instanceof Set ? flaggedQuestionIds : new Set(flaggedQuestionIds)
  const medianBySection = baselines ?? timeBaselines(attempts)

  // Per question: latest attempt + how many incorrect attempts landed on each letter (across all attempts).
  interface QState {
    topic: string
    latest: FingerprintAttempt
    wrongLetterCounts: Map<ChoiceLetter, number>
  }
  const byQuestion = new Map<string, QState>()
  for (const a of attempts) {
    let st = byQuestion.get(a.questionId)
    if (!st) {
      st = { topic: a.topic, latest: a, wrongLetterCounts: new Map() }
      byQuestion.set(a.questionId, st)
    }
    const dt = a.answeredAt.getTime() - st.latest.answeredAt.getTime()
    if (dt > 0 || (dt === 0 && a.id > st.latest.id)) st.latest = a
    if (!a.isCorrect) {
      st.wrongLetterCounts.set(a.chosen, (st.wrongLetterCounts.get(a.chosen) ?? 0) + 1)
    }
  }

  const byTopic = new Map<string, TopicFingerprint>()
  const ensure = (topic: string): TopicFingerprint => {
    let t = byTopic.get(topic)
    if (!t) {
      t = { topic, counts: emptyCounts(), dominantMode: null, totalErrors: 0, unsureCorrectCount: 0 }
      byTopic.set(topic, t)
    }
    return t
  }

  for (const { topic, latest, wrongLetterCounts } of byQuestion.values()) {
    const t = ensure(topic)
    if (latest.isCorrect) {
      if (flagged.has(latest.questionId)) t.unsureCorrectCount++
      continue
    }
    let mode: ErrorMode
    if ((wrongLetterCounts.get(latest.chosen) ?? 0) >= repeatedDistractorMinCount) {
      mode = 'repeated_distractor'
    } else {
      const med = medianBySection.get(latest.section)
      if (med != null && latest.timeMs != null && latest.timeMs < med * carelessFastMultiplier) {
        mode = 'careless_fast'
      } else if (med != null && latest.timeMs != null && latest.timeMs > med * slowWrongMultiplier) {
        mode = 'slow_wrong'
      } else {
        mode = 'standard'
      }
    }
    t.counts[mode]++
    t.totalErrors++
  }

  for (const t of byTopic.values()) {
    if (t.totalErrors > 0) {
      t.dominantMode = DOMINANCE_PRIORITY.reduce<ErrorMode>(
        (best, m) => (t.counts[m] > t.counts[best] ? m : best),
        'repeated_distractor'
      )
    }
  }

  return [...byTopic.values()].sort((a, b) => a.topic.localeCompare(b.topic))
}

/** Factual evidence clause for a fingerprint's dominant mode, composed here so the renderer never
 *  re-derives it. Short, honest, no coaching tone (coaching copy is renderer-side insights). */
export function fingerprintEvidence(fp: TopicFingerprint): string {
  const n = fp.dominantMode ? fp.counts[fp.dominantMode] : 0
  const qs = n === 1 ? 'question' : 'questions'
  switch (fp.dominantMode) {
    case 'repeated_distractor':
      return `drawn to the same wrong answer on ${n} ${qs}`
    case 'careless_fast':
      return `missed ${n} ${qs} at under half your usual pace`
    case 'slow_wrong':
      return `missed ${n} ${qs} despite well over your usual time`
    case 'standard':
      return `${fp.totalErrors} recent ${fp.totalErrors === 1 ? 'miss' : 'misses'}`
    case null:
      return fp.unsureCorrectCount > 0
        ? `${fp.unsureCorrectCount} correct but flagged as unsure`
        : ''
  }
}
