import { defineConfig } from 'vite'
import { URL, fileURLToPath } from 'node:url'
import autoprefixer from 'autoprefixer'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('../../package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

const nodeModulesDir = fileURLToPath(new URL('../../node_modules', import.meta.url))

const notDynamicallyImported = new Set()
const dynamicallyImportedChecked = new Set()

const checkIfNotDynamicallyImported = (id, { getModuleInfo }) => {
  if (!dynamicallyImportedChecked.has(id)) {
    const info = getModuleInfo(id)
    if (!info.importers.length && info.isEntry) {
      notDynamicallyImported.add(id)
    } else if (info.importers.length) {
      const results = info.importers.map(id => {
        return checkIfNotDynamicallyImported(id, { getModuleInfo })
      })
      if (results.some(Boolean)) {
        notDynamicallyImported.add(id)
      }
    }
    dynamicallyImportedChecked.add(id)
  }
  return notDynamicallyImported.has(id)
}
const nodeModuleImport = new Set()
const nodeModuleChecked = new Set()

const checkIfNodeModulesImport = (id, { getModuleInfo }) => {
  if (!nodeModuleChecked.has(id)) {
    const info = getModuleInfo(id)
    if (id.includes(`${nodeModulesDir}/`)) {
      nodeModuleImport.add(id)
    } else if (info.importers.length) {
      const results = info.importers.map(id => {
        return checkIfNodeModulesImport(id, { getModuleInfo })
      })
      if (results.every(Boolean)) {
        nodeModuleImport.add(id)
      }
    }
    nodeModuleChecked.add(id)
  }
  return nodeModuleImport.has(id)
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    target: 'esnext',
    outDir: fileURLToPath(new URL('../../.vite/renderer/eula_window', import.meta.url)),
    rollupOptions: {
      output: {
        manualChunks (id, { getModuleInfo }) {
          const result = checkIfNotDynamicallyImported(id, { getModuleInfo })
          if (result) {
            return checkIfNodeModulesImport(id, { getModuleInfo })
              ? 'vendor'
              : 'index'
          }
          return null
        }
      }
    }
  },
  plugins: [
    (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
      ? visualizer({ filename: 'stats-eula.html' })
      : null
  ].filter(Boolean),
  css: {
    postcss: {
      plugins: [
        autoprefixer()
      ]
    }
  }
})
