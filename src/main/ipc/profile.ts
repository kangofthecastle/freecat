import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { getOrCreateProfile, setProfileName } from '../repositories/profile'

export const setNameSchema = z.string().min(1).max(40)

export function registerProfileIpc(db: DB): void {
  ipcMain.handle('profile:get', () => getOrCreateProfile(db))
  ipcMain.handle('profile:setName', (_event, rawName: unknown) => {
    const name = setNameSchema.parse(rawName)
    return setProfileName(db, name)
  })
}
