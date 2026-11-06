'use strict';
/* MusicBrainz disc lookup + Cover Art Archive. */
const crypto = require('crypto');

const UA = 'IRIDIA/1.0.0 ( https://github.com/realauthorfilms/iridia )';

/** Compute MusicBrainz Disc ID and TOC string from a TOC {tracks:[{number,lba,audio,sectors}], leadout} */
function discId(toc) {
  const audio = toc.tracks.filter(t => t.audio);
  if (!audio.length) return null;
  const first = audio[0].number, last = audio[audio.length - 1].number;
  const lastT = audio[audio.length - 1];
  const leadout = lastT.lba + lastT.sectors + 150; // handles enhanced CDs (data session gap removed)
  let s = first.toString(16).toUpperCase().padStart(2, '0') + last.toString(16).toUpperCase().padStart(2, '0') + leadout.toString(16).toUpperCase().padStart(8, '0');
  for (let i = 1; i <= 99; i++) {
    const t = audio.find(x => x.number === i);
    s += (t ? t.lba + 150 : 0).toString(16).toUpperCase().padStart(8, '0');
  }
  const id = crypto.createHash('sha1').update(s, 'ascii').digest('base64').replace(/\+/g, '.').replace(/\//g, '_').replace(/=/g, '-');
  const tocStr = [first, last, leadout, ...audio.map(t => t.lba + 150)].join('+');
  return { id, toc: tocStr, first, last, leadout };
}

/** FreeDB/CDDB disc id (for logs & CUE) */
function cddbId(toc) {
  const sum = (n) => { let r = 0; while (n > 0) { r += n % 10; n = Math.floor(n / 10); } return r; };
  const tr = toc.tracks;
  let n = 0;
  for (const t of tr) n += sum(Math.floor((t.lba + 150) / 75));
  const total = Math.floor((toc.leadout + 150) / 75) - Math.floor((tr[0].lba + 150) / 75);
  return (((n % 0xff) << 24) | (total << 8) | tr.length) >>> 0;
}

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function credit(ac) { return (ac || []).map(a => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join('').trim(); }

/** Returns list of candidate releases, each {mbid, title, artist, year, country, label, tracks:[{title,artist}], discNumber, discCount, genre} */
async function lookupMusicBrainz(toc, fetchImpl = fetch) {
  const d = discId(toc);
  if (!d) return [];
  const inc = 'artist-credits+recordings+labels+genres+release-groups';
  let j = await getJson(`https://musicbrainz.org/ws/2/discid/${d.id}?inc=${inc}&fmt=json`, fetchImpl).catch(() => null);
  if (!j || !(j.releases || []).length) {
    j = await getJson(`https://musicbrainz.org/ws/2/discid/-?toc=${d.toc}&inc=${inc}&cdstubs=no&fmt=json`, fetchImpl).catch(() => null);
  }
  const releases = (j && j.releases) || [];
  const audioCount = toc.tracks.filter(t => t.audio).length;
  const out = [];
  for (const r of releases) {
    const media = r.media || [];
    let mi = media.findIndex(m => (m.discs || []).some(x => x.id === d.id));
    if (mi < 0) mi = media.findIndex(m => (m['track-count'] || (m.tracks || []).length) === audioCount);
    if (mi < 0) mi = 0;
    const m = media[mi] || { tracks: [] };
    const albumArtist = credit(r['artist-credit']);
    const genres = [...(r.genres || []), ...((r['release-group'] || {}).genres || [])].sort((a, b) => (b.count || 0) - (a.count || 0));
    out.push({
      mbid: r.id, title: r.title, artist: albumArtist, year: (r.date || '').slice(0, 4), country: r.country || '',
      label: ((r['label-info'] || [])[0] || {}).label?.name || '', barcode: r.barcode || '',
      discNumber: mi + 1, discCount: media.length, genre: genres[0] ? genres[0].name.replace(/\b\w/g, c => c.toUpperCase()) : '',
      tracks: (m.tracks || []).map(t => ({ title: t.title || t.recording?.title || '', artist: credit(t['artist-credit']) || albumArtist })),
      source: 'MusicBrainz'
    });
  }
  return out;
}

async function fetchCover(mbid, fetchImpl = fetch) {
  for (const size of ['front-1200', 'front-500', 'front']) {
    try {
      const r = await fetchImpl(`https://coverartarchive.org/release/${mbid}/${size}`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 1000) return { data: buf, mime: (r.headers.get('content-type') || 'image/jpeg').split(';')[0] };
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

module.exports = { discId, cddbId, lookupMusicBrainz, fetchCover };
