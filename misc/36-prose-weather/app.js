// Prose Weather: the broadcast. DOM only; the meteorology lives in meteorology.js.
(function () {
  'use strict';
  const PW = window.ProseWeather, LEX = window.PW_AFINN || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const params = new URLSearchParams(location.search);
  const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  const dayName = d => DAYN[(today.getDay() + d) % 7].slice(0, 3);

  const state = { posts: [], texts: {}, cache: {}, cur: null, curName: '', cmp: null, cmpName: '' };

  // ---------- weather icons (SVG, animated by CSS classes) ----------
  function cloud(x, y, s, fill, cls, stroke) {
    return `<path class="${cls || ''}" transform="translate(${x} ${y}) scale(${s})" d="M-30 14 H26 a13 13 0 0 0 1 -26 a17 17 0 0 0 -32 -9 a14 14 0 0 0 -25 11 a12 12 0 0 0 0 24 z" fill="${fill}" stroke="${stroke || 'rgba(0,10,40,0.35)'}" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  function sun(x, y, r) {
    let rays = '';
    for (let i = 0; i < 8; i++) { const a = i * 45 * Math.PI / 180; rays += `<line x1="${(x + Math.cos(a) * (r + 7)).toFixed(1)}" y1="${(y + Math.sin(a) * (r + 7)).toFixed(1)}" x2="${(x + Math.cos(a) * (r + 17)).toFixed(1)}" y2="${(y + Math.sin(a) * (r + 17)).toFixed(1)}" stroke="var(--sun)" stroke-width="5" stroke-linecap="round"/>`; }
    return `<g class="sun-rays" style="transform-origin:${x}px ${y}px">${rays}</g><circle class="sun-core" style="transform-origin:${x}px ${y}px" cx="${x}" cy="${y}" r="${r}" fill="var(--sun)" stroke="#e0a800" stroke-width="2"/>`;
  }
  const drops = (x, y, n, color, w) => `<g>${Array.from({ length: n }, (_, i) => `<line class="drop" x1="${x + i * 11}" y1="${y}" x2="${x + i * 11 - 3}" y2="${y + 10}" stroke="${color}" stroke-width="${w || 3}" stroke-linecap="round"/>`).join('')}</g>`;
  const flakes = (x, y, n) => `<g>${Array.from({ length: n }, (_, i) => `<circle class="flake" cx="${x + i * 12}" cy="${y}" r="3" fill="var(--snow)"/>`).join('')}</g>`;
  function iconSVG(kind) {
    let inner = '';
    switch (kind) {
      case 'clear': inner = sun(50, 50, 22); break;
      case 'partly': inner = sun(36, 36, 17) + cloud(58, 62, 0.85, 'var(--cloud)', 'cloud-a'); break;
      case 'cloudy': inner = cloud(40, 44, 0.75, 'var(--cloud-dark)', 'cloud-b') + cloud(56, 62, 0.95, 'var(--cloud)', 'cloud-a'); break;
      case 'rain': inner = cloud(50, 42, 0.95, 'var(--cloud-dark)', 'cloud-a') + drops(30, 66, 5, 'var(--rain)'); break;
      case 'snow': inner = cloud(50, 42, 0.95, 'var(--cloud)', 'cloud-a') + flakes(28, 66, 5); break;
      case 'thunder': inner = cloud(50, 40, 1, '#4a5a7a', 'cloud-a', '#1d2740') + drops(26, 64, 3, 'var(--rain)', 2.5) + `<polygon class="bolt" points="58,46 44,70 54,70 46,92 68,62 57,62 66,46" fill="var(--bolt)" stroke="#d6b800" stroke-width="1.5" stroke-linejoin="round"/>`; break;
      case 'fog': inner = cloud(50, 40, 0.9, 'var(--cloud-dark)', 'cloud-a') + `<g>${[64, 74, 84].map((y, i) => `<line class="fogline" x1="${22 + i * 4}" y1="${y}" x2="${74 - i * 6}" y2="${y}" stroke="var(--cloud)" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`).join('')}</g>`; break;
    }
    return `<svg class="wx" viewBox="0 0 100 100" aria-label="${PW.COND_LABEL[kind]}">${inner}</svg>`;
  }

  function tempColor(F) {
    const stops = [[30, [78, 163, 255]], [55, [190, 214, 245]], [62, [240, 236, 220]], [72, [255, 160, 70]], [90, [255, 59, 59]]];
    if (F <= stops[0][0]) return `rgb(${stops[0][1]})`;
    for (let i = 1; i < stops.length; i++) if (F <= stops[i][0]) { const t = (F - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]); const c = stops[i - 1][1].map((v, k) => Math.round(v + (stops[i][1][k] - v) * t)); return `rgb(${c})`; }
    return `rgb(${stops[stops.length - 1][1]})`;
  }
  window.ProseWeatherUI = { iconSVG, tempColor };
  const f0 = x => Math.round(x), f1 = x => x.toFixed(1);
  const sTemp = s => PW.tempF(s.score, s.nScored);

  // ---------- highlighting ----------
  const HL = {
    temp: s => (w, lw) => { const m = s.scored.find(x => x.w === lw); return m ? { cls: m.s > 0 ? 'pos' : 'neg', sup: (m.s > 0 ? '+' : '') + m.s } : null; },
    none: () => () => null,
    fn: () => (w, lw) => PW.FUNCTION_WORDS.has(lw) ? {} : null,
    rep: s => { const c = {}; s.words.forEach(w => c[w] = (c[w] || 0) + 1); return (w, lw) => c[lw] > 1 && !PW.FUNCTION_WORDS.has(lw) ? { sup: '×' + c[lw] } : null; },
    syl: () => (w, lw) => { const n = PW.syllables(lw); return n >= 3 ? { sup: n } : null; },
    hot: s => (w, lw) => s.hot.includes(lw) ? {} : null,
    first: () => (w, lw, i) => i === 0 ? {} : null,
    punct: ch => () => null
  };
  function sentenceHTML(s, hl, punct) {
    const fn = (hl || HL.none)(s);
    let i = 0;
    let html = s.text.replace(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]|[,;!?]|—|--|–/g, m => {
      if (/^[A-Za-z]/.test(m)) {
        const lw = m.toLowerCase().replace(/’/g, "'"); const r = fn(m, lw, i++);
        if (!r) return esc(m);
        return `<mark class="${r.cls || ''}">${esc(m)}${r.sup !== undefined ? `<sup>${esc(r.sup)}</sup>` : ''}</mark>`;
      }
      if (punct && punct.test(m)) return `<mark>${esc(m)}</mark>`;
      return esc(m);
    });
    return html;
  }
  function evidence(title, lead, sents, hl, punct, meta) {
    $('ov-title').textContent = title;
    $('ov-lead').innerHTML = lead;
    const seen = new Set();
    const list = sents.filter(s => s && !seen.has(s.idx) && seen.add(s.idx));
    $('ov-list').innerHTML = list.length ? list.map(s => `<div class="ev"><div class="m">¶ ${s.para + 1} · sentence ${s.inPara + 1} · ${s.n} words · ${f0(sTemp(s))} °F${meta ? ' · ' + meta(s) : ''}</div><div class="t">${sentenceHTML(s, hl, punct)}</div></div>`).join('') : '<div class="ev"><div class="t">No sentences to show.</div></div>';
    $('overlay').classList.add('show');
    $('ov-list').scrollTop = 0;
  }
  function closeOverlay() { $('overlay').classList.remove('show'); }

  // ---------- current conditions ----------
  function renderConditions(A, name) {
    const t = A.total, S = A.sents;
    $('cond-sub').textContent = `${name} · ${t.n} words · ${t.sentences} sentences · ${A.paras.length} paragraphs`;
    if (!t.n) { $('cond-body').innerHTML = '<div class="msg">No prose found. Paste something with sentences in it.</div>'; return; }
    const p = t.precip;
    const uvLabel = t.uv < 3 ? 'low' : t.uv < 6 ? 'moderate' : t.uv < 8 ? 'high' : t.uv < 11 ? 'very high' : 'extreme';
    const html = `
      <div class="now">
        <div class="icon" id="big-icon" title="why ${PW.COND_LABEL[t.condition].toLowerCase()}?">${iconSVG(t.condition)}</div>
        <div>
          <div class="temp" id="st-temp" title="warmest and coldest sentences">${f0(t.tempF)}<sup>°F</sup><span class="c">${f0(t.tempC)} °C · ${t.nScored} scored words</span></div>
          <div class="cond">${PW.COND_LABEL[t.condition]}</div>
        </div>
      </div>
      <div class="stats">
        <div class="stat" id="st-wind"><div class="k">Wind</div><div class="v">${f0(t.wind)}<small>mph</small></div><div class="d">gusts to ${f0(t.gust)} · σ ${f1(t.sd)} words</div></div>
        <div class="stat" id="st-hum"><div class="k">Humidity</div><div class="v">${f0(t.humidity)}<small>%</small></div><div class="d">function words</div></div>
        <div class="stat" id="st-vis"><div class="k">Visibility</div><div class="v">${f1(t.visibility)}<small>mi</small></div><div class="d">${t.meanSyl.toFixed(2)} syllables / word</div></div>
        <div class="stat" id="st-uv"><div class="k">UV index</div><div class="v">${t.uv >= 11 ? '11+' : f1(t.uv)}<small>${uvLabel}</small></div><div class="d">${t.caps} CAPS · ${t.emph} emphasised</div></div>
        <div class="stat wide" id="st-precip"><div class="k">Precipitation</div><div class="v">${t.precipIn.toFixed(2)}<small>in</small><small>· ${p.commas + p.semis + p.dashes + p.bangs + p.qs} marks</small></div>
          <div class="precip-row">
            <span class="p" data-k="commas" title="commas per 100 words"><b>${f1(p.commasR)}</b> drizzle ,</span>
            <span class="p" data-k="semis" title="semicolons per 100 words"><b>${f1(p.semisR)}</b> sleet ;</span>
            <span class="p" data-k="dashes" title="em-dashes per 100 words"><b>${f1(p.dashesR)}</b> hail —</span>
            <span class="p" data-k="bangs" title="exclamation marks per 100 words"><b>${f1(p.bangsR)}</b> thunder !</span>
            <span class="p" data-k="qs" title="question marks per 100 words"><b>${f1(p.qsR)}</b> fog ?</span>
          </div></div>
      </div>
      <div class="dials">
        <div class="dial" id="st-pres"><div class="k">Pressure · MATTR ${t.ttr.toFixed(2)}</div>${barometer(t.pressure)}<div class="v">${f0(t.pressure)}<small>mb</small></div></div>
        <div class="dial" id="st-rose"><div class="k">Openers rose</div>${windRose(t.rose)}</div>
      </div>`;
    $('cond-body').innerHTML = html;
    const warm = S.slice().sort((a, b) => sTemp(b) - sTemp(a));
    $('st-temp').onclick = $('big-icon').onclick = () => evidence(`${f0(t.tempF)} °F · ${PW.COND_LABEL[t.condition]}`, `<b>Warmest</b> and <b>coldest</b> sentences by AFINN valence. ${esc(whyCondition(t))}`, warm.slice(0, 4).concat(warm.slice(-4).reverse()), HL.temp);
    const byLen = S.slice().sort((a, b) => b.n - a.n);
    $('st-wind').onclick = () => evidence(`Wind ${f0(t.wind)} mph, gusting to ${f0(t.gust)}`, `Mean sentence length ${f1(t.wind)} words, σ ${f1(t.sd)}. The longest sentences, then the shortest.`, byLen.slice(0, 5).concat(byLen.slice(-3).reverse()), HL.none);
    $('st-hum').onclick = () => evidence(`Humidity ${f0(t.humidity)}%`, `Function words are highlighted. The dampest sentences first.`, S.filter(s => s.n >= 6).sort((a, b) => b.fn / b.n - a.fn / a.n).slice(0, 8), HL.fn, null, s => `${f0(100 * s.fn / s.n)}% damp`);
    $('st-vis').onclick = () => evidence(`Visibility ${f1(t.visibility)} mi`, `Mean word length ${t.meanSyl.toFixed(2)} syllables. Words of three or more syllables are highlighted; the murkiest sentences first.`, S.filter(s => s.n >= 5).sort((a, b) => b.syl / b.n - a.syl / a.n).slice(0, 8), HL.syl, null, s => `${(s.syl / s.n).toFixed(2)} syl/word`);
    $('st-uv').onclick = () => evidence(`UV index ${t.uv >= 11 ? '11+' : f1(t.uv)}`, `${t.caps} words in ALL CAPS and ${t.emph} in italic or bold, per 100 words. The brightest sentences first.`, S.filter(s => s.hot.length).sort((a, b) => b.hot.length - a.hot.length).slice(0, 10), HL.hot);
    $('st-pres').onclick = () => evidence(`Pressure ${f0(t.pressure)} mb`, `Moving-average type/token ratio ${t.ttr.toFixed(2)} over 100-word windows. Sentences that repeat themselves most (repeated content words highlighted).`, S.filter(s => s.n >= 8).sort((a, b) => (new Set(a.words).size / a.n) - (new Set(b.words).size / b.n)).slice(0, 8), HL.rep, null, s => `${new Set(s.words).size}/${s.n} distinct`);
    const PK = { commas: ['Drizzle', 'commas', /,/], semis: ['Sleet', 'semicolons', /;/], dashes: ['Hail', 'em-dashes', /—|--|–/], bangs: ['Thunder', 'exclamation marks', /!/], qs: ['Fog', 'question marks', /\?/] };
    $('st-precip').onclick = e => {
      const k = e.target.closest('.p') ? e.target.closest('.p').dataset.k : null;
      if (k) { const [nm, what, re] = PK[k]; evidence(`${nm}: ${p[k]} ${what}`, `${f1(p[k + 'R'])} ${what} per 100 words. Sentences with the most first.`, S.filter(s => s[k]).sort((a, b) => b[k] - a[k]).slice(0, 10), HL.none, re, s => `${s[k]} ${what}`); }
      else evidence(`Precipitation ${t.precipIn.toFixed(2)} in`, `${p.commas} commas, ${p.semis} semicolons, ${p.dashes} em-dashes, ${p.bangs} exclamation marks, ${p.qs} question marks. The wettest sentences first.`, S.slice().sort((a, b) => wet(b) - wet(a)).slice(0, 8), HL.none, /[,;!?]|—|--|–/, s => `${wet(s)} marks`);
    };
    $('st-rose').querySelectorAll('.rose-petal').forEach(el => el.onclick = () => { const k = el.dataset.k; evidence(`Openers: ${k}`, `${t.rose[k]} of ${t.sentences} sentences begin with ${k === 'other' ? 'a content word (noun, verb, adjective…)' : 'a ' + k}.`, S.filter(s => s.opener === k).slice(0, 12), HL.first); });
  }
  const wet = s => s.commas + s.semis + s.dashes + s.bangs + s.qs;
  function whyCondition(t) {
    const p = t.precip;
    switch (t.condition) {
      case 'thunder': return `Thunder because exclamation marks run ${f1(p.bangsR)} per 100 words.`;
      case 'fog': return p.qsR >= 1.6 ? `Fog because questions run ${f1(p.qsR)} per 100 words.` : `Fog because visibility is down to ${f1(t.visibility)} mi.`;
      case 'snow': return `Snow because it is ${f0(t.tempF)} °F and wet.`;
      case 'rain': return `Rain because commas + 2 × (semicolons + dashes) = ${f1(p.commasR + 2 * p.semisR + 2 * p.dashesR)} per 100 words.`;
      case 'cloudy': return `Overcast: ${f1(p.commasR + 2 * p.semisR + 2 * p.dashesR)} wet marks per 100 words and ${f0(t.humidity)}% humidity.`;
      case 'partly': return `Partly cloudy: ${f0(t.humidity)}% humidity at ${f0(t.tempF)} °F.`;
      default: return `Sunny: warm, dry and lightly punctuated.`;
    }
  }
  function barometer(P) {
    const lo = 970, hi = 1060, a0 = -210, a1 = 30;
    const ang = v => (a0 + (a1 - a0) * Math.max(0, Math.min(1, (v - lo) / (hi - lo)))) * Math.PI / 180;
    const pt = (v, r) => [60 + Math.cos(ang(v)) * r, 56 + Math.sin(ang(v)) * r];
    let ticks = '';
    for (let v = lo; v <= hi; v += 10) { const [x1, y1] = pt(v, 44), [x2, y2] = pt(v, v % 30 === 0 ? 36 : 40); ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b9cbf0" stroke-width="1.5"/>`; if (v % 30 === 0) { const [tx, ty] = pt(v, 29); ticks += `<text x="${tx}" y="${ty + 3}" font-size="8" fill="#b9cbf0" text-anchor="middle" font-family="Oswald, sans-serif">${v}</text>`; } }
    const [nx, ny] = pt(P, 40);
    const arc = (v0, v1, color) => { const [ax, ay] = pt(v0, 46), [bx, by] = pt(v1, 46); return `<path d="M${ax} ${ay} A46 46 0 0 1 ${bx} ${by}" stroke="${color}" stroke-width="4" fill="none"/>`; };
    return `<svg viewBox="0 0 120 70">${arc(lo, 1000, 'var(--cold)')}${arc(1000, 1030, '#8fa6cc')}${arc(1030, hi, 'var(--sun)')}${ticks}
      <text x="22" y="66" font-size="8" fill="#7fc2ff" font-family="Oswald, sans-serif">STORMY</text><text x="98" y="66" font-size="8" fill="var(--sun)" text-anchor="end" font-family="Oswald, sans-serif">FAIR</text>
      <line x1="60" y1="56" x2="${nx}" y2="${ny}" stroke="var(--red)" stroke-width="2.5" stroke-linecap="round"/><circle cx="60" cy="56" r="3.5" fill="var(--ink)"/></svg>`;
  }
  function windRose(rose) {
    const kinds = PW.OPENER_KINDS, max = Math.max(1, ...kinds.map(k => rose[k]));
    const cx = 60, cy = 50, R = 34; let out = '';
    for (let r = 1; r <= 3; r++) out += `<circle cx="${cx}" cy="${cy}" r="${R * r / 3}" fill="none" stroke="rgba(185,203,240,0.25)" stroke-width="0.8"/>`;
    kinds.forEach((k, i) => {
      const a = (-90 + i * 60) * Math.PI / 180, len = 4 + (R - 4) * rose[k] / max, w = 22 * Math.PI / 180;
      const p1 = [cx + Math.cos(a - w) * len, cy + Math.sin(a - w) * len], p2 = [cx + Math.cos(a) * len * 1.12, cy + Math.sin(a) * len * 1.12], p3 = [cx + Math.cos(a + w) * len, cy + Math.sin(a + w) * len];
      out += `<polygon class="rose-petal" data-k="${k}" points="${cx},${cy} ${p1.map(v => v.toFixed(1))} ${p2.map(v => v.toFixed(1))} ${p3.map(v => v.toFixed(1))}" fill="var(--rain)" opacity="${rose[k] ? 0.75 : 0.25}" stroke="#0a2560" stroke-width="0.8"><title>${rose[k]} sentences open with a ${k === 'other' ? 'content word' : k}</title></polygon>`;
      const lx = cx + Math.cos(a) * (R + 11), ly = cy + Math.sin(a) * (R + 11);
      out += `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" font-size="7.5" fill="#b9cbf0" text-anchor="middle" font-family="Oswald, sans-serif" letter-spacing="0.5">${({pronoun:'PRON',article:'ART',conjunction:'CONJ',preposition:'PREP',adverb:'ADV',other:'OTHER'})[k]} ${rose[k]}</text>`;
    });
    return `<svg viewBox="0 0 120 100">${out}</svg>`;
  }

  // ---------- synoptic chart ----------
  function renderMap(A) {
    const map = $('map'), svg = $('map-svg');
    const W = Math.max(300, map.clientWidth || 600), H = Math.max(260, map.clientHeight || 400);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (!A.paras.length) { svg.innerHTML = ''; return; }
    const syn = PW.synoptic(A, W, H);
    let g = '';
    for (let x = 0; x < W; x += 50) g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(160,196,255,0.07)"/>`;
    for (let y = 0; y < H; y += 50) g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(160,196,255,0.07)"/>`;
    syn.contours.forEach(c => {
      const d = c.segs.map(s => `M${s[0][0].toFixed(1)} ${s[0][1].toFixed(1)}L${s[1][0].toFixed(1)} ${s[1][1].toFixed(1)}`).join('');
      g += `<path d="${d}" fill="none" stroke="#9fc2ff" stroke-width="1.3" stroke-linecap="round" opacity="0.7"/>`;
      if (c.segs.length) { const s = c.segs[Math.floor(c.segs.length / 2)]; const x = (s[0][0] + s[1][0]) / 2, y = (s[0][1] + s[1][1]) / 2; g += `<rect x="${x - 10}" y="${y - 6}" width="20" height="12" rx="3" fill="#06204f"/><text x="${x}" y="${y + 3.5}" font-size="10" fill="#9fc2ff" text-anchor="middle" font-family="Oswald, sans-serif">${c.level}</text>`; }
    });
    g += `<polyline points="${syn.stations.map(s => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ')}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="3 5"/>`;
    syn.fronts.forEach(f => {
      const dx = f.b.x - f.a.x, dy = f.b.y - f.a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const col = f.kind === 'cold' ? 'var(--cold)' : 'var(--warm)';
      g += `<line x1="${f.a.x}" y1="${f.a.y}" x2="${f.b.x}" y2="${f.b.y}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>`;
      for (let k = 1; k <= 3; k++) {
        const px = f.a.x + ux * L * k / 4, py = f.a.y + uy * L * k / 4;
        if (f.kind === 'cold') g += `<polygon points="${px - ux * 5},${py - uy * 5} ${px + ux * 5},${py + uy * 5} ${px + nx * 9},${py + ny * 9}" fill="${col}"/>`;
        else g += `<path d="M${px - ux * 5} ${py - uy * 5} A5 5 0 0 1 ${px + ux * 5} ${py + uy * 5} Z" fill="${col}"/>`;
      }
    });
    syn.stations.forEach(s => {
      const r = Math.min(22, 7 + Math.sqrt(s.p.n) * 0.9);
      g += `<g class="station" data-i="${s.i}" transform="translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})"><circle r="${r + 4}" fill="rgba(0,8,36,0.35)"/><circle class="body" r="${r}" fill="${tempColor(s.t)}" stroke="#061640" stroke-width="1.5"/><text y="4" font-size="${r > 12 ? 11 : 9}" fill="#061640" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="600">¶${s.i + 1}</text><text y="${r + 12}" font-size="10" fill="#dbe7ff" text-anchor="middle" font-family="Oswald, sans-serif">${f0(s.t)}°</text></g>`;
    });
    if (syn.stations.length > 1) {
      g += `<text x="${syn.hi.x + 16}" y="${syn.hi.y - 14}" font-size="30" fill="var(--cold)" font-family="Oswald, sans-serif" font-weight="700" stroke="#061640" stroke-width="1">H</text>`;
      g += `<text x="${syn.lo.x + 16}" y="${syn.lo.y - 14}" font-size="30" fill="var(--red)" font-family="Oswald, sans-serif" font-weight="700" stroke="#061640" stroke-width="1">L</text>`;
    }
    svg.innerHTML = g;
    const tip = $('tip');
    svg.querySelectorAll('.station').forEach(el => {
      const p = A.paras[+el.dataset.i];
      el.addEventListener('mousemove', e => {
        const b = map.getBoundingClientRect();
        tip.innerHTML = `<b>¶ ${p.i + 1} · ${p.n} words · ${f0(p.rep.tempF)} °F · ${PW.COND_LABEL[p.rep.condition]}</b><div class="q">${esc(p.text.slice(0, 160))}${p.text.length > 160 ? '…' : ''}</div>`;
        tip.style.display = 'block';
        const x = Math.min(e.clientX - b.left + 12, b.width - 270), y = e.clientY - b.top + 12;
        tip.style.left = Math.max(0, x) + 'px'; tip.style.top = (y > b.height - 90 ? y - 100 : y) + 'px';
      });
      el.addEventListener('mouseleave', () => tip.style.display = 'none');
      el.addEventListener('click', () => evidence(`Paragraph ${p.i + 1}: ${f0(p.rep.tempF)} °F, ${PW.COND_LABEL[p.rep.condition].toLowerCase()}`, `${p.n} words, ${p.sents.length} sentences, ${p.rep.nScored} scored words (highlighted with their AFINN score). Smoothed valence on the chart: ${f0(p.smooth)} °F.`, p.sents, HL.temp));
    });
  }

  // ---------- 7-day forecast ----------
  function renderDays(A, B) {
    $('days').innerHTML = A.days.map((d, i) => {
      const r = d.rep, empty = !r.n;
      const vs = B && B.days[i].rep.n ? `<div class="vs">vs ${f0(B.days[i].hi)}° / ${f0(B.days[i].lo)}° ${PW.COND_LABEL[B.days[i].rep.condition].toLowerCase()}</div>` : '';
      return `<div class="day${empty ? ' empty' : ''}" data-d="${i}"><div class="n">${dayName(i)}</div><div class="p">${empty ? 'no text' : `¶ ${d.paraFrom + 1}${d.paraTo !== d.paraFrom ? '–' + (d.paraTo + 1) : ''} · ${r.n} w`}</div><div class="i">${empty ? '' : iconSVG(r.condition)}</div><div class="hl">${empty ? '—' : `${f0(d.hi)}°<span class="lo">${f0(d.lo)}°</span>`}</div><div class="c">${empty ? '' : PW.COND_LABEL[r.condition]}</div>${vs}</div>`;
    }).join('');
    $('days').querySelectorAll('.day').forEach(el => el.onclick = () => {
      const d = A.days[+el.dataset.d]; const r = d.rep;
      if (!r.n) return;
      evidence(`${DAYN[(today.getDay() + d.d) % 7]}: ${PW.COND_LABEL[r.condition]}, high ${f0(d.hi)}°, low ${f0(d.lo)}°`, `Day ${d.d + 1} of 7 is words ${A.days.slice(0, d.d).reduce((a, x) => a + x.rep.n, 0) + 1}–${A.days.slice(0, d.d + 1).reduce((a, x) => a + x.rep.n, 0)}: ${r.n} words, ${r.sentences} sentences, mean ${f0(r.tempF)} °F, wind ${f0(r.wind)} mph, ${r.precipIn.toFixed(2)} in of punctuation, humidity ${f0(r.humidity)}%. ${esc(whyCondition(r))} The high and low sentences come first.`, [d.hiS, d.loS].concat(d.sents), HL.temp);
    });
  }

  // ---------- compare climates ----------
  function renderCompare(A, B, na, nb) {
    const box = $('compare');
    if (!B) { box.classList.remove('show'); box.innerHTML = ''; return; }
    const W = 1000, H = 210, px = 40, py = 20;
    const all = A.days.concat(B.days).filter(d => d.rep.n);
    const lo = Math.min(...all.map(d => d.lo)) - 3, hi = Math.max(...all.map(d => d.hi)) + 3;
    const X = i => px + i * (W - 2 * px) / 6, Y = v => py + (H - 2 * py) * (1 - (v - lo) / (hi - lo || 1));
    const series = (D, col, cls) => {
      const pts = D.days.filter(d => d.rep.n).map(d => [X(d.d), Y(d.rep.tempF)]);
      const band = D.days.filter(d => d.rep.n).map(d => [X(d.d), Y(d.hi)]).concat(D.days.filter(d => d.rep.n).map(d => [X(d.d), Y(d.lo)]).reverse());
      return `<polygon points="${band.map(p => p.join(',')).join(' ')}" fill="${col}" opacity="0.14"/><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${col}" stroke="#061640"/>`).join('')}`;
    };
    let grid = '';
    for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) grid += `<line x1="${px}" y1="${Y(v)}" x2="${W - px}" y2="${Y(v)}" stroke="rgba(160,196,255,0.15)"/><text x="${px - 6}" y="${Y(v) + 3}" font-size="9" fill="#b9cbf0" text-anchor="end" font-family="Oswald, sans-serif">${v}°</text>`;
    const labels = A.days.map((d, i) => `<text x="${X(i)}" y="${H - 4}" font-size="10" fill="#b9cbf0" text-anchor="middle" font-family="Oswald, sans-serif">${dayName(i).toUpperCase()}</text>`).join('');
    const rows = [
      ['Temperature', d => `${f0(d.tempF)} °F`, d => d.tempF, '°'],
      ['Wind', d => `${f0(d.wind)} mph`, d => d.wind, ''],
      ['Precipitation', d => `${d.precipIn.toFixed(2)} in`, d => d.precipIn, ''],
      ['Humidity', d => `${f0(d.humidity)}%`, d => d.humidity, '%'],
      ['Pressure', d => `${f0(d.pressure)} mb`, d => d.pressure, ''],
      ['Visibility', d => `${f1(d.visibility)} mi`, d => d.visibility, ''],
      ['UV', d => f1(d.uv), d => d.uv, ''],
      ['Conditions', d => PW.COND_LABEL[d.condition], null, '']
    ];
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperature across the seven days of both texts">${grid}${series(A, '#ffd34d')}${series(B, '#4ea3ff')}${labels}
      <text x="${W - px}" y="12" font-size="11" fill="#ffd34d" text-anchor="end" font-family="Oswald, sans-serif">● ${esc(na)}</text><text x="${W - px}" y="26" font-size="11" fill="#4ea3ff" text-anchor="end" font-family="Oswald, sans-serif">● ${esc(nb)}</text></svg>
      <table class="cmp-table"><tr><th>Climate</th><th>${esc(na)}</th><th>${esc(nb)}</th><th>Δ</th></tr>${rows.map(([k, fmt, num]) => `<tr><td>${k}</td><td class="a">${fmt(A.total)}</td><td class="b">${fmt(B.total)}</td><td class="dlt">${num ? (num(A.total) - num(B.total) >= 0 ? '+' : '') + (Math.abs(num(A.total) - num(B.total)) < 10 ? (num(A.total) - num(B.total)).toFixed(1) : f0(num(A.total) - num(B.total))) : ''}</td></tr>`).join('')}</table>`;
    box.classList.add('show');
  }

  // ---------- ticker ----------
  const ADV_HL = { 'Semicolon watch in effect': [HL.none, /;/], 'Hail warning': [HL.none, /—|--|–/], 'Severe thunderstorm warning': [HL.none, /!/], 'Thunderstorm watch': [HL.none, /!/], 'Dense fog advisory': [HL.none, /\?/], 'Patchy fog': [HL.none, /\?/], 'Low visibility': [HL.syl], 'Heat advisory': [HL.temp], 'Frost advisory': [HL.temp], 'Hard freeze warning': [HL.temp], 'UV alert': [HL.hot], 'High UV index': [HL.hot], 'Flash flood warning': [HL.none, /,/], 'Humidity advisory': [HL.fn], 'High pressure system': [HL.rep], 'Low pressure system': [HL.rep] };
  function renderTicker(A) {
    const track = $('ticker');
    const items = A.advisories.map((a, i) => `<span class="item" data-i="${i}"><i class="lvl ${a.level}"></i><b>${esc(a.title)}:</b> ${esc(a.text)}</span>`).join('');
    track.innerHTML = `<span class="half">${items}</span><span class="half dup" aria-hidden="true">${items}</span>`;
    const chars = A.advisories.reduce((n, a) => n + a.title.length + a.text.length + 6, 0);
    track.style.setProperty('--tick-dur', Math.max(18, Math.round(chars * 0.11 + 10)) + 's');
    track.querySelectorAll('.item').forEach(el => el.onclick = () => {
      const a = A.advisories[+el.dataset.i]; const h = ADV_HL[a.title] || [HL.none];
      evidence(a.title, `${esc(a.text)}.${a.sents.length ? ' The sentences responsible:' : ''}`, a.sents, h[0], h[1], null);
    });
  }

  // ---------- orchestration ----------
  function analysisFor(key, text) {
    if (!state.cache[key]) state.cache[key] = PW.analyze(text, LEX);
    return state.cache[key];
  }
  function show(key, text, name) {
    state.cur = analysisFor(key, text); state.curName = name;
    const B = state.cmp;
    renderConditions(state.cur, name);
    renderMap(state.cur);
    renderDays(state.cur, B);
    renderCompare(state.cur, B, name, state.cmpName);
    renderTicker(state.cur);
    $('lower-h').textContent = `Forecast for "${name}"`;
    if (key !== '__paste') { const u = new URL(location.href); u.searchParams.set('post', key); if (state.cmp) u.searchParams.set('cmp', $('cmp').value); else u.searchParams.delete('cmp'); history.replaceState(null, '', u); }
    $('lower-s').textContent = `${state.cur.total.n} words · ${state.cur.sents.length} sentences · ${state.cur.paras.length} paragraphs · ${state.cur.advisories.filter(a => a.level !== 'info').length} advisories`;
  }
  function selectPost(slug) {
    const p = state.posts.find(x => x.slug === slug);
    if (!p || state.texts[slug] === undefined) return;
    $('paste').classList.remove('show'); $('btn-paste').classList.remove('on');
    show(slug, state.texts[slug], p.title);
  }
  function tick() { const d = new Date(); let h = d.getHours(), m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; $('clock').textContent = `${h}:${m < 10 ? '0' : ''}${m} ${ap}`; }
  tick(); setInterval(tick, 15000);

  $('btn-paste').onclick = () => { const on = $('paste').classList.toggle('show'); $('btn-paste').classList.toggle('on', on); if (on) $('txt').focus(); };
  $('btn-go').onclick = () => {
    const txt = $('txt').value.trim(); if (!txt) return;
    $('post').value = '';
    delete state.cache.__paste; show('__paste', txt, 'pasted text');
  };
  $('post').onchange = () => { if ($('post').value) selectPost($('post').value); };
  $('cmp').onchange = () => {
    const slug = $('cmp').value;
    if (slug && state.texts[slug] !== undefined) { state.cmp = analysisFor(slug, state.texts[slug]); state.cmpName = state.posts.find(x => x.slug === slug).title; }
    else { state.cmp = null; state.cmpName = ''; }
    if (state.cur) { renderDays(state.cur, state.cmp); renderCompare(state.cur, state.cmp, state.curName, state.cmpName); }
  };
  $('ov-close').onclick = closeOverlay;
  $('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeOverlay(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });
  $('btn-about').onclick = () => {
    $('ov-title').textContent = 'About Prose Weather';
    $('ov-lead').innerHTML = `<b>KPRS Prose 7</b> reads a text the way a weather station reads the sky.`;
    $('ov-list').innerHTML = `<div class="about"><p>Every number on the set is computed from the sentences of the text, and every number is clickable: the temperature opens the warmest and coldest sentences, the wind opens the longest, each kind of precipitation opens the sentences that rained it, the stations on the Doppler map open their paragraphs, and the advisories in the ticker point at exactly what set them off.</p><p>The seven "days" are the text cut into sevenths in reading order, so a post that starts cheerful and ends in a storm shows up as a cold front moving through the week. Pick a second post under "compare with" to overlay two climates.</p><p class="f">The formulas are in the footer of the page. Sentiment lexicon: a subset of AFINN-111 (Finn Årup Nielsen, 2011), ODbL.</p></div>`;
    $('overlay').classList.add('show');
  };
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.cur) renderMap(state.cur); }, 150); });

  async function load() {
    const sel = $('post'), cmp = $('cmp');
    try {
      const idx = await fetch('../../blog/index.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      state.posts = idx;
      sel.innerHTML = '<option value="">— choose a post —</option>' + idx.map(p => `<option value="${esc(p.slug)}">${esc(p.title)} (${p.date})</option>`).join('');
      cmp.innerHTML = '<option value="">— nothing —</option>' + idx.map(p => `<option value="${esc(p.slug)}">${esc(p.title)}</option>`).join('');
      await Promise.all(idx.map(p => fetch('../../blog/posts/' + p.file).then(r => r.ok ? r.text() : '').then(t => { state.texts[p.slug] = t; }).catch(() => { state.texts[p.slug] = ''; })));
      let want = params.get('post');
      if (params.get('thumb') === '1' || !want || !state.texts[want]) {
        let best = null, bestD = -1;
        idx.forEach(p => { if (state.texts[p.slug]) { const d = analysisFor(p.slug, state.texts[p.slug]).drama; if (d > bestD) { bestD = d; best = p.slug; } } });
        want = best;
      }
      if (params.get('thumb') === '1') document.body.classList.add('thumb');
      const c = params.get('cmp'); if (c && state.texts[c] && c !== want) { cmp.value = c; cmp.onchange(); }
      if (want) { sel.value = want; selectPost(want); }
      const open = params.get('open'); // debugging aid: ?open=st-temp opens that stat's evidence after load
      if (open) requestAnimationFrame(() => { const el = $(open) || document.querySelector(open); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    } catch (err) {
      sel.innerHTML = '<option value="">(blog unavailable)</option>';
      $('cond-body').innerHTML = `<div class="msg">Could not load the blog (${esc(err.message || err)}). Paste some text instead.</div>`;
      $('paste').classList.add('show'); $('btn-paste').classList.add('on');
    }
  }
  load();
})();
