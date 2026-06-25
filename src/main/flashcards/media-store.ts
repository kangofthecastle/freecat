import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

export interface StoredMedia { hash: string; ext: string }

/** Write each blob to <mediaDir>/<sha1><ext>, deduped by content hash. Returns originalFilename → {hash, ext}. */
export function storeMedia(mediaDir: string, files: Record<string, Uint8Array>): Record<string, StoredMedia> {
  mkdirSync(mediaDir, { recursive: true })
  const map: Record<string, StoredMedia> = {}
  for (const [filename, bytes] of Object.entries(files)) {
    const hash = createHash('sha1').update(bytes).digest('hex')
    const ext = extname(filename).toLowerCase()
    const dest = join(mediaDir, `${hash}${ext}`)
    if (!existsSync(dest)) writeFileSync(dest, bytes)
    map[filename] = { hash, ext }
  }
  return map
}
