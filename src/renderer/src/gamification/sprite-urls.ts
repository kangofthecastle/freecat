import coinSvg from '../assets/coin.svg'

const petPngs = import.meta.glob('../assets/pets/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const itemPngs = import.meta.glob('../assets/pets/items/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export const coinUrl: string = coinSvg

export function spriteUrl(species: string, state: string): string | undefined {
  return petPngs[`../assets/pets/${species}/${state}.png`]
}
export function itemUrl(key: string): string | undefined {
  return itemPngs[`../assets/pets/items/${key}.png`]
}
