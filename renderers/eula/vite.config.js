import { defineConfig } from 'vite'
import { URL, fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('../../package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    target: 'esnext',
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    outDir: fileURLToPath(new URL('../../.vite/renderer/eula_window', import.meta.url)),
    rolldownOptions: {
      output: {
        comments: false
      }
    }
  },
  plugins: [
    (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
      ? visualizer({ filename: 'stats-eula.html' })
      : null
  ].filter(Boolean)
})
