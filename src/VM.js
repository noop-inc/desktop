import { join } from 'node:path'
import { QemuVirtualMachine } from '@noop-inc/foundation/lib/VirtualMachine.js'
import { readdir, stat, mkdir, rm } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { inspect, promisify } from 'node:util'
import { app, dialog } from 'electron'
import { homedir, cpus, totalmem } from 'node:os'
import settings from './Settings.js'
import { createServer, createConnection } from 'node:net'
import stripAnsi from 'strip-ansi'

const arch = process.arch.includes('arm') ? 'aarch64' : 'x86_64'

const userData = app.getPath('userData')
const workdir = join(userData, 'Workshop/')
const dataDisk = join(workdir, 'data.disk')
const systemDisk = join(workdir, 'system.disk')

const {
  resourcesPath,
  env: {
    npm_lifecycle_event: npmLifecycleEvent,
    // WORKSHOP_VM_VERSION: workshopVmVersion,
    npm_config_local_prefix: npmConfigLocalPrefix
  }
} = process

QemuVirtualMachine.path = (npmLifecycleEvent === 'serve')
  ? join(npmConfigLocalPrefix, `node_modules/@noop-inc/desktop-lima/dist/lima-and-qemu.macos-${arch}`)
  : join(resourcesPath, `lima-and-qemu.macos-${arch}`)

const mainWindowViteDevServerURL = MAIN_WINDOW_VITE_DEV_SERVER_URL // eslint-disable-line no-undef
const packaged = (!mainWindowViteDevServerURL && app.isPackaged)

const logHandler = ({ message, ...log }) => {
  if (typeof message === 'string') {
    const workshopMessage = /^\[[\s\d.]+\][\s]+(node)\[[\d]+\]:[\s]+/
    const vmMessage = /^\[[\s\d.]+\][\s]+/

    message = stripAnsi(message).trim()

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
        message,
        { breakLength: 10000, colors: !packaged, compact: true, depth: null }
      )
    )
  )

export default class VM extends EventEmitter {
  #restarting
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
    if (this.#vm) throw new Error('Workshop VM already running')
    if (!this.#traffic) {
      this.#sockets = new Set()
      this.#traffic = createServer(socket => this.handleTrafficSocket(socket))
      await promisify(this.#traffic.listen.bind(this.#traffic))(443)
    }
    this.handleStatus(this.#restarting ? 'RESTARTING' : 'CREATING')
    try {
      await mkdir(workdir, { recursive: true })
      const baseImage = await this.workshopImage()
      try {
        await stat(baseImage)
      } catch (cause) {
        throw new Error('Workshop base image not found', { cause })
      }
      try {
        await stat(dataDisk)
      } catch (error) {
        logHandler({ event: 'workshop.initialize', disk: dataDisk })
        await settings.delete('Workshop.ProjectsDirectory')
        await QemuVirtualMachine.createDiskImage(dataDisk, { size: 100 })
      }
      try {
        await rm(systemDisk)
      } catch (error) {}
      logHandler({ event: 'workshop.initialize', disk: systemDisk, baseImage })
      await QemuVirtualMachine.createDiskImage(systemDisk, { base: baseImage })
      await this.#setProjectsDirectory()

      const cpu = this.defaultCpu
      const memory = this.defaultMemory
      const ports = [
        '127.0.0.1:44450-:22', // SSH
        '127.0.0.1:44451-:441', // Workshop Traffic
        '127.0.0.1:44452-:442' // Workshop API
      ]
      const disks = [systemDisk, dataDisk]
      const mounts = {
        Projects: await this.projectsDirectory()
      }
      const params = { workdir, cpu, memory, ports, disks, mounts }
      logHandler({ event: 'vm.params', ...params })
      const vm = new QemuVirtualMachine(params)
      this.#vm = vm
      this.#vm.log.on('data', event => {
        if (event.context.message) {
          if (VM.signalPattern.test(event.context.message)) {
            const [, signal] = VM.signalPattern.exec(event.context.message)
            this.handleStatus(signal)
          }
        }
        logHandler({ event: 'vm.output', message: event.context?.message || event.context })
      })
    } catch (error) {
      this.handleStatus('CREATE_FAILED')
      throw error
    }
    this.handleStatus(this.#restarting ? 'RESTARTING' : 'STARTING')
    try {
      await this.#vm.start()
    } catch (error) {
      this.handleStatus('START_FAILED')
      throw error
    }
  }

  async stop (timeout = 30) {
    if (!this.#vm) return true
    this.handleStatus('STOPPING')
    if (this.#traffic) {
      logHandler({ event: 'vm.traffic.close', sockets: this.#sockets.size })
      const traffic = this.#traffic
      await Promise.all([
        ...[...this.#sockets]
          .map(async socket => {
            try {
              await promisify(socket.end.bind(socket))()
              this.#sockets?.delete(socket)
            } catch (error) {
              if (error.code !== 'ERR_STREAM_ALREADY_FINISHED') throw error
            }
            this.#sockets?.delete(socket)
          }),
        async () => {
          try {
            await promisify(traffic.close.bind(traffic))()
          } catch (error) {
            if (error.code !== 'ERR_SERVER_NOT_RUNNING') throw error
          }
        }
      ])
      if (this.#traffic === traffic) {
        this.#sockets = null
        this.#traffic = null
      }
    }
    const vm = this.#vm
    try {
      await vm.stop(timeout)
    } catch (error) {
      this.handleStatus('STOP_FAILED')
      throw error
    }
    await vm.promise('close')
    if (this.#vm === vm) this.#vm = null
    this.handleStatus('STOPPED')
  }

  async restart (reset) {
    const now = Date.now()
    this.#restarting = now
    try {
      await this.stop(reset ? 0 : 30)
      if (reset) {
        await rm(dataDisk)
        await settings.delete('Workshop.ProjectsDirectory')
      }
      await this.start()
    } catch (error) {
      if (now === this.#restarting) {
        this.handleStatus('RESTART_FAILED')
        throw error
      }
    }
  }

  async #setProjectsDirectory () {
    const projectsDirectory = await settings.get('Workshop.ProjectsDirectory')

    let projectsDir = projectsDirectory
    if (!projectsDir) {
      await dialog.showMessageBox(this.mainWindow, {
        title: 'Projects Directory',
        message: 'Configuration Needed',
        detail: 'Noop Workshop will automatically discover compatiable projects on your machine. Select the root-level Projects Directory to use.',
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

  async workshopImage () {
    return (npmLifecycleEvent === 'serve')
      ? join(npmConfigLocalPrefix, '../workshop-vm/limaless/prep/disks/noop-workshop-vm-0.0.0-automated.aarch64.disk')
      : join(resourcesPath, (await readdir(resourcesPath)).find(file => file.startsWith('noop-workshop-vm') && file.endsWith(`.${arch}.disk`)))
  }

  async projectsDirectory () {
    return await settings.get('Workshop.ProjectsDirectory')
  }

  handleTrafficSocket (incoming) {
    this.#sockets.add(incoming)
    const host = '127.0.0.1'
    const port = 44451
    try {
      const outgoing = createConnection({ host, port }, () => {
        incoming.pipe(outgoing)
        outgoing.pipe(incoming)
      })
      this.#sockets.add(outgoing)
      outgoing.once('error', () => {
        this.#sockets?.delete(outgoing)
        incoming.end(() => this.#sockets?.delete(incoming))
      })
      incoming.once('error', () => {
        this.#sockets?.delete(incoming)
        outgoing.end(() => this.#sockets?.delete(outgoing))
      })
    } catch (error) {
      incoming.end(() => this.#sockets?.delete(incoming))
    }
  }

  get totalCpu () {
    return cpus().length
  }

  get totalMemory () {
    return Math.round(totalmem() / (1024 ** 2))
  }

  get defaultCpu () {
    const { totalCpu } = this
    return Math.min(totalCpu, Math.max(8, totalCpu))
  }

  get defaultMemory () {
    const { totalMemory } = this
    return Math.min(totalMemory, Math.max(Math.round(8 * 1024), Math.round(totalMemory / 2)))
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
}
