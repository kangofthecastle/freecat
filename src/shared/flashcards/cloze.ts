// src/shared/flashcards/cloze.ts

/**
 * HTML-attribute-encode a string for use inside data-cloze="…".
 *
 * data-cloze carries the answer-side rendered HTML so future reveal-all JS can swap a hidden
 * deletion to its revealed form. Encoding makes `el.getAttribute('data-cloze')` return that HTML
 * string EXACTLY (one decode, performed by the HTML attribute parser). Consumers MUST therefore
 * assign it with a SINGLE further decode — i.e. `el.innerHTML = el.getAttribute('data-cloze')` —
 * and MUST NOT re-decode the value first (e.g. assigning it as textContent, or running their own
 * entity decode before innerHTML, would leave a stray entity such as `&amp;` visible). See the
 * "entity round-trip" test in cloze.test.ts which pins this invariant.
 */
function encodeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface ParsedDeletion { ordinal: number; answer: string; hint: string | null; next: number }

/**
 * Parse a single `{{c<digits>::…}}` starting at `open` (index of the leading `{{`),
 * matching the closing `}}` across nested `{{…}}`. Returns null if not a cloze opener
 * or if unbalanced.
 */
function parseDeletion(text: string, open: number): ParsedDeletion | null {
  const m = /^\{\{c(\d+)::/.exec(text.slice(open))
  if (!m) return null
  const numStr = m[1]
  if (numStr === undefined) return null
  const ordinal = Number(numStr)
  const contentStart = open + m[0].length
  let i = contentStart
  let depth = 1 // inside this deletion's braces
  let splitIndex = -1 // index of the first top-level '::' (answer/hint boundary)
  while (i < text.length) {
    if (text.startsWith('{{', i)) { depth++; i += 2; continue }
    if (text.startsWith('}}', i)) {
      depth--
      if (depth === 0) {
        const inner = text.slice(contentStart, i)
        const rel = splitIndex === -1 ? -1 : splitIndex - contentStart
        const answer = rel === -1 ? inner : inner.slice(0, rel)
        const hint = rel === -1 ? null : inner.slice(rel + 2)
        return { ordinal, answer, hint, next: i + 2 }
      }
      i += 2
      continue
    }
    if (depth === 1 && splitIndex === -1 && text.startsWith('::', i)) { splitIndex = i; i += 2; continue }
    i++
  }
  return null // unbalanced
}

function renderDeletion(n: number, answer: string, hint: string | null, active: number, side: 'question' | 'answer'): string {
  if (n === active) {
    if (side === 'question') {
      const revealed = renderClozeField(answer, active, 'answer')
      const placeholder = hint && hint.length > 0 ? hint : '…'
      return `<span class="cloze" data-cloze="${encodeAttr(revealed)}" data-ordinal="${n}">[${placeholder}]</span>`
    }
    const revealed = renderClozeField(answer, active, 'answer')
    return `<span class="cloze" data-ordinal="${n}">${revealed}</span>`
  }
  // inactive: show the content; recurse so a nested active cloze still resolves.
  const shown = renderClozeField(answer, active, side)
  return `<span class="cloze-inactive" data-ordinal="${n}">${shown}</span>`
}

/** Render Anki cloze markup for a given active ordinal and side. Total: never throws. */
export function renderClozeField(text: string, ordinal: number, side: 'question' | 'answer'): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('{{c', i)) {
      const d = parseDeletion(text, i)
      if (d) {
        out += renderDeletion(d.ordinal, d.answer, d.hint, ordinal, side)
        i = d.next
        continue
      }
    }
    out += text.charAt(i)
    i++
  }
  return out
}
