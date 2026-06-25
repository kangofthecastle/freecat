// test/flashcards/zstd.test.ts
import { describe, it, expect } from 'vitest'
import { zstdCompressSync } from 'node:zlib'
import { zstdDecompressCapped } from '../../src/main/flashcards/zstd'
import { ImportTooLargeError } from '../../src/main/flashcards/zip'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('zstdDecompressCapped', () => {
  it('round-trips data under the cap', () => {
    const original = bytes('hello '.repeat(1000))
    const compressed = new Uint8Array(zstdCompressSync(original))
    const out = zstdDecompressCapped(compressed, 1024 * 1024)
    expect(out).toEqual(original)
  })

  it('throws ImportTooLargeError when output exceeds the cap', () => {
    const original = bytes('x'.repeat(5000))
    const compressed = new Uint8Array(zstdCompressSync(original))
    expect(() => zstdDecompressCapped(compressed, 100)).toThrow(ImportTooLargeError)
  })

  it('accepts output of EXACTLY the cap (strict >, not >=)', () => {
    // Boundary: an at-cap collection must pass. A flip to `>=` would silently reject valid decks.
    const original = bytes('y'.repeat(4096))
    const compressed = new Uint8Array(zstdCompressSync(original))
    const out = zstdDecompressCapped(compressed, original.length) // cap == decompressed length
    expect(out).toEqual(original)
  })

  it('throws on corrupt/garbage zstd input (import.ts maps this throw → corrupt-package)', () => {
    // import.ts relies on this throwing for non-zstd bytes; pin fzstd's throw-on-garbage path.
    expect(() => zstdDecompressCapped(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 1024 * 1024)).toThrow()
  })
})
