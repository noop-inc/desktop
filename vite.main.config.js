import { defineConfig, mergeConfig } from 'vite'
import {
  getBuildConfig,
  getBuildDefine,
  external,
  pluginHotRestart
} from './vite.base.config.js'

// https://vitejs.dev/config
export default defineConfig((env) => {
  /** @type {import('vite').ConfigEnv<'build'>} */
  const forgeEnv = env
  const { forgeConfigSelf } = forgeEnv
  const define = getBuildDefine(forgeEnv)
  const config = {
    build: {
      target: 'esnext',
      minify: 'terser',
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
          'chokidar'
          // 'electron-squirrel-startup'
          // 'node-cron'
        ]
      }
    },
    plugins: [pluginHotRestart('restart')],
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
