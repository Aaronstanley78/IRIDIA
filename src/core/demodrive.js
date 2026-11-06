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
    await new Promise(r => setTimeout(r, 2));
    const buf = Buffer.alloc(count * SECTOR);
    const toc = this._toc || await this.readToc();
    for (let s = 0; s < count * 588; s++) {
      const n = (lba * 588) + s; const t = n / 44100;
      const tr = toc.tracks.findIndex(x => lba + Math.floor(s / 588) < x.lba + x.sectors);
      const chord = NOTES[(Math.floor(t / 2) + Math.max(tr, 0)) % NOTES.length];
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * t * 0.5);
      let l = 0, r = 0;
      chord.forEach((f, k) => { const v = Math.sin(2 * Math.PI * f * (1 + 0.002 * tr) * t); l += v * (k === 2 ? 0.6 : 1); r += v * (k === 0 ? 0.6 : 1); });
      const beat = Math.exp(-((t % 0.5) * 18)) * Math.sin(2 * Math.PI * 55 * t);
      l = (l * 0.18 * env + beat * 0.25); r = (r * 0.18 * env + beat * 0.25);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), s * 4);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), s * 4 + 2);
    }
    return buf;
  }
}
module.exports = { DemoDrive };
