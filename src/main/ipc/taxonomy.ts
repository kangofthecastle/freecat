import { ipcMain } from 'electron'
import type { DB } from '../db/client'
import { CH } from '../../shared/channels'
import type { DisciplineTreeDto, TagVocabEntry } from '../../shared/dto'
import { listDisciplinesWithTopics } from '../repositories/taxonomy'
import { CONTENT_TAG_VOCAB } from '../content/tags'

export function registerTaxonomyIpc(db: DB): void {
  // The discipline→topic scope tree served to the Qbank composer/dashboard.
  // `listDisciplinesWithTopics` returns `{ discipline, title, topics:[{slug,title,aamcCodes}] }`,
  // which is structurally `DisciplineTreeDto[]`.
  ipcMain.handle(CH.taxonomyList, async (): Promise<DisciplineTreeDto[]> => listDisciplinesWithTopics(db))

  // The AAMC content-category tag vocabulary (read-only, static).
  ipcMain.handle(CH.taxonomyTags, async (): Promise<TagVocabEntry[]> => [...CONTENT_TAG_VOCAB])
}
