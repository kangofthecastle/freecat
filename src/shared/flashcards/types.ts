// src/shared/flashcards/types.ts

/** How M1 renders a card. `basic`/`cloze` render faithfully; `image-occlusion`/`unsupported` browse + show a placeholder (Plan 2). */
export type RenderKind = 'basic' | 'cloze' | 'image-occlusion' | 'unsupported'

/** Anki note-type families M1 distinguishes structurally (cloze cards derive one card per cloze ordinal). */
export type NoteTypeKind = 'standard' | 'cloze'

/** Which Anki container format an import came from. */
export type SourceFormat = 'legacy1' | 'legacy2' | 'latest'
