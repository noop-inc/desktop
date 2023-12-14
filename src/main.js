import { app, shell, BrowserWindow, screen, ipcMain, nativeTheme, dialog } from 'electron'
import { join, resolve } from 'node:path'
import serve from 'electron-serve'
import { createVm, startVm, stopVm, deleteVm } from './vm.js'

const loadURL = MAIN_WINDOW_VITE_DEV_SERVER_URL // eslint-disable-line no-undef
  ? null
  : serve({ directory: `./.vite/renderer/${MAIN_WINDOW_VITE_NAME}` }) // eslint-disable-line no-undef

const noopProtocal = 'noop'
let githubLoginUrl
let mainWindow
let authWindow

const createMainWindow = async () => {
  await app.whenReady()
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: width < 1280 ? width : 1280,
    height: height < 720 ? height : 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#212121',
    webPreferences: {
      preload: join(__dirname, 'preload.js')
    }
  })

  mainWindow.on('will-resize', (event, newBounds) => {
    if (authWindow) {
      const { width, height } = newBounds
      authWindow.setBounds({ width: Math.floor(Math.min(width - 32, 460)), height: Math.floor(Math.min(height - 64, 900)) })
    }
  })

  mainWindow.once('closed', () => {
    mainWindow = null
  })

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) { // eslint-disable-line no-undef
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL) // eslint-disable-line no-undef
    // Open the DevTools.
    mainWindow.webContents.openDevTools()
  } else {
    await loadURL(mainWindow)
  }
}

const ensureMainWindow = async () => {
  await app.whenReady()
  if (!mainWindow) await createMainWindow()
}

const createAuthWindow = async () => {
  await app.whenReady()
  await ensureMainWindow()
  const { width, height } = mainWindow.getBounds()
  authWindow = new BrowserWindow({
    width: Math.floor(Math.min(width - 32, 460)),
    height: Math.floor(Math.min(height - 32, 900)),
    resizable: false,
    parent: mainWindow,
    modal: true,
    backgroundColor: nativeTheme.shouldUseDarkColors
      ? '#161b22'
      : '#ffffff'
  })
  authWindow.once('closed', () => {
    authWindow = null
  })
  authWindow.webContents.on('before-input-event', (event, input) => {
    const { type, key } = input
    if ((type === 'keyUp') && (key === 'Escape')) authWindow.close()
  })
}

const ensureAuthWindow = async () => {
  await app.whenReady()
  if (!authWindow) await createAuthWindow()
}

const handleUpdateRoute = async url => {
  url = new URL(url)
  const { hostname, pathname, search } = url
  url = `/${hostname}${pathname}${search}`
  await ensureMainWindow()
  mainWindow.webContents.send('update-route', url)
  if (authWindow) authWindow.close()
}

const handleLogout = async () => {
  await ensureMainWindow()
  await mainWindow.webContents.session.clearStorageData({
    origin: 'https://github.com'
  })
  if (authWindow) authWindow.close()
  githubLoginUrl = null
}

ipcMain.handle('logout', async () => handleLogout())

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(noopProtocal, process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(noopProtocal)
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', async (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    await handleUpdateRoute(commandLine.pop().slice(0, -1))
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  // app.on('ready', createMainWindow)

  app.on('open-url', async (event, url) => {
    await handleUpdateRoute(url)
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', async () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    await ensureMainWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// app.on('certificate-error', async (event, webContents, url, error, certificate, done) => {
//   // if (url.startsWith('https://localhost:1234/') && (process.env.NODE_ENV === 'development')) {
//   if (url.startsWith('https://inspector.local.noop.app:1234')) {
//     // bypass cert error if localhost and dev mode
//     event.preventDefault()
//     done(true)
//   } else {
//     // otherwise block request
//     done(false)
//   }
// })

app.on('web-contents-created', async (event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const openExternalWindow = async () => {
      if (url.startsWith(githubLoginUrl)) {
        if (authWindow) {
          authWindow.loadURL(url)
          authWindow.show()
        } else {
          await ensureAuthWindow()
          authWindow.loadURL(url)
        }
      } else {
        shell.openExternal(url)
      }
    }

    setImmediate(async () => {
      if (githubLoginUrl) {
        openExternalWindow()
      } else {
        const metadataString = await mainWindow.webContents.executeJavaScript('localStorage.getItem("NOOP_METADATA");')
        const metadataParsed = metadataString ? JSON.parse(metadataString) : {}
        githubLoginUrl = metadataParsed?.githubLoginUrl
        await openExternalWindow()
      }
    })
    return { action: 'deny' }
  })
})

let stopped
let deleted

app.on('before-quit', async event => {
  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL && !stopped && !deleted) { // eslint-disable-line no-undef
    event.preventDefault()
    try {
      await stopVm()
      stopped = true
    } catch (error) {
      dialog.showErrorBox(`STOP ${error?.name}`, error?.message)
    }
    try {
      await deleteVm()
      deleted = true
    } catch (error) {
      dialog.showErrorBox(`DELETE ${error?.name}`, error?.message)
    }
    app.quit()
  }
});

(async () => {
  await app.whenReady()
  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) { // eslint-disable-line no-undef
    try {
      await createVm()
    } catch (error) {
      dialog.showErrorBox(error?.name, error?.message)
    }
    try {
      await startVm()
    } catch (error) {
      dialog.showErrorBox(error?.name, error?.message)
    }
  }
  await createMainWindow()
})()
