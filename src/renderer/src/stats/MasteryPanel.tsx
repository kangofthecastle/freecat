import type { MasteryDto, SectionStatsDto, TopicStatsDto } from '../../../shared/dto'
import { masteryBand, pct } from './insights'

/** Weakest-first among scored topics; needs-data topics go last — they're unknown, not weak,
 *  and a sort that treats the prior as a score would be exactly the false precision we refuse. */
function sortTopics(topics: TopicStatsDto[]): TopicStatsDto[] {
  const scored = topics.filter((t) => !t.mastery.needsData).sort((a, b) => a.mastery.mastery - b.mastery.mastery)
  const unscored = topics.filter((t) => t.mastery.needsData)
  return [...scored, ...unscored]
}

/** "n/p" with the numerator clamped to published — content unpublished after being attempted must
 *  never read "15/10 covered" (the same clamp computeMastery applies to its coverage fraction). */
function covered(m: MasteryDto): string {
  return `${Math.min(m.attempted, m.published)}/${m.published}`
}

function MasteryFigure({ m }: { m: MasteryDto }): React.JSX.Element {
  if (m.needsData) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        not enough data
      </span>
    )
  }
  const band = masteryBand(m.mastery)
  return (
    <span className="flex items-center gap-2">
      {m.stale && (
        <span title="No attempts in over 14 days — evidence is fading" aria-label="stale">
          🕐
        </span>
      )}
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${band.tone}`}>
        {pct(m.mastery)} · {band.label}
      </span>
    </span>
  )
}

function Bar({ m }: { m: MasteryDto }): React.JSX.Element | null {
  if (m.needsData) return null
  const band = masteryBand(m.mastery)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full rounded-full ${band.bar}`} style={{ width: `${Math.round(m.mastery * 100)}%` }} />
    </div>
  )
}

export function MasteryPanel({
  sections,
  onTopic
}: {
  sections: SectionStatsDto[]
  onTopic: (topicSlug: string) => void
}): React.JSX.Element {
  const anyAttempts = sections.some((s) => s.mastery.attempted > 0)
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">Mastery</h3>
      <p className="mb-4 text-sm text-gray-500">
        Recency-weighted and shrunk toward the middle until there is real evidence — a topic with
        one lucky answer shows &ldquo;not enough data&rdquo;, not a score. Tap a topic to practice it.
      </p>
      {!anyAttempts && (
        <p className="rounded-lg bg-gray-50 p-4 text-gray-500">
          Nothing here yet — answer some Qbank questions and mastery will build topic by topic.
        </p>
      )}
      <div className="space-y-6">
        {sections.map((s) => (
          <div key={s.section}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="font-bold text-gray-800">{s.title}</span>
              <MasteryFigure m={s.mastery} />
            </div>
            <Bar m={s.mastery} />
            <div className="mt-3 space-y-4 pl-1">
              {s.disciplines.map((d) => (
                <div key={d.discipline}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-gray-700">{d.title}</span>
                    <span className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{covered(d.mastery)} covered</span>
                      <MasteryFigure m={d.mastery} />
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {sortTopics(d.topics).map((t) => (
                      <button
                        key={t.topic}
                        type="button"
                        onClick={() => onTopic(t.topic)}
                        className={`rounded-xl p-3 text-left ring-1 transition hover:brightness-95 ${
                          t.mastery.needsData
                            ? 'bg-gray-50 text-gray-400 ring-gray-100'
                            : `${masteryBand(t.mastery.mastery).tone}`
                        }`}
                      >
                        <p className="truncate text-xs font-semibold" title={t.title}>
                          {t.title}
                        </p>
                        <p className="mt-1 text-lg font-bold">
                          {t.mastery.needsData ? '—' : pct(t.mastery.mastery)}
                        </p>
                        <p className="text-xs opacity-70">
                          {t.mastery.needsData
                            ? t.mastery.attempted > 0
                              ? 'not enough data'
                              : 'no attempts'
                            : `${covered(t.mastery)} covered${t.mastery.stale ? ' · stale' : ''}`}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
