import linguist from 'linguist-js'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

const important = [
  'blueprint.yaml',
  'app.yml',
  'app.yaml',
  'README.md',
  'README',
  'package.json',
  'requirements.txt',
  'Pipfile',
  'environment.yml',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'app.html',
  'index.html',
  'Cargo.toml',
  'pom.xml',
  'application.yml',
  'application.yaml',
  'mix.exs',
  'go.mod',
  'Gemfile',
  'jsconfig.json',
  'tsconfig.json',
  'vite.config',
  'webpack.config',
  'svelte.config',
  'next.config',
  'astro.config',
  'nuxt.config',
  'app.config',
  'vue.config',
  '.node-version',
  '.python-version',
  '.java-version',
  'vercel.json',
  'netlify.toml',
  'railway.toml',
  'railway.json',
  'fly.toml',
  'render.yaml',
  'hugo.toml',
  'hugo.yaml',
  'hugo.json',
  'composer.json',
  'wp-config.php'
]

const isImportant = filename => {
  if (important.includes(filename)) return true
  const extless = basename(filename, extname(filename))
  if (extless === filename) return false
  return isImportant(extless)
}

export default class SourceInventory {
  static async scan (projectDir) {
    const options = {
      keepVendored: false,
      ignoredFiles: ['**/node_modules/**', '**/.git/**', '**/.DS_Store'],
      quick: false,
      childLanguages: true
    }
    const results = await linguist(projectDir, options)
    const files = []
    for (const [filePath, language] of Object.entries(results.files.results)) {
      const localpath = filePath.replace(projectDir, '.')
      const file = await SourceFile.scan(projectDir, localpath, language)
      files.push(file)
    }
    return new SourceInventory(files)
  }

  constructor (files) {
    this.files = files
  }
}

class SourceFile {
  static async scan (projectDir, filePath, language) {
    return await (new SourceFile(projectDir, filePath, language)).scan()
  }

  #projectDir

  get #fullpath () {
    return join(this.#projectDir, this.path)
  }

  constructor (projectDir, filePath, language) {
    this.#projectDir = projectDir
    this.path = filePath.replace(projectDir, '.')
    this.language = language
  }

  async scan () {
    if (isImportant(basename(this.path))) {
      this.content = (await readFile(this.#fullpath)).toString()
    }
    return this
  }
}
