import { describe, it, expect, beforeEach, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { writeCollection } from '../../src/main/flashcards/etl'
import { cards, decks, cardScheduling, reviewLog } from '../../src/main/db/schema'
import {
  deckSubtreeIds, reviewCounts, nextReviewCard, gradeReview, NEW_PER_DAY, LEARN_AHEAD_MS
} from '../../src/main/repositories/review'
import { State, Rating } from '../../src/main/flashcards/fsrs'
import { ok } from '../../src/shared/dto'
import type { ActivityResult, ServiceResult } from '../../src/shared/dto'
import type { ParsedCollection, ParsedNoteType, ParsedCard } from '../../src/main/flashcards/parsed-collection'

const T0 = new Date('2026-07-07T12:00:00.000Z')
const plus = (base: Date, ms: number): Date => new Date(base.getTime() + ms)
const DAY_MS = 24 * 60 * 60 * 1000

const basicNT: ParsedNoteType = {
  ankiId: 1, name: 'Basic', kind: 'standard', css: '',
  fields: [{ ord: 0, name: 'Front' }], templates: [{ ord: 0, name: 'C', qfmt: '{{Front}}', afmt: '{{Front}}' }]
}
// Image Occlusion → renderKind 'image-occlusion' (not reviewable).
const ioNT: ParsedNoteType = {
  ankiId: 2, name: 'Image Occlusion', kind: 'standard', css: '',
  fields: [{ ord: 0, name: 'Image' }, { ord: 1, name: 'Occlusion' }],
  templates: [{ ord: 0, name: 'IO', qfmt: '{{Image}}', afmt: '{{Image}}' }]
}

/** Build a one-note-per-card collection. `cardsSpec` picks each card's deck + note type. */
function collection(opts: {
  noteTypes: ParsedNoteType[]
  decks: { ankiId: number; name: string }[]
  cardsSpec: { deckAnkiId: number; noteTypeAnkiId: number }[]
}): ParsedCollection {
  const notes = opts.cardsSpec.map((c, i) => ({
    ankiId: 100 + i, guid: `g${i}`, noteTypeAnkiId: c.noteTypeAnkiId, fields: [`Q${i}`], tags: [], sortField: `Q${i}`
  }))
  const parsedCards: ParsedCard[] = opts.cardsSpec.map((c, i) => ({ noteAnkiId: 100 + i, deckAnkiId: c.deckAnkiId, ord: 0 }))
  return { noteTypes: opts.noteTypes, decks: opts.decks, notes, cards: parsedCards }
}

async function deckIdByName(db: DB, name: string): Promise<number> {
  const [d] = await db.select({ id: decks.id }).from(decks).where(eq(decks.name, name))
  if (!d) throw new Error(`no deck ${name}`)
  return d.id
}
async function cardIds(db: DB): Promise<number[]> {
  const rows = await db.select({ id: cards.id }).from(cards).orderBy(asc(cards.id))
  return rows.map((r) => r.id)
}

// A recordActivity stand-in that always succeeds, so we can spy on invocation without touching
// the gamification schema.
const activityStub: ActivityResult = { streak: 1, daily: { count: 1, goal: 10, met: false }, eggBecameReady: false, goalJustMet: false }
function activitySpy(): (db: DB, p: { kind: string; now?: Date }) => Promise<ServiceResult<ActivityResult>> {
  return vi.fn(async () => ok(activityStub))
}

let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('review repository', () => {
  it('deckSubtreeIds returns the deck and all descendants; null for a missing deck', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({
        noteTypes: [basicNT],
        decks: [{ ankiId: 1, name: 'MCAT' }, { ankiId: 2, name: 'MCAT::Bio' }, { ankiId: 3, name: 'MCAT::Bio::Cell' }, { ankiId: 4, name: 'Other' }],
        cardsSpec: [{ deckAnkiId: 3, noteTypeAnkiId: 1 }]
      })
    })
    const mcat = await deckIdByName(db, 'MCAT')
    const cell = await deckIdByName(db, 'MCAT::Bio::Cell')
    const sub = await deckSubtreeIds(db, mcat)
    expect(sub).not.toBeNull()
    expect(new Set(sub!)).toEqual(new Set([mcat, await deckIdByName(db, 'MCAT::Bio'), cell]))
    expect(sub).not.toContain(await deckIdByName(db, 'Other'))
    expect(await deckSubtreeIds(db, 999999)).toBeNull()
  })

  it('studying a parent deck pulls cards from its subdecks (subtree scoping)', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({
        noteTypes: [basicNT],
        decks: [{ ankiId: 1, name: 'MCAT' }, { ankiId: 2, name: 'MCAT::Bio' }],
        cardsSpec: [{ deckAnkiId: 2, noteTypeAnkiId: 1 }, { deckAnkiId: 2, noteTypeAnkiId: 1 }]
      })
    })
    const mcat = await deckIdByName(db, 'MCAT') // parent has NO cards of its own
    const counts = await reviewCounts(db, mcat, T0)
    expect(counts).toEqual({ newRemaining: 2, learning: 0, due: 0 })
    const next = await nextReviewCard(db, mcat, T0)
    expect(next?.done).toBe(false)
  })

  it('excludes non-renderable cards (image-occlusion) from counts and queue', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({
        noteTypes: [basicNT, ioNT],
        decks: [{ ankiId: 1, name: 'D' }],
        cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 1 }, { deckAnkiId: 1, noteTypeAnkiId: 2 }]
      })
    })
    const d = await deckIdByName(db, 'D')
    const counts = await reviewCounts(db, d, T0)
    expect(counts?.newRemaining).toBe(1) // only the basic card counts
    // The IO card must never be served — grade the one reviewable card, then we're done.
    const first = await nextReviewCard(db, d, T0)
    expect(first?.done).toBe(false)
    if (first && !first.done) await gradeReview(db, first.cardId, Rating.Easy, T0)
    const after = await nextReviewCard(db, d, T0)
    expect(after?.done).toBe(true) // the IO card is not offered
  })

  it('serves the queue in priority order: learning-due → review-due → new', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({
        noteTypes: [basicNT], decks: [{ ankiId: 1, name: 'D' }],
        cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 1 }, { deckAnkiId: 1, noteTypeAnkiId: 1 }, { deckAnkiId: 1, noteTypeAnkiId: 1 }]
      })
    })
    const d = await deckIdByName(db, 'D')
    const [a, b, c] = await cardIds(db)
    // a → Learning (due T0+10m). b → Review (Good, Good). c stays new.
    await gradeReview(db, a!, Rating.Good, T0)
    await gradeReview(db, b!, Rating.Good, T0)
    const [bRow] = await db.select().from(cardScheduling).where(eq(cardScheduling.cardId, b!))
    await gradeReview(db, b!, Rating.Good, bRow!.due) // graduate b to Review
    expect((await db.select().from(cardScheduling).where(eq(cardScheduling.cardId, b!)))[0]!.state).toBe(State.Review)

    const T = plus(T0, 3 * DAY_MS) // both a (learning) and b (review) are due; c is new
    const n1 = await nextReviewCard(db, d, T)
    expect(n1 && !n1.done && n1.cardId).toBe(a) // learning-due wins
    await gradeReview(db, a!, Rating.Easy, T) // graduate a out of the window

    const n2 = await nextReviewCard(db, d, T)
    expect(n2 && !n2.done && n2.cardId).toBe(b) // review-due beats new
    await gradeReview(db, b!, Rating.Easy, T)

    const n3 = await nextReviewCard(db, d, T)
    expect(n3 && !n3.done && n3.cardId).toBe(c) // finally the new card
  })

  it('caps new cards at NEW_PER_DAY per day, then frees them the next day', async () => {
    const n = NEW_PER_DAY + 1 // 21
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({
        noteTypes: [basicNT], decks: [{ ankiId: 1, name: 'D' }],
        cardsSpec: Array.from({ length: n }, () => ({ deckAnkiId: 1, noteTypeAnkiId: 1 }))
      })
    })
    const d = await deckIdByName(db, 'D')
    // Introduce 20 today (Easy → Review far in the future, so they don't crowd the queue).
    for (let i = 0; i < NEW_PER_DAY; i++) {
      const next = await nextReviewCard(db, d, T0)
      expect(next && !next.done).toBeTruthy()
      if (next && !next.done) await gradeReview(db, next.cardId, Rating.Easy, T0)
    }
    expect((await reviewCounts(db, d, T0))?.newRemaining).toBe(0)
    const done = await nextReviewCard(db, d, T0)
    expect(done?.done).toBe(true) // 21st refused today (nothing else actionable)

    const tomorrow = plus(T0, DAY_MS)
    expect((await reviewCounts(db, d, tomorrow))?.newRemaining).toBe(1)
    const n2 = await nextReviewCard(db, d, tomorrow)
    expect(n2?.done).toBe(false) // the 21st is available on the new day
  })

  it('learn-ahead serves a soon-due learning card when nothing is strictly actionable', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({ noteTypes: [basicNT], decks: [{ ankiId: 1, name: 'D' }], cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 1 }] })
    })
    const d = await deckIdByName(db, 'D')
    const [only] = await cardIds(db)
    await gradeReview(db, only!, Rating.Good, T0) // → Learning, due T0+10m (inside the 20m window)
    const [row] = await db.select().from(cardScheduling).where(eq(cardScheduling.cardId, only!))
    expect(row!.due.getTime()).toBeLessThanOrEqual(T0.getTime() + LEARN_AHEAD_MS)
    // At T0 the card is not strictly due and no new remain, but learn-ahead serves it early.
    const next = await nextReviewCard(db, d, T0)
    expect(next && !next.done && next.cardId).toBe(only)
  })

  it('counts learning independent of due, and due only once the interval elapses', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({ noteTypes: [basicNT], decks: [{ ankiId: 1, name: 'D' }], cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 1 }] })
    })
    const d = await deckIdByName(db, 'D')
    const [only] = await cardIds(db)
    await gradeReview(db, only!, Rating.Good, T0)
    expect(await reviewCounts(db, d, T0)).toMatchObject({ learning: 1, due: 0 })
    const [row] = await db.select().from(cardScheduling).where(eq(cardScheduling.cardId, only!))
    await gradeReview(db, only!, Rating.Good, row!.due) // graduate → Review
    const graduated = (await db.select().from(cardScheduling).where(eq(cardScheduling.cardId, only!)))[0]!
    expect(graduated.state).toBe(State.Review)
    expect(await reviewCounts(db, d, row!.due)).toMatchObject({ learning: 0, due: 0 }) // review not yet due
    expect(await reviewCounts(db, d, plus(graduated.due, DAY_MS))).toMatchObject({ due: 1 })
  })

  it('rejects a double-submit as not-due and does NOT re-award gamification', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({ noteTypes: [basicNT], decks: [{ ankiId: 1, name: 'D' }], cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 1 }] })
    })
    const [only] = await cardIds(db)
    const spy = activitySpy()
    // Easy pushes due days out (past the learn-ahead window), so the replayed submit is not actionable.
    const first = await gradeReview(db, only!, Rating.Easy, T0, { recordActivityFn: spy })
    expect(first.ok).toBe(true)
    const second = await gradeReview(db, only!, Rating.Easy, T0, { recordActivityFn: spy })
    expect(second).toEqual({ ok: false, error: 'not-due' })
    expect(spy).toHaveBeenCalledTimes(1) // only the applied review credited activity
  })

  it('gradeReview: card-not-found and not-reviewable rejections skip the DB and gamification', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({ noteTypes: [ioNT], decks: [{ ankiId: 1, name: 'D' }], cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 2 }] })
    })
    const [io] = await cardIds(db)
    const spy = activitySpy()
    expect(await gradeReview(db, 999999, Rating.Good, T0, { recordActivityFn: spy })).toEqual({ ok: false, error: 'card-not-found' })
    expect(await gradeReview(db, io!, Rating.Good, T0, { recordActivityFn: spy })).toEqual({ ok: false, error: 'not-reviewable' })
    expect(spy).not.toHaveBeenCalled()
    expect(await db.select().from(cardScheduling)).toHaveLength(0)
    expect(await db.select().from(reviewLog)).toHaveLength(0)
  })

  it('writes a review_log row and credits gamification once per applied review', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({ noteTypes: [basicNT], decks: [{ ankiId: 1, name: 'D' }], cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 1 }] })
    })
    const [only] = await cardIds(db)
    const spy = activitySpy()
    const res = await gradeReview(db, only!, Rating.Good, T0, { recordActivityFn: spy })
    expect(res).toEqual({ ok: true, data: { activity: activityStub } })
    expect(spy).toHaveBeenCalledTimes(1)
    const logs = await db.select().from(reviewLog).where(eq(reviewLog.cardId, only!))
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ rating: Rating.Good, stateBefore: State.New })
  })

  it('gamification failure never fails the review (activity: null)', async () => {
    await writeCollection(db, {
      sourceFilename: 'a.apkg', sourceFormat: 'legacy1',
      parsed: collection({ noteTypes: [basicNT], decks: [{ ankiId: 1, name: 'D' }], cardsSpec: [{ deckAnkiId: 1, noteTypeAnkiId: 1 }] })
    })
    const [only] = await cardIds(db)
    const throwing = vi.fn(async () => { throw new Error('boom') })
    const res = await gradeReview(db, only!, Rating.Good, T0, { recordActivityFn: throwing })
    expect(res).toEqual({ ok: true, data: { activity: null } })
    expect((await db.select().from(cardScheduling))).toHaveLength(1) // the review still persisted
  })

  it('reviewCounts / nextReviewCard return null for a missing deck', async () => {
    expect(await reviewCounts(db, 999999, T0)).toBeNull()
    expect(await nextReviewCard(db, 999999, T0)).toBeNull()
  })
})
