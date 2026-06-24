import type { ChoiceLetter } from '../../shared/dto'

export type SectionCode = 'chem-phys' | 'cars' | 'bio-biochem' | 'psych-soc'

export interface QuestionContent {
  id: string
  section: SectionCode
  contentCategory: string | null // set for science sections
  skill: string | null // set for CARS
  topics: string[]
  passageId: string | null
  stem: string
  choices: [string, string, string, string]
  correct: ChoiceLetter
  explanation: string
  choiceExplanations: Partial<Record<ChoiceLetter, string>>
}

export interface PassageContent {
  id: string
  section: SectionCode
  passage: string
  questionIds: string[] // ordered
}

export interface ContentIndex {
  byId: Map<string, QuestionContent>
  passagesById: Map<string, PassageContent>
  bySection: Map<string, string[]> // sectionCode -> questionIds
  byContentCategory: Map<string, string[]> // ccCode -> questionIds
  bySkill: Map<string, string[]> // skillCode -> questionIds
  allQuestionIds: string[]
}
