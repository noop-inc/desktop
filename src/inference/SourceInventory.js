import linguist from 'linguist-js'
import { readFile, access, constants } from 'node:fs/promises'
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
      keepVendored: true,
      ignoredFiles: ['**/node_modules/**', '**/.git/**', '**/.DS_Store', '**/Thumbs.db'],
      quick: false,
      childLanguages: true
      // offline: true
    }
    try {
      await access(join(projectDir, '.gitignore'), constants.R_OK)
    } catch (error) {
      options.keepVendored = false
    }
    const results = await linguist(projectDir, options)
    const files = []
    for (const [filePath, language] of Object.entries(results.files.results)) {
      const localPath = filePath.replace(`${projectDir}/`, '')
      const file = await SourceFile.scan(projectDir, localPath, language)
      files.push(file)
    }
    return new SourceInventory(files)
  }

  constructor (files) {
    this.files = files
  }
}

class SourceFile {
  static async scan (projectDir, localPath, language) {
    return await (new SourceFile(projectDir, localPath, language)).scan()
  }

  #projectDir

  get #fullPath () {
    return join(this.#projectDir, this.path)
  }

  constructor (projectDir, localPath, language) {
    this.#projectDir = projectDir
    this.path = localPath
    this.language = language
  }

  async scan () {
    if (isImportant(basename(this.path))) {
      this.content = (await readFile(this.#fullPath)).toString()
    }
    return this
  }
}
