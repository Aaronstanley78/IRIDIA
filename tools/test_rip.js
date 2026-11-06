const { Ripper } = require('../src/core/ripper');
const { DemoDrive } = require('../src/core/demodrive');
const { discId } = require('../src/core/metadata');
(async () => {
  // MusicBrainz reference vector (libdiscid docs)
  const offs = [150, 15363, 32314, 46592, 63414, 80489]; const lead = 95462;
  const toc0 = { tracks: offs.map((o, i) => ({ number: i + 1, lba: o - 150, audio: true, sectors: (offs[i + 1] || lead) - o })), leadout: lead - 150 };
  console.log('discid', discId(toc0).id, '(expect 49HHV7Eb8UKF3aQiNmu1GR8vKTY-)');
  const drive = new DemoDrive(); const toc = await drive.readToc();
  for (const image of [false, true]) {
    const r = new Ripper({ drive, toc, trackNumbers: image ? [1, 2, 3] : [1, 4], album: { title: 'Spectrum Sessions', artist: 'The Iridia Ensemble', year: '2026', genre: 'Electronic' },
      trackMeta: { 1: { title: 'Prismatic Dawn' }, 4: { title: 'Halo Over Tokyo' } },
      profiles: [{ presetId: 'flac' }, { presetId: 'mp3' }, { presetId: 'dsf' }, { presetId: 'dff', selections: { dsdrate: 1 } }, { presetId: 'opus' }, { presetId: 'ac3' }],
      layoutId: '7.1', upmix: 'smart', rate: 44100, outDir: '/home/claude/t/rip' + (image ? 'img' : ''), ffmpeg: 'ffmpeg', secure: true, offset: 6, deemphasis: true, image });
    let last = 0; r.on('progress', p => { if (p.totalPct - last > 0.25) { last = p.totalPct; console.log('  progress', (p.totalPct * 100).toFixed(0) + '%', p.speed.toFixed(1) + 'x'); } });
    const t0 = Date.now(); const res = await r.run();
    console.log(image ? 'IMAGE' : 'TRACKS', 'done in', (Date.now() - t0) / 1000, 's', res.results.map(x => x.ok ? 'ok' : x.error));
  }
})();
