// src/renderer/src/flashcards/mathjax-asset.ts
// The full self-contained MathJax 3 SVG build, inlined as a string at build time via
// Vite's ?raw. SVG output embeds glyph paths in this bundle — no @font-face, no network —
// so math typesets under the iframe's `default-src 'none'` CSP. ('?raw' is typed by
// vite/client, referenced in src/renderer/src/env.d.ts.)
import mathjaxSvg from 'mathjax/es5/tex-svg-full.js?raw'

export const MATHJAX_SVG_SRC: string = mathjaxSvg
