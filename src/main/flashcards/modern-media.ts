// src/main/flashcards/modern-media.ts
import { MediaEntries } from './anki-proto'
import { zstdDecompressCapped, MAX_ZSTD_MANIFEST } from './zstd'

/**
 * Resolve modern media: the `media` member is a zstd-compressed protobuf manifest; entry
 * index N maps to the (raw, uncompressed) numbered ZIP member "N". Returns originalName → bytes.
 */
export function parseModernMedia(members: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const manifest = members['media']
  if (!manifest) return {}
  const decoded = zstdDecompressCapped(manifest, MAX_ZSTD_MANIFEST)
  const entries = (MediaEntries.decode(decoded) as unknown as { entries?: { name?: string }[] }).entries ?? []
  const out: Record<string, Uint8Array> = {}
  entries.forEach((entry, i) => {
    const blob = members[String(i)]
    if (blob && entry.name) out[entry.name] = blob
  })
  return out
}
