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

  it('answer side: active deletion reveals the answer', () => {
    const out = renderClozeField('the {{c1::answer}} here', 1, 'answer')
    expect(out).toBe('the <span class="cloze" data-ordinal="1">answer</span> here')
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
