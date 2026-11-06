// Encode a test PCM to DSF/DFF via ffmpeg -> modulator and verify by decoding with ffmpeg
const { spawn, execFileSync } = require('child_process');
const { DsdEncoder } = require('../src/core/dsdencode');
const { buildId3 } = require('../src/core/dsd');
async function enc(fmt, layout, ch, mul, order) {
  const file = `/home/claude/t/out/dsd_${layout}_${mul}_${order}.${fmt}`;
  const t0 = Date.now();
  const filt = layout === 'stereo' ? 'anull' : `surround=chl_out=${layout}`;
  const ff = spawn('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=1000:d=3:sample_rate=44100,volume=0.5,pan=stereo|c0=c0|c1=c0', '-af', `${filt},aresample=705600:resampler=soxr`, '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1']);
  const e = new DsdEncoder({ file, fmt, channels: ch, layoutId: layout, mul, order });
  for await (const chunk of ff.stdout) await e.write(chunk);
  const r = await e.end({ title: 'Tone', artist: 'Iridia', album: 'Test', track: 1, totalTracks: 1 });
  const dt = (Date.now() - t0) / 1000;
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration:format_tags=title,artist', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().replace(/\n/g, ' ');
  // measure decoded 1 kHz level & noise using ffmpeg astats on 44.1k decode
  const st = execFileSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'aresample=44100,pan=mono|c0=c0,highpass=f=500,lowpass=f=2000,astats=measure_overall=RMS_level:measure_perchannel=0', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  console.log(fmt, layout, `DSD${mul}`, `o${order}`, `${dt.toFixed(1)}s`, 'resets', r.resets, '|', probe);
}
(async () => {
  await enc('dsf', 'stereo', 2, 64, 7);
  await enc('dff', 'stereo', 2, 64, 5);
  await enc('dsf', '5.1', 6, 64, 7);
  await enc('dff', '7.1', 8, 128, 7);
  await enc('dsf', 'stereo', 2, 256, 7);
  await enc('dff', 'stereo', 2, 512, 7);
})();
