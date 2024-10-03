import { defineConfig, splitVendorChunkPlugin } from 'vite'
import { URL, fileURLToPath } from 'node:url'
import autoprefixer from 'autoprefixer'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('../../package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    target: 'esnext',
    outDir: fileURLToPath(new URL('../../.vite/renderer/eula_window', import.meta.url))
  },
  plugins: [
    splitVendorChunkPlugin(),
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
