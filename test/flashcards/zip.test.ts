import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractMembers, assertWithinCaps, ImportTooLargeError, CorruptPackageError, MAX_PER_MEMBER, MAX_TOTAL_UNCOMPRESSED } from '../../src/main/flashcards/zip'
import { readCentralDirectory, type ZipEntryMeta } from '../../src/main/flashcards/central-dir'

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

  it('throws CorruptPackageError (not ImportTooLargeError) on garbage zip bytes', () => {
    // Distinguish the two failure modes: import.ts maps CorruptPackageError → 'corrupt-package' and
    // ImportTooLargeError → 'import-too-large'. Garbage (no central directory) is the corrupt case.
    expect(() => extractMembers(strToU8('garbage'), () => true)).toThrow(CorruptPackageError)
  })

  it('throws CorruptPackageError when the central dir is valid but a wanted member payload is corrupt', () => {
    // Valid central directory (readCentralDirectory succeeds), but the member's deflate payload is
    // overwritten with garbage so fflate's unzipSync rejects mid-inflate → the unzipSync catch path.
    const payload = 'A'.repeat(200) // compressible, so there is a deflate stream to corrupt
    const zip = zipSync({ 'collection.anki2': strToU8(payload) })
    const [entry] = readCentralDirectory(zip)
    if (!entry) throw new Error('no entry')
    expect(entry.localHeaderOffset).toBe(0)
    // Local file header is 30 bytes + filename; the compressed payload follows it.
    const payloadStart = 30 + 'collection.anki2'.length
    const tampered = new Uint8Array(zip)
    for (let k = 0; k < entry.compressedSize; k++) tampered[payloadStart + k] = 0xff
    // Sanity: the central directory still parses (we only touched the payload region).
    expect(readCentralDirectory(tampered).map((e) => e.name)).toEqual(['collection.anki2'])
    expect(() => extractMembers(tampered, (n) => n === 'collection.anki2')).toThrow(CorruptPackageError)
  })
})
