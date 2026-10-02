/* Text Tartan: weave any text into a 2/2 twill. Plain ES2020, one IIFE, no dependencies. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const isNode = typeof window === 'undefined';

  /* ---------- palette and letter mapping ---------- */
  const PALETTE = [
    ['K', 'black', '#1b1b1d'], ['W', 'white', '#efe7d6'], ['R', 'red', '#b5182c'], ['O', 'orange', '#d9742a'],
    ['Y', 'yellow', '#dfbb38'], ['DR', 'dark red', '#6e1220'], ['T', 'tan', '#c49a5a'], ['P', 'purple', '#5b2c6f'],
    ['B', 'blue', '#1f4e9c'], ['N', 'navy', '#182452'], ['G', 'green', '#24663a'], ['DG', 'dark green', '#10402a'],
    ['LB', 'light blue', '#5f8ec0'], ['LG', 'light green', '#6c9a4a'], ['GY', 'grey', '#868a8e'], ['BR', 'brown', '#5a3a24'],
  ];
  const DEFAULT_MAP = {
    a: 'R', e: 'Y', i: 'O', o: 'DR', u: 'T', y: 'P',
    b: 'B', c: 'DG', d: 'N', f: 'G', g: 'LG', h: 'LB', j: 'B', k: 'N', l: 'G', m: 'P', n: 'N',
    p: 'P', q: 'GY', r: 'B', s: 'DG', t: 'N', v: 'LB', w: 'GY', x: 'BR', z: 'BR',
    digit: 'W', stop: 'K', comma: 'W', dash: 'GY',
  };
  const VOWELS = 'aeiouy';
  const CONSONANTS = 'bcdfghjklmnpqrstvwxz';
  const GUARD_W = { stop: 4, comma: 2, dash: 2 };
  const MAX_STRIPE = 32, MAX_HALF_SETT = 320, MAX_WEFT = 6000, MIN_SETT_STRIPES = 8, MIN_SETT_THREADS = 48;

  const DEFAULT_TEXT = 'Jack V. Le weaves small toys out of language, libraries and the odd tartan. Each word here is a stripe, each sentence a sett; the cloth is honest about its threads, over two and under two.';

  /* ---------- threadcount derivation ---------- */
  const TOKEN_RE = /[\p{L}\p{N}'’]+|[.!?]+|[,;:]+|[\-–—"“”‘()\[\]/&*]+/gu;
  function tokenize(text) {
    const out = [];
    for (const m of (text || '').matchAll(TOKEN_RE)) {
      const s = m[0];
      if (/[\p{L}\p{N}]/u.test(s)) out.push({ kind: 'word', s });
      else if (/[.!?]/.test(s)) out.push({ kind: 'stop', s });
      else if (/[,;:]/.test(s)) out.push({ kind: 'comma', s });
      else out.push({ kind: 'dash', s });
    }
    return out;
  }
  function letterKey(ch) {
    const c = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/^[a-z]$/.test(c)) return c;
    if (/^\p{N}$/u.test(c)) return 'digit';
    const cp = c.codePointAt(0) || 0;
    return CONSONANTS[cp % CONSONANTS.length];
  }
  function wordLetters(s) { return Array.from(s.replace(/['’]/g, '')); }
  function pushStripe(list, code, n) {
    if (n <= 0) return;
    const last = list[list.length - 1];
    if (last && last.code === code) last.n += n; else list.push({ code, n });
  }
  function stripesOf(tokens, map) {
    const out = [];
    for (const t of tokens) {
      if (t.kind === 'word') {
        const letters = wordLetters(t.s);
        if (!letters.length) continue;
        pushStripe(out, map[letterKey(letters[0])] || 'GY', Math.min(MAX_STRIPE, 2 * letters.length));
      } else {
        pushStripe(out, map[t.kind] || 'K', GUARD_W[t.kind] || 2);
      }
    }
    return out;
  }
  function sentencesOf(tokens) {
    const out = []; let cur = [];
    for (const t of tokens) { cur.push(t); if (t.kind === 'stop') { out.push(cur); cur = []; } }
    if (cur.length) out.push(cur);
    return out;
  }
  const threads = (stripes) => stripes.reduce((a, s) => a + s.n, 0);
  /* The sett: the first sentence (more if it is very short), mirrored about its two end stripes. */
  function buildHalfSett(tokens, map) {
    const sents = sentencesOf(tokens);
    let half = [];
    let used = [];
    for (const s of sents) {
      used = used.concat(s);
      half = stripesOf(used, map);
      if (half.length >= MIN_SETT_STRIPES && threads(half) >= MIN_SETT_THREADS) break;
    }
    if (!half.length) half = [{ code: 'N', n: 12 }, { code: 'K', n: 4 }, { code: 'W', n: 2 }];
    // cap the half sett
    let acc = 0; const capped = [];
    for (const s of half) {
      if (acc + s.n > MAX_HALF_SETT) { if (MAX_HALF_SETT - acc > 1) capped.push({ code: s.code, n: MAX_HALF_SETT - acc }); break; }
      capped.push({ code: s.code, n: s.n }); acc += s.n;
    }
    return capped;
  }
  function fullSett(half) {
    if (half.length < 2) return half.slice();
    return half.concat(half.slice(1, -1).reverse().map((s) => ({ code: s.code, n: s.n })));
  }
  function buildWeft(tokens, map) {
    let st = stripesOf(tokens, map);
    if (!st.length) st = [{ code: 'N', n: 12 }];
    let acc = 0; const out = [];
    for (const s of st) { if (acc + s.n > MAX_WEFT) break; out.push(s); acc += s.n; }
    return out;
  }
  function expand(stripes) {
    const out = [];
    for (const s of stripes) for (let i = 0; i < s.n; i++) out.push(s.code);
    return out;
  }
  function notation(stripes, pivots) {
    return stripes.map((s, i) => s.code + ((pivots && (i === 0 || i === stripes.length - 1)) ? '/' : '') + s.n).join(' ');
  }
  function derive(textA, textB, map) {
    const tokA = tokenize(textA);
    const half = buildHalfSett(tokA, map);
    const sett = fullSett(half);
    const weftSrc = textB == null ? tokA : tokenize(textB);
    const weft = buildWeft(weftSrc, map);
    const halfB = textB == null ? half : buildHalfSett(weftSrc, map);
    return { half, sett, weft, settB: fullSett(halfB), warpCodes: expand(sett), weftCodes: expand(weft), settBCodes: expand(fullSett(halfB)) };
  }

  /* ---------- the loom: honest 2/2 twill into an ImageData ---------- */
  function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function makeThreads(codes, hex) {
    const n = Math.max(1, codes.length);
    const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = hexRgb(hex[codes[i]] || '#808080');
      r[i] = c[0]; g[i] = c[1]; b[i] = c[2];
    }
    return { n, r, g, b };
  }
  function hash(x, y) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e3779b9, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  /* weave(W, H, T, warp, weft, ox, oy) -> ImageData. T = pixels per thread. Twill: at cell (x, y),
     the warp thread is on top when (x + y) mod 4 < 2, which is the over-two under-two diagonal. */
  function weave(W, H, T, warp, weft, ox = 0, oy = 0, grain = true) {
    const img = isNode ? { data: new Uint8ClampedArray(W * H * 4), width: W, height: H } : new ImageData(W, H);
    const d = img.data;
    const prof = new Float32Array(T);
    for (let s = 0; s < T; s++) prof[s] = T === 1 ? 1 : 0.80 + 0.32 * Math.sin(Math.PI * (s + 0.5) / T);
    const xc = new Int32Array(W), sx = new Uint8Array(W), wr = new Uint8Array(W), wg = new Uint8Array(W), wb = new Uint8Array(W), pfx = new Float32Array(W);
    for (let px = 0; px < W; px++) {
      const c = Math.floor(px / T) + ox; xc[px] = c; sx[px] = px % T; pfx[px] = prof[px % T];
      const i = ((c % warp.n) + warp.n) % warp.n; wr[px] = warp.r[i]; wg[px] = warp.g[i]; wb[px] = warp.b[i];
    }
    const fibre = T > 1;
    let p = 0;
    for (let py = 0; py < H; py++) {
      const yc = Math.floor(py / T) + oy, sy = py % T;
      const j = ((yc % weft.n) + weft.n) % weft.n;
      const fr = weft.r[j], fg = weft.g[j], fb = weft.b[j], pfy = prof[sy];
      const along2 = py >> 1;
      for (let px = 0; px < W; px++) {
        const c = xc[px];
        const phase = (c + yc) & 3;
        let r, g, b, f;
        if (phase < 2) {
          r = wr[px]; g = wg[px]; b = wb[px];
          f = pfx[px];
          if (fibre) {
            f *= 0.93 + 0.14 * hash(c * 7 + 1, along2);
            if (T > 2 && ((phase === 0 && sy === 0) || (phase === 1 && sy === T - 1))) f *= 0.82;
          }
        } else {
          r = fr; g = fg; b = fb;
          f = pfy;
          if (fibre) {
            f *= 0.93 + 0.14 * hash(yc * 7 + 65537, px >> 1);
            const s = sx[px];
            if (T > 2 && ((phase === 2 && s === 0) || (phase === 3 && s === T - 1))) f *= 0.82;
          }
        }
        if (grain) f *= 0.97 + 0.06 * hash(px, py);
        d[p] = r * f; d[p + 1] = g * f; d[p + 2] = b * f; d[p + 3] = 255; p += 4;
      }
    }
    return img;
  }

  /* ---------- SVG export: the sett alone, as rects + a twill mask ---------- */
  function settSvg(warpStripes, weftStripes, hex) {
    const W = threads(warpStripes), H = threads(weftStripes);
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}" shape-rendering="crispEdges">\n`;
    s += `<title>${esc('Text Tartan sett: ' + notation(warpStripes, false))}</title>\n<defs>\n`;
    s += '<pattern id="twill" width="4" height="4" patternUnits="userSpaceOnUse">';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (((x + y) & 3) < 2) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#fff"/>`;
    s += '</pattern>\n';
    s += `<mask id="warpTop"><rect width="${W}" height="${H}" fill="url(#twill)"/></mask>\n</defs>\n`;
    s += '<g id="weft">';
    let y = 0; for (const st of weftStripes) { s += `<rect x="0" y="${y}" width="${W}" height="${st.n}" fill="${hex[st.code] || '#808080'}"/>`; y += st.n; }
    s += '</g>\n<g id="warp" mask="url(#warpTop)">';
    let x = 0; for (const st of warpStripes) { s += `<rect x="${x}" y="0" width="${st.n}" height="${H}" fill="${hex[st.code] || '#808080'}"/>`; x += st.n; }
    s += '</g>\n</svg>\n';
    return s;
  }

  if (isNode) {
    module.exports = { tokenize, derive, weave, makeThreads, settSvg, notation, PALETTE, DEFAULT_MAP, DEFAULT_TEXT, threads };
    return;
  }

  /* ---------- state ---------- */
  const params = new URLSearchParams(location.search);
  const THUMB = params.get('thumb') === '1';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const qT = Math.min(6, Math.max(1, parseInt(params.get('t') || '3', 10) || 3));
  const qView = ['scarf', 'kilt'].includes(params.get('view')) ? params.get('view') : (THUMB ? 'scarf' : 'none');
  const state = {
    mode: params.get('mode') === 'two' ? 'two' : 'one', T: THUMB ? 3 : qT, view: qView,
    map: { ...DEFAULT_MAP }, hex: Object.fromEntries(PALETTE.map((p) => [p[0], p[2]])),
    fromA: '', fromB: '', derived: null, swatches: [], registered: [], posts: [], books: [],
  };
  const els = {
    cloth: $('#cloth'), tsize: $('#tsize'), tsizeVal: $('#tsize-val'), drawer: $('#drawer'), btnDrawer: $('#btn-drawer'),
    textA: $('#textA'), textB: $('#textB'), tagName: $('#tag-name'), tagCount: $('#tag-count'), tagStats: $('#tag-stats'),
    preview: $('#preview'), previewTitle: $('#preview-title'), scarf: $('#scarf'), kilt: $('#kilt'),
    countFull: $('#count-full'), msg: $('#msg'), swatches: $('#swatches'), regList: $('#reg-list'), regName: $('#reg-name'),
    mapGrid: $('#map-grid'), palGrid: $('#pal-grid'), fromA: $('#fromA'), fromB: $('#fromB'),
  };
  const ctx = els.cloth.getContext('2d', { alpha: false });

  /* ---------- rendering the hero ---------- */
  let warpT = null, weftT = null, settT = null, settBT = null;
  function prepareThreads() {
    const d = state.derived;
    warpT = makeThreads(d.warpCodes, state.hex);
    weftT = makeThreads(d.weftCodes, state.hex);
    settT = warpT;
    settBT = state.mode === 'two' ? makeThreads(d.settBCodes, state.hex) : warpT;
  }
  function renderHero() {
    const bench = $('#bench');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, bench.clientWidth), ch = Math.max(1, bench.clientHeight);
    const T = Math.max(1, Math.round(state.T * dpr));
    const W = Math.ceil(cw * dpr), H = Math.ceil(ch * dpr);
    if (els.cloth.width !== W || els.cloth.height !== H) { els.cloth.width = W; els.cloth.height = H; }
    ctx.putImageData(weave(W, H, T, warpT, weftT), 0, 0);
    els.cloth.classList.toggle('fine', state.T <= 1);
  }
  function renderTile(canvas, warp, weft, T, w, h) {
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d', { alpha: false }).putImageData(weave(w, h, T, warp, weft), 0, 0);
  }

  /* ---------- the woven label ---------- */
  function nameOf(text, from) {
    if (from) return from;
    const words = (text || '').trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
    return words.replace(/[.,;:!?]+$/, '') || 'untitled';
  }
  function currentName() {
    const a = nameOf(els.textA.value, state.fromA);
    return state.mode === 'two' ? `${a} × ${nameOf(els.textB.value, state.fromB)}` : a;
  }
  function updateLabel() {
    const d = state.derived;
    const half = notation(d.half, true);
    els.tagName.textContent = currentName();
    els.tagCount.textContent = half;
    const settN = threads(d.sett), weftN = threads(d.weft);
    els.tagStats.innerHTML = `sett <b>${settN}</b> threads · 2/2 twill · weft <b>${weftN.toLocaleString()}</b> threads ${state.mode === 'two' ? 'from the second text' : 'from the whole text'} · <b>${state.T} px</b>/thread`;
    const weftNote = notation(d.weft, false);
    els.countFull.textContent = `Sett (half, pivots marked): ${half}\nFull sett: ${notation(d.sett, false)}\n\nWeft order (${weftN.toLocaleString()} threads${weftNote.length > 900 ? ', first part' : ''}): ${weftNote.slice(0, 900)}${weftNote.length > 900 ? ' …' : ''}`;
  }

  /* ---------- scarf preview (SVG) ---------- */
  function scarfSvg() {
    const pw = 100, ph = 240, T = 3;
    const c = document.createElement('canvas');
    renderTile(c, warpT, weftT, T, pw * T, ph * T);
    const href = c.toDataURL('image/png');
    const warpHex = (i) => state.hex[state.derived.warpCodes[i % state.derived.warpCodes.length]] || '#888';
    const fringeOf = (x0, y0, w, dir) => {
      let s = '';
      for (let i = 0; i < w; i += 2) {
        const col = warpHex(i + (dir === 'back' ? 10 : 0));
        const dx = (hash(i, dir === 'back' ? 3 : 5) - 0.5) * 6;
        const len = 16 + hash(i, 9) * 9;
        const yy = y0 + Math.sin((x0 + i) / 11) * 2.5;
        s += `<path d="M${x0 + i + 1} ${yy.toFixed(1)} q ${(dx / 2).toFixed(1)} ${(len / 2).toFixed(1)} ${dx.toFixed(1)} ${len.toFixed(1)}" stroke="${col}" stroke-width="1.3" fill="none" stroke-linecap="round" opacity="${dir === 'back' ? 0.75 : 1}"/>`;
      }
      return s;
    };
    const fringeBack = fringeOf(178, 206, pw, 'back');
    const fringeFront = fringeOf(108, 262, pw, 'front');
    const panel = (x0, y0, y1, w) => {
      let d = `M${x0} ${y0} L${x0 + w} ${y0} L${x0 + w} ${y1}`;
      for (let i = w; i >= 0; i -= 4) d += ` L${x0 + i} ${(y1 + Math.sin((x0 + i) / 11) * 2.5).toFixed(1)}`;
      return d + ' Z';
    };
    const backPath = panel(178, 42, 206, pw);
    const frontPath = panel(108, 42, 262, pw);
    els.scarf.innerHTML = `
      <defs>
        <pattern id="clothBack" patternUnits="userSpaceOnUse" x="178" y="-60" width="${pw}" height="${ph}"><image href="${href}" width="${pw}" height="${ph}" preserveAspectRatio="none"/></pattern>
        <pattern id="clothFront" patternUnits="userSpaceOnUse" x="108" y="30" width="${pw}" height="${ph}"><image href="${href}" width="${pw}" height="${ph}" preserveAspectRatio="none"/></pattern>
        <linearGradient id="shadeX" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.42"/><stop offset="0.22" stop-color="#000" stop-opacity="0.04"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.78" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.38"/></linearGradient>
        <linearGradient id="shadeBack" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.6"/><stop offset="0.4" stop-color="#000" stop-opacity="0.3"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>
        <linearGradient id="fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient>
        <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a33"/><stop offset="0.45" stop-color="#5a3620"/><stop offset="1" stop-color="#2d1a0d"/></linearGradient>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2614"/><stop offset="1" stop-color="#1c1008"/></linearGradient>
        <filter id="soft" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <rect width="360" height="300" fill="url(#wall)"/>
      <ellipse cx="195" cy="274" rx="120" ry="14" fill="#000" opacity="0.35" filter="url(#soft)"/>
      <rect x="26" y="30" width="308" height="12" rx="6" fill="url(#rail)"/>
      <circle cx="30" cy="36" r="7" fill="#6b4324"/><circle cx="330" cy="36" r="7" fill="#6b4324"/>
      <g>
        <path d="${backPath}" fill="url(#clothBack)"/>
        <path d="${backPath}" fill="url(#shadeBack)"/>
        ${fringeBack}
      </g>
      <g>
        <path d="M104 44 L214 44 L214 70 L104 70 Z" fill="#000" opacity="0.4" filter="url(#soft)"/>
        <path d="${frontPath}" fill="url(#clothFront)"/>
        <path d="${frontPath}" fill="url(#shadeX)"/>
        <rect x="108" y="42" width="170" height="16" fill="url(#fold)"/>
        ${fringeFront}
      </g>
      <path d="M108 42 L278 42 L278 45 L108 45 Z" fill="#fff" opacity="0.14"/>`;
  }

  /* ---------- kilt pleat preview (canvas) ---------- */
  function kiltDraw() {
    const k = els.kilt, kc = k.getContext('2d');
    const W = k.width, H = k.height;
    const settW = state.derived.warpCodes.length;
    const T = 2;
    const srcW = Math.max(settW * T, 120), srcH = H;
    const src = document.createElement('canvas');
    renderTile(src, warpT, weftT, T, srcW, srcH);
    kc.fillStyle = '#1c1008'; kc.fillRect(0, 0, W, H);
    const bandH = 54, pleatTop = bandH, pleatH = H - bandH;
    const pw = 60, n = Math.ceil(W / pw) + 1;
    const perSett = Math.max(1, Math.round(srcW / 120));
    const cycle = srcW / perSett;
    for (let i = 0; i < n; i++) {
      const sx = (i * cycle) % srcW;
      const x = i * pw;
      const grab = Math.min(pw, srcW - sx);
      kc.drawImage(src, sx, pleatTop, grab, pleatH, x, pleatTop, grab, pleatH);
      if (grab < pw) kc.drawImage(src, 0, pleatTop, pw - grab, pleatH, x + grab, pleatTop, pw - grab, pleatH);
      let g = kc.createLinearGradient(x, 0, x + pw * 0.45, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      kc.fillStyle = g; kc.fillRect(x, pleatTop, pw * 0.45, pleatH);
      g = kc.createLinearGradient(x + pw - 10, 0, x + pw, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.14)');
      kc.fillStyle = g; kc.fillRect(x + pw - 10, pleatTop, 10, pleatH);
      kc.fillStyle = 'rgba(0,0,0,0.35)'; kc.fillRect(x, pleatTop, 1, pleatH);
    }
    // waistband: the cloth flat, then a stitched line and a belt shadow
    for (let x = 0; x < W; x += srcW) kc.drawImage(src, 0, 0, Math.min(srcW, W - x), bandH, x, 0, Math.min(srcW, W - x), bandH);
    let g = kc.createLinearGradient(0, 0, 0, bandH);
    g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.6, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    kc.fillStyle = g; kc.fillRect(0, 0, W, bandH);
    kc.strokeStyle = 'rgba(235,223,198,0.35)'; kc.setLineDash([4, 5]); kc.lineWidth = 1;
    kc.beginPath(); kc.moveTo(0, bandH - 6.5); kc.lineTo(W, bandH - 6.5); kc.stroke(); kc.setLineDash([]);
    g = kc.createLinearGradient(0, bandH, 0, bandH + 26);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    kc.fillStyle = g; kc.fillRect(0, bandH, W, 26);
    g = kc.createLinearGradient(0, H - 40, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    kc.fillStyle = g; kc.fillRect(0, H - 40, W, 40);
    kc.fillStyle = 'rgba(0,0,0,0.45)'; kc.fillRect(0, H - 3, W, 3);
  }

  function renderPreview() {
    const v = state.view;
    els.preview.classList.toggle('show', v !== 'none');
    document.body.classList.toggle('previewing', v !== 'none');
    $$('#loom [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'none') return;
    els.previewTitle.textContent = v === 'scarf' ? 'Scarf' : 'Kilt pleats';
    els.scarf.style.display = v === 'scarf' ? 'block' : 'none';
    els.kilt.style.display = v === 'kilt' ? 'block' : 'none';
    if (v === 'scarf') scarfSvg(); else kiltDraw();
  }

  /* ---------- swatches and register ---------- */
  function snapshot() {
    return {
      name: currentName(), mode: state.mode, textA: els.textA.value, textB: els.textB.value,
      fromA: state.fromA, fromB: state.fromB, map: { ...state.map }, hex: { ...state.hex },
      count: notation(state.derived.half, true), date: new Date().toISOString().slice(0, 10),
    };
  }
  function drawSwatch(canvas, snap) {
    const d = derive(snap.textA, snap.mode === 'two' ? snap.textB : null, snap.map);
    const warp = makeThreads(d.warpCodes, snap.hex), weft = makeThreads(snap.mode === 'two' ? d.settBCodes : d.warpCodes, snap.hex);
    const n = Math.min(400, Math.max(d.warpCodes.length, 64));
    renderTile(canvas, warp, weft, 1, n, n);
  }
  function pushSwatch() {
    const snap = snapshot();
    const key = snap.count + '|' + snap.mode + '|' + (snap.mode === 'two' ? notation(state.derived.weft, false).slice(0, 200) : '');
    if (state.swatches.length && state.swatches[0].key === key) return;
    state.swatches = [{ key, snap }].concat(state.swatches.filter((s) => s.key !== key)).slice(0, 8);
    renderSwatches();
  }
  function renderSwatches() {
    els.swatches.innerHTML = '';
    state.swatches.forEach((s, i) => {
      const b = document.createElement('button'); b.className = 'swatch' + (i === 0 ? ' cur' : ''); b.type = 'button'; b.title = s.snap.count;
      const c = document.createElement('canvas'); drawSwatch(c, s.snap);
      const lab = document.createElement('span'); lab.textContent = s.snap.name;
      b.append(c, lab); b.addEventListener('click', () => restore(s.snap));
      els.swatches.appendChild(b);
    });
  }
  function restore(snap) {
    state.mode = snap.mode; state.map = { ...snap.map }; state.hex = { ...snap.hex };
    els.textA.value = snap.textA; els.textB.value = snap.textB; state.fromA = snap.fromA || ''; state.fromB = snap.fromB || '';
    syncMode(); buildMapEditor(); recompute(true);
  }
  function loadRegister() {
    try { state.registered = JSON.parse(localStorage.getItem('text-tartan-register') || '[]'); } catch (e) { state.registered = []; }
    if (!Array.isArray(state.registered)) state.registered = [];
  }
  function saveRegister() {
    try { localStorage.setItem('text-tartan-register', JSON.stringify(state.registered)); } catch (e) { say('could not save (storage blocked)'); }
  }
  function renderRegister() {
    els.regList.innerHTML = '';
    if (!state.registered.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No tartans registered in this browser yet.'; els.regList.appendChild(p); return; }
    state.registered.forEach((snap, i) => {
      const row = document.createElement('div'); row.className = 'reg';
      const c = document.createElement('canvas'); drawSwatch(c, snap);
      const mid = document.createElement('div');
      const rn = document.createElement('div'); rn.className = 'rn'; rn.textContent = snap.name;
      const rc = document.createElement('div'); rc.className = 'rc'; rc.textContent = `${snap.date} · ${snap.count}`;
      mid.append(rn, rc);
      const acts = document.createElement('div'); acts.className = 'ra';
      const load = document.createElement('button'); load.className = 'btn small'; load.type = 'button'; load.textContent = 'load'; load.addEventListener('click', () => restore(snap));
      const del = document.createElement('button'); del.className = 'btn small'; del.type = 'button'; del.textContent = '×'; del.title = 'remove';
      del.addEventListener('click', () => { state.registered.splice(i, 1); saveRegister(); renderRegister(); });
      acts.append(load, del);
      row.append(c, mid, acts);
      els.regList.appendChild(row);
    });
  }
  function register() {
    const snap = snapshot();
    const nm = els.regName.value.trim();
    snap.name = nm || snap.name;
    state.registered = [snap].concat(state.registered.filter((r) => r.name !== snap.name)).slice(0, 40);
    saveRegister(); renderRegister(); els.regName.value = '';
    say(`registered "${snap.name}"`);
  }
  let msgTimer = 0;
  function say(t) { els.msg.textContent = t; clearTimeout(msgTimer); msgTimer = setTimeout(() => { els.msg.textContent = ''; }, 2600); }

  /* ---------- exports ---------- */
  function download(name, blob) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tartan';
  function exportPng() {
    say('weaving 2048 px…');
    requestAnimationFrame(() => {
      const c = document.createElement('canvas');
      renderTile(c, warpT, weftT, 4, 2048, 2048);
      c.toBlob((b) => { if (b) download(`text-tartan-${slug(currentName())}.png`, b); say('PNG saved'); }, 'image/png');
    });
  }
  function exportSvg() {
    const d = state.derived;
    const svg = settSvg(d.sett, state.mode === 'two' ? d.settB : d.sett, state.hex);
    download(`text-tartan-${slug(currentName())}-sett.svg`, new Blob([svg], { type: 'image/svg+xml' }));
    say('SVG saved');
  }
  function copyCount() {
    const t = els.countFull.textContent;
    const done = () => say('threadcount copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => say('copy blocked'));
    else say('copy not available');
  }

  /* ---------- palette editor ---------- */
  function buildMapEditor() {
    els.mapGrid.innerHTML = '';
    const keys = [...VOWELS].concat([...CONSONANTS]).sort().concat(['digit', 'stop', 'comma', 'dash']);
    const labels = { digit: '0-9', stop: '. ! ?', comma: ', ; :', dash: '- " ( )' };
    for (const k of keys) {
      const cell = document.createElement('label'); cell.className = 'map-cell';
      const kk = document.createElement('span'); kk.className = 'k ' + (labels[k] ? 'p' : VOWELS.includes(k) ? 'w' : 'c'); kk.textContent = labels[k] || k;
      const sel = document.createElement('select'); sel.setAttribute('aria-label', `colour for ${labels[k] || k}`);
      for (const p of PALETTE) { const o = document.createElement('option'); o.value = p[0]; o.textContent = p[0]; sel.appendChild(o); }
      sel.value = state.map[k] || 'GY';
      sel.addEventListener('change', () => { state.map[k] = sel.value; recompute(false); });
      cell.append(kk, sel); els.mapGrid.appendChild(cell);
    }
    els.palGrid.innerHTML = '';
    for (const p of PALETTE) {
      const cell = document.createElement('label'); cell.className = 'pal-cell';
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = state.hex[p[0]]; inp.setAttribute('aria-label', `${p[1]} (${p[0]})`);
      inp.addEventListener('input', () => { state.hex[p[0]] = inp.value; recompute(false); });
      const code = document.createElement('span'); code.className = 'code'; code.textContent = p[0];
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p[1];
      cell.append(inp, code, nm); els.palGrid.appendChild(cell);
    }
  }

  /* ---------- recompute pipeline ---------- */
  let renderQueued = false;
  function recompute(swatch) {
    const a = els.textA.value, b = state.mode === 'two' ? els.textB.value : null;
    state.derived = derive(a, b, state.map);
    prepareThreads();
    updateLabel();
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(() => { renderQueued = false; renderHero(); renderPreview(); });
    }
    if (swatch) pushSwatch();
  }
  let debounceTimer = 0;
  function onText() { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => recompute(true), 260); }

  function syncMode() {
    document.body.classList.toggle('two', state.mode === 'two');
    $$('#drawer [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
    $('#lblA').textContent = state.mode === 'two' ? 'Warp text (its first sentence is the sett)' : 'Text (sett from its first sentence, weft from the whole)';
  }

  /* ---------- sources: blog posts and library titles ---------- */
  function stripMarkdown(md) {
    let t = md.replace(/^﻿/, '');
    if (t.startsWith('---')) { const end = t.indexOf('\n---', 3); if (end > 0) t = t.slice(end + 4); }
    t = t.replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+(.*)$/gm, (m, t) => (/[.!?:]$/.test(t.trim()) ? t.trim() : t.trim() + '.'))
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/[*_`~]+/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n\n').trim();
    return t.slice(0, 2000);
  }
  const postCache = new Map();
  async function fetchPost(p) {
    if (postCache.has(p.file)) return postCache.get(p.file);
    const r = await fetch('../../blog/posts/' + p.file);
    if (!r.ok) throw new Error('post ' + r.status);
    const t = stripMarkdown(await r.text());
    postCache.set(p.file, t);
    return t;
  }
  function setText(which, text, from) {
    const ta = which === 'A' ? els.textA : els.textB;
    ta.value = text;
    if (which === 'A') { state.fromA = from; els.fromA.textContent = from ? 'from: ' + from : ''; }
    else { state.fromB = from; els.fromB.textContent = from ? 'from: ' + from : ''; }
    recompute(true);
  }
  function bookText(b) {
    const parts = [b.t + (b.a ? ' by ' + b.a : '') + '.'];
    if (b.d) parts.push(b.d);
    return parts.join(' ');
  }
  function wireSources(which) {
    const post = $('#post' + which), book = $('#book' + which), rand = $('#rand' + which);
    post.addEventListener('change', async () => {
      const p = state.posts[post.value]; if (!p) return;
      try { setText(which, await fetchPost(p), p.title); } catch (e) { say('could not load that post'); }
      post.value = '';
    });
    book.addEventListener('change', () => {
      const b = state.books[book.value]; if (!b) return;
      setText(which, bookText(b), b.t); book.value = '';
    });
    rand.addEventListener('click', () => {
      if (!state.books.length) { say('library not loaded'); return; }
      const b = state.books[Math.floor(Math.random() * state.books.length)];
      setText(which, bookText(b), b.t);
    });
  }
  function fillSelect(sel, items, label) {
    for (const [i, it] of items.entries()) { const o = document.createElement('option'); o.value = String(i); o.textContent = label(it); sel.appendChild(o); }
  }
  async function loadSources() {
    try {
      const r = await fetch('../../blog/index.json');
      if (!r.ok) throw new Error('index ' + r.status);
      const posts = await r.json();
      state.posts = posts.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      for (const id of ['#postA', '#postB']) fillSelect($(id), state.posts, (p) => `${p.date}  ${p.title}`);
    } catch (e) {
      for (const id of ['#postA', '#postB']) { const o = $(id).querySelector('option'); o.textContent = 'blog posts unavailable'; $(id).disabled = true; }
    }
    try {
      const r = await fetch('../../assets/data/library.json');
      if (!r.ok) throw new Error('library ' + r.status);
      const lib = await r.json();
      state.books = (lib.books || []).filter((b) => b.t).slice().sort((a, b) => a.t.localeCompare(b.t));
      for (const id of ['#bookA', '#bookB']) fillSelect($(id), state.books, (b) => b.t);
    } catch (e) {
      for (const id of ['#bookA', '#bookB']) { const o = $(id).querySelector('option'); o.textContent = 'library unavailable'; $(id).disabled = true; }
      $('#randA').disabled = true; $('#randB').disabled = true;
    }
  }
  /* the two-text demo: warp from the latest post, weft from an older one */
  async function twoTextDemo() {
    if (!state.posts.length) return;
    const latest = state.posts[0], older = state.posts[Math.min(state.posts.length - 1, 3)];
    try {
      if (els.textA.value === DEFAULT_TEXT) setText('A', await fetchPost(latest), latest.title);
      if (!els.textB.value.trim()) setText('B', await fetchPost(older), older.title);
    } catch (e) { say('could not load the demo posts'); }
  }

  /* ---------- wiring ---------- */
  function openDrawer(on) {
    els.drawer.classList.toggle('open', on);
    els.btnDrawer.setAttribute('aria-expanded', String(on));
    els.btnDrawer.classList.toggle('on', on);
  }
  els.btnDrawer.addEventListener('click', () => openDrawer(!els.drawer.classList.contains('open')));
  $('#btn-close').addEventListener('click', () => openDrawer(false));
  $('#btn-help').addEventListener('click', () => $('#help').classList.add('show'));
  $('#btn-help-close').addEventListener('click', () => $('#help').classList.remove('show'));
  $('#help').addEventListener('click', (e) => { if (e.target === $('#help')) $('#help').classList.remove('show'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#help').classList.remove('show'); openDrawer(false); } });
  els.tsize.addEventListener('input', () => {
    state.T = +els.tsize.value; els.tsizeVal.textContent = state.T + ' px';
    updateLabel();
    if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderHero(); }); }
  });
  $$('#loom [data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; renderPreview(); }));
  $('#btn-preview-close').addEventListener('click', () => { state.view = 'none'; renderPreview(); });
  $$('#drawer [data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode; syncMode(); recompute(true);
    if (state.mode === 'two') twoTextDemo();
  }));
  els.textA.addEventListener('input', () => { state.fromA = ''; els.fromA.textContent = ''; onText(); });
  els.textB.addEventListener('input', () => { state.fromB = ''; els.fromB.textContent = ''; onText(); });
  $('#btn-copy').addEventListener('click', copyCount);
  $('#btn-png').addEventListener('click', exportPng);
  $('#btn-svg').addEventListener('click', exportSvg);
  $('#btn-register').addEventListener('click', register);
  els.regName.addEventListener('keydown', (e) => { if (e.key === 'Enter') register(); });
  $('#btn-reset-map').addEventListener('click', () => {
    state.map = { ...DEFAULT_MAP }; state.hex = Object.fromEntries(PALETTE.map((p) => [p[0], p[2]]));
    buildMapEditor(); recompute(true);
  });
  wireSources('A'); wireSources('B');
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderHero(); }, reduced ? 0 : 80); });

  /* ---------- boot ---------- */
  els.textA.value = DEFAULT_TEXT;
  if (THUMB) document.body.classList.add('thumb');
  if (params.get('drawer') === '1') openDrawer(true);
  els.tsize.value = String(state.T); els.tsizeVal.textContent = state.T + ' px';
  syncMode(); buildMapEditor(); loadRegister(); renderRegister();
  recompute(true);
  loadSources().then(() => { if (state.mode === 'two') twoTextDemo(); });
})();
