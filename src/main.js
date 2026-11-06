'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, net, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { PRESETS, GROUPS, LAYOUTS, STD_RATES } = require('./core/catalog');
const { effectiveLayout, effectiveRate } = require('./core/ffargs');
const { Ripper } = require('./core/ripper');
const { discId, cddbId, lookupMusicBrainz, fetchCover } = require('./core/metadata');

const DEMO = process.env.IRIDIA_DEMO === '1' || process.argv.includes('--demo');
const IS_WIN = process.platform === 'win32';

/* ---------- portable data folder: next to the executable when writable */
function exeDir() { return app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..'); }
const portableData = path.join(exeDir(), 'IRIDIA-data');
let dataDir = portableData;
try { fs.mkdirSync(dataDir, { recursive: true }); fs.accessSync(dataDir, fs.constants.W_OK); }
catch (e) { dataDir = path.join(app.getPath('appData'), 'IRIDIA'); fs.mkdirSync(dataDir, { recursive: true }); }
app.setPath('userData', path.join(dataDir, 'profile'));
const settingsFile = path.join(dataDir, 'settings.json');

const DEFAULTS = {
  ffmpegPath: '', outDir: path.join(app.getPath('music'), 'IRIDIA'),
  template: '{albumartist} - {album} [{format}]/{track} - {title}',
  imageTemplate: '{albumartist} - {album} [{format}]/{albumartist} - {album}',
  profiles: [{ presetId: 'flac', selections: {} }], layoutId: 'stereo', upmix: 'smart', rate: 44100,
  secure: false, offset: 0, retries: 10, deemphasis: true, image: false,
  writeCue: true, writeLog: true, writeM3u: true, saveCover: true, embedCover: true,
  autoLookup: true, ejectWhenDone: false, lastDrive: '', threads: 0
};
function loadSettings() { try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch (e) { return Object.assign({}, DEFAULTS); } }
let settings = loadSettings();
function saveSettings() { try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch (e) {} }

/* ---------- FFmpeg discovery */
function ffmpegCandidates() {
  const exe = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
  const list = [];
  if (settings.ffmpegPath) list.push(settings.ffmpegPath);
  list.push(path.join(exeDir(), 'ffmpeg', exe), path.join(exeDir(), exe), path.join(process.resourcesPath || '', 'ffmpeg', exe));
  list.push(exe); // PATH
  return list;
}
let ffInfo = null;
function probeFfmpeg() {
  return new Promise(async (resolve) => {
    for (const cand of ffmpegCandidates()) {
      if (cand.includes(path.sep) && !fs.existsSync(cand)) continue;
      const ok = await new Promise(r => execFile(cand, ['-hide_banner', '-version'], { windowsHide: true, timeout: 15000 }, (err, out) => r(err ? null : out)));
      if (!ok) continue;
      const enc = await new Promise(r => execFile(cand, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 15000, maxBuffer: 4 << 20 }, (err, out) => r(err ? '' : out)));
      const filt = await new Promise(r => execFile(cand, ['-hide_banner', '-h', 'filter=aresample'], { windowsHide: true, timeout: 15000, maxBuffer: 4 << 20 }, (err, out) => r(err ? '' : out)));
      const encoders = [...enc.matchAll(/^\s*A[\w.]{5}\s+(\S+)/gm)].map(m => m[1]);
      const version = (ok.match(/ffmpeg version (\S+)/) || [])[1] || 'unknown';
      ffInfo = { path: cand, version, encoders, soxr: /soxr/i.test(ok) };
      return resolve(ffInfo);
    }
    ffInfo = { path: null, version: null, encoders: [], soxr: false };
    resolve(ffInfo);
  });
}

/* ---------- drives */
let cdapi = null;
function driveApi() {
  if (cdapi !== null) return cdapi;
  try { cdapi = IS_WIN ? require('./core/cdrom_win') : false; } catch (e) { console.error(e); cdapi = false; }
  return cdapi;
}
const driveObjs = new Map();
function getDrive(id) {
  if (driveObjs.has(id)) return driveObjs.get(id);
  let d;
  if (id === 'DEMO') { const { DemoDrive } = require('./core/demodrive'); d = new DemoDrive(); }
  else d = new (driveApi().WinCdDrive)(id);
  driveObjs.set(id, d);
  return d;
}

/* ---------- window */
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1180, minHeight: 720, frame: false, backgroundColor: '#07060d', show: false,
    title: 'IRIDIA', icon: path.join(__dirname, 'renderer', 'assets', IS_WIN ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.env.IRIDIA_SCENARIO) { // developer: scripted UI recording
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 5000));
      require(process.env.IRIDIA_SCENARIO)(win, app).catch(e => { console.error(e); app.quit(); });
    });
  }
  if (process.env.IRIDIA_SHOT) { // developer screenshot hook
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, +(process.env.IRIDIA_SHOT_DELAY || 2500)));
      if (process.env.IRIDIA_SHOT_JS) { await win.webContents.executeJavaScript(process.env.IRIDIA_SHOT_JS).catch(e => console.error(e)); await new Promise(r => setTimeout(r, +(process.env.IRIDIA_SHOT_AFTER || 1200))); }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.IRIDIA_SHOT, img.toPNG());
      if (!process.env.IRIDIA_SHOT_KEEP) app.quit();
    });
  }
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => { createWindow(); });
app.on('window-all-closed', () => { if (currentRip) currentRip.cancel(); app.quit(); });

/* ---------- IPC */
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

ipcMain.handle('win:min', () => win.minimize());
ipcMain.handle('win:max', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.handle('win:close', () => win.close());

ipcMain.handle('app:init', async () => {
  const ff = await probeFfmpeg();
  return {
    version: app.getVersion(), platform: process.platform, cpus: require('os').cpus().length, demo: DEMO, dataDir, settings,
    catalog: {
      groups: GROUPS, layouts: LAYOUTS, rates: STD_RATES,
      presets: PRESETS.map(p => ({ id: p.id, name: p.name, group: p.group, desc: p.desc, ext: p.ext, codec: p.codec, fmt: p.fmt, maxCh: p.maxCh, chOptions: p.chOptions || null,
        layouts: p.layouts || null, rates: p.rates, lossless: !!p.lossless, experimental: !!p.experimental, windowsOnly: !!p.windowsOnly, cover: !!p.cover,
        opts: p.opts.map(o => ({ key: o.key, label: o.label, def: o.def, values: o.values.map(v => v.label) })),
        available: p.codec === 'dsd' ? !!ff.path : ff.encoders.includes(p.codec) }))
    },
    ffmpeg: { path: ff.path, version: ff.version, soxr: ff.soxr, encoderCount: ff.encoders.length }
  };
});

ipcMain.handle('settings:set', (e, patch) => { settings = Object.assign(settings, patch); saveSettings(); return settings; });
ipcMain.handle('ffmpeg:reprobe', async () => { const ff = await probeFfmpeg(); return { path: ff.path, version: ff.version, soxr: ff.soxr, encoders: ff.encoders }; });

ipcMain.handle('drives:list', async () => {
  const out = [];
  const api = driveApi();
  if (api) {
    for (const d of api.listDrives()) {
      let name = '';
      try { name = await getDrive(d.id).name(); } catch (e) {}
      out.push({ id: d.id, name: name || 'Optical drive' });
    }
  }
  if (DEMO || !out.length && !IS_WIN) out.push({ id: 'DEMO', name: 'IRIDIA Virtual Drive (demo)' });
  return out;
});

ipcMain.handle('disc:read', async (e, id) => {
  const d = getDrive(id);
  if (!(await d.mediaPresent())) return { present: false };
  const toc = await d.readToc();
  const cdtext = await d.readCdText().catch(() => null);
  const mb = discId(toc);
  return { present: true, toc, cdtext, discId: mb ? mb.id : null, cddb: cddbId(toc).toString(16).padStart(8, '0'), driveName: await d.name().catch(() => '') };
});

const netFetch = (url, opts) => net.fetch(url, opts);
ipcMain.handle('meta:lookup', async (e, toc) => {
  if (DEMO && toc.tracks.length === 8 && toc.leadout === 20325) {
    return [{ mbid: 'demo', title: 'Spectrum Sessions', artist: 'The Iridia Ensemble', year: '2026', genre: 'Electronic', country: 'XW', label: 'Prism Records', discNumber: 1, discCount: 1,
      tracks: ['Prismatic Dawn', 'Spectral Lines', 'Iridescence', 'Halo Over Tokyo', 'Refraction', 'Chromatic Tides', 'Aurora Engine', 'Afterglow'].map(t => ({ title: t, artist: 'The Iridia Ensemble' })), source: 'Demo' }];
  }
  return lookupMusicBrainz(toc, netFetch);
});
ipcMain.handle('meta:cover', async (e, mbid) => {
  if (mbid === 'demo') return { mime: 'image/jpeg', data: fs.readFileSync(path.join(__dirname, 'renderer', 'assets', 'demo-cover.jpg')).toString('base64') };
  const c = await fetchCover(mbid, netFetch);
  return c ? { mime: c.mime, data: c.data.toString('base64') } : null;
});

ipcMain.handle('dialog:folder', async (e, current) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: current || settings.outDir });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:cover', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }] });
  if (r.canceled) return null;
  const f = r.filePaths[0];
  return { mime: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg', data: fs.readFileSync(f).toString('base64') };
});
ipcMain.handle('dialog:ffmpeg', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: IS_WIN ? [{ name: 'FFmpeg', extensions: ['exe'] }] : [] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('shell:open', (e, p) => shell.openPath(p));
ipcMain.handle('shell:url', (e, u) => shell.openExternal(u));

ipcMain.handle('disc:eject', async (e, id) => { try { await getDrive(id).eject(); return true; } catch (err) { return false; } });

ipcMain.handle('preset:plan', (e, { profiles, layoutId, rate }) => profiles.map(pf => {
  const p = PRESETS.find(x => x.id === pf.presetId);
  if (!p) return null;
  const { layout, clamped } = effectiveLayout(p, layoutId);
  return { presetId: p.id, layout: layout.id, clamped, rate: p.codec === 'dsd' ? 0 : effectiveRate(p, rate) };
}));

let currentRip = null;
ipcMain.handle('rip:start', async (e, job) => {
  if (currentRip) throw new Error('A rip is already running');
  if (!ffInfo || !ffInfo.path) throw new Error('FFmpeg was not found. Set its location in Settings.');
  const drive = getDrive(job.driveId);
  const cover = job.cover ? { mime: job.cover.mime, data: Buffer.from(job.cover.data, 'base64') } : null;
  const r = new Ripper(Object.assign({}, job, { drive, cover, ffmpeg: ffInfo.path, hasSoxr: ffInfo.soxr, threads: settings.threads || 0 }));
  currentRip = r;
  r.on('progress', p => send('rip:progress', p));
  let lastTrackEmit = 0;
  r.on('track', t => { if (t.throttle) { const n = Date.now(); if (n - lastTrackEmit < 100) return; lastTrackEmit = n; } send('rip:track', t); });
  r.on('log', l => send('rip:log', l));
  if (drive.setMaxSpeed) await drive.setMaxSpeed().catch(() => {});
  try {
    const res = await r.run();
    if (!res.cancelled && settings.ejectWhenDone) { try { await drive.eject(); } catch (err) {} }
    return res;
  } finally {
    currentRip = null;
    if (drive.close) drive.close();
  }
});
ipcMain.handle('rip:cancel', () => { if (currentRip) currentRip.cancel(); return true; });
