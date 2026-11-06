'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('iridia', {
  init: inv('app:init'),
  setSettings: inv('settings:set'),
  reprobe: inv('ffmpeg:reprobe'),
  listDrives: inv('drives:list'),
  readDisc: inv('disc:read'),
  lookup: inv('meta:lookup'),
  cover: inv('meta:cover'),
  pickFolder: inv('dialog:folder'),
  pickCover: inv('dialog:cover'),
  pickFfmpeg: inv('dialog:ffmpeg'),
  open: inv('shell:open'),
  url: inv('shell:url'),
  eject: inv('disc:eject'),
  plan: inv('preset:plan'),
  startRip: inv('rip:start'),
  cancelRip: inv('rip:cancel'),
  win: { min: inv('win:min'), max: inv('win:max'), close: inv('win:close') },
  on: (ch, fn) => { const h = (e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.off(ch, h); }
});
