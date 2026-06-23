import { REWARDS_CONFIG, type RewardsConfig } from './config'

export function coinsForActivity(cfg: RewardsConfig = REWARDS_CONFIG): number {
  return cfg.coinsPerActivity
}

export function canAfford(coins: number, price: number): boolean {
  return coins >= price
}
