// test/flashcards/anki-proto.test.ts
import { describe, it, expect } from 'vitest'
import { NotetypeConfig, TemplateConfig, MediaEntries } from '../../src/main/flashcards/anki-proto'

describe('anki-proto', () => {
  it('round-trips NotetypeConfig (kind=1, css=3)', () => {
    const bytes = NotetypeConfig.encode({ kind: 1, css: '.card{color:red}' }).finish()
    const msg = NotetypeConfig.decode(bytes) as unknown as { kind: number; css: string }
    expect(msg.kind).toBe(1)
    expect(msg.css).toBe('.card{color:red}')
  })

  it('defaults kind to 0 and css to "" when absent (proto3)', () => {
    const msg = NotetypeConfig.decode(NotetypeConfig.encode({}).finish()) as unknown as { kind: number; css: string }
    expect(msg.kind).toBe(0)
    expect(msg.css).toBe('')
  })

  it('round-trips TemplateConfig (q_format=1, a_format=2)', () => {
    const bytes = TemplateConfig.encode({ q_format: '{{Front}}', a_format: '{{FrontSide}}{{Back}}' }).finish()
    const msg = TemplateConfig.decode(bytes) as unknown as { q_format: string; a_format: string }
    expect(msg.q_format).toBe('{{Front}}')
    expect(msg.a_format).toBe('{{FrontSide}}{{Back}}')
  })

  it('round-trips MediaEntries (repeated entry name)', () => {
    const bytes = MediaEntries.encode({ entries: [{ name: 'a.png' }, { name: 'b.jpg' }] }).finish()
    const msg = MediaEntries.decode(bytes) as unknown as { entries: { name: string }[] }
    expect(msg.entries.map((e) => e.name)).toEqual(['a.png', 'b.jpg'])
  })
})
