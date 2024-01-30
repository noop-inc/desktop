import { join } from 'node:path'
import Lima from '@noop-inc/foundation/lib/Lima.js'
import { stringify } from '@noop-inc/foundation/lib/Yaml.js'
import { readdir } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { inspect } from 'node:util'
import { app } from 'electron'

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
  if ((typeof message) === 'string') message = message.trim()
  if (message) log.message = message
  formatter(log)
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
  #projectsDir
  #restarting
  #lastCmd
  #status = 'PENDING'

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

  async create ({ projectsDir = this.projectsDir } = {}) {
    const now = Date.now()
    this.#lastCmd = now
    this.handleStatus(this.#restarting ? 'RESTARTING' : 'CREATING')
    try {
      this.#projectsDir = projectsDir
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
    if (now === this.#lastCmd) this.handleStatus('RUNNING')
  }

  async stop () {
    const now = Date.now()
    this.#lastCmd = now
    this.handleStatus('STOPPING')
    try {
      await this.#stopVm()
    } catch (error) {
      if (now === this.#lastCmd) {
        this.handleStatus('STOP_FAILED')
        throw error
      }
    }
    if (now === this.#lastCmd) this.handleStatus('STOPPED')
  }

  async delete () {
    const now = Date.now()
    this.#lastCmd = now
    this.handleStatus('DELETING')
    try {
      await this.#deleteVm()
    } catch (error) {
      if (now === this.#lastCmd) {
        this.handleStatus('DELETE_FAILED')
        throw error
      }
    }
    if (now === this.#lastCmd) this.handleStatus('DELETED')
  }

  async restart () {
    const now = Date.now()
    this.#restarting = now
    try {
      await this.stop()
      await this.delete()
      await this.create()
      await this.start()
    } catch (error) {
      if (now === this.#restarting) {
        this.handleStatus('RESTART_FAILED')
        throw error
      }
    }
  }

  async #createVm () {
    if (!this.#lima) {
      const binPath = (npmLifecycleEvent === 'serve')
        ? join(npmConfigLocalPrefix, 'node_modules/@noop-inc/desktop-lima/dist/lima-and-qemu.macos-aarch64/bin')
        : join(resourcesPath, 'lima-and-qemu.macos-aarch64', 'bin')

      this.#lima = new Lima({ binPath })
    }

    const location = (npmLifecycleEvent === 'serve')
      ? join(npmConfigLocalPrefix, `noop-workshop-vm-${workshopVmVersion}.aarch64.qcow2`)
      : join(resourcesPath, (await readdir(resourcesPath)).find(file => file.startsWith('noop-workshop-vm') && file.endsWith('.aarch64.qcow2')))

    const template = {
      arch: 'aarch64',
      images: [{ location, arch: 'aarch64' }],
      provision: [],
      containerd: {
        system: true,
        user: false
      },
      ssh: { loadDotSSHPubKeys: false },
      mounts: [
        {
          location: this.projectsDir,
          mountPoint: '/noop/projects',
          sshfs: { cache: false }
        }
        // {
        //   location: userData,
        //   mountPoint: '/noop/data',
        //   sshfs: { cache: false },
        //   write: true
        // }
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

  #stopVm = async () => {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.stop.log', message })
    }

    logHandler({ event: 'vm.stop.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['stop', 'workshop-vm', '-f'])
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.stop.error', error })
      throw error
    }

    logHandler({ event: 'vm.stop.ended' })
  }

  #deleteVm = async () => {
    const cmdLogHandler = message => {
      logHandler({ event: 'vm.delete.log', message })
    }

    logHandler({ event: 'vm.delete.started' })

    let cmd
    try {
      cmd = this.#lima.limactl(['delete', 'workshop-vm', '-f'])
      cmd.on('log', cmdLogHandler)
      await cmd.done()
      cmd.off('log', cmdLogHandler)
    } catch (error) {
      cmd?.off('log', cmdLogHandler)
      logHandler({ event: 'vm.delete.error', error })
      throw error
    }

    logHandler({ event: 'vm.delete.ended' })
  }

  get name () {
    return this.#name
  }

  get projectsDir () {
    return this.#projectsDir
  }

  get status () {
    return this.#status
  }
}
