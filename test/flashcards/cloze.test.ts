// test/flashcards/cloze.test.ts
import { describe, it, expect } from 'vitest'
import { renderClozeField } from '../../src/shared/flashcards/cloze'

describe('renderClozeField', () => {
  it('question side: active deletion → data-cloze + [...] placeholder', () => {
    const out = renderClozeField('the {{c1::answer}} here', 1, 'question')
    expect(out).toBe('the <span class="cloze" data-cloze="answer" data-ordinal="1">[…]</span> here')
  })

  it('question side: uses the hint when present', () => {
    const out = renderClozeField('{{c1::answer::my hint}}', 1, 'question')
    expect(out).toBe('<span class="cloze" data-cloze="answer" data-ordinal="1">[my hint]</span>')
  })

  it('splits answer/hint on the FIRST top-level :: — extra :: stay in the hint', () => {
    // {{c1::answer::a::b}} → answer="answer", hint="a::b" → placeholder [a::b].
    const out = renderClozeField('{{c1::answer::a::b}}', 1, 'question')
    expect(out).toBe('<span class="cloze" data-cloze="answer" data-ordinal="1">[a::b]</span>')
  })

  it('answer side: active deletion reveals the answer', () => {
    const out = renderClozeField('the {{c1::answer}} here', 1, 'answer')
    expect(out).toBe('the <span class="cloze" data-ordinal="1">answer</span> here')
  })

  it('answer side: drops the hint, revealing only the answer', () => {
    const out = renderClozeField('{{c1::answer::my hint}}', 1, 'answer')
    expect(out).toBe('<span class="cloze" data-ordinal="1">answer</span>') // hint absent on the answer side
  })

  it('an active ordinal that matches no cloze leaves every deletion inactive (nothing hidden)', () => {
    // ordinal 3 over a field with only c1/c2 (e.g. a deletion was edited out but the card row survived).
    const q = renderClozeField('{{c1::a}} {{c2::b}}', 3, 'question')
    expect(q).toBe('<span class="cloze-inactive" data-ordinal="1">a</span> <span class="cloze-inactive" data-ordinal="2">b</span>')
  })

  it('two c1 in one field both reveal together for ordinal 1', () => {
    const q = renderClozeField('{{c1::a}} x {{c1::b}}', 1, 'question')
    expect(q).toBe('<span class="cloze" data-cloze="a" data-ordinal="1">[…]</span> x <span class="cloze" data-cloze="b" data-ordinal="1">[…]</span>')
  })

  it('inactive ordinal renders as .cloze-inactive on the question side', () => {
    const q = renderClozeField('{{c1::a}} {{c2::b}}', 1, 'question')
    expect(q).toBe('<span class="cloze" data-cloze="a" data-ordinal="1">[…]</span> <span class="cloze-inactive" data-ordinal="2">b</span>')
  })

  it('HTML-attr-encodes the answer in data-cloze', () => {
    const q = renderClozeField('{{c1::a<b> & "c"}}', 1, 'question')
    expect(q).toBe('<span class="cloze" data-cloze="a&lt;b&gt; &amp; &quot;c&quot;" data-ordinal="1">[…]</span>')
  })

  it('data-cloze round-trips an answer containing an HTML entity via a SINGLE decode (innerHTML)', () => {
    // The answer source already contains an entity (&amp; = literal &). data-cloze holds the
    // answer-side HTML, attribute-encoded, so getAttribute (1 decode) + innerHTML (1 decode)
    // reproduces the answer exactly with no stray entity. We simulate both browser decode passes.
    const q = renderClozeField('{{c1::a&amp;b}}', 1, 'question')
    const attr = /data-cloze="([^"]*)"/.exec(q)?.[1] ?? ''
    expect(attr).toBe('a&amp;amp;b') // payload as written in the HTML source
    const attrDecode = (s: string): string =>
      s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const afterGetAttribute = attrDecode(attr) // browser decodes the attribute value once
    expect(afterGetAttribute).toBe('a&amp;b')  // === the answer-side HTML for this deletion
    // reveal-all assigns that as innerHTML → the parser decodes the text-node entity once more.
    expect(attrDecode(afterGetAttribute)).toBe('a&b') // exactly one '&', NOT a stray '&amp;'
  })

  it('nested cloze: outer active, inner inactive shows inner content', () => {
    const q = renderClozeField('{{c1::outer {{c2::inner}}}}', 1, 'question')
    // active c1 reveals into data-cloze (answer-side render of the inner c2 = inactive span)
    expect(q).toBe('<span class="cloze" data-cloze="outer &lt;span class=&quot;cloze-inactive&quot; data-ordinal=&quot;2&quot;&gt;inner&lt;/span&gt;" data-ordinal="1">[…]</span>')
  })

  it('nested cloze: inner active while inside an inactive outer still renders active', () => {
    const a = renderClozeField('{{c1::outer {{c2::inner}}}}', 2, 'answer')
    expect(a).toBe('<span class="cloze-inactive" data-ordinal="1">outer <span class="cloze" data-ordinal="2">inner</span></span>')
  })

  it('leaves a malformed/unbalanced deletion as literal text', () => {
    expect(renderClozeField('{{c1::oops', 1, 'question')).toBe('{{c1::oops')
  })

  it('passes through text with no clozes unchanged', () => {
    expect(renderClozeField('plain text', 1, 'question')).toBe('plain text')
  })
})
