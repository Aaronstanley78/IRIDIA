'use strict';
/*
 * Multi-core DSD encoder: FFmpeg delivers interleaved float PCM at 352.8 kHz, every channel
 * is modulated on its own CPU core (shared memory, zero copies) while the next chunk is
 * already being read, and packed bytes go straight to the DSF/DFF writer.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const { DsfWriter, DffWriter, DSD_BASE } = require('./dsd');

const CHUNK_FRAMES = 176400; // 0.5 s at 352.8 kHz

class DsdEncoder {
  constructor({ file, fmt, channels, layoutId, mul, order }) {
    this.ch = channels; this.mul = mul; this.rate = DSD_BASE * mul;
    this.writer = fmt === 'dsf' ? new DsfWriter(file, channels, layoutId, this.rate) : new DffWriter(file, channels, layoutId, this.rate);
    this.frameBytes = 4 * channels;
    this.bytesPerCh = CHUNK_FRAMES * mul / 64; // frames × (mul/8) bits / 8
    // double-buffered shared memory so FFmpeg output can be staged while workers run
    this.slots = [0, 1].map(() => ({
      pcm: new SharedArrayBuffer(CHUNK_FRAMES * this.frameBytes),
      out: new SharedArrayBuffer(this.bytesPerCh * channels)
    }));
    this.workers = Array.from({ length: channels }, (_, c) => new Worker(path.join(__dirname, 'dsd_worker.js'), { workerData: { order, mul, channel: c } }));
    this.fill = 0; this.cur = 0; this.inflight = Promise.resolve();
    this.pcmView = this.slots.map(s => Buffer.from(s.pcm));
  }

  _run(slotIdx, frames) {
    const slot = this.slots[slotIdx];
    const jobs = this.workers.map(w => new Promise((res, rej) => {
      const onMsg = (m) => { if (m.type === 'done') { w.off('message', onMsg); w.off('error', rej); res(); } };
      w.on('message', onMsg); w.once('error', rej);
      w.postMessage({ type: 'buffers', pcm: slot.pcm, out: slot.out });
      w.postMessage({ type: 'run', ch: this.ch, frames, bytesPerCh: this.bytesPerCh });
    }));
    return Promise.all(jobs).then(() => {
      const bytes = frames * this.mul / 64;
      const o = new Uint8Array(slot.out);
      this.writer.write(Array.from({ length: this.ch }, (_, c) => o.subarray(c * this.bytesPerCh, c * this.bytesPerCh + bytes)));
    });
  }

  /* Stage the full slot and launch it; the previous slot must be finished before it is reused. */
  async _flush(frames) {
    const idx = this.cur;
    await this.inflight;                    // channels are sequential streams: keep chunk order
    this.inflight = this._run(idx, frames);
    this.cur ^= 1; this.fill = 0;
  }

  async write(chunk) {
    let off = 0;
    const cap = CHUNK_FRAMES * this.frameBytes;
    while (off < chunk.length) {
      const n = Math.min(cap - this.fill, chunk.length - off);
      chunk.copy(this.pcmView[this.cur], this.fill, off, off + n);
      this.fill += n; off += n;
      if (this.fill === cap) await this._flush(CHUNK_FRAMES);
    }
  }

  async end(meta, cover) {
    const frames = Math.floor(this.fill / this.frameBytes);
    if (frames > 0) await this._flush(frames);
    await this.inflight;
    const resets = await Promise.all(this.workers.map(w => new Promise(res => {
      const h = (m) => { if (m.type === 'stats') { w.off('message', h); res(m.resets); } };
      w.on('message', h); w.postMessage({ type: 'stats' });
    })));
    await Promise.all(this.workers.map(w => w.terminate()));
    this.writer.close(meta, cover);
    return { resets: resets.reduce((a, b) => a + b, 0) };
  }

  async abort() { await Promise.all(this.workers.map(w => w.terminate())); try { this.writer.close({}); } catch (e) {} }
}
module.exports = { DsdEncoder, CHUNK_FRAMES };
