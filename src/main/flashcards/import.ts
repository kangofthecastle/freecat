// src/main/flashcards/import.ts
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import type { DB } from '../db/client'
import type { DeckSetSummary, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import { readCentralDirectory } from './central-dir'
import { detectFormat } from './detect'
import { extractMembers, ImportTooLargeError, CorruptPackageError } from './zip'
import { parseLegacyCollection } from './parse-legacy'
import { storeMedia } from './media-store'
import { writeCollection } from './etl'

/** Import a deck package from a path into the db, persisting media under mediaDir. No dialog (unit-testable). */
export async function importFromFile(db: DB, filePath: string, mediaDir: string): Promise<ServiceResult<DeckSetSummary>> {
  let buf: Uint8Array
  try { buf = await readFile(filePath) } catch { return err('corrupt-package') }

  let entries
  try { entries = readCentralDirectory(buf) } catch { return err('corrupt-package') }
  const detected = detectFormat(entries)
  if (!detected) return err('unsupported-format')
  if (detected.format === 'latest') return err('unsupported-format') // modern .colpkg → Plan 3

  let members: Record<string, Uint8Array>
  try {
    members = extractMembers(buf, (n) => n === detected.collectionMember || n === 'media' || /^[0-9]+$/.test(n))
  } catch (e) {
    if (e instanceof ImportTooLargeError) return err('import-too-large')
    if (e instanceof CorruptPackageError) return err('corrupt-package')
    return err('corrupt-package')
  }
  const collectionBytes = members[detected.collectionMember]
  if (!collectionBytes) return err('corrupt-package')

  // Parse from a temp file (raw libsql needs a path); always clean it up.
  const tmpPath = join(tmpdir(), `fc-import-${randomUUID()}.anki2`)
  let parsed
  try {
    await writeFile(tmpPath, collectionBytes)
    parsed = await parseLegacyCollection(tmpPath)
  } catch {
    return err('corrupt-package')
  } finally {
    await unlink(tmpPath).catch(() => { /* ignore */ })
  }

  // Resolve numbered blobs → original filenames via the `media` JSON map, then store on disk.
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
  const stored = storeMedia(mediaDir, mediaFiles)

  const summary = await writeCollection(db, {
    sourceFilename: basename(filePath),
    sourceFormat: detected.format,
    parsed,
    media: stored
  })
  return ok(summary)
}

/** Electron wrapper: open dialog, then import the chosen file. */
export async function importViaDialog(db: DB, mediaDir: string): Promise<ServiceResult<DeckSetSummary>> {
  const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Anki deck', extensions: ['apkg', 'colpkg'] }] })
  const filePath = res.filePaths[0]
  if (res.canceled || !filePath) return err('invalid')
  return importFromFile(db, filePath, mediaDir)
}
