// test/flashcards/modern-media.test.ts
import { describe, it, expect } from 'vitest'
import { zstdCompressSync } from 'node:zlib'
import { parseModernMedia } from '../../src/main/flashcards/modern-media'
import { MediaEntries } from '../../src/main/flashcards/anki-proto'
import { ImportTooLargeError } from '../../src/main/flashcards/zip'
import { MAX_ZSTD_MANIFEST } from '../../src/main/flashcards/zstd'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)
const manifest = (names: string[]): Uint8Array =>
  new Uint8Array(zstdCompressSync(MediaEntries.encode({ entries: names.map((name) => ({ name })) }).finish()))

describe('parseModernMedia', () => {
  it('returns {} when there is no media member (media-less deck)', () => {
    expect(parseModernMedia({})).toEqual({})
    expect(parseModernMedia({ '0': bytes('x') })).toEqual({}) // blobs but no manifest
  })

  it('maps manifest index N to numbered blob "N" by original name', () => {
    const out = parseModernMedia({
      media: manifest(['a.png', 'b.jpg']),
      '0': bytes('AAA'),
      '1': bytes('BBB')
    })
    expect(new TextDecoder().decode(out['a.png']!)).toBe('AAA')
    expect(new TextDecoder().decode(out['b.jpg']!)).toBe('BBB')
    expect(Object.keys(out).sort()).toEqual(['a.png', 'b.jpg'])
  })

  it('omits an entry whose numbered blob member is absent', () => {
    const out = parseModernMedia({
      media: manifest(['present.png', 'missing.png']),
      '0': bytes('AAA') // blob "1" intentionally absent
    })
    expect(Object.keys(out)).toEqual(['present.png'])
  })

  it('throws ImportTooLargeError when the decompressed manifest exceeds the cap', () => {
    // Decompresses to ~86 MiB (> 64 MiB MAX_ZSTD_MANIFEST) but compresses tiny, so the capped
    // decompressor must bail rather than retain it.
    const big = MediaEntries.encode({ entries: Array.from({ length: 280_000 }, (_, i) => ({ name: `file-${i}-${'x'.repeat(300)}.png` })) }).finish()
    expect(big.length).toBeGreaterThan(MAX_ZSTD_MANIFEST)
    const compressed = new Uint8Array(zstdCompressSync(big))
    expect(() => parseModernMedia({ media: compressed })).toThrow(ImportTooLargeError)
  })
})
