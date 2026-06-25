// test/flashcards/detect.test.ts
import { describe, it, expect } from 'vitest'
import { detectFormat } from '../../src/main/flashcards/detect'
import type { ZipEntryMeta } from '../../src/main/flashcards/central-dir'

const e = (name: string): ZipEntryMeta => ({ name, compressedSize: 1, uncompressedSize: 1, localHeaderOffset: 0 })

describe('detectFormat', () => {
  it('picks legacy1 for collection.anki2', () => {
    expect(detectFormat([e('collection.anki2'), e('media'), e('0')])).toEqual({ format: 'legacy1', collectionMember: 'collection.anki2' })
  })
  it('newest collection member wins', () => {
    expect(detectFormat([e('collection.anki2'), e('collection.anki21b')])?.format).toBe('latest')
    expect(detectFormat([e('collection.anki2'), e('collection.anki21')])?.format).toBe('legacy2')
  })
  it('returns null when no collection member is present', () => {
    expect(detectFormat([e('media'), e('0')])).toBeNull()
  })
})
