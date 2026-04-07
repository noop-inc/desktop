import { defineConfig } from 'vite'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'
import { URL } from 'node:url'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

// https://vitejs.dev/config
export default defineConfig({
  build: {
    target: 'esnext',
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    rollupOptions: {
      platform: 'node',
      external: [
        'linguist-js'
      ],
      output: {
        comments: false
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
