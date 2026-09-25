import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayApi } from '../shared/api';

const on = (channel: string) => (cb: (v: never) => void) => {
  ipcRenderer.on(channel, (_e, v) => cb(v as never));
};

const api: OverlayApi = {
  init: () => ipcRenderer.invoke('overlay:init'),
  onWorld: on('world'),
  onCursor: on('cursor'),
  onActivity: on('activity'),
  onHidden: on('hidden'),
  onSettings: on('settings'),
  onCommand: on('command'),
  onSpecies: on('species'),
  onPet: on('pet'),
  setCapture: (v) => ipcRenderer.send('overlay:capture', !!v),
  save: (p) => ipcRenderer.send('overlay:save', p),
  notify: (e) => ipcRenderer.send('overlay:notify', e),
  openCard: () => ipcRenderer.send('overlay:card'),
  menu: () => ipcRenderer.send('overlay:menu'),
  error: (m) => ipcRenderer.send('overlay:error', String(m)),
  smoke: (r) => ipcRenderer.send('overlay:smoke', r),
};

contextBridge.exposeInMainWorld('hatch', api);
