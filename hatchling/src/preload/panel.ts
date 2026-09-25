import { contextBridge, ipcRenderer } from 'electron';
import type { PanelApi } from '../shared/api';

const api: PanelApi = {
  init: () => ipcRenderer.invoke('panel:init'),
  hatch: (o) => ipcRenderer.invoke('panel:hatch', o),
  setSettings: (s) => ipcRenderer.invoke('panel:settings', s),
  command: (c) => ipcRenderer.send('panel:command', c),
  newEgg: () => ipcRenderer.invoke('panel:newEgg'),
  openModsFolder: () => ipcRenderer.send('panel:mods'),
  openExternal: (url) => ipcRenderer.send('panel:external', url),
  close: () => ipcRenderer.send('panel:close'),
  onUpdate: (cb) => {
    ipcRenderer.on('update', (_e, v) => cb(v));
  },
  onView: (cb) => {
    ipcRenderer.on('view', (_e, v) => cb(v));
  },
};

contextBridge.exposeInMainWorld('panel', api);
