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
})
