// @vitest-environment jsdom
// test/qbank/choice-list.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChoiceList } from '../../src/renderer/src/qbank/ChoiceList'

afterEach(() => cleanup())

const FOUR: [string, string, string, string] = ['alpha', 'bravo', 'charlie', 'delta']

describe('ChoiceList accessibility (WCAG 1.4.1 — not by color alone)', () => {
  it('does not emit aria-pressed on locked (disabled) buttons', () => {
    // Picked B, correct answer is C → after submit (locked) the buttons are read-only.
    render(<ChoiceList choices={FOUR} selected="B" onSelect={() => {}} locked correctChoice="C" />)
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.hasAttribute('aria-pressed')).toBe(false)
    }
  })

  it('still emits aria-pressed while unlocked (pre-submit selection is conveyed to AT)', () => {
    render(<ChoiceList choices={FOUR} selected="B" onSelect={() => {}} locked={false} />)
    const buttons = screen.getAllByRole('button')
    // A=0 B=1 C=2 D=3; only the selected one is pressed.
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true')
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false')
  })

  it('labels the correct choice with visually-hidden "Correct answer" text after submit', () => {
    render(<ChoiceList choices={FOUR} selected="B" onSelect={() => {}} locked correctChoice="C" />)
    expect(screen.getByText('Correct answer')).toBeTruthy()
  })

  it('labels the user\'s wrong pick with visually-hidden "Your answer — incorrect" text', () => {
    render(<ChoiceList choices={FOUR} selected="B" onSelect={() => {}} locked correctChoice="C" />)
    expect(screen.getByText('Your answer — incorrect')).toBeTruthy()
  })

  it('does not add an incorrect label when the user picked the correct choice', () => {
    render(<ChoiceList choices={FOUR} selected="C" onSelect={() => {}} locked correctChoice="C" />)
    expect(screen.getByText('Correct answer')).toBeTruthy()
    expect(screen.queryByText('Your answer — incorrect')).toBeNull()
  })

  it('emits no correctness labels before submit (unlocked)', () => {
    render(<ChoiceList choices={FOUR} selected="B" onSelect={() => {}} locked={false} />)
    expect(screen.queryByText('Correct answer')).toBeNull()
    expect(screen.queryByText('Your answer — incorrect')).toBeNull()
  })
})
