import { describe, it, expect, beforeEach } from 'vitest'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { toggleFlag, listFlaggedIds, isFlagged } from '../../src/main/repositories/qbank-flags'

const NOW = new Date('2026-06-22T12:00:00Z')
let db: DB
beforeEach(async () => { db = await createTestDb() })

describe('qbank-flags repository', () => {
  it('toggleFlag flips on then off for the same question', async () => {
    expect(await isFlagged(db, 'cp-1')).toBe(false)
    expect(await toggleFlag(db, 'cp-1', NOW)).toEqual({ flagged: true })
    expect(await isFlagged(db, 'cp-1')).toBe(true)
    expect(await toggleFlag(db, 'cp-1', NOW)).toEqual({ flagged: false })
    expect(await isFlagged(db, 'cp-1')).toBe(false)
  })

  it('listFlaggedIds reflects the current flag set', async () => {
    expect(await listFlaggedIds(db)).toEqual([])
    await toggleFlag(db, 'q-a', NOW)
    await toggleFlag(db, 'q-b', NOW)
    const ids = await listFlaggedIds(db)
    expect(ids).toContain('q-a')
    expect(ids).toContain('q-b')
    expect(ids).toHaveLength(2)
    await toggleFlag(db, 'q-a', NOW) // unflag
    expect(await listFlaggedIds(db)).toEqual(['q-b'])
  })

  it('isFlagged is true only for flagged questions', async () => {
    await toggleFlag(db, 'q-a', NOW)
    expect(await isFlagged(db, 'q-a')).toBe(true)
    expect(await isFlagged(db, 'q-b')).toBe(false)
  })
})
