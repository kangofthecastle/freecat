import type { ProfileDto, GamificationState, ActivityResult, RecordActivityInput, ServiceResult, PetView } from './dto'

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
}
