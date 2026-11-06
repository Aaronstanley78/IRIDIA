'use strict';
/* Scripted UI tour used to record the README animation (developer tool). */
const fs = require('fs');
const path = require('path');

module.exports = async function run(win, app) {
  const out = process.env.IRIDIA_SCENARIO_OUT;
  fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code).catch(e => console.error('JS error', e.message));
  let frame = 0, capturing = false, interval = 100;
  const grab = async () => { const img = await wc.capturePage(); fs.writeFileSync(path.join(out, `f${String(frame++).padStart(5, '0')}.png`), img.toPNG()); };
  const loop = async () => { while (capturing) { const t = Date.now(); await grab(); await sleep(Math.max(0, interval - (Date.now() - t))); } };
  const hold = (ms) => sleep(ms);

  // cursor helpers injected into the page
  await js(`
    (() => {
      const c = document.createElement('div'); c.id = 'demoCursor';
      c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#120d22" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      Object.assign(c.style, { position: 'fixed', left: '760px', top: '520px', zIndex: 9999, pointerEvents: 'none', transition: 'left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.5))' });
      document.body.appendChild(c);
      const st = document.createElement('style');
      st.textContent = '.demo-ripple{position:fixed;width:40px;height:40px;margin:-20px;border-radius:50%;border:2px solid #fff;pointer-events:none;z-index:9998;animation:dr .5s ease-out forwards}@keyframes dr{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}';
      document.head.appendChild(st);
      window.__move = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); c.style.left = (r.left + r.width / 2 - 4) + 'px'; c.style.top = (r.top + r.height / 2 - 3) + 'px'; return true; };
      window.__click = (sel) => { const el = document.querySelector(sel); if (!el) return; const r = el.getBoundingClientRect(); const d = document.createElement('div'); d.className = 'demo-ripple'; d.style.left = (r.left + r.width / 2) + 'px'; d.style.top = (r.top + r.height / 2) + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 600); el.click(); };
      window.__type = async (sel, text) => { const el = document.querySelector(sel); el.value = ''; for (const ch of text) { el.value += ch; el.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 110)); } };
    })();`);
  const moveClick = async (sel, wait = 750, after = 450) => { await js(`__move(${JSON.stringify(sel)})`); await hold(wait); await js(`__click(${JSON.stringify(sel)})`); await hold(after); };

  // only rip two short tracks so the recording stays compact
  await js(`S.tracks.forEach(t => { t.sel = [2, 4].includes(t.number); }); renderTracks();`);
  await hold(300);

  capturing = true; const l = loop();
  await hold(1600);
  await moveClick('#btnAddFmt', 800, 600);
  await js(`__move('#fmtSearch')`); await hold(600);
  await js(`__type('#fmtSearch', 'dsd')`); await hold(700);
  await moveClick('.fcard[data-id="dsf"]', 700, 350);
  await moveClick('.fcard[data-id="dff"]', 600, 500);
  await js(`__type('#fmtSearch', 'opus')`); await hold(700);
  await moveClick('.fcard[data-id="opus"]', 700, 600);
  await moveClick('#fmtDone', 700, 700);
  await moveClick('#layoutGrid button[data-id="5.1"]', 800, 700);
  await moveClick('#layoutGrid button[data-id="7.1"]', 600, 900);
  await moveClick('#upmixSeg button[data-v="smart"]', 600, 500);
  await moveClick('#btnRip', 900, 300);
  await js(`document.getElementById('demoCursor').style.opacity = 0`);
  // ripping: capture more sparsely (time-lapse)
  interval = 450;
  for (let i = 0; i < 400; i++) {
    const busy = await js(`S.ripping`);
    if (!busy) break;
    await hold(500);
  }
  interval = 100;
  await hold(2600);
  capturing = false; await l;
  app.quit();
};
