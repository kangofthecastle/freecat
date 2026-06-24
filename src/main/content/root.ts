import { app } from 'electron'
import { join } from 'node:path'

/** Bundled content lives in resources (prod) or the repo `content/` dir (dev). */
export function contentRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'content') : join(app.getAppPath(), 'content')
}
