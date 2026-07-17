import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { ZodError, type ZodType } from 'zod'
import type { ContentIndex, PassageContent, QuestionContent, SectionCode } from './types'
import type { ChoiceLetter, DisciplineKey, Tag } from '../../shared/dto'
import {
  standaloneQuestionSchema,
  passageSchema,
  type StandaloneQuestionInput,
  type PassageQuestionInput
} from './schema'
import { isKnownTag } from './tags'
import { TOPICS } from '../db/seed/taxonomy-data'
import { rewriteImagePaths } from './images'

// ─────────────────────────────────────────────────────────────────────────────
// Lessons: main's generic, schema-agnostic content loader (shared pipeline v0).
// Kept verbatim — the LessonStore depends on these. (Add/add merge: BOTH loaders.)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Questions: Qbank's bespoke scanner + index builders (topic axis).
// Each item declares a primary `topic`; the discipline and MCAT section are
// derived from the seeded taxonomy. Tags are validated against the AAMC vocab.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContentError {
  file: string
  message: string
}
export interface ScanOptions {
  checkImages?: boolean // default true
}

/** Fixed discipline → MCAT section map (no CARS). Exported for the Stats rollup, which groups
 *  the same way (single source — a new discipline slots into both by editing this map once). */
export const SECTION_BY_DISCIPLINE: Record<DisciplineKey, SectionCode> = {
  'gen-chem': 'chem-phys',
  'o-chem': 'chem-phys',
  physics: 'chem-phys',
  biology: 'bio-biochem',
  biochem: 'bio-biochem',
  'behavioral-sci': 'psych-soc'
}

/** topic slug → owning discipline, built once from the seeded taxonomy. */
const topicToDiscipline: Map<string, DisciplineKey> = new Map(
  TOPICS.map((t) => [t.slug, t.discipline])
)

interface ResolvedTopic {
  topic: string
  discipline: DisciplineKey
  section: SectionCode
}

interface Accum {
  byId: Map<string, QuestionContent>
  passagesById: Map<string, PassageContent>
  errors: ContentError[]
}

function emptyAccum(): Accum {
  return { byId: new Map(), passagesById: new Map(), errors: [] }
}

/**
 * Resolve a declared `topic` to its discipline + derived section.
 * Unknown topic → push an error and return null (item is skipped, never committed).
 */
function resolveTopic(topic: string, file: string, acc: Accum): ResolvedTopic | null {
  const discipline = topicToDiscipline.get(topic)
  if (!discipline) {
    acc.errors.push({ file, message: `unknown topic "${topic}"` })
    return null
  }
  return { topic, discipline, section: SECTION_BY_DISCIPLINE[discipline] }
}

/**
 * Validate every tag against the AAMC vocabulary. Each unknown tag pushes an
 * error; returns false if any tag is unknown (the item is then skipped).
 */
function validateTags(tags: Tag[], file: string, acc: Accum): boolean {
  let ok = true
  for (const t of tags) {
    if (!isKnownTag(t)) {
      acc.errors.push({ file, message: `unknown tag "${t.vocab}:${t.code}"` })
      ok = false
    }
  }
  return ok
}

const PROSE_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g

/** Collect every relative image target referenced in a Markdown prose string. */
function relativeImageTargets(markdown: string): string[] {
  const out: string[] = []
  for (const m of markdown.matchAll(PROSE_IMAGE_RE)) {
    const target = m[1]?.trim()
    if (!target) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // absolute scheme (http:, freecat-content:, data:)
    if (target.startsWith('/')) continue // absolute path
    out.push(target)
  }
  return out
}

/** Check every relative image referenced by `prose` exists under `itemDir`; push errors if not. */
function checkProseImages(acc: Accum, file: string, itemDir: string, prose: string): void {
  for (const target of relativeImageTargets(prose)) {
    const abs = join(itemDir, target)
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      acc.errors.push({ file, message: `referenced image not found: ${target}` })
    }
  }
}

function loadStandalone(acc: Accum, root: string, file: string, opts: ScanOptions): void {
  let raw: unknown
  try {
    raw = loadYaml(readFileSync(file, 'utf8'))
  } catch (e) {
    acc.errors.push({ file, message: `YAML parse error: ${(e as Error).message}` })
    return
  }
  let data: StandaloneQuestionInput
  try {
    data = standaloneQuestionSchema.parse(raw)
  } catch (e) {
    acc.errors.push({ file, message: zodMessage(e) })
    return
  }

  const resolved = resolveTopic(data.topic, file, acc)
  if (!resolved) return
  if (!validateTags(data.tags, file, acc)) return

  const itemDir = dirname(file)
  const itemRel = relative(root, itemDir).split(sep).join('/')
  if (opts.checkImages !== false) {
    checkProseImages(acc, file, itemDir, data.stem)
    checkProseImages(acc, file, itemDir, data.explanation)
    for (const choice of data.choices) checkProseImages(acc, file, itemDir, choice)
    for (const v of Object.values(data.choiceExplanations ?? {})) {
      if (v) checkProseImages(acc, file, itemDir, v)
    }
  }
  if (acc.errors.some((er) => er.file === file)) return // image errors already recorded

  if (acc.byId.has(data.id)) {
    acc.errors.push({ file, message: `duplicate question id "${data.id}"` })
    return
  }
  acc.byId.set(data.id, normalizeQuestion(data, resolved, data.tags, null, itemRel))
}

function loadPassage(acc: Accum, root: string, file: string, opts: ScanOptions): void {
  let raw: unknown
  try {
    raw = loadYaml(readFileSync(file, 'utf8'))
  } catch (e) {
    acc.errors.push({ file, message: `YAML parse error: ${(e as Error).message}` })
    return
  }
  let data
  try {
    data = passageSchema.parse(raw)
  } catch (e) {
    acc.errors.push({ file, message: zodMessage(e) })
    return
  }

  const resolved = resolveTopic(data.topic, file, acc)
  if (!resolved) return
  if (!validateTags(data.tags, file, acc)) return

  const itemDir = dirname(file)
  const itemRel = relative(root, itemDir).split(sep).join('/')
  if (opts.checkImages !== false) {
    checkProseImages(acc, file, itemDir, data.passage)
    for (const q of data.questions) {
      checkProseImages(acc, file, itemDir, q.stem)
      checkProseImages(acc, file, itemDir, q.explanation)
      for (const choice of q.choices) checkProseImages(acc, file, itemDir, choice)
      for (const v of Object.values(q.choiceExplanations ?? {})) {
        if (v) checkProseImages(acc, file, itemDir, v)
      }
    }
  }
  if (acc.errors.some((er) => er.file === file)) return

  if (acc.passagesById.has(data.id)) {
    acc.errors.push({ file, message: `duplicate passage id "${data.id}"` })
    return
  }

  // Accumulate sub-questions locally; only merge into the shared accumulator once
  // the entire passage validates, so a later sub-question error never leaves an
  // orphaned byId entry whose passage was never added to passagesById.
  const questionIds: string[] = []
  const pending = new Map<string, QuestionContent>()
  for (const q of data.questions) {
    // A sub-question's own tags (if any) are validated; otherwise it inherits the
    // passage's tags. Either way it inherits the passage's resolved topic/section.
    const subTags = q.tags.length > 0 ? q.tags : data.tags
    if (q.tags.length > 0 && !validateTags(q.tags, file, acc)) return
    if (acc.byId.has(q.id) || pending.has(q.id)) {
      acc.errors.push({ file, message: `duplicate question id "${q.id}"` })
      return
    }
    pending.set(q.id, normalizeQuestion(q, resolved, subTags, data.id, itemRel))
    questionIds.push(q.id)
  }
  // All sub-questions valid: commit them and the passage together.
  for (const [id, q] of pending) acc.byId.set(id, q)
  acc.passagesById.set(data.id, {
    id: data.id,
    topic: resolved.topic,
    discipline: resolved.discipline,
    section: resolved.section,
    passage: rewriteImagePaths(data.passage, itemRel),
    questionIds
  })
}

function normalizeQuestion(
  q: StandaloneQuestionInput | PassageQuestionInput,
  resolved: ResolvedTopic,
  tags: Tag[],
  passageId: string | null,
  itemRel: string
): QuestionContent {
  const choices = q.choices.map((c) => rewriteImagePaths(c, itemRel)) as [
    string,
    string,
    string,
    string
  ]
  const choiceExplanations: Partial<Record<ChoiceLetter, string>> = {}
  for (const [k, v] of Object.entries(q.choiceExplanations ?? {})) {
    if (v != null) choiceExplanations[k as ChoiceLetter] = rewriteImagePaths(v, itemRel)
  }
  return {
    id: q.id,
    topic: resolved.topic,
    discipline: resolved.discipline,
    section: resolved.section,
    tags,
    passageId,
    stem: rewriteImagePaths(q.stem, itemRel),
    choices,
    correct: q.correct,
    explanation: rewriteImagePaths(q.explanation, itemRel),
    choiceExplanations
  }
}

function zodMessage(e: unknown): string {
  if (e instanceof ZodError) {
    return e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
  }
  return (e as Error).message
}

/** Build the topic/discipline/tag index slices from accumulated questions. */
function buildIndex(acc: Accum): ContentIndex {
  const byTopic = new Map<string, string[]>()
  const byDiscipline = new Map<string, string[]>()
  const byTag = new Map<string, string[]>()
  const allQuestionIds: string[] = []
  // Deterministic order: sort ids so index slices are stable across filesystems.
  const ids = [...acc.byId.keys()].sort()
  for (const id of ids) {
    const q = acc.byId.get(id)
    if (!q) continue
    allQuestionIds.push(id)
    push(byTopic, q.topic, id)
    push(byDiscipline, q.discipline, id)
    for (const t of q.tags) push(byTag, `${t.vocab}:${t.code}`, id)
  }
  // Stable error order: by file then message.
  const errors = [...acc.errors].sort(
    (a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message)
  )
  return {
    byId: acc.byId,
    passagesById: acc.passagesById,
    byTopic,
    byDiscipline,
    byTag,
    allQuestionIds,
    errors
  }
}

function push(map: Map<string, string[]>, key: string, id: string): void {
  const arr = map.get(key)
  if (arr) arr.push(id)
  else map.set(key, [id])
}

/**
 * Scan the content tree, collecting every ContentError (never throws). Walks
 * `<root>/questions/**` for `question.yaml` (standalone) and `<root>/passages/**`
 * for `passage.yaml` (passage sets), at any nesting depth.
 */
export function scanContent(root: string, opts: ScanOptions = {}): ContentIndex {
  const acc = emptyAccum()

  const questionsRoot = join(root, 'questions')
  if (existsSync(questionsRoot)) {
    for (const dir of itemDirs(questionsRoot, 'question.yaml')) {
      loadStandalone(acc, root, join(dir, 'question.yaml'), opts)
    }
  }

  const passagesRoot = join(root, 'passages')
  if (existsSync(passagesRoot)) {
    for (const dir of itemDirs(passagesRoot, 'passage.yaml')) {
      loadPassage(acc, root, join(dir, 'passage.yaml'), opts)
    }
  }

  return buildIndex(acc)
}

/** Scan, then throw a single aggregated Error if any ContentError was reported. */
export function loadContent(root: string, opts: ScanOptions = {}): ContentIndex {
  const index = scanContent(root, opts)
  if (index.errors.length > 0) {
    const detail = index.errors.map((e) => `  ${e.file}: ${e.message}`).join('\n')
    throw new Error(`Content validation failed (${index.errors.length} error(s)):\n${detail}`)
  }
  return index
}
