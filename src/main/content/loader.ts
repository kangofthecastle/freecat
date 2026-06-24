import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { load } from 'js-yaml'
import { ZodError } from 'zod'
import type { ContentIndex, PassageContent, QuestionContent, SectionCode } from './types'
import type { ChoiceLetter } from '../../shared/dto'
import {
  standaloneQuestionSchema,
  passageSchema,
  type StandaloneQuestionInput,
  type PassageQuestionInput
} from './schema'
import { rewriteImagePaths } from './images'

export interface ContentError {
  file: string
  message: string
}
export interface LoaderOptions {
  sectionByCode: Map<string, SectionCode>
  contentCategoryCodes: Set<string>
  skillCodes: Set<string>
  checkImages?: boolean // default true
}
export interface ScanResult {
  index: ContentIndex
  errors: ContentError[]
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

/** List immediate subdirectory names of `dir` (empty if `dir` is absent). */
function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

interface EmptyAccum {
  byId: Map<string, QuestionContent>
  passagesById: Map<string, PassageContent>
  errors: ContentError[]
}

function emptyAccum(): EmptyAccum {
  return { byId: new Map(), passagesById: new Map(), errors: [] }
}

/** Resolve+validate the taxonomy tag for an item; returns the derived section or pushes an error. */
function resolveTag(
  acc: EmptyAccum,
  file: string,
  opts: LoaderOptions,
  tag: { contentCategory?: string; skill?: string },
  folderSection: string
): { section: SectionCode; contentCategory: string | null; skill: string | null } | null {
  const code = tag.contentCategory ?? tag.skill
  if (!code) {
    acc.errors.push({ file, message: 'missing taxonomy tag (contentCategory or skill)' })
    return null
  }
  if (tag.contentCategory && !opts.contentCategoryCodes.has(tag.contentCategory)) {
    acc.errors.push({ file, message: `unknown content-category code "${tag.contentCategory}"` })
    return null
  }
  if (tag.skill && !opts.skillCodes.has(tag.skill)) {
    acc.errors.push({ file, message: `unknown skill code "${tag.skill}"` })
    return null
  }
  const section = opts.sectionByCode.get(code)
  if (!section) {
    acc.errors.push({ file, message: `code "${code}" does not resolve to a section` })
    return null
  }
  if (section !== folderSection) {
    acc.errors.push({
      file,
      message: `derived section "${section}" does not match folder section "${folderSection}"`
    })
    return null
  }
  return {
    section,
    contentCategory: tag.contentCategory ?? null,
    skill: tag.skill ?? null
  }
}

/** Check every relative image referenced by `prose` exists under `itemDir`; push errors if not. */
function checkProseImages(acc: EmptyAccum, file: string, itemDir: string, prose: string): void {
  for (const target of relativeImageTargets(prose)) {
    const abs = join(itemDir, target)
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      acc.errors.push({ file, message: `referenced image not found: ${target}` })
    }
  }
}

function loadStandalone(acc: EmptyAccum, root: string, file: string, folderSection: string, opts: LoaderOptions): void {
  let raw: unknown
  try {
    raw = load(readFileSync(file, 'utf8'))
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
  const resolved = resolveTag(acc, file, opts, data, folderSection)
  if (!resolved) return

  const itemDir = file.slice(0, file.length - '/question.yaml'.length)
  const itemRel = relative(root, itemDir).split(sep).join('/')
  const checkImages = opts.checkImages !== false
  if (checkImages) {
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
  acc.byId.set(data.id, normalizeQuestion(data, resolved, null, itemRel))
}

function loadPassage(acc: EmptyAccum, root: string, file: string, folderSection: string, opts: LoaderOptions): void {
  let raw: unknown
  try {
    raw = load(readFileSync(file, 'utf8'))
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
  const passageTag = resolveTag(acc, file, opts, data, folderSection)
  if (!passageTag) return

  const itemDir = file.slice(0, file.length - '/passage.yaml'.length)
  const itemRel = relative(root, itemDir).split(sep).join('/')
  const checkImages = opts.checkImages !== false
  if (checkImages) {
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

  const questionIds: string[] = []
  for (const q of data.questions) {
    // Resolve the sub-question's effective tag: override if present, else inherit the passage's.
    const overrides = q.contentCategory != null || q.skill != null
    let subTag: { section: SectionCode; contentCategory: string | null; skill: string | null } | null
    if (overrides) {
      subTag = resolveTag(acc, file, opts, q, folderSection)
      if (!subTag) return
    } else {
      subTag = passageTag
    }
    if (acc.byId.has(q.id)) {
      acc.errors.push({ file, message: `duplicate question id "${q.id}"` })
      return
    }
    acc.byId.set(q.id, normalizeQuestion(q, subTag, data.id, itemRel))
    questionIds.push(q.id)
  }
  acc.passagesById.set(data.id, {
    id: data.id,
    section: passageTag.section,
    passage: rewriteImagePaths(data.passage, itemRel),
    questionIds
  })
}

function normalizeQuestion(
  q: StandaloneQuestionInput | PassageQuestionInput,
  tag: { section: SectionCode; contentCategory: string | null; skill: string | null },
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
    section: tag.section,
    contentCategory: tag.contentCategory,
    skill: tag.skill,
    topics: q.topics,
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
    return e.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
  }
  return (e as Error).message
}

/** Build the full ContentIndex from accumulated questions/passages. */
function buildIndex(acc: EmptyAccum): ContentIndex {
  const bySection = new Map<string, string[]>()
  const byContentCategory = new Map<string, string[]>()
  const bySkill = new Map<string, string[]>()
  const allQuestionIds: string[] = []
  // Deterministic order: sort ids so index slices are stable across filesystems.
  const ids = [...acc.byId.keys()].sort()
  for (const id of ids) {
    const q = acc.byId.get(id)
    if (!q) continue
    allQuestionIds.push(id)
    push(bySection, q.section, id)
    if (q.contentCategory) push(byContentCategory, q.contentCategory, id)
    if (q.skill) push(bySkill, q.skill, id)
  }
  return {
    byId: acc.byId,
    passagesById: acc.passagesById,
    bySection,
    byContentCategory,
    bySkill,
    allQuestionIds
  }
}

function push(map: Map<string, string[]>, key: string, id: string): void {
  const arr = map.get(key)
  if (arr) arr.push(id)
  else map.set(key, [id])
}

/** Scan the content tree, collecting every ContentError (never throws). */
export function scanContent(root: string, opts: LoaderOptions): ScanResult {
  const acc = emptyAccum()

  const questionsRoot = join(root, 'questions')
  for (const section of subdirs(questionsRoot)) {
    const sectionDir = join(questionsRoot, section)
    for (const id of subdirs(sectionDir)) {
      const file = join(sectionDir, id, 'question.yaml')
      if (existsSync(file)) loadStandalone(acc, root, file, section, opts)
    }
  }

  const passagesRoot = join(root, 'passages')
  for (const section of subdirs(passagesRoot)) {
    const sectionDir = join(passagesRoot, section)
    for (const id of subdirs(sectionDir)) {
      const file = join(sectionDir, id, 'passage.yaml')
      if (existsSync(file)) loadPassage(acc, root, file, section, opts)
    }
  }

  // Stable error order: by file then message.
  acc.errors.sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message))
  return { index: buildIndex(acc), errors: acc.errors }
}

/** Scan, then throw a single aggregated Error if any ContentError was reported. */
export function loadContent(root: string, opts: LoaderOptions): ContentIndex {
  const { index, errors } = scanContent(root, opts)
  if (errors.length > 0) {
    const detail = errors.map((e) => `  ${e.file}: ${e.message}`).join('\n')
    throw new Error(`Content validation failed (${errors.length} error(s)):\n${detail}`)
  }
  return index
}
