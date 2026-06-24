import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { ZodType } from 'zod'

export interface ContentRecord<T> {
  dir: string
  data: T
}

export interface LoadOptions<T> {
  root: string
  subdir: string
  envelopeFile: string
  schema: ZodType<T>
}

/** Generic, schema-agnostic loader for bundled authored content (shared pipeline v0). */
export function loadContentType<T>(opts: LoadOptions<T>): ContentRecord<T>[] {
  const base = join(opts.root, opts.subdir)
  if (!existsSync(base)) return []
  const out: ContentRecord<T>[] = []
  for (const dir of itemDirs(base, opts.envelopeFile)) {
    const file = join(dir, opts.envelopeFile)
    try {
      const data = opts.schema.parse(loadYaml(readFileSync(file, 'utf8')))
      out.push({ dir, data })
    } catch (e) {
      throw new Error(`Failed to load content envelope: ${file}`, { cause: e })
    }
  }
  return out
}

export function readBody(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

/** Directories (sorted) under base that directly contain envelopeFile. */
function itemDirs(base: string, envelopeFile: string): string[] {
  const result: string[] = []
  const stack: string[] = [base]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === undefined) continue
    const entries = readdirSync(cur, { withFileTypes: true })
    if (entries.some((e) => e.isFile() && e.name === envelopeFile)) result.push(cur)
    for (const e of entries) if (e.isDirectory()) stack.push(join(cur, e.name))
  }
  return result.sort()
}
