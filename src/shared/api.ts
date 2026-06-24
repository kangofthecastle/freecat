import type {
  ProfileDto, GamificationState, ActivityResult, RecordActivityInput, ServiceResult, PetView,
  TaxonomyNodeDto, ComposerData, StartSessionInput, StartSessionResult,
  SubmitAnswerInput, SubmitAnswerResult, SessionSummary, DashboardStats
} from './dto'

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
  taxonomy: {
    list: () => Promise<TaxonomyNodeDto[]>
  }
  qbank: {
    getComposerData: () => Promise<ComposerData>
    startSession: (input: StartSessionInput) => Promise<StartSessionResult>
    submitAnswer: (input: SubmitAnswerInput) => Promise<ServiceResult<SubmitAnswerResult>>
    completeSession: (sessionId: number) => Promise<SessionSummary>
    toggleFlag: (questionId: string) => Promise<ServiceResult<{ flagged: boolean }>>
    getDashboard: () => Promise<DashboardStats>
  }
}
