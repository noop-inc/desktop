import { join } from 'node:path'
import Lima from '@noop-inc/foundation/lib/Lima.js'
import { stringify } from '@noop-inc/foundation/lib/Yaml.js'
import { readdir } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { inspect } from 'node:util'
import { app, dialog } from 'electron'
import { homedir, cpus, totalmem } from 'node:os'
import { setTimeout as wait } from 'timers/promises'
import settings from './Settings.js'

const arch = process.arch.includes('arm') ? 'aarch64' : 'x86_64'

const {
  resourcesPath,
  env: {
    npm_lifecycle_event: npmLifecycleEvent,
    WORKSHOP_VM_VERSION: workshopVmVersion,
    npm_config_local_prefix: npmConfigLocalPrefix
  }
} = process

const mainWindowViteDevServerURL = MAIN_WINDOW_VITE_DEV_SERVER_URL // eslint-disable-line no-undef
const packaged = (!mainWindowViteDevServerURL && app.isPackaged)

const logHandler = ({ message, ...log }) => {
  let messages = [message]
  if ((typeof message) === 'string') {
    const trimmed = message.trim()
    messages = [trimmed]
    if (trimmed.startsWith('time="')) {
      messages = trimmed
        .split('"\ntime="')
        .map(message => {
          const trimmed = message.trim()
          return trimmed.startsWith('time="') ? trimmed : `time="${trimmed}`
        })
    }
  }
  for (const message of messages) {
    formatter({ ...log, ...((message !== undefined) ? { message } : {}) })
  }
}

const formatter = (...messages) =>
  console[messages[0].event.includes('.error') ? 'error' : 'log'](
    ...messages.map(message =>
      inspect(
        message,
        { breakLength: 10000, colors: !packaged, compact: true, depth: null }
      )
    )
  )

export default class VM extends EventEmitter {
  #name
  #lima
  #restarting
  #lastCmd
  #status = 'PENDING'
  #mainWindow

  constructor ({ name = 'workshop-vm' } = {}) {
    super()
    this.#name = name
  }

  handleStatus (status) {
    if (this.#status !== status) {
      this.#status = status
      logHandler({ event: 'vm.status', status })
    }
    this.emit('status', this.status)
  }

  async create () {
    if (!this.#lima) {
      const binPath = (npmLifecycleEvent === 'serve')
        ? join(npmConfigLocalPrefix, `node_modules/@noop-inc/desktop-lima/dist/lima-and-qemu.macos-${arch}/bin`)
        : join(resourcesPath, `lima-and-qemu.macos-${arch}`, 'bin')

      this.#lima = new Lima({ binPath })
    }

    const now = Date.now()
    this.#lastCmd = now
    this.handleStatus(this.#restarting ? 'RESTARTING' : 'CREATING')
    try {
      await this.#createDisk()
      await this.#unlockDisk()
      await this.#setProjectsDirectory()
      await this.#createVm()
    } catch (error) {
      if (now === this.#lastCmd) {
        this.handleStatus('CREATE_FAILED')
        throw error
      }
    }
    if (now === this.#lastCmd) this.handleStatus(this.#restarting ? 'RESTARTING' : 'CREATED')
  }

  async start () {
    const now = Date.now()
    this.#lastCmd = now
    this.handleStatus(this.#restarting ? 'RESTARTING' : 'STARTING')
    try {
      await this.#startVm()
    } catch (error) {
      if (now === this.#lastCmd) {
        this.handleStatus('START_FAILED')
        throw error
      }
    }
    if (now === this.#lastCmd) await wait(2000)
    if (now === this.#lastCmd) this.handleStatus('RUNNING')
  }

  async stop (force) {
    const now = Date.now()
    this.#lastCmd = now
    this.handleStatus('STOPPING')
    try {
      await this.#stopVm(force)
    } catch (error) {
      if (now === this.#lastCmd) {
        this.handleStatus('STOP_FAILED')
        throw error
      }
    }
    if (now === this.#lastCmd) this.handleStatus('STOPPED')
  }

  async delete (force) {
    const now = Date.now()
    this.#lastCmd = now
    this.handleStatus('DELETING')
    try {
      await this.#deleteVm(force)
    } catch (error) {
      if (now === this.#lastCmd) {
        this.handleStatus('DELETE_FAILED')
        throw error
      }
    }
    if (now === this.#lastCmd) this.handleStatus('DELETED')
  }

  async open () {
    await this.create()
    await this.start()
  }

  async quit () {
    const force = this.status !== 'RUNNING'
    await this.stop(force)
    await this.delete(force)
  }

  async restart (reset) {
    const force = !!(reset || (this.status !== 'RUNNING'))
    const now = Date.now()
    this.#restarting = now
    try {
      await this.stop(force)
      await this.delete(force)
      if (reset) await this.#deleteDisk()
      await this.create()
      await this.start()
    } catch (error) {
      if (now === this.#restarting) {
        this.handleStatus('RESTART_FAILED')
        throw error
      }
    }
  }

  async #createDisk () {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.disk.create.log', message })
    }

    logHandler({ event: 'vm.disk.create.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['disk', 'create', 'ws-vm-d', '--size', '128GiB'])
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
      await settings.delete('Workshop.ProjectsDirectory')
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      if (!error.message.includes('already exists') && !error.context.output.includes('already exists')) {
        logHandler({ event: 'vm.disk.create.error', error })
        throw error
      }
    }
    logHandler({ event: 'vm.disk.create.ended' })
  }

  async #unlockDisk () {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.disk.unlock.log', message })
    }

    logHandler({ event: 'vm.disk.unlock.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['disk', 'unlock', 'ws-vm-d'])
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.disk.unlock.error', error })
      throw error
    }
    logHandler({ event: 'vm.disk.unlock.ended' })
  }

  async #deleteDisk () {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.disk.delete.log', message })
    }

    logHandler({ event: 'vm.disk.delete.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['disk', 'delete', 'ws-vm-d', '-f'])
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
      await settings.delete('Workshop.ProjectsDirectory')
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.disk.delete.error', error })
      throw error
    }

    logHandler({ event: 'vm.disk.delete.ended' })
  }

  async #setProjectsDirectory () {
    const projectsDirectory = await settings.get('Workshop.ProjectsDirectory')

    let projectsDir = projectsDirectory
    if (!projectsDir) {
      await dialog.showMessageBox(this.mainWindow, {
        title: 'Projects Directory',
        message: 'Configuration Needed',
        detail: 'Noop Workshop will automatically discover compatiable projects on your machine. Select the root-level Projects Directory to use for this session.',
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

  async #createVm () {
    const location = (npmLifecycleEvent === 'serve')
      ? join(npmConfigLocalPrefix, `noop-workshop-vm-${workshopVmVersion}.${arch}.qcow2`)
      : join(resourcesPath, (await readdir(resourcesPath)).find(file => file.startsWith('noop-workshop-vm') && file.endsWith(`.${arch}.qcow2`)))

    const totalCpu = cpus().length
    const totalMemory = Math.round(totalmem() / (1024 ** 3))

    const projectsDirectory = await settings.get('Workshop.ProjectsDirectory')

    const template = {
      cpus: Math.min(totalCpu, Math.max(8, totalCpu)),
      memory: `${Math.min(totalMemory, Math.max(8, Math.round(totalMemory / 2)))}GiB`,
      arch,
      images: [{ location, arch }],
      provision: [],
      containerd: {
        system: true,
        user: false
      },
      ssh: { loadDotSSHPubKeys: false },
      mounts: [
        {
          location: projectsDirectory,
          mountPoint: '/noop/projects',
          sshfs: { cache: false }
        }
      ],
      additionalDisks: [
        { name: 'ws-vm-d' }
      ],
      portForwards: [
        { guestPort: 1234, hostIP: '0.0.0.0' },
        { guestPort: 443, hostIP: '127.0.0.1' }
      ],
      hostResolver: {
        hosts: {
          'registry.workshop': '127.0.0.1'
        }
      },
      firmware: { legacyBIOS: true }
    }

    const cmdLogHandler = message => {
      logHandler({ event: 'vm.create.log', message })
    }

    logHandler({ event: 'vm.create.started' })

    let cmd
    try {
      const stdin = stringify(template)
      const env = { LIMA_CIDATA_NAME: 'noop', LIMA_CIDATA_USER: 'noop' }
      const cmd = this.#lima.limactl(['create', `--name=${this.name}`, '-'], { stdin, env })
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      await this.#lima.get(this.name)
      cmd.off('log', cmdLogHandler)
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.create.error', error })
      throw error
    }

    logHandler({ event: 'vm.create.ended' })
  }

  #startVm = async () => {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.start.log', message })
    }

    logHandler({ event: 'vm.start.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['start', 'workshop-vm'])
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.start.error', error })
      throw error
    }

    logHandler({ event: 'vm.start.ended' })
  }

  #stopVm = async force => {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.stop.log', message })
    }

    logHandler({ event: 'vm.stop.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['stop', 'workshop-vm', force ? '-f' : null].filter(Boolean))
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.stop.error', error })
      if (!force) throw error
    }

    logHandler({ event: 'vm.stop.ended' })
  }

  #deleteVm = async force => {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.delete.log', message })
    }

    logHandler({ event: 'vm.delete.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['delete', 'workshop-vm', force ? '-f' : null].filter(Boolean))
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.delete.error', error })
      if (!force) throw error
    }

    logHandler({ event: 'vm.delete.ended' })
  }

  get name () {
    return this.#name
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
