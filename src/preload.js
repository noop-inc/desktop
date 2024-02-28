// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld(
  'electron',
  {
    logout: async () =>
      await ipcRenderer.invoke('logout'),
    subdirectoryInput: async () =>
      await ipcRenderer.invoke('subdirectory-input'),
    cloneRepository: async ({ repositoryUrl, subdirectory }) =>
      await ipcRenderer.invoke('clone-repository', { repositoryUrl, subdirectory }),
    workshopVmStatus: async () =>
      await ipcRenderer.invoke('workshop-vm-status'),
    openPath: async url =>
      await ipcRenderer.invoke('open-path', url),
    showLogFiles: async () =>
      await ipcRenderer.invoke('show-log-files'),
    restartWorkshopVm: async reset =>
      await ipcRenderer.invoke('restart-workshop-vm', reset),
    setBadgeCount: async num =>
      await ipcRenderer.invoke('set-badge-count', num),
    localRepositories: async repos =>
      await ipcRenderer.invoke('local-repositories', repos || []),
    eula: async accept =>
      await ipcRenderer.invoke('eula', accept),
    intercomDesktopLogin: async () =>
      await ipcRenderer.invoke('intercom-desktop-login')
  }
)

ipcRenderer.on('update-route', async (_event, path) => {
  window.dispatchEvent(new CustomEvent('update-route', {
    detail: { path }
  }))
})

ipcRenderer.on('workshop-vm-status', async (_event, status) => {
  window.dispatchEvent(new CustomEvent('workshop-vm-status', {
    detail: { status }
  }))
})
