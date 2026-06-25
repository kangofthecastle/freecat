// src/main/flashcards/detect.ts
import type { SourceFormat } from '../../shared/flashcards/types'
import type { ZipEntryMeta } from './central-dir'

export interface DetectResult { format: SourceFormat; collectionMember: string }

/** Decide the container format from central-directory member names (newest collection wins). */
export function detectFormat(entries: ZipEntryMeta[]): DetectResult | null {
  const names = new Set(entries.map((x) => x.name))
  if (names.has('collection.anki21b')) return { format: 'latest', collectionMember: 'collection.anki21b' }
  if (names.has('collection.anki21')) return { format: 'legacy2', collectionMember: 'collection.anki21' }
  if (names.has('collection.anki2')) return { format: 'legacy1', collectionMember: 'collection.anki2' }
  return null
}
