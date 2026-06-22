import { dayKeyInTz } from './dates'
import { REWARDS_CONFIG, type RewardsConfig } from './config'
import type { MoodLevel, MoodState } from './types'

const DAY_MS = 86_400_000
const keyToUtcMs = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

/**
 * Derived mood: decay by whole app-tz days since last study, floored; plus a decaying treat boost.
 * The value maps onto the ladder happy → sleeping → sad → angry as neglect grows.
 */
export function moodFromState(
  baseHappiness: number,
  lastInteractionAt: Date,
  lastTreatAt: Date | null,
  now: Date,
  tz: string,
  cfg: RewardsConfig = REWARDS_CONFIG,
): MoodState {
  const days = Math.max(
    0,
    Math.round((keyToUtcMs(dayKeyInTz(now, tz)) - keyToUtcMs(dayKeyInTz(lastInteractionAt, tz))) / DAY_MS),
  )
  const decayed = Math.max(cfg.happinessFloor, baseHappiness - cfg.decayPerDay * days)

  let treat = 0
  if (lastTreatAt) {
    const elapsed = now.getTime() - lastTreatAt.getTime()
    if (elapsed >= 0 && elapsed < cfg.treatBoostDurationMs) {
      treat = Math.round(cfg.treatBoost * (1 - elapsed / cfg.treatBoostDurationMs))
    }
  }
  const value = Math.min(cfg.happinessMax, decayed + treat)
  const level: MoodLevel =
    value >= cfg.moodHappyAt ? 'happy'
      : value >= cfg.moodSleepingAt ? 'sleeping'
        : value >= cfg.moodSadAt ? 'sad'
          : 'angry'
  return { value, level }
}
