'use strict';
/*
 * IRIDIA rip engine — parallel pipeline
 *
 *   drive ──read──▶ track PCM (temp file) ──▶ job scheduler ──▶ N encoders at once
 *
 * The drive is read continuously (reading is never blocked by encoding). Each finished
 * track becomes one encode job per output format; the scheduler runs as many jobs in
 * parallel as there are CPU cores (a DSD job reserves one core per channel). Tracks are
 * therefore read and encoded at the same time and several tracks encode concurrently.
 */
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { PRESETS, resolve } = require('./catalog');
const { buildArgs, effectiveLayout } = require('./ffargs');
const { DsdEncoder } = require('./dsdencode');

const SECTOR = 2352;
const SPF = 588;              // samples (frames) per sector
const CHUNK = 26;             // sectors per read (≤ 64 KB)
const MAX_AHEAD = 6;          // tracks read but not yet encoded

/* CRC32 (same polynomial as EAC "Copy CRC"); native zlib.crc32 when available */
const CRC_T = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; }
function crc32js(buf, crc = 0) { crc = ~crc; for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return ~crc >>> 0; }
const crc32 = typeof zlib.crc32 === 'function' ? (b, c = 0) => zlib.crc32(b, c) >>> 0 : crc32js;

function peakOf(buf) {
  let p = 0;
  if ((buf.byteOffset & 1) === 0) {
    const v = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
    for (let i = 0; i < v.length; i++) { const a = v[i] < 0 ? -v[i] : v[i]; if (a > p) p = a; }
  } else for (let i = 0; i + 1 < buf.length; i += 2) { const a = Math.abs(buf.readInt16LE(i)); if (a > p) p = a; }
  return p;
}

function sanitize(s) {
  return String(s == null ? '' : s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').replace(/^\s+/, '').slice(0, 120) || '_';
}
function applyTemplate(tpl, vars) {
  return tpl.split('/').map(seg => sanitize(seg.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? vars[k] : ''))).join(path.sep);
}
function msf(sectors) {
  const m = Math.floor(sectors / 4500), s = Math.floor((sectors % 4500) / 75), f = sectors % 75;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ scheduler */
class Scheduler {
  constructor(budget) { this.budget = budget; this.used = 0; this.queue = []; }
  add(cost, fn) {
    return new Promise((resolveP, reject) => { this.queue.push({ cost: Math.min(cost, this.budget), fn, resolveP, reject }); this._pump(); });
  }
  _pump() {
    for (let i = 0; i < this.queue.length;) {
      const j = this.queue[i];
      if (this.used + j.cost <= this.budget || this.used === 0) {
        this.queue.splice(i, 1);
        this.used += j.cost;
        Promise.resolve().then(j.fn).then(j.resolveP, j.reject).finally(() => { this.used -= j.cost; this._pump(); });
      } else i++;
    }
  }
}

class Ripper extends EventEmitter {
  /**
   * cfg: { drive, toc, trackNumbers, album:{title,artist,year,genre,disc}, trackMeta:{n:{title,artist}}, cover:{data,mime},
   *        profiles:[{presetId, selections}], layoutId, upmix, rate, outDir, template, imageTemplate, ffmpeg,
   *        secure, offset, retries, deemphasis, image, writeCue, writeLog, writeM3u, saveCover, embedCover, hasSoxr, threads }
   */
  constructor(cfg) {
    super();
    this.cfg = cfg; this.cancelled = false;
    this.procs = new Set(); this.dsdEncs = new Set(); this.partials = new Set();
    this.logLines = [];
  }

  log(s) { this.logLines.push(s); this.emit('log', s); }
  warn(s) { if (this.curUnit) this.curUnit.log.push(s); else this.log(s); }
  cancel() {
    this.cancelled = true;
    for (const p of this.procs) { try { p.kill('SIGKILL'); } catch (e) {} }
    for (const e of this.dsdEncs) e.abort().catch(() => {});
    if (this._wakeReader) this._wakeReader();
  }

  /* ---------------------------------------------------------- reading */
  async _readChunk(lba, count) {
    const { drive, retries = 10 } = this.cfg;
    let lastErr;
    for (let a = 0; a <= retries; a++) {
      if (this.cancelled) return Buffer.alloc(count * SECTOR);
      try { return await drive.readSectors(lba, count); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 30 * (a + 1))); }
    }
    if (count > 1) {
      const parts = [];
      for (let i = 0; i < count; i++) parts.push(await this._readChunk(lba + i, 1));
      return Buffer.concat(parts);
    }
    this.errors++;
    this.warn(`  ! Unrecoverable read error at sector ${lba} (${lastErr && lastErr.message}) — filled with silence`);
    return Buffer.alloc(SECTOR);
  }

  async _readSecure(lba, count) {
    const a = await this._readChunk(lba, count);
    if (!this.cfg.secure) return a;
    let b = await this._readChunk(lba, count);
    let tries = 0;
    while (!a.equals(b) && tries < 8) {
      this.suspicious++;
      const c = await this._readChunk(lba, count);
      if (c.equals(b) || c.equals(a)) return c;
      b = c; tries++;
    }
    if (!a.equals(b)) { this.errors++; this.warn(`  ! Inconsistent reads at sectors ${lba}–${lba + count - 1}`); }
    return b;
  }

  async *_pcm(s0, s1, maxSector) {
    const off = this.cfg.offset || 0;
    const b1 = (s1 + off) * 4;
    let pos = (s0 + off) * 4;
    while (pos < b1) {
      if (this.cancelled) return;
      const sec = Math.floor(pos / SECTOR);
      const count = Math.min(CHUNK, Math.ceil(b1 / SECTOR) - sec);
      let data;
      if (sec < 0 || sec + count > maxSector) {
        data = Buffer.alloc(count * SECTOR);
        const rs = Math.max(sec, 0), re = Math.min(sec + count, maxSector);
        if (re > rs) (await this._readSecure(rs, re - rs)).copy(data, (rs - sec) * SECTOR);
      } else data = await this._readSecure(sec, count);
      const slice = data.subarray(pos - sec * SECTOR, Math.min(data.length, b1 - sec * SECTOR));
      pos += slice.length;
      yield slice;
    }
  }

  /* ---------------------------------------------------------- encoding */
  _targets(unit, meta) {
    const { cfg } = this;
    return cfg.profiles.map(pf => {
      const preset = resolve(PRESETS.find(p => p.id === pf.presetId), pf.selections || {});
      const vars = {
        artist: meta.artist, albumartist: cfg.album.artist || meta.artist, album: cfg.album.title || 'Unknown Album',
        title: meta.title, track: String(meta.track || 0).padStart(2, '0'), year: cfg.album.year || '', genre: cfg.album.genre || '',
        disc: cfg.album.disc || '1', format: preset.name.replace(/\s*\((.*?)\)/g, (m, inner) => inner.length > 10 ? '' : ' ' + inner).trim(), ext: preset.ext
      };
      const tpl = unit.image ? (cfg.imageTemplate || '{albumartist} - {album} [{format}]/{albumartist} - {album}') : (cfg.template || '{albumartist} - {album} [{format}]/{track} - {title}');
      const file = path.join(cfg.outDir, applyTemplate(tpl, vars) + '.' + preset.ext);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return { file, preset, profile: pf };
    });
  }

  _encode(unit, target, onProgress) {
    const { cfg } = this;
    const r = target.preset;
    const pre = [];
    if (unit.preemphasis && cfg.deemphasis) pre.push('aemphasis=type=cd:mode=reproduction');
    const coverPath = this.coverPath && r.cover && cfg.embedCover !== false ? this.coverPath : null;
    const { args, layout, dsd } = buildArgs({
      preset: r, layoutId: cfg.layoutId, upmix: cfg.upmix, rate: cfg.rate, meta: unit.meta, coverPath, output: target.file,
      preFilters: pre, hasSoxr: cfg.hasSoxr, progress: r.codec !== 'dsd',
      inputArgs: ['-f', 's16le', '-ar', '44100', '-ch_layout', 'stereo', '-i', unit.pcmPath]
    });
    this.partials.add(target.file);
    const seconds = unit.frames / 44100;
    return new Promise((resolveP, reject) => {
      const proc = spawn(cfg.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.procs.add(proc);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
      let dsdDone = Promise.resolve();
      if (dsd) {
        const enc = new DsdEncoder({ file: target.file, fmt: r.fmt, channels: layout.ch, layoutId: layout.id, mul: r.dsdMul || 64, order: r.dsdOrder || 7 });
        this.dsdEncs.add(enc);
        const expected = seconds * 352800 * 4 * layout.ch;
        let got = 0;
        dsdDone = (async () => {
          for await (const chunk of proc.stdout) {
            if (this.cancelled) break;
            await enc.write(chunk);
            got += chunk.length; onProgress(Math.min(1, got / expected));
          }
          this.dsdEncs.delete(enc);
          if (this.cancelled) { await enc.abort(); return; }
          const res = await enc.end(unit.meta, cfg.cover);
          if (res.resets) unit.log.push(`     · DSD modulator recovered ${res.resets} overload(s) in ${path.basename(target.file)}`);
        })();
      } else {
        let buf = '';
        proc.stdout.on('data', d => {
          buf += d.toString();
          const m = buf.match(/out_time_us=(\d+)(?![\s\S]*out_time_us=)/);
          if (m) onProgress(Math.min(1, +m[1] / 1e6 / seconds));
          if (buf.length > 4096) buf = buf.slice(-512);
        });
      }
      proc.on('error', reject);
      proc.on('close', async (code) => {
        this.procs.delete(proc);
        try { await dsdDone; } catch (e) { return reject(e); }
        if (this.cancelled) return reject(new Error('cancelled'));
        if (code === 0) { this.partials.delete(target.file); onProgress(1); resolveP(); }
        else reject(new Error(`${r.name}: FFmpeg exited with code ${code}\n${stderr.trim().split('\n').slice(-4).join('\n')}`));
      });
    });
  }

  /* ---------------------------------------------------------- main */
  async run() {
    const { cfg } = this;
    const t0 = Date.now();
    this.errors = 0; this.suspicious = 0;
    const cores = Math.max(1, cfg.threads || os.cpus().length);
    const sched = new Scheduler(cores);
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iridia-'));
    if (cfg.cover) { this.coverPath = path.join(this.tmpDir, cfg.cover.mime === 'image/png' ? 'cover.png' : 'cover.jpg'); fs.writeFileSync(this.coverPath, cfg.cover.data); }

    const toc = cfg.toc;
    const audio = toc.tracks.filter(t => t.audio);
    const lastAudio = audio[audio.length - 1];
    const maxSector = lastAudio.lba + lastAudio.sectors;
    const sel = audio.filter(t => cfg.trackNumbers.includes(t.number));
    const total = audio.length;
    const units = cfg.image
      ? [{ image: true, tracks: sel, s0: sel[0].lba * SPF, s1: (sel[sel.length - 1].lba + sel[sel.length - 1].sectors) * SPF, preemphasis: sel.some(t => t.preemphasis) }]
      : sel.map(t => ({ image: false, tracks: [t], s0: t.lba * SPF, s1: (t.lba + t.sectors) * SPF, preemphasis: t.preemphasis }));
    const nJobs = cfg.profiles.length;
    const totalFrames = units.reduce((a, u) => a + (u.s1 - u.s0), 0);
    // progress model: reading counts 1 share, every encode job 1 share
    let readFrames = 0; const jobFrac = new Map();
    const totalWork = totalFrames * (1 + nJobs);
    let lastEmit = 0, readStart = Date.now(), peakWin = 0;
    const progress = (force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 150) return;
      lastEmit = now;
      let enc = 0; for (const [u, fr] of jobFrac) enc += fr * (u.s1 - u.s0);
      const done = (readFrames + enc) / totalWork;
      const el = (now - t0) / 1000;
      const readSpeed = readFrames / 44100 / Math.max(0.001, (now - readStart) / 1000);
      this.emit('progress', { totalPct: done, readPct: readFrames / totalFrames, speed: readSpeed, eta: done > 0.01 ? el * (1 - done) / done : 0,
        peak: peakWin / 32768, activeJobs: this.procs.size, cores });
      peakWin = 0;
    };

    const name = (p) => resolve(PRESETS.find(x => x.id === p.presetId), p.selections || {}).name;
    this.log(`IRIDIA 1.0.0 — extraction log — ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
    this.log('');
    this.log(`${cfg.album.artist || 'Unknown Artist'} / ${cfg.album.title || 'Unknown Album'}`);
    this.log('');
    this.log(`Used drive        : ${cfg.driveName || cfg.drive.id}`);
    this.log(`Read mode         : ${cfg.secure ? 'Secure (dual read + compare)' : 'Burst'}`);
    this.log(`Read offset       : ${cfg.offset || 0} samples`);
    this.log(`De-emphasis       : ${cfg.deemphasis ? 'Auto (on flagged tracks)' : 'Off'}`);
    this.log(`Channel layout    : ${cfg.layoutId} (${cfg.upmix} upmix)`);
    this.log(`Output formats    : ${cfg.profiles.map(name).join(', ')}`);
    this.log(`Parallel encoding : ${cores} CPU threads`);
    this.log('');
    this.log('TOC of the extracted CD');
    this.log('     Track |   Start  |  Length  | Start sector | End sector');
    for (const t of toc.tracks) this.log(`      ${String(t.number).padStart(3)}  | ${msf(t.lba)} | ${msf(t.sectors)} |   ${String(t.lba).padStart(8)}   | ${String(t.lba + t.sectors - 1).padStart(8)}${t.audio ? '' : '  (data)'}`);
    this.log('');
    const hdrEnd = this.logLines.length;

    const results = [];
    const unitTasks = [];
    let ahead = 0;

    for (let ui = 0; ui < units.length && !this.cancelled; ui++) {
      const u = units[ui];
      const t = u.tracks[0];
      const tm = (cfg.trackMeta || {})[t.number] || {};
      u.track = u.image ? 0 : t.number;
      u.meta = u.image
        ? { title: cfg.album.title, artist: cfg.album.artist, album: cfg.album.title, albumArtist: cfg.album.artist, year: cfg.album.year, genre: cfg.album.genre, disc: cfg.album.disc }
        : { title: tm.title || `Track ${t.number}`, artist: tm.artist || cfg.album.artist, album: cfg.album.title, albumArtist: cfg.album.artist,
            year: cfg.album.year, genre: cfg.album.genre, track: t.number, totalTracks: total, disc: cfg.album.disc, composer: tm.composer };
      u.log = [u.image ? 'Disc image' : `Track ${String(t.number).padStart(2, '0')}  ${u.meta.title}`];
      u.frames = u.s1 - u.s0;

      // bounded read-ahead so temp space stays small
      while (ahead >= MAX_AHEAD && !this.cancelled) await new Promise(r => { this._wakeReader = r; });
      if (this.cancelled) break;

      // ---- read the track into a temp PCM file
      this.curUnit = u;
      this.emit('track', { track: u.track, state: 'reading', pct: 0 });
      u.pcmPath = path.join(this.tmpDir, `unit${ui}.pcm`);
      const fd = fs.openSync(u.pcmPath, 'w');
      let crc = 0, peak = 0, got = 0;
      const tr0 = Date.now();
      try {
        for await (const buf of this._pcm(u.s0, u.s1, maxSector)) {
          fs.writeSync(fd, buf);
          crc = crc32(buf, crc);
          const p = peakOf(buf); if (p > peak) peak = p; if (p > peakWin) peakWin = p;
          got += buf.length / 4; readFrames += buf.length / 4;
          this.emit('track', { track: u.track, state: 'reading', pct: got / u.frames, throttle: true });
          progress();
        }
      } finally { fs.closeSync(fd); }
      this.curUnit = null;
      if (this.cancelled) break;
      u.crc = crc; u.peak = peak;
      u.log.push(`     Peak level ${(peak / 327.68).toFixed(1)} %   Copy CRC ${crc.toString(16).toUpperCase().padStart(8, '0')}   read ${(u.frames / 44100 / Math.max(0.01, (Date.now() - tr0) / 1000)).toFixed(1)}×`);

      // ---- schedule one encode job per format
      ahead++;
      const targets = this._targets(u, u.meta);
      const fr = new Array(targets.length).fill(0);
      const upd = () => { jobFrac.set(u, fr.reduce((a, b) => a + b, 0)); this.emit('track', { track: u.track, state: 'encoding', pct: fr.reduce((a, b) => a + b, 0) / fr.length, throttle: true }); progress(); };
      this.emit('track', { track: u.track, state: 'encoding', pct: 0 });
      const jobs = targets.map((tg, i) => {
        const isDsd = tg.preset.codec === 'dsd';
        const ch = isDsd ? effectiveLayout(tg.preset, cfg.layoutId).layout.ch : 1;
        return sched.add(isDsd ? ch + 1 : 1, () => this.cancelled ? Promise.reject(new Error('cancelled')) : this._encode(u, tg, (p) => { fr[i] = p; upd(); }));
      });
      unitTasks.push(Promise.allSettled(jobs).then((st) => {
        ahead--; if (this._wakeReader) { const w = this._wakeReader; this._wakeReader = null; w(); }
        try { fs.unlinkSync(u.pcmPath); } catch (e) {}
        if (this.cancelled) return;
        const errs = st.filter(s => s.status === 'rejected').map(s => s.reason.message);
        targets.forEach((tg, i) => u.log.push(st[i].status === 'fulfilled' ? `     → ${tg.file}` : `     ✗ ${st[i].reason.message}`));
        u.log.forEach(l => this.emit('log', l));
        const ok = errs.length === 0;
        results.push({ index: ui, track: u.track, ok, crc: u.crc, peak: u.peak / 32768, files: targets.filter((_, i) => st[i].status === 'fulfilled').map(x => x.file), error: errs.join('\n') });
        this.emit('track', { track: u.track, state: ok ? 'done' : 'error', pct: 1, crc: u.crc, error: errs.join('\n') });
        if (u.image && cfg.writeCue !== false) this._writeCue(targets.filter((_, i) => st[i].status === 'fulfilled'), u);
        progress(true);
      }));
    }
    await Promise.all(unitTasks);

    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch (e) {}
    if (this.cancelled) {
      for (const f of this.partials) { try { fs.unlinkSync(f); } catch (e) {} }
      this.log(''); this.log('Extraction cancelled by user.');
      return { cancelled: true, results };
    }
    results.sort((a, b) => a.index - b.index);
    const okCount = results.filter(r => r.ok).length;
    const sumStart = this.logLines.length;
    this.log('');
    this.log(this.errors ? `${this.errors} read error(s) occurred — check the tracks marked above.` : 'No errors occurred.');
    if (cfg.secure) this.log(`${this.suspicious} re-read(s) were needed to obtain consistent data.`);
    this.log(`${okCount}/${results.length} item(s) extracted in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
    this.log('');
    this.log('==== End of log ====');

    // the file log: header, then track blocks in disc order, then summary
    const fileLog = [...this.logLines.slice(0, hdrEnd), ...units.flatMap(u => u.log || []), ...this.logLines.slice(sumStart)];

    const dirs = new Map();
    for (const r of results) for (const f of r.files) { const d = path.dirname(f); if (!dirs.has(d)) dirs.set(d, []); dirs.get(d).push(f); }
    for (const [d, files] of dirs) {
      try {
        if (cfg.writeLog !== false) fs.writeFileSync(path.join(d, `${sanitize(cfg.album.title || 'rip')}.log`), '﻿' + fileLog.join('\r\n'), 'utf8');
        if (cfg.writeM3u !== false && !cfg.image) fs.writeFileSync(path.join(d, `${sanitize(cfg.album.title || 'playlist')}.m3u8`), '#EXTM3U\r\n' + files.sort().map(f => path.basename(f)).join('\r\n') + '\r\n', 'utf8');
        if (cfg.saveCover !== false && cfg.cover) fs.writeFileSync(path.join(d, cfg.cover.mime === 'image/png' ? 'cover.png' : 'cover.jpg'), cfg.cover.data);
      } catch (e) { this.log(`Could not write side files in ${d}: ${e.message}`); }
    }
    return { cancelled: false, results, errors: this.errors, dirs: [...dirs.keys()], seconds: (Date.now() - t0) / 1000 };
  }

  _writeCue(targets, u) {
    const { cfg } = this;
    for (const tg of targets) {
      const lines = [];
      if (cfg.album.genre) lines.push(`REM GENRE "${cfg.album.genre}"`);
      if (cfg.album.year) lines.push(`REM DATE ${cfg.album.year}`);
      lines.push('REM COMMENT "IRIDIA 1.0.0"');
      lines.push(`PERFORMER "${(cfg.album.artist || '').replace(/"/g, "'")}"`);
      lines.push(`TITLE "${(cfg.album.title || '').replace(/"/g, "'")}"`);
      const type = tg.preset.fmt === 'mp3' ? 'MP3' : tg.preset.fmt === 'aiff' ? 'AIFF' : 'WAVE';
      lines.push(`FILE "${path.basename(tg.file)}" ${type}`);
      const base = u.tracks[0].lba;
      for (const t of u.tracks) {
        const tm = (cfg.trackMeta || {})[t.number] || {};
        lines.push(`  TRACK ${String(t.number).padStart(2, '0')} AUDIO`);
        lines.push(`    TITLE "${(tm.title || `Track ${t.number}`).replace(/"/g, "'")}"`);
        lines.push(`    PERFORMER "${(tm.artist || cfg.album.artist || '').replace(/"/g, "'")}"`);
        if (t.preemphasis && !cfg.deemphasis) lines.push('    FLAGS PRE');
        lines.push(`    INDEX 01 ${msf(t.lba - base)}`);
      }
      fs.writeFileSync(tg.file.replace(/\.[^.]+$/, '.cue'), '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
    }
  }
}

module.exports = { Ripper, Scheduler, crc32, applyTemplate, sanitize };
