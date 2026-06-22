import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { getOrCreateProfile, setProfileName } from '../repositories/profile'

export const setNameSchema = z.string().min(1).max(40)

export function registerProfileIpc(db: DB): void {
  ipcMain.handle(CH.profileGet, () => getOrCreateProfile(db))
  ipcMain.handle(CH.profileSetName, (_event, rawName: unknown) => {
    const name = setNameSchema.parse(rawName)
    return setProfileName(db, name)
  })
}
