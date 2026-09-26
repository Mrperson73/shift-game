import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayApi } from '../shared/api';

const on = (channel: string) => (cb: (v: never) => void) => {
  ipcRenderer.on(channel, (_e, v) => cb(v as never));
};

const api: OverlayApi = {
  init: () => ipcRenderer.invoke('overlay:init'),
  ready: () => ipcRenderer.send('overlay:ready'),
  onWorld: on('world'),
  onCursor: on('cursor'),
  onActivity: on('activity'),
  onHidden: on('hidden'),
  onSettings: on('settings'),
  onCommand: on('command'),
  onSpecies: on('species'),
  onAdd: on('add'),
  onRemove: on('remove'),
  setCapture: (v) => ipcRenderer.send('overlay:capture', !!v),
  save: (p) => ipcRenderer.send('overlay:save', p),
  leave: (l) => ipcRenderer.send('overlay:leave', l),
  notify: (e) => ipcRenderer.send('overlay:notify', e),
  openCard: (id) => ipcRenderer.send('overlay:card', id),
  menu: (id) => ipcRenderer.send('overlay:menu', id),
  error: (m) => ipcRenderer.send('overlay:error', String(m)),
  smoke: (r) => ipcRenderer.send('overlay:smoke', r),
};

contextBridge.exposeInMainWorld('hatch', api);
