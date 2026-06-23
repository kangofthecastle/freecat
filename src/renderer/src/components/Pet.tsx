import type { CSSProperties } from 'react'
import { mouthAnchor, resolveAccessories, resolveSprite, type PetAction } from '../../../shared/gamification/pet-art'
import type { MoodLevel } from '../../../shared/gamification/types'
import { spriteUrl, itemUrl } from '../gamification/sprite-urls'

/** A cookie that pops in at the creature's mouth and is nibbled away — for static (1-frame) pets eating. */
function Treat({ species, size }: { species: string; size: number }) {
  const a = mouthAnchor(species)
  if (!a) return null
  const s = Math.round(size * 0.3)
  return (
    <svg viewBox="0 0 24 24" className="treat-eat" aria-hidden style={{ position: 'absolute', left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: s, height: s }}>
      <circle cx="12" cy="12" r="11" fill="#d8a24a" stroke="#a9762a" strokeWidth="1.2" />
      <g fill="#5b3a1a">
        <circle cx="9" cy="8.5" r="1.7" /><circle cx="15.5" cy="11" r="1.7" /><circle cx="10.5" cy="15" r="1.7" />
        <circle cx="16" cy="16" r="1.3" /><circle cx="7.5" cy="13.5" r="1.2" />
      </g>
    </svg>
  )
}

/**
 * Composes a creature from its animated base sprite + equipped accessories. Each sprite is a
 * horizontal frame-strip; multi-frame strips play via a CSS steps() animation inside an overflow-clip
 * window. Single-frame pets get a gentle breathing bob (and, while eating, a cookie). URLs come from
 * the bundled glob resolver (hashed → cache-safe, packaging-safe).
 */
export function Pet({ species, mood, equipped = [], size = 128, animate = true, action }: {
  species: string; mood: MoodLevel; equipped?: string[]; size?: number; animate?: boolean; action?: PetAction
}) {
  const sprite = resolveSprite(species, mood, action)
  const src = sprite && spriteUrl(sprite.species, sprite.state)
  if (!sprite || !src) return <div style={{ width: size, height: size }} aria-hidden />

  const accessories = resolveAccessories(species, equipped)
  const eating = action === 'eating'
  const animated = animate && sprite.frames > 1
  // desync the idle per species so a grid of pets doesn't pulse in lockstep
  const idleDelay = `-${species.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 2400}ms`
  const motion = !animated && animate ? (eating ? 'pet-eating' : 'pet-idle') : ''

  const stripStyle: CSSProperties = animated
    ? ({
        width: sprite.frames * size, height: size,
        ['--pet-strip-shift']: `-${sprite.frames * size}px`,
        animation: `pet-sprite ${sprite.frames * sprite.durationMs}ms steps(${sprite.frames}) infinite`
      } as CSSProperties)
    : { width: size, height: size }

  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden>
      <div className={`relative h-full w-full ${animated ? 'overflow-hidden' : ''} ${motion}`} style={{ animationDelay: motion === 'pet-idle' ? idleDelay : undefined }}>
        <img src={src} alt="" className={`absolute left-0 top-0 max-w-none ${animated ? 'pet-sprite' : ''}`} style={stripStyle} />
      </div>
      {accessories.map((l, i) => {
        const url = itemUrl(l.itemKey)
        if (!url) return null
        const w = size * (l.anchor?.scale ?? 1)
        return (
          <img key={i} src={url} alt="" className="absolute" style={{
            left: `${(l.anchor?.x ?? 0.5) * 100}%`, top: `${(l.anchor?.y ?? 0.5) * 100}%`,
            width: w, height: w, transform: 'translate(-50%, -50%)'
          }} />
        )
      })}
      {eating && sprite.frames <= 1 && <Treat species={species} size={size} />}
    </div>
  )
}
