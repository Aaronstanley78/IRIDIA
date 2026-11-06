'use strict';
/* Builds FFmpeg command lines for IRIDIA output presets. */
const { LAYOUTS, allowedChannels } = require('./catalog');

const DEFAULT_LAYOUT = { 1: 'mono', 2: 'stereo', 3: '2.1', 4: 'quad', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1' };

/** Pick the effective layout for a preset given the user's requested layout id. */
function effectiveLayout(preset, layoutId) {
  const want = LAYOUTS.find(l => l.id === layoutId) || LAYOUTS[1];
  const ov = (l) => (preset.ffLayout && preset.ffLayout[l.id]) ? Object.assign({}, l, { ff: preset.ffLayout[l.id] }) : l;
  if (preset.layouts) {
    if (preset.layouts.includes(want.id)) return { layout: ov(want), clamped: false };
    const cands = LAYOUTS.filter(l => preset.layouts.includes(l.id));
    const lower = cands.filter(l => l.ch <= want.ch);
    const pick = lower.length ? lower[lower.length - 1] : cands[0];
    return { layout: ov(pick), clamped: true };
  }
  const allowed = allowedChannels(preset);
  if (allowed.includes(want.ch)) return { layout: ov(want), clamped: false };
  const lower = allowed.filter(c => c <= want.ch);
  const ch = lower.length ? Math.max(...lower) : Math.min(...allowed);
  const l = LAYOUTS.find(x => x.id === DEFAULT_LAYOUT[ch]);
  return { layout: ov(l), clamped: true };
}

/** Pick an output sample rate the preset accepts, closest to the requested one. */
function effectiveRate(preset, requested) {
  const rq = requested || 44100;
  if (!preset.rates) return rq;
  if (preset.rates.includes(rq)) return rq;
  // prefer the closest rate, ties go up
  return preset.rates.slice().sort((a, b) => Math.abs(a - rq) - Math.abs(b - rq) || b - a)[0];
}

/* Matrix upmix coefficients from a stereo source (c0 = L, c1 = R). */
const C = 'c0', R = 'c1';
const MATRIX = {
  FL: `${C}`, FR: `${R}`,
  FC: `0.5*${C}+0.5*${R}`,
  LFE: `0.5*${C}+0.5*${R}`,
  BL: `0.6*${C}-0.3*${R}`, BR: `0.6*${R}-0.3*${C}`,
  SL: `0.7*${C}-0.2*${R}`, SR: `0.7*${R}-0.2*${C}`,
  BC: `0.35*${C}+0.35*${R}`
};
const LAYOUT_CHANNELS = {
  'mono': ['FC'], 'stereo': ['FL', 'FR'], '2.1': ['FL', 'FR', 'LFE'], '3.0': ['FL', 'FR', 'FC'],
  'quad': ['FL', 'FR', 'BL', 'BR'], '4.1': ['FL', 'FR', 'FC', 'LFE', 'BC'],
  '5.0(side)': ['FL', 'FR', 'FC', 'SL', 'SR'], '5.0': ['FL', 'FR', 'FC', 'BL', 'BR'], '5.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR'], '5.1(side)': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
  '6.1': ['FL', 'FR', 'FC', 'LFE', 'BC', 'SL', 'SR'], '7.1': ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR']
};

function channelFilter(layout, mode) {
  const ff = layout.ff;
  if (layout.ch === 2) return [];
  if (layout.ch === 1) return ['pan=mono|c0=0.5*c0+0.5*c1'];
  const chans = LAYOUT_CHANNELS[ff];
  const hasLfe = chans.includes('LFE');
  if (mode === 'smart') {
    return [`surround=chl_out=${ff}:lfe_low=120:lfe_high=250`];
  }
  if (mode === 'front') {
    const parts = chans.map(ch => ch === 'FL' ? 'FL=c0' : ch === 'FR' ? 'FR=c1' : `${ch}=0*c0`);
    return [`pan=${ff}|${parts.join('|')}`];
  }
  // matrix
  const parts = chans.map(ch => `${ch}=${MATRIX[ch]}`);
  const f = [`pan=${ff}|${parts.join('|')}`];
  if (hasLfe) f.push('lowpass=f=120:p=2:c=LFE');
  return f;
}

/**
 * Build FFmpeg arguments.
 * opts: { preset (resolved), layoutId, upmix, rate, meta, coverPath, output, inputArgs, trackSeconds, hasSoxr, normalizeDb }
 * Input is raw CD PCM (s16le, 44.1 kHz, stereo) on stdin unless opts.inputArgs given.
 */
function buildArgs(opts) {
  const p = opts.preset;
  const { layout } = effectiveLayout(p, opts.layoutId);
  const rate = effectiveRate(p, opts.rate);
  const a = ['-hide_banner', '-y', '-loglevel', 'error', '-nostats']; // stdin carries our PCM
  a.push(...(opts.inputArgs || ['-f', 's16le', '-ar', '44100', '-ch_layout', 'stereo', '-i', 'pipe:0']));
  let inputs = 1;
  const useCover = opts.coverPath && p.cover;
  if (useCover) { a.push('-i', opts.coverPath); inputs++; }
  let videoIdx = -1;
  if (p.needsVideo === 'amv') {
    a.push('-f', 'lavfi', '-i', 'color=c=black:s=160x120:r=15'); videoIdx = inputs++;
  } else if (p.needsVideo === 'cinepak') {
    a.push('-f', 'lavfi', '-i', 'color=c=black:s=160x120:r=12'); videoIdx = inputs++;
  }

  const filters = [...(opts.preFilters || [])];
  if (opts.preGain) filters.push(`volume=${opts.preGain}dB`);
  filters.push(...channelFilter(layout, opts.upmix || 'smart'));
  const isDsd = p.codec === 'dsd';
  const outRate = isDsd ? 705600 : rate;
  if (outRate !== 44100) filters.push(opts.hasSoxr === false ? `aresample=${outRate}` : `aresample=${outRate}:resampler=soxr:precision=28`);
  filters.push(`aformat=channel_layouts=${layout.ff}`);
  if (p.postFilters) filters.push(...p.postFilters);

  if (isDsd) {
    a.push('-map', '0:a', '-af', filters.join(','), '-c:a', 'pcm_f32le', '-ar', String(outRate), '-f', 'f32le', 'pipe:1');
    return { args: a, layout, rate: 44100 * (p.dsdMul || 64), dsd: true };
  }
  if (videoIdx >= 0) { // AMV / FILM need the video stream first
    a.push('-map', `${videoIdx}:v`, '-c:v', p.needsVideo === 'amv' ? 'amv' : 'cinepak', '-shortest');
    if (p.needsVideo === 'amv') a.push('-pix_fmt', 'yuvj420p', '-block_size', String(rate / 15));
  }
  if (p.fmt === 'iamf') {
    // IAMF: one substream per coupled pair / single channel + audio-element & mix-presentation groups
    const plans = {
      'mono': [['mono', 'FC']], 'stereo': [['stereo', 'FL', 'FR']],
      '5.1(side)': [['stereo', 'FL', 'FR'], ['stereo', 'SL', 'SR'], ['mono', 'FC'], ['mono', 'LFE']],
      '7.1': [['stereo', 'FL', 'FR'], ['stereo', 'SL', 'SR'], ['stereo', 'BL', 'BR'], ['mono', 'FC'], ['mono', 'LFE']]
    };
    const plan = plans[layout.ff] || plans.stereo;
    let fc;
    if (layout.ff === 'stereo' || layout.ff === 'mono') fc = `[0:a]${filters.join(',')}[s0]`;
    else {
      fc = `[0:a]${filters.join(',')},asplit=${plan.length}${plan.map((_, i) => `[x${i}]`).join('')}`;
      plan.forEach((pl, i) => { fc += `;[x${i}]pan=${pl[0]}|${pl.slice(1).map((c, k) => `c${k}=${c}`).join('|')}[s${i}]`; });
    }
    a.push('-filter_complex', fc);
    plan.forEach((_, i) => a.push('-map', `[s${i}]`, '-streamid', `${i}:${10 + i}`));
    a.push('-stream_group', `type=iamf_audio_element:id=1:${plan.map((_, i) => `st=${i}`).join(':')}:audio_element_type=channel,layer=ch_layout=${layout.ff}`);
    a.push('-stream_group', `type=iamf_mix_presentation:id=99:stg=0:annotations=en-us=Default,submix=parameter_id=100:parameter_rate=${rate}:default_mix_gain=0.0|element=stg=0:parameter_id=101:parameter_rate=${rate}:default_mix_gain=0.0:annotations=en-us=Main|layout=sound_system=stereo`);
  } else {
    a.push('-map', '0:a');
    a.push('-af', filters.join(','));
  }
  if (useCover) a.push('-map', '1:v', '-c:v', p.fmt === 'ipod' || p.fmt === 'mp4' ? 'mjpeg' : 'copy', '-disposition:v', 'attached_pic');
  a.push('-c:a', p.codec);
  a.push('-ar', String(rate));
  if (p.experimental) a.push('-strict', '-2');
  a.push(...p.extraArgs);

  const m = opts.meta || {};
  const md = (k, v) => { if (v != null && String(v).trim() !== '') a.push('-metadata', `${k}=${v}`); };
  md('title', m.title); md('artist', m.artist); md('album', m.album); md('album_artist', m.albumArtist);
  md('date', m.year); md('genre', m.genre); md('composer', m.composer); md('comment', m.comment || 'Ripped with IRIDIA');
  if (m.track) md('track', m.totalTracks ? `${m.track}/${m.totalTracks}` : m.track);
  if (m.disc) md('disc', m.disc);
  a.push('-f', p.fmt, opts.output);
  return { args: a, layout, rate };
}

module.exports = { buildArgs, effectiveLayout, effectiveRate, channelFilter };
