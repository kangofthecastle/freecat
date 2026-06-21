import { contextBridge } from 'electron'

const api = {}

contextBridge.exposeInMainWorld('freecat', api)
