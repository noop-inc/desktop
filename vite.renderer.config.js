import { defineConfig, mergeConfig } from 'vite'
import { URL, fileURLToPath } from 'node:url'
import consoleConfig from '@noop-inc/console/vite.config.js'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

export default mergeConfig(consoleConfig, defineConfig({
  build: {
    outDir: fileURLToPath(new URL('./.vite/renderer/main_window', import.meta.url))
  },
  plugins: [
    (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
      ? [visualizer({ filename: 'stats-renderer.html' })]
      : null
  ].filter(Boolean)
}))
