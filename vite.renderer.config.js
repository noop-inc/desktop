import { defineConfig } from 'vite'
import { pluginExposeRenderer } from './vite.base.config.js'
import { fileURLToPath, URL } from 'node:url'
import consoleConfig from '@noop-inc/console/vite.config.js'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('./package.json', import.meta.url)
const packageJson = JSON.parse(await readFile(packageJsonUrl))

// https://vitejs.dev/config
export default defineConfig(env => {
  /** @type {import('vite').ConfigEnv<'renderer'>} */
  const forgeEnv = env
  const { /* root, */ mode, forgeConfigSelf } = forgeEnv
  const name = forgeConfigSelf.name ?? ''

  /** @type {import('vite').UserConfig} */
  return {
    // root,
    mode,
    // base: './',
    ...consoleConfig,
    build: {
      outDir: fileURLToPath(new URL(`./.vite/renderer/${name}`, import.meta.url)),
      ...consoleConfig.build
    },
    plugins: [
      pluginExposeRenderer(name),
      ...consoleConfig.plugins,
      (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
        ? visualizer({ filename: 'stats-renderer.html' })
        : null
    ].filter(Boolean),
    resolve: {
      preserveSymlinks: true,
      ...consoleConfig.resolve
    },
    clearScreen: false
  }
})
