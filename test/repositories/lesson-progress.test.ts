import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { getState } from '../../src/main/repositories/gamification-state'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'
import {
  markViewed, setCompleted, completeLesson, getAllProgress, getProgressForSlug
} from '../../src/main/repositories/lesson-progress'

const SLUG = 'biochem.enzymes'
let db: DB
beforeEach(async () => {
  db = await createTestDb()
})

describe('lesson-progress repository', () => {
  it('markViewed creates then updates a row', async () => {
    await markViewed(db, SLUG)
    const first = await getProgressForSlug(db, SLUG)
    expect(first?.completedAt).toBeNull()
    await markViewed(db, SLUG)
    expect(await getAllProgress(db)).toHaveLength(1)
  })

  it('setCompleted sets completedAt and reports newlyCompleted once', async () => {
    const a = await setCompleted(db, SLUG, true)
    expect(a.newlyCompleted).toBe(true)
    const b = await setCompleted(db, SLUG, true)
    expect(b.newlyCompleted).toBe(false)
  })

  it('un-completing clears completedAt but never re-grants on re-complete', async () => {
    await setCompleted(db, SLUG, true)
    await setCompleted(db, SLUG, false)
    const row = await getProgressForSlug(db, SLUG)
    expect(row?.completedAt).toBeNull()
    const again = await setCompleted(db, SLUG, true)
    expect(again.newlyCompleted).toBe(false)
  })

  it('markViewed does not clobber completion', async () => {
    await setCompleted(db, SLUG, true)
    await markViewed(db, SLUG)
    const row = await getProgressForSlug(db, SLUG)
    expect(row?.completedAt).not.toBeNull()
    expect(row?.countedForReward).toBe(true)
  })

  it('completeLesson credits gamification exactly once', async () => {
    const r1 = await completeLesson(db, SLUG)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.data.status).toBe('completed')
      expect(r1.data.activity).toBeDefined()
    }
    const afterFirst = await getState(db)
    expect(afterFirst.xp).toBe(REWARDS_CONFIG.xpPerActivity)

    await setCompleted(db, SLUG, false)
    const r2 = await completeLesson(db, SLUG)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.data.activity).toBeUndefined() // no second grant
    const afterSecond = await getState(db)
    expect(afterSecond.xp).toBe(REWARDS_CONFIG.xpPerActivity)
  })
})
