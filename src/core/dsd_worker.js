'use strict';
/* One worker = one channel stream. Reads its channel directly from the shared interleaved
 * PCM chunk and writes packed DSD bytes into the shared output buffer. */
const { parentPort, workerData } = require('worker_threads');
const { kernel } = require('./sdm');

const k = kernel(workerData.order, workerData.mul);
const st = new Float64Array(k.stateSize);
let resets = 0;
let pcm = null, out = null;

parentPort.on('message', (m) => {
  if (m.type === 'buffers') { pcm = new Float32Array(m.pcm); out = new Uint8Array(m.out); return; }
  if (m.type === 'run') {
    resets += k(pcm, m.ch, workerData.channel, m.frames, out, workerData.channel * m.bytesPerCh, st);
    parentPort.postMessage({ type: 'done' });
    return;
  }
  if (m.type === 'stats') parentPort.postMessage({ type: 'stats', resets });
});
