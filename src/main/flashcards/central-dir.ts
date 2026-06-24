export interface ZipEntryMeta { name: string; compressedSize: number; uncompressedSize: number; localHeaderOffset: number }

const EOCD_SIG = 0x06054b50
const CDH_SIG = 0x02014b50

/** Parse a ZIP central directory for member names + sizes WITHOUT inflating any payload. */
export function readCentralDirectory(buf: Uint8Array): ZipEntryMeta[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // Find the End Of Central Directory record, scanning back from the end (max comment 0xffff).
  let eocd = -1
  const minStart = Math.max(0, buf.length - (0xffff + 22))
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record')
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const entries: ZipEntryMeta[] = []
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || dv.getUint32(off, true) !== CDH_SIG) throw new Error('corrupt central directory')
    const compressedSize = dv.getUint32(off + 20, true)
    const uncompressedSize = dv.getUint32(off + 24, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const localHeaderOffset = dv.getUint32(off + 42, true)
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen))
    entries.push({ name, compressedSize, uncompressedSize, localHeaderOffset })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}
