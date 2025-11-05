import { join } from 'node:path'
import { QemuVirtualMachine, WslVirtualMachine } from '@noop-inc/foundation/lib/VirtualMachine.js'
import Error from '@noop-inc/foundation/lib/Error.js'
import { stat, mkdir, rm, access, rename } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { inspect, promisify, stripVTControlCharacters } from 'node:util'
import { app, dialog } from 'electron'
import { homedir, availableParallelism, totalmem } from 'node:os'
import settings from './Settings.js'
import { createServer, createConnection } from 'node:net'
import { setTimeout as wait } from 'node:timers/promises'
import packageJson from '../package.json' with { type: 'json' }
import packageLockJson from '../package-lock.json' with { type: 'json' }
import { api } from './api.js'
import { settlePromises } from '@noop-inc/foundation/lib/Helpers.js'

const userData = app.getPath('userData')
const dataDir = join(userData, 'data')

const vmDir = join(dataDir, 'VM')
const systemDisk = join(vmDir, 'system.disk')

const workshopDir = join(dataDir, 'Workshop')
const dataDisk = join(workshopDir, 'data.disk')

const desktopDir = join(dataDir, 'Desktop')

const {
  resourcesPath,
  env: {
    npm_lifecycle_event: npmLifecycleEvent,
    npm_config_local_prefix: npmConfigLocalPrefix
  }
} = process

if (process.platform === 'darwin') {
  const folder = `noop-desktop-qemu-v${packageLockJson.packages['node_modules/@noop-inc/desktop-qemu'].version}-${process.platform}-${process.arch}`
  QemuVirtualMachine.path = (npmLifecycleEvent === 'serve')
    ? join(npmConfigLocalPrefix, `node_modules/@noop-inc/desktop-qemu/dist/${folder}`)
    : join(resourcesPath, folder)
}

const mainWindowViteDevServerURL = MAIN_WINDOW_VITE_DEV_SERVER_URL // eslint-disable-line no-undef
const packaged = (!mainWindowViteDevServerURL && app.isPackaged)

const logHandler = ({ message, ...log }) => {
  if (typeof message === 'string') {
    const workshopMessage = /^\[[\s\d.]+\][\s]+(node)\[[\d]+\]:[\s]+/
    const vmMessage = /^\[[\s\d.]+\][\s]+/

    message = stripVTControlCharacters(message).trim()

    if (message.includes(']: {"timestamp":')) {
      message = message
        .replace(workshopMessage, '')
        .trim()
    }

    message = message
      .replace(vmMessage, '')
      .trim()

    try {
      message = JSON.parse(message)
    } catch {}
  }

  formatter({ ...log, ...((message !== undefined) ? { message } : {}) })
}

const formatter = (...messages) =>
  console[messages[0].event.includes('.error') ? 'error' : (messages[0].event.includes('.initialize') ? 'warn' : 'log')](
    ...messages.map(message =>
      inspect(
        JSON.parse(JSON.stringify(message)),
        { breakLength: 10000, colors: !packaged, compact: true, depth: null }
      )
    )
  )

export default class VM extends EventEmitter {
  #lastCmd
  #restarting
  #quitting
  #isRestarting
  #isQuitting
  #status = 'PENDING'
  #mainWindow
  #vm
  #traffic
  #sockets

  static signalPattern = /"workshop.signal:(\w+)"/

  handleStatus (status) {
    if (this.#status !== status) {
      this.#status = status
      logHandler({ event: 'vm.status', status })
    }
    this.emit('status', this.status)
  }

  async start () {
    let now = Date.now()
    this.#lastCmd = now
    if (process.platform === 'win32') {
      try {
        await WslVirtualMachine.checkWsl()
      } catch (error) {
        try {
          const returnValue = await dialog.showMessageBox(this.mainWindow, {
            type: 'info',
            buttons: ['Install WSL', 'Not Now'],
            title: 'Install WSL',
            detail: 'WSL appears to be unavailable. WSL needs to be installed to use the local development features of Workshop.',
            cancelId: 2
          })

          if (returnValue.response === 0) {
            this.handleStatus('WSL_INSTALLING')
            await WslVirtualMachine.installWsl()

            const returnValue = await dialog.showMessageBox(this.mainWindow, {
              type: 'info',
              buttons: ['System Reboot', 'Later'],
              title: 'WSL Installation Completed',
              detail: 'WSL installation has completed. A system reboot is recommended to ensure changes take effect.',
              cancelId: 2
            })

            if (returnValue.response === 0) {
              await WslVirtualMachine.systemReboot()
            }
          } else {
            throw error
          }
        } catch (error) {
          if (now === this.#lastCmd) {
            this.handleStatus('WSL_INSTALL_FAILED')
            throw error
          }
        }
      }
    }
    if (this.#vm) throw new DesktopVmError('Workshop VM already running')
    if ((process.platform === 'darwin') && !this.#traffic) {
      this.#sockets = new Set()
      this.#traffic = createServer(socket => this.handleTrafficSocket(socket))
      this.#traffic.on('error', error => {
        logHandler({ event: 'traffic.server.error', error: Error.wrap(error) })
      })
      await promisify(this.#traffic.listen.bind(this.#traffic))({ port: 443, host: '0.0.0.0' })
    }
    if (now === this.#lastCmd) {
      this.handleStatus(this.#restarting ? 'RESTARTING' : 'CREATING')
      now = Date.now()
      this.#lastCmd = now
      try {
        // migrate old data.disk
        try {
          const oldDataDisk = join(userData, 'Workshop', 'data.disk')
          await access(oldDataDisk)
          await mkdir(workshopDir, { recursive: true })
          await rename(oldDataDisk, dataDisk)
        } catch (error) {}

        // migrate old vm files
        try {
          const oldWorkshop = join(userData, 'Workshop')
          await access(oldWorkshop)
          await mkdir(dataDir, { recursive: true })
          await rename(oldWorkshop, vmDir)
        } catch (error) {}

        await mkdir(vmDir, { recursive: true })
        await mkdir(workshopDir, { recursive: true })
        await mkdir(desktopDir, { recursive: true })

        if (process.platform === 'darwin') {
          const baseImage = await this.workshopVmAsset()
          try {
            await stat(baseImage)
          } catch (cause) {
            throw new DesktopVmError('Workshop base image not found', { cause })
          }
          try {
            await stat(dataDisk)
          } catch (error) {
            logHandler({ event: 'workshop.initialize', disk: dataDisk })
            await settings.delete('Workshop.ProjectsDirectory')
          }
          try {
            await rm(systemDisk)
          } catch (error) {}
          logHandler({ event: 'workshop.initialize', disk: systemDisk, baseImage })
          await QemuVirtualMachine.createDiskImage(systemDisk, { base: baseImage })
        } else {
          logHandler({ event: 'workshop.initialize' })
        }

        await this.#setProjectsDirectory()

        let vm
        if (process.platform === 'darwin') {
          const cpu = this.defaultCpu
          const memory = this.defaultMemory
          const ports = [
            '127.0.0.1:44450-:22', // SSH
            '127.0.0.1:44451-:443', // Workshop Traffic
            '127.0.0.1:44452-:44452' // Workshop API
          ]
          const disks = [systemDisk]
          const mounts = {
            Host: { path: '/' },
            Desktop: { path: desktopDir },
            Workshop: { path: workshopDir, readOnly: false }
          }
          const params = { workdir: vmDir, cpu, memory, ports, disks, mounts }
          logHandler({ event: 'vm.params', ...params })
          vm = new QemuVirtualMachine(params)
        }

        if (process.platform === 'win32') {
          const tarFile = await this.workshopVmAsset()
          const params = {
            tarFile,
            installDir: vmDir,
            distroName: 'WorkshopVM',
            startCmd: 'journalctl --boot --follow --no-tail --no-hostname --output short-monotonic'.split(' '),
            stopCmd: 'shutdown -h now'.split(' ')
          }
          logHandler({ event: 'vm.params', ...params })
          vm = new WslVirtualMachine(params)
        }
        this.#vm = vm
        this.#vm.log.on('data', event => {
          if (event.context.message) {
            if (VM.signalPattern.test(event.context.message)) {
              const [, signal] = VM.signalPattern.exec(event.context.message)
              if (
                ((signal === 'RUNNING') && !this.isQuitting) ||
                ((signal === 'STOPPED') && this.isQuitting)
              ) {
                this.handleStatus(signal)
              }
            }
          }
          logHandler({ event: 'vm.output', message: event.context?.message || event.context })
        })
      } catch (error) {
        logHandler({ event: 'vm.create.error', error: Error.wrap(error) })
        if (now === this.#lastCmd) {
          this.handleStatus('CREATE_FAILED')
          throw error
        }
      }
    }
    if (now === this.#lastCmd) {
      this.handleStatus(this.#restarting ? 'RESTARTING' : 'STARTING')
      now = Date.now()
      this.#lastCmd = now
      try {
        await this.#vm.start()
      } catch (error) {
        logHandler({ event: 'vm.start.error', error: Error.wrap(error) })
        if (now === this.#lastCmd) {
          this.handleStatus('START_FAILED')
          throw error
        }
      }
    }
  }

  async stop (timeout = 30) {
    if (this.isQuitting && this.#restarting) {
      this.#restarting = null
      if (this.#quitting) return
    }

    const now = Date.now()
    this.#lastCmd = now
    this.#quitting = now

    const wasRunning = this.status === 'RUNNING'

    this.handleStatus(this.#restarting ? 'RESTARTING' : 'STOPPING')

    try {
      await Promise.all([
        (async () => {
          if (this.#traffic) {
            const traffic = this.#traffic
            const sockets = this.#sockets
            logHandler({ event: 'vm.traffic.close.start', sockets: sockets?.size })

            const closeServer = async () => {
              try {
                if (traffic) await promisify(traffic.close.bind(traffic))()
              } catch (error) {
                if (error.code !== 'ERR_SERVER_NOT_RUNNING') throw error
              }
            }

            const destroySocket = async socket => {
              const ac = new AbortController()
              const handleTimeout = async () => {
                try {
                  await wait(1_000, null, { ref: false, signal: ac.signal })
                } catch (error) {
                  if (error.code !== 'ABORT_ERR') throw error
                } finally {
                  ac.abort()
                }
              }
              const handleEnd = async () => {
                try {
                  if (!socket.destroyed) await promisify(socket.end.bind(socket))()
                } finally {
                  ac.abort()
                }
              }
              try {
                await Promise.all([
                  handleTimeout(),
                  handleEnd()
                ])
              } finally {
                try {
                  if (!socket.destroyed) socket.destroy()
                } finally {
                  ac.abort()
                }
              }
            }

            const { errors: stopErrors } = await settlePromises([
              ...[...sockets].map(async socket => await destroySocket(socket))
            ])
            const { errors: closeErrors } = await settlePromises([
              closeServer(),
              ...[...sockets].map(async socket => await destroySocket(socket))
            ])
            const errors = [...stopErrors, ...closeErrors].map(error => Error.wrap(error))

            if (errors?.length) logHandler({ event: 'vm.traffic.close.error', errors })

            logHandler({ event: 'vm.traffic.close.end', sockets: sockets?.size })
            if (this.#restarting) return
            if (this.#traffic === traffic) {
              this.#sockets = null
              this.#traffic = null
            }
          } else if (process.platform === 'darwin') {
            logHandler({ event: 'vm.traffic.close.skip' })
          }
        })(),
        (async () => {
          if (this.#vm) {
            logHandler({ event: 'vm.stop.start' })
            const vm = this.#vm
            let apiStopError = false
            if (timeout && wasRunning) {
              const ac = new AbortController()
              const { signal } = ac
              const handleTimeout = async () => {
                try {
                  await wait((timeout * 1_000), null, { ref: false, signal })
                } catch (error) {
                  if (error.code !== 'ABORT_ERR') throw error
                } finally {
                  ac.abort()
                }
              }
              const handleStop = async () => {
                const waitForStopped = new Promise(resolve => {
                  const cleanup = () => {
                    this.off('status', handleStop)
                    signal.removeEventListener('abort', cleanup)
                    resolve()
                  }
                  const handleStop = status => {
                    if (status === 'STOPPED') cleanup()
                  }
                  this.on('status', handleStop)
                  signal.addEventListener('abort', cleanup, { once: true })
                })
                try {
                  try {
                    await api.post('/local/workshop/stop')
                  } catch (error) {
                    apiStopError = true
                    throw error
                  }
                  await waitForStopped
                } finally {
                  ac.abort()
                }
              }
              try {
                await Promise.all([
                  handleTimeout(),
                  handleStop()
                ])
              } catch (error) {
                if (wasRunning) logHandler({ event: 'vm.stop.api.error', error: Error.wrap(error) })
              }
            }
            await vm.stop(
              (timeout && wasRunning && !apiStopError && (this.status === 'STOPPED'))
                ? Math.min(5, timeout)
                : wasRunning ? timeout : 5
            )
            logHandler({ event: 'vm.stop.end' })
            if (this.#vm === vm) {
              this.#vm = null
              try {
                await rm(systemDisk)
              } catch (error) {}
            }
          } else {
            logHandler({ event: 'vm.stop.skip' })
          }
        })()
      ])
    } catch (error) {
      logHandler({ event: 'vm.stop.error', error: Error.wrap(error) })
      if (now === this.#lastCmd) {
        this.handleStatus('STOP_FAILED')
        throw error
      }
    }
    this.#quitting = null
    this.handleStatus('STOPPED')
  }

  async restart (reset) {
    if (!this.isRestarting || this.#restarting || this.isQuitting || this.#quitting) return
    const now = Date.now()
    this.#restarting = now
    try {
      await this.stop(reset ? 5 : 30)
      if (this.isQuitting || this.#quitting) return
      if (reset) {
        await rm(dataDisk)
        await settings.delete('Workshop.ProjectsDirectory')
      }
      if (this.isQuitting || this.#quitting) return
      await this.start()
    } catch (error) {
      if (now === this.#restarting) {
        this.#restarting = null
        this.handleStatus('RESTART_FAILED')
        throw error
      }
    }
    if (now === this.#restarting) this.#restarting = null
  }

  async #setProjectsDirectory () {
    const projectsDirectory = await settings.get('Workshop.ProjectsDirectory')

    let projectsDir = projectsDirectory
    if (!projectsDir) {
      await dialog.showMessageBox(this.mainWindow, {
        title: 'Projects Directory',
        message: 'Configuration Needed',
        detail: 'Noop Workshop will automatically discover compatible projects on your machine. Select the root-level directory to use for project discovery.',
        buttons: ['Next'],
        type: 'info'
      })

      while (!projectsDir) {
        const returnValue = await dialog.showOpenDialog(this.mainWindow, {
          title: 'Projects Directory',
          message: 'Select Projects Directory',
          defaultPath: projectsDirectory || homedir(),
          buttonLabel: 'Select',
          properties: ['openDirectory', 'createDirectory']
        })
        if (!returnValue.canceled && returnValue.filePaths.length) {
          projectsDir = returnValue.filePaths[0]
        } else {
          await dialog.showMessageBox(this.mainWindow, {
            title: 'Projects Directory',
            message: 'Configuration Needed',
            detail: 'Selecting a Projects Directory is required. Please try again.',
            buttons: ['Next'],
            type: 'warning'
          })
        }
      }
    }

    await settings.set('Workshop.ProjectsDirectory', projectsDir)
  }

  async workshopVmAsset () {
    if (npmLifecycleEvent === 'serve') {
      if (process.platform === 'darwin') {
        return join(npmConfigLocalPrefix, '../workshop-vm/prep/disks/noop-workshop-vm-v0.0.0-automated-arm64.disk')
      }

      if (process.platform === 'win32') {
        return 'C:\\Users\\dfnj1\\Downloads\\noop-workshop-vm-0.8.2-pr10.52.x86_64.tar.gz'
      }
    } else if (['darwin', 'win32'].includes(process.platform)) {
      const file = `noop-workshop-vm-v${packageJson['@noop-inc']['workshop-vm']}-${process.arch}.${({ darwin: 'disk', win32: 'tar.gz' })[process.platform]}`
      const path = join(resourcesPath, file)
      await access(path)
      return path
    }
  }

  async projectsDirectory () {
    return await settings.get('Workshop.ProjectsDirectory')
  }

  handleTrafficSocket (incoming) {
    const sockets = this.#sockets
    try {
      this.handleSocketEvents(incoming)
      const host = '127.0.0.1'
      const port = 44451
      const outgoing = createConnection({ host, port })
      try {
        this.handleSocketEvents(outgoing)
        outgoing.once('connect', () => {
          incoming.pipe(outgoing)
          outgoing.pipe(incoming)
        })
      } catch (error) {
        if (!outgoing.destroyed) outgoing.destroy()
        sockets.delete(outgoing)
        throw error
      }
    } catch (error) {
      logHandler({ event: 'traffic.pipe.error', error: Error.wrap(error) })
      if (!incoming.destroyed) incoming.destroy()
      sockets.delete(incoming)
    }
  }

  handleSocketEvents (socket) {
    if (!this.#sockets.has(socket)) {
      const sockets = this.#sockets
      sockets.add(socket)
      const cleanup = error => {
        socket.off('end', handleEnd)
        socket.off('error', handleError)
        if (error) {
          logHandler({ event: 'traffic.socket.error', error: Error.wrap(error) })
        }
        if (!socket.destroyed) socket.destroy()
        sockets.delete(socket)
      }
      const handleEnd = () => {
        cleanup()
      }
      const handleError = error => {
        cleanup(error)
      }
      const handleClose = () => {
        sockets.delete(socket)
      }
      socket.once('end', handleEnd)
      socket.once('error', handleError)
      socket.once('close', handleClose)
    }
  }

  get totalCpu () {
    return availableParallelism()
  }

  get totalMemory () {
    return Math.round(totalmem() / (1024 ** 2))
  }

  get defaultCpu () {
    const { totalCpu } = this
    return Math.max(Math.ceil(totalCpu * (3 / 4)), Math.min(8, totalCpu))
  }

  get defaultMemory () {
    const { totalMemory } = this
    return Math.max(Math.ceil(totalMemory * (3 / 4)), Math.min((8 * 1024), totalMemory))
  }

  get status () {
    return this.#status
  }

  get mainWindow () {
    return this.#mainWindow
  }

  set mainWindow (mainWindow) {
    this.#mainWindow = mainWindow
  }

  get isQuitting () {
    return this.#isQuitting
  }

  set isQuitting (isQuitting) {
    this.#isQuitting = isQuitting
  }

  get isRestarting () {
    return this.#isRestarting
  }

  set isRestarting (isRestarting) {
    this.#isRestarting = isRestarting
  }
}

class DesktopVmError extends Error {
  static get displayName () {
    return 'DesktopVmError'
  }
}
