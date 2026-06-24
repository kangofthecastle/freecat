import type { PresentedPassage } from '../../../shared/dto'
import { Markdown } from './Markdown'

/**
 * The passage shown beside its questions. It is sticky so it stays in view while the student
 * moves through the passage's sibling questions.
 */
export function PassagePane({ passage }: { passage: PresentedPassage }): React.JSX.Element {
  return (
    <aside className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-auto">
      <div className="rounded-2xl bg-amber-50/60 p-6 ring-1 ring-amber-100">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Passage</p>
        <Markdown>{passage.passage}</Markdown>
      </div>
    </aside>
  )
}
