import { app, BrowserWindow, dialog, protocol } from 'electron'
import { join } from 'path'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import { seedTaxonomy } from './db/seed-taxonomy'
import { registerProfileIpc } from './ipc/profile'
import { registerGamificationIpc } from './ipc/gamification'
import { registerTaxonomyIpc } from './ipc/taxonomy'
import { registerQbankIpc } from './ipc/qbank'
import { ensureStarterGrant } from './repositories/activity'
import { CONTENT_PROTOCOL, registerContentProtocol } from './content/images'
import { loadContent, type LoaderOptions } from './content/loader'
import type { ContentIndex } from './content/types'
import { buildSectionByCode, contentCategoryCodes, skillCodes } from './content/taxonomy-codes'

// The content protocol must be privileged BEFORE app 'ready' (Electron requirement).
protocol.registerSchemesAsPrivileged([
  { scheme: CONTENT_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// In dev, migrations live in the repo's drizzle/ folder. (Prod bundling of this
// folder via electron-builder extraResources is handled in the packaging plan.)
function migrationsFolder(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}

// Authored content: the repo's content/ in dev; bundled under resourcesPath in prod.
function contentRootDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'content') : join(app.getAppPath(), 'content')
}

function emptyIndex(): ContentIndex {
  return {
    byId: new Map(),
    passagesById: new Map(),
    bySection: new Map(),
    byContentCategory: new Map(),
    bySkill: new Map(),
    allQuestionIds: []
  }
}

// Build the in-memory question index from disk. An empty/missing tree yields an empty
// index; any load failure degrades to an empty index (0 questions) rather than crashing boot.
function buildContentIndex(contentRoot: string): ContentIndex {
  const opts: LoaderOptions = {
    sectionByCode: buildSectionByCode(),
    contentCategoryCodes: contentCategoryCodes(),
    skillCodes: skillCodes()
  }
  try {
    return loadContent(contentRoot, opts)
  } catch (e) {
    console.error('[content] failed to load content tree; starting with an empty index:', e)
    return emptyIndex()
  }
}

app.whenReady().then(async () => {
  const dbPath = join(app.getPath('userData'), 'freecat.db')
  const db = createDb(`file:${dbPath}`)
  await runMigrations(db, migrationsFolder())
  await seedTaxonomy(db)
  await ensureStarterGrant(db)

  const contentRoot = contentRootDir()
  registerContentProtocol(contentRoot)
  const index = buildContentIndex(contentRoot)

  registerProfileIpc(db)
  registerGamificationIpc(db)
  registerTaxonomyIpc(db)
  registerQbankIpc(db, index)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => {
  dialog.showErrorBox('FreeCAT failed to start', String(err))
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
