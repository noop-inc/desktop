import { defineConfig, mergeConfig } from 'vite'
import {
  getBuildConfig,
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
  /** @type {import('vite').UserConfig} */
  const config = {
    build: {
      rollupOptions: {
        external,
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: forgeConfigSelf.entry,
        output: {
          format: 'cjs',
          // It should not be split chunks.
          inlineDynamicImports: true,
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]'
        }
      }
    },
    plugins: [
      pluginHotRestart('reload'),
      (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
        ? visualizer({ filename: 'stats-preload.html' })
        : null
    ].filter(Boolean)
  }

  return mergeConfig(getBuildConfig(forgeEnv), config)
})
