const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const { PRESETS, resolve } = require('../src/core/catalog');
const { buildArgs } = require('../src/core/ffargs');
const FF = process.env.FFEXE || '/home/claude/dl/gyan/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe';
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const allOpts = process.argv.includes('--all-opts');
const cwd = '/home/claude/t/out'; require('fs').mkdirSync(cwd, { recursive: true });
let fails = 0, runs = 0;
const NATENC = process.env.NATIVE ? require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).split('\n').map(l => (l.match(/^\s*A[\w.]{5}\s+(\S+)/) || [])[1]).filter(Boolean) : null;
function run(p, sel, layoutId, upmix, rate, tag) {
  const r = resolve(p, sel);
  const out = `${p.id}_${tag}.${r.ext}`;
  const { args, layout, rate: rr } = buildArgs({ preset: r, layoutId, upmix, rate, output: out,
    meta: { title: 'Test', artist: 'Iridia', album: 'Suite', track: 1, totalTracks: 9, year: 2026 },
    inputArgs: ['-f', 's16le', '-ar', '44100', '-ch_layout', 'stereo', '-i', '../test.pcm'] });
  const clean = args.filter((x, i) => !['-progress', '-stats_period'].includes(x) && !['-progress', '-stats_period'].includes(args[i - 1]));
  runs++;
  const res = process.env.NATIVE ? spawnSync('ffmpeg', clean, { cwd, encoding: 'utf8' }) : spawnSync('wine', [FF, ...clean], { cwd, env: { ...process.env, WINEDEBUG: '-all' }, encoding: 'utf8' });
  let probe = '';
  try { probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration', '-of', 'csv=p=0', path.join(cwd, out)], { encoding: 'utf8' }).trim().replace(/\n/g, ' '); } catch (e) { probe = 'PROBE-FAIL'; }
  let size = 0; try { size = require('fs').statSync(path.join(cwd, out)).size; } catch (e) {}
  const ok = res.status === 0 && size > 0;
  probe += ` size=${size}`;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${p.id.padEnd(16)} ${tag.padEnd(14)} want=${layoutId}->${layout.id} ${rr}Hz | ${probe} ${ok ? '' : '\n      ' + (res.stderr || '').trim().split('\n').slice(-3).join('\n      ')}`);
}
for (const p of PRESETS) {
  if (p.codec === 'dsd') continue;
  if (only && !only.test(p.id)) continue;
  if (process.argv.includes('--layouts')) { for (const l of ['mono', 'stereo', '2.1', '3.0', 'quad', '4.1', '5.0', '5.1', '6.1', '7.1']) for (const m of ['smart', 'matrix', 'front']) { if (NATENC && !NATENC.includes(p.codec)) continue; run(p, {}, l, m, 44100, `L${l}_${m}`); } continue; }
  run(p, {}, '7.1', 'smart', 44100, 'def71');
  run(p, {}, 'stereo', 'matrix', 44100, 'st');
  if (allOpts) for (const o of p.opts) o.values.forEach((v, i) => { if (i !== o.def) run(p, { [o.key]: i }, '5.1', 'matrix', 48000, `${o.key}${i}`); });
}
console.log(`\n${runs} runs, ${fails} failures`);
