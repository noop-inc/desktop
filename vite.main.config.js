import { defineConfig } from 'vite'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'
import { fileURLToPath, URL } from 'node:url'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))
const nodeModulesDir = fileURLToPath(new URL('./node_modules', import.meta.url))

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

// https://vitejs.dev/config
export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [
        'better-sqlite3',
        'node-pty',
        '@aws-sdk/client-s3'
        // 'chokidar'
        // 'electron-squirrel-startup'
        // 'node-cron'
      ],
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
    },
    lib: {
      entry: 'src/main.js',
      fileName: () => '[name].js',
      formats: ['es']
    }
  },
  plugins: [
    (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
      ? visualizer({ filename: 'stats-main.html' })
      : null
  ].filter(Boolean)
})
