import { defineConfig } from 'vite'
import { pluginExposeRenderer } from './vite.base.config.mjs'
import { fileURLToPath, URL } from 'node:url'
import consoleConfig from '@noop-inc/console/vite.config.mjs'

// https://vitejs.dev/config
export default defineConfig((env) => {
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
      ...consoleConfig.plugins
    ],
    resolve: {
      preserveSymlinks: true,
      ...consoleConfig.resolve
    },
    clearScreen: false
  }
})
