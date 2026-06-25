// test/flashcards/render.test.ts
import { describe, it, expect } from 'vitest'
import { buildCardHtml, preprocessMath, rewriteMedia, replaceSound, IFRAME_CSP } from '../../src/shared/flashcards/render'
import type { CardView } from '../../src/shared/dto'

function view(over: Partial<CardView> = {}): CardView {
  return {
    cardId: 1, renderKind: 'basic', css: '.card{color:red}',
    qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id="ans">{{Back}}',
    fields: [{ name: 'Front', value: 'Q' }, { name: 'Back', value: 'A' }],
    tags: [], noteTypeName: 'Basic', deckName: 'D', subdeckName: 'D', templateName: 'C',
    clozeOrdinal: null, mediaMap: [], ...over
  }
}

describe('preprocessMath', () => {
  it('converts [$]…[/$] → \\(…\\) and [$$]…[/$$] → \\[…\\]', () => {
    expect(preprocessMath('a [$]x^2[/$] b [$$]y[/$$] c')).toBe('a \\(x^2\\) b \\[y\\] c')
  })
})

describe('rewriteMedia', () => {
  it('rewrites a known src to its url and leaves unknown src alone', () => {
    const html = '<img src="a.png"><img src="b.png">'
    const out = rewriteMedia(html, [{ filename: 'a.png', url: 'freecat-media://tok/a.png' }])
    expect(out).toBe('<img src="freecat-media://tok/a.png"><img src="b.png">')
  })

  it('rewrites srcset candidates, preserving descriptors', () => {
    const out = rewriteMedia('<img srcset="a.png 1x, b.png 2x">', [
      { filename: 'a.png', url: 'fm://t/a.png' },
      { filename: 'b.png', url: 'fm://t/b.png' }
    ])
    expect(out).toBe('<img srcset="fm://t/a.png 1x, fm://t/b.png 2x">')
  })

  it('rewrites CSS url() references', () => {
    expect(rewriteMedia('body{background:url(bg.png)}', [{ filename: 'bg.png', url: 'fm://t/bg.png' }]))
      .toBe('body{background:url(fm://t/bg.png)}')
  })

  it('does not rewrite data-src — only the real src attribute', () => {
    expect(rewriteMedia('<img data-src="a.png">', [{ filename: 'a.png', url: 'fm://t/a.png' }]))
      .toBe('<img data-src="a.png">')
  })

  it('HTML-entity-decodes the captured src before lookup (a&amp;b.png matches stored a&b.png)', () => {
    const out = rewriteMedia('<img src="a&amp;b.png">', [{ filename: 'a&b.png', url: 'fm://t/ab.png' }])
    expect(out).toBe('<img src="fm://t/ab.png">')
  })
})

describe('replaceSound', () => {
  it('replaces [sound:x] with an inert chip', () => {
    expect(replaceSound('[sound:hi.mp3]')).toContain('audio — playback coming in a later milestone')
    expect(replaceSound('[sound:hi.mp3]')).not.toContain('[sound:')
  })
})

describe('buildCardHtml', () => {
  it('question side embeds the strict CSP, the card CSS, and the question body', () => {
    const html = buildCardHtml(view(), 'question')
    expect(html).toContain(`content="${IFRAME_CSP}"`)
    expect(html).toContain('<style>.card{color:red}</style>')
    expect(html).toContain('>Q<') // body div wraps the rendered Front
    expect(html).not.toContain('id="ans"') // answer-only markup absent
  })

  it('answer side includes the rendered question as FrontSide', () => {
    const html = buildCardHtml(view(), 'answer')
    expect(html).toContain('id="ans"')
    expect(html).toContain('Q') // FrontSide
    expect(html).toContain('A') // Back
  })

  it('rewrites media via the mediaMap', () => {
    const html = buildCardHtml(view({ fields: [{ name: 'Front', value: '<img src="p.png">' }, { name: 'Back', value: '' }], mediaMap: [{ filename: 'p.png', url: 'freecat-media://tok/p.png' }] }), 'question')
    expect(html).toContain('src="freecat-media://tok/p.png"')
  })

  it('rewrites media url() inside the card CSS', () => {
    const html = buildCardHtml(view({ css: '.fc-card{background:url(bg.png)}', mediaMap: [{ filename: 'bg.png', url: 'freecat-media://tok/bg.png' }] }), 'question')
    expect(html).toContain('<style>.fc-card{background:url(freecat-media://tok/bg.png)}</style>')
  })

  it('inlines MathJax only when math is present AND a source is supplied', () => {
    const mathCard = view({ fields: [{ name: 'Front', value: '[$]x[/$]' }, { name: 'Back', value: '' }] })
    expect(buildCardHtml(mathCard, 'question', 'MJ_SOURCE')).toContain('MJ_SOURCE')
    expect(buildCardHtml(mathCard, 'question', 'MJ_SOURCE')).toContain('window.MathJax')
    expect(buildCardHtml(view(), 'question', 'MJ_SOURCE')).not.toContain('MJ_SOURCE') // no math → no inline
    expect(buildCardHtml(mathCard, 'question')).not.toContain('window.MathJax') // no source → no inline
  })

  it('disables $…$ and $$…$$ delimiters in the MathJax config', () => {
    const mathCard = view({ fields: [{ name: 'Front', value: '[$]x[/$]' }, { name: 'Back', value: '' }] })
    const html = buildCardHtml(mathCard, 'question', 'MJ')
    expect(html).toContain("inlineMath:[['\\\\(','\\\\)']]")
    expect(html).toContain("displayMath:[['\\\\[','\\\\]']]")
  })

  it('always includes the height postMessage shim', () => {
    expect(buildCardHtml(view(), 'question')).toContain("type:'fc-height'")
  })

  it('threads a cloze hint through the full {{cloze:}} template path (question shows [hint], answer reveals)', () => {
    const clozeView = view({
      renderKind: 'cloze',
      qfmt: '{{cloze:Text}}',
      afmt: '{{cloze:Text}}',
      fields: [{ name: 'Text', value: '{{c1::ans::myhint}}' }],
      clozeOrdinal: 1
    })
    const q = buildCardHtml(clozeView, 'question')
    expect(q).toContain('[myhint]') // active deletion renders the hint placeholder, not the answer…
    expect(q).not.toContain('>ans<') // …and does not leak the answer on the question side
    const a = buildCardHtml(clozeView, 'answer')
    expect(a).toContain('ans') // answer side reveals the hidden answer
  })
})
