// @vitest-environment jsdom
// test/qbank/session-summary.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type {
  PresentedQuestion,
  SessionSummary as SessionSummaryDto
} from '../../src/shared/dto'
import { SessionSummary } from '../../src/renderer/src/qbank/SessionSummary'

afterEach(() => cleanup())

function question(id: string): PresentedQuestion {
  return {
    id,
    topic: 'acid-base',
    section: 'CP' as PresentedQuestion['section'],
    passageId: null,
    stem: `Stem ${id}`,
    choices: ['a', 'b', 'c', 'd'],
    flagged: false
  }
}

const questions: PresentedQuestion[] = [question('q1'), question('q2')]

const summary: SessionSummaryDto = {
  sessionId: 1,
  total: 2,
  correct: 1,
  rows: [
    { questionId: 'q1', chosen: 'A', isCorrect: true },
    { questionId: 'q2', chosen: 'B', isCorrect: false }
  ]
}

describe('SessionSummary status glyph accessibility (WCAG 1.4.1)', () => {
  it('gives the ✓/✗ status glyphs accessible labels (not color/glyph alone)', () => {
    render(
      <SessionSummary
        summary={summary}
        questions={questions}
        answers={{}}
        onNewSession={() => {}}
        onViewDashboard={() => {}}
      />
    )
    // Each row's status indicator is reachable by its accessible name.
    expect(screen.getByLabelText('Correct')).toBeTruthy()
    expect(screen.getByLabelText('Incorrect')).toBeTruthy()
  })
})
