import { unzipSync } from 'fflate'
import { readCentralDirectory, type ZipEntryMeta } from './central-dir'

export const MAX_TOTAL_UNCOMPRESSED = 4 * 1024 * 1024 * 1024 // 4 GiB
export const MAX_MEMBERS = 100_000
export const MAX_PER_MEMBER = 2 * 1024 * 1024 * 1024          // 2 GiB
/** On-disk ceiling for the archive we read into memory at all (A1 precheck via stat, before readFile). */
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024       // 2 GiB

export class ImportTooLargeError extends Error {}
export class CorruptPackageError extends Error {}

/** Reject zip-bomb shapes using central-directory sizes only (no inflation). */
export function assertWithinCaps(entries: ZipEntryMeta[]): void {
  if (entries.length > MAX_MEMBERS) throw new ImportTooLargeError('too many members')
  let total = 0
  for (const e of entries) {
    if (e.uncompressedSize > MAX_PER_MEMBER) throw new ImportTooLargeError(`member ${e.name} too large`)
    total += e.uncompressedSize
    if (total > MAX_TOTAL_UNCOMPRESSED) throw new ImportTooLargeError('archive too large')
  }
}

/** Validate caps, then inflate ONLY the members for which `wanted(name)` is true. */
export function extractMembers(buf: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  let entries: ZipEntryMeta[]
  try { entries = readCentralDirectory(buf) } catch (e) { throw new CorruptPackageError(String(e)) }
  assertWithinCaps(entries)
  try {
    // fflate only decompresses files whose filter returns true; fflate validates CRC/size and throws on corruption.
    return unzipSync(buf, { filter: (f) => wanted(f.name) })
  } catch (e) {
    if (e instanceof ImportTooLargeError) throw e
    throw new CorruptPackageError(String(e))
  }
}
