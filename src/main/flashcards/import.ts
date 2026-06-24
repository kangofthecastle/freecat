// src/main/flashcards/import.ts
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import type { DB } from '../db/client'
import type { DeckSetSummary, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import type { ParsedCollection } from './parsed-collection'
import { readCentralDirectory } from './central-dir'
import { detectFormat } from './detect'
import { extractMembers, ImportTooLargeError, CorruptPackageError } from './zip'
import { parseLegacyCollection } from './parse-legacy'
import { parseModernCollection } from './parse-modern'
import { parseModernMedia } from './modern-media'
import { zstdDecompressCapped, MAX_ZSTD_COLLECTION } from './zstd'
import { storeMedia } from './media-store'
import { writeCollection } from './etl'

/** Legacy media: a JSON map of numbered-blob → original filename. */
function legacyMedia(members: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const mediaFiles: Record<string, Uint8Array> = {}
  const mediaJson = members['media']
  if (mediaJson) {
    try {
      const map = JSON.parse(new TextDecoder().decode(mediaJson)) as Record<string, string>
      for (const [num, name] of Object.entries(map)) {
        const blob = members[num]
        if (blob) mediaFiles[name] = blob
      }
    } catch { /* malformed media map → import without media rather than fail the whole deck */ }
  }
  return mediaFiles
}

/** Import a deck package from a path into the db, persisting media under mediaDir. No dialog (unit-testable). */
export async function importFromFile(db: DB, filePath: string, mediaDir: string): Promise<ServiceResult<DeckSetSummary>> {
  let buf: Uint8Array
  try { buf = await readFile(filePath) } catch { return err('corrupt-package') }

  let entries
  try { entries = readCentralDirectory(buf) } catch { return err('corrupt-package') }
  const detected = detectFormat(entries)
  if (!detected) return err('unsupported-format')
  const isModern = detected.format === 'latest'

  let members: Record<string, Uint8Array>
  try {
    members = extractMembers(buf, (n) => n === detected.collectionMember || n === 'media' || /^[0-9]+$/.test(n))
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    if (e instanceof CorruptPackageError) return err('corrupt-package')
    return err('corrupt-package')
  }

  const rawCollection = members[detected.collectionMember]
  if (!rawCollection) return err('corrupt-package')

  // Modern collections are a single zstd stream over the SQLite file; legacy are raw SQLite.
  let collectionBytes: Uint8Array
  try {
    collectionBytes = isModern ? zstdDecompressCapped(rawCollection, MAX_ZSTD_COLLECTION) : rawCollection
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    return err('corrupt-package')
  }

  // Parse from a temp file (raw libsql needs a path); always clean it up.
  const tmpPath = join(tmpdir(), `fc-import-${randomUUID()}.anki2`)
  let parsed: ParsedCollection
  try {
    await writeFile(tmpPath, collectionBytes)
    parsed = isModern ? await parseModernCollection(tmpPath) : await parseLegacyCollection(tmpPath)
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    return err('corrupt-package')
  } finally {
    await unlink(tmpPath).catch(() => { /* ignore */ })
  }

  // Resolve media (modern: protobuf manifest + raw blobs; legacy: JSON map), then store on disk.
  let mediaFiles: Record<string, Uint8Array>
  try {
    mediaFiles = isModern ? parseModernMedia(members) : legacyMedia(members)
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    mediaFiles = {} // a bad media manifest should not fail the whole deck
  }
  // Persist media to disk and write the collection. Both can throw (ENOSPC/EACCES from storeMedia's
  // sync fs calls; explicit throws / DB failures from writeCollection's transaction). Keep them inside
  // the envelope so import never rejects to the renderer (design spec: import 'never throws to renderer').
  try {
    const stored = storeMedia(mediaDir, mediaFiles)
    const summary = await writeCollection(db, {
      sourceFilename: basename(filePath),
      sourceFormat: detected.format,
      parsed,
      media: stored
    })
    return ok(summary)
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    return err('corrupt-package')
  }
}

/** Electron wrapper: open dialog, then import the chosen file. */
export async function importViaDialog(db: DB, mediaDir: string): Promise<ServiceResult<DeckSetSummary>> {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Anki deck', extensions: ['apkg', 'colpkg'] }] })
  const filePath = res.filePaths[0]
  if (res.canceled || !filePath) return err('invalid')
  return importFromFile(db, filePath, mediaDir)
}
