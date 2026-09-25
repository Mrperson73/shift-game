import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { KnobsApi } from '../shared/types';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

const api: KnobsApi = {
  init: () => invoke('app:init'),
  open: (p) => invoke('game:open', p),
  openDialog: (kind) => invoke('game:openDialog', kind),
  openDemo: () => invoke('game:openDemo'),
  paste: (html) => invoke('game:paste', html),
  close: () => invoke('game:close'),
  setKnobs: (values) => send('game:setKnobs', values),
  resetKnobs: (keys) => invoke('game:resetKnobs', keys),
  setPinned: (key, pinned) => send('game:setPinned', key, pinned),
  setRange: (key, range) => send('game:setRange', key, range),
  restart: (scale) => invoke('game:restart', scale),
  bake: () => invoke('game:bake'),
  source: (file) => invoke('game:source', file),
  versions: () => invoke('versions:list'),
  previewVersion: (id) => invoke('versions:preview', id),
  restoreVersion: (id) => invoke('versions:restore', id),
  diffVersion: (id) => invoke('versions:diff', id),
  captureThumb: (rect) => send('thumb:capture', rect),
  reveal: () => send('shell:reveal'),
  openGamesFolder: () => send('shell:gamesFolder'),
  openExternal: (url) => send('shell:external', url),
  removeRecent: (id) => invoke('recents:remove', id),
  recents: () => invoke('recents:list'),
  setSettings: (s) => invoke('settings:set', s),
  toggleDevTools: () => send('win:devtools'),
  setFullscreen: (on) => send('win:fullscreen', on),
  pathForFile: (file) => webUtils.getPathForFile(file),
  on: ((channel: string, cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }) as KnobsApi['on'],
};

contextBridge.exposeInMainWorld('knobs', api);
