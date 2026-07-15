import type {
  ProfileDto, GamificationState, ActivityResult, RecordActivityInput, ServiceResult, PetView,
  Outline, LessonDetail, LessonRef, MarkCompleteResult,
  DisciplineTreeDto, TagVocabEntry, StartSessionInput, StartSessionResult,
  SubmitAnswerInput, SubmitAnswerResult, SessionSummary, DashboardStats, QuestionRef,
  DeckSetSummary, DeckNode, ListCardsInput, CardListPage, CardView,
  ReviewCounts, ReviewQueueItem, ReviewRating, ReviewCardResult
} from './dto'

// The qbank submit/flag handlers wrap their result in a ServiceResult (the main process never
// throws across IPC for a not-found question / a flag write); these renderer-facing signatures
// mirror that envelope so callers branch on `.ok`.

export interface FreecatApi {
  profile: { get: () => Promise<ProfileDto>; setName: (name: string) => Promise<ProfileDto> }
  gamification: {
    getState: () => Promise<GamificationState>
    recordActivity: (input: RecordActivityInput) => Promise<ServiceResult<ActivityResult>>
    buyEgg: () => Promise<ServiceResult<null>>
    buyTreat: () => Promise<ServiceResult<null>>
    buyItem: (itemKey: string) => Promise<ServiceResult<null>>
    hatchEgg: () => Promise<ServiceResult<PetView>>
    setActivePet: (petId: number) => Promise<ServiceResult<null>>
    equipItem: (petId: number, itemKey: string) => Promise<ServiceResult<null>>
    unequipItem: (petId: number, itemKey: string) => Promise<ServiceResult<null>>
    renamePet: (petId: number, name: string) => Promise<ServiceResult<null>>
  }
  contentReview: {
    getOutline: () => Promise<Outline>
    getLesson: (slug: string) => Promise<LessonDetail | null>
    markViewed: (slug: string) => Promise<void>
    markComplete: (slug: string, completed: boolean) => Promise<ServiceResult<MarkCompleteResult>>
    lessonForTaxonomy: (ref: string) => Promise<LessonRef | null>
  }
  taxonomy: {
    list: () => Promise<DisciplineTreeDto[]>
    tags: () => Promise<TagVocabEntry[]>
  }
  qbank: {
    startSession: (input: StartSessionInput) => Promise<StartSessionResult>
    submitAnswer: (input: SubmitAnswerInput) => Promise<ServiceResult<SubmitAnswerResult>>
    completeSession: (sessionId: number) => Promise<SessionSummary>
    toggleFlag: (questionId: string) => Promise<ServiceResult<{ flagged: boolean }>>
    dashboard: () => Promise<DashboardStats>
    questionsForTaxonomy: (topicSlug: string) => Promise<QuestionRef[]>
  }
  flashcards: {
    importDeck: () => Promise<ServiceResult<DeckSetSummary>>
    listDeckSets: () => Promise<DeckSetSummary[]>
    listDecks: (deckSetId: number) => Promise<DeckNode[]>
    listCards: (input: ListCardsInput) => Promise<CardListPage>
    getCard: (cardId: number) => Promise<ServiceResult<CardView>>
    deleteDeckSet: (deckSetId: number) => Promise<ServiceResult<null>>
    reviewCounts: (deckId: number) => Promise<ServiceResult<ReviewCounts>>
    nextReviewCard: (deckId: number) => Promise<ServiceResult<ReviewQueueItem>>
    reviewCard: (input: { cardId: number; rating: ReviewRating }) => Promise<ServiceResult<ReviewCardResult>>
  }
}
