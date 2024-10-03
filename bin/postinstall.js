import { writeFile, readFile } from 'node:fs/promises'

const overrideUrl = new URL('./vite.main.config.js', import.meta.url)
const defaultUrl = new URL('../node_modules/@electron-forge/plugin-vite/dist/config/vite.main.config.js', import.meta.url)

const overrideConfig = await readFile(overrideUrl)
await writeFile(defaultUrl, overrideConfig)
