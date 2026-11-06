'use strict';
/* IRIDIA renderer */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = window.iridia;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (sec) => { sec = Math.round(sec); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; };
const fmtLong = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };

const S = {
  init: null, settings: null, catalog: null, presetById: {},
  drives: [], driveId: null, disc: null, tracks: [], album: { title: '', artist: '', year: '', genre: '', disc: '' },
  cover: null, releases: [], metaSource: '', ripping: false, fmtGroup: 'All', fmtSel: new Set(), log: []
};

function hydrateIcons(root = document) { $$('[data-icon]', root).forEach(el => { if (!el.dataset.done) { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); el.dataset.done = 1; } }); }
function toast(kind, title, msg, ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'ok' ? 'circle-check' : kind === 'err' ? 'circle-alert' : 'info')}<div><b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = '.3s'; el.style.opacity = 0; el.style.transform = 'translateX(20px)'; setTimeout(() => el.remove(), 300); }, ms);
  return el;
}
const save = (patch) => { Object.assign(S.settings, patch); return api.setSettings(patch); };

/* =================================================================== boot */
(async function boot() {
  hydrateIcons();
  bindChrome();
  const init = await api.init();
  S.init = init; S.settings = init.settings; S.catalog = init.catalog;
  init.catalog.presets.forEach(p => { S.presetById[p.id] = p; });
  S.settings.profiles = (S.settings.profiles || []).filter(p => S.presetById[p.presetId]);
  renderFfInfo(); initMeter();
  renderLayouts(); renderUpmix(); renderRates(); renderProfiles(); bindOutput();
  await refreshDrives();
  if (!init.ffmpeg.path) toast('err', 'FFmpeg not found', 'Place ffmpeg.exe in the "ffmpeg" folder next to IRIDIA.exe, or choose it in Settings.', 9000);
})();

function renderFfInfo() {
  const f = S.init.ffmpeg;
  const el = $('#sbFf');
  if (f.path) { el.textContent = `FFmpeg ${f.version.replace(/-full_build.*|-essentials.*/, '')} · ${S.catalog.presets.filter(p => p.available).length}/${S.catalog.presets.length} formats ready`; el.classList.remove('bad'); }
  else { el.textContent = 'FFmpeg not found'; el.classList.add('bad'); }
}

/* =================================================================== window chrome */
function bindChrome() {
  $('#wMin').onclick = () => api.win.min();
  $('#wMax').onclick = () => api.win.max();
  $('#wClose').onclick = () => api.win.close();
  $('#btnRefresh').onclick = () => loadDisc(true);
  $('#btnEject').onclick = async () => { if (S.ripping || !S.driveId) return; await api.eject(S.driveId); clearDisc(); };
  $('#driveSel').onchange = (e) => { S.driveId = e.target.value; save({ lastDrive: S.driveId }); loadDisc(); };
  $('#btnSettings').onclick = openSettings;
  $('#btnLog').onclick = () => $('#logDrawer').classList.toggle('open');
  $('#logClose').onclick = () => $('#logDrawer').classList.remove('open');
  $('#logCopy').onclick = () => { navigator.clipboard.writeText(S.log.join('\n')); toast('ok', 'Log copied'); };
  $('#btnLookup').onclick = () => lookup(true);
  $('#btnCover').onclick = async () => { const c = await api.pickCover(); if (c) { S.cover = c; renderCover(); } };
  $('#selAll').onclick = () => { S.tracks.forEach(t => { if (t.audio) t.sel = true; }); renderTracks(); };
  $('#selNone').onclick = () => { S.tracks.forEach(t => { t.sel = false; }); renderTracks(); };
  $('#releaseSel').onchange = (e) => applyRelease(S.releases[+e.target.value]);
  for (const [id, key] of [['#fAlbum', 'title'], ['#fArtist', 'artist'], ['#fYear', 'year'], ['#fGenre', 'genre'], ['#fDisc', 'disc']]) {
    $(id).oninput = (e) => {
      const old = S.album[key]; S.album[key] = e.target.value;
      if (key === 'artist') S.tracks.forEach(t => { if (!t.artist || t.artist === old) t.artist = e.target.value; });
      if (key === 'artist') renderTracks();
    };
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $$('.modal').forEach(m => m.hidden = true); $('#logDrawer').classList.remove('open'); } });
  api.on('rip:progress', onProgress);
  api.on('rip:unit', onUnit);
  api.on('rip:unitDone', onUnitDone);
  api.on('rip:log', (l) => { S.log.push(l); const pre = $('#logPre'); pre.textContent += l + '\n'; pre.scrollTop = pre.scrollHeight; });
}

/* =================================================================== drives & disc */
async function refreshDrives() {
  S.drives = await api.listDrives();
  const sel = $('#driveSel');
  sel.innerHTML = S.drives.length ? S.drives.map(d => `<option value="${esc(d.id)}">${esc(d.id === 'DEMO' ? d.name : `${d.id}  —  ${d.name}`)}</option>`).join('') : '<option value="">No optical drive found</option>';
  const pref = S.drives.find(d => d.id === S.settings.lastDrive) || S.drives[0];
  S.driveId = pref ? pref.id : null;
  if (pref) sel.value = pref.id;
  if (S.driveId) loadDisc();
}

function clearDisc() {
  S.disc = null; S.tracks = []; S.releases = []; S.cover = null; S.metaSource = '';
  S.album = { title: '', artist: '', year: '', genre: '', disc: '' };
  renderAlbum(); renderTracks(); renderCover(); renderStats();
  $('#disc').classList.add('empty');
}

let loadingDisc = false;
async function loadDisc(force) {
  if (!S.driveId || S.ripping || loadingDisc) return;
  loadingDisc = true;
  $('#sbStatus').textContent = 'Reading disc…';
  try {
    const d = await api.readDisc(S.driveId);
    if (!d.present) { clearDisc(); $('#sbStatus').textContent = 'No disc in drive'; return; }
    if (!force && S.disc && S.disc.discId === d.discId) return;
    clearDisc();
    S.disc = d;
    $('#disc').classList.remove('empty');
    const ct = d.cdtext || { album: {}, tracks: {} };
    S.album.title = ct.album.title || ''; S.album.artist = ct.album.performer || '';
    S.tracks = d.toc.tracks.map(t => ({
      number: t.number, audio: t.audio, preemphasis: t.preemphasis, sectors: t.sectors, lba: t.lba,
      title: (ct.tracks[t.number] || {}).title || (t.audio ? `Track ${String(t.number).padStart(2, '0')}` : 'Data track'),
      artist: (ct.tracks[t.number] || {}).performer || S.album.artist, sel: t.audio, status: '', pct: 0
    }));
    S.metaSource = d.cdtext && (ct.album.title || Object.keys(ct.tracks).length) ? 'CD-Text' : 'TOC';
    renderAlbum(); renderTracks(); renderStats();
    $('#discIdLine').textContent = d.discId ? `MusicBrainz ${d.discId} · CDDB ${d.cddb}` : '';
    $('#sbStatus').textContent = `${S.tracks.filter(t => t.audio).length} audio tracks · ${d.driveName || S.driveId}`;
    if (S.settings.autoLookup) lookup(false);
  } catch (e) {
    clearDisc(); $('#sbStatus').textContent = 'Could not read disc';
    toast('err', 'Disc read failed', e.message);
  } finally { loadingDisc = false; }
}

async function lookup(manual) {
  if (!S.disc) return;
  const btn = $('#btnLookup');
  btn.disabled = true; btn.lastChild.textContent = 'Searching…';
  try {
    const rel = await api.lookup(S.disc.toc);
    S.releases = rel || [];
    const pick = $('#releasePick');
    if (S.releases.length > 1) {
      $('#releaseSel').innerHTML = S.releases.map((r, i) => `<option value="${i}">${esc(r.artist)} — ${esc(r.title)} (${esc([r.year, r.country, r.label].filter(Boolean).join(' · '))})</option>`).join('');
      pick.hidden = false;
    } else pick.hidden = true;
    if (S.releases.length) { applyRelease(S.releases[0]); if (manual) toast('ok', 'Metadata found', `${S.releases.length} release(s) on ${S.releases[0].source}`); }
    else if (manual) toast('info', 'No match on MusicBrainz', 'You can type the album details by hand.');
  } catch (e) { if (manual) toast('err', 'Lookup failed', e.message); }
  finally { btn.disabled = false; btn.lastChild.textContent = 'MusicBrainz lookup'; }
}

async function applyRelease(r) {
  if (!r) return;
  Object.assign(S.album, { title: r.title, artist: r.artist, year: r.year || '', genre: r.genre || S.album.genre, disc: r.discCount > 1 ? String(r.discNumber) : '' });
  const audio = S.tracks.filter(t => t.audio);
  audio.forEach((t, i) => { const m = r.tracks[i]; if (m) { t.title = m.title; t.artist = m.artist; } });
  S.metaSource = r.source;
  renderAlbum(); renderTracks(); renderStats();
  if (r.mbid) {
    const c = await api.cover(r.mbid).catch(() => null);
    if (c) { S.cover = c; renderCover(); }
  }
}

/* =================================================================== render: album & tracks */
function renderAlbum() {
  $('#fAlbum').value = S.album.title; $('#fArtist').value = S.album.artist;
  $('#fYear').value = S.album.year; $('#fGenre').value = S.album.genre; $('#fDisc').value = S.album.disc;
}
function renderCover() {
  const lbl = $('#discLabel');
  if (S.cover) { $('#coverImg').src = `data:${S.cover.mime};base64,${S.cover.data}`; lbl.classList.add('has'); }
  else { $('#coverImg').removeAttribute('src'); lbl.classList.remove('has'); }
}
function renderStats() {
  const audio = S.tracks.filter(t => t.audio);
  $('#stTracks').textContent = audio.length || '—';
  $('#stTime').textContent = audio.length ? fmtLong(audio.reduce((a, t) => a + t.sectors, 0) / 75) : '—';
  $('#stSrc').textContent = S.metaSource || '—';
  if (!S.disc) $('#discIdLine').textContent = '';
}
function renderTracks() {
  const box = $('#tracks');
  $('#emptyState').hidden = !!S.tracks.length;
  $$('.trow', box).forEach(r => r.remove());
  const frag = document.createDocumentFragment();
  for (const t of S.tracks) {
    const row = document.createElement('div');
    row.className = `trow${t.audio ? '' : ' data'}${t.sel ? '' : ' off'}`;
    row.dataset.n = t.number;
    row.innerHTML = `<div class="bar"></div>
      <input type="checkbox" class="chk" ${t.sel ? 'checked' : ''} ${t.audio ? '' : 'disabled'}>
      <span class="num">${String(t.number).padStart(2, '0')}</span>
      <div style="display:flex;align-items:center;min-width:0"><input class="t ttl" value="${esc(t.title)}" spellcheck="false" style="flex:1">${t.preemphasis ? '<span class="pe" title="Pre-emphasis flag">PRE</span>' : ''}</div>
      <input class="t art" value="${esc(t.artist)}" spellcheck="false">
      <span class="dur r">${fmtTime(t.sectors / 75)}</span>
      <span class="st r"></span>`;
    row.querySelector('.chk').onchange = (e) => { t.sel = e.target.checked; row.classList.toggle('off', !t.sel); };
    row.querySelector('.ttl').oninput = (e) => { t.title = e.target.value; };
    row.querySelector('.art').oninput = (e) => { t.artist = e.target.value; };
    frag.appendChild(row);
    updateTrackRow(t, row);
  }
  box.appendChild(frag);
}
function updateTrackRow(t, row = $(`.trow[data-n="${t.number}"]`)) {
  if (!row) return;
  row.querySelector('.bar').style.width = `${(t.pct || 0) * 100}%`;
  const st = row.querySelector('.st');
  st.className = 'st r' + (t.status === 'done' ? ' ok' : t.status === 'error' ? ' err' : '');
  st.innerHTML = t.status === 'done' ? `${icon('check')}${esc(t.crc || 'Done')}` : t.status === 'error' ? `${icon('triangle-alert')}Error`
    : t.status === 'ripping' ? `${Math.round((t.pct || 0) * 100)}%` : t.status === 'encoding' ? 'Finishing…' : t.status === 'queued' ? 'Queued' : '';
  row.classList.toggle('active', t.status === 'ripping' || t.status === 'encoding');
}

/* =================================================================== output: profiles */
function presetBadge(p) {
  if (p.group === 'DSD') return 'dsd';
  return p.lossless ? 'll' : '';
}
function chLabel(p) {
  if (p.layouts) { const last = p.layouts[p.layouts.length - 1]; return last === 'stereo' ? 'Stereo' : last === 'mono' ? 'Mono' : last; }
  const max = p.chOptions ? Math.max(...p.chOptions) : p.maxCh;
  return { 1: 'Mono', 2: 'Stereo', 3: '2.1', 4: 'Quad', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1' }[max];
}
function renderProfiles() {
  const box = $('#profiles');
  const profs = S.settings.profiles;
  if (!profs.length) { box.innerHTML = '<div class="prof-empty">No format selected — click <b>Add</b> to pick from 140+ formats.</div>'; updatePlan(); return; }
  box.innerHTML = '';
  profs.forEach((pf, i) => {
    const p = S.presetById[pf.presetId];
    const el = document.createElement('div');
    el.className = 'prof' + (pf._open ? ' open' : '');
    const optsSummary = p.opts.map(o => o.values[pf.selections?.[o.key] ?? o.def]).filter(Boolean).join(' · ');
    el.innerHTML = `<div class="prof-head"><span class="prof-ext ${presetBadge(p)}">${esc(p.ext)}</span>
      <span class="prof-name">${esc(p.name)}<span class="prof-sub">${esc(optsSummary || p.desc)}</span></span>
      <button class="prof-x" title="Remove">${icon('x')}</button></div>
      <div class="prof-opts">${p.opts.map(o => `<label>${esc(o.label)}<div class="select-wrap"><select data-k="${esc(o.key)}">${o.values.map((v, vi) => `<option value="${vi}" ${(pf.selections?.[o.key] ?? o.def) === vi ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div></label>`).join('') || '<span class="hint" style="grid-column:1/-1">No options — this format is used at its native settings.</span>'}</div>`;
    el.querySelector('.prof-head').onclick = (e) => { if (e.target.closest('.prof-x')) return; pf._open = !pf._open; el.classList.toggle('open'); };
    el.querySelector('.prof-x').onclick = () => { profs.splice(i, 1); persistProfiles(); renderProfiles(); };
    el.querySelectorAll('select').forEach(s => s.onchange = () => { pf.selections = pf.selections || {}; pf.selections[s.dataset.k] = +s.value; persistProfiles(); const sub = el.querySelector('.prof-sub'); sub.textContent = p.opts.map(o => o.values[pf.selections?.[o.key] ?? o.def]).join(' · '); });
    box.appendChild(el);
  });
  updatePlan();
}
function persistProfiles() { save({ profiles: S.settings.profiles.map(p => ({ presetId: p.presetId, selections: p.selections || {} })) }); updatePlan(); }

/* =================================================================== output: channels */
const SPK = {
  FL: [56, 50, 'L'], FR: [164, 50, 'R'], FC: [110, 38, 'C'], LFE: [110, 11, 'SUB'], SL: [26, 100, 'SL'], SR: [194, 100, 'SR'],
  BL: [58, 146, 'BL'], BR: [162, 146, 'BR'], BC: [110, 152, 'BC'], M: [110, 38, 'M']
};
const LAYOUT_SPK = {
  mono: ['M'], stereo: ['FL', 'FR'], '2.1': ['FL', 'FR', 'LFE'], '3.0': ['FL', 'FR', 'FC'], quad: ['FL', 'FR', 'BL', 'BR'],
  '4.1': ['FL', 'FR', 'FC', 'LFE', 'BC'], '5.0': ['FL', 'FR', 'FC', 'SL', 'SR'], '5.1': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'],
  '6.1': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BC'], '7.1': ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR', 'BL', 'BR']
};
function renderSpeakers(layoutId) {
  const on = new Set(LAYOUT_SPK[layoutId] || []);
  const svg = $('#speakers');
  let h = `<defs><linearGradient id="spkG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7CF7FF"/><stop offset=".5" stop-color="#8B7CFF"/><stop offset="1" stop-color="#FF6BD5"/></linearGradient></defs>
    <ellipse class="room" cx="110" cy="92" rx="92" ry="66"/>`;
  for (const [k, [x, y, lab]] of Object.entries(SPK)) {
    if (k === 'M' && !on.has('M')) continue;
    if (k === 'FC' && on.has('M')) continue;
    const isOn = on.has(k);
    const body = k === 'LFE' ? `<circle class="body" cx="${x}" cy="${y}" r="7"/>` : `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="5"/>`;
    h += `<g class="spk${isOn ? ' on' : ''}">${isOn ? `<circle class="wave" cx="${x}" cy="${y}" r="13"/>` : ''}${body}<text x="${k === 'LFE' ? x + 21 : x}" y="${k === 'LFE' ? y + 3 : y + 21}">${lab}</text></g>`;
  }
  h += `<circle class="head" cx="110" cy="96" r="13"/><path d="M104 88 q6 -6 12 0" stroke="rgba(255,255,255,.35)" fill="none"/><circle cx="110" cy="96" r="3" fill="url(#spkG)"/>`;
  svg.innerHTML = h;
}
function renderLayouts() {
  const g = $('#layoutGrid');
  g.innerHTML = S.catalog.layouts.map(l => `<button data-id="${l.id}" class="${l.id === S.settings.layoutId ? 'on' : ''}">${esc(l.id === 'quad' ? 'Quad' : l.label)}</button>`).join('');
  g.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; save({ layoutId: b.dataset.id }); $$('button', g).forEach(x => x.classList.toggle('on', x === b)); renderSpeakers(b.dataset.id); renderUpmix(); updatePlan(); };
  renderSpeakers(S.settings.layoutId);
}
function renderUpmix() {
  const seg = $('#upmixSeg');
  $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === S.settings.upmix));
  seg.classList.toggle('disabled', ['mono', 'stereo'].includes(S.settings.layoutId));
  seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; save({ upmix: b.dataset.v }); renderUpmix(); };
  const l = S.catalog.layouts.find(x => x.id === S.settings.layoutId);
  $('#layoutHint').textContent = l ? `${l.ch} channel${l.ch > 1 ? 's' : ''}` : '';
}
function renderRates() {
  const sel = $('#rateSel');
  const label = (r) => r === 44100 ? '44.1 kHz — CD original (bit-perfect)' : `${r % 1000 ? (r / 1000).toFixed(r % 100 ? 3 : 1) : r / 1000} kHz`;
  sel.innerHTML = S.catalog.rates.map(r => `<option value="${r}" ${r === S.settings.rate ? 'selected' : ''}>${label(r)}</option>`).join('');
  sel.onchange = () => { save({ rate: +sel.value }); updatePlan(); };
}
function bindOutput() {
  $('#outDir').value = S.settings.outDir;
  $('#outDir').onchange = (e) => save({ outDir: e.target.value });
  $('#btnOutDir').onclick = async () => { const d = await api.pickFolder($('#outDir').value); if (d) { $('#outDir').value = d; save({ outDir: d }); } };
  $('#template').value = S.settings.template;
  $('#template').onchange = (e) => save({ template: e.target.value });
  $('#tSecure').checked = S.settings.secure; $('#tSecure').onchange = (e) => save({ secure: e.target.checked });
  $('#tImage').checked = S.settings.image; $('#tImage').onchange = (e) => save({ image: e.target.checked });
  $('#btnAddFmt').onclick = openFormats;
  $('#btnRip').onclick = () => (S.ripping ? cancelRip() : startRip());
}
async function updatePlan() {
  const w = $('#clampWarn');
  const profs = S.settings.profiles;
  if (!profs.length) { w.hidden = true; return; }
  const plan = await api.plan({ profiles: profs, layoutId: S.settings.layoutId, rate: S.settings.rate });
  const msgs = [];
  plan.forEach((pl, i) => {
    if (!pl) return;
    const p = S.presetById[pl.presetId];
    const parts = [];
    if (pl.clamped) parts.push(pl.layout === 'stereo' ? 'stereo' : pl.layout === 'mono' ? 'mono' : pl.layout);
    if (pl.rate && pl.rate !== S.settings.rate) parts.push(`${pl.rate / 1000} kHz`);
    if (parts.length) msgs.push(`<b>${esc(p.name)}</b> → ${esc(parts.join(', '))}`);
  });
  w.hidden = !msgs.length;
  w.innerHTML = `${icon('info')}<span>Adapted to each format's limits: ${msgs.join(' · ')}</span>`;
}

/* =================================================================== format browser */
function openFormats() {
  S.fmtSel = new Set(S.settings.profiles.map(p => p.presetId));
  $('#fmtModal').hidden = false;
  $('#fmtSearch').value = '';
  renderFmtGroups(); renderFmtGrid();
  setTimeout(() => $('#fmtSearch').focus(), 50);
}
function renderFmtGroups() {
  const groups = ['All', ...S.catalog.groups];
  const count = (g) => g === 'All' ? S.catalog.presets.length : S.catalog.presets.filter(p => p.group === g).length;
  $('#fmtGroups').innerHTML = groups.map(g => `<button data-g="${esc(g)}" class="${g === S.fmtGroup ? 'on' : ''}">${esc(g)}<em>${count(g)}</em></button>`).join('');
  $('#fmtGroups').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.fmtGroup = b.dataset.g; renderFmtGroups(); renderFmtGrid(); };
}
function renderFmtGrid() {
  const q = $('#fmtSearch').value.trim().toLowerCase();
  let list = S.catalog.presets.filter(p => S.fmtGroup === 'All' || p.group === S.fmtGroup);
  if (q) list = S.catalog.presets.filter(p => `${p.name} ${p.desc} ${p.ext} ${p.codec} ${p.fmt} ${p.group} ${chLabel(p)}`.toLowerCase().includes(q));
  const grid = $('#fmtGrid');
  let html = '', lastG = '';
  for (const p of list) {
    if ((S.fmtGroup === 'All' || q) && p.group !== lastG) { html += `<div class="grp-title">${esc(p.group)}</div>`; lastG = p.group; }
    const tags = [`<span class="tag ext">.${esc(p.ext)}</span>`];
    if (p.group === 'DSD') tags.push('<span class="tag dsd">1-bit DSD</span>');
    else if (p.lossless) tags.push('<span class="tag ll">Lossless</span>');
    tags.push(`<span class="tag ch">${esc(chLabel(p))}</span>`);
    if (p.rates && p.rates.length === 1) tags.push(`<span class="tag">${p.rates[0] / 1000} kHz</span>`);
    if (p.experimental) tags.push('<span class="tag exp">Experimental</span>');
    if (p.windowsOnly) tags.push('<span class="tag">Media Foundation</span>');
    tags.push(`<span class="tag">${esc(p.codec === 'dsd' ? 'IRIDIA DSD engine' : p.codec)}</span>`);
    html += `<button class="fcard${S.fmtSel.has(p.id) ? ' sel' : ''}${p.available ? '' : ' na'}" data-id="${p.id}" title="${p.available ? '' : 'Encoder not present in your FFmpeg build'}">
      <span class="tick">${icon('check')}</span><h4>${esc(p.name)}</h4><p>${esc(p.desc)}</p><div class="tags">${tags.join('')}</div></button>`;
  }
  grid.innerHTML = html || '<p class="muted" style="grid-column:1/-1;padding:20px">No format matches your search.</p>';
  $('#fmtCount').textContent = `${S.fmtSel.size} selected · ${S.catalog.presets.length} formats in catalog`;
}
$('#fmtSearch').oninput = () => renderFmtGrid();
$('#fmtGrid').onclick = (e) => {
  const c = e.target.closest('.fcard'); if (!c) return;
  const id = c.dataset.id;
  if (!S.presetById[id].available) { toast('info', 'Encoder unavailable', `${S.presetById[id].name} needs the "${S.presetById[id].codec}" encoder, which your FFmpeg build does not include.`); return; }
  if (S.fmtSel.has(id)) S.fmtSel.delete(id); else S.fmtSel.add(id);
  c.classList.toggle('sel');
  $('#fmtCount').textContent = `${S.fmtSel.size} selected · ${S.catalog.presets.length} formats in catalog`;
};
const closeFormats = () => {
  const keep = S.settings.profiles.filter(p => S.fmtSel.has(p.presetId));
  for (const id of S.fmtSel) if (!keep.find(p => p.presetId === id)) keep.push({ presetId: id, selections: {}, _open: true });
  S.settings.profiles = keep; persistProfiles(); renderProfiles();
  $('#fmtModal').hidden = true;
};
$('#fmtDone').onclick = closeFormats;
$('#fmtClose').onclick = closeFormats;
$('#fmtModal').onclick = (e) => { if (e.target.id === 'fmtModal') closeFormats(); };

/* =================================================================== settings */
function openSettings() {
  const s = S.settings;
  $('#sFf').value = s.ffmpegPath || '';
  const f = S.init.ffmpeg;
  $('#sFfInfo').textContent = f.path ? `Using ${f.path} — version ${f.version}${f.soxr ? ' · SoX resampler' : ''}` : 'FFmpeg not found.';
  $('#sOffset').value = s.offset; $('#sRetries').value = s.retries;
  $('#sDeemph').checked = s.deemphasis; $('#sEject').checked = s.ejectWhenDone; $('#sAuto').checked = s.autoLookup;
  $('#sEmbed').checked = s.embedCover; $('#sCover').checked = s.saveCover; $('#sLog').checked = s.writeLog; $('#sM3u').checked = s.writeM3u; $('#sCue').checked = s.writeCue;
  $('#sImgTpl').value = s.imageTemplate;
  $('#sData').textContent = `Settings are stored in ${S.init.dataDir}`;
  $('#setModal').hidden = false;
}
async function applyFf(p) {
  await save({ ffmpegPath: p });
  const r = await api.reprobe();
  S.init.ffmpeg = { path: r.path, version: r.version, soxr: r.soxr };
  S.catalog.presets.forEach(pr => { pr.available = pr.codec === 'dsd' ? !!r.path : r.encoders.includes(pr.codec); });
  renderFfInfo();
  $('#sFfInfo').textContent = r.path ? `Using ${r.path} — version ${r.version}` : 'FFmpeg not found at this location.';
}
$('#sFf').onchange = (e) => applyFf(e.target.value.trim());
$('#sFfBrowse').onclick = async () => { const p = await api.pickFfmpeg(); if (p) { $('#sFf').value = p; applyFf(p); } };
$('#sOffset').onchange = (e) => save({ offset: parseInt(e.target.value, 10) || 0 });
$('#sRetries').onchange = (e) => save({ retries: Math.max(0, parseInt(e.target.value, 10) || 0) });
for (const [id, k] of [['#sDeemph', 'deemphasis'], ['#sEject', 'ejectWhenDone'], ['#sAuto', 'autoLookup'], ['#sEmbed', 'embedCover'], ['#sCover', 'saveCover'], ['#sLog', 'writeLog'], ['#sM3u', 'writeM3u'], ['#sCue', 'writeCue']]) {
  $(id).onchange = (e) => save({ [k]: e.target.checked });
}
$('#sImgTpl').onchange = (e) => save({ imageTemplate: e.target.value });
$('#setClose').onclick = () => { $('#setModal').hidden = true; };
$('#setModal').onclick = (e) => { if (e.target.id === 'setModal') $('#setModal').hidden = true; };

/* =================================================================== ripping */
function setRipping(on) {
  S.ripping = on;
  const b = $('#btnRip');
  b.classList.toggle('busy', on);
  $('#ripLabel').textContent = on ? 'Cancel' : 'Rip CD';
  $('#disc').classList.toggle('spinning', on);
  ['#btnRefresh', '#btnEject', '#driveSel', '#btnAddFmt', '#btnLookup'].forEach(s => { $(s).disabled = on; });
  document.body.classList.toggle('is-ripping', on);
}
function initMeter() {
  const bars = $('#meterBars'); bars.innerHTML = '<i></i>'.repeat(32);
}
let meterT = 0;
function setMeter(peak) {
  const bars = $$('#meterBars i'); const n = bars.length;
  const db = peak > 0 ? 20 * Math.log10(peak) : -96;
  const lit = Math.round(Math.max(0, Math.min(1, (db + 48) / 48)) * n);
  bars.forEach((b, i) => { const on = i < lit; b.classList.toggle('lit', on); b.style.height = on ? `${30 + 70 * Math.pow(i / n, .8) * (0.85 + Math.random() * .15)}%` : '18%'; b.style.backgroundPosition = `${(i / (n - 1)) * 100}% 0`; });
  $('#meterVal').textContent = peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : '—';
}
function setRing(pct) {
  $('#ringFg').style.strokeDashoffset = String(603.2 * (1 - pct));
  $('#discPct').textContent = pct > 0 && pct < 1 ? `${Math.round(pct * 100)}%` : '';
  $('#sbFill').style.width = `${pct * 100}%`;
}
async function startRip() {
  if (!S.disc) return toast('info', 'No disc', 'Insert an audio CD first.');
  const sel = S.tracks.filter(t => t.audio && t.sel);
  if (!sel.length) return toast('info', 'Nothing selected', 'Tick at least one track.');
  if (!S.settings.profiles.length) return toast('info', 'No output format', 'Add at least one output format.');
  if (!S.init.ffmpeg.path) return toast('err', 'FFmpeg not found', 'Set the FFmpeg location in Settings.');
  const outDir = $('#outDir').value.trim();
  if (!outDir) return toast('info', 'No destination', 'Choose an output folder.');
  S.log = []; $('#logPre').textContent = '';
  S.tracks.forEach(t => { t.status = t.sel && t.audio ? 'queued' : ''; t.pct = 0; t.crc = ''; updateTrackRow(t); });
  setRipping(true); setRing(0);
  $('#sbStatus').innerHTML = '<b>Extracting…</b>';
  const s = S.settings;
  const job = {
    driveId: S.driveId, driveName: S.disc.driveName, toc: S.disc.toc, trackNumbers: sel.map(t => t.number),
    album: { title: S.album.title.trim(), artist: S.album.artist.trim(), year: S.album.year.trim(), genre: S.album.genre.trim(), disc: S.album.disc.trim() },
    trackMeta: Object.fromEntries(S.tracks.map(t => [t.number, { title: t.title.trim(), artist: t.artist.trim() }])),
    cover: S.cover, profiles: s.profiles.map(p => ({ presetId: p.presetId, selections: p.selections || {} })),
    layoutId: s.layoutId, upmix: s.upmix, rate: s.rate, outDir, template: $('#template').value, imageTemplate: s.imageTemplate,
    secure: s.secure, offset: s.offset, retries: s.retries, deemphasis: s.deemphasis, image: s.image,
    writeCue: s.writeCue, writeLog: s.writeLog, writeM3u: s.writeM3u, saveCover: s.saveCover, embedCover: s.embedCover
  };
  try {
    const res = await api.startRip(job);
    if (res.cancelled) { toast('info', 'Rip cancelled', 'Partial files were removed.'); $('#sbStatus').textContent = 'Cancelled'; S.tracks.forEach(t => { if (t.status !== 'done') { t.status = ''; t.pct = 0; updateTrackRow(t); } }); }
    else {
      const bad = res.results.filter(r => !r.ok).length;
      setRing(1);
      $('#sbStatus').innerHTML = bad ? `<b>Finished with ${bad} error(s)</b>` : '<b>All done</b> — perfect extraction';
      const t = toast(bad ? 'err' : 'ok', bad ? 'Rip finished with errors' : 'Rip complete', `${res.results.length - bad} item(s) written${res.errors ? ` · ${res.errors} read error(s)` : ''}.\nClick to open the output folder.`, 9000);
      t.style.cursor = 'pointer'; t.onclick = () => api.open(res.dirs && res.dirs[0] ? res.dirs[0] : outDir);
    }
  } catch (e) {
    toast('err', 'Rip failed', e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 10000);
    $('#sbStatus').textContent = 'Error';
  } finally {
    setRipping(false); $('#sbSpeed').textContent = ''; $('#sbEta').textContent = '';
    setTimeout(() => { if (!S.ripping) setRing(0); }, 2500);
  }
}
async function cancelRip() { $('#sbStatus').textContent = 'Cancelling…'; await api.cancelRip(); }
let unitTracks = [];
function onUnit(u) {
  unitTracks = u.track === 0 ? S.tracks.filter(t => t.status === 'queued') : [S.tracks.find(t => t.number === u.track)];
  unitTracks.forEach(t => { if (t) { t.status = 'ripping'; t.pct = 0; updateTrackRow(t); } });
  if (u.track) $(`.trow[data-n="${u.track}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function onProgress(p) {
  setRing(p.totalPct);
  if (p.peak != null) setMeter(p.peak);
  if (p.speed) $('#sbSpeed').innerHTML = `Speed <b>${p.speed.toFixed(1)}×</b>`;
  if (p.eta) $('#sbEta').innerHTML = `Remaining <b>${fmtLong(p.eta)}</b>`;
  const n = unitTracks.length;
  unitTracks.forEach((t, i) => {
    if (!t) return;
    t.pct = n > 1 ? Math.max(0, Math.min(1, p.unitPct * n - i)) : p.unitPct;
    if (p.encoding) t.status = 'encoding';
    updateTrackRow(t);
  });
}
function onUnitDone(u) {
  unitTracks.forEach(t => { if (!t) return; t.status = u.ok ? 'done' : 'error'; t.pct = u.ok ? 1 : 0; t.crc = u.ok && unitTracks.length === 1 ? (u.crc >>> 0).toString(16).toUpperCase().padStart(8, '0') : ''; updateTrackRow(t); });
}
