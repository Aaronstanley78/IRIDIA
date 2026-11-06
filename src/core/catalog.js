'use strict';
/*
 * IRIDIA — output format catalog.
 * Every audio encoder shipped in FFmpeg 9.0.2 (gyan.dev full build) is represented,
 * plus native DSD (DSF / DFF) encoding implemented by IRIDIA itself.
 *
 * Preset fields
 *   id, name, group, desc
 *   codec      ffmpeg encoder name (or 'dsd' for the built-in DSD engine)
 *   fmt        ffmpeg muxer (-f)
 *   ext        file extension
 *   maxCh      maximum channels the encoder/container accepts
 *   chOptions  explicit list of allowed channel counts (optional)
 *   rates      allowed output sample rates (null = any of the standard list)
 *   args       extra output args always applied
 *   opts       user options: [{key,label,values:[{label,args,set?}],def}]
 *              a value may carry `set` to override preset fields (codec, ext, fmt, maxCh, rates)
 *   experimental  needs -strict -2
 *   lossless   true for lossless/uncompressed
 *   cover      embeds cover art
 */

const STD_RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000];
const CD_RATE = 44100;

const br = (list, def, flag = '-b:a') => ({
  key: 'bitrate', label: 'Bitrate',
  values: list.map(k => ({ label: `${k} kbps`, args: [flag, `${k}k`] })),
  def: list.indexOf(def)
});

const P = [];
function add(p) {
  p.args = p.args || [];
  p.opts = p.opts || [];
  p.maxCh = p.maxCh || 8;
  p.rates = p.rates || null;
  P.push(p);
}

/* ---------------------------------------------------------------- LOSSLESS */
add({ id: 'flac', name: 'FLAC', group: 'Lossless', codec: 'flac', fmt: 'flac', ext: 'flac', lossless: true, cover: true,
  desc: 'Free Lossless Audio Codec — the archival standard.',
  opts: [
    { key: 'level', label: 'Compression', values: [0, 2, 5, 8, 12].map(l => ({ label: `Level ${l}${l === 5 ? ' (default)' : l === 8 ? ' (best)' : l === 12 ? ' (extreme)' : ''}`, args: ['-compression_level', String(l)] })), def: 3 },
    { key: 'depth', label: 'Bit depth', values: [
      { label: '16-bit (CD native)', args: ['-sample_fmt', 's16'] },
      { label: '24-bit', args: ['-sample_fmt', 's32', '-bits_per_raw_sample', '24'] }], def: 0 }
  ] });
add({ id: 'flac_ogg', name: 'FLAC in Ogg', group: 'Lossless', codec: 'flac', fmt: 'ogg', ext: 'oga', lossless: true,
  desc: 'FLAC stream inside an Ogg container.', opts: [
    { key: 'level', label: 'Compression', values: [0, 5, 8].map(l => ({ label: `Level ${l}`, args: ['-compression_level', String(l)] })), def: 1 }] });
add({ id: 'alac', name: 'ALAC (Apple Lossless)', group: 'Lossless', codec: 'alac', fmt: 'ipod', ext: 'm4a', lossless: true, cover: true,
  desc: 'Apple Lossless in M4A — perfect for Apple Music / iTunes.', opts: [
    { key: 'depth', label: 'Bit depth', values: [
      { label: '16-bit', args: ['-sample_fmt', 's16p'] },
      { label: '24-bit', args: ['-sample_fmt', 's32p'] }], def: 0 }] });
add({ id: 'alac_caf', name: 'ALAC in CAF', group: 'Lossless', codec: 'alac', fmt: 'caf', ext: 'caf', lossless: true,
  desc: 'Apple Lossless inside a Core Audio Format file.' });
add({ id: 'wavpack', name: 'WavPack', group: 'Lossless', codec: 'wavpack', fmt: 'wv', ext: 'wv', lossless: true,
  desc: 'Hybrid lossless codec with excellent compression.', opts: [
    { key: 'level', label: 'Compression', values: [0, 1, 3, 5, 8].map(l => ({ label: `Level ${l}`, args: ['-compression_level', String(l)] })), def: 2 }] });
add({ id: 'tta', name: 'TTA (True Audio)', group: 'Lossless', codec: 'tta', fmt: 'tta', ext: 'tta', lossless: true,
  desc: 'Simple, fast real-time lossless codec.' });
add({ id: 'tta_mka', name: 'TTA in Matroska', group: 'Lossless', codec: 'tta', fmt: 'matroska', ext: 'mka', lossless: true, desc: 'True Audio inside MKA.' });
add({ id: 'mlp', name: 'MLP (Meridian Lossless)', group: 'Lossless', codec: 'mlp', fmt: 'mlp', ext: 'mlp', lossless: true, experimental: true,
  maxCh: 6, rates: [44100, 48000, 88200, 96000, 176400, 192000],
  desc: 'Meridian Lossless Packing — DVD-Audio lossless.' });
add({ id: 'truehd', name: 'Dolby TrueHD', group: 'Lossless', codec: 'truehd', fmt: 'truehd', ext: 'thd', lossless: true, experimental: true,
  maxCh: 6, rates: [44100, 48000, 88200, 96000, 176400, 192000],
  desc: 'Dolby TrueHD lossless (Blu-ray style).' });
add({ id: 'truehd_mka', name: 'Dolby TrueHD in Matroska', group: 'Lossless', codec: 'truehd', fmt: 'matroska', ext: 'mka', lossless: true, experimental: true,
  maxCh: 6, rates: [44100, 48000, 88200, 96000, 176400, 192000], desc: 'TrueHD stream in MKA.' });
add({ id: 'flac_mka', name: 'FLAC in Matroska', group: 'Lossless', codec: 'flac', fmt: 'matroska', ext: 'mka', lossless: true, cover: false, desc: 'FLAC inside MKA.' });
add({ id: 'flac_mp4', name: 'FLAC in MP4', group: 'Lossless', codec: 'flac', fmt: 'mp4', ext: 'mp4', lossless: true, desc: 'FLAC inside ISO-BMFF / MP4.' });
add({ id: 'flac_iamf', name: 'IAMF (FLAC)', group: 'Lossless', codec: 'flac', fmt: 'iamf', ext: 'iamf', lossless: true, maxCh: 8, layouts: ['mono', 'stereo', '5.1', '7.1'],
  desc: 'Immersive Audio Model & Formats with FLAC substreams.' });

/* ------------------------------------------------------------------- DSD */
const dsdRate = { key: 'dsdrate', label: 'DSD rate', values: [
  { label: 'DSD64 (2.8224 MHz)', args: [], set: { dsdMul: 64 } },
  { label: 'DSD128 (5.6448 MHz)', args: [], set: { dsdMul: 128 } },
  { label: 'DSD256 (11.2896 MHz)', args: [], set: { dsdMul: 256 } },
  { label: 'DSD512 (22.5792 MHz)', args: [], set: { dsdMul: 512 } }], def: 0 };
const dsdOrder = { key: 'order', label: 'Modulator', values: [
  { label: '5th-order (balanced)', args: [], set: { dsdOrder: 5 } },
  { label: '7th-order (lowest noise)', args: [], set: { dsdOrder: 7 } }], def: 1 };
add({ id: 'dsf', name: 'DSF (DSD Stream File)', group: 'DSD', codec: 'dsd', fmt: 'dsf', ext: 'dsf', lossless: false, maxCh: 6, layouts: ['mono', 'stereo', '3.0', 'quad', '5.0', '5.1'], ffLayout: { '5.0': '5.0', '5.1': '5.1' }, dsdMul: 64, dsdOrder: 7,
  desc: 'Sony DSD Stream File — 1-bit Direct Stream Digital with ID3 tags. Max 5.1 by specification.', opts: [dsdRate, dsdOrder] });
add({ id: 'dff', name: 'DFF (DSDIFF)', group: 'DSD', codec: 'dsd', fmt: 'dff', ext: 'dff', lossless: false, maxCh: 8, dsdMul: 64, dsdOrder: 7,
  desc: 'Philips DSD Interchange File Format — 1-bit DSD up to 7.1.', opts: [dsdRate, dsdOrder] });

/* ------------------------------------------------------------ UNCOMPRESSED */
const wavDepth = (fmtName) => ({ key: 'depth', label: 'Sample format', values: [
  { label: '8-bit unsigned', args: [], set: { codec: 'pcm_u8' } },
  { label: '16-bit (CD native)', args: [], set: { codec: 'pcm_s16le' } },
  { label: '24-bit', args: [], set: { codec: 'pcm_s24le' } },
  { label: '32-bit integer', args: [], set: { codec: 'pcm_s32le' } },
  { label: '32-bit float', args: [], set: { codec: 'pcm_f32le' } },
  { label: '64-bit float', args: [], set: { codec: 'pcm_f64le' } }], def: 1 });
add({ id: 'wav', name: 'WAV', group: 'Uncompressed', codec: 'pcm_s16le', fmt: 'wav', ext: 'wav', lossless: true,
  desc: 'Microsoft RIFF WAVE (WAVE_FORMAT_EXTENSIBLE for surround).', opts: [wavDepth()] });
add({ id: 'rf64', name: 'RF64 / BWF-64', group: 'Uncompressed', codec: 'pcm_s24le', fmt: 'wav', ext: 'wav', lossless: true, args: ['-rf64', 'always'],
  desc: 'EBU RF64 — WAV without the 4 GB limit.', opts: [wavDepth()] });
add({ id: 'w64', name: 'Wave64 (Sony W64)', group: 'Uncompressed', codec: 'pcm_s24le', fmt: 'w64', ext: 'w64', lossless: true,
  desc: 'Sony Wave64 — 64-bit RIFF.', opts: [wavDepth()] });
add({ id: 'aiff', name: 'AIFF', group: 'Uncompressed', codec: 'pcm_s16be', fmt: 'aiff', ext: 'aiff', lossless: true, cover: false,
  desc: 'Apple Audio Interchange File Format.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '8-bit', args: [], set: { codec: 'pcm_s8' } },
      { label: '16-bit (CD native)', args: [], set: { codec: 'pcm_s16be' } },
      { label: '24-bit', args: [], set: { codec: 'pcm_s24be' } },
      { label: '32-bit integer', args: [], set: { codec: 'pcm_s32be' } },
      { label: '32-bit float (AIFF-C)', args: [], set: { codec: 'pcm_f32be', ext: 'aifc' } },
      { label: '64-bit float (AIFF-C)', args: [], set: { codec: 'pcm_f64be', ext: 'aifc' } }], def: 1 }] });
add({ id: 'caf_pcm', name: 'CAF (PCM)', group: 'Uncompressed', codec: 'pcm_s24le', fmt: 'caf', ext: 'caf', lossless: true,
  desc: 'Apple Core Audio Format, uncompressed.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit LE', args: [], set: { codec: 'pcm_s16le' } }, { label: '16-bit BE', args: [], set: { codec: 'pcm_s16be' } },
      { label: '24-bit LE', args: [], set: { codec: 'pcm_s24le' } }, { label: '24-bit BE', args: [], set: { codec: 'pcm_s24be' } },
      { label: '32-bit LE', args: [], set: { codec: 'pcm_s32le' } }, { label: '32-bit float LE', args: [], set: { codec: 'pcm_f32le' } },
      { label: '64-bit float LE', args: [], set: { codec: 'pcm_f64le' } }], def: 2 }] });
add({ id: 'au', name: 'Sun AU / SND', group: 'Uncompressed', codec: 'pcm_s16be', fmt: 'au', ext: 'au', lossless: true,
  desc: 'Sun Microsystems / NeXT audio.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '8-bit', args: [], set: { codec: 'pcm_s8' } }, { label: '16-bit', args: [], set: { codec: 'pcm_s16be' } },
      { label: '24-bit', args: [], set: { codec: 'pcm_s24be' } }, { label: '32-bit', args: [], set: { codec: 'pcm_s32be' } },
      { label: '32-bit float', args: [], set: { codec: 'pcm_f32be' } }, { label: '64-bit float', args: [], set: { codec: 'pcm_f64be' } }], def: 1 }] });
add({ id: 'pcm_mka', name: 'Matroska Audio (PCM)', group: 'Uncompressed', codec: 'pcm_s24le', fmt: 'matroska', ext: 'mka', lossless: true,
  desc: 'Uncompressed PCM in MKA.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit', args: [], set: { codec: 'pcm_s16le' } }, { label: '24-bit', args: [], set: { codec: 'pcm_s24le' } },
      { label: '32-bit', args: [], set: { codec: 'pcm_s32le' } }, { label: '32-bit float', args: [], set: { codec: 'pcm_f32le' } },
      { label: '64-bit float', args: [], set: { codec: 'pcm_f64le' } }], def: 1 }] });
add({ id: 'pcm_mov', name: 'QuickTime MOV (PCM)', group: 'Uncompressed', codec: 'pcm_s24le', fmt: 'mov', ext: 'mov', lossless: true,
  desc: 'Uncompressed PCM in a QuickTime movie.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit LE', args: [], set: { codec: 'pcm_s16le' } }, { label: '16-bit BE', args: [], set: { codec: 'pcm_s16be' } },
      { label: '24-bit LE', args: [], set: { codec: 'pcm_s24le' } }, { label: '32-bit LE', args: [], set: { codec: 'pcm_s32le' } },
      { label: '32-bit float', args: [], set: { codec: 'pcm_f32le' } }, { label: '64-bit float', args: [], set: { codec: 'pcm_f64le' } }], def: 2 }] });
add({ id: 'pcm_mp4', name: 'MP4 (PCM / ipcm)', group: 'Uncompressed', codec: 'pcm_s24le', fmt: 'mp4', ext: 'mp4', lossless: true,
  desc: 'ISO/IEC 23003-5 uncompressed audio in MP4.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit', args: [], set: { codec: 'pcm_s16le' } }, { label: '24-bit', args: [], set: { codec: 'pcm_s24le' } },
      { label: '32-bit', args: [], set: { codec: 'pcm_s32le' } }, { label: '32-bit float', args: [], set: { codec: 'pcm_f32le' } }], def: 1 }] });
add({ id: 'pcm_nut', name: 'NUT (PCM)', group: 'Uncompressed', codec: 'pcm_s16le', fmt: 'nut', ext: 'nut', lossless: true, desc: 'FFmpeg NUT container, PCM.' });
add({ id: 'pcm_avi', name: 'AVI (PCM audio-only)', group: 'Uncompressed', codec: 'pcm_s16le', fmt: 'avi', ext: 'avi', lossless: true, desc: 'Audio-only AVI with PCM.' });
add({ id: 'pcm_mxf', name: 'MXF OP-Atom (PCM)', group: 'Uncompressed', codec: 'pcm_s24le', fmt: 'mxf_opatom', ext: 'mxf', lossless: true, rates: [48000], chOptions: [1],
  desc: 'Material eXchange Format (broadcast), 48 kHz.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit', args: [], set: { codec: 'pcm_s16le' } }, { label: '24-bit', args: [], set: { codec: 'pcm_s24le' } }], def: 1 }] });
add({ id: 'sox', name: 'SoX native', group: 'Uncompressed', codec: 'pcm_s32le', fmt: 'sox', ext: 'sox', lossless: true, desc: 'Sound eXchange native format (32-bit).' });
add({ id: 'ircam', name: 'IRCAM / BICSF', group: 'Uncompressed', codec: 'pcm_s16le', fmt: 'ircam', ext: 'sf', lossless: true,
  desc: 'Berkeley/IRCAM/CARL Sound File.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit LE', args: [], set: { codec: 'pcm_s16le' } },
      { label: '32-bit LE', args: [], set: { codec: 'pcm_s32le' } }, { label: '32-bit float LE', args: [], set: { codec: 'pcm_f32le' } },
      { label: '64-bit float LE', args: [], set: { codec: 'pcm_f64le' } }, { label: 'A-law', args: [], set: { codec: 'pcm_alaw' } },
      { label: 'µ-law', args: [], set: { codec: 'pcm_mulaw' } }], def: 0 }] });
add({ id: 'voc', name: 'Creative Voice (VOC)', group: 'Uncompressed', codec: 'pcm_u8', fmt: 'voc', ext: 'voc', maxCh: 2,
  desc: 'Sound Blaster VOC.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '8-bit unsigned', args: [], set: { codec: 'pcm_u8' } }, { label: '16-bit', args: [], set: { codec: 'pcm_s16le' } }], def: 1 }] });
add({ id: 'w64_float', name: 'Wave64 32-bit float', group: 'Uncompressed', codec: 'pcm_f32le', fmt: 'w64', ext: 'w64', lossless: true, desc: 'Sony Wave64, float.' });
add({ id: 'daud', name: 'D-Cinema audio (302)', group: 'Uncompressed', codec: 'pcm_s24daud', fmt: 'daud', ext: '302', rates: [96000], chOptions: [6],
  desc: 'SMPTE 302M-style D-Cinema 24-bit audio, 96 kHz 6ch.' });
add({ id: 's302m', name: 'SMPTE 302M (MPEG-TS)', group: 'Uncompressed', codec: 's302m', fmt: 'mpegts', ext: 'ts', rates: [48000], experimental: true, chOptions: [2, 4, 6],
  postFilters: ['asetnsamples=n=1920:p=1'], args: ['-sample_fmt', 's32'], desc: 'AES3 24-bit PCM in MPEG transport stream (broadcast).' });
add({ id: 'pcm_dvd', name: 'DVD LPCM (VOB)', group: 'Uncompressed', codec: 'pcm_dvd', fmt: 'vob', ext: 'vob', rates: [48000, 96000],
  desc: 'DVD-Video linear PCM in a VOB program stream.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit', args: ['-sample_fmt', 's16'] }, { label: '24-bit', args: ['-sample_fmt', 's32'] }], def: 0 }] });
add({ id: 'pcm_bluray', name: 'Blu-ray LPCM (M2TS)', group: 'Uncompressed', codec: 'pcm_bluray', fmt: 'mpegts', ext: 'm2ts', rates: [48000, 96000, 192000],
  args: ['-mpegts_m2ts_mode', '1'], desc: 'Blu-ray linear PCM in BDAV M2TS.', opts: [
    { key: 'depth', label: 'Sample format', values: [
      { label: '16-bit', args: ['-sample_fmt', 's16'] }, { label: '24-bit', args: ['-sample_fmt', 's32'] }], def: 1 }] });
add({ id: 'ast', name: 'Nintendo AST', group: 'Uncompressed', codec: 'pcm_s16be_planar', fmt: 'ast', ext: 'ast', desc: 'Nintendo GameCube/Wii AST stream.' });
add({ id: 'vidc', name: 'Archimedes VIDC', group: 'Uncompressed', codec: 'pcm_vidc', fmt: 'vidc', ext: 'vidc', desc: 'Acorn Archimedes VIDC logarithmic PCM (raw).' });
add({ id: 'rso', name: 'Lego Mindstorms RSO', group: 'Uncompressed', codec: 'pcm_u8', fmt: 'rso', ext: 'rso', chOptions: [1], rates: [8000, 11025, 16000, 22050], desc: 'Lego Mindstorms NXT sound (8-bit mono).' });

/* Raw PCM — every pcm_* encoder */
const RAW = [
  ['s8', 'pcm_s8', 's8', 'Signed 8-bit'], ['u8', 'pcm_u8', 'u8', 'Unsigned 8-bit'],
  ['s16le', 'pcm_s16le', 's16le', 'Signed 16-bit LE'], ['s16be', 'pcm_s16be', 's16be', 'Signed 16-bit BE'],
  ['u16le', 'pcm_u16le', 'u16le', 'Unsigned 16-bit LE'], ['u16be', 'pcm_u16be', 'u16be', 'Unsigned 16-bit BE'],
  ['s24le', 'pcm_s24le', 's24le', 'Signed 24-bit LE'], ['s24be', 'pcm_s24be', 's24be', 'Signed 24-bit BE'],
  ['u24le', 'pcm_u24le', 'u24le', 'Unsigned 24-bit LE'], ['u24be', 'pcm_u24be', 'u24be', 'Unsigned 24-bit BE'],
  ['s32le', 'pcm_s32le', 's32le', 'Signed 32-bit LE'], ['s32be', 'pcm_s32be', 's32be', 'Signed 32-bit BE'],
  ['u32le', 'pcm_u32le', 'u32le', 'Unsigned 32-bit LE'], ['u32be', 'pcm_u32be', 'u32be', 'Unsigned 32-bit BE'],
  ['f32le', 'pcm_f32le', 'f32le', 'Float 32-bit LE'], ['f32be', 'pcm_f32be', 'f32be', 'Float 32-bit BE'],
  ['f64le', 'pcm_f64le', 'f64le', 'Float 64-bit LE'], ['f64be', 'pcm_f64be', 'f64be', 'Float 64-bit BE'],
  ['s64le', 'pcm_s64le', 'nut', 'Signed 64-bit LE (NUT)'], ['s64be', 'pcm_s64be', 'nut', 'Signed 64-bit BE (NUT)'],
  ['s8p', 'pcm_s8_planar', 'nut', 'Signed 8-bit planar (NUT)'], ['s16lep', 'pcm_s16le_planar', 'nut', 'Signed 16-bit LE planar (NUT)'],
  ['s16bep', 'pcm_s16be_planar', 'nut', 'Signed 16-bit BE planar (NUT)'], ['s24lep', 'pcm_s24le_planar', 'nut', 'Signed 24-bit LE planar (NUT)'],
  ['s32lep', 'pcm_s32le_planar', 'nut', 'Signed 32-bit LE planar (NUT)']
];
for (const [id, codec, fmt, label] of RAW) {
  add({ id: 'raw_' + id, name: `Raw PCM — ${label}`, group: 'Raw PCM', codec, fmt, ext: fmt === 'nut' ? 'nut' : 'pcm', lossless: true,
    desc: `Headerless ${label} PCM stream (${codec}).` });
}

/* -------------------------------------------------------------------- LOSSY */
add({ id: 'mp3', name: 'MP3 (LAME)', group: 'Lossy', codec: 'libmp3lame', fmt: 'mp3', ext: 'mp3', maxCh: 2, cover: true,
  rates: [8000, 11025, 16000, 22050, 32000, 44100, 48000], args: ['-id3v2_version', '3'],
  desc: 'The universal MP3, encoded with LAME.', opts: [
    { key: 'mode', label: 'Quality', values: [
      { label: 'VBR V0 (~245 kbps, transparent)', args: ['-q:a', '0'] }, { label: 'VBR V2 (~190 kbps)', args: ['-q:a', '2'] },
      { label: 'VBR V4 (~165 kbps)', args: ['-q:a', '4'] }, { label: 'VBR V6 (~115 kbps)', args: ['-q:a', '6'] },
      ...[320, 256, 192, 160, 128, 96, 64].map(k => ({ label: `CBR ${k} kbps`, args: ['-b:a', `${k}k`] })),
      { label: 'ABR 224 kbps', args: ['-b:a', '224k', '-abr', '1'] }], def: 0 }] });
add({ id: 'mp3_shine', name: 'MP3 (Shine fixed-point)', group: 'Lossy', codec: 'libshine', fmt: 'mp3', ext: 'mp3', maxCh: 2,
  rates: [32000, 44100, 48000], desc: 'MP3 via the Shine fixed-point encoder.', opts: [br([320, 256, 192, 160, 128], 192)] });
add({ id: 'mp3_mf', name: 'MP3 (Media Foundation)', group: 'Lossy', codec: 'mp3_mf', fmt: 'mp3', ext: 'mp3', maxCh: 2, windowsOnly: true,
  rates: [32000, 44100, 48000], desc: 'MP3 via the Windows Media Foundation encoder.', opts: [br([320, 256, 192, 160, 128], 320)] });
add({ id: 'aac', name: 'AAC-LC (M4A)', group: 'Lossy', codec: 'aac', fmt: 'ipod', ext: 'm4a', cover: true, args: ['-movflags', '+faststart'],
  rates: [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000],
  desc: 'FFmpeg native AAC encoder in M4A — Apple / Android friendly.', opts: [
    { key: 'mode', label: 'Quality', values: [
      ...[512, 384, 320, 256, 192, 160, 128, 96].map(k => ({ label: `CBR ${k} kbps`, args: ['-b:a', `${k}k`] })),
      { label: 'VBR q2 (high)', args: ['-q:a', '2'] }, { label: 'VBR q1', args: ['-q:a', '1'] }], def: 3 }] });
add({ id: 'aac_adts', name: 'AAC (raw ADTS)', group: 'Lossy', codec: 'aac', fmt: 'adts', ext: 'aac', maxCh: 6,
  rates: [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000], desc: 'AAC in ADTS stream.', opts: [br([512, 384, 320, 256, 192, 128], 256)] });
add({ id: 'aac_latm', name: 'AAC (LATM/LOAS)', group: 'Lossy', codec: 'aac', fmt: 'latm', ext: 'latm',
  rates: [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000], desc: 'AAC in LATM/LOAS (DVB broadcast).', opts: [br([384, 256, 192, 128], 256)] });
add({ id: 'aac_mf', name: 'AAC (Media Foundation)', group: 'Lossy', codec: 'aac_mf', fmt: 'ipod', ext: 'm4a', chOptions: [1, 2, 6], windowsOnly: true,
  rates: [44100, 48000], desc: 'AAC via Windows Media Foundation.', opts: [br([192, 160, 128, 96], 192)] });
add({ id: 'aac_3gp', name: 'AAC in 3GP', group: 'Lossy', codec: 'aac', fmt: '3gp', ext: '3gp', maxCh: 2, rates: [8000, 16000, 22050, 32000, 44100, 48000],
  desc: 'Mobile 3GPP container.', opts: [br([192, 128, 96, 64], 128)] });
add({ id: 'aac_3g2', name: 'AAC in 3G2', group: 'Lossy', codec: 'aac', fmt: '3g2', ext: '3g2', maxCh: 2, rates: [8000, 16000, 22050, 32000, 44100, 48000],
  desc: 'Mobile 3GPP2 container.', opts: [br([192, 128, 96, 64], 128)] });
add({ id: 'aac_m4b', name: 'AAC Audiobook (M4B)', group: 'Lossy', codec: 'aac', fmt: 'ipod', ext: 'm4b', cover: true,
  rates: [22050, 32000, 44100, 48000], desc: 'Audiobook M4B.', opts: [br([192, 128, 96, 64], 96)] });
add({ id: 'opus', name: 'Opus', group: 'Lossy', codec: 'libopus', fmt: 'opus', ext: 'opus', rates: [48000], cover: false, layouts: ['mono', 'stereo', '3.0', 'quad', '5.0', '5.1', '6.1', '7.1'], ffLayout: { '5.0': '5.0', '5.1': '5.1' }, 
  args: ['-mapping_family', '1'], desc: 'State-of-the-art lossy codec (libopus), up to 7.1.', opts: [
    { key: 'mode', label: 'Bitrate (per stream set)', values: [512, 384, 320, 256, 192, 160, 128, 96, 64].map(k => ({ label: `VBR ${k} kbps`, args: ['-b:a', `${k}k`, '-vbr', 'on'] })), def: 3 },
    { key: 'app', label: 'Application', values: [
      { label: 'Audio (music)', args: ['-application', 'audio'] }, { label: 'Low delay', args: ['-application', 'lowdelay'] }, { label: 'VoIP', args: ['-application', 'voip'] }], def: 0 }] });
add({ id: 'opus_native', name: 'Opus (FFmpeg native)', group: 'Lossy', codec: 'opus', fmt: 'opus', ext: 'opus', rates: [48000], maxCh: 2, experimental: true,
  desc: 'FFmpeg built-in experimental Opus encoder.', opts: [br([256, 192, 128, 96], 192)] });
add({ id: 'opus_mka', name: 'Opus in Matroska/WebM', group: 'Lossy', codec: 'libopus', fmt: 'webm', ext: 'webm', rates: [48000], layouts: ['mono', 'stereo', '3.0', 'quad', '5.0', '5.1', '6.1', '7.1'], ffLayout: { '5.0': '5.0', '5.1': '5.1' },  args: ['-mapping_family', '1'],
  desc: 'Opus inside WebM (Matroska).', opts: [br([512, 320, 256, 192, 128], 256)] });
add({ id: 'opus_iamf', name: 'IAMF (Opus)', group: 'Lossy', codec: 'libopus', fmt: 'iamf', ext: 'iamf', rates: [48000], layouts: ['mono', 'stereo', '5.1', '7.1'],
  desc: 'Immersive Audio Model & Formats with Opus substreams.', opts: [br([256, 192, 128], 192)] });
add({ id: 'vorbis', name: 'Ogg Vorbis', group: 'Lossy', codec: 'libvorbis', fmt: 'ogg', ext: 'ogg', cover: false,
  desc: 'Open, royalty-free lossy codec (libvorbis).', opts: [
    { key: 'q', label: 'Quality', values: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(q => ({ label: `q${q}${q === 6 ? ' (~192 kbps)' : q === 10 ? ' (~500 kbps)' : ''}`, args: ['-q:a', String(q)] })), def: 4 }] });
add({ id: 'vorbis_native', name: 'Ogg Vorbis (FFmpeg native)', group: 'Lossy', codec: 'vorbis', fmt: 'ogg', ext: 'ogg', chOptions: [2], experimental: true,
  desc: 'FFmpeg built-in experimental Vorbis encoder.', opts: [br([320, 256, 192, 128], 256)] });
add({ id: 'vorbis_webm', name: 'Vorbis in WebM', group: 'Lossy', codec: 'libvorbis', fmt: 'webm', ext: 'webm', desc: 'Vorbis inside WebM.', opts: [
    { key: 'q', label: 'Quality', values: [8, 6, 4].map(q => ({ label: `q${q}`, args: ['-q:a', String(q)] })), def: 1 }] });
add({ id: 'ac3', name: 'Dolby Digital (AC-3)', group: 'Lossy', codec: 'ac3', fmt: 'ac3', ext: 'ac3', maxCh: 6, rates: [32000, 44100, 48000],
  desc: 'Dolby Digital — DVD / broadcast surround up to 5.1.', opts: [br([640, 448, 384, 320, 256, 192], 640)] });
add({ id: 'ac3_fixed', name: 'Dolby Digital (AC-3 fixed-point)', group: 'Lossy', codec: 'ac3_fixed', fmt: 'ac3', ext: 'ac3', maxCh: 6, rates: [32000, 44100, 48000],
  desc: 'AC-3 via the fixed-point encoder.', opts: [br([640, 448, 384, 256], 448)] });
add({ id: 'ac3_mf', name: 'Dolby Digital (Media Foundation)', group: 'Lossy', codec: 'ac3_mf', fmt: 'ac3', ext: 'ac3', chOptions: [2, 6], windowsOnly: true, rates: [48000],
  desc: 'AC-3 via Windows Media Foundation.', opts: [br([640, 448, 384, 192], 448)] });
add({ id: 'ac3_spdif', name: 'AC-3 S/PDIF passthrough WAV', group: 'Lossy', codec: 'ac3', fmt: 'spdif', ext: 'wav', maxCh: 6, rates: [48000],
  desc: 'IEC 61937 AC-3 bitstream for S/PDIF/HDMI (DTS-WAV style).', opts: [br([640, 448], 640)] });
add({ id: 'eac3', name: 'Dolby Digital Plus (E-AC-3)', group: 'Lossy', codec: 'eac3', fmt: 'eac3', ext: 'eac3', maxCh: 6, rates: [32000, 44100, 48000],
  desc: 'Enhanced AC-3 (DD+).', opts: [br([1536, 1024, 768, 640, 448, 384, 256], 768)] });
add({ id: 'ac3_mka', name: 'AC-3 in Matroska', group: 'Lossy', codec: 'ac3', fmt: 'matroska', ext: 'mka', maxCh: 6, rates: [32000, 44100, 48000], desc: 'AC-3 in MKA.', opts: [br([640, 448], 640)] });
add({ id: 'dts', name: 'DTS Coherent Acoustics', group: 'Lossy', codec: 'dca', fmt: 'dts', ext: 'dts', maxCh: 6, rates: [44100, 48000], experimental: true,
  desc: 'DTS core (experimental FFmpeg encoder), up to 5.1.', opts: [br([1509, 1411, 1152, 768], 1509)] });
add({ id: 'dts_spdif', name: 'DTS S/PDIF WAV (DTS-CD)', group: 'Lossy', codec: 'dca', fmt: 'spdif', ext: 'wav', maxCh: 6, rates: [44100, 48000], experimental: true,
  desc: 'DTS bitstream in IEC 61937 WAV — the classic "DTS-CD" format.', opts: [br([1411, 1152, 768], 1411)] });
add({ id: 'mp2', name: 'MPEG-1 Layer II (MP2)', group: 'Lossy', codec: 'mp2', fmt: 'mp2', ext: 'mp2', maxCh: 2, rates: [16000, 22050, 24000, 32000, 44100, 48000],
  desc: 'MPEG Audio Layer 2 (broadcast/DAB/VCD).', opts: [br([384, 320, 256, 224, 192, 128], 384)] });
add({ id: 'mp2_fixed', name: 'MP2 (fixed-point)', group: 'Lossy', codec: 'mp2fixed', fmt: 'mp2', ext: 'mp2', maxCh: 2, rates: [16000, 22050, 24000, 32000, 44100, 48000],
  desc: 'MP2 via the fixed-point encoder.', opts: [br([384, 256, 192], 256)] });
add({ id: 'mp2_twolame', name: 'MP2 (TwoLAME)', group: 'Lossy', codec: 'libtwolame', fmt: 'mp2', ext: 'mp2', chOptions: [2], rates: [16000, 22050, 24000, 32000, 44100, 48000],
  desc: 'MP2 via TwoLAME, the reference quality encoder.', opts: [br([384, 320, 256, 192, 128], 384)] });
add({ id: 'wma2', name: 'Windows Media Audio 2', group: 'Lossy', codec: 'wmav2', fmt: 'asf', ext: 'wma', maxCh: 2, rates: [8000, 11025, 16000, 22050, 32000, 44100, 48000],
  desc: 'WMA v2 in ASF.', opts: [br([192, 160, 128, 96, 64], 192)] });
add({ id: 'wma1', name: 'Windows Media Audio 1', group: 'Lossy', codec: 'wmav1', fmt: 'asf', ext: 'wma', maxCh: 2, rates: [8000, 11025, 16000, 22050, 32000, 44100, 48000],
  desc: 'WMA v1 in ASF.', opts: [br([192, 128, 96, 64], 128)] });
add({ id: 'lc3', name: 'LC3 (Bluetooth LE Audio)', group: 'Lossy', codec: 'liblc3', fmt: 'lc3', ext: 'lc3', maxCh: 2, rates: [8000, 16000, 24000, 32000, 48000],
  desc: 'Low Complexity Communication Codec — Bluetooth LE Audio.', opts: [br([320, 256, 192, 160, 128, 96], 192)] });
add({ id: 'aptx', name: 'aptX', group: 'Lossy', codec: 'aptx', fmt: 'aptx', ext: 'aptx', chOptions: [2], rates: [8000, 16000, 24000, 32000, 44100, 48000],
  desc: 'Qualcomm aptX Bluetooth codec (raw).' });
add({ id: 'aptx_hd', name: 'aptX HD', group: 'Lossy', codec: 'aptx_hd', fmt: 'aptx_hd', ext: 'aptxhd', chOptions: [2], rates: [8000, 16000, 24000, 32000, 44100, 48000],
  desc: 'Qualcomm aptX HD 24-bit Bluetooth codec (raw).' });
add({ id: 'sbc', name: 'SBC (Bluetooth A2DP)', group: 'Lossy', codec: 'sbc', fmt: 'sbc', ext: 'sbc', maxCh: 2, rates: [16000, 32000, 44100, 48000],
  desc: 'Low-complexity Subband Codec — Bluetooth A2DP.', opts: [br([345, 328, 229, 128], 328)] });
add({ id: 'nellymoser', name: 'Nellymoser Asao (FLV)', group: 'Lossy', codec: 'nellymoser', fmt: 'flv', ext: 'flv', chOptions: [1], rates: [8000, 11025, 16000, 22050, 44100],
  desc: 'Flash-era Nellymoser codec in FLV.' });
add({ id: 'real144', name: 'RealAudio 1.0 (14.4K)', group: 'Lossy', codec: 'real_144', fmt: 'rm', ext: 'ra', chOptions: [1], rates: [8000],
  desc: 'RealAudio 14.4 in RealMedia.' });
add({ id: 'dfpwm', name: 'DFPWM (ComputerCraft)', group: 'Lossy', codec: 'dfpwm', fmt: 'dfpwm', ext: 'dfpwm', chOptions: [1], rates: [48000],
  desc: 'Dynamic Filter Pulse Width Modulation (1-bit, Minecraft ComputerCraft).' });
add({ id: 'mp3_mka', name: 'MP3 in Matroska', group: 'Lossy', codec: 'libmp3lame', fmt: 'matroska', ext: 'mka', maxCh: 2, rates: [32000, 44100, 48000], desc: 'MP3 inside MKA.', opts: [br([320, 256, 192], 320)] });
add({ id: 'aac_mka', name: 'AAC in Matroska', group: 'Lossy', codec: 'aac', fmt: 'matroska', ext: 'mka', desc: 'AAC inside MKA.', opts: [br([512, 384, 256, 192], 384)] });
add({ id: 'mp3_wav', name: 'MP3 in WAV', group: 'Lossy', codec: 'libmp3lame', fmt: 'wav', ext: 'wav', maxCh: 2, rates: [32000, 44100, 48000], desc: 'MPEG Layer 3 wrapped in RIFF WAVE.', opts: [br([320, 192, 128], 320)] });
add({ id: 'mmf_yamaha', name: 'Yamaha SMAF (MMF)', group: 'Lossy', codec: 'adpcm_yamaha', fmt: 'mmf', ext: 'mmf', chOptions: [1], rates: [4000, 8000, 11025, 16000, 22050],
  desc: 'Yamaha Synthetic music Mobile Application Format (ringtones).' });

/* -------------------------------------------------- SPEECH / TELEPHONY */
add({ id: 'amrnb', name: 'AMR-NB', group: 'Speech & Telephony', codec: 'libopencore_amrnb', fmt: 'amr', ext: 'amr', chOptions: [1], rates: [8000],
  desc: 'Adaptive Multi-Rate Narrow-Band (GSM voice).', opts: [
    { key: 'bitrate', label: 'Mode', values: ['4.75', '5.15', '5.9', '6.7', '7.4', '7.95', '10.2', '12.2'].map(k => ({ label: `${k} kbps`, args: ['-b:a', `${Math.round(parseFloat(k) * 1000)}`] })), def: 7 }] });
add({ id: 'amrwb', name: 'AMR-WB', group: 'Speech & Telephony', codec: 'libvo_amrwbenc', fmt: 'amr', ext: 'awb', chOptions: [1], rates: [16000],
  desc: 'Adaptive Multi-Rate Wide-Band (HD Voice).', opts: [
    { key: 'bitrate', label: 'Mode', values: ['6.6', '8.85', '12.65', '14.25', '15.85', '18.25', '19.85', '23.05', '23.85'].map(k => ({ label: `${k} kbps`, args: ['-b:a', `${Math.round(parseFloat(k) * 1000)}`] })), def: 8 }] });
add({ id: 'amr_3gp', name: 'AMR-NB in 3GP', group: 'Speech & Telephony', codec: 'libopencore_amrnb', fmt: '3gp', ext: '3gp', chOptions: [1], rates: [8000], args: ['-b:a', '12200'],
  desc: 'AMR inside a 3GPP file.' });
add({ id: 'alaw_wav', name: 'G.711 A-law (WAV)', group: 'Speech & Telephony', codec: 'pcm_alaw', fmt: 'wav', ext: 'wav', rates: [8000, 16000, 22050, 44100, 48000],
  desc: 'ITU-T G.711 A-law companded PCM.' });
add({ id: 'mulaw_wav', name: 'G.711 µ-law (WAV)', group: 'Speech & Telephony', codec: 'pcm_mulaw', fmt: 'wav', ext: 'wav', rates: [8000, 16000, 22050, 44100, 48000],
  desc: 'ITU-T G.711 µ-law companded PCM.' });
add({ id: 'alaw_raw', name: 'G.711 A-law (raw .al)', group: 'Speech & Telephony', codec: 'pcm_alaw', fmt: 'alaw', ext: 'al', desc: 'Headerless A-law.' });
add({ id: 'mulaw_raw', name: 'G.711 µ-law (raw .ul)', group: 'Speech & Telephony', codec: 'pcm_mulaw', fmt: 'mulaw', ext: 'ul', desc: 'Headerless µ-law.' });
add({ id: 'g722', name: 'G.722', group: 'Speech & Telephony', codec: 'g722', fmt: 'g722', ext: 'g722', chOptions: [1], rates: [16000],
  desc: 'ITU-T G.722 wideband ADPCM.' });
add({ id: 'g722_wav', name: 'G.722 (WAV)', group: 'Speech & Telephony', codec: 'g722', fmt: 'wav', ext: 'wav', chOptions: [1], rates: [16000], desc: 'G.722 in RIFF WAVE.' });
add({ id: 'g723_1', name: 'G.723.1', group: 'Speech & Telephony', codec: 'g723_1', fmt: 'g723_1', ext: 'tco', chOptions: [1], rates: [8000], args: ['-b:a', '6300'],
  desc: 'ITU-T G.723.1 dual-rate speech codec (6.3 kbps).' });
add({ id: 'g726', name: 'G.726', group: 'Speech & Telephony', codec: 'g726', fmt: 'g726', ext: 'g726', chOptions: [1], rates: [8000],
  desc: 'ITU-T G.726 ADPCM (big-endian packing).', opts: [br([40, 32, 24, 16], 32)] });
add({ id: 'g726le', name: 'G.726 LE', group: 'Speech & Telephony', codec: 'g726le', fmt: 'g726le', ext: 'g726', chOptions: [1], rates: [8000],
  desc: 'G.726 ADPCM, little-endian ("right-justified").', opts: [br([40, 32, 24, 16], 32)] });
add({ id: 'g726_wav', name: 'G.726 (WAV)', group: 'Speech & Telephony', codec: 'g726', fmt: 'wav', ext: 'wav', chOptions: [1], rates: [8000], desc: 'G.726 in RIFF WAVE.', opts: [br([40, 32, 24, 16], 32)] });
add({ id: 'gsm', name: 'GSM 06.10', group: 'Speech & Telephony', codec: 'libgsm', fmt: 'gsm', ext: 'gsm', chOptions: [1], rates: [8000],
  desc: 'GSM full-rate (raw).' });
add({ id: 'gsm_ms', name: 'GSM 06.10 (Microsoft WAV)', group: 'Speech & Telephony', codec: 'libgsm_ms', fmt: 'wav', ext: 'wav', chOptions: [1], rates: [8000],
  desc: 'GSM Microsoft variant in WAV.' });
add({ id: 'ilbc', name: 'iLBC', group: 'Speech & Telephony', codec: 'libilbc', fmt: 'ilbc', ext: 'lbc', chOptions: [1], rates: [8000],
  desc: 'Internet Low Bitrate Codec.', opts: [
    { key: 'mode', label: 'Frame', values: [{ label: '20 ms (15.2 kbps)', args: ['-mode', '20'] }, { label: '30 ms (13.33 kbps)', args: ['-mode', '30'] }], def: 0 }] });
add({ id: 'codec2', name: 'Codec 2', group: 'Speech & Telephony', codec: 'libcodec2', fmt: 'codec2', ext: 'c2', chOptions: [1], rates: [8000],
  desc: 'Open-source ultra-low-bitrate speech codec (HAM radio).', opts: [
    { key: 'mode', label: 'Mode', values: ['3200', '2400', '1600', '1400', '1300', '1200', '700C'].map(m => ({ label: `${m} bps`, args: ['-mode', m] })), def: 0 }] });
add({ id: 'codec2raw', name: 'Codec 2 (raw)', group: 'Speech & Telephony', codec: 'libcodec2', fmt: 'codec2raw', ext: 'c2raw', chOptions: [1], rates: [8000], args: ['-mode', '3200'],
  desc: 'Headerless Codec 2 bitstream (3200 bps).' });
add({ id: 'comfortnoise', name: 'RFC 3389 Comfort Noise (NUT)', group: 'Speech & Telephony', codec: 'comfortnoise', fmt: 'nut', ext: 'nut', chOptions: [1], rates: [8000],
  desc: 'VoIP comfort-noise parameters (spectral envelope only — not a music codec, included for completeness).' });
add({ id: 'speex', name: 'Speex', group: 'Speech & Telephony', codec: 'libspeex', fmt: 'spx', ext: 'spx', maxCh: 2, rates: [8000, 16000, 32000],
  desc: 'Xiph Speex speech codec in Ogg.', opts: [
    { key: 'q', label: 'Quality', values: [10, 8, 6, 4].map(q => ({ label: `q${q}`, args: ['-q:a', String(q)] })), def: 1 }] });

/* ----------------------------------------------- ADPCM / RETRO / GAMING */
add({ id: 'adpcm_ms', name: 'Microsoft ADPCM (WAV)', group: 'ADPCM & Retro', codec: 'adpcm_ms', fmt: 'wav', ext: 'wav', maxCh: 2, desc: 'Microsoft ADPCM in WAV.' });
add({ id: 'adpcm_ima_wav', name: 'IMA ADPCM (WAV)', group: 'ADPCM & Retro', codec: 'adpcm_ima_wav', fmt: 'wav', ext: 'wav', maxCh: 2, desc: 'IMA/DVI ADPCM in WAV.' });
add({ id: 'adpcm_ima_qt', name: 'IMA ADPCM QuickTime (AIFF-C)', group: 'ADPCM & Retro', codec: 'adpcm_ima_qt', fmt: 'aiff', ext: 'aifc', maxCh: 2, desc: 'Apple IMA4 in AIFF-C.' });
add({ id: 'adpcm_ima_qt_mov', name: 'IMA ADPCM QuickTime (MOV)', group: 'ADPCM & Retro', codec: 'adpcm_ima_qt', fmt: 'mov', ext: 'mov', maxCh: 2, desc: 'Apple IMA4 in QuickTime.' });
add({ id: 'adpcm_yamaha', name: 'Yamaha ADPCM (WAV)', group: 'ADPCM & Retro', codec: 'adpcm_yamaha', fmt: 'wav', ext: 'wav', maxCh: 2, desc: 'Yamaha ADPCM in WAV.' });
add({ id: 'adpcm_swf', name: 'Shockwave Flash ADPCM (FLV)', group: 'ADPCM & Retro', codec: 'adpcm_swf', fmt: 'flv', ext: 'flv', maxCh: 2, rates: [11025, 22050, 44100],
  desc: 'Flash ADPCM in FLV.' });
add({ id: 'mp3_swf', name: 'MP3 in SWF', group: 'ADPCM & Retro', codec: 'libmp3lame', fmt: 'swf', ext: 'swf', maxCh: 2, rates: [11025, 22050, 44100], desc: 'MP3 inside a Shockwave Flash movie.', opts: [br([320, 192, 128], 192)] });
add({ id: 'adx', name: 'CRI ADX', group: 'ADPCM & Retro', codec: 'adpcm_adx', fmt: 'adx', ext: 'adx', maxCh: 2, desc: 'SEGA CRI ADX ADPCM (Dreamcast, GameCube, PS2).' });
add({ id: 'argo', name: 'Argonaut Games ASF', group: 'ADPCM & Retro', codec: 'adpcm_argo', fmt: 'argo_asf', ext: 'asf', maxCh: 2, desc: 'Argonaut Games ADPCM (Croc, etc.).' });
add({ id: 'alp', name: 'High Voltage ALP', group: 'ADPCM & Retro', codec: 'adpcm_ima_alp', fmt: 'alp', ext: 'tun', maxCh: 2, rates: [22050], desc: 'High Voltage Software IMA ALP.' });
add({ id: 'apm', name: 'Ubisoft APM', group: 'ADPCM & Retro', codec: 'adpcm_ima_apm', fmt: 'apm', ext: 'apm', maxCh: 2, desc: 'Ubisoft Rayman 2 APM.' });
add({ id: 'kvag', name: 'Simon & Schuster KVAG', group: 'ADPCM & Retro', codec: 'adpcm_ima_ssi', fmt: 'kvag', ext: 'vag', maxCh: 2, desc: 'Simon & Schuster Interactive VAG.' });
add({ id: 'wsaud', name: 'Westwood AUD', group: 'ADPCM & Retro', codec: 'adpcm_ima_ws', fmt: 'wsaud', ext: 'aud', maxCh: 2, desc: 'Westwood Studios audio (Command & Conquer).' });
add({ id: 'roq', name: 'id RoQ DPCM', group: 'ADPCM & Retro', codec: 'roq_dpcm', fmt: 'roq', ext: 'roq', maxCh: 2, rates: [22050], desc: 'id Software RoQ (Quake III cinematics).' });
add({ id: 'amv', name: 'AMV (IMA ADPCM)', group: 'ADPCM & Retro', codec: 'adpcm_ima_amv', fmt: 'amv', ext: 'amv', chOptions: [1], rates: [22050], needsVideo: 'amv', experimental: true,
  desc: 'Chinese MP4-player AMV with a still black frame.' });
add({ id: 'smjpeg', name: 'Loki SMJPEG', group: 'ADPCM & Retro', codec: 'pcm_s16le', fmt: 'smjpeg', ext: 'mjpg', maxCh: 2, desc: 'Loki SDL MJPEG container (audio-only).' });
add({ id: 'film_cpk', name: 'SEGA FILM (CPK)', group: 'ADPCM & Retro', codec: 'pcm_s16be_planar', fmt: 'film_cpk', ext: 'cpk', maxCh: 2, needsVideo: 'cinepak',
  desc: 'SEGA Saturn FILM container with a still frame.' });
add({ id: 'wtv', name: 'Windows TV (WTV)', group: 'ADPCM & Retro', codec: 'mp2', fmt: 'wtv', ext: 'wtv', maxCh: 2, rates: [48000], desc: 'Windows Media Center recording.', opts: [br([384, 256, 192], 256)] });

/* Expose */
const GROUPS = ['Lossless', 'DSD', 'Uncompressed', 'Lossy', 'Speech & Telephony', 'ADPCM & Retro', 'Raw PCM'];

const LAYOUTS = [
  { id: 'mono', label: 'Mono', ch: 1, ff: 'mono' },
  { id: 'stereo', label: 'Stereo', ch: 2, ff: 'stereo' },
  { id: '2.1', label: '2.1', ch: 3, ff: '2.1' },
  { id: '3.0', label: '3.0', ch: 3, ff: '3.0' },
  { id: 'quad', label: 'Quad 4.0', ch: 4, ff: 'quad' },
  { id: '4.1', label: '4.1', ch: 5, ff: '4.1' },
  { id: '5.0', label: '5.0', ch: 5, ff: '5.0(side)' },
  { id: '5.1', label: '5.1', ch: 6, ff: '5.1(side)' },
  { id: '6.1', label: '6.1', ch: 7, ff: '6.1' },
  { id: '7.1', label: '7.1', ch: 8, ff: '7.1' }
];

function resolve(preset, selections = {}) {
  const r = Object.assign({}, preset);
  r.extraArgs = [...preset.args];
  for (const o of preset.opts) {
    const idx = selections[o.key] != null ? selections[o.key] : o.def;
    const v = o.values[Math.max(0, Math.min(o.values.length - 1, idx))];
    if (!v) continue;
    r.extraArgs.push(...(v.args || []));
    if (v.set) Object.assign(r, v.set);
  }
  return r;
}

function allowedChannels(p) {
  if (p.chOptions) return p.chOptions;
  const out = [];
  for (let c = 1; c <= p.maxCh; c++) out.push(c);
  return out;
}

module.exports = { PRESETS: P, GROUPS, LAYOUTS, STD_RATES, CD_RATE, resolve, allowedChannels };
