// src/main/flashcards/zstd.ts
import { Decompress } from 'fzstd'
import { ImportTooLargeError } from './zip'

export const MAX_ZSTD_COLLECTION = 2 * 1024 * 1024 * 1024 // 2 GiB decompressed SQLite
export const MAX_ZSTD_MANIFEST = 64 * 1024 * 1024          // 64 MiB media manifest

/**
 * Decompress a complete zstd buffer, refusing to retain more than `cap` output bytes.
 * fzstd has no abort signal, so we stop accumulating once the cap is passed and throw
 * after the push completes (input size is already bounded by the ZIP caps).
 */
export function zstdDecompressCapped(input: Uint8Array, cap: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  let exceeded = false
  const stream = new Decompress((chunk) => {
    if (exceeded) return
    if (total + chunk.length > cap) { exceeded = true; return }
    total += chunk.length
    chunks.push(chunk)
  })
  stream.push(input, true)
  if (exceeded) throw new ImportTooLargeError('zstd output exceeds cap')
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}
