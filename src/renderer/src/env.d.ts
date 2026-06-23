/// <reference types="vite/client" />
import type { FreecatApi } from '../../shared/api'

declare global {
  interface Window {
    freecat: FreecatApi
  }
}

export {}
