import { app, shell, BrowserWindow, screen, ipcMain, nativeTheme, dialog, autoUpdater } from 'electron'
import { join, resolve, sep } from 'node:path'
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
import settings from './Settings.js'

(async () => {
  if ((await import('electron-squirrel-startup')).default) {
    app.quit()
  }

  const __dirname = fileURLToPath(new URL('.', import.meta.url))

  // log.initialize()
  log.errorHandler.startCatching()
  log.eventLogger.startLogging()
  Object.assign(console, log.functions)

  const {
    npm_lifecycle_event: npmLifecycleEvent
  } = process.env

  const mainWindowViteDevServerURL = MAIN_WINDOW_VITE_DEV_SERVER_URL
  const mainWindowViteName = MAIN_WINDOW_VITE_NAME

  const eulaWindowViteDevServerURL = EULA_WINDOW_VITE_DEV_SERVER_URL
  const eulaWindowViteName = EULA_WINDOW_VITE_NAME

  const packaged = (!mainWindowViteDevServerURL && app.isPackaged)
  const managingVm = (packaged || (npmLifecycleEvent === 'serve'))

  const vm = managingVm ? new VM() : { status: 'RUNNING' }

  const formatter = (...messages) =>
    console[messages[0].event.includes('.error') ? 'error' : 'log'](
      ...messages.map(message =>
        inspect(
          message,
          { breakLength: 10000, colors: !packaged, compact: true, depth: null }
        )
      )
    )

  const loadURL = packaged
    ? serve({ directory: `./.vite/renderer/${mainWindowViteName}` })
    : null

  const workshopApiBase = 'https://workshop.local.noop.app:44452'
  const noopProtocal = 'noop'
  let githubLoginUrl
  let mainWindow
  let eulaWindow
  let authWindow
  let updaterInterval
  let localRepositories = []
  const fileWatchers = {}

  const createMainWindow = async () => {
    await app.whenReady()
    if (mainWindow) return
    const eula = !!(await settings.get('Desktop.EULA'))
    if (eula) {
      if (eulaWindow) eulaWindow.close()
      const { width, height } = screen.getPrimaryDisplay().workAreaSize
      // Create the browser window.
      mainWindow = new BrowserWindow({
        width: width < 1280 ? width : 1280,
        height: height < 720 ? height : 720,
        minWidth: 640,
        minHeight: 360,
        backgroundColor: '#212121',
        ...(
          (process.platform === 'darwin')
            ? {
                titleBarStyle: 'hidden',
                trafficLightPosition: { x: 8, y: 6 }
              }
            : {}
        ),
        webPreferences: {
          preload: join(__dirname, 'preload.js')
        }
      })

      vm.mainWindow = mainWindow

      mainWindow.on('enter-full-screen', () => {
        mainWindow.webContents.send('is-fullscreen', true)
        mainWindow.webContents.send('electron-fullscreen', true)
      })

      mainWindow.on('leave-full-screen', () => {
        mainWindow.webContents.send('is-fullscreen', false)
      })

      mainWindow.on('will-resize', (event, newBounds) => {
        if (authWindow) {
          const { width, height } = newBounds
          authWindow.setBounds({ width: Math.floor(Math.min(width - 32, 460)), height: Math.floor(Math.min(height - 64, 900)) })
        }
      })

      mainWindow.on('close', event => {
        if (!vm.isQuitting) {
          event.preventDefault()
          if (process.platform === 'darwin') mainWindow.hide()
          if (process.platform === 'win32') mainWindow.minimize()
        }
      })

      mainWindow.once('closed', () => {
        mainWindow = null
      })

      mainWindow.webContents.on('will-navigate', (event, url) => {
        const currentHost = new URL(mainWindow.webContents.getURL()).host
        const requestedHost = new URL(url).host
        if (requestedHost && requestedHost !== currentHost) {
          event.preventDefault()
          shell.openExternal(url)
        }
      })

      // and load the index.html of the app.
      if (!packaged) {
        mainWindow.loadURL(mainWindowViteDevServerURL)
        // Open the DevTools.
        mainWindow.webContents.openDevTools()
      } else {
        await loadURL(mainWindow)
      }

      if (managingVm) {
        await handleWorkshopVmStatus()
        vm.on('status', handleWorkshopVmStatus)
        await vm.start()
      }

      const version = app.getVersion()

      if (packaged && !version.includes('-')) {
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
          vm.isQuitting = true
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
            detail: 'A new version has been downloaded. Restart the application to apply the updates.',
            cancelId: 2
          })
          if (returnValue.response === 0) {
            vm.isQuitting = true
            clearInterval(updaterInterval)
            await Promise.all(Object.entries(fileWatchers).map(async ([repoId, watcher]) => {
              await watcher.stop()
              watcher.removeAllListeners()
              delete fileWatchers[repoId]
            }))

            await vm.stop()

            autoUpdater.quitAndInstall()
          }
        })

        autoUpdater.checkForUpdates()
        updaterInterval = setInterval(() => {
          autoUpdater.checkForUpdates()
        }, 1000 * 60 * 10)
      }
    }
  }

  const ensureMainWindow = async () => {
    if (!app.isReady()) return
    const eula = !!(await settings.get('Desktop.EULA'))
    if (!eula) {
      if (!eulaWindow) await ensureEulaWindow()
    } else {
      if (!mainWindow) await createMainWindow()
      // mainWindow.show()
      return mainWindow
    }
  }

  const createEulaWindow = async () => {
    await app.whenReady()
    eulaWindow = new BrowserWindow({
      width: 640,
      height: 480,
      resizable: false,
      frame: false,
      backgroundColor: '#212529',
      webPreferences: {
        preload: join(__dirname, 'preload.js')
      }
    })
    eulaWindow.once('closed', () => {
      eulaWindow = null
    })
    if (!packaged) {
      eulaWindow.loadURL(eulaWindowViteDevServerURL)
      // Open the DevTools.
      // eulaWindow.webContents.openDevTools()
    } else {
      eulaWindow.loadFile(join(__dirname, `../renderer/${eulaWindowViteName}/index.html`))
    }
  }

  const ensureEulaWindow = async () => {
    await app.whenReady()
    if (!eulaWindow) await createEulaWindow()
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

  const handleEula = async (_event, agree) => {
    await settings.set('Desktop.EULA', !!agree)
    if (!agree) {
      app.quit()
    } else {
      setImmediate(async () => await ensureMainWindow())
    }
  }

  ipcMain.handle('eula', handleEula)

  ipcMain.handle('is-fullscreen', async () => {
    await ensureMainWindow()
    mainWindow.webContents.send('is-fullscreen', mainWindow.isFullScreen())
    return mainWindow.isFullScreen()
  })

  const handleWorkshopVmStatus = async status => {
    if (status === 'STOPPED') localRepositories = []
    mainWindow?.webContents.send('workshop-vm-status', vm.status)
    return vm.status
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

  ipcMain.handle('logout', async () => await handleLogout())

  const handleSubdirectoryInput = async () => {
    await ensureMainWindow()
    const projectsDirectory = await settings.get('Workshop.ProjectsDirectory')
    let subdirectory = null
    while (!subdirectory) {
      const returnValue = await dialog.showOpenDialog(mainWindow, {
        title: 'Directory',
        message: 'Select Directory',
        defaultPath: projectsDirectory,
        buttonLabel: 'Select',
        properties: ['openDirectory', 'createDirectory']
      })
      if (returnValue.canceled) {
        subdirectory = null
        break
      }
      const selected = returnValue?.filePaths?.[0] || null
      if ((selected === projectsDirectory) || selected?.startsWith(join(projectsDirectory, sep))) {
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

  ipcMain.handle('subdirectory-input', async () => await handleSubdirectoryInput())

  const handleCloneRepository = async (_event, { repositoryUrl, subdirectory }) => {
    await ensureMainWindow()
    const projectsDirectory = await settings.get('Workshop.ProjectsDirectory')
    if (!((subdirectory === projectsDirectory) || subdirectory?.startsWith(join(projectsDirectory, sep)))) {
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
    const url = pathToFileURL(foundDirectory).href
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
    await ensureMainWindow()
    shell.openPath(fileURLToPath(url))
    return true
  }

  ipcMain.handle('open-path', handleOpenPath)

  const handleShowLogFiles = async () => {
    await ensureMainWindow()
    shell.openPath(app.getPath('logs'))
    return true
  }

  ipcMain.handle('show-log-files', handleShowLogFiles)

  const handleRestartWorkshopVm = async (_event, reset, registries) => {
    if (managingVm) {
      await ensureMainWindow()
      const returnValue = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: [reset ? 'Reset' : 'Restart', 'Cancel'],
        title: `${reset ? 'Reset' : 'Restart'} Workshop VM`,
        detail: reset
          ? 'Resetting Workshop VM will erase the entirety of Workshop\'s contents and settings.'
          : 'Restarting Workshop VM will stop all existing Workshop\'s processes.',
        cancelId: 2
      })
      if (returnValue.response === 0) {
        try {
          vm.isRestarting = true
          if (registries) {
            await fetch(`${workshopApiBase}/registry/prune`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(registries)
            })
          }
          await Promise.all(Object.entries(fileWatchers).map(async ([repoId, watcher]) => {
            await watcher.stop()
            watcher.removeAllListeners()
            delete fileWatchers[repoId]
          }))
          await vm.restart(reset)
          return true
        } finally {
          vm.isRestarting = false
        }
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
      await ensureMainWindow()
      const watcher = fileWatchers[repoId] || new FileWatcher({ repoId, url })
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
      await handleUpdateRoute(commandLine.pop())
    })

    app.on('open-url', async (event, url) => {
      await handleUpdateRoute(url)
    })
  }

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  // app.on('window-all-closed', async () => {
  //   if (process.platform !== 'darwin') app.quit()
  // })

  app.on('activate', async () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    await ensureMainWindow()
    mainWindow.show()
  })

  // In this file you can include the rest of your app's specific main process
  // code. You can also put them in separate files and import them here.

  app.on('web-contents-created', async (event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const openExternalWindow = async () => {
        if (url.startsWith(githubLoginUrl)) {
          if (authWindow) {
            authWindow.loadURL(url)
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
          setImmediate(async () => await openExternalWindow())
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
    vm.isQuitting = true
    if (managingVm && !['PENDING', 'STOPPED'].includes(vm.status)) {
      event.preventDefault()
      clearInterval(updaterInterval)
      await Promise.all(Object.entries(fileWatchers).map(async ([repoId, watcher]) => {
        await watcher.stop()
        watcher.removeAllListeners()
        delete fileWatchers[repoId]
      }))
      await vm.stop()
      app.quit()
    }
  })

  await app.whenReady()
  await ensureMainWindow()
})()
