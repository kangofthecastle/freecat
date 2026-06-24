import type { RenderKind } from '../../shared/flashcards/types'
import type { ParsedNoteType } from './parsed-collection'

export function classifyNoteType(nt: ParsedNoteType): RenderKind {
  const fields = new Set(nt.fields.map((f) => f.name))
  const name = nt.name.trim()
  const builtinIO = name === 'Image Occlusion' || (fields.has('Image') && (fields.has('Occlusion') || fields.has('Occlusions')))
  const ioe = name === 'Image Occlusion Enhanced' || (fields.has('Question Mask') && fields.has('Original Mask'))
  if (builtinIO || ioe) return 'image-occlusion'
  if (nt.fields.length === 0 || nt.templates.length === 0) return 'unsupported'
  return nt.kind === 'cloze' ? 'cloze' : 'basic'
}
