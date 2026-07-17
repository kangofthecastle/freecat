import { z } from 'zod'

const choiceLetter = z.enum(['A', 'B', 'C', 'D'])

// choices: exactly 4 non-empty strings.
const choices = z.tuple([
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

// A single multi-vocabulary content tag, e.g. { vocab: 'aamc', code: '1A' }.
const tag = z.object({ vocab: z.string().min(1), code: z.string().min(1) }).strict()

// Fields common to every question (standalone or passage sub-question).
const questionBase = {
  id: z.string().min(1),
  stem: z.string().min(1),
  choices,
  correct: choiceLetter,
  explanation: z.string().min(1),
  choiceExplanations,
  tags: z.array(tag).default([]),
  // Author-declared difficulty tier; unstated = 'medium', so the whole bank is diagnostic-eligible
  // by default and authors only ever tag the outliers.
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium')
}

// A standalone question carries its own required primary topic.
export const standaloneQuestionSchema = z.object({ ...questionBase, topic: z.string().min(1) }).strict()

// A passage sub-question inherits the passage's topic; it may carry its own tags.
export const passageQuestionSchema = z.object({ ...questionBase }).strict()

// A passage: one required primary topic, optional tags, and 1+ sub-questions.
export const passageSchema = z
  .object({
    id: z.string().min(1),
    topic: z.string().min(1),
    tags: z.array(tag).default([]),
    passage: z.string().min(1),
    questions: z.array(passageQuestionSchema).min(1)
  })
  .strict()

export type StandaloneQuestionInput = z.infer<typeof standaloneQuestionSchema>
export type PassageQuestionInput = z.infer<typeof passageQuestionSchema>
export type PassageInput = z.infer<typeof passageSchema>
