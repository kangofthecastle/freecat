interface ProfileDto {
  id: number
  displayName: string
  createdAt: Date
}

declare global {
  interface Window {
    freecat: {
      profile: {
        get: () => Promise<ProfileDto>
        setName: (name: string) => Promise<ProfileDto>
      }
    }
  }
}

export {}
