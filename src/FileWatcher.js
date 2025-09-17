import { watch } from 'chokidar'
import ignore from 'ignore'
import { readdir, readFile, access, constants, stat } from 'node:fs/promises'
import { join, relative, sep, normalize, posix, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import Discovery from '@noop-inc/discovery/lib/Discovery.js'
import { minimatch } from 'minimatch'
import { inspect } from 'node:util'
import { app } from 'electron'

const mainWindowViteDevServerURL = MAIN_WINDOW_VITE_DEV_SERVER_URL // eslint-disable-line no-undef
const packaged = (!mainWindowViteDevServerURL && app.isPackaged)

const formatter = (...messages) =>
  console[messages[0].event.includes('.error') ? 'error' : 'log'](
    ...messages.map(message =>
      inspect(
        message,
        { breakLength: 10000, colors: !packaged, compact: true, depth: null }
      )
    )
  )

export default class FileWatcher extends EventEmitter {
  repoId
  url
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

  constructor ({ repoId, url }) {
    super()
    const path = fileURLToPath(url)
    Object.assign(this, { repoId, url, path })
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
        const normalizedRoot = component.root ? normalize(component.root) : '.'
        const absoluteRoot = join(this.path, normalizedRoot, sep)
        const filePatterns = await Promise.all(component.filePatterns.map(async pattern => {
          try {
            const normalizedPattern = normalize(pattern)
            let posixPattern = posix.normalize(pattern)
            const absolutePattern = join(absoluteRoot, normalizedPattern)
            const stats = await stat(absolutePattern)
            if (!stats.isDirectory()) return posixPattern
            if (posixPattern.endsWith(posix.sep)) posixPattern = posixPattern.substring(0, posixPattern.length - posix.sep.length)
            return [posixPattern, posix.join(posixPattern, posix.sep), posix.join(posixPattern, '**')]
          } catch (error) {
            return posix.normalize(pattern)
          }
        }))
        patterns[absoluteRoot] = [...(new Set([...(patterns[absoluteRoot] || []), ...filePatterns.flat()]))].sort()
      }
      formatter({ event: 'watcher.patterns', path: this.path, patterns })
      this.patterns = patterns
    } catch (error) {
      formatter({ event: 'watcher.patterns.error', path: this.path, error })
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
            if (!joinedPath.startsWith(join(ignorerPath, sep))) continue
            const ignorer = this.ignorers[ignorerPath]
            const relativePath = relative(ignorerPath, joinedPath)
            if (ignorer.ignores(relativePath)) return false
          }
          for (const componentRoot in this.patterns) {
            if (componentRoot.startsWith(join(joinedPath, sep)) || join(joinedPath, sep).startsWith(componentRoot)) return true
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
        const normalizedPath = normalize(absolutePath)
        const name = basename(normalizedPath)
        if (
          (normalizedPath === this.path) ||
          (normalizedPath === join(this.path, '.noop')) ||
          normalizedPath.startsWith(join(this.path, '.noop', sep))
        ) {
          return false
        }
        if (
          (name === '.git') ||
          normalizedPath.includes(join(sep, '.git', sep)) ||
          (name === 'node_modules') ||
          normalizedPath.includes(join(sep, 'node_modules', sep)) ||
          (name === 'Dockerfile')
        ) {
          return true
        }
        for (const ignorerPath in this.ignorers) {
          if (!normalizedPath.startsWith(join(ignorerPath, sep))) continue
          const ignorer = this.ignorers[ignorerPath]
          const relativePath = relative(ignorerPath, normalizedPath)
          if (relativePath === '.gitignore') return false
          if (ignorer.ignores(relativePath)) return true
        }
        for (const [componentRoot, patterns] of Object.entries(this.patterns)) {
          if (
            componentRoot.startsWith(join(normalizedPath, sep)) ||
            (join(normalizedPath, sep) === componentRoot)
          ) {
            return false
          }
          if (normalizedPath.startsWith(componentRoot)) {
            const relativePath = normalizedPath.replace(componentRoot, '')
            if (patterns.some(pattern => minimatch(relativePath, pattern, { partial: true, dot: true }))) {
              return false
            }
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
    const name = basename(relativeFile)
    if ((name === '.gitignore') || relativeFile.startsWith(join('.noop', sep))) this.shouldRestart = true
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
