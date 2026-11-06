'use strict';
/*
 * High-speed sigma-delta modulation kernel.
 *
 * For every (order, DSD rate) pair a fully unrolled modulator is generated with the
 * noise-transfer-function coefficients inlined as constants, so V8 compiles it to a tight
 * register-only loop. It reads one channel straight out of an interleaved float buffer
 * (no de-interleaving pass) and keeps its loop-filter state between calls, so a channel is
 * modulated as one continuous stream.
 */
const NTF = require('./ntf');

const PCM_RATE = 352800;   // 8 × 44.1 kHz delivered by FFmpeg (SoX resampler, 28-bit)
const SACD_GAIN = 0.5;     // 0 dBFS PCM = 50 % modulation (SACD reference)
const LIMIT = 0.5;

function coeffs(order, mul) {
  const sos = NTF[`${order}_${mul}`];
  if (!sos) throw new Error(`No NTF for order ${order} / DSD${mul}`);
  return sos.map(s => ({ b1: s[1], b2: s[2], a1: s[4], a2: s[5] }));
}

const cache = new Map();
/** returns fn(x, ch, c, frames, out, o, st) → resets ; st = Float64Array state (2n + 1 prev + 2 packer) */
function kernel(order, mul) {
  const key = `${order}_${mul}`;
  if (cache.has(key)) return cache.get(key);
  const cs = coeffs(order, mul);
  const n = cs.length, K = mul / 8;
  const load = [], save = [], sum = [], upd = [], reset = [];
  cs.forEach((s, j) => {
    load.push(`let s1_${j} = st[${2 * j}], s2_${j} = st[${2 * j + 1}];`);
    save.push(`st[${2 * j}] = s1_${j}; st[${2 * j + 1}] = s2_${j};`);
    sum.push(`s1_${j}`);
    upd.push(`y = e + s1_${j}; s1_${j} = ${s.b1} * e - ${s.a1} * y + s2_${j}; s2_${j} = ${s.b2} * e - ${s.a2} * y; e = y;`);
    reset.push(`s1_${j} = 0; s2_${j} = 0;`);
  });
  const P = 2 * n;
  const BYTES = K / 8;          // whole bytes per input frame (1 for DSD64 … 8 for DSD512)
  const step = (bit) => `
        xi += d;
        v = xi + ${sum.join(' + ')};
        if (v >= 0) { e = 1 - v; byte |= ${1 << (7 - 0)} >> ${bit}; } else { e = -1 - v; }
        ${upd.join('\n        ')}
        if (v > 8 || v < -8) { ${reset.join(' ')} resets++; }`;
  let body = '';
  for (let bit = 0; bit < 8; bit++) body += step(bit);
  const src = `
    ${load.join('\n    ')}
    let prev = st[${P}], resets = 0, y = 0, e = 0, v = 0;
    for (let f = 0, i = c; f < frames; f++, i += ch) {
      let cur = x[i] * ${SACD_GAIN};
      if (cur > ${LIMIT}) cur = ${LIMIT}; else if (cur < -${LIMIT}) cur = -${LIMIT};
      const d = (cur - prev) * ${1 / K};
      let xi = prev;
      for (let b = 0; b < ${BYTES}; b++) {
        let byte = 0;${body}
        out[o++] = byte;
      }
      prev = cur;
    }
    ${save.join('\n    ')}
    st[${P}] = prev;
    return resets;`;
  const fn = new Function('x', 'ch', 'c', 'frames', 'out', 'o', 'st', src);
  fn.stateSize = P + 3;
  fn.K = K;
  cache.set(key, fn);
  return fn;
}

module.exports = { PCM_RATE, SACD_GAIN, LIMIT, coeffs, kernel };
