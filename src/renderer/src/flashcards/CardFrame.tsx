// src/renderer/src/flashcards/CardFrame.tsx
import { useEffect, useRef, useState } from 'react'
import type { CardView } from '../../../shared/dto'
import { buildCardHtml } from '../../../shared/flashcards/render'
import { MATHJAX_SVG_SRC } from './mathjax-asset'

const MAX_IFRAME_HEIGHT = 50000

/** The sandboxed iframe that renders a card's question/answer HTML — the ONLY place engine output
 *  (buildCardHtml's return value) is ever assigned (C4b invariant: untrusted card content never
 *  touches the parent DOM). Shared by CardViewer (browse) and ReviewSession (study) so there is one
 *  iframe implementation and one hardened height shim. */
export function CardFrame({ view, side }: { view: CardView; side: 'question' | 'answer' }): React.JSX.Element {
  const [height, setHeight] = useState(160)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Reset height whenever the card or side changes so a tall→short switch doesn't flash the old height.
  useEffect(() => { setHeight(160) }, [view, side])

  // Hardened height shim: only our iframe, only the exact payload, clamped.
  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const d = e.data as unknown
      if (!d || typeof d !== 'object') return
      const msg = d as { type?: unknown; height?: unknown }
      if (msg.type !== 'fc-height' || typeof msg.height !== 'number' || !Number.isFinite(msg.height)) return
      setHeight(Math.max(40, Math.min(MAX_IFRAME_HEIGHT, Math.ceil(msg.height))))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // buildCardHtml is total for normal cards, but a pathologically nested field (e.g. ~5k deep
  // sections/clozes) can overflow the call stack. Catch it here so a malformed card degrades to the
  // placeholder instead of throwing out of render and crashing the renderer subtree (there is no
  // error boundary around CardFrame).
  let srcDoc: string
  try {
    srcDoc = buildCardHtml(view, side, MATHJAX_SVG_SRC)
  } catch (e) {
    console.error('buildCardHtml failed', e)
    return <div role="alert" className="rounded-lg bg-amber-50 p-6 text-amber-800">This card could not be loaded.</div>
  }

  return (
    <iframe
      ref={iframeRef}
      title="card"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ width: '100%', height, border: 'none' }}
      className="rounded-lg bg-white ring-1 ring-gray-200"
    />
  )
}
