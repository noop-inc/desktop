import { defineConfig } from 'vite'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

// https://vitejs.dev/config
export default defineConfig({
  build: {
    target: 'esnext',
    modulePreload: { polyfill: false },
    reportCompressedSize: false
  },
  plugins: [
    (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
      ? [visualizer({ filename: 'stats-preload.html' })]
      : null
  ].filter(Boolean)
})
