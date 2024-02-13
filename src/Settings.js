import { join } from 'node:path'
import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parse, stringify } from '@noop-inc/foundation/lib/Yaml.js'
import { getProperty, setProperty, hasProperty, deleteProperty } from 'dot-prop'
import { inspect } from 'node:util'

const mainWindowViteDevServerURL = MAIN_WINDOW_VITE_DEV_SERVER_URL // eslint-disable-line no-undef
const packaged = (!mainWindowViteDevServerURL && app.isPackaged)

const userData = app.getPath('userData')
const noopDir = join(userData, '.noop')
const file = join(noopDir, 'settings.yaml')

const formatter = (...messages) =>
  console[messages[0].event.includes('.error') ? 'error' : 'log'](
    ...messages.map(message =>
      inspect(
        message,
        { breakLength: 10000, colors: !packaged, compact: true, depth: null }
      )
    )
  )

class Settings {
  #started
  #settings = {}

  async start () {
    if (this.#started) return
    try {
      this.#settings = parse((await readFile(file)).toString())
    } catch (error) {
      await this.#write()
    }
    formatter({ event: 'workshop.settings.start', settings: this.settings, file })
    this.#started = true
  }

  async get (path) {
    await this.start()
    return getProperty(this.#settings, path)
  }

  async has (path) {
    await this.start()
    return hasProperty(this.#settings, path)
  }

  async set (path, value) {
    await this.start()
    formatter({ event: 'workshop.settings.set', path, value, file })
    setProperty(this.#settings, path, value)
    await this.#write()
  }

  async delete (path) {
    await this.start()
    formatter({ event: 'workshop.settings.delete', path, file })
    deleteProperty(this.#settings, path)
    await this.#write()
  }

  async #write () {
    const yaml = stringify(this.#settings)
    formatter({ event: 'workshop.settings.update', settings: this.settings, file })
    await mkdir(noopDir, { recursive: true })
    await writeFile(file, yaml)
  }

  get settings () {
    return this.#settings
  }
}

export default new Settings()
