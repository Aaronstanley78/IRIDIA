'use strict';
/*
 * IRIDIA rip engine: reads CDDA once and feeds every selected output profile in parallel.
 */
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PRESETS, resolve } = require('./catalog');
const { buildArgs, effectiveLayout } = require('./ffargs');
const { DsdEncoder } = require('./dsdencode');

const SECTOR = 2352;
const SPF = 588; // samples per frame/sector
const CHUNK = 26;

/* CRC32 (same polynomial as EAC "Copy CRC") */
const CRC_T = new Int32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; }
function crc32(buf, crc = 0) { crc = ~crc; for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return ~crc >>> 0; }

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

class Ripper extends EventEmitter {
  /**
   * cfg: { drive, toc, trackNumbers, album:{title,artist,year,genre,disc}, trackMeta:{n:{title,artist}}, cover:{data,mime},
   *        profiles:[{presetId, selections}], layoutId, upmix, rate, outDir, template, ffmpeg,
   *        secure, offset, retries, deemphasis, image, writeCue, writeLog, writeM3u, saveCover, hasSoxr, normalize }
   */
  constructor(cfg) { super(); this.cfg = cfg; this.cancelled = false; this.procs = new Set(); this.partials = new Set(); this.logLines = []; }

  log(s) { this.logLines.push(s); this.emit('log', s); }
  cancel() {
    this.cancelled = true;
    for (const p of this.procs) { try { p.kill('SIGKILL'); } catch (e) {} }
  }

  async _readChunk(lba, count) {
    const { drive, retries = 10 } = this.cfg;
    let lastErr;
    for (let a = 0; a <= retries; a++) {
      try { return await drive.readSectors(lba, count); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 30 * (a + 1))); }
    }
    if (count > 1) { // fall back to sector-by-sector so a single bad sector doesn't kill the whole chunk
      const parts = [];
      for (let i = 0; i < count; i++) parts.push(await this._readChunk(lba + i, 1));
      return Buffer.concat(parts);
    }
    this.errors++;
    this.log(`  ! Unrecoverable read error at sector ${lba} (${lastErr && lastErr.message}) — filled with silence`);
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
    if (!a.equals(b)) { this.errors++; this.log(`  ! Inconsistent reads at sectors ${lba}–${lba + count - 1}`); }
    return b;
  }

  /** async generator of PCM buffers for absolute sample range [s0, s1) with offset correction */
  async *_pcm(s0, s1, maxSector) {
    const off = this.cfg.offset || 0;
    let b0 = (s0 + off) * 4, b1 = (s1 + off) * 4;
    let pos = b0;
    while (pos < b1) {
      if (this.cancelled) return;
      const sec = Math.floor(pos / SECTOR);
      const count = Math.min(CHUNK, Math.ceil(b1 / SECTOR) - sec);
      let data;
      if (sec < 0 || sec + count > maxSector) {
        // outside readable area (lead-in / lead-out): read what exists, zero-fill the rest
        data = Buffer.alloc(count * SECTOR);
        const rs = Math.max(sec, 0), re = Math.min(sec + count, maxSector);
        if (re > rs) (await this._readSecure(rs, re - rs)).copy(data, (rs - sec) * SECTOR);
      } else data = await this._readSecure(sec, count);
      const from = pos - sec * SECTOR;
      const to = Math.min(data.length, b1 - sec * SECTOR);
      const slice = data.subarray(from, to);
      pos += slice.length;
      yield slice;
    }
  }

  _spawnEncoder(profile, target, meta, cover) {
    const preset = PRESETS.find(p => p.id === profile.presetId);
    const r = resolve(preset, profile.selections || {});
    const pre = [];
    if (target.preemphasis && this.cfg.deemphasis) pre.push('aemphasis=type=cd:mode=reproduction');
    let coverPath = null;
    if (cover && r.cover && this.cfg.embedCover !== false) {
      coverPath = path.join(path.dirname(target.file), `.iridia-cover-${process.pid}.${cover.mime === 'image/png' ? 'png' : 'jpg'}`);
      if (!fs.existsSync(coverPath)) fs.writeFileSync(coverPath, cover.data);
      this.partials.add(coverPath); this.tempCovers.add(coverPath);
    }
    const { args, layout, rate, dsd } = buildArgs({ preset: r, layoutId: this.cfg.layoutId, upmix: this.cfg.upmix, rate: this.cfg.rate,
      meta, coverPath, output: target.file, preFilters: pre, hasSoxr: this.cfg.hasSoxr });
    const proc = spawn(this.cfg.ffmpeg, args, { windowsHide: true, stdio: ['pipe', dsd ? 'pipe' : 'ignore', 'pipe'] });
    this.procs.add(proc);
    this.partials.add(target.file);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    proc.stdin.on('error', () => {});
    const enc = { proc, preset: r, layout, rate, file: target.file, name: r.name };
    let dsdDone = Promise.resolve();
    if (dsd) {
      const de = new DsdEncoder({ file: target.file, fmt: r.fmt, channels: layout.ch, layoutId: layout.id, mul: r.dsdMul || 64, order: r.dsdOrder || 7 });
      enc.dsdEnc = de;
      dsdDone = (async () => {
        for await (const chunk of proc.stdout) { if (this.cancelled) break; await de.write(chunk); }
        if (this.cancelled) { await de.abort(); return; }
        const res = await de.end(meta, cover);
        if (res.resets) this.log(`  · DSD modulator recovered ${res.resets} overload(s) on ${path.basename(target.file)}`);
      })();
    }
    enc.done = new Promise((resolveP, reject) => {
      proc.on('error', reject);
      proc.on('close', async (code) => {
        this.procs.delete(proc);
        try { await dsdDone; } catch (e) { return reject(e); }
        if (code === 0) resolveP(); else reject(new Error(`${r.name}: FFmpeg exited with code ${code}\n${stderr.trim().split('\n').slice(-4).join('\n')}`));
      });
    });
    return enc;
  }

  async _feed(encs, buf) {
    await Promise.all(encs.map(e => new Promise(res => {
      if (e.proc.stdin.destroyed) return res();
      if (e.proc.stdin.write(buf)) res(); else e.proc.stdin.once('drain', res);
    })));
  }

  _targets(unit, meta) {
    const { cfg } = this;
    return cfg.profiles.map(pf => {
      const preset = resolve(PRESETS.find(p => p.id === pf.presetId), pf.selections || {});
      const vars = {
        artist: meta.artist, albumartist: cfg.album.artist || meta.artist, album: cfg.album.title || 'Unknown Album',
        title: meta.title, track: String(meta.track || 0).padStart(2, '0'), year: cfg.album.year || '', genre: cfg.album.genre || '',
        disc: cfg.album.disc || '1', format: preset.name.replace(/\s*\(.*?\)/g, '').trim(), ext: preset.ext
      };
      const tpl = unit.image ? (cfg.imageTemplate || '{albumartist} - {album} [{format}]/{albumartist} - {album}') : (cfg.template || '{albumartist} - {album} [{format}]/{track} - {title}');
      const rel = applyTemplate(tpl, vars) + '.' + preset.ext;
      const file = path.join(cfg.outDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return { file, preset, preemphasis: unit.preemphasis, profile: pf };
    });
  }

  async run() {
    const { cfg } = this;
    const t0 = Date.now();
    this.errors = 0; this.suspicious = 0; this.tempCovers = new Set();
    const toc = cfg.toc;
    const audio = toc.tracks.filter(t => t.audio);
    const lastAudio = audio[audio.length - 1];
    const maxSector = lastAudio.lba + lastAudio.sectors;
    const sel = audio.filter(t => cfg.trackNumbers.includes(t.number));
    const total = audio.length;
    const units = cfg.image
      ? [{ image: true, tracks: sel, s0: sel[0].lba * SPF, s1: (sel[sel.length - 1].lba + sel[sel.length - 1].sectors) * SPF, preemphasis: sel.some(t => t.preemphasis) }]
      : sel.map(t => ({ image: false, tracks: [t], s0: t.lba * SPF, s1: (t.lba + t.sectors) * SPF, preemphasis: t.preemphasis }));
    const totalSamples = units.reduce((a, u) => a + (u.s1 - u.s0), 0);
    let doneSamples = 0;
    const results = [];
    const drvName = cfg.driveName || cfg.drive.id;

    this.log(`IRIDIA 1.0.0 — extraction log — ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
    this.log('');
    this.log(`${cfg.album.artist || 'Unknown Artist'} / ${cfg.album.title || 'Unknown Album'}`);
    this.log('');
    this.log(`Used drive        : ${drvName}`);
    this.log(`Read mode         : ${cfg.secure ? 'Secure (dual read + compare)' : 'Burst'}`);
    this.log(`Read offset       : ${cfg.offset || 0} samples`);
    this.log(`De-emphasis       : ${cfg.deemphasis ? 'Auto (on flagged tracks)' : 'Off'}`);
    this.log(`Channel layout    : ${cfg.layoutId} (${cfg.upmix} upmix)`);
    this.log(`Output formats    : ${cfg.profiles.map(p => resolve(PRESETS.find(x => x.id === p.presetId), p.selections || {}).name).join(', ')}`);
    this.log('');
    this.log('TOC of the extracted CD');
    this.log('     Track |   Start  |  Length  | Start sector | End sector');
    for (const t of toc.tracks) this.log(`      ${String(t.number).padStart(3)}  | ${msf(t.lba)} | ${msf(t.sectors)} |   ${String(t.lba).padStart(8)}   | ${String(t.lba + t.sectors - 1).padStart(8)}${t.audio ? '' : '  (data)'}`);
    this.log('');

    for (let ui = 0; ui < units.length; ui++) {
      if (this.cancelled) break;
      const u = units[ui];
      const t = u.tracks[0];
      const tm = (cfg.trackMeta || {})[t.number] || {};
      const meta = u.image
        ? { title: cfg.album.title, artist: cfg.album.artist, album: cfg.album.title, albumArtist: cfg.album.artist, year: cfg.album.year, genre: cfg.album.genre, disc: cfg.album.disc }
        : { title: tm.title || `Track ${t.number}`, artist: tm.artist || cfg.album.artist, album: cfg.album.title, albumArtist: cfg.album.artist,
            year: cfg.album.year, genre: cfg.album.genre, track: t.number, totalTracks: total, disc: cfg.album.disc, composer: tm.composer };
      const targets = this._targets(u, meta);
      this.emit('unit', { index: ui, count: units.length, track: u.image ? 0 : t.number, title: meta.title, files: targets.map(x => x.file) });
      this.log(u.image ? 'Disc image' : `Track ${String(t.number).padStart(2, '0')}  ${meta.title}`);
      const encs = targets.map(tg => this._spawnEncoder(tg.profile, tg, meta, cfg.cover));
      encs.forEach(e => e.done.catch(() => {}));
      let crc = 0, peak = 0, unitDone = 0, winPeak = 0;
      const unitSamples = u.s1 - u.s0;
      const tStart = Date.now();
      let lastEmit = 0;
      try {
        for await (const buf of this._pcm(u.s0, u.s1, maxSector)) {
          crc = crc32(buf, crc);
          let bp = 0; for (let i = 0; i + 1 < buf.length; i += 2) { const v = Math.abs(buf.readInt16LE(i)); if (v > bp) bp = v; }
          if (bp > peak) peak = bp; if (bp > winPeak) winPeak = bp;
          await this._feed(encs, buf);
          unitDone += buf.length / 4; doneSamples += buf.length / 4;
          const now = Date.now();
          if (now - lastEmit > 120) {
            lastEmit = now;
            const el = (now - t0) / 1000;
            const speed = (doneSamples / 44100) / Math.max(el, 0.001);
            this.emit('progress', { unit: ui, units: units.length, track: u.image ? 0 : t.number, unitPct: unitDone / unitSamples, totalPct: doneSamples / totalSamples,
              speed, eta: (totalSamples - doneSamples) / 44100 / Math.max(speed, 0.01), peak: winPeak / 32768 });
            winPeak = 0;
          }
        }
        for (const e of encs) e.proc.stdin.end();
        this.emit('progress', { unit: ui, units: units.length, track: u.image ? 0 : t.number, unitPct: 1, totalPct: doneSamples / totalSamples, speed: 0, eta: 0, encoding: true });
        await Promise.all(encs.map(e => e.done));
      } catch (err) {
        for (const e of encs) { try { e.proc.kill('SIGKILL'); } catch (x) {} }
        if (this.cancelled) break;
        this.log(`  ✗ ${err.message}`);
        results.push({ track: t.number, ok: false, error: err.message });
        this.emit('unitDone', { index: ui, ok: false, error: err.message });
        continue;
      }
      if (this.cancelled) break;
      for (const tg of targets) this.partials.delete(tg.file);
      const secs = (Date.now() - tStart) / 1000;
      this.log(`     Peak level ${(peak / 327.68).toFixed(1)} %   Copy CRC ${crc.toString(16).toUpperCase().padStart(8, '0')}   ${(unitSamples / 44100 / Math.max(secs, 0.01)).toFixed(1)}×`);
      for (const tg of targets) this.log(`     → ${tg.file}`);
      results.push({ track: u.image ? 0 : t.number, ok: true, crc, peak: peak / 32768, files: targets.map(x => x.file) });
      this.emit('unitDone', { index: ui, ok: true, crc, files: targets.map(x => x.file) });
      if (u.image && cfg.writeCue !== false) this._writeCue(targets, u);
    }

    for (const c of this.tempCovers) { try { fs.unlinkSync(c); } catch (e) {} this.partials.delete(c); }
    if (this.cancelled) {
      for (const f of this.partials) { try { fs.unlinkSync(f); } catch (e) {} }
      this.log(''); this.log('Extraction cancelled by user.');
      return { cancelled: true, results };
    }
    const okCount = results.filter(r => r.ok).length;
    this.log('');
    this.log(this.errors ? `${this.errors} read error(s) occurred — check the tracks marked above.` : 'No errors occurred.');
    if (cfg.secure) this.log(`${this.suspicious} re-read(s) were needed to obtain consistent data.`);
    this.log(`${okCount}/${results.length} item(s) extracted in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
    this.log('');
    this.log('==== End of log ====');

    // side files per output folder
    const dirs = new Map();
    for (const r of results) if (r.ok) for (const f of r.files) { const d = path.dirname(f); if (!dirs.has(d)) dirs.set(d, []); dirs.get(d).push(f); }
    for (const [d, files] of dirs) {
      try {
        if (cfg.writeLog !== false) fs.writeFileSync(path.join(d, `${sanitize(cfg.album.title || 'rip')}.log`), '﻿' + this.logLines.join('\r\n'), 'utf8');
        if (cfg.writeM3u !== false && !cfg.image) fs.writeFileSync(path.join(d, `${sanitize(cfg.album.title || 'playlist')}.m3u8`), '#EXTM3U\r\n' + files.map(f => path.basename(f)).join('\r\n') + '\r\n', 'utf8');
        if (cfg.saveCover !== false && cfg.cover) fs.writeFileSync(path.join(d, cfg.cover.mime === 'image/png' ? 'cover.png' : 'cover.jpg'), cfg.cover.data);
      } catch (e) { this.log(`Could not write side files in ${d}: ${e.message}`); }
    }
    return { cancelled: false, results, errors: this.errors, dirs: [...dirs.keys()] };
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
      const type = /^(wav|w64|rf64)$/.test(tg.preset.fmt) ? 'WAVE' : tg.preset.fmt === 'mp3' ? 'MP3' : tg.preset.fmt === 'aiff' ? 'AIFF' : 'WAVE';
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

module.exports = { Ripper, crc32, applyTemplate, sanitize };
