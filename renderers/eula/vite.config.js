import { defineConfig, splitVendorChunkPlugin } from 'vite'
import { pluginExposeRenderer } from '../../vite.base.config.js'
import { fileURLToPath, URL } from 'node:url'
import autoprefixer from 'autoprefixer'
import { readFile } from 'node:fs/promises'
import { visualizer } from 'rollup-plugin-visualizer'

const packageJsonUrl = new URL('../../package.json', import.meta.url)
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
    root: fileURLToPath(new URL('.', import.meta.url)),
    mode,
    base: './',
    build: {
      target: 'esnext',
      outDir: fileURLToPath(new URL(`../../.vite/renderer/${name}`, import.meta.url))
    },
    plugins: [
      pluginExposeRenderer(name),
      splitVendorChunkPlugin(),
      (process.env.npm_lifecycle_event === 'report') && (process.env.npm_package_name === packageJson.name)
        ? visualizer({ filename: 'stats-eula.html' })
        : null
    ].filter(Boolean),
    resolve: {
      preserveSymlinks: true
    },
    clearScreen: false,
    css: {
      postcss: {
        plugins: [
          autoprefixer()
        ]
      }
    }
  }
})
