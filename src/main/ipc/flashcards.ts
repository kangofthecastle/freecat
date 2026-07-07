import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { ok, err } from '../../shared/dto'
import { importViaDialog } from '../flashcards/import'
import { listDeckSets, listDecks, listCards, deleteDeckSet, getCard } from '../repositories/flashcards'
import { reviewCounts, nextReviewCard, gradeReview } from '../repositories/review'
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
export const reviewDeckIdSchema = z.number().int().positive()
export const reviewCardSchema = z.object({
  cardId: z.number().int().positive(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
})

export interface FlashcardsIpcOptions {
  /** Injected clock for testability; defaults to wall-clock. Mirrors QbankIpcOptions. */
  now?: () => Date
}

export function registerFlashcardsIpc(db: DB, opts: FlashcardsIpcOptions = {}): void {
  const now = opts.now ?? (() => new Date())
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
  ipcMain.handle(CH.fcReviewCounts, async (_e, raw: unknown) => {
    const deckId = reviewDeckIdSchema.parse(raw)
    const counts = await reviewCounts(db, deckId, now())
    return counts === null ? err('deck-not-found') : ok(counts)
  })
  ipcMain.handle(CH.fcNextReviewCard, async (_e, raw: unknown) => {
    const deckId = reviewDeckIdSchema.parse(raw)
    const next = await nextReviewCard(db, deckId, now())
    if (next === null) return err('deck-not-found')
    if (next.done) return ok(next)
    // Build the CardView exactly as fcGetCard does (getCard → mintMediaToken → toCardView) so media
    // tokens / CSP behavior are identical to browse — the review iframe and the browse iframe are fed
    // byte-for-byte the same shape.
    const res = await getCard(db, next.cardId)
    if (!res.ok) return res
    const token = mintMediaToken(res.data.deckSetId)
    return ok({ done: false as const, card: toCardView(res.data, token), counts: next.counts, preview: next.preview })
  })
  ipcMain.handle(CH.fcReviewCard, (_e, raw: unknown) => {
    const input = reviewCardSchema.parse(raw)
    return gradeReview(db, input.cardId, input.rating, now())
  })
}
