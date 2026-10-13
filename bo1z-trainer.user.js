// ==UserScript==
// @name         BO1Z web trainer
// @namespace    local
// @version      1.1
// @description  Memory scanner hotkeys for the vel.gg BO1 Zombies web port (solo use).
// @match        https://vel.gg/bo1z*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/hamshub/bo1z-web-trainer
// @downloadURL  https://github.com/hamshub/bo1z-web-trainer/raw/main/bo1z-trainer.user.js
// @updateURL    https://github.com/hamshub/bo1z-web-trainer/raw/main/bo1z-trainer.user.js
// ==/UserScript==

(() => {
  // --- capture the engine's WebAssembly memory as it is created ---
  const mems = [];
  const OrigMem = WebAssembly.Memory;
  WebAssembly.Memory = function (d) { const m = new OrigMem(d); mems.push(m); return m; };
  WebAssembly.Memory.prototype = OrigMem.prototype;
  for (const fn of ['instantiate', 'instantiateStreaming']) {
    const orig = WebAssembly[fn];
    WebAssembly[fn] = async (...a) => {
      const r = await orig.apply(WebAssembly, a);
      const mem = (r.instance || r).exports?.memory;
      if (mem && !mems.includes(mem)) mems.push(mem);
      return r;
    };
  }
  const heap = () => {
    if (!mems.length) return null;
    return new Int32Array(mems.reduce((a, b) => b.buffer.byteLength > a.buffer.byteLength ? b : a).buffer);
  };

  // --- scanner: candidates are kept in a Uint32Array (a first scan can match millions of addresses) ---
  const newScan = () => ({ idx: null });
  const filter = (s, keep) => {
    const h = heap(); if (!h) return 0;
    if (!s.idx) {
      let n = 0;
      for (let i = 0; i < h.length; i++) if (keep(h[i])) n++;
      const idx = new Uint32Array(n);
      let k = 0; // memory keeps changing while we scan, so the second pass can find fewer matches
      for (let i = 0; i < h.length && k < n; i++) if (keep(h[i])) idx[k++] = i;
      s.idx = idx.subarray(0, k);
    } else {
      let k = 0;
      for (let n = 0; n < s.idx.length; n++) if (keep(h[s.idx[n]])) s.idx[k++] = s.idx[n];
      s.idx = s.idx.subarray(0, k);
    }
    return s.idx.length;
  };
  const write = (s, v) => { const h = heap(); if (h && s.idx) s.idx.forEach(i => (h[i] = v)); };

  const pts = newScan(), hp = newScan();
  const POINTS = 500000, MAX_WRITE = 16; // refuse to write to more than this many addresses (avoids corrupting memory)
  let godTimer = null;

  // --- status line ---
  let box;
  const status = (msg) => {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;font:12px monospace;color:#fff;background:rgba(0,0,0,.7);padding:4px 8px;border-radius:4px;pointer-events:none';
      document.documentElement.appendChild(box);
    }
    box.textContent = `[trainer] ${msg} | pts:${pts.idx?.length ?? '-'} hp:${hp.idx?.length ?? '-'} god:${godTimer ? 'ON' : 'off'}`;
  };

  // --- hotkeys (Alt+key, captured before the game sees them) ---
  const actions = {
    // Points: enter what the HUD shows; first press starts a search, later presses narrow it.
    KeyP: () => { const v = parseInt(prompt('Current points (blank = new search):'), 10); if (isNaN(v)) { pts.idx = null; return status('points search reset'); } status(`points matches: ${filter(pts, x => x === v)}`); },
    KeyO: () => { if (!pts.idx || pts.idx.length > MAX_WRITE) return status('narrow points down first'); write(pts, POINTS); status(`points set to ${POINTS}`); },
    // Health: H at full health, J right after taking damage. Alternate until few matches remain.
    KeyH: () => status(`hp (full=100): ${filter(hp, x => x === 100)}`),
    KeyJ: () => status(`hp (hurt): ${filter(hp, x => x > 0 && x < 100)}`),
    KeyK: () => { hp.idx = null; status('health search reset'); },
    // God mode: keep the found health addresses at 100 (game logic still caps damage per hit).
    KeyG: () => {
      if (godTimer) { clearInterval(godTimer); godTimer = null; return status('god off'); }
      if (!hp.idx || hp.idx.length > MAX_WRITE) return status('narrow health down first (H/J)');
      godTimer = setInterval(() => write(hp, 100), 20); status('god on');
    },
  };
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || !actions[e.code]) return;
    e.preventDefault(); e.stopImmediatePropagation();
    actions[e.code]();
  }, true);

  window.__trainer = { mems, pts, hp };
  addEventListener('DOMContentLoaded', () => status('ready - pick a map'));
})();
