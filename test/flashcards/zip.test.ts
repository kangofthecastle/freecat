import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractMembers, assertWithinCaps, ImportTooLargeError, MAX_PER_MEMBER, MAX_TOTAL_UNCOMPRESSED } from '../../src/main/flashcards/zip'
import type { ZipEntryMeta } from '../../src/main/flashcards/central-dir'

const meta = (name: string, uncompressedSize: number): ZipEntryMeta => ({ name, compressedSize: 1, uncompressedSize, localHeaderOffset: 0 })

describe('zip extraction', () => {
  it('inflates only wanted members', () => {
    const zip = zipSync({ 'collection.anki2': strToU8('DB'), '0': strToU8('img0'), '1': strToU8('img1'), 'media': strToU8('{}') })
    const out = extractMembers(zip, (n) => n === 'collection.anki2' || n === 'media')
    expect(Object.keys(out).sort()).toEqual(['collection.anki2', 'media'])
    expect(new TextDecoder().decode(out['collection.anki2']!)).toBe('DB')
  })

  it('assertWithinCaps rejects an over-large member', () => {
    expect(() => assertWithinCaps([meta('0', MAX_PER_MEMBER + 1)])).toThrow(ImportTooLargeError)
  })

  it('assertWithinCaps accepts members exactly at the per-member and total caps (strict >, no off-by-one)', () => {
    // A single member of exactly MAX_PER_MEMBER must pass (boundary uses strict >, not >=).
    expect(() => assertWithinCaps([meta('big', MAX_PER_MEMBER)])).not.toThrow()
    // Total of exactly MAX_TOTAL_UNCOMPRESSED (two 2 GiB members) must also pass.
    expect(() => assertWithinCaps([meta('a', MAX_PER_MEMBER), meta('b', MAX_TOTAL_UNCOMPRESSED - MAX_PER_MEMBER)])).not.toThrow()
  })

  it('throws on corrupt zip bytes', () => {
    expect(() => extractMembers(strToU8('garbage'), () => true)).toThrow()
  })
})
