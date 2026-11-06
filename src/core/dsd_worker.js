'use strict';
const { parentPort, workerData } = require('worker_threads');
const { Modulator } = require('./dsd');
const mod = new Modulator(workerData.order, workerData.mul);
parentPort.on('message', (msg) => {
  if (msg === 'stats') { parentPort.postMessage({ resets: mod.resets }); return; }
  const out = mod.process(msg);
  parentPort.postMessage(out, [out.buffer]);
});
