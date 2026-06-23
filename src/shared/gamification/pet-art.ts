import { ITEMS, SPECIES } from './catalog'
import type { Anchor, MoodLevel } from './types'
import { PET_FRAMES, type FrameSpec } from './pet-frames'

export type PetAction = 'eating'
export type SpriteState = MoodLevel | PetAction
export interface Layer { itemKey: string; anchor?: Anchor }
export interface Sprite extends FrameSpec { species: string; state: SpriteState }

export function resolveSprite(speciesKey: string, mood: MoodLevel, action?: PetAction): Sprite | null {
  if (!SPECIES.some((s) => s.key === speciesKey)) return null
  const state: SpriteState = action ?? mood
  const spec = PET_FRAMES[speciesKey]?.[state] ?? { frames: 1, durationMs: 0 }
  return { species: speciesKey, state, frames: spec.frames, durationMs: spec.durationMs }
}

export function resolveAccessories(speciesKey: string, equipped: string[]): Layer[] {
  const species = SPECIES.find((s) => s.key === speciesKey)
  if (!species) return []
  const layers: Layer[] = []
  for (const key of equipped) {
    const item = ITEMS.find((i) => i.key === key)
    if (!item) continue
    layers.push({ itemKey: key, anchor: species.anchors[item.slot] })
  }
  return layers
}

export function mouthAnchor(speciesKey: string): Anchor | undefined {
  const face = SPECIES.find((s) => s.key === speciesKey)?.anchors.face
  return face && { ...face, y: Math.min(1, face.y + 0.08) }
}
