// src/renderer/src/flashcards/CardViewer.tsx
import { useEffect, useRef, useState } from 'react'
import type { CardView } from '../../../shared/dto'
import { buildCardHtml } from '../../../shared/flashcards/render'
import { MATHJAX_SVG_SRC } from './mathjax-asset'

const MAX_IFRAME_HEIGHT = 50000

export function CardViewer({ cardId }: { cardId: number }): React.JSX.Element {
  const [view, setView] = useState<CardView | null>(null)
  const [side, setSide] = useState<'question' | 'answer'>('question')
  const [failed, setFailed] = useState(false)
  const [height, setHeight] = useState(160)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Load the card whenever the selection changes; reset to the question side.
  useEffect(() => {
    let active = true
    setView(null); setFailed(false); setSide('question')
    window.freecat.flashcards
      .getCard(cardId)
      .then((res) => { if (active) { if (res.ok) setView(res.data); else setFailed(true) } })
      .catch((e) => { console.error('getCard failed', e); if (active) setFailed(true) })
    return () => { active = false }
  }, [cardId])

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

  if (failed) return <div className="rounded-lg bg-amber-50 p-6 text-amber-800">This card could not be loaded.</div>
  if (!view) return <div className="p-6 text-gray-400">Loading…</div>

  if (view.renderKind === 'image-occlusion')
    return <Placeholder title="Image Occlusion card" body="Rendering coming in a later milestone." />
  if (view.renderKind === 'unsupported')
    return <Placeholder title="Unsupported note type" body="This note type isn't supported yet." />

  const srcDoc = buildCardHtml(view, side, MATHJAX_SVG_SRC)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSide(side === 'question' ? 'answer' : 'question')}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {side === 'question' ? 'Show answer' : 'Show question'}
        </button>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-500">{view.renderKind}</span>
        <span className="truncate text-xs text-gray-400">{view.deckName} · {view.noteTypeName}</span>
      </div>
      <iframe
        ref={iframeRef}
        title="card"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ width: '100%', height, border: 'none' }}
        className="rounded-lg bg-white ring-1 ring-gray-200"
      />
    </div>
  )
}

function Placeholder({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
      <p className="font-semibold text-gray-700">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  )
}
