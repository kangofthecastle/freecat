import { useCallback, useEffect, useState } from 'react'
import type { PageProps } from '../App'
import type { StatsOverview } from '../../../shared/dto'
import { StatTile } from '../components/StatTile'
import { MasteryPanel } from '../stats/MasteryPanel'
import { FingerprintsPanel } from '../stats/FingerprintsPanel'
import { PacingPanel } from '../stats/PacingPanel'
import { HeatmapPanel } from '../stats/HeatmapPanel'
import { EffortTrendPanel } from '../stats/EffortTrendPanel'
import { FlashcardsPanel } from '../stats/FlashcardsPanel'
import { AamcPanel } from '../stats/AamcPanel'

export default function Stats(props: PageProps): React.JSX.Element {
  const { navigate } = props
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback((): void => {
    setLoadFailed(false)
    window.freecat.stats
      .overview()
      .then(setOverview)
      .catch((e) => {
        console.error('Failed to load stats', e)
        setLoadFailed(true)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const practiceTopic = useCallback(
    (topicSlug: string): void => {
      navigate?.('qbank', { topicSlug })
    },
    [navigate]
  )

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h2 className="text-3xl font-bold text-gray-800">Stats</h2>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-800">
          We could not load your stats just now.{' '}
          <button type="button" onClick={load} className="font-semibold underline">
            Try again
          </button>
        </p>
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h2 className="text-3xl font-bold text-gray-800">Stats</h2>
        <p className="mt-4 text-gray-500">Loading…</p>
      </div>
    )
  }

  const { totals } = overview
  const overallPct = totals.answered > 0 ? Math.round((totals.correct / totals.answered) * 100) : null

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h2 className="text-3xl font-bold text-gray-800">Stats</h2>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatTile
          label="Accuracy"
          value={overallPct === null ? '—' : `${overallPct}%`}
          sub={totals.answered > 0 ? `${totals.correct}/${totals.answered}` : 'no answers yet'}
        />
        <StatTile label="Answered" value={String(totals.answered)} />
        <StatTile label="Questions seen" value={String(totals.distinctQuestions)} />
        <StatTile label="Card reviews" value={String(totals.reviews)} />
        <StatTile label="Lessons done" value={String(totals.lessonsCompleted)} />
      </section>

      <MasteryPanel sections={overview.sections} onTopic={practiceTopic} />
      <FingerprintsPanel fingerprints={overview.fingerprints} onTopic={practiceTopic} />
      <PacingPanel pacing={overview.pacing} />
      <FlashcardsPanel load={overview.flashcards} />
      <HeatmapPanel
        byDay={overview.heatmap.byDay}
        todayKey={overview.heatmap.todayKey}
        weeks={overview.heatmap.weeks}
      />
      <EffortTrendPanel trend={overview.effortTrend} />
      <AamcPanel aamc={overview.aamc} />
    </div>
  )
}
