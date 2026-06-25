import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { randomUUID } from 'node:crypto'; import { rmSync, readdirSync } from 'node:fs'
import { strToU8 } from 'fflate'
import { storeMedia } from '../../src/main/flashcards/media-store'

let dir: string
beforeEach(() => { dir = join(tmpdir(), `fc-media-${randomUUID()}`) })
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('storeMedia', () => {
  it('writes hash-named files and maps original filename → {hash, ext}', () => {
    const map = storeMedia(dir, { 'pic.png': strToU8('PNGDATA'), 'sound.mp3': strToU8('MP3DATA') })
    expect(map['pic.png']?.ext).toBe('.png')
    expect(map['pic.png']?.hash).toMatch(/^[0-9a-f]{40}$/)
    const files = readdirSync(dir)
    expect(files).toContain(`${map['pic.png']!.hash}.png`)
    expect(files).toHaveLength(2)
  })

  it('dedups identical bytes to a single file', () => {
    const map = storeMedia(dir, { 'a.png': strToU8('SAME'), 'b.png': strToU8('SAME') })
    expect(map['a.png']?.hash).toBe(map['b.png']?.hash)
    expect(readdirSync(dir)).toHaveLength(1)
  })
})
