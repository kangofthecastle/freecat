export interface ZipEntryMeta { name: string; compressedSize: number; uncompressedSize: number; localHeaderOffset: number }

const EOCD_SIG = 0x06054b50
const CDH_SIG = 0x02014b50
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50
const ZIP64_EOCD_SIG = 0x06064b50

/** Read a 64-bit little-endian unsigned int as a JS number (values here are bounded by the
 *  import caps well under 2^53, so number precision is sufficient). */
function readU64(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true)
  const hi = dv.getUint32(off + 4, true)
  return hi * 0x1_0000_0000 + lo
}

/** Parse a ZIP central directory for member names + sizes WITHOUT inflating any payload.
 *  Decodes the ZIP64 extra field (and ZIP64 EOCD record) so sentinel 0xFFFFFFFF/0xFFFF values
 *  resolve to their true 64-bit sizes/offsets/count — mirroring fflate's unzipSync. */
export function readCentralDirectory(buf: Uint8Array): ZipEntryMeta[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // Find the End Of Central Directory record, scanning back from the end (max comment 0xffff).
  let eocd = -1
  const minStart = Math.max(0, buf.length - (0xffff + 22))
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record')
  let count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)

  // ZIP64: when the entry count or CD offset is saturated, the real values live in the
  // ZIP64 EOCD record, located via the ZIP64 EOCD locator that precedes the EOCD.
  if (count === 0xffff || off === 0xffffffff) {
    const locator = eocd - 20
    if (locator >= 0 && dv.getUint32(locator, true) === ZIP64_EOCD_LOCATOR_SIG) {
      const z64eocd = readU64(dv, locator + 8)
      if (z64eocd + 56 <= buf.length && dv.getUint32(z64eocd, true) === ZIP64_EOCD_SIG) {
        count = readU64(dv, z64eocd + 32)
        off = readU64(dv, z64eocd + 48)
      }
    }
  }

  const dec = new TextDecoder()
  const entries: ZipEntryMeta[] = []
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || dv.getUint32(off, true) !== CDH_SIG) throw new Error('corrupt central directory')
    let compressedSize = dv.getUint32(off + 20, true)
    let uncompressedSize = dv.getUint32(off + 24, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    let localHeaderOffset = dv.getUint32(off + 42, true)
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen))

    // ZIP64 extra field (0x0001): replaces whichever of the four fields are saturated, in this
    // fixed order — uncompressed, compressed, local-header offset, disk-start (we ignore disk).
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      const extraStart = off + 46 + nameLen
      let p = extraStart
      const extraEnd = extraStart + extraLen
      while (p + 4 <= extraEnd) {
        const id = dv.getUint16(p, true)
        const size = dv.getUint16(p + 2, true)
        const body = p + 4
        if (id === 0x0001) {
          let q = body
          if (uncompressedSize === 0xffffffff && q + 8 <= body + size) { uncompressedSize = readU64(dv, q); q += 8 }
          if (compressedSize === 0xffffffff && q + 8 <= body + size) { compressedSize = readU64(dv, q); q += 8 }
          if (localHeaderOffset === 0xffffffff && q + 8 <= body + size) { localHeaderOffset = readU64(dv, q); q += 8 }
          break
        }
        p = body + size
      }
    }

    entries.push({ name, compressedSize, uncompressedSize, localHeaderOffset })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}
