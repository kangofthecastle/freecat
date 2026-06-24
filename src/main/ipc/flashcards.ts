import { ipcMain, app } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { importViaDialog } from '../flashcards/import'
import { listDeckSets, listDecks, listCards, deleteDeckSet } from '../repositories/flashcards'

export const deckSetIdSchema = z.number().int().positive()
export const listCardsSchema = z.object({
  deckId: z.number().int().positive(),
  afterId: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(200).optional()
})

function mediaDir(): string { return join(app.getPath('userData'), 'flashcards', 'media') }

export function registerFlashcardsIpc(db: DB): void {
  ipcMain.handle(CH.fcImportDeck, () => importViaDialog(db, mediaDir()))
  ipcMain.handle(CH.fcListDeckSets, () => listDeckSets(db))
  ipcMain.handle(CH.fcListDecks, (_e, raw: unknown) => listDecks(db, deckSetIdSchema.parse(raw)))
  ipcMain.handle(CH.fcListCards, (_e, raw: unknown) => listCards(db, listCardsSchema.parse(raw)))
  ipcMain.handle(CH.fcDeleteDeckSet, (_e, raw: unknown) => deleteDeckSet(db, deckSetIdSchema.parse(raw)))
}
