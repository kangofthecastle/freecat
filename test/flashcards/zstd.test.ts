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
})
