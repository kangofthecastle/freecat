/** Diagnostic session sizing (roadmap Phase 4). Shared because the renderer's offer copy quotes
 *  the size while the main-process composer enforces it — one constant, no drift. */
export const DIAGNOSTIC_CONFIG = {
  /** Overall question target — short enough to actually get taken, long enough to touch every discipline. */
  targetTotal: 15,
  /** Per-discipline ceiling in QUESTIONS (a passage unit may overshoot it — passage atomicity wins). */
  perDisciplineCap: 3
} as const
