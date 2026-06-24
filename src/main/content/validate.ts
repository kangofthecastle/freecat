import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  buildSectionByCode,
  contentCategoryCodes,
  skillCodes
} from './taxonomy-codes'
import { scanContent, type ContentError, type LoaderOptions } from './loader'

/** Build LoaderOptions from the taxonomy seed and return all content errors for `root`. */
export function validateContentTree(root: string, checkImages = true): ContentError[] {
  const opts: LoaderOptions = {
    sectionByCode: buildSectionByCode(),
    contentCategoryCodes: contentCategoryCodes(),
    skillCodes: skillCodes(),
    checkImages
  }
  return scanContent(root, opts).errors
}

/** CLI: validate `<root>` (default ./content); print errors; exit 1 on any. */
function main(argv: string[]): void {
  const root = resolve(argv[2] ?? 'content')
  const errors = validateContentTree(root)
  if (errors.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`content:validate — OK (${root})`)
    process.exit(0)
  }
  // eslint-disable-next-line no-console
  console.error(`content:validate — ${errors.length} error(s) in ${root}:`)
  for (const e of errors) {
    // eslint-disable-next-line no-console
    console.error(`  ${e.file}: ${e.message}`)
  }
  process.exit(1)
}

// Run only when invoked directly (tsx/node), not when imported by tests.
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] != null &&
  (() => {
    try {
      return fileURLToPath(import.meta.url) === resolve(process.argv[1] as string)
    } catch {
      return false
    }
  })()

if (isDirectRun) {
  main(process.argv)
}
