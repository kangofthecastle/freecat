import type { PlanProgressDto } from '../../../shared/dto'
import { StatTile } from '../components/StatTile'

const pct = (n: number): string => `${Math.round(n * 100)}%`

/**
 * Streak / on-track / completion tiles. The skip-rate renders INSIDE the streak tile (roadmap A5):
 * the streak's denominator excludes skips — a skip is agency, not failure — so the number that
 * keeps it honest has to sit right beside it, not in a separate panel nobody reads.
 */
export function ProgressStrip({ progress }: { progress: PlanProgressDto }): React.JSX.Element {
  return (
    <section className="grid grid-cols-3 gap-4">
      <StatTile label="Plan streak" value="">
        <div className="flex items-baseline gap-2">
          <span className="flex items-center gap-1 text-2xl font-bold text-gray-800">
            <span aria-hidden>🔥</span>
            {progress.streak}
          </span>
          {/* Rendered even at 0% (A5): the disclosure must be unconditional or a clean week hides
              older heavy skipping behind a bare streak number. */}
          {progress.skipRate != null && (
            <span className="text-xs text-gray-400">{pct(progress.skipRate)} skipped</span>
          )}
        </div>
      </StatTile>

      <StatTile label="Last 7 days" value={progress.completionRate == null ? '—' : pct(progress.completionRate)} sub={progress.completionRate == null ? 'no plan history yet' : 'of planned tasks done'} />

      <OnTrackTile onTrack={progress.onTrack} />
    </section>
  )
}

function OnTrackTile({ onTrack }: { onTrack: PlanProgressDto['onTrack'] }): React.JSX.Element {
  const meta =
    onTrack === 'on-track'
      ? { text: 'On track', cls: 'text-emerald-700', sub: 'keep it rolling' }
      : onTrack === 'falling-behind'
        ? { text: 'Falling behind', cls: 'text-amber-700', sub: 'a lighter day still counts' }
        : onTrack === 'neutral'
          ? { text: 'Steady', cls: 'text-gray-700', sub: 'roughly on pace' }
          : { text: '—', cls: 'text-gray-400', sub: 'shows after a few plan days' }
  return (
    <StatTile label="Status" value="">
      <p className={`mt-0.5 text-2xl font-bold ${meta.cls}`}>{meta.text}</p>
      <p className="text-xs text-gray-400">{meta.sub}</p>
    </StatTile>
  )
}
