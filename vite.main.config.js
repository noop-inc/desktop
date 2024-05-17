import { defineConfig, mergeConfig, splitVendorChunkPlugin } from 'vite'
import {
  getBuildConfig,
  getBuildDefine,
  external,
  pluginHotRestart
} from './vite.base.config.js'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

// https://vitejs.dev/config
export default defineConfig(env => {
  /** @type {import('vite').ConfigEnv<'build'>} */
  const forgeEnv = env
  const { forgeConfigSelf } = forgeEnv
  const define = getBuildDefine(forgeEnv)
  const config = {
    build: {
      lib: {
        entry: forgeConfigSelf.entry,
        fileName: () => '[name].js',
        formats: ['es']
      },
      rollupOptions: {
        external: [
          ...external,
          'better-sqlite3',
          'node-pty',
          'chokidar',
          '@aws-sdk/client-s3'
          // 'electron-squirrel-startup'
          // 'node-cron'
        ]
      }
    },
    plugins: [
      pluginHotRestart('restart'),
      splitVendorChunkPlugin(),
      (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
        ? visualizer({ filename: 'stats-main.html' })
        : null
    ].filter(Boolean),
    define,
    resolve: {
      // Some libs that can run in both Web and Node.js, such as `axios`, we need to tell Vite to build them in Node.js.
      conditions: ['node'],
      // Load the Node.js entry.
      mainFields: ['module', 'jsnext:main', 'jsnext']
    }
  }

  return mergeConfig(getBuildConfig(forgeEnv), config)
})
