// src/shared/flashcards/render.ts
import type { CardView } from '../dto'
import { renderTemplate, type TemplateContext } from './template'

/** Iframe-document CSP. default-src 'none' blocks fetch/XHR/connect (no connect-src);
 *  media is delivered subresource-only as <img src="freecat-media://…">. 'unsafe-eval'
 *  is required by MathJax (O5) and bounded by the opaque origin + no network. */
export const IFRAME_CSP = "default-src 'none'; img-src freecat-media:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'"

const HEIGHT_SHIM =
  "<script>(function(){function p(){try{parent.postMessage({type:'fc-height'," +
  "height:Math.ceil(document.documentElement.getBoundingClientRect().height)},'*')}catch(e){}}" +
  "window.addEventListener('load',p);if(window.ResizeObserver){new ResizeObserver(p).observe(document.documentElement)}" +
  "setTimeout(p,50);setTimeout(p,400)})();</script>"

function mathjaxBlock(src: string): string {
  const cfg =
    "<script>window.MathJax={tex:{inlineMath:[['\\\\(','\\\\)']],displayMath:[['\\\\[','\\\\]']]}," +
    "loader:{load:[]},startup:{typeset:true},options:{enableMenu:false,enableAssistiveMml:false}," +
    "svg:{fontCache:'local'}};</script>"
  return cfg + `<script>${src}</script>`
}

export function preprocessMath(html: string): string {
  return html
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_m, x: string) => `\\[${x}\\]`)
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_m, x: string) => `\\(${x}\\)`)
}

export function rewriteMedia(html: string, mediaMap: CardView['mediaMap']): string {
  if (mediaMap.length === 0) return html
  const byName = new Map(mediaMap.map((m) => [m.filename, m.url]))
  return html.replace(/(\bsrc\s*=\s*)(["'])([^"']*)\2/gi, (whole, pre: string, q: string, name: string) => {
    const url = byName.get(name)
    return url ? `${pre}${q}${url}${q}` : whole
  })
}

export function replaceSound(html: string): string {
  return html.replace(/\[sound:([^\]]+)\]/g, (_m, name: string) =>
    `<span class="fc-audio" title="${name.replace(/"/g, '&quot;')}">🔊 audio — playback coming in a later milestone</span>`)
}

function hasMath(html: string): boolean {
  return html.includes('\\(') || html.includes('\\[')
}

function buildContext(view: CardView, side: 'question' | 'answer', frontSide: string): TemplateContext {
  const fields: Record<string, string> = {}
  for (const f of view.fields) fields[f.name] = f.value
  return {
    fields,
    clozeOrdinal: view.clozeOrdinal,
    side,
    frontSide,
    special: { Tags: view.tags.join(' '), Type: view.noteTypeName, Deck: view.deckName, Subdeck: view.subdeckName, Card: view.templateName }
  }
}

/**
 * Build the complete iframe srcdoc for one side of a card. `mathjaxSrc` is the full
 * self-contained MathJax SVG build (supplied by the renderer); when omitted (e.g. node
 * tests) MathJax is never inlined.
 */
export function buildCardHtml(view: CardView, side: 'question' | 'answer', mathjaxSrc = ''): string {
  const question = renderTemplate(view.qfmt, buildContext(view, 'question', ''))
  const rendered = side === 'question' ? question : renderTemplate(view.afmt, buildContext(view, 'answer', question))
  let body = preprocessMath(rendered)
  body = rewriteMedia(body, view.mediaMap)
  body = replaceSound(body)
  const math = mathjaxSrc && hasMath(body) ? mathjaxBlock(mathjaxSrc) : ''
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${IFRAME_CSP}">` +
    `<style>${view.css}</style>${math}</head>` +
    `<body class="card"><div class="fc-card">${body}</div>${HEIGHT_SHIM}</body></html>`
  )
}
