'use strict';
/*
 * Native Windows audio-CD access (no external tools): TOC, CD-Text, raw CDDA sector
 * reads, drive identification and tray control through DeviceIoControl via koffi.
 */
const koffi = require('koffi');

const GENERIC_READ = 0x80000000;
const FILE_SHARE_RW = 0x3;
const OPEN_EXISTING = 3;
const IOCTL_CDROM_READ_TOC = 0x00024000;
const IOCTL_CDROM_READ_TOC_EX = 0x00024054;
const IOCTL_CDROM_RAW_READ = 0x0002403E;
const IOCTL_STORAGE_EJECT_MEDIA = 0x002D4808;
const IOCTL_STORAGE_LOAD_MEDIA = 0x002D480C;
const IOCTL_STORAGE_CHECK_VERIFY = 0x002D4800;
const IOCTL_STORAGE_QUERY_PROPERTY = 0x002D1400;
const IOCTL_CDROM_SET_SPEED = 0x00024060;
const CDDA = 2;
const SECTOR = 2352;
const MAX_SECTORS = 26;

let k32 = null;
function api() {
  if (k32) return k32;
  const lib = koffi.load('kernel32.dll');
  k32 = {
    CreateFileW: lib.func('intptr_t __stdcall CreateFileW(str16 name, uint32_t access, uint32_t share, void *sec, uint32_t disp, uint32_t flags, intptr_t tmpl)'),
    CloseHandle: lib.func('int __stdcall CloseHandle(intptr_t h)'),
    DeviceIoControl: lib.func('int __stdcall DeviceIoControl(intptr_t h, uint32_t code, void *inBuf, uint32_t inSize, void *outBuf, uint32_t outSize, _Out_ uint32_t *ret, void *ov)'),
    GetLastError: lib.func('uint32_t __stdcall GetLastError()'),
    GetLogicalDrives: lib.func('uint32_t __stdcall GetLogicalDrives()'),
    GetDriveTypeW: lib.func('uint32_t __stdcall GetDriveTypeW(str16 root)')
  };
  return k32;
}

function ioctlAsync(h, code, inBuf, outSize) {
  const k = api();
  return new Promise((resolve, reject) => {
    const out = Buffer.alloc(Math.max(outSize, 1));
    const ret = [0];
    k.DeviceIoControl.async(h, code, inBuf, inBuf ? inBuf.length : 0, out, outSize, ret, null, (err, ok) => {
      if (err) return reject(err);
      if (!ok) { const e = new Error(`DeviceIoControl 0x${code.toString(16)} failed`); e.code = 'IOCTL'; return reject(e); }
      resolve(out.subarray(0, ret[0]));
    });
  });
}

function listDrives() {
  const k = api();
  const mask = k.GetLogicalDrives();
  const drives = [];
  for (let i = 0; i < 26; i++) {
    if (!(mask & (1 << i))) continue;
    const letter = String.fromCharCode(65 + i);
    if (k.GetDriveTypeW(`${letter}:\\`) === 5) drives.push({ id: `${letter}:`, letter });
  }
  return drives;
}

function open(letter) {
  const k = api();
  const h = k.CreateFileW(`\\\\.\\${letter.replace(/[:\\]/g, '')}:`, GENERIC_READ, FILE_SHARE_RW, null, OPEN_EXISTING, 0, 0);
  if (h === -1 || h === -1n) throw new Error(`Cannot open drive ${letter} (error ${k.GetLastError()})`);
  return h;
}

async function driveName(letter) {
  let h;
  try {
    h = open(letter);
    const q = Buffer.alloc(12);
    const out = await ioctlAsync(h, IOCTL_STORAGE_QUERY_PROPERTY, q, 1024);
    const str = (off) => { if (!off || off >= out.length) return ''; let e = off; while (e < out.length && out[e]) e++; return out.toString('latin1', off, e).trim(); };
    const vendor = str(out.readUInt32LE(12)), product = str(out.readUInt32LE(16)), rev = str(out.readUInt32LE(20));
    return [vendor, product, rev].filter(Boolean).join(' ');
  } catch (e) { return ''; } finally { if (h != null && h !== -1) api().CloseHandle(h); }
}

async function readToc(h) {
  const out = await ioctlAsync(h, IOCTL_CDROM_READ_TOC, null, 804);
  const first = out[2], last = out[3];
  const tracks = [];
  let leadout = 0;
  for (let i = 0; i <= last - first + 1; i++) {
    const o = 4 + i * 8;
    if (o + 8 > out.length) break;
    const control = out[o + 1] & 0x0f; // MSVC bitfield: Control is the low nibble, Adr the high nibble
    const num = out[o + 2];
    const lba = (out[o + 5] * 60 + out[o + 6]) * 75 + out[o + 7] - 150;
    if (num === 0xAA) { leadout = lba; break; }
    tracks.push({ number: num, lba, audio: !(control & 0x4), preemphasis: !!(control & 0x1), copyPermitted: !!(control & 0x2) });
  }
  for (let i = 0; i < tracks.length; i++) {
    const next = i + 1 < tracks.length ? tracks[i + 1].lba : leadout;
    // last audio track before a data track (enhanced CD): subtract the 11400-sector session gap
    let end = next;
    if (tracks[i].audio && i + 1 < tracks.length && !tracks[i + 1].audio) end = next - 11400;
    tracks[i].sectors = end - tracks[i].lba;
  }
  return { first, last, tracks, leadout };
}

/* ---------------------------------------------------------- CD-Text */
function parseCdText(buf) {
  if (!buf || buf.length < 4 + 18) return null;
  const packs = [];
  for (let o = 4; o + 18 <= buf.length; o += 18) packs.push(buf.subarray(o, o + 18));
  const types = { 0x80: 'title', 0x81: 'performer', 0x82: 'songwriter', 0x83: 'composer', 0x84: 'arranger', 0x85: 'message' };
  const res = { album: {}, tracks: {} };
  const byType = {};
  for (const p of packs) {
    const type = p[0];
    const block = (p[3] >> 4) & 0x07;
    if (block !== 0 || !types[type]) continue;
    (byType[type] = byType[type] || []).push(p);
  }
  for (const [t, list] of Object.entries(byType)) {
    const key = types[t];
    const dbcs = !!(list[0][3] & 0x80);
    let track = list[0][1] & 0x7f;
    let bytes = Buffer.concat(list.map(p => p.subarray(4, 16)));
    const parts = [];
    let cur = [];
    const step = dbcs ? 2 : 1;
    for (let i = 0; i < bytes.length; i += step) {
      const isNull = dbcs ? (bytes[i] === 0 && bytes[i + 1] === 0) : bytes[i] === 0;
      if (isNull) { parts.push(Buffer.from(cur)); cur = []; } else { cur.push(bytes[i]); if (dbcs) cur.push(bytes[i + 1]); }
    }
    let prev = '';
    for (const part of parts) {
      let s = dbcs ? part.toString('utf16le') : part.toString('latin1');
      if (s === '\t') s = prev;
      prev = s;
      if (track === 0) res.album[key] = s; else (res.tracks[track] = res.tracks[track] || {})[key] = s;
      track++;
    }
  }
  return res;
}

async function readCdText(h) {
  try {
    const inBuf = Buffer.from([5, 0, 0, 0]);
    const out = await ioctlAsync(h, IOCTL_CDROM_READ_TOC_EX, inBuf, 65536);
    return parseCdText(out);
  } catch (e) { return null; }
}

/* ---------------------------------------------------------- Drive class */
class WinCdDrive {
  constructor(letter) { this.letter = letter.replace(/[:\\]/g, ''); this.h = null; }
  get id() { return this.letter + ':'; }
  openHandle() { if (this.h == null) this.h = open(this.letter); return this.h; }
  close() { if (this.h != null) { api().CloseHandle(this.h); this.h = null; } }
  async mediaPresent() { try { await ioctlAsync(this.openHandle(), IOCTL_STORAGE_CHECK_VERIFY, null, 0); return true; } catch (e) { this.close(); return false; } }
  async name() { return driveName(this.letter); }
  async readToc() { return readToc(this.openHandle()); }
  async readCdText() { return readCdText(this.openHandle()); }
  async eject() { const h = open(this.letter); try { await ioctlAsync(h, IOCTL_STORAGE_EJECT_MEDIA, null, 0); } finally { api().CloseHandle(h); this.close(); } }
  async load() { const h = open(this.letter); try { await ioctlAsync(h, IOCTL_STORAGE_LOAD_MEDIA, null, 0); } finally { api().CloseHandle(h); } }
  /** ask the drive for its maximum read speed (many drives default to a slow DAE speed) */
  async setMaxSpeed() {
    const b = Buffer.alloc(12);
    b.writeUInt32LE(0, 0);          // CdromSetSpeed
    b.writeUInt16LE(0xFFFF, 4);     // ReadSpeed: maximum
    b.writeUInt16LE(0xFFFF, 6);     // WriteSpeed: maximum
    b.writeUInt32LE(0, 8);          // CdromDefaultRotation
    try { await ioctlAsync(this.openHandle(), IOCTL_CDROM_SET_SPEED, b, 0); return true; } catch (e) { return false; }
  }
  /** raw CDDA read of `count` sectors starting at `lba` (count ≤ 26) */
  async readSectors(lba, count) {
    const inBuf = Buffer.alloc(16);
    inBuf.writeBigInt64LE(BigInt(lba) * 2048n, 0);
    inBuf.writeUInt32LE(count, 8);
    inBuf.writeUInt32LE(CDDA, 12);
    return ioctlAsync(this.openHandle(), IOCTL_CDROM_RAW_READ, inBuf, count * SECTOR);
  }
}

module.exports = { listDrives, WinCdDrive, parseCdText, SECTOR, MAX_SECTORS };
