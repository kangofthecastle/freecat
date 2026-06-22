import { ipcMain } from 'electron'
import { z } from 'zod'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { recordActivity, appTz } from '../repositories/activity'
import { buyEgg, buyTreat, buyItem, hatchEgg, setActivePet, equipItem, unequipItem, renamePet, getGamificationState } from '../repositories/pets'

export const recordActivitySchema = z.object({
  kind: z.string().min(1).max(64),
  count: z.number().int().positive().max(10_000).optional(),
  taxonomyRef: z.string().min(1).max(128).optional()
})
export const itemKeySchema = z.string().min(1).max(64)
export const petIdSchema = z.number().int().positive()
export const renameSchema = z.object({ petId: z.number().int().positive(), name: z.string().max(24) })
const equipSchema = z.object({ petId: z.number().int().positive(), itemKey: z.string().min(1).max(64) })

export function registerGamificationIpc(db: DB): void {
  ipcMain.handle(CH.gamGetState, () => getGamificationState(db, new Date(), appTz()))
  ipcMain.handle(CH.gamRecordActivity, (_e, raw: unknown) => recordActivity(db, recordActivitySchema.parse(raw)))
  ipcMain.handle(CH.gamBuyEgg, () => buyEgg(db, new Date()))
  ipcMain.handle(CH.gamBuyTreat, () => buyTreat(db, new Date()))
  ipcMain.handle(CH.gamBuyItem, (_e, raw: unknown) => buyItem(db, itemKeySchema.parse(raw), new Date()))
  ipcMain.handle(CH.gamHatchEgg, () => hatchEgg(db, new Date()))
  ipcMain.handle(CH.gamSetActivePet, (_e, raw: unknown) => setActivePet(db, petIdSchema.parse(raw)))
  ipcMain.handle(CH.gamEquipItem, (_e, raw: unknown) => { const p = equipSchema.parse(raw); return equipItem(db, p.petId, p.itemKey) })
  ipcMain.handle(CH.gamUnequipItem, (_e, raw: unknown) => { const p = equipSchema.parse(raw); return unequipItem(db, p.petId, p.itemKey) })
  ipcMain.handle(CH.gamRenamePet, (_e, raw: unknown) => { const p = renameSchema.parse(raw); return renamePet(db, p.petId, p.name) })
}
