import type { ErrorMode } from '../../../shared/dto'

/** Display-only mastery bands + coaching copy — MCAT-flavored, written fresh rather than ported
 *  (sat-world's copy is SAT-specific). No math lives here: every number arrives in the DTO. */

export interface MasteryBand {
  label: string
  /** Tailwind classes for the mastery chip/bar (bg + text + ring). */
  tone: string
  /** Bar fill class. */
  bar: string
}

export function masteryBand(mastery: number): MasteryBand {
  if (mastery >= 0.8) return { label: 'Strong', tone: 'bg-emerald-100 text-emerald-800 ring-emerald-200', bar: 'bg-emerald-500' }
  if (mastery >= 0.65) return { label: 'Solid', tone: 'bg-lime-100 text-lime-800 ring-lime-200', bar: 'bg-lime-500' }
  if (mastery >= 0.5) return { label: 'Developing', tone: 'bg-amber-100 text-amber-800 ring-amber-200', bar: 'bg-amber-500' }
  return { label: 'Weak', tone: 'bg-red-100 text-red-800 ring-red-200', bar: 'bg-red-500' }
}

/** One short coaching line per fingerprint mode. The factual evidence clause arrives in the DTO;
 *  this adds only the "so what". */
export function fingerprintCoaching(mode: ErrorMode | null): string {
  switch (mode) {
    case 'repeated_distractor':
      return 'The same trap keeps working — reread the explanation for why the distractor is wrong, not just why the answer is right.'
    case 'careless_fast':
      return 'Speed is costing points here — slow down and confirm before committing.'
    case 'slow_wrong':
      return 'Extra time is not converting — the gap is content, not pace. A lesson review may help.'
    case 'standard':
      return 'Misses without a pattern — regular practice should close this.'
    case null:
      return 'Getting them right, but flagging them — worth a confidence pass.'
  }
}

export const MODE_LABEL: Record<ErrorMode, string> = {
  repeated_distractor: 'Repeated distractor',
  careless_fast: 'Fast & wrong',
  slow_wrong: 'Slow & wrong',
  standard: 'Mixed misses'
}

/** Whole-point display value for effort points. */
export function displayEffort(points: number): number {
  return Math.round(points)
}

export function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}
