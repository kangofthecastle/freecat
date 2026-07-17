import { ipcMain } from 'electron'
import type { DB } from '../db/client'
import type { ContentIndex } from '../content/types'
import { CH } from '../../shared/channels'
import { getStatsOverview } from '../repositories/stats'

export interface StatsIpcOptions {
  /** Injected clock for testability; defaults to wall-clock. */
  now?: () => Date
}

/** One zero-arg read-only channel; the payload is ignored (same posture as the old
 *  qbank:dashboard this module absorbs). A repository throw propagates as an IPC rejection —
 *  the Stats page catches and shows its retry state. */
export function registerStatsIpc(db: DB, index: ContentIndex, opts: StatsIpcOptions = {}): void {
  const now = opts.now ?? (() => new Date())
  ipcMain.handle(CH.statsOverview, () => getStatsOverview(db, index, { now: now() }))
}
