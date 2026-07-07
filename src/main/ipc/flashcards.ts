import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { ok } from '../../shared/dto'
import { importViaDialog } from '../flashcards/import'
import { listDeckSets, listDecks, listCards, deleteDeckSet, getCard } from '../repositories/flashcards'
import { flashcardsMediaDir } from '../flashcards/paths'
import { mintMediaToken } from '../flashcards/media-tokens'
import { toCardView } from '../flashcards/card-view'

export const deckSetIdSchema = z.number().int().positive()
export const listCardsSchema = z.object({
  deckId: z.number().int().positive(),
  afterId: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(200).optional()
})
export const getCardSchema = z.number().int().positive()

export function registerFlashcardsIpc(db: DB): void {
  ipcMain.handle(CH.fcImportDeck, () => importViaDialog(db, flashcardsMediaDir()))
  ipcMain.handle(CH.fcListDeckSets, () => listDeckSets(db))
  ipcMain.handle(CH.fcListDecks, (_e, raw: unknown) => listDecks(db, deckSetIdSchema.parse(raw)))
  ipcMain.handle(CH.fcListCards, (_e, raw: unknown) => listCards(db, listCardsSchema.parse(raw)))
  ipcMain.handle(CH.fcGetCard, async (_e, raw: unknown) => {
    const id = getCardSchema.parse(raw)
    const res = await getCard(db, id)
    if (!res.ok) return res
    const token = mintMediaToken(res.data.deckSetId)
    return ok(toCardView(res.data, token))
  })
  ipcMain.handle(CH.fcDeleteDeckSet, (_e, raw: unknown) => deleteDeckSet(db, deckSetIdSchema.parse(raw), flashcardsMediaDir()))
}
