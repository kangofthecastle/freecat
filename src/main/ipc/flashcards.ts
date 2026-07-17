import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { ok, err } from '../../shared/dto'
import type { CardView, ServiceResult } from '../../shared/dto'
import { importViaDialog } from '../flashcards/import'
import { listDeckSets, listDecks, listCards, deleteDeckSet, getCard } from '../repositories/flashcards'
import { reviewCounts, nextReviewCard, gradeReview, type NewCardOrder } from '../repositories/review'
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
  /** Fired after a successfully applied study write — main/index.ts wires the plan's debounced
   *  regeneration here (modules stay decoupled: this file knows a callback, not the Plan module). */
  onActivity?: () => void
  /** How to pick the next NEW card — main/index.ts wires the Plan module's `newCardOrder` setting
   *  here (same decoupling: a getter, not a plan-table read). Absent/throwing ⇒ 'deck'. */
  newCardOrder?: () => Promise<NewCardOrder>
}

/** getCard → mintMediaToken → toCardView, as one unit. Both browse (`fcGetCard`) and study
 *  (`fcNextReviewCard`) build their CardView through here, so the "review iframe and browse iframe are
 *  fed byte-for-byte the same shape" invariant is enforced by shared code, not a comment. */
async function buildCardView(db: DB, cardId: number): Promise<ServiceResult<CardView>> {
  const res = await getCard(db, cardId)
  if (!res.ok) return res
  const token = mintMediaToken(res.data.deckSetId)
  return ok(toCardView(res.data, token))
}

export function registerFlashcardsIpc(db: DB, opts: FlashcardsIpcOptions = {}): void {
  const now = opts.now ?? (() => new Date())
  ipcMain.handle(CH.fcImportDeck, () => importViaDialog(db, flashcardsMediaDir()))
  ipcMain.handle(CH.fcListDeckSets, () => listDeckSets(db))
  ipcMain.handle(CH.fcListDecks, (_e, raw: unknown) => listDecks(db, deckSetIdSchema.parse(raw)))
  ipcMain.handle(CH.fcListCards, (_e, raw: unknown) => listCards(db, listCardsSchema.parse(raw)))
  ipcMain.handle(CH.fcGetCard, (_e, raw: unknown) => buildCardView(db, getCardSchema.parse(raw)))
  ipcMain.handle(CH.fcDeleteDeckSet, (_e, raw: unknown) => deleteDeckSet(db, deckSetIdSchema.parse(raw), flashcardsMediaDir()))
  ipcMain.handle(CH.fcReviewCounts, async (_e, raw: unknown) => {
    const deckId = reviewDeckIdSchema.parse(raw)
    const counts = await reviewCounts(db, deckId, now())
    return counts === null ? err('deck-not-found') : ok(counts)
  })
  ipcMain.handle(CH.fcNextReviewCard, async (_e, raw: unknown) => {
    const deckId = reviewDeckIdSchema.parse(raw)
    // A broken settings read must never break the review queue — degrade to deck order.
    const order = await (opts.newCardOrder?.() ?? Promise.resolve<NewCardOrder>('deck')).catch(() => 'deck' as const)
    const next = await nextReviewCard(db, deckId, now(), order)
    if (next === null) return err('deck-not-found')
    if (next.done) return ok(next)
    // Same builder as fcGetCard, so media tokens / CSP behavior are identical to browse.
    const view = await buildCardView(db, next.cardId)
    if (!view.ok) return view
    return ok({ done: false as const, card: view.data, counts: next.counts, preview: next.preview })
  })
  ipcMain.handle(CH.fcReviewCard, async (_e, raw: unknown) => {
    const input = reviewCardSchema.parse(raw)
    const result = await gradeReview(db, input.cardId, input.rating, now())
    if (result.ok) opts.onActivity?.() // plan re-materializes off study writes (debounced upstream)
    return result
  })
}
