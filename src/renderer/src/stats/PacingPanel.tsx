import type { SectionPacingDto } from '../../../shared/dto'
import { formatSeconds } from './insights'

export function PacingPanel({ pacing }: { pacing: SectionPacingDto[] }): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">Pacing</h3>
      <p className="mb-4 text-sm text-gray-500">
        Your median time per question (last 60 days), against your own history. The AAMC pace is a
        reference, not a target — practice questions aren&rsquo;t calibrated to exam timing.
      </p>
      <div className="space-y-3">
        {pacing.map((p) => (
          <div key={p.section} className="rounded-xl bg-gray-50 p-3 ring-1 ring-gray-100">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-gray-700">{p.title}</span>
              {p.medianMs === null ? (
                <span className="text-xs text-gray-400">
                  not enough timed questions yet ({p.timedCount}/5)
                </span>
              ) : (
                <span className="text-sm font-bold text-gray-800">
                  {formatSeconds(p.medianMs)} <span className="font-normal text-gray-400">median</span>
                </span>
              )}
            </div>
            {p.medianMs !== null && (
              <p className="mt-1 text-xs text-gray-500">
                {p.timedCount} timed · {p.outlierCount} well over your pace · AAMC pace ≈
                {formatSeconds(p.referenceMs)}/Q (reference)
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
