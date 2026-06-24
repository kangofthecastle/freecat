import { describe, it, expect } from 'vitest'
import { classifyNoteType } from '../../src/main/flashcards/classify'
import type { ParsedNoteType } from '../../src/main/flashcards/parsed-collection'

const nt = (over: Partial<ParsedNoteType>): ParsedNoteType => ({
  ankiId: 1, name: 'Basic', kind: 'standard', css: '', fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }], ...over
})

describe('classifyNoteType', () => {
  it('classifies standard → basic, cloze → cloze', () => {
    expect(classifyNoteType(nt({}))).toBe('basic')
    expect(classifyNoteType(nt({ kind: 'cloze' }))).toBe('cloze')
  })
  it('detects built-in Image Occlusion (by name or Image+Occlusion fields)', () => {
    expect(classifyNoteType(nt({ name: 'Image Occlusion' }))).toBe('image-occlusion')
    expect(classifyNoteType(nt({ name: 'Custom IO', fields: [{ ord: 0, name: 'Image' }, { ord: 1, name: 'Occlusion' }] }))).toBe('image-occlusion')
  })
  it('detects IOE add-on (by name or Question Mask/Original Mask fields)', () => {
    expect(classifyNoteType(nt({ name: 'Image Occlusion Enhanced' }))).toBe('image-occlusion')
    expect(classifyNoteType(nt({ fields: [{ ord: 0, name: 'Question Mask' }, { ord: 1, name: 'Original Mask' }] }))).toBe('image-occlusion')
  })
  it('marks a degenerate note type (no fields or no templates) unsupported', () => {
    expect(classifyNoteType(nt({ fields: [] }))).toBe('unsupported')
    expect(classifyNoteType(nt({ templates: [] }))).toBe('unsupported')
  })
})
