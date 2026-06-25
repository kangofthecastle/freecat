import type { ChoiceLetter } from '../../../shared/dto'
import { Markdown } from './Markdown'

export const LETTERS: ChoiceLetter[] = ['A', 'B', 'C', 'D']

export interface ChoiceListProps {
  /** Exactly 4 Markdown choice bodies, index 0 = choice A (matches PresentedQuestion.choices). */
  choices: [string, string, string, string]
  /** The currently pending (pre-submit) selection, if any. */
  selected: ChoiceLetter | null
  /** Selecting a choice; disabled once `locked`. */
  onSelect: (letter: ChoiceLetter) => void
  /** After submit the list is read-only and shows correct / wrong markers. */
  locked: boolean
  /** Set after submit so the correct choice can be highlighted green. */
  correctChoice?: ChoiceLetter | null
}

export function ChoiceList({
  choices,
  selected,
  onSelect,
  locked,
  correctChoice = null
}: ChoiceListProps): React.JSX.Element {
  return (
    <ul className="space-y-2">
      {choices.map((body, i) => {
        const letter = LETTERS[i]
        if (!letter) return null
        const isSelected = selected === letter
        const isCorrect = locked && correctChoice === letter
        const isWrongPick = locked && isSelected && correctChoice !== letter

        const tone = isCorrect
          ? 'border-emerald-400 bg-emerald-50'
          : isWrongPick
            ? 'border-red-400 bg-red-50'
            : isSelected
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-200 bg-white hover:bg-gray-50'

        return (
          <li key={letter}>
            <button
              type="button"
              disabled={locked}
              onClick={() => onSelect(letter)}
              aria-pressed={isSelected}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition disabled:cursor-default ${tone}`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  isCorrect
                    ? 'bg-emerald-500 text-white'
                    : isWrongPick
                      ? 'bg-red-500 text-white'
                      : isSelected
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-600'
                }`}
              >
                {letter}
              </span>
              <div className="min-w-0 flex-1">
                <Markdown className="[&_p]:m-0">{body}</Markdown>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
