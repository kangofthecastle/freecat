import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { readCentralDirectory } from '../../src/main/flashcards/central-dir'

describe('readCentralDirectory', () => {
  it('lists member names + uncompressed sizes without inflating', () => {
    const payload = strToU8('hello world')                 // 11 bytes
    const zip = zipSync({ 'meta': strToU8('m'), 'collection.anki2': payload, '0': strToU8('img') })
    const entries = readCentralDirectory(zip)
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.uncompressedSize]))
    expect(Object.keys(byName).sort()).toEqual(['0', 'collection.anki2', 'meta'])
    expect(byName['collection.anki2']).toBe(11)
  })

  it('throws on non-zip input', () => {
    expect(() => readCentralDirectory(strToU8('not a zip at all'))).toThrow()
  })

  // Hand-build a minimal ZIP64 central directory: one CD header whose 32-bit uncompressedSize is
  // the 0xFFFFFFFF sentinel, with a 0x0001 extra field carrying the true 64-bit size, plus a
  // ZIP64 EOCD record + locator (the count in the classic EOCD is the 0xFFFF sentinel). fflate's
  // zipSync never emits ZIP64, so we synthesize the bytes to pin the decode.
  it('decodes the ZIP64 extra field (and EOCD record) instead of the 0xFFFFFFFF/0xFFFF sentinels', () => {
    const name = 'collection.anki21b'
    const nameBytes = strToU8(name)
    const realSize = 5_000_000_000 // > 4 GiB → cannot be represented in 32 bits

    // ZIP64 extra field: header 0x0001, body = uncompressed(8) + compressed(8).
    const extra = new Uint8Array(4 + 16)
    const edv = new DataView(extra.buffer)
    edv.setUint16(0, 0x0001, true); edv.setUint16(2, 16, true)
    edv.setUint32(4, realSize % 0x1_0000_0000, true); edv.setUint32(8, Math.floor(realSize / 0x1_0000_0000), true)
    edv.setUint32(12, 1234, true); edv.setUint32(16, 0, true) // compressed = 1234

    const cdh = new Uint8Array(46 + nameBytes.length + extra.length)
    const cdv = new DataView(cdh.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint32(20, 0xffffffff, true) // compressedSize sentinel
    cdv.setUint32(24, 0xffffffff, true) // uncompressedSize sentinel
    cdv.setUint16(28, nameBytes.length, true)
    cdv.setUint16(30, extra.length, true)
    cdv.setUint32(42, 0, true) // local header offset (not saturated)
    cdh.set(nameBytes, 46)
    cdh.set(extra, 46 + nameBytes.length)

    const z64eocd = new Uint8Array(56)
    const zdv = new DataView(z64eocd.buffer)
    zdv.setUint32(0, 0x06064b50, true)
    zdv.setUint32(32, 1, true); zdv.setUint32(36, 0, true) // total entries on disk = 1
    zdv.setUint32(40, 1, true); zdv.setUint32(44, 0, true) // total entries = 1

    const locator = new Uint8Array(20)
    const ldv = new DataView(locator.buffer)
    ldv.setUint32(0, 0x07064b50, true)
    // z64eocd starts right after the CD header (offset 0 + cdh.length)
    ldv.setUint32(8, cdh.length, true); ldv.setUint32(12, 0, true)

    const eocd = new Uint8Array(22)
    const odv = new DataView(eocd.buffer)
    odv.setUint32(0, 0x06054b50, true)
    odv.setUint16(10, 0xffff, true) // entries-on-this-disk sentinel → forces ZIP64 EOCD lookup
    odv.setUint32(16, 0, true)      // CD offset = 0

    const buf = new Uint8Array(cdh.length + z64eocd.length + locator.length + eocd.length)
    buf.set(cdh, 0)
    buf.set(z64eocd, cdh.length)
    buf.set(locator, cdh.length + z64eocd.length)
    buf.set(eocd, cdh.length + z64eocd.length + locator.length)

    const entries = readCentralDirectory(buf)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe(name)
    expect(entries[0]?.uncompressedSize).toBe(realSize) // resolved 64-bit value, not 0xFFFFFFFF
    expect(entries[0]?.compressedSize).toBe(1234)
  })
})
