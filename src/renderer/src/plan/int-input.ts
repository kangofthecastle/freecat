/** The one string→int clamp for the Plan module's numeric inputs (triangle fields, budgets,
 *  buffers). NaN and negatives clamp to 0, fractions floor, and values cap at `max` — typed
 *  values never exceed what a save would persist, so a field can't display a number the engine
 *  would silently reduce. */
export function clampInt(raw: string, max: number): number {
  return Math.min(max, Math.max(0, Math.floor(Number(raw) || 0)))
}
