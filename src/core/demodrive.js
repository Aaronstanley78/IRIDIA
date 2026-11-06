'use strict';
/* Virtual audio CD used for demos/tests (enabled with IRIDIA_DEMO=1). Generates synthetic music. */
const SECTOR = 2352;
const TRACKS = [
  { title: 'Prismatic Dawn', secs: 34 }, { title: 'Spectral Lines', secs: 28 }, { title: 'Iridescence', secs: 41 },
  { title: 'Halo Over Tokyo', secs: 25 }, { title: 'Refraction', secs: 37 }, { title: 'Chromatic Tides', secs: 30 },
  { title: 'Aurora Engine', secs: 44 }, { title: 'Afterglow', secs: 32 }
];
const NOTES = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [164.81, 207.65, 246.94]];

class DemoDrive {
  constructor() { this.id = 'DEMO'; this.letter = 'DEMO'; this._toc = null; }
  async mediaPresent() { return true; }
  async name() { return 'IRIDIA Virtual Drive 1.0'; }
  async readToc() {
    let lba = 0; const tracks = [];
    TRACKS.forEach((t, i) => { const sectors = t.secs * 75; tracks.push({ number: i + 1, lba, audio: true, preemphasis: false, copyPermitted: true, sectors }); lba += sectors; });
    this._toc = { first: 1, last: TRACKS.length, tracks, leadout: lba };
    return this._toc;
  }
  async readCdText() {
    const r = { album: { title: 'Spectrum Sessions', performer: 'The Iridia Ensemble' }, tracks: {} };
    TRACKS.forEach((t, i) => { r.tracks[i + 1] = { title: t.title, performer: 'The Iridia Ensemble' }; });
    return r;
  }
  async eject() {} async load() {} close() {}
  async readSectors(lba, count) {
    const toc = this._toc || await this.readToc();
    const speed = +(process.env.IRIDIA_DEMO_SPEED || 24);           // emulate a 24× drive
    const t0 = Date.now();
    const n = count * 588;
    const buf = Buffer.alloc(n * 4);
    const pcm = new Int16Array(buf.buffer, buf.byteOffset, n * 2);
    let tr = toc.tracks.findIndex(x => lba < x.lba + x.sectors);
    if (tr < 0) tr = toc.tracks.length - 1;
    const tw = 2 * Math.PI / 44100;
    for (let s = 0; s < n; s++) {
      const idx = lba * 588 + s, t = idx / 44100;
      const chord = NOTES[(Math.floor(t / 2) + tr) % NOTES.length];
      const env = 0.5 + 0.5 * Math.sin(Math.PI * t);
      const detune = 1 + 0.002 * tr;
      const v0 = Math.sin(tw * chord[0] * detune * idx), v1 = Math.sin(tw * chord[1] * detune * idx), v2 = Math.sin(tw * chord[2] * detune * idx);
      const tb = t % 0.5;
      const beat = Math.exp(-tb * 18) * Math.sin(tw * 55 * idx);
      const l = (v0 + v1 + 0.6 * v2) * 0.18 * env + beat * 0.25;
      const r = (0.6 * v0 + v1 + v2) * 0.18 * env + beat * 0.25;
      pcm[2 * s] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
      pcm[2 * s + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
    }
    const want = (n / 44100) / speed * 1000 - (Date.now() - t0);
    if (want > 0) await new Promise(r => setTimeout(r, want));
    return buf;
  }
}
module.exports = { DemoDrive };
