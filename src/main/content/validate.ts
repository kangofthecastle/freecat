import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { scanContent, type ContentError } from './loader'

/** Scan `root` (topic axis) and return every content error. */
export function validateContentTree(root: string, checkImages = true): ContentError[] {
  return scanContent(root, { checkImages }).errors
}

/** CLI: validate `<root>` (default ./content); print errors; exit 1 on any. */
function main(argv: string[]): void {
  const root = resolve(argv[2] ?? 'content')
  const index = scanContent(root)
  if (index.errors.length === 0) {
    const topics = index.byTopic.size
    const questions = index.allQuestionIds.length
    const passages = index.passagesById.size
    // eslint-disable-next-line no-console
    console.log(
      `content:validate — OK (${root}): ${questions} question(s), ${passages} passage(s), ${topics} topic(s)`
    )
    process.exit(0)
  }
  // eslint-disable-next-line no-console
  console.error(`content:validate — ${index.errors.length} error(s) in ${root}:`)
  for (const e of index.errors) {
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
