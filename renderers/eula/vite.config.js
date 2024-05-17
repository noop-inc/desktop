import { defineConfig } from 'vite'
import { pluginExposeRenderer } from '../../vite.base.config.js'
import { fileURLToPath, URL } from 'node:url'
import autoprefixer from 'autoprefixer'

// https://vitejs.dev/config
export default defineConfig((env) => {
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
      minify: 'terser',
      cssMinify: 'lightningcss',
      outDir: fileURLToPath(new URL(`../../.vite/renderer/${name}`, import.meta.url))
    },
    plugins: [
      pluginExposeRenderer(name)
    ],
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
