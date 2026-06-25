// src/main/flashcards/paths.ts
import { join } from 'node:path'
import { app } from 'electron'

/** Where content-addressed media blobs live: <userData>/flashcards/media. */
export function flashcardsMediaDir(): string {
  return join(app.getPath('userData'), 'flashcards', 'media')
}
