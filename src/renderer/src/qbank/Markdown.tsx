import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

/**
 * Renders authored prose (stem / passage / choices / explanations) as Markdown with LaTeX math.
 *
 * Safety + correctness notes:
 * - Raw HTML is left DISABLED (we do not load `rehype-raw`), so community Markdown cannot inject
 *   HTML or scripts.
 * - react-markdown v9 sanitizes URLs via `defaultUrlTransform`, which strips the custom
 *   `freecat-content:` protocol the loader rewrites images to. We override `urlTransform` to keep
 *   that protocol (and otherwise fall back to the default) so co-located images actually load.
 * - Math: `$inline$` and `$$block$$` via remark-math, rendered by rehype-katex (KaTeX CSS is
 *   imported once in main.tsx).
 */

const KEEP_PROTOCOL = 'freecat-content:'

function urlTransform(url: string): string {
  // Preserve our content-image protocol; defer everything else to react-markdown's default sanitizer.
  if (url.startsWith(KEEP_PROTOCOL)) return url
  return defaultUrlTransform(url)
}

const components: Components = {
  // Images render with a sane max width and never overflow their column.
  img: ({ node: _node, ...props }) => (
    // eslint-disable-next-line jsx-a11y/alt-text -- alt comes from the authored Markdown
    <img {...props} className="my-2 inline-block h-auto max-w-full rounded" loading="lazy" />
  ),
  // Block code: keep it readable and scrollable rather than blowing out the layout.
  pre: ({ node: _node, ...props }) => (
    <pre {...props} className="my-2 overflow-x-auto rounded bg-gray-100 p-3 text-sm" />
  )
}

export interface MarkdownProps {
  children: string
  /** Extra classes for the prose wrapper. */
  className?: string
}

/**
 * `prose-block` is used for multi-paragraph fields (passage, explanation); `prose-inline` callers
 * can pass `className="[&_p]:m-0"` to collapse the single paragraph a stem/choice usually is.
 */
export function Markdown({ children, className = '' }: MarkdownProps): React.JSX.Element {
  return (
    <div className={`text-gray-800 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
