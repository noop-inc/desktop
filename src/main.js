import { app, shell, BrowserWindow, screen, ipcMain, nativeTheme, dialog, autoUpdater } from 'electron'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import serve from 'electron-serve'
import VM from './VM.js'
import log from 'electron-log/main'
import { extract } from 'tar-fs'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { readdir, mkdir } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import FileWatcher from './FileWatcher.js'
import { inspect } from 'node:util'

log.initialize()
log.errorHandler.startCatching()
log.eventLogger.startLogging()
Object.assign(console, log.functions)

const {
  npm_lifecycle_event: npmLifecycleEvent
} = process.env

const managingVm = ((!MAIN_WINDOW_VITE_DEV_SERVER_URL && app.isPackaged) || (npmLifecycleEvent === 'serve')) // eslint-disable-line no-undef

const vm = managingVm ? new VM() : null

const formatter = (...messages) =>
  console[messages[0].event.includes('.error') ? 'error' : 'log'](
    ...messages.map(message =>
      inspect(
        message,
        { breakLength: 10000, colors: true, compact: true, depth: null }
      )
    )
  )

const loadURL = (MAIN_WINDOW_VITE_DEV_SERVER_URL && !app.isPackaged) // eslint-disable-line no-undef
  ? null
  : serve({ directory: `./.vite/renderer/${MAIN_WINDOW_VITE_NAME}` }) // eslint-disable-line no-undef

const workshopApiBase = 'https://inspector.local.noop.app:1234'
const noopProtocal = 'noop'
let githubLoginUrl
let mainWindow
let authWindow
let updaterInterval
let projectsDir
let appIsQuitting = false
let localRepositories = []
const fileWatchers = {}

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

  mainWindow.on('close', event => {
    if (!appIsQuitting) {
      event.preventDefault()
      mainWindow.hide()
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

  if (managingVm) {
    await handleWorkshopVmStatus()
  }
}

const ensureMainWindow = async () => {
  if (!app.isReady()) return
  if (!mainWindow) await createMainWindow()
  mainWindow.show()
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

const handleWorkshopVmStatus = async status => {
  if (status === 'DELETED') localRepositories = []
  mainWindow?.webContents.send('workshop-vm-status', vm?.status || 'RUNNING')
  return vm?.status || 'RUNNING'
}

ipcMain.handle('workshop-vm-status', async () => await handleWorkshopVmStatus())

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
  const cloneResponse = await fetch(`${workshopApiBase}/local/repos/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryUrl })
  })
  if (!cloneResponse.ok) {
    if (cloneResponse.headers.get('content-type') === 'application/json') {
      throw await cloneResponse.json()
    } else {
      throw cloneResponse.body
    }
  }
  const directoryName = repositoryUrl.split('/').at(-1).split('.git')[0]
  const files = await readdir(subdirectory)
  let num = 1
  while (files.find(file => file === `${directoryName}${num === 1 ? '' : `-${num}`}`)) {
    num++
  }
  const foundDirectory = join(subdirectory, `${directoryName}${num === 1 ? '' : `-${num}`}`)
  await mkdir(foundDirectory, { recursive: true })
  const tarStream = Readable.fromWeb(cloneResponse.body)
  const tarExtractor = extract(foundDirectory)
  await finished(tarStream.pipe(tarExtractor))
  const url = pathToFileURL(foundDirectory.replace(projectsDir, '/noop/projects')).href
  const repoResponse = await fetch(`${workshopApiBase}/local/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  if (!repoResponse.ok) {
    if (repoResponse.headers.get('content-type') === 'application/json') {
      throw await repoResponse.json()
    } else {
      throw repoResponse.body
    }
  }
  return await repoResponse.json()
}

ipcMain.handle('clone-repository', handleCloneRepository)

const handleOpenPath = async (_event, url) => {
  if ((url === 'file:///noop/projects') || url?.startsWith('file:///noop/projects/')) {
    url = url.replace('/noop/projects', projectsDir)
  }
  shell.openPath(fileURLToPath(url))
  return true
}

ipcMain.handle('open-path', handleOpenPath)

const handleRestartWorkshopVm = async () => {
  if (managingVm) {
    await ensureMainWindow()
    const returnValue = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart', 'Cancel'],
      title: 'Restart Workshop VM',
      detail: 'Restarting Workshop will erase Workshop\'s existing state.'
    })
    if (returnValue.response === 0) {
      await Promise.all(Object.entries(fileWatchers).map(async ([repoId, watcher]) => {
        await watcher.stop()
        watcher.removeAllListeners()
        delete fileWatchers[repoId]
      }))
      await vm.restart()
      return true
    }
  }
}

ipcMain.handle('restart-workshop-vm', handleRestartWorkshopVm)

const handleSetBadgeCount = (_event, num) => app.setBadgeCount(num || 0)

ipcMain.handle('set-badge-count', handleSetBadgeCount)

const handleLocalRepositories = async repositories => {
  localRepositories = repositories || []

  await Promise.all(Object.entries(fileWatchers).map(async ([repoId, watcher]) => {
    if (!localRepositories.some(({ id }) => (id === repoId))) {
      await watcher.stop()
      watcher.removeAllListeners()
      delete fileWatchers[repoId]
    }
  }))

  await Promise.all(localRepositories.map(async ({ id: repoId, url }) => {
    const watcher = fileWatchers[repoId] || new FileWatcher({ repoId, url, projectsDir })
    if (!(repoId in fileWatchers)) {
      fileWatchers[repoId] = watcher
      const { path } = watcher
      const changeHandler = async files => {
        formatter({ event: 'repo.update', repoId, path, files })
        try {
          const createEvent = await fetch(`${workshopApiBase}${repoId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          })
          if (!createEvent.ok) {
            if (createEvent.headers.get('content-type') === 'application/json') {
              throw await createEvent.json()
            } else {
              throw createEvent.body
            }
          }
          const response = await createEvent.json()
          formatter({ event: 'repo.updated', repoId, path, response })
          return response
        } catch (error) {
          formatter({ event: 'repo.update.error', repoId, error, path })
          // throw error
        }
      }
      const deleteHandler = async files => {
        formatter({ event: 'repo.destroy', repoId, path, files })
        try {
          const deleteRepo = await fetch(`${workshopApiBase}${repoId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          })
          if (!deleteRepo.ok) {
            if (deleteRepo.headers.get('content-type') === 'application/json') {
              throw await deleteRepo.json()
            } else {
              throw deleteRepo.body
            }
          }
          const response = await deleteRepo.json()
          formatter({ event: 'repo.destroyed', repoId, path, response })
          watcher.removeAllListeners()
          return response
        } catch (error) {
          formatter({ event: 'repo.destroy.error', repoId, error, path })
          // throw error
        }
      }
      watcher.on('change', changeHandler)
      watcher.on('delete', deleteHandler)
    }
    await watcher.start()
  }))
  return true
}

ipcMain.handle('local-repositories', async (_event, repositories) => await handleLocalRepositories(repositories))

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
  await ensureMainWindow()
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
  appIsQuitting = true
  if (managingVm && !['PENDING', 'DELETED'].includes(vm.status)) {
    event.preventDefault()
    clearInterval(updaterInterval)
    await Promise.all(Object.entries(fileWatchers).map(async ([repoId, watcher]) => {
      await watcher.stop()
      watcher.removeAllListeners()
      delete fileWatchers[repoId]
    }))
    await vm.stop()
    await vm.delete()
    app.quit()
  }
});

(async () => {
  await app.whenReady()
  await createMainWindow()

  if (managingVm) {
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
    vm.on('status', handleWorkshopVmStatus)
    await vm.create({ projectsDir })
    await vm.start()
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
      console.error(error)
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
      appIsQuitting = true
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
        await Promise.all(Object.entries(fileWatchers).map(async ([repoId, watcher]) => {
          await watcher.stop()
          watcher.removeAllListeners()
          delete fileWatchers[repoId]
        }))

        await vm.stop()
        await vm.delete()

        autoUpdater.quitAndInstall()
      }
    })

    autoUpdater.checkForUpdates()
    updaterInterval = setInterval(() => {
      autoUpdater.checkForUpdates()
    }, 1000 * 60 * 10)
  }
})()
