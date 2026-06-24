import type { ChoiceLetter, DisciplineKey, Tag } from '../../shared/dto'

/** MCAT test section, derived from a discipline (no CARS). */
export type SectionCode = 'chem-phys' | 'bio-biochem' | 'psych-soc'

export interface QuestionContent {
  id: string
  topic: string // primary topic slug (e.g. 'biochem.enzymes')
  discipline: DisciplineKey // derived from the topic's parent discipline
  section: SectionCode // derived from the discipline
  tags: Tag[] // 0+ (e.g. [{ vocab: 'aamc', code: '1A' }])
  passageId: string | null
  stem: string
  choices: [string, string, string, string]
  correct: ChoiceLetter
  explanation: string
  choiceExplanations: Partial<Record<ChoiceLetter, string>>
}

export interface PassageContent {
  id: string
  topic: string
  discipline: DisciplineKey
  section: SectionCode
  passage: string
  questionIds: string[] // ordered
}

export interface ContentIndex {
  byId: Map<string, QuestionContent>
  passagesById: Map<string, PassageContent>
  byTopic: Map<string, string[]> // topicSlug -> questionIds
  byDiscipline: Map<string, string[]> // DisciplineKey -> questionIds
  byTag: Map<string, string[]> // `${vocab}:${code}` -> questionIds
  allQuestionIds: string[]
  errors: { file: string; message: string }[]
}
