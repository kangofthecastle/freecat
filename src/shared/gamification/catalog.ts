import type { Item, Species } from './types'

/**
 * Collectible creatures. Each is "expressive": a real animated sprite per state, rendered from
 * `<species>/<state>.png` frame-strips. Accessory `anchors` are tuned per creature for its primary
 * pose — fractions of the sprite box (0..1) + a scale multiplier.
 */
export const SPECIES: Species[] = [
  { key: 'cat', name: 'Calico Cat', rarity: 'common',
    anchors: { head: { x: 0.5, y: 0.26, scale: 0.42 }, face: { x: 0.5, y: 0.40, scale: 0.42 }, neck: { x: 0.5, y: 0.62, scale: 0.40 } } },
  { key: 'dog', name: 'Puppy', rarity: 'uncommon',
    anchors: { head: { x: 0.5, y: 0.30, scale: 0.44 }, face: { x: 0.5, y: 0.42, scale: 0.42 }, neck: { x: 0.5, y: 0.64, scale: 0.42 } } },
  { key: 'pig', name: 'Piglet', rarity: 'uncommon',
    anchors: { head: { x: 0.5, y: 0.30, scale: 0.46 }, face: { x: 0.5, y: 0.42, scale: 0.44 }, neck: { x: 0.5, y: 0.64, scale: 0.44 } } },
  { key: 'frog', name: 'Frog', rarity: 'rare',
    anchors: { head: { x: 0.5, y: 0.30, scale: 0.50 }, face: { x: 0.5, y: 0.42, scale: 0.46 }, neck: { x: 0.5, y: 0.66, scale: 0.46 } } },
  { key: 'capybara', name: 'Capybara', rarity: 'rare',
    anchors: { head: { x: 0.5, y: 0.26, scale: 0.50 }, face: { x: 0.5, y: 0.40, scale: 0.46 }, neck: { x: 0.5, y: 0.64, scale: 0.46 } } },
  { key: 'axolotl', name: 'Axolotl', rarity: 'rare',
    anchors: { head: { x: 0.5, y: 0.28, scale: 0.46 }, face: { x: 0.5, y: 0.40, scale: 0.44 }, neck: { x: 0.5, y: 0.62, scale: 0.44 } } },
]

export const ITEMS: Item[] = [
  { key: 'cap', name: 'Graduation Cap', price: 80, slot: 'head', sprite: '/pets/items/cap.png' },
  { key: 'glasses', name: 'Reading Glasses', price: 60, slot: 'face', sprite: '/pets/items/glasses.png' },
  { key: 'scarf', name: 'Cozy Scarf', price: 100, slot: 'neck', sprite: '/pets/items/scarf.png' },
  { key: 'bow', name: 'Bow Tie', price: 50, slot: 'neck', sprite: '/pets/items/bow.png' },
]
