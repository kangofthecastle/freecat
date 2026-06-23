import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type { FreecatApi } from '../shared/api'

const api: FreecatApi = {
  profile: {
    get: () => ipcRenderer.invoke(CH.profileGet),
    setName: (name) => ipcRenderer.invoke(CH.profileSetName, name)
  },
  gamification: {
    getState: () => ipcRenderer.invoke(CH.gamGetState),
    recordActivity: (input) => ipcRenderer.invoke(CH.gamRecordActivity, input),
    buyEgg: () => ipcRenderer.invoke(CH.gamBuyEgg),
    buyTreat: () => ipcRenderer.invoke(CH.gamBuyTreat),
    buyItem: (itemKey) => ipcRenderer.invoke(CH.gamBuyItem, itemKey),
    hatchEgg: () => ipcRenderer.invoke(CH.gamHatchEgg),
    setActivePet: (petId) => ipcRenderer.invoke(CH.gamSetActivePet, petId),
    equipItem: (petId, itemKey) => ipcRenderer.invoke(CH.gamEquipItem, { petId, itemKey }),
    unequipItem: (petId, itemKey) => ipcRenderer.invoke(CH.gamUnequipItem, { petId, itemKey }),
    renamePet: (petId, name) => ipcRenderer.invoke(CH.gamRenamePet, { petId, name })
  }
}
contextBridge.exposeInMainWorld('freecat', api)
