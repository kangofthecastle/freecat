export type MoodLevel = 'happy' | 'sleeping' | 'sad' | 'angry'
export type CoinReason = 'activity' | 'daily_goal' | 'spend_egg' | 'spend_treat' | 'spend_item'
export type Rarity = 'common' | 'uncommon' | 'rare'
export type AccessorySlot = 'head' | 'face' | 'neck'

export interface MoodState {
  value: number // 0..100
  level: MoodLevel
}

export interface Anchor { x: number; y: number; scale: number } // fraction of box (0..1) + scale multiplier

export interface Species {
  key: string
  name: string
  rarity: Rarity
  /** where each accessory slot sits on THIS creature. */
  anchors: Record<AccessorySlot, Anchor>
}

export interface Item {
  key: string
  name: string
  price: number
  slot: AccessorySlot
  sprite: string // path under /pets
}

/** A deterministic-friendly random source in [0,1); defaults to Math.random at call sites. */
export type Rng = () => number
