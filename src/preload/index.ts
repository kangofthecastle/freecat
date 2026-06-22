import { contextBridge, ipcRenderer } from 'electron'

const api = {
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    setName: (name: string) => ipcRenderer.invoke('profile:setName', name)
  }
}

contextBridge.exposeInMainWorld('freecat', api)
