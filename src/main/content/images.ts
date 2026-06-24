import { join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CONTENT_PROTOCOL = 'freecat-content'

const IMAGE_RE = /(!\[[^\]]*\]\()([^)]+)(\))/g

/** True if a Markdown image target is relative (not a scheme URL, not an absolute path). */
function isRelativeTarget(target: string): boolean {
  const t = target.trim()
  if (t.length === 0) return false
  if (t.startsWith('/')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return false // http:, https:, data:, freecat-content:
  return true
}

/** Build a freecat-content:// URL from a path relative to the content root. */
export function toContentUrl(relPathFromRoot: string): string {
  const rel = relPathFromRoot.split('\\').join('/')
  return `${CONTENT_PROTOCOL}://${rel}`
}

/**
 * Rewrite only relative `![](x)` image targets to content URLs, resolving them
 * against `itemDirRelToRoot` (the item's directory, relative to the content root).
 * Absolute / http(s) / data: / already-content URLs are left untouched.
 */
export function rewriteImagePaths(markdown: string, itemDirRelToRoot: string): string {
  const base = itemDirRelToRoot.split('\\').join('/').replace(/\/+$/, '')
  return markdown.replace(IMAGE_RE, (full, open: string, target: string, close: string) => {
    if (!isRelativeTarget(target)) return full
    const rel = base ? `${base}/${target.trim()}` : target.trim()
    return `${open}${toContentUrl(rel)}${close}`
  })
}

/**
 * Register the freecat-content:// protocol, serving files ONLY from `root`.
 * Electron-only: verified at runtime (Phase 4 smoke), not in unit tests.
 * Electron is required lazily so importing this module in node tests never touches it.
 */
export function registerContentProtocol(root: string): void {
  // Lazy require keeps the pure exports above node-importable.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { protocol, net } = require('electron') as typeof import('electron')
  const rootResolved = resolve(root)

  protocol.handle(CONTENT_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    // freecat-content://<host><pathname> — the path lives in host+pathname; recombine.
    const rawPath = decodeURIComponent(`${url.hostname}${url.pathname}`)
    const resolved = resolve(rootResolved, '.' + (rawPath.startsWith('/') ? rawPath : `/${rawPath}`))
    // Reject path-escape: resolved must be inside rootResolved.
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(resolved).toString())
  })

  // `join`/`normalize` are imported for callers that want to pre-normalize paths; reference to avoid unused warnings.
  void join
  void normalize
}
