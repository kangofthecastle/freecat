import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { type DB } from '../../src/main/db/client'
import { createTestDb } from '../helpers/db'
import { credit } from '../../src/main/repositories/gamification-state'
import { buyEgg, buyTreat, buyItem, hatchEgg, setActivePet, equipItem, unequipItem, renamePet, getGamificationState } from '../../src/main/repositories/pets'
import { eggs, pets, ownedItems } from '../../src/main/db/schema'
import { REWARDS_CONFIG } from '../../src/shared/gamification/config'
import { ITEMS, SPECIES } from '../../src/shared/gamification/catalog'

const NOW = new Date('2026-06-22T12:00:00Z')
const TZ = 'UTC'
let db: DB
beforeEach(async () => { db = await createTestDb() })
const giveCoins = (n: number) => credit(db, { coins: n, xp: 0, reason: 'activity', kind: null, now: NOW })

describe('shop', () => {
  it('buyEgg debits coins and creates an incubating egg', async () => {
    await giveCoins(REWARDS_CONFIG.eggPrice)
    expect((await buyEgg(db, NOW)).ok).toBe(true)
    const [egg] = await db.select().from(eggs)
    expect(egg?.status).toBe('incubating')
  })
  it('buyEgg without funds → insufficient-coins, no egg', async () => {
    await giveCoins(REWARDS_CONFIG.eggPrice - 1)
    expect(await buyEgg(db, NOW)).toEqual({ ok: false, error: 'insufficient-coins' })
    expect(await db.select().from(eggs)).toHaveLength(0)
  })
  it('buyEgg rejected when an un-hatched egg already exists', async () => {
    await giveCoins(REWARDS_CONFIG.eggPrice * 2)
    await db.insert(eggs).values({ status: 'incubating' })
    expect(await buyEgg(db, NOW)).toEqual({ ok: false, error: 'egg-exists' })
  })
  it('buyTreat needs an active pet, debits, sets lastTreatAt', async () => {
    await giveCoins(REWARDS_CONFIG.treatPrice)
    await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true })
    expect((await buyTreat(db, NOW)).ok).toBe(true)
    const [pet] = await db.select().from(pets)
    expect(pet?.lastTreatAt?.getTime()).toBe(NOW.getTime())
  })
  it('buyTreat without an active pet → no-pet', async () => {
    await giveCoins(REWARDS_CONFIG.treatPrice)
    expect(await buyTreat(db, NOW)).toEqual({ ok: false, error: 'no-pet' })
  })
  it('buyItem debits + records ownership; re-buy → already-owned; unknown → not-found', async () => {
    await giveCoins(ITEMS[0]!.price * 2)
    expect((await buyItem(db, ITEMS[0]!.key, NOW)).ok).toBe(true)
    expect(await buyItem(db, ITEMS[0]!.key, NOW)).toEqual({ ok: false, error: 'already-owned' })
    expect(await buyItem(db, 'nope', NOW)).toEqual({ ok: false, error: 'not-found' })
  })
})

describe('nest', () => {
  it('hatchEgg on a ready egg creates an active pet (first one) and marks the egg hatched', async () => {
    await db.insert(eggs).values({ status: 'ready', incubationPoints: REWARDS_CONFIG.incubationThreshold })
    const res = await hatchEgg(db, NOW, () => 0)
    expect(res.ok).toBe(true)
    const [pet] = await db.select().from(pets)
    expect(pet?.isActive).toBe(true)
    expect(SPECIES.map((s) => s.key)).toContain(pet?.species)
  })
  it('hatchEgg on a non-ready egg → not-ready', async () => {
    await db.insert(eggs).values({ status: 'incubating', incubationPoints: 5 })
    expect(await hatchEgg(db, NOW, () => 0)).toEqual({ ok: false, error: 'not-ready' })
  })
  it('setActivePet swaps the single active flag', async () => {
    const [a] = await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true }).returning()
    const [b] = await db.insert(pets).values({ species: 'dog', rarity: 'uncommon', isActive: false }).returning()
    expect(a && b).toBeTruthy()
    expect((await setActivePet(db, b!.id)).ok).toBe(true)
    const active = await db.select().from(pets).where(eq(pets.isActive, true))
    expect(active).toHaveLength(1)
    expect(active[0]?.id).toBe(b!.id)
  })
  it('equipItem requires ownership and replaces a same-slot item', async () => {
    const [pet] = await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true }).returning()
    const neck = ITEMS.filter((i) => i.slot === 'neck')
    expect(await equipItem(db, pet!.id, neck[0]!.key)).toEqual({ ok: false, error: 'not-owned' })
    await db.insert(ownedItems).values({ itemKey: neck[0]!.key })
    expect((await equipItem(db, pet!.id, neck[0]!.key)).ok).toBe(true)
    if (neck[1]) {
      await db.insert(ownedItems).values({ itemKey: neck[1]!.key })
      await equipItem(db, pet!.id, neck[1]!.key)
      const [p] = await db.select().from(pets)
      expect(p?.equipped).toEqual([neck[1]!.key])
    }
  })
  it('getGamificationState returns coins, xp/level, derived mood, collection, egg progress, shop', async () => {
    await giveCoins(40)
    await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true, baseHappiness: 100, lastInteractionAt: NOW })
    await db.insert(eggs).values({ status: 'incubating', incubationPoints: 75 })
    const st = await getGamificationState(db, NOW, TZ)
    expect(st.coins).toBe(40)
    expect(st.activePet?.mood.level).toBe('happy')
    expect(st.collection).toHaveLength(1)
    expect(st.egg?.progress).toBeCloseTo(0.5)
    expect(st.shop.items).toHaveLength(ITEMS.length)
  })
  it('renamePet trims, rejects >24 chars, clears to null on empty, 404s unknown', async () => {
    const [p] = await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true }).returning()
    expect((await renamePet(db, p!.id, '  Whiskers  ')).ok).toBe(true)
    expect((await db.select().from(pets))[0]?.name).toBe('Whiskers')
    expect(await renamePet(db, p!.id, 'x'.repeat(25))).toEqual({ ok: false, error: 'name-too-long' })
    expect((await renamePet(db, p!.id, '   ')).ok).toBe(true)
    expect((await db.select().from(pets))[0]?.name).toBeNull()
    expect(await renamePet(db, 9999, 'Nope')).toEqual({ ok: false, error: 'not-found' })
  })

  it('unequipItem removes a key from equipped', async () => {
    const [p] = await db.insert(pets).values({ species: 'cat', rarity: 'common', isActive: true, equipped: ['cap', 'bow'] }).returning()
    expect((await unequipItem(db, p!.id, 'cap')).ok).toBe(true)
    expect((await db.select().from(pets))[0]?.equipped).toEqual(['bow'])
  })
})
