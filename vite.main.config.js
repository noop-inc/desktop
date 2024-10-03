import { defineConfig, splitVendorChunkPlugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

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
      ]
    }
  },
  plugins: [
    splitVendorChunkPlugin(),
    (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
      ? visualizer({ filename: 'stats-main.html' })
      : null
  ].filter(Boolean)
})
