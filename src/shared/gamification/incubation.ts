import { REWARDS_CONFIG, type RewardsConfig } from './config'

export function advanceIncubation(points: number): number {
  return points + 1
}

export function isReady(points: number, cfg: RewardsConfig = REWARDS_CONFIG): boolean {
  return points >= cfg.incubationThreshold
}

export function incubationProgress(points: number, cfg: RewardsConfig = REWARDS_CONFIG): number {
  return Math.min(1, points / cfg.incubationThreshold)
}
