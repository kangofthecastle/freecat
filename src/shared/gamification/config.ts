import type { Rarity } from './types'

export const REWARDS_CONFIG = {
  // economy
  coinsPerActivity: 1,   // coins earned per activity event
  xpPerActivity: 10,     // XP earned per activity event (XP is progression, never spent)
  dailyGoal: 20,         // activities/day that earns the once-daily bonus
  dailyGoalBonus: 10,    // coin bonus for hitting the daily goal
  eggPrice: 100,
  treatPrice: 20,
  // incubation
  incubationThreshold: 150, // activity points to hatch
  // mood / wellbeing
  treatBoost: 25,           // happiness added, decays to 0
  treatBoostDurationMs: 12 * 60 * 60 * 1000,
  happinessMax: 100,
  happinessFloor: 25,       // angriest — never lower (the pet never "dies")
  happinessStart: 100,
  decayPerDay: 20,
  // Mood ladder over days-since-study (start 100, −20/day, floor 25): studied today (100) → happy;
  // ~1 day (80) → sleeping; ~2 days (60) → sad; ~3+ days (≤40) → angry.
  moodHappyAt: 85,
  moodSleepingAt: 70,
  moodSadAt: 50,
} as const

export type RewardsConfig = typeof REWARDS_CONFIG

/** Egg hatch weighting by rarity. */
export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 60, uncommon: 30, rare: 10 }
