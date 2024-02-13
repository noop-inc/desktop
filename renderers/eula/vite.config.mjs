import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import autoprefixer from 'autoprefixer'

// https://vitejs.dev/config
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  css: {
    postcss: {
      plugins: [
        autoprefixer()
      ]
    }
  }
})
