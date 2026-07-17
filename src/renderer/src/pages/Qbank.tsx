import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageProps } from '../App'
import type { StartSessionInput, StartSessionResult } from '../../../shared/dto'
import { Composer } from '../qbank/Composer'
import { Session, type SessionRecord } from '../qbank/Session'
import { SessionSummary } from '../qbank/SessionSummary'
import { Explanation } from '../qbank/Explanation'

type View = 'composer' | 'session' | 'summary'

/** Auto-start length when arriving via a topic deep-link (matches the Composer default). */
const DEEPLINK_COUNT = 10

export default function Qbank(props: PageProps): React.JSX.Element {
  const { navigate, navPayload } = props
  const [view, setView] = useState<View>('composer')
  const [session, setSession] = useState<StartSessionResult | null>(null)
  const [record, setRecord] = useState<SessionRecord | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  // Synchronous re-entry guard so a double-click can never fire two concurrent startSession
  // calls (which would create an orphaned qbank_session row).
  const startingRef = useRef(false)
  // The topic slug we last auto-started for. Keyed on the slug (not a one-shot boolean) so a
  // SECOND in-place deep-link to a DIFFERENT topic re-fires, while StrictMode's double-effect and
  // payload-identity churn for the SAME slug stay deduped.
  const lastStartedSlugRef = useRef<string | null>(null)
  // The plan-task session we last auto-started, deduped by OBJECT IDENTITY: every navigate() from
  // the Plan page builds a fresh input object (so re-clicking the same task re-fires), while
  // StrictMode's immediate second effect run sees the same object and skips.
  const lastPlanSessionRef = useRef<StartSessionInput | null>(null)

  const start = useCallback(async (input: StartSessionInput): Promise<void> => {
    if (startingRef.current) return
    startingRef.current = true
    setStartError(null)
    try {
      const result = await window.freecat.qbank.startSession(input)
      if (result.questions.length === 0) {
        setStartError(
          'No questions matched that selection. Try a broader scope or the “All questions” filter.'
        )
        return
      }
      setSession(result)
      setView('session')
    } catch (e) {
      console.error('startSession threw', e)
      setStartError('We could not start a session just now. Please try again.')
    } finally {
      startingRef.current = false
    }
  }, [])

  // Inbound cross-link: a topic deep-link (e.g. from a CR lesson's "Practice this topic")
  // auto-starts a topic-scoped session instead of showing the Composer. Fire only when the slug
  // changes from the last one we started — set the ref synchronously (before the async start) so
  // StrictMode's immediate second effect invocation sees the same slug already recorded and skips.
  useEffect(() => {
    const topicSlug = navPayload?.topicSlug
    if (!topicSlug || lastStartedSlugRef.current === topicSlug) return
    lastStartedSlugRef.current = topicSlug
    void start({ scopeKind: 'topic', scopeCode: topicSlug, refine: 'all', count: DEEPLINK_COUNT })
  }, [navPayload, start])

  // Inbound from a Plan task: the payload carries the exact session to run (topic + count sized by
  // the planner, or refine:'incorrect' for spaced mistake review) — start it verbatim.
  useEffect(() => {
    const input = navPayload?.qbankSession
    if (!input || lastPlanSessionRef.current === input) return
    lastPlanSessionRef.current = input
    void start(input)
  }, [navPayload, start])

  const complete = useCallback((rec: SessionRecord): void => {
    setRecord(rec)
    setSession(null)
    setView('summary')
  }, [])

  const newSession = useCallback((): void => {
    setRecord(null)
    setView('composer')
  }, [])

  // Analytics live in the Stats module (which absorbed the old qbank dashboard); the tab bar
  // keeps a plain nav link there so the old "Dashboard" muscle memory still lands somewhere.
  const showTabs = view === 'composer'

  return (
    <div>
      {showTabs && (
        <div className="border-b border-gray-100 bg-white px-8 pt-6">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <Tab label="Practice" active onClick={() => setView('composer')} />
            {/* Deliberately NOT a Tab: it navigates to the Stats page, not a local view. */}
            <button
              type="button"
              onClick={() => navigate?.('stats')}
              className="pb-2 text-sm font-medium text-blue-600 hover:underline"
            >
              Stats →
            </button>
          </div>
        </div>
      )}

      {view === 'composer' && (
        <>
          {startError && (
            <div className="mx-auto max-w-2xl px-8 pt-6">
              <p className="rounded-lg bg-amber-50 p-4 text-amber-800">{startError}</p>
            </div>
          )}
          <Composer onStart={start} />
        </>
      )}

      {view === 'session' && session && (
        <Session
          session={session}
          renderExplanation={(question, answer) => (
            <Explanation question={question} answer={answer} navigate={navigate} />
          )}
          onComplete={complete}
        />
      )}

      {view === 'summary' && record && (
        <SessionSummary
          summary={record.summary}
          questions={record.questions}
          answers={record.answers}
          onNewSession={newSession}
          onViewStats={() => navigate?.('stats')}
          navigate={navigate}
        />
      )}
    </div>
  )
}

function Tab({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
        active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  )
}
