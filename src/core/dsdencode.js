'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
const { DsfWriter, DffWriter, DSD_BASE } = require('./dsd');

const CHUNK_FRAMES = 88200; // 0.125 s @ 705.6 kHz (even)

class DsdEncoder {
  constructor({ file, fmt, channels, layoutId, mul, order }) {
    this.ch = channels; this.rate = DSD_BASE * mul;
    this.writer = fmt === 'dsf' ? new DsfWriter(file, channels, layoutId, this.rate) : new DffWriter(file, channels, layoutId, this.rate);
    this.workers = Array.from({ length: channels }, () => new Worker(path.join(__dirname, 'dsd_worker.js'), { workerData: { order, mul } }));
    this.pending = Buffer.alloc(0);
    this.frameBytes = 4 * channels;
  }
  _modulate(frames, buf) {
    const ch = this.ch;
    const per = Array.from({ length: ch }, () => new Float32Array(frames));
    for (let i = 0, o = 0; i < frames; i++) for (let c = 0; c < ch; c++, o += 4) per[c][i] = buf.readFloatLE(o);
    return Promise.all(this.workers.map((w, c) => new Promise((res, rej) => {
      const onMsg = (m) => { w.off('error', rej); res(m); };
      w.once('message', onMsg); w.once('error', rej);
      w.postMessage(per[c], [per[c].buffer]);
    }))).then(outs => this.writer.write(outs));
  }
  /** feed raw f32le interleaved bytes; resolves when processed (back-pressure) */
  async write(chunk) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const need = CHUNK_FRAMES * this.frameBytes;
    while (this.pending.length >= need) {
      const part = this.pending.subarray(0, need);
      this.pending = this.pending.subarray(need);
      await this._modulate(CHUNK_FRAMES, part);
    }
  }
  async end(meta, cover) {
    let frames = Math.floor(this.pending.length / this.frameBytes);
    if (frames > 0) {
      const even = frames + (frames & 1);
      const buf = Buffer.alloc(even * this.frameBytes);
      this.pending.copy(buf, 0, 0, frames * this.frameBytes);
      await this._modulate(even, buf);
    }
    const resets = await Promise.all(this.workers.map(w => new Promise(res => { w.once('message', m => res(m.resets || 0)); w.postMessage('stats'); })));
    await Promise.all(this.workers.map(w => w.terminate()));
    this.writer.close(meta, cover);
    return { resets: resets.reduce((a, b) => a + b, 0) };
  }
  async abort() { await Promise.all(this.workers.map(w => w.terminate())); try { this.writer.close({}); } catch (e) {} }
}
module.exports = { DsdEncoder };
