'use strict';
/*
 * IRIDIA DSD engine
 * -----------------
 * DSF / DSDIFF (DFF) container writers and ID3 tagging. The modulator lives in sdm.js.
 */
const fs = require('fs');
const path = require('path');

const DSD_BASE = 44100;          // DSD64 = 64 × 44.1 kHz

/* --------------------------------------------------------------- ID3v2.3 */
function id3Frame(id, data) {
  const h = Buffer.alloc(10);
  h.write(id, 0, 'latin1'); h.writeUInt32BE(data.length, 4);
  return Buffer.concat([h, data]);
}
function id3Text(id, s) {
  if (s == null || String(s) === '') return Buffer.alloc(0);
  const body = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(String(s), 'utf16le'), Buffer.from([0, 0])]);
  return id3Frame(id, body);
}
function buildId3(meta = {}, cover) {
  const frames = [
    id3Text('TIT2', meta.title), id3Text('TPE1', meta.artist), id3Text('TALB', meta.album),
    id3Text('TPE2', meta.albumArtist), id3Text('TRCK', meta.track ? (meta.totalTracks ? `${meta.track}/${meta.totalTracks}` : meta.track) : ''),
    id3Text('TYER', meta.year), id3Text('TCON', meta.genre), id3Text('TCOM', meta.composer), id3Text('TPOS', meta.disc),
    id3Text('TSSE', 'IRIDIA DSD engine')
  ];
  if (cover && cover.data) {
    const mime = cover.mime || 'image/jpeg';
    frames.push(id3Frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from(mime + '\0', 'latin1'), Buffer.from([3, 0]), cover.data])));
  }
  const body = Buffer.concat(frames);
  const h = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const sz = body.length;
  h[6] = (sz >> 21) & 0x7f; h[7] = (sz >> 14) & 0x7f; h[8] = (sz >> 7) & 0x7f; h[9] = sz & 0x7f;
  return Buffer.concat([h, body]);
}

/* bit reversal table (DSF stores LSB first) */
const REV = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let r = 0; for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 1 << (7 - b); REV[i] = r; }

/* ------------------------------------------------------------- DSF writer */
const DSF_CHANNEL_TYPE = { 'mono': 1, 'stereo': 2, '3.0': 3, 'quad': 4, '5.0': 6, '5.1': 7 };
const DSF_BLOCK = 4096;

class DsfWriter {
  constructor(file, channels, layoutId, rate) {
    this.file = file; this.ch = channels; this.rate = rate;
    this.type = DSF_CHANNEL_TYPE[layoutId] || (channels === 1 ? 1 : 2);
    this.fd = fs.openSync(file, 'w');
    this.pos = 92; // DSD (28) + fmt (52) + data header (12)
    fs.writeSync(this.fd, Buffer.alloc(92), 0, 92, 0);
    this.bufs = Array.from({ length: channels }, () => Buffer.alloc(DSF_BLOCK));
    this.fill = 0; this.bytesPerCh = 0;
  }
  /** chunks: array (per channel) of MSB-first byte arrays of equal length */
  write(chunks) {
    const len = chunks[0].length;
    let off = 0;
    while (off < len) {
      const take = Math.min(DSF_BLOCK - this.fill, len - off);
      for (let c = 0; c < this.ch; c++) {
        const src = chunks[c], dst = this.bufs[c];
        for (let i = 0; i < take; i++) dst[this.fill + i] = REV[src[off + i]];
      }
      this.fill += take; off += take;
      if (this.fill === DSF_BLOCK) this._flush();
    }
    this.bytesPerCh += len;
  }
  _flush() {
    for (let c = 0; c < this.ch; c++) {
      if (this.fill < DSF_BLOCK) this.bufs[c].fill(0, this.fill);
      fs.writeSync(this.fd, this.bufs[c], 0, DSF_BLOCK, this.pos); this.pos += DSF_BLOCK;
    }
    this.fill = 0;
  }
  close(meta, cover) {
    if (this.fill > 0) this._flush();
    const dataEnd = this.pos;
    const id3 = buildId3(meta, cover);
    fs.writeSync(this.fd, id3, 0, id3.length, dataEnd);
    const total = dataEnd + id3.length;
    const h = Buffer.alloc(92);
    h.write('DSD ', 0, 'latin1'); h.writeBigUInt64LE(28n, 4); h.writeBigUInt64LE(BigInt(total), 12); h.writeBigUInt64LE(BigInt(dataEnd), 20);
    h.write('fmt ', 28, 'latin1'); h.writeBigUInt64LE(52n, 32);
    h.writeUInt32LE(1, 40); h.writeUInt32LE(0, 44); h.writeUInt32LE(this.type, 48); h.writeUInt32LE(this.ch, 52);
    h.writeUInt32LE(this.rate, 56); h.writeUInt32LE(1, 60); h.writeBigUInt64LE(BigInt(this.bytesPerCh) * 8n, 64);
    h.writeUInt32LE(DSF_BLOCK, 72); h.writeUInt32LE(0, 76);
    h.write('data', 80, 'latin1'); h.writeBigUInt64LE(BigInt(dataEnd - 80), 84);
    fs.writeSync(this.fd, h, 0, 92, 0);
    fs.closeSync(this.fd);
  }
}

/* ---------------------------------------------------------- DSDIFF writer */
const DFF_IDS = {
  'mono': ['C   '], 'stereo': ['SLFT', 'SRGT'], '2.1': ['MLFT', 'MRGT', 'LFE '], '3.0': ['MLFT', 'MRGT', 'C   '],
  'quad': ['MLFT', 'MRGT', 'LS  ', 'RS  '], '4.1': ['MLFT', 'MRGT', 'C   ', 'LFE ', 'C004'],
  '5.0': ['MLFT', 'MRGT', 'C   ', 'LS  ', 'RS  '], '5.1': ['MLFT', 'MRGT', 'C   ', 'LFE ', 'LS  ', 'RS  '],
  '6.1': ['MLFT', 'MRGT', 'C   ', 'LFE ', 'C004', 'LS  ', 'RS  '], '7.1': ['MLFT', 'MRGT', 'C   ', 'LFE ', 'C004', 'C005', 'LS  ', 'RS  ']
};
function ck(id, body) {
  const h = Buffer.alloc(12); h.write(id, 0, 'latin1'); h.writeBigUInt64BE(BigInt(body.length), 4);
  const pad = body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([h, body, pad]);
}
class DffWriter {
  constructor(file, channels, layoutId, rate) {
    this.file = file; this.ch = channels; this.rate = rate;
    this.ids = DFF_IDS[layoutId] || DFF_IDS.stereo;
    if (this.ids.length !== channels) this.ids = Array.from({ length: channels }, (_, i) => 'C' + String(i).padStart(3, '0'));
    this.fd = fs.openSync(file, 'w');
    const fver = ck('FVER', Buffer.from([1, 5, 0, 0]));
    const fsb = Buffer.alloc(4); fsb.writeUInt32BE(rate);
    const chnlB = Buffer.alloc(2 + 4 * channels); chnlB.writeUInt16BE(channels); this.ids.forEach((id, i) => chnlB.write(id, 2 + 4 * i, 'latin1'));
    const name = 'not compressed';
    const cmpr = Buffer.concat([Buffer.from('DSD ', 'latin1'), Buffer.from([name.length]), Buffer.from(name, 'latin1'), (name.length + 1) & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    const abss = Buffer.alloc(8);
    const lsco = Buffer.alloc(2); lsco.writeUInt16BE(channels === 2 ? 0 : 0xffff);
    const prop = ck('PROP', Buffer.concat([Buffer.from('SND ', 'latin1'), ck('FS  ', fsb), ck('CHNL', chnlB), ck('CMPR', cmpr), ck('ABSS', abss), ck('LSCO', lsco)]));
    this.head = Buffer.concat([fver, prop]);
    this.dataStart = 16 + this.head.length + 12;
    fs.writeSync(this.fd, Buffer.alloc(this.dataStart), 0, this.dataStart, 0);
    this.pos = this.dataStart; this.bytes = 0;
  }
  write(chunks) {
    const len = chunks[0].length, ch = this.ch;
    const buf = Buffer.allocUnsafe(len * ch);
    for (let i = 0, o = 0; i < len; i++) for (let c = 0; c < ch; c++) buf[o++] = chunks[c][i];
    fs.writeSync(this.fd, buf, 0, buf.length, this.pos); this.pos += buf.length; this.bytes += buf.length;
  }
  close(meta = {}, cover) {
    let end = this.pos;
    if (this.bytes & 1) { fs.writeSync(this.fd, Buffer.alloc(1), 0, 1, end); end++; }
    const parts = [];
    if (meta.artist) { const b = Buffer.from(String(meta.artist), 'utf8'); const l = Buffer.alloc(4); l.writeUInt32BE(b.length); parts.push(ck('DIAR', Buffer.concat([l, b]))); }
    if (meta.title) { const b = Buffer.from(String(meta.title), 'utf8'); const l = Buffer.alloc(4); l.writeUInt32BE(b.length); parts.push(ck('DITI', Buffer.concat([l, b]))); }
    const tail = Buffer.concat([parts.length ? ck('DIIN', Buffer.concat(parts)) : Buffer.alloc(0), ck('ID3 ', buildId3(meta, cover))]);
    fs.writeSync(this.fd, tail, 0, tail.length, end);
    const total = end + tail.length;
    const hdr = Buffer.alloc(16); hdr.write('FRM8', 0, 'latin1'); hdr.writeBigUInt64BE(BigInt(total - 12), 4); hdr.write('DSD ', 12, 'latin1');
    const dh = Buffer.alloc(12); dh.write('DSD ', 0, 'latin1'); dh.writeBigUInt64BE(BigInt(this.bytes), 4);
    fs.writeSync(this.fd, Buffer.concat([hdr, this.head, dh]), 0, this.dataStart, 0);
    fs.closeSync(this.fd);
  }
}

module.exports = { DsfWriter, DffWriter, buildId3, DSD_BASE, DSF_CHANNEL_TYPE, DFF_IDS };
