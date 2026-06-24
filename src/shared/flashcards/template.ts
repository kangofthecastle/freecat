// src/shared/flashcards/template.ts
import { renderClozeField } from './cloze'

export interface TemplateContext {
  /** Field name → raw field value (HTML). */
  fields: Record<string, string>
  /** Active cloze ordinal for {{cloze:}} (null on non-cloze cards). */
  clozeOrdinal: number | null
  side: 'question' | 'answer'
  /** Rendered question HTML, for {{FrontSide}} (empty on the question side). */
  frontSide: string
  special: { Tags: string; Type: string; Deck: string; Subdeck: string; Card: string }
}

const SPECIAL = new Set(['Tags', 'Type', 'Deck', 'Subdeck', 'Card'])

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

/** Anki emptiness: no non-whitespace content after removing HTML tags and &nbsp;. */
function isEmptyField(value: string): boolean {
  return stripHtml(value).replace(/&nbsp;/gi, ' ').replace(/ /g, ' ').trim().length === 0
}

function resolveValue(name: string, ctx: TemplateContext): string | undefined {
  if (name === 'FrontSide') return ctx.frontSide
  if (SPECIAL.has(name)) return ctx.special[name as 'Tags' | 'Type' | 'Deck' | 'Subdeck' | 'Card']
  if (Object.prototype.hasOwnProperty.call(ctx.fields, name)) return ctx.fields[name]
  return undefined
}

function applyFilter(filter: string, fieldName: string, value: string, ctx: TemplateContext): string {
  switch (filter) {
    case 'text': return stripHtml(value)
    case 'hint': return isEmptyField(value) ? '' : `<details class="hint"><summary>${fieldName}</summary>${value}</details>`
    case 'type': return `<div class="type-answer">${stripHtml(value)}</div>`
    case 'cloze': return ctx.clozeOrdinal == null ? value : renderClozeField(value, ctx.clozeOrdinal, ctx.side)
    default: return value // unknown filter → identity (total, Anki-faithful)
  }
}

/** Render a `{{…}}` substitution tag (not a section open/close). */
function renderTag(inner: string, ctx: TemplateContext): string {
  const parts = inner.split(':')
  const fieldName = parts[parts.length - 1] ?? ''
  const filters = parts.slice(0, -1)
  const base = resolveValue(fieldName, ctx)
  if (base === undefined && filters.length === 0) return '' // unknown bare field → empty
  let value = base ?? ''
  for (let k = filters.length - 1; k >= 0; k--) {
    const f = filters[k]
    if (f === undefined || f.length === 0) continue
    value = applyFilter(f.trim(), fieldName, value, ctx)
  }
  return value
}

function sectionFieldEmpty(field: string, ctx: TemplateContext): boolean {
  const v = resolveValue(field, ctx)
  return v === undefined ? true : isEmptyField(v)
}

/**
 * Render from `start` until EOF, or until the `{{/stopField}}` that closes the section
 * we are inside. Returns the rendered text and the index just past that close.
 */
function renderNodes(fmt: string, start: number, ctx: TemplateContext, stopField: string | null): { out: string; end: number } {
  let out = ''
  let i = start
  while (i < fmt.length) {
    const open = fmt.indexOf('{{', i)
    if (open === -1) { out += fmt.slice(i); return { out, end: fmt.length } }
    out += fmt.slice(i, open)
    const close = fmt.indexOf('}}', open + 2)
    if (close === -1) { out += fmt.slice(open); return { out, end: fmt.length } } // unbalanced → literal tail
    const inner = fmt.slice(open + 2, close).trim()
    const after = close + 2
    if (inner.startsWith('#') || inner.startsWith('^')) {
      const field = inner.slice(1).trim()
      const body = renderNodes(fmt, after, ctx, field)
      const include = inner.startsWith('#') ? !sectionFieldEmpty(field, ctx) : sectionFieldEmpty(field, ctx)
      if (include) out += body.out
      i = body.end
    } else if (inner.startsWith('/')) {
      const field = inner.slice(1).trim()
      if (stopField !== null && field === stopField) return { out, end: after }
      i = after // stray close → ignore
    } else {
      out += renderTag(inner, ctx)
      i = after
    }
  }
  return { out, end: i }
}

export function renderTemplate(fmt: string, ctx: TemplateContext): string {
  return renderNodes(fmt, 0, ctx, null).out
}
