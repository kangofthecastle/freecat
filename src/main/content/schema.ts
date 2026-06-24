import { z } from 'zod'

const choiceLetter = z.enum(['A', 'B', 'C', 'D'])

// choices: exactly 4 non-empty strings.
const choices = z
  .tuple([
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
    z.string().min(1)
  ])

// choiceExplanations: optional, keys restricted to A-D, non-empty string values.
const choiceExplanations = z
  .object({
    A: z.string().min(1),
    B: z.string().min(1),
    C: z.string().min(1),
    D: z.string().min(1)
  })
  .partial()
  .strict()
  .optional()

// Fields common to every question (standalone or passage sub-question), minus the taxonomy tag.
const questionBase = {
  id: z.string().min(1),
  topics: z.array(z.string()).default([]),
  stem: z.string().min(1),
  choices,
  correct: choiceLetter,
  explanation: z.string().min(1),
  choiceExplanations
}

// At most one of contentCategory / skill set (for sub-questions, where the tag is optional).
function atMostOneTag(v: { contentCategory?: string; skill?: string }): boolean {
  return !(v.contentCategory != null && v.skill != null)
}
// Exactly one of contentCategory / skill set (for top-level items).
function exactlyOneTag(v: { contentCategory?: string; skill?: string }): boolean {
  return (v.contentCategory != null) !== (v.skill != null)
}
const ONE_TAG_MSG = 'exactly one of contentCategory or skill is required'
const AT_MOST_ONE_TAG_MSG = 'set at most one of contentCategory or skill'

export const standaloneQuestionSchema = z
  .object({
    ...questionBase,
    contentCategory: z.string().min(1).optional(),
    skill: z.string().min(1).optional()
  })
  .strict()
  .refine(exactlyOneTag, { message: ONE_TAG_MSG, path: ['contentCategory'] })

// A passage sub-question: same fields, but the tag is optional (inherits the passage's) and
// may be overridden by at most one of contentCategory / skill.
export const passageQuestionSchema = z
  .object({
    ...questionBase,
    contentCategory: z.string().min(1).optional(),
    skill: z.string().min(1).optional()
  })
  .strict()
  .refine(atMostOneTag, { message: AT_MOST_ONE_TAG_MSG, path: ['contentCategory'] })

export const passageSchema = z
  .object({
    id: z.string().min(1),
    topics: z.array(z.string()).default([]),
    contentCategory: z.string().min(1).optional(),
    skill: z.string().min(1).optional(),
    passage: z.string().min(1),
    questions: z.array(passageQuestionSchema).min(1)
  })
  .strict()
  .refine(exactlyOneTag, { message: ONE_TAG_MSG, path: ['contentCategory'] })

export type StandaloneQuestionInput = z.infer<typeof standaloneQuestionSchema>
export type PassageQuestionInput = z.infer<typeof passageQuestionSchema>
export type PassageInput = z.infer<typeof passageSchema>
