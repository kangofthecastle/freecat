import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import { registerProfileIpc } from './ipc/profile'

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

app.whenReady().then(async () => {
  const dbPath = join(app.getPath('userData'), 'freecat.db')
  const db = createDb(`file:${dbPath}`)
  await runMigrations(db, migrationsFolder())
  registerProfileIpc(db)

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
