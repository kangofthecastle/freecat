// src/main/flashcards/media-protocol.ts
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { and, eq } from 'drizzle-orm'
import type { DB } from '../db/client'
import { media } from '../db/schema'
import { resolveMediaToken } from './media-tokens'

/** Closed extension→MIME allowlist. The Content-Type is derived ONLY from this map —
 *  the untrusted filename is never echoed into the response. */
export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac'
}

const HEX_RE = /^[0-9a-f]+$/

export interface ResolvedMedia { path: string; mime: string }

/** Authorize + locate one media file. Returns null for any failure (caller 404s). */
export async function resolveMedia(db: DB, mediaDir: string, token: string, filename: string): Promise<ResolvedMedia | null> {
  const deckSetId = resolveMediaToken(token)
  if (deckSetId === undefined) return null
  const [row] = await db.select({ hash: media.hash, ext: media.ext })
    .from(media).where(and(eq(media.deckSetId, deckSetId), eq(media.filename, filename)))
  if (!row) return null
  if (!HEX_RE.test(row.hash)) return null // poisoned hash → refuse (no traversal)
  const ext = row.ext.toLowerCase()
  const mime = MIME_BY_EXT[ext]
  if (!mime) return null // extension not on the allowlist
  return { path: join(mediaDir, `${row.hash}${ext}`), mime }
}

/** Build the protocol.handle handler. Reads only `request.url`, so it is unit-testable
 *  with a plain { url } object. Never throws — any failure becomes a 404. */
export function createMediaHandler(db: DB, mediaDir: string): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const token = url.hostname
      const filename = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!token || !filename) return new Response(null, { status: 404 })
      const resolved = await resolveMedia(db, mediaDir, token, filename)
      if (!resolved) return new Response(null, { status: 404 })
      const bytes = await readFile(resolved.path)
      return new Response(bytes, { status: 200, headers: { 'Content-Type': resolved.mime, 'Cache-Control': 'no-store' } })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
}
