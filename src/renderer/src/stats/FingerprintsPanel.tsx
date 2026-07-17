import type { FingerprintWindowDto, TopicFingerprintDto } from '../../../shared/dto'
import { MODE_LABEL, fingerprintCoaching } from './insights'

export function FingerprintsPanel({
  fingerprints,
  window,
  onTopic
}: {
  fingerprints: TopicFingerprintDto[]
  /** The recency window the classifier ACTUALLY used — label it honestly, especially when widened. */
  window: FingerprintWindowDto
  onTopic: (topicSlug: string) => void
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h3 className="mb-1 text-lg font-semibold text-gray-700">Error patterns</h3>
      <p className="mb-4 text-sm text-gray-500">
        How your recent misses miss (last {window.days} days
        {window.widened ? ' — stretched back to gather enough recent attempts' : ''}). Tap a topic
        to practice it.
      </p>
      {fingerprints.length === 0 ? (
        <p className="rounded-lg bg-gray-50 p-4 text-gray-500">
          No recent misses to diagnose — either you&rsquo;re fresh here, or you&rsquo;re not missing. Both fine.
        </p>
      ) : (
        <ul className="space-y-2">
          {fingerprints.map((fp) => (
            <li key={fp.topic}>
              <button
                type="button"
                onClick={() => onTopic(fp.topic)}
                className="w-full rounded-xl bg-gray-50 p-3 text-left ring-1 ring-gray-100 transition hover:bg-gray-100"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-gray-800" title={fp.title}>
                    {fp.title}
                  </span>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                    {fp.mode ? MODE_LABEL[fp.mode] : 'Unsure but right'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {fp.evidence}
                  {fp.mode !== null && fp.unsureCorrect > 0 && ` · ${fp.unsureCorrect} correct but flagged`}
                </p>
                <p className="mt-1 text-xs text-gray-400">{fingerprintCoaching(fp.mode)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
