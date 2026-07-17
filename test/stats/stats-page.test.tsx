// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import type { StatsOverview, MasteryDto } from '../../src/shared/dto'
import Stats from '../../src/renderer/src/pages/Stats'

afterEach(() => cleanup())

const zeroMastery: MasteryDto = {
  mastery: 0.5, nEff: 0, coverage: 0, attempted: 0, published: 0, needsData: true, stale: false
}

function emptyOverview(): StatsOverview {
  return {
    totals: { answered: 0, correct: 0, distinctQuestions: 0, reviews: 0, lessonsCompleted: 0 },
    sections: [
      { section: 'chem-phys', title: 'Chem & Phys Foundations', mastery: zeroMastery, disciplines: [] },
      { section: 'bio-biochem', title: 'Bio & Biochem Foundations', mastery: zeroMastery, disciplines: [] },
      { section: 'psych-soc', title: 'Psych, Soc & Bio Foundations', mastery: zeroMastery, disciplines: [] }
    ],
    masteryTrend: [],
    fingerprints: [],
    fingerprintWindow: { days: 60, widened: false },
    pacing: [
      { section: 'chem-phys', title: 'Chem & Phys Foundations', medianMs: null, timedCount: 0, outlierCount: 0, referenceMs: 96_600 },
      { section: 'bio-biochem', title: 'Bio & Biochem Foundations', medianMs: null, timedCount: 0, outlierCount: 0, referenceMs: 96_600 },
      { section: 'psych-soc', title: 'Psych, Soc & Bio Foundations', medianMs: null, timedCount: 0, outlierCount: 0, referenceMs: 96_600 }
    ],
    effortTrend: [{ day: '2026-07-17', questions: 0, flashcardReviews: 0, lessonsCompleted: 0, points: 0 }],
    heatmap: { byDay: {}, todayKey: '2026-07-17', weeks: 8 },
    aamc: [],
    flashcards: {
      totalCards: 0, dueNow: 0, dueByDay: [], states: { learning: 0, review: 0, relearning: 0 },
      introducedToday: 0, againRate7d: null, againRate30d: null, lapsesTotal: 0
    }
  }
}

function stub(overview: StatsOverview): void {
  const freecat = { stats: { overview: async () => overview } }
  // @ts-expect-error partial bridge stub for tests
  window.freecat = freecat
}

describe('Stats page', () => {
  it('renders the zero-data profile as a welcome, not an error', async () => {
    stub(emptyOverview())
    render(<Stats />)
    // /Mastery/ matches both the mastery panel and the new trend panel — assert on the ambient set.
    await waitFor(() => expect(screen.getAllByText(/Mastery/).length).toBeGreaterThan(0))
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy()
    expect(screen.getByText(/No recent misses/)).toBeTruthy()
    expect(screen.getByText(/No cards in rotation yet/)).toBeTruthy()
    expect(screen.getByText(/No study events yet/)).toBeTruthy()
    expect(screen.getByText(/The trend starts once a section has enough evidence/)).toBeTruthy()
  })

  it('mastery trend renders lines for scored days and labels a widened fingerprint window', async () => {
    const o = emptyOverview()
    o.masteryTrend = [
      { day: '2026-07-15', sections: { 'chem-phys': null, 'bio-biochem': null, 'psych-soc': null } },
      { day: '2026-07-16', sections: { 'chem-phys': 0.62, 'bio-biochem': null, 'psych-soc': null } },
      { day: '2026-07-17', sections: { 'chem-phys': 0.7, 'bio-biochem': null, 'psych-soc': null } }
    ]
    o.fingerprintWindow = { days: 132, widened: true }
    stub(o)
    render(<Stats />)
    await waitFor(() => expect(screen.getByLabelText('Mastery over time per section')).toBeTruthy())
    // legend shows the latest scored value for the scored section, honesty badge for the others
    expect(screen.getByText('70%')).toBeTruthy()
    expect(screen.getAllByText('· needs data').length).toBe(2)
    // the widened window is labeled with its REAL span, not the configured 60
    expect(screen.getByText(/last 132 days — stretched back/)).toBeTruthy()
  })

  it('trend legend shows TODAY only — a decayed-back-to-needs-data section never shows a stale score', async () => {
    const o = emptyOverview()
    o.masteryTrend = [
      { day: '2026-07-16', sections: { 'chem-phys': 0.7, 'bio-biochem': null, 'psych-soc': null } },
      // Evidence decayed below the floor with no new attempts: today is honestly null again.
      { day: '2026-07-17', sections: { 'chem-phys': null, 'bio-biochem': null, 'psych-soc': null } }
    ]
    stub(o)
    render(<Stats />)
    await waitFor(() => expect(screen.getByLabelText('Mastery over time per section')).toBeTruthy())
    expect(screen.queryByText('70%')).toBeNull()
    expect(screen.getAllByText('· needs data').length).toBe(3)
  })

  it('needsData topics render a badge instead of a confident bar; scored topics show a percent', async () => {
    const o = emptyOverview()
    o.totals = { answered: 3, correct: 2, distinctQuestions: 3, reviews: 0, lessonsCompleted: 0 }
    o.sections[0]!.disciplines = [
      {
        discipline: 'physics',
        title: 'Physics',
        mastery: { mastery: 0.7, nEff: 2, coverage: 0.5, attempted: 2, published: 4, needsData: false, stale: false },
        topics: [
          {
            topic: 'physics.mechanics',
            title: 'Mechanics',
            mastery: { mastery: 0.7, nEff: 2, coverage: 1, attempted: 2, published: 2, needsData: false, stale: false }
          },
          {
            topic: 'physics.fluids',
            title: 'Fluids',
            mastery: { mastery: 0.55, nEff: 0.9, coverage: 0.5, attempted: 1, published: 2, needsData: true, stale: false }
          }
        ]
      }
    ]
    stub(o)
    const navigate = vi.fn()
    render(<Stats navigate={navigate} />)
    await waitFor(() => expect(screen.getByText('Mechanics')).toBeTruthy())
    // scored topic shows its percent; needsData one shows the honesty badge and no percent
    expect(screen.getByText('70%')).toBeTruthy()
    expect(screen.queryByText('55%')).toBeNull()
    expect(screen.getAllByText(/not enough data/).length).toBeGreaterThan(0)
    // topic click deep-links into a scoped qbank session
    screen.getByText('Mechanics').closest('button')!.click()
    expect(navigate).toHaveBeenCalledWith('qbank', { topicSlug: 'physics.mechanics' })
  })

  it('surfaces a retry state when the overview call rejects', async () => {
    // @ts-expect-error partial bridge stub for tests
    window.freecat = { stats: { overview: async () => Promise.reject(new Error('boom')) } }
    render(<Stats />)
    await waitFor(() => expect(screen.getByText(/could not load your stats/)).toBeTruthy())
    expect(screen.getByText('Try again')).toBeTruthy()
  })
})
