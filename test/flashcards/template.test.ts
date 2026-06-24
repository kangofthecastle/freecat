// test/flashcards/template.test.ts
import { describe, it, expect } from 'vitest'
import { renderTemplate, type TemplateContext } from '../../src/shared/flashcards/template'

function ctx(over: Partial<TemplateContext> = {}): TemplateContext {
  return {
    fields: { Front: '<b>F</b>', Back: 'B', Empty: '   ', Hintable: 'secret' },
    clozeOrdinal: null,
    side: 'question',
    frontSide: 'FRONT_HTML',
    special: { Tags: 'a b', Type: 'Basic', Deck: 'Deck::Sub', Subdeck: 'Sub', Card: 'Card 1' },
    ...over
  }
}

describe('renderTemplate', () => {
  it('substitutes a field as raw HTML', () => {
    expect(renderTemplate('{{Front}}', ctx())).toBe('<b>F</b>')
  })

  it('unknown bare field → empty string', () => {
    expect(renderTemplate('x{{Nope}}y', ctx())).toBe('xy')
  })

  it('{{text:Field}} strips HTML', () => {
    expect(renderTemplate('{{text:Front}}', ctx())).toBe('F')
  })

  it('{{hint:Field}} renders a collapsible details for non-empty, nothing for empty', () => {
    expect(renderTemplate('{{hint:Hintable}}', ctx())).toBe('<details class="hint"><summary>Hintable</summary>secret</details>')
    expect(renderTemplate('{{hint:Empty}}', ctx())).toBe('')
  })

  it('positive section shows when field non-empty, hides when empty/whitespace', () => {
    expect(renderTemplate('{{#Back}}has back{{/Back}}', ctx())).toBe('has back')
    expect(renderTemplate('{{#Empty}}x{{/Empty}}', ctx())).toBe('')
  })

  it('negative section is the inverse', () => {
    expect(renderTemplate('{{^Empty}}is empty{{/Empty}}', ctx())).toBe('is empty')
    expect(renderTemplate('{{^Back}}x{{/Back}}', ctx())).toBe('')
  })

  it('nested sections', () => {
    expect(renderTemplate('{{#Front}}A{{#Back}}B{{/Back}}C{{/Front}}', ctx())).toBe('ABC')
  })

  it('special fields resolve', () => {
    expect(renderTemplate('{{Deck}}|{{Subdeck}}|{{Tags}}|{{Type}}|{{Card}}', ctx()))
      .toBe('Deck::Sub|Sub|a b|Basic|Card 1')
  })

  it('{{FrontSide}} resolves to the rendered question', () => {
    expect(renderTemplate('{{FrontSide}}', ctx())).toBe('FRONT_HTML')
  })

  it('unknown filter is identity over the resolved field', () => {
    expect(renderTemplate('{{tts en_US:Front}}', ctx())).toBe('<b>F</b>')
  })

  it('{{cloze:Field}} runs the cloze engine when an ordinal is set', () => {
    const c = ctx({ fields: { Text: '{{c1::a}} {{c2::b}}' }, clozeOrdinal: 1, side: 'question' })
    expect(renderTemplate('{{cloze:Text}}', c))
      .toBe('<span class="cloze" data-cloze="a" data-ordinal="1">[…]</span> <span class="cloze-inactive" data-ordinal="2">b</span>')
  })

  it('{{cloze:Field}} with no active ordinal strips the markup (never leaks raw {{cN::}})', () => {
    const c = ctx({ fields: { Text: '{{c1::a}}' }, clozeOrdinal: null })
    const out = renderTemplate('{{cloze:Text}}', c)
    expect(out).not.toContain('{{c1')
    expect(out).toBe('<span class="cloze-inactive" data-ordinal="1">a</span>')
  })

  it('leaves an unbalanced tag as literal', () => {
    expect(renderTemplate('a{{Front', ctx())).toBe('a{{Front')
  })
})
