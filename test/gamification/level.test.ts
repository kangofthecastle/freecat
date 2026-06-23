import { describe, it, expect } from 'vitest'
import { levelForXp } from '../../src/shared/gamification/level'

describe('levelForXp', () => {
  it('level 1 from 0 xp', () => { expect(levelForXp(0)).toEqual({ level: 1, into: 0, toNext: 100 }) })
  it('just below the threshold stays level 1', () => { expect(levelForXp(99)).toEqual({ level: 1, into: 99, toNext: 1 }) })
  it('100 xp → level 2', () => { expect(levelForXp(100)).toEqual({ level: 2, into: 0, toNext: 200 }) })
  it('300 xp → level 3', () => { expect(levelForXp(300)).toEqual({ level: 3, into: 0, toNext: 300 }) })
})
