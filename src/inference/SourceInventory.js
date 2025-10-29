import linguist from 'linguist-js'
import { readFile } from 'node:fs/promises'

const important = ['blueprint.yaml', 'README.md', 'package.json', 'requirements.txt', 'Pipfile', 'environment.yml', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']

export default class SourceInventory {
  static async scan (dir) {
    const options = { keepVendored: false, quick: false }
    const results = await linguist(dir, options)
    const files = []
    for (const [path, language] of Object.entries(results.files.results)) {
      const localpath = path.substring(dir.length)
      const filename = localpath.split('/').pop()
      const file = new SourceFile(path, localpath, language)
      if (important.includes(filename)) await file.scan()
      files.push(file)
    }
    return new SourceInventory(files)
  }

  constructor (files) {
    this.files = files
  }
}

class SourceFile {
  #fullpath
  constructor (fullpath, localpath, language) {
    this.#fullpath = fullpath
    this.path = localpath
    this.language = language
  }

  async scan () {
    this.content = (await readFile(this.#fullpath)).toString()
  }
}
