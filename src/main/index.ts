import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'

// Main and preload build to CommonJS (package.json deliberately has no
// "type": "module"), matching the electron-vite default. That keeps `__dirname`
// available here and keeps the preload a plain .js the way BrowserWindow's
// `preload` path expects.

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d0e',
    // Frame is kept native: audio work benefits from predictable window
    // behaviour more than it does from a custom titlebar.
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Anything the app links out to opens in the user's browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Chromium asks the app whether to grant getUserMedia. We only ever want the
 * microphone, so everything else is denied outright rather than passed through.
 */
function installPermissionHandlers(): void {
  const session = mainWindow?.webContents.session
  session?.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  // Chromium also runs a synchronous *check* on some paths into getUserMedia,
  // and the default answer is not a grant. Without this the microphone can be
  // refused without the request handler above ever being consulted.
  session?.setPermissionCheckHandler((_wc, permission) => permission === 'media')
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.snowy.voicepack')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  registerIpc(() => mainWindow)
  createWindow()
  installPermissionHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
