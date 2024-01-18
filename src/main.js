import { app, shell, BrowserWindow, screen, ipcMain, nativeTheme, dialog, autoUpdater } from 'electron'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import serve from 'electron-serve'
import { createVm, startVm, stopVm, deleteVm } from './vm.js'
import log from 'electron-log/main'
import { extract } from 'tar-fs'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { readdir, mkdir } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'

log.initialize()
log.errorHandler.startCatching()
log.eventLogger.startLogging()
Object.assign(console, log.functions)

const loadURL = (MAIN_WINDOW_VITE_DEV_SERVER_URL && !app.isPackaged)// eslint-disable-line no-undef
  ? null
  : serve({ directory: `./.vite/renderer/${MAIN_WINDOW_VITE_NAME}` }) // eslint-disable-line no-undef

const workshopApiBase = 'https://inspector.local.noop.app:1234'
const noopProtocal = 'noop'
let githubLoginUrl
let mainWindow
let authWindow
let updaterInterval
let projectsDir

let vmStatus = ((!MAIN_WINDOW_VITE_DEV_SERVER_URL && app.isPackaged) || (process.env.npm_lifecycle_event === 'serve')) // eslint-disable-line no-undef
  ? 'PENDING'
  : 'UNKNOWN'

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
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL && !app.isPackaged) { // eslint-disable-line no-undef
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL) // eslint-disable-line no-undef
    // Open the DevTools.
    mainWindow.webContents.openDevTools()
  } else {
    await loadURL(mainWindow)
  }

  if ((!MAIN_WINDOW_VITE_DEV_SERVER_URL && app.isPackaged) || (process.env.npm_lifecycle_event === 'serve')) { // eslint-disable-line no-undef
    await handleVmStatus()
  }
}

const ensureMainWindow = async () => {
  if (!app.isReady()) return
  if (!mainWindow) await createMainWindow()
  return mainWindow
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

const handleVmStatus = async status => {
  if (status && (status !== vmStatus)) vmStatus = status
  mainWindow?.webContents.send('vm-status', vmStatus)
  return vmStatus
}

ipcMain.handle('vm-status', async () => await handleVmStatus())

const handleLogout = async () => {
  await ensureMainWindow()
  await mainWindow.webContents.session.clearStorageData({
    origin: 'https://github.com'
  })
  if (authWindow) authWindow.close()
  githubLoginUrl = null
  return true
}

ipcMain.handle('logout', handleLogout)

const handleSubdirectoryInput = async () => {
  await ensureMainWindow()
  let subdirectory = null
  while (!subdirectory) {
    const returnValue = await dialog.showOpenDialog(mainWindow, {
      title: 'Directory',
      message: 'Select Directory',
      defaultPath: projectsDir,
      buttonLabel: 'Select',
      properties: ['openDirectory', 'createDirectory']
    })
    if (returnValue.canceled) {
      subdirectory = null
      break
    }
    const selected = returnValue?.filePaths?.[0] || null
    if ((selected === projectsDir) || selected?.startsWith(`${projectsDir}/`)) {
      subdirectory = selected
      break
    }
    await dialog.showMessageBox(mainWindow, {
      title: 'Directory',
      message: `Configuration ${returnValue.filePaths[0] ? 'Invalid' : 'Needed'}`,
      detail: 'Selected directory must be scoped within the current Projects Directory. Please try again.',
      buttons: ['Next'],
      type: 'warning'
    })
  }
  return subdirectory
}

ipcMain.handle('subdirectory-input', handleSubdirectoryInput)

const handleCloneRepository = async (_event, { repositoryUrl, subdirectory }) => {
  if (!((subdirectory === projectsDir) || subdirectory?.startsWith(`${projectsDir}/`))) {
    throw Error('Selected directory must be scoped within the current Projects Directory.')
  }
  await ensureMainWindow()
  const directoryName = repositoryUrl.split('/').at(-1).split('.git')[0]
  const files = await readdir(subdirectory)
  let num = 1
  while (files.find(file => file === `${directoryName}${num === 1 ? '' : `-${num}`}`)) {
    num++
  }
  const foundDirectory = join(subdirectory, `${directoryName}${num === 1 ? '' : `-${num}`}`)
  await mkdir(foundDirectory, { recursive: true })
  const res1 = await fetch(`${workshopApiBase}/local/repos/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl })
  })
  const tarStream = Readable.fromWeb(res1.body)
  const tarExtractor = extract(foundDirectory)
  await finished(tarStream.pipe(tarExtractor))
  const url = pathToFileURL(foundDirectory.replace(projectsDir, '/noop/projects')).href
  const res2 = await fetch(`${workshopApiBase}/local/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  const repo = await res2.json()
  return repo
}

ipcMain.handle('clone-repository', handleCloneRepository)

const handleShowItemInFolder = async (_event, url) => {
  if ((url === 'file:///noop/projects') || url?.startsWith('file:///noop/projects/')) {
    url = url.replace('/noop/projects', projectsDir)
  }
  shell.showItemInFolder(fileURLToPath(url))
}

ipcMain.handle('show-item-in-folder', handleShowItemInFolder)

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

app.on('before-quit', async event => {
  if (((!MAIN_WINDOW_VITE_DEV_SERVER_URL && app.isPackaged) || (process.env.npm_lifecycle_event === 'serve')) && !['PENDING', 'DELETED'].includes(vmStatus)) { // eslint-disable-line no-undef
    event.preventDefault()
    clearInterval(updaterInterval)
    try {
      await handleVmStatus('STOPPING')
      await stopVm()
    } catch (error) {
      // dialog.showErrorBox(`STOP ${error?.name}`, error?.message)
    }
    await handleVmStatus('STOPPED')
    try {
      await handleVmStatus('DELETING')
      await deleteVm()
    } catch (error) {
      // dialog.showErrorBox(`DELETE ${error?.name}`, error?.message)
    }
    await handleVmStatus('DELETED')
    app.quit()
  }
});

(async () => {
  await app.whenReady()
  await createMainWindow()

  if ((!MAIN_WINDOW_VITE_DEV_SERVER_URL && app.isPackaged) || (process.env.npm_lifecycle_event === 'serve')) { // eslint-disable-line no-undef
    await dialog.showMessageBox(mainWindow, {
      title: 'Projects Directory',
      message: 'Configuration Needed',
      detail: 'Noop Workshop will automatically discover compatiable projects on your machine. Select the root-level Projects Directory to use for this session.',
      buttons: ['Next'],
      type: 'info'
    })

    while (!projectsDir) {
      const returnValue = await dialog.showOpenDialog(mainWindow, {
        title: 'Projects Directory',
        message: 'Select Projects Directory',
        defaultPath: homedir(),
        buttonLabel: 'Select',
        properties: ['openDirectory', 'createDirectory']
      })
      if (!returnValue.canceled && returnValue.filePaths.length) {
        projectsDir = returnValue.filePaths[0]
      } else {
        await dialog.showMessageBox(mainWindow, {
          title: 'Projects Directory',
          message: 'Configuration Needed',
          detail: 'Selecting a Projects Directory is required. Please try again.',
          buttons: ['Next'],
          type: 'warning'
        })
      }
    }

    console.log('Project Directory', projectsDir)

    try {
      await handleVmStatus('CREATING')
      await createVm({ projectsDir })
    } catch (error) {
      // dialog.showErrorBox(error?.name, error?.message)
    }
    await handleVmStatus('CREATED')
    try {
      await handleVmStatus('STARTING')
      await startVm()
      mainWindow.webContents.send('workshop-started')
    } catch (error) {
      // dialog.showErrorBox(error?.name, error?.message)
    }
    await handleVmStatus('STARTED')
  } else {
    projectsDir = homedir()
  }

  const version = app.getVersion()

  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL && app.isPackaged && !version.includes('-')) { // eslint-disable-line no-undef
    const server = 'https://update.electronjs.org'
    const repo = 'noop-inc/desktop'
    const platform = process.platform
    const arch = process.arch
    const url = `${server}/${repo}/${platform}-${arch}/${version}`

    console.log('Auto Updater Feed URL', url)

    autoUpdater.setFeedURL({ url })

    autoUpdater.on('error', error => {
      console.log('updater error')
      console.log(error)
    })
    autoUpdater.on('checking-for-update', () => {
      console.log('checking-for-update')
    })
    autoUpdater.on('update-available', () => {
      console.log('update-available; downloading...')
    })
    autoUpdater.on('update-not-available', () => {
      console.log('update-not-available')
    })
    autoUpdater.on('before-quit-for-update', () => {
      console.log('before-quit-for-update')
    })

    autoUpdater.on('update-downloaded', async (event, releaseNotes, releaseName, releaseDate, updateURL) => {
      console.log('update-downloaded', [event, releaseNotes, releaseName, releaseDate, updateURL])
      await ensureMainWindow()
      const returnValue = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart', 'Later'],
        title: 'Application Update',
        message: process.platform === 'win32' ? releaseNotes : releaseName,
        detail: 'A new version has been downloaded. Restart the application to apply the updates.'
      })
      if (returnValue.response === 0) {
        clearInterval(updaterInterval)
        if (!['PENDING', 'DELETED'].includes(vmStatus)) {
          try {
            await handleVmStatus('STOPPING')
            await stopVm()
          } catch (error) {
            // dialog.showErrorBox(`STOP ${error?.name}`, error?.message)
          }
          await handleVmStatus('STOPPED')
          try {
            await handleVmStatus('DELETING')
            await deleteVm()
          } catch (error) {
            // dialog.showErrorBox(`DELETE ${error?.name}`, error?.message)
          }
          await handleVmStatus('DELETED')
        }
        autoUpdater.quitAndInstall()
      }
    })

    autoUpdater.checkForUpdates()
    updaterInterval = setInterval(() => {
      autoUpdater.checkForUpdates()
    }, 1000 * 60 * 10)
  }
})()
