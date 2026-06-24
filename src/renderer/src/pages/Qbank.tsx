import { useCallback, useState } from 'react'
import type { PageProps } from '../App'
import type { StartSessionInput, StartSessionResult } from '../../../shared/dto'
import { Composer, type InitialScope } from '../qbank/Composer'
import { Session, type SessionRecord } from '../qbank/Session'
import { SessionSummary } from '../qbank/SessionSummary'
import { Dashboard } from '../qbank/Dashboard'
import { Explanation } from '../qbank/Explanation'

type View = 'composer' | 'session' | 'summary' | 'dashboard'

export default function Qbank(_props: PageProps): React.JSX.Element {
  const [view, setView] = useState<View>('composer')
  const [scope, setScope] = useState<InitialScope | undefined>(undefined)
  const [session, setSession] = useState<StartSessionResult | null>(null)
  const [record, setRecord] = useState<SessionRecord | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const start = useCallback(async (input: StartSessionInput): Promise<void> => {
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
    }
  }, [])

  const complete = useCallback((rec: SessionRecord): void => {
    setRecord(rec)
    setSession(null)
    setView('summary')
  }, [])

  const newSession = useCallback((): void => {
    setRecord(null)
    setScope(undefined)
    setView('composer')
  }, [])

  const openScoped = useCallback((next: InitialScope): void => {
    setScope(next)
    setView('composer')
  }, [])

  // The composer/dashboard tabs are only meaningful outside an active session/summary.
  const showTabs = view === 'composer' || view === 'dashboard'

  return (
    <div>
      {showTabs && (
        <div className="border-b border-gray-100 bg-white px-8 pt-6">
          <div className="mx-auto flex max-w-3xl gap-1">
            <Tab label="Practice" active={view === 'composer'} onClick={() => setView('composer')} />
            <Tab label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
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
          <Composer initialScope={scope} onStart={start} />
        </>
      )}

      {view === 'session' && session && (
        <Session
          session={session}
          renderExplanation={(question, answer) => (
            <Explanation question={question} answer={answer} />
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
          onViewDashboard={() => setView('dashboard')}
        />
      )}

      {view === 'dashboard' && <Dashboard onScope={openScoped} />}
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
