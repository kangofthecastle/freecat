import { coinUrl } from '../gamification/sprite-urls'

/** Small gold-coin icon. Decorative — always pair with a visible number. */
export function Coin({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <img src={coinUrl} alt="" width={size} height={size} className={`inline-block shrink-0 align-[-0.2em] ${className}`} />
}
