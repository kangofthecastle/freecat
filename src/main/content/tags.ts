import type { Tag, TagVocabEntry } from '../../shared/dto'
import { AAMC_CONTENT_CATEGORIES } from '../db/seed/taxonomy-data'

export type { TagVocabEntry }

export const CONTENT_TAG_VOCAB: readonly TagVocabEntry[] = AAMC_CONTENT_CATEGORIES.map(
  (c) => ({ vocab: 'aamc', code: c.code, title: c.title })
)

export const TAG_KEYS: ReadonlySet<string> = new Set(
  CONTENT_TAG_VOCAB.map((t) => `${t.vocab}:${t.code}`)
)

export function isKnownTag(t: Tag): boolean {
  return TAG_KEYS.has(`${t.vocab}:${t.code}`)
}
