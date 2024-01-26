import { watch } from 'chokidar'
import ignore from 'ignore'
import { readdir, readFile, access, constants, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { Discovery } from '@noop-inc/discovery'
import { minimatch } from 'minimatch'
import { inspect } from 'node:util'

const formatter = (...messages) =>
  console[messages[0].event.includes('.error') ? 'error' : 'log'](
    ...messages.map(message =>
      inspect(
        message,
        { breakLength: 10000, colors: true, compact: true, depth: null }
      )
    )
  )

export default class FileWatcher extends EventEmitter {
  repoId
  url
  projectsDir
  path
  running = false
  shouldDelete = false
  ignorers
  patterns
  watcher
  shouldRestart = false
  changedFiles = { added: new Set(), removed: new Set(), modified: new Set() }
  changeTimeout
  timeoutDuration = 2000

  constructor ({ repoId, url, projectsDir }) {
    super()
    const path = fileURLToPath(url).replace('/noop/projects', projectsDir)
    Object.assign(this, { repoId, url, projectsDir, path })
    formatter({ event: 'watcher.created', path: this.path })
  }

  async start () {
    if (this.running) return
    try {
      await this.#confirmNoopDir()
      if (this.shouldDelete) {
        await this.#deleteHandler()
      } else {
        await this.#setupPatterns()
        await this.#setupIgnorers()
        await this.#setupWatcher()
        this.running = true
      }
      formatter({ event: `watcher.${this.shouldRestart ? 'restarted' : 'started'}`, path: this.path })
    } catch (error) {
      formatter({ event: `watcher.${this.shouldRestart ? 'restart' : 'start'}.error`, path: this.path, error })
      await this.stop()
    }
    this.shouldRestart = false
  }

  async stop () {
    try {
      if (!this.running) return
      clearTimeout(this.changeTimeout)
      this.changeTimeout = undefined
      const { watcher } = this
      this.watcher = undefined
      await watcher?.close()
      this.ignorers = undefined
      this.patterns = undefined
      if (!this.shouldRestart) this.changedFiles = { added: new Set(), removed: new Set(), modified: new Set() }
      this.running = false
      formatter({ event: 'watcher.stopped', path: this.path })
    } catch (error) {
      formatter({ event: 'watcher.stop.error', path: this.path, error })
    }
  }

  async restart () {
    await this.stop()
    await this.start()
    await this.#changeHandler()
  }

  async #confirmNoopDir () {
    try {
      const files = await readdir(this.path, { withFileTypes: true })
      this.shouldDelete = !files.some(file => file.isDirectory() && (file.name === '.noop'))
    } catch (error) {
      this.shouldDelete = true
    }
  }

  async #setupPatterns () {
    const patterns = {}
    try {
      const discovery = new Discovery(this.path)
      const manifests = await discovery.scan()
      const blueprint = manifests.blueprint

      for (const component of blueprint.components) {
        const root = join(this.path, component.root || '.', '/')
        const filePatterns = await Promise.all(component.filePatterns.map(async pattern => {
          try {
            const stats = await stat(join(this.path, pattern))
            if (!stats.isDirectory()) return pattern
            if (pattern.endsWith('/')) pattern = pattern.substring(0, pattern.length - 1)
            return [pattern, join(pattern, '/'), join(pattern, '**')]
          } catch (error) {
            return pattern
          }
        }))
        patterns[root] = [...(new Set([...(patterns[root] || []), ...filePatterns.flat()]))].sort()
      }
      this.patterns = patterns
    } catch (error) {
      formatter(error)
      this.patterns = {}
    }
  }

  async #setupIgnorers () {
    this.ignorers = {}
    const scanPath = async path => {
      try {
        await access(path, constants.R_OK)
      } catch (error) {
        return
      }
      const files = await readdir(path, { withFileTypes: true })
      const ignoreFile = files.find(file => file.isFile() && (file.name === '.gitignore'))
      if (ignoreFile) {
        const { path, name } = ignoreFile
        const joinedPath = join(path, name)
        this.ignorers[path] = ignore().add((await readFile(joinedPath)).toString())
      }
      const dirs = files.filter(file => {
        const { path, name } = file
        if (file.isDirectory() && (name !== '.git')) {
          const joinedPath = join(path, name)
          for (const ignorerPath in this.ignorers) {
            if (!joinedPath.startsWith(`${ignorerPath}/`)) continue
            const ignorer = this.ignorers[ignorerPath]
            const relativePath = relative(ignorerPath, joinedPath)
            if (ignorer.ignores(relativePath)) return false
          }
          for (const componentRoot in this.patterns) {
            if (componentRoot.startsWith(`${file}/`) || `${file}/`.startsWith(componentRoot)) return true
          }
        }
        return false
      })
      await Promise.all(dirs.map(async ({ path, name }) => await scanPath(join(path, name))))
    }
    await scanPath(this.path)
  }

  async #setupWatcher () {
    this.watcher = watch(this.path, {
      cwd: this.path,
      // ignorePermissionErrors: true,
      // depth: 16,
      ignored: (absolutePath, stats) => {
        const split = absolutePath.split('/')
        const name = split.pop()
        if ((absolutePath === this.path) || (absolutePath === `${this.path}/.noop`) || absolutePath.startsWith(`${this.path}/.noop/`)) {
          return false
        }
        if ((name === '.git') || absolutePath.includes('/.git/') || (name === 'Dockerfile')) return true
        for (const ignorerPath in this.ignorers) {
          if (!absolutePath.startsWith(`${ignorerPath}/`)) continue
          const ignorer = this.ignorers[ignorerPath]
          const relativePath = relative(ignorerPath, absolutePath)
          if (relativePath === '.gitignore') return false
          if (ignorer.ignores(relativePath)) return true
        }
        for (const [componentRoot, patterns] of Object.entries(this.patterns)) {
          if (componentRoot.startsWith(`${absolutePath}/`) || (`${absolutePath}/` === componentRoot)) return false
          if (absolutePath.startsWith(componentRoot)) {
            const relativePath = absolutePath.replace(componentRoot, '')
            if (patterns.some(pattern => minimatch(relativePath, pattern, { partial: true }))) return false
          }
        }
        return true
      }
    })
    await new Promise((resolve, reject) => {
      const readyHandler = () => {
        this.watcher.off('error', errorHandler)
        resolve()
      }
      const errorHandler = error => {
        this.watcher.off('ready', readyHandler)
        reject(error)
      }
      this.watcher.once('ready', readyHandler)
      this.watcher.once('error', errorHandler)
    })

    this.watcher.on('all', async (event, relativeFile) => {
      if (['add', 'change', 'unlink'].includes(event)) {
        const key = {
          add: 'added',
          unlink: 'removed',
          change: 'modified'
        }[event]
        this.changedFiles[key].add(relativeFile)
        await this.#changeHandler(relativeFile)
      }
    })
  }

  async #deleteHandler () {
    formatter({ event: 'watcher.deleted', path: this.path })
    this.emit('delete', Object.fromEntries(
      Object.entries(this.changedFiles)
        .map(([key, value]) => [key, [...value].sort()])
    ))
    await this.stop()
  }

  async #changeHandler (relativeFile = '') {
    const split = relativeFile.split('/')
    const name = split.pop()
    if ((name === '.gitignore') || relativeFile.startsWith('.noop/')) this.shouldRestart = true
    clearInterval(this.changeTimeout)
    this.changeTimeout = setTimeout(async () => {
      await this.#confirmNoopDir()
      if (this.shouldDelete) {
        await this.#deleteHandler()
      } else {
        if (this.shouldRestart) {
          await this.restart()
        } else {
          formatter({ event: 'watcher.changed', path: this.path })
          this.emit('change', Object.fromEntries(
            Object.entries(this.changedFiles)
              .map(([key, value]) => [key, [...value].sort()])
          ))
          this.changedFiles = { added: new Set(), removed: new Set(), modified: new Set() }
          this.changeTimeout = undefined
        }
      }
    }, this.timeoutDuration)
  }
}
