// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld(
  'electron',
  {
    logout: async () => {
      await ipcRenderer.invoke('logout')
    }
  }
)

ipcRenderer.on('update-route', async (_event, path) => {
  window.dispatchEvent(new CustomEvent('update-route', {
    detail: { path }
  }))
})
