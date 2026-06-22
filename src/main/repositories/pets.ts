import { asc, eq, ne, gt } from 'drizzle-orm'
import type { DB } from '../db/client'
import { eggs, ownedItems, pets, dailyActivity, type PetRow } from '../db/schema'
import { REWARDS_CONFIG } from '../../shared/gamification/config'
import { incubationProgress, isReady } from '../../shared/gamification/incubation'
import { rollSpecies } from '../../shared/gamification/hatch'
import { moodFromState } from '../../shared/gamification/wellbeing'
import { ITEMS, SPECIES } from '../../shared/gamification/catalog'
import { levelForXp } from '../../shared/gamification/level'
import { streakDays } from '../../shared/gamification/streak'
import { dayKeyInTz } from '../../shared/gamification/dates'
import type { Rng, MoodState, Rarity } from '../../shared/gamification/types'
import type { GamificationState, PetView, ServiceResult } from '../../shared/dto'
import { ok, err } from '../../shared/dto'
import { getState, spend } from './gamification-state'
import { appTz } from './activity'

const RESTING: MoodState = { value: REWARDS_CONFIG.happinessStart, level: 'happy' } // inactive pets don't decay

const speciesRarity = (key: string): Rarity => SPECIES.find((s) => s.key === key)?.rarity ?? 'common'

function toView(p: PetRow, now: Date, tz: string): PetView {
  const mood = p.isActive ? moodFromState(p.baseHappiness, p.lastInteractionAt, p.lastTreatAt, now, tz) : RESTING
  return { id: p.id, species: p.species, name: p.name, rarity: p.rarity, isActive: p.isActive, equipped: p.equipped, mood }
}

export async function buyEgg(db: DB, now: Date): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(eggs).where(ne(eggs.status, 'hatched'))
    if (existing) return err('egg-exists')
    const debit = await spend(tx, { amount: REWARDS_CONFIG.eggPrice, reason: 'spend_egg', now })
    if (!debit.ok) return err(debit.error)
    await tx.insert(eggs).values({ status: 'incubating', acquiredAt: now })
    return ok(null)
  })
}

export async function buyTreat(db: DB, now: Date): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [pet] = await tx.select().from(pets).where(eq(pets.isActive, true))
    if (!pet) return err('no-pet')
    const debit = await spend(tx, { amount: REWARDS_CONFIG.treatPrice, reason: 'spend_treat', now })
    if (!debit.ok) return err(debit.error)
    await tx.update(pets).set({ lastTreatAt: now }).where(eq(pets.id, pet.id))
    return ok(null)
  })
}

export async function buyItem(db: DB, itemKey: string, now: Date): Promise<ServiceResult<null>> {
  const item = ITEMS.find((i) => i.key === itemKey)
  if (!item) return err('not-found')
  return db.transaction(async (tx) => {
    const [owned] = await tx.select().from(ownedItems).where(eq(ownedItems.itemKey, itemKey))
    if (owned) return err('already-owned')
    const debit = await spend(tx, { amount: item.price, reason: 'spend_item', now })
    if (!debit.ok) return err(debit.error)
    await tx.insert(ownedItems).values({ itemKey, acquiredAt: now })
    return ok(null)
  })
}

export async function hatchEgg(db: DB, now: Date, rng: Rng = Math.random): Promise<ServiceResult<PetView>> {
  return db.transaction(async (tx) => {
    const [egg] = await tx.select().from(eggs).where(eq(eggs.status, 'ready'))
    if (!egg || !isReady(egg.incubationPoints)) return err('not-ready')
    const speciesKey = rollSpecies(rng, SPECIES)
    const [hasActive] = await tx.select({ id: pets.id }).from(pets).where(eq(pets.isActive, true))
    const [pet] = await tx.insert(pets).values({
      species: speciesKey, rarity: speciesRarity(speciesKey),
      isActive: !hasActive, baseHappiness: REWARDS_CONFIG.happinessStart, lastInteractionAt: now, hatchedAt: now
    }).returning()
    if (!pet) throw new Error('hatch failed to create pet')
    await tx.update(eggs).set({ status: 'hatched', hatchedPetId: pet.id, hatchedAt: now }).where(eq(eggs.id, egg.id))
    return ok(toView(pet, now, appTz()))
  })
}

export async function setActivePet(db: DB, petId: number): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [pet] = await tx.select().from(pets).where(eq(pets.id, petId))
    if (!pet) return err('not-found')
    await tx.update(pets).set({ isActive: false }).where(eq(pets.isActive, true))
    await tx.update(pets).set({ isActive: true, baseHappiness: REWARDS_CONFIG.happinessStart, lastInteractionAt: new Date() }).where(eq(pets.id, petId))
    return ok(null)
  })
}

export async function equipItem(db: DB, petId: number, itemKey: string): Promise<ServiceResult<null>> {
  const item = ITEMS.find((i) => i.key === itemKey)
  if (!item) return err('not-found')
  return db.transaction(async (tx) => {
    const [owned] = await tx.select().from(ownedItems).where(eq(ownedItems.itemKey, itemKey))
    if (!owned) return err('not-owned')
    const [pet] = await tx.select().from(pets).where(eq(pets.id, petId))
    if (!pet) return err('not-found')
    const kept = pet.equipped.filter((k) => ITEMS.find((i) => i.key === k)?.slot !== item.slot)
    await tx.update(pets).set({ equipped: [...kept, itemKey] }).where(eq(pets.id, petId))
    return ok(null)
  })
}

export async function unequipItem(db: DB, petId: number, itemKey: string): Promise<ServiceResult<null>> {
  return db.transaction(async (tx) => {
    const [pet] = await tx.select().from(pets).where(eq(pets.id, petId))
    if (!pet) return err('not-found')
    await tx.update(pets).set({ equipped: pet.equipped.filter((k) => k !== itemKey) }).where(eq(pets.id, petId))
    return ok(null)
  })
}

export async function renamePet(db: DB, petId: number, name: string): Promise<ServiceResult<null>> {
  const trimmed = name.trim()
  if (trimmed.length > 24) return err('name-too-long')
  const updated = await db.update(pets).set({ name: trimmed || null }).where(eq(pets.id, petId)).returning({ id: pets.id })
  return updated.length ? ok(null) : err('not-found')
}

export async function getGamificationState(db: DB, now: Date, tz = appTz()): Promise<GamificationState> {
  const { coins, xp } = await getState(db)
  const petRows = await db.select().from(pets).orderBy(asc(pets.hatchedAt))
  const views = petRows.map((p) => toView(p, now, tz))
  const [egg] = await db.select().from(eggs).where(ne(eggs.status, 'hatched'))
  const owned = await db.select({ k: ownedItems.itemKey }).from(ownedItems)
  const dayRows = await db.select({ k: dailyActivity.dayKey, c: dailyActivity.count }).from(dailyActivity).where(gt(dailyActivity.count, 0))
  const todayKey = dayKeyInTz(now, tz)
  const today = dayRows.find((d) => d.k === todayKey)
  const todayCount = today?.c ?? 0
  return {
    coins, xp, level: levelForXp(xp),
    streak: streakDays(new Set(dayRows.map((d) => d.k)), now, tz),
    daily: { count: todayCount, goal: REWARDS_CONFIG.dailyGoal, met: todayCount >= REWARDS_CONFIG.dailyGoal },
    activePet: views.find((v) => v.isActive) ?? null,
    collection: views,
    egg: egg ? { incubationPoints: egg.incubationPoints, progress: incubationProgress(egg.incubationPoints), ready: egg.status === 'ready' } : null,
    ownedItemKeys: owned.map((o) => o.k),
    shop: { eggPrice: REWARDS_CONFIG.eggPrice, treatPrice: REWARDS_CONFIG.treatPrice, items: ITEMS }
  }
}
