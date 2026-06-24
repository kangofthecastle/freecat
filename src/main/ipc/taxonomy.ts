import { ipcMain } from 'electron'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import { listAll } from '../repositories/taxonomy'

export function registerTaxonomyIpc(db: DB): void {
  ipcMain.handle(CH.taxonomyList, () => listAll(db))
}
