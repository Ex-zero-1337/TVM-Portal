import { app, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { Store } from './store'
import { registerIpc } from './ipc'
import { InboxWatcher, RequestsWatcher } from './inbox'
import { logger } from './logger'

// Keep the userData path stable whether running packaged or via `electron .`
app.setName('tvm-portal')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false, // shown maximized below — avoids a small-window flash
    title: 'TVM Portal',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Open maximized (full screen) by default; the window stays resizable.
  win.maximize()
  win.show()

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const hash = process.env.TVM_PAGE ? `#${process.env.TVM_PAGE}` : ''
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + hash)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash })
  }

  // Headless smoke-test hook: TVM_SCREENSHOT=/path/out.png captures the
  // rendered window and exits, so CI can verify the app actually boots.
  const shot = process.env.TVM_SCREENSHOT
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage()
        fs.writeFileSync(shot, image.toPNG())
        app.quit()
      }, 2000)
    })
  }
}

app.whenReady().then(() => {
  const store = new Store()

  // Centralized logging (SRS v6.3): init + retention, capture uncaught
  // main-process failures, and re-run retention daily while the app is open.
  logger.init(() => store.getSettings())
  logger.write({
    category: 'System',
    module: 'main',
    source: 'index.ts',
    action: 'app-start',
    message: `TVM Portal ${app.getVersion()} started (electron ${process.versions.electron}, ${process.platform})`
  })
  process.on('uncaughtException', (err) =>
    logger.error({ module: 'main', source: 'process', action: 'uncaughtException', message: 'Uncaught exception in main process', error: err })
  )
  process.on('unhandledRejection', (reason) =>
    logger.error({ module: 'main', source: 'process', action: 'unhandledRejection', message: 'Unhandled promise rejection in main process', error: reason })
  )
  const rotateTimer = setInterval(() => logger.rotate(), 24 * 3600 * 1000)

  // Power Automate inbox: new request files appear as live updates in the UI.
  const notifyRenderers = () =>
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('data-changed'))
  const inbox = new InboxWatcher(store, notifyRenderers)
  // Requests are one file each — watch the folder so external adds/deletes
  // (Finder, SharePoint sync) reflect live without an app restart (v6.6.7).
  const requestsWatcher = new RequestsWatcher(store, notifyRenderers)
  registerIpc(store, () => {
    // re-watch when the data folder / requests folder moves
    inbox.start()
    requestsWatcher.start()
  })
  inbox.start()
  requestsWatcher.start()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('will-quit', () => {
    inbox.stop()
    requestsWatcher.stop()
    clearInterval(rotateTimer)
    logger.write({ category: 'System', module: 'main', source: 'index.ts', action: 'app-quit', message: 'TVM Portal shutting down' })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
