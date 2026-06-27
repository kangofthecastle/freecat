import { app, BrowserWindow, dialog, protocol, session } from 'electron'
import { join } from 'path'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import { registerProfileIpc } from './ipc/profile'
import { registerGamificationIpc } from './ipc/gamification'
import { registerContentReviewIpc } from './ipc/content-review'
import { registerTaxonomyIpc } from './ipc/taxonomy'
import { registerQbankIpc } from './ipc/qbank'
import { registerFlashcardsIpc } from './ipc/flashcards'
import { ensureStarterGrant } from './repositories/activity'
import { seedTaxonomy } from './repositories/taxonomy'
import { TOPICS } from './db/seed/taxonomy-data'
import { createLessonStore } from './content/lessons'
import { contentRoot } from './content/root'
import { CONTENT_PROTOCOL, registerContentProtocol } from './content/images'
import { scanContent } from './content/loader'
import type { ContentIndex } from './content/types'
import { createMediaHandler } from './flashcards/media-protocol'
import { flashcardsMediaDir } from './flashcards/paths'

// Privileged schemes must be registered BEFORE app 'ready' (Electron requirement) — one call for all.
protocol.registerSchemesAsPrivileged([
  { scheme: CONTENT_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: 'freecat-media', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false } }
])

// Minimal app-document CSP (O4): production only — a static <meta> would break Vite dev
// HMR (inline scripts + eval + ws). The card iframe carries its own strict CSP regardless.
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: freecat-content:; font-src 'self' data:; frame-src 'self'; connect-src 'self'; " +
  "object-src 'none'; base-uri 'self'"

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

  // Defense-in-depth navigation lockdown (M5): the renderer is a trusted local SPA, so the top
  // frame must never navigate away and no child windows may open. Card content is untrusted but
  // lives in a sandboxed <iframe> with its own strict CSP — this guards the privileged top frame.
  // Deny every window.open / target=_blank / link-driven popup.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    // Dev: allow only the Vite dev-server origin (HMR navigates within it); block the rest.
    const allowedOrigin = new URL(devUrl).origin
    win.webContents.on('will-navigate', (e, url) => {
      if (new URL(url).origin !== allowedOrigin) e.preventDefault()
    })
    win.loadURL(devUrl)
  } else {
    // Prod: the app is loaded from a file:// URL; pin navigation to that exact document.
    const indexHtml = join(__dirname, '../renderer/index.html')
    const allowedUrl = new URL(`file://${indexHtml}`).href
    win.webContents.on('will-navigate', (e, url) => {
      if (url !== allowedUrl) e.preventDefault()
    })
    win.loadFile(indexHtml)
  }
}

// In dev, migrations live in the repo's drizzle/ folder. (Prod bundling of this
// folder via electron-builder extraResources is handled in the packaging plan.)
function migrationsFolder(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}

function emptyIndex(): ContentIndex {
  return {
    byId: new Map(),
    passagesById: new Map(),
    byTopic: new Map(),
    byDiscipline: new Map(),
    byTag: new Map(),
    allQuestionIds: [],
    errors: []
  }
}

// Build the in-memory question index from disk. An empty/missing tree yields an empty
// index. `scanContent` never throws — it collects per-item errors — so a malformed item
// degrades that item (logged) rather than crashing boot; a hard failure also degrades to empty.
function buildContentIndex(root: string): ContentIndex {
  try {
    const index = scanContent(root)
    if (index.errors.length > 0) {
      console.error(`[content] ${index.errors.length} content error(s); affected items were skipped:`)
      for (const e of index.errors) console.error(`  ${e.file}: ${e.message}`)
    }
    return index
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

  const root = contentRoot()
  registerContentProtocol(root)
  const lessonStore = createLessonStore(root, new Set(TOPICS.map((t) => t.slug)))
  const index = buildContentIndex(root)

  registerProfileIpc(db)
  registerGamificationIpc(db)
  registerContentReviewIpc(db, lessonStore)
  registerTaxonomyIpc(db)
  registerQbankIpc(db, index)
  registerFlashcardsIpc(db)

  protocol.handle('freecat-media', createMediaHandler(db, flashcardsMediaDir()))

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [APP_CSP] } })
    })
  }

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
