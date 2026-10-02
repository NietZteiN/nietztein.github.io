/* Phonograph: every blog post pressed onto a record.
   The groove is the text. One IIFE, no dependencies. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SITE = 'NIETZTEIN';
  var CPS_BASE = 15;            // reading speed in characters per second at 1x (about 180 wpm)
  var RPM_DEG = 200;            // 33 1/3 rpm in degrees per second
  var CHUNK_MAX = 150;          // longest utterance we hand to the browser voice
  var MAX_TRACKS = 24;

  /* ---------- small helpers ---------- */
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function fmtDur(chars) { var s = Math.round(chars / CPS_BASE); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function catNo(slug) { return 'NZT-' + (1000 + hash32(slug) % 9000); }
  function hueOf(tag) { return hash32('tag:' + tag) % 360; }
  function postHues(meta) {
    var tags = (meta.tags && meta.tags.length) ? meta.tags : [meta.slug];
    var a = hueOf(tags[0]);
    var b = tags.length > 1 ? hueOf(tags[1]) : (a + 150) % 360;
    if (Math.abs(((a - b) % 360 + 360) % 360) < 40) b = (a + 150) % 360;
    return [a, b];
  }
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }

  /* ---------- markdown to paragraphs ---------- */
  function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }
  function stripMarkdown(md, title) {
    var s = md.replace(/\r/g, '');
    if (s.slice(0, 3) === '---') {
      var m = s.indexOf('\n---', 3);
      if (m > 0) { var nl = s.indexOf('\n', m + 1); s = nl < 0 ? '' : s.slice(nl + 1); }
    }
    s = s.replace(/```[\s\S]*?```/g, '');
    s = s.replace(/<[^>\n]+>/g, '');
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
    s = s.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '');
    s = s.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '');
    s = s.replace(/`([^`\n]*)`/g, '$1');
    s = s.replace(/(\*\*|__)([\s\S]*?)\1/g, '$2');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1$2');
    s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1$2');
    s = s.replace(/~~([^~]*)~~/g, '$1');
    s = decodeEntities(s);
    var blocks = s.split(/\n[ \t]*\n+/);
    var out = [];
    var pendingHeading = '';
    var normTitle = (title || '').trim().toLowerCase();
    for (var b = 0; b < blocks.length; b++) {
      var lines = blocks[b].split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) continue;
      var pieces = [];
      var headingOnly = true;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var isHeading = /^#{1,6}\s/.test(l);
        if (isHeading) {
          l = l.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '');
          if (l.toLowerCase() === normTitle) continue;
          if (!/[.!?:]$/.test(l)) l += '.';
          pieces.push(l);
          continue;
        }
        headingOnly = false;
        if (/^\|/.test(l)) { if (/^\|[\s:|-]+\|$/.test(l)) continue; l = l.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }).filter(Boolean).join(', '); }
        l = l.replace(/^>\s?/, '');
        var isItem = /^([-*+]|\d+[.)])\s+/.test(l);
        l = l.replace(/^([-*+]|\d+[.)])\s+/, '');
        l = l.replace(/^\[[ xX]\]\s*/, '');
        if (isItem && l && !/[.!?:;,]$/.test(l)) l += '.';
        if (l) pieces.push(l);
      }
      if (!pieces.length) continue;
      var text = pieces.join(' ').replace(/[*_#]+/g, '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (headingOnly) { pendingHeading = pendingHeading ? pendingHeading + ' ' + text : text; continue; }
      if (pendingHeading) { text = pendingHeading + ' ' + text; pendingHeading = ''; }
      out.push(text);
    }
    if (pendingHeading) out.push(pendingHeading);
    return out;
  }

  /* ---------- sentences and chunks ---------- */
  function isSpace(c) { return c === ' ' || c === '\t' || c === '\n'; }
  function splitSentences(text) {
    var out = [], start = 0, n = text.length;
    for (var i = 0; i < n; i++) {
      var ch = text[i];
      if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;
      var j = i + 1;
      while (j < n && '"”’)\]'.indexOf(text[j]) >= 0) j++;
      if (j < n && !isSpace(text[j])) continue;
      var k = j;
      while (k < n && isSpace(text[k])) k++;
      var next = k < n ? text[k] : '';
      if (next && /[a-z]/.test(next)) continue;
      var before = text.slice(Math.max(0, i - 6), i);
      if (ch === '.' && (/(^|[\s(])[A-Za-z]$/.test(before) || /(^|\s)(e\.g|i\.e|etc|vs|cf|Dr|Mr|Mrs|Ms|St|No|Fig|al)$/.test(before))) continue;
      if (j > start) out.push({ text: text.slice(start, j), off: start });
      start = k; i = j - 1;
    }
    if (start < n && text.slice(start).trim()) out.push({ text: text.slice(start), off: start });
    return out;
  }
  function splitChunks(text) {
    if (text.length <= CHUNK_MAX) return [{ text: text, off: 0 }];
    var mid = text.length / 2, best = -1, bestD = Infinity;
    var re = /[,;:—–]\s|\s[-—]\s/g, m;
    while ((m = re.exec(text))) { var p = m.index + m[0].length; var d = Math.abs(p - mid); if (d < bestD && p > 20 && p < text.length - 20) { bestD = d; best = p; } }
    if (best < 0) { var sp = text.lastIndexOf(' ', mid); if (sp > 20) best = sp + 1; else best = Math.floor(mid); }
    var a = splitChunks(text.slice(0, best)), b = splitChunks(text.slice(best));
    for (var i = 0; i < b.length; i++) b[i].off += best;
    return a.concat(b);
  }

  /* ---------- sides ---------- */
  function mergeToMax(paras, max) {
    paras = paras.slice();
    while (paras.length > max) {
      var bi = 0, bl = Infinity;
      for (var i = 0; i + 1 < paras.length; i++) { var l = paras[i].length + paras[i + 1].length; if (l < bl) { bl = l; bi = i; } }
      paras.splice(bi, 2, paras[bi] + ' ' + paras[bi + 1]);
    }
    return paras;
  }
  function makeSide(key, paras, remix) {
    var side = { key: key, remix: remix, paragraphs: [], sentences: [], text: '', chars: 0 };
    var pos = 0, text = [];
    for (var p = 0; p < paras.length; p++) {
      var para = { i: p, start: pos, end: pos, label: '', sentences: [] };
      var sents = splitSentences(paras[p]);
      if (!sents.length) sents = [{ text: paras[p], off: 0 }];
      for (var s = 0; s < sents.length; s++) {
        var t = sents[s].text.trim();
        if (!t) continue;
        var sent = { si: side.sentences.length, pi: p, text: t, start: pos, end: pos + t.length, words: [], chunks: splitChunks(t) };
        var re = /\S+/g, m;
        while ((m = re.exec(t))) sent.words.push({ s: pos + m.index, e: pos + m.index + m[0].length });
        side.sentences.push(sent); para.sentences.push(sent.si);
        text.push(t); pos += t.length;
      }
      para.end = pos;
      para.label = paras[p].length > 48 ? paras[p].slice(0, 46).replace(/\s+\S*$/, '') + '…' : paras[p];
      if (para.sentences.length) side.paragraphs.push(para);
    }
    side.text = text.join('');
    side.chars = pos;
    return side;
  }
  function remixParagraphs(paras) {
    var counts = {};
    var words = paras.join(' ').toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) || [];
    words.forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    var groups = {}; var order = [];
    keys.forEach(function (w) { var c = counts[w]; if (!groups[c]) { groups[c] = []; order.push(c); } groups[c].push(w); });
    var names = ['', 'Once', 'Twice', 'Three times', 'Four times', 'Five times', 'Six times', 'Seven times', 'Eight times', 'Nine times'];
    return order.map(function (c) {
      var list = [];
      groups[c].forEach(function (w) { for (var i = 0; i < c; i++) list.push(w); });
      var name = c < names.length ? names[c] : c + ' times';
      return name + '. ' + list.join(' ') + '.';
    });
  }
  function buildSides(meta, md) {
    var paras = mergeToMax(stripMarkdown(md, meta.title), MAX_TRACKS);
    if (!paras.length) paras = [meta.summary || meta.title || 'An empty record.'];
    var total = paras.reduce(function (a, p) { return a + p.length; }, 0);
    var A, B;
    if (paras.length >= 2 && total >= 1500) {
      var acc = 0, cut = 1, bestD = Infinity;
      for (var i = 0; i < paras.length - 1; i++) { acc += paras[i].length; var d = Math.abs(acc - total / 2); if (d < bestD) { bestD = d; cut = i + 1; } }
      A = makeSide('A', paras.slice(0, cut), false);
      B = makeSide('B', paras.slice(cut), false);
    } else {
      A = makeSide('A', paras, false);
      B = makeSide('B', mergeToMax(remixParagraphs(paras), MAX_TRACKS), true);
    }
    return { A: A, B: B };
  }

  /* ---------- the groove ---------- */
  var S = 1100, CX = 550, RR = 550, R0 = 512, R1 = 200, RAVG = (R0 + R1) / 2;
  var waveCache = {};
  function wave(ch) {
    var w = waveCache[ch];
    if (w) return w;
    if (ch === ' ') w = [0, 1];
    else {
      var code = ch.toLowerCase().charCodeAt(0);
      var h = Math.imul(code, 2654435761) >>> 0;
      var letter = /\p{L}/u.test(ch);
      var a = letter ? 0.3 + 0.7 * ((h % 1000) / 1000) : /\d/.test(ch) ? 0.5 : 0.22;
      var f = 1 + (Math.imul(code, 40503) >>> 0) % 3;
      w = [a, f];
    }
    waveCache[ch] = w;
    return w;
  }
  function buildGroove(side) {
    var N = side.chars, P = side.paragraphs.length, Sn = side.sentences.length;
    var baseT = clamp(Math.round(8 + N / 150), 10, 60);
    var gapTurn = 0.7;
    var T = baseT + gapTurn * Math.max(0, P - 1) + 1.5;
    var circ = 2 * Math.PI * RAVG;
    var cs = (circ * baseT) / Math.max(1, N + 2.5 * Sn);
    var pitch = (R0 - R1) / T;
    var cells = [];
    cells.push({ t: 'li', len: 0.5 * circ });
    for (var p = 0; p < side.paragraphs.length; p++) {
      var para = side.paragraphs[p];
      for (var s = 0; s < para.sentences.length; s++) {
        var sent = side.sentences[para.sentences[s]];
        for (var c = 0; c < sent.text.length; c++) cells.push({ t: 'c', ch: sent.text[c], len: cs, ci: sent.start + c });
        cells.push({ t: 's', len: 2.5 * cs });
      }
      if (p < side.paragraphs.length - 1) cells.push({ t: 'p', len: gapTurn * circ, pi: p });
    }
    cells.push({ t: 'lo', len: circ });
    var r = R0, th = 0;
    var charCell = new Int32Array(N);
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      cell.r = r; cell.th = th;
      if (cell.t === 'c') charCell[cell.ci] = i;
      var dth = cell.len / r;
      th -= dth;
      r = Math.max(R1 + 3, r - pitch * dth / (2 * Math.PI));
    }
    var nextChar = new Int32Array(cells.length);
    var nc = N;
    for (i = cells.length - 1; i >= 0; i--) { if (cells[i].t === 'c') nc = cells[i].ci; nextChar[i] = nc; }
    return { cells: cells, charCell: charCell, nextChar: nextChar, cs: cs, pitch: pitch, amp: Math.min(pitch * 0.4, 10), turns: T, endR: r };
  }
  function cellAtRadius(g, r) {
    var lo = 0, hi = g.cells.length - 1;
    if (r >= g.cells[0].r) return 0;
    if (r <= g.cells[hi].r) return hi;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (g.cells[mid].r > r) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function radiusAt(g, idx) {
    if (!g || !g.charCell.length) return R0;
    var i = clamp(Math.floor(idx), 0, g.charCell.length - 1);
    var cell = g.cells[g.charCell[i]];
    var frac = idx - i;
    return cell.r - g.pitch * (cell.len * frac / cell.r) / (2 * Math.PI);
  }

  /* ---------- drawing the disc ---------- */
  function arcText(ctx, text, cx, cy, radius, angle, dir) {
    ctx.save();
    ctx.translate(cx, cy);
    var total = 0, widths = [];
    for (var i = 0; i < text.length; i++) { var w = ctx.measureText(text[i]).width; widths.push(w); total += w; }
    var totalAngle = total / radius;
    var a = angle - dir * totalAngle / 2;
    for (i = 0; i < text.length; i++) {
      var half = widths[i] / 2 / radius;
      a += dir * half;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, dir > 0 ? -radius : radius);
      if (dir < 0) ctx.rotate(Math.PI);
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
      a += dir * half;
    }
    ctx.restore();
  }
  function wrapLines(ctx, text, maxW, maxLines) {
    var words = text.split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…'; }
    return lines;
  }
  function drawDisc(canvas, g, meta, side, hues) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    var grad = ctx.createRadialGradient(CX, CX, 0, CX, CX, RR);
    grad.addColorStop(0, '#1b1b1c'); grad.addColorStop(0.55, '#141415'); grad.addColorStop(1, '#0c0c0d');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(CX, CX, RR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CX, RR - 2, 0, Math.PI * 2); ctx.stroke();

    var path = new Path2D(), gapPath = new Path2D();
    var first = true, firstGap = true;
    var TWO_PI = Math.PI * 2;
    for (var i = 0; i < g.cells.length; i++) {
      var cell = g.cells[i];
      var isChar = cell.t === 'c';
      var n = isChar ? Math.max(3, Math.ceil(cell.len / 1.1)) : Math.max(4, Math.ceil(cell.len / 4));
      var wp = isChar ? wave(cell.ch) : null;
      for (var k = 0; k <= n; k++) {
        var t = k / n, l = cell.len * t, dth = l / cell.r;
        var th = cell.th - dth, r = cell.r - g.pitch * dth / TWO_PI;
        var w = isChar && wp[0] ? g.amp * wp[0] * Math.sin(TWO_PI * wp[1] * t) : 0;
        var x = CX + (r + w) * Math.cos(th), y = CX + (r + w) * Math.sin(th);
        if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
        if (!isChar && cell.t !== 's') { if (k === 0 || firstGap) { gapPath.moveTo(x, y); firstGap = false; } else gapPath.lineTo(x, y); }
      }
      if (!isChar && cell.t !== 's') firstGap = true;
    }
    // run-out: a tight flat spiral from where the text ends down to the label
    if (g.endR - R1 > 14) {
      var ro = new Path2D(), rr = g.endR - 2, a = 0, step = 0.06, perTurn = 2.6;
      ro.moveTo(CX + rr, CX);
      while (rr > R1 + 6) { a += step; rr -= perTurn * step / TWO_PI; ro.lineTo(CX + rr * Math.cos(-a), CX + rr * Math.sin(-a)); }
      ctx.strokeStyle = 'rgba(205,205,215,0.09)'; ctx.lineWidth = 1; ctx.stroke(ro);
    }
    ctx.beginPath(); ctx.arc(CX, CX, g.endR, 0, TWO_PI); ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.075)'; ctx.lineWidth = clamp(g.pitch * 0.9, 1.5, 6); ctx.stroke(gapPath);
    ctx.strokeStyle = 'rgba(205,205,215,0.11)'; ctx.lineWidth = 1.1; ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.stroke(gapPath);

    // label
    var lab = 'hsl(' + hues[0] + ', 52%, 60%)', ring = 'hsl(' + hues[1] + ', 60%, 45%)', ink = '#1a1410';
    ctx.fillStyle = lab; ctx.beginPath(); ctx.arc(CX, CX, R1, 0, TWO_PI); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(CX, CX, R1 - 1, 0, TWO_PI); ctx.stroke();
    ctx.strokeStyle = ring; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(CX, CX, R1 - 9, 0, TWO_PI); ctx.stroke();
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 13px Helvetica, Arial, sans-serif';
    arcText(ctx, SITE + ' RECORDS  ·  LONG PLAYING  ·  MICROGROOVE', CX, CX, R1 - 26, -Math.PI / 2, 1);
    arcText(ctx, 'STEREO  ·  ' + catNo(meta.slug) + '  ·  UNBREAKABLE', CX, CX, R1 - 26, Math.PI / 2, -1);
    var serif = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    ctx.font = '700 38px ' + serif;
    var lines = wrapLines(ctx, meta.title, 2 * (R1 - 48), 3);
    if (lines.length === 3) { ctx.font = '700 31px ' + serif; lines = wrapLines(ctx, meta.title, 2 * (R1 - 46), 3); }
    var lh = lines.length === 3 ? 33 : 40;
    var y0 = CX - 72 - (lines.length - 1) * lh / 2;
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], CX, y0 + i * lh);
    ctx.font = 'italic 20px ' + serif;
    ctx.fillText(fmtDate(meta.date), CX, CX + 50);
    ctx.font = '700 22px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'right'; ctx.fillText('33\u2153', CX - 30, CX + 1);
    ctx.textAlign = 'left'; ctx.fillText('SIDE ' + side.key, CX + 30, CX + 1);
    ctx.textAlign = 'center';
    ctx.font = '600 11px Helvetica, Arial, sans-serif';
    ctx.fillText('RPM', CX - 48, CX + 20); ctx.fillText(side.remix ? 'REMIX' : 'LONG PLAY', CX + 66, CX + 20);
    ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(catNo(meta.slug) + '-' + side.key + '   \u00b7   ' + fmtDur(side.chars), CX, CX + 82);
    ctx.font = '600 11px Helvetica, Arial, sans-serif';
    ctx.fillText((meta.tags || []).join(' \u00b7 ').toUpperCase(), CX, CX + 108);
    // spindle hole
    ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.arc(CX, CX, 12, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#8a8a86'; ctx.beginPath(); ctx.arc(CX, CX, 8, 0, TWO_PI); ctx.fill();
  }

  /* ---------- cover art ---------- */
  function drawCover(canvas, meta, hues) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var rnd = mulberry32(hash32('cover:' + meta.slug));
    var A = hues[0], B = hues[1];
    ctx.fillStyle = 'hsl(' + A + ', 32%, 13%)';
    ctx.fillRect(0, 0, W, H);
    var cx = W * (0.25 + rnd() * 0.5), cy = H * (0.25 + rnd() * 0.5);
    var count = 26 + Math.floor(rnd() * 18);
    ctx.lineCap = 'butt';
    for (var i = 0; i < count; i++) {
      var r = 18 + i * (W * 0.62 / count) + rnd() * 10;
      var a0 = rnd() * Math.PI * 2, span = 0.5 + rnd() * 3.5;
      var useA = rnd() < 0.55;
      var light = 48 + Math.floor(rnd() * 24);
      ctx.strokeStyle = 'hsla(' + (useA ? A : B) + ', ' + (62 + Math.floor(rnd() * 20)) + '%, ' + light + '%, ' + (0.65 + rnd() * 0.35) + ')';
      ctx.lineWidth = 3 + rnd() * 14;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + span); ctx.stroke();
      if (rnd() < 0.25) { ctx.strokeStyle = 'rgba(255,245,225,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r + 9, a0 + 0.3, a0 + span - 0.3); ctx.stroke(); }
    }
    ctx.fillStyle = 'hsla(' + B + ', 70%, 60%, 0.9)';
    ctx.beginPath(); ctx.arc(cx, cy, 10 + rnd() * 8, 0, Math.PI * 2); ctx.fill();
    // title block
    var band = ctx.createLinearGradient(0, H * 0.6, 0, H);
    band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = band; ctx.fillRect(0, H * 0.6, W, H * 0.4);
    ctx.fillStyle = '#f4ecdc'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.font = '700 44px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    var lines = wrapLines(ctx, meta.title, W - 80, 3);
    var y = H - 72 - (lines.length - 1) * 48;
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], 40, y + i * 48);
    ctx.font = '600 15px Helvetica, Arial, sans-serif';
    ctx.fillStyle = 'rgba(244,236,220,0.75)';
    var sub = SITE + '  ·  ' + catNo(meta.slug) + '  ·  ' + fmtDate(meta.date).toUpperCase();
    ctx.fillText(sub.split('').join(String.fromCharCode(8202)), 40, H - 36);
    ctx.textAlign = 'right';
    ctx.font = '700 15px Helvetica, Arial, sans-serif';
    ctx.fillText('33⅓', W - 36, 48);
    ctx.textAlign = 'left';
  }

  /* ---------- audio ---------- */
  var audio = { ctx: null, noise: null, bed: null, bedGain: null, popTimer: null, popsPerSec: 1 };
  function audioCtx() {
    if (!audio.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
      var len = audio.ctx.sampleRate * 2;
      audio.noise = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
      var d = audio.noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(function () {});
    return audio.ctx;
  }
  function startCrackle() {
    var ctx = audioCtx();
    if (!ctx || audio.bed) return !!ctx;
    var src = ctx.createBufferSource(); src.buffer = audio.noise; src.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    var g = ctx.createGain(); g.gain.value = 0.0; g.gain.linearRampToValueAtTime(0.014, ctx.currentTime + 0.6);
    src.connect(lp); lp.connect(g); g.connect(ctx.destination); src.start();
    audio.bed = src; audio.bedGain = g;
    audio.popTimer = setInterval(function () { if (Math.random() < audio.popsPerSec * 0.1) pop(); }, 100);
    return true;
  }
  function stopCrackle() {
    if (!audio.bed) return;
    var ctx = audio.ctx, src = audio.bed, g = audio.bedGain;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    setTimeout(function () { try { src.stop(); } catch (e) { /* already stopped */ } }, 400);
    clearInterval(audio.popTimer);
    audio.bed = null; audio.bedGain = null; audio.popTimer = null;
  }
  function pop() {
    var ctx = audio.ctx; if (!ctx) return;
    var src = ctx.createBufferSource(); src.buffer = audio.noise;
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700 + Math.random() * 1500;
    var g = ctx.createGain();
    var t = ctx.currentTime, dur = 0.003 + Math.random() * 0.012, amp = 0.05 + Math.random() * Math.random() * 0.35;
    g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp); hp.connect(g); g.connect(ctx.destination);
    src.start(t, Math.random() * 1.5, dur + 0.01);
  }
  function scratchBurst(strength) {
    var ctx = audioCtx(); if (!ctx) return;
    var src = ctx.createBufferSource(); src.buffer = audio.noise;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    var t = ctx.currentTime, dur = 0.16 + 0.12 * strength;
    bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(320, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18 + 0.12 * strength, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(t, Math.random() * 1.2, dur + 0.02);
  }

  /* ---------- state ---------- */
  var st = {
    posts: [], meta: null, sides: null, grooves: null, discs: null, hues: [120, 270],
    side: 'A', idx: 0, playing: false, chunk: null,
    rot: 0, spin: 0, strobe: 0, lastT: 0,
    muted: false, rate: 1, voiceName: '', crackle: false,
    speechOK: typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined',
    cps: CPS_BASE, vu: [0, 0], prevLen: 0, curSent: -1, curWord: -1, scratchUntil: 0,
    scrub: null, armPos: 88, armTarget: 88, armShown: null, pose: false, ended: false
  };
  var el = {
    deck: $('deck'), record: $('record'), hit: $('hit'), ring: $('drop-ring'), arm: $('arm'), armShadow: $('arm-shadow'), strobe: $('strobe'),
    vuL: $('vuL'), vuR: $('vuR'), post: $('post'), play: $('btn-play'), flip: $('btn-flip'), flip2: $('btn-flip2'),
    voice: $('voice'), rate: $('rate'), rateVal: $('rate-val'), mute: $('btn-mute'), crackle: $('btn-crackle'), exportBtn: $('btn-export'),
    npLeft: $('np-left'), npRight: $('np-right'), sentence: $('sentence'), scope: $('scope'),
    cover: $('cover'), slTitle: $('sl-title'), slCat: $('sl-cat'), slMeta: $('sl-meta'), slSide: $('sl-side'), slTotal: $('sl-total'), tracks: $('tracks'), liner: $('liner'),
    help: $('help')
  };
  var recCtx = el.record.getContext('2d');
  function side() { return st.sides ? st.sides[st.side] : null; }
  function groove() { return st.grooves ? st.grooves[st.side] : null; }

  /* ---------- prefs ---------- */
  var PREF_KEY = 'phonograph:prefs';
  function loadPrefs() {
    try { var p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); st.muted = !!p.muted; st.rate = clamp(+p.rate || 1, 0.6, 1.6); st.voiceName = p.voice || ''; } catch (e) { /* no storage */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ muted: st.muted, rate: st.rate, voice: st.voiceName })); } catch (e) { /* no storage */ }
  }

  /* ---------- strobe ring ---------- */
  (function buildStrobe() {
    var frag = document.createDocumentFragment();
    var ns = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 120; i++) {
      var a = i / 120 * Math.PI * 2;
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', (380 + 333 * Math.cos(a)).toFixed(2));
      c.setAttribute('cy', (360 + 333 * Math.sin(a)).toFixed(2));
      c.setAttribute('r', i % 10 === 0 ? 3.2 : 2.2);
      c.setAttribute('fill', i % 10 === 0 ? '#e8e2d2' : '#9a978f');
      frag.appendChild(c);
    }
    el.strobe.appendChild(frag);
    el.strobe.style.transformOrigin = '380px 360px';
  })();

  /* ---------- tonearm ---------- */
  var ARM = { px: 890, py: 108, cx: 380, cy: 360, len: 470, rest: 88, k: 320 / RR };
  function armAngleFor(rInternal) {
    var r = clamp(rInternal * ARM.k, 100, 322);
    var dx = ARM.cx - ARM.px, dy = ARM.cy - ARM.py, d = Math.hypot(dx, dy);
    var cosv = clamp((d * d + ARM.len * ARM.len - r * r) / (2 * d * ARM.len), -1, 1);
    var off = Math.acos(cosv) * 180 / Math.PI;
    return Math.atan2(dy, dx) * 180 / Math.PI - off;
  }
  function setArm(rInternal) { st.armTarget = rInternal == null ? ARM.rest : armAngleFor(rInternal); }
  function moveArm(dt) {
    var diff = st.armTarget - st.armPos;
    var k = (REDUCED || st.pose) ? 1 : 1 - Math.exp(-dt / 0.32);
    st.armPos += diff * k;
    if (Math.abs(diff) < 0.02) st.armPos = st.armTarget;
    var shown = st.armPos.toFixed(2);
    if (shown !== st.armShown) {
      st.armShown = shown;
      el.arm.style.transform = 'rotate(' + shown + 'deg)';
      el.armShadow.style.transform = 'rotate(' + shown + 'deg)';
    }
    var arrived = Math.abs(st.armTarget - st.armPos) < 1.2 && st.armTarget !== ARM.rest;
    el.deck.classList.toggle('down', (st.playing || st.pose) && arrived);
  }

  /* ---------- sleeve ---------- */
  function renderSleeve() {
    var m = st.meta, sd = side();
    el.slTitle.textContent = m.title;
    el.slCat.textContent = catNo(m.slug) + '-' + sd.key;
    el.slMeta.textContent = fmtDate(m.date) + (m.tags && m.tags.length ? ' · ' + m.tags.join(', ') : '') + ' · ' + sd.paragraphs.length + (sd.paragraphs.length === 1 ? ' track' : ' tracks');
    el.slSide.textContent = 'Side ' + sd.key + (sd.remix ? ' · remix' : '');
    el.slTotal.textContent = fmtDur(sd.chars);
    el.tracks.innerHTML = '';
    sd.paragraphs.forEach(function (p, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="t"></span><span class="d">' + fmtDur(p.end - p.start) + '</span>';
      li.querySelector('.t').textContent = p.label;
      li.title = p.label;
      li.addEventListener('click', function () { dropAt(p.start, true); });
      el.tracks.appendChild(li);
    });
    el.liner.innerHTML = '<b>Liner notes</b>';
    var txt = document.createTextNode(sd.remix ? 'Side B is a remix: every word of the post, sorted by how often it appears. ' + (m.summary || '') : (m.summary || 'No summary on the sleeve; the groove speaks for itself.'));
    el.liner.appendChild(txt);
    el.flip.textContent = 'Flip to ' + (sd.key === 'A' ? 'B' : 'A');
    markTrack();
  }
  function markTrack() {
    var sd = side(); if (!sd) return;
    var pi = paragraphAt(st.idx);
    var lis = el.tracks.children;
    for (var i = 0; i < lis.length; i++) lis[i].classList.toggle('cur', i === pi);
  }
  function paragraphAt(idx) {
    var sd = side(); var ps = sd.paragraphs;
    for (var i = ps.length - 1; i >= 0; i--) if (idx >= ps[i].start) return i;
    return 0;
  }
  function sentenceAt(idx) {
    var ss = side().sentences;
    var lo = 0, hi = ss.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (ss[mid].start <= idx) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /* ---------- now playing ---------- */
  function renderSentence(si) {
    var sd = side(); if (!sd || !sd.sentences.length) return;
    var s = sd.sentences[si];
    el.sentence.classList.remove('scratch');
    el.sentence.innerHTML = '';
    var pos = s.start;
    s.words.forEach(function (w) {
      if (w.s > pos) el.sentence.appendChild(document.createTextNode(sd.text.slice(pos, w.s)));
      var sp = document.createElement('span'); sp.className = 'w'; sp.textContent = sd.text.slice(w.s, w.e);
      el.sentence.appendChild(sp); pos = w.e;
    });
    st.curSent = si; st.curWord = -1;
    updateWords(true);
  }
  function updateWords(force) {
    var sd = side(); if (!sd || st.curSent < 0 || st.curSent >= sd.sentences.length) return;
    var s = sd.sentences[st.curSent];
    var wi = -1;
    for (var i = 0; i < s.words.length; i++) { if (st.idx >= s.words[i].s) wi = i; else break; }
    if (wi === st.curWord && !force) return;
    if (wi !== st.curWord) { st.prevLen = st.curWord >= 0 && st.curWord < s.words.length ? s.words[st.curWord].e - s.words[st.curWord].s : st.prevLen; }
    st.curWord = wi;
    var spans = el.sentence.querySelectorAll('.w');
    for (i = 0; i < spans.length; i++) { spans[i].classList.toggle('done', i < wi); spans[i].classList.toggle('cur', i === wi); }
    var pi = paragraphAt(st.idx), sd2 = side();
    el.npLeft.innerHTML = '<b>' + (st.playing ? (st.scrub ? 'Scratch' : 'Playing') : (st.ended ? 'End of side' : 'Paused')) + '</b> · side ' + sd2.key + ' · track ' + (pi + 1) + '/' + sd2.paragraphs.length;
    el.npRight.textContent = fmtDur(st.idx) + ' / ' + fmtDur(sd2.chars);
    markTrack();
  }
  function showMessage(msg) { el.sentence.innerHTML = ''; var sp = document.createElement('span'); sp.className = 'msg'; sp.textContent = msg; el.sentence.appendChild(sp); st.curSent = -1; }

  /* ---------- scope ---------- */
  function drawScope() {
    var c = el.scope, g = groove(), sd = side();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!g || !sd || !sd.chars) return;
    var PX = 11, mid = h * 0.42;
    var i = clamp(Math.floor(st.idx), 0, sd.chars - 1), frac = clamp(st.idx - i, 0, 1);
    var ci = g.charCell[i];
    var cx = w / 2;
    function widthOf(cell) { return cell.t === 'c' ? PX : cell.t === 's' ? PX * 1.4 : PX * 4; }
    function drawCell(cell, x0, lit) {
      var cw = widthOf(cell);
      ctx.beginPath();
      if (cell.t === 'c') {
        var wp = wave(cell.ch), n = 12;
        for (var k = 0; k <= n; k++) { var t = k / n; var y = mid - 14 * wp[0] * Math.sin(2 * Math.PI * wp[1] * t); if (k === 0) ctx.moveTo(x0, y); else ctx.lineTo(x0 + cw * t, y); }
        ctx.strokeStyle = lit ? 'rgba(217,228,200,0.9)' : 'rgba(217,228,200,0.4)'; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.fillStyle = lit ? 'rgba(217,228,200,0.85)' : 'rgba(217,228,200,0.35)';
        ctx.font = '10px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(cell.ch, x0 + cw / 2, h - 5);
      } else {
        ctx.moveTo(x0, mid); ctx.lineTo(x0 + cw, mid);
        ctx.strokeStyle = cell.t === 's' ? 'rgba(217,228,200,0.35)' : 'rgba(255,207,110,0.6)'; ctx.lineWidth = cell.t === 's' ? 1 : 2; ctx.stroke();
        if (cell.t === 'p' || cell.t === 'li' || cell.t === 'lo') { ctx.fillStyle = 'rgba(255,207,110,0.6)'; ctx.font = '9px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cell.t === 'p' ? 'track ' + (cell.pi + 2) : cell.t === 'li' ? 'lead-in' : 'lead-out', x0 + cw / 2, h - 5); }
      }
    }
    var x = cx - frac * PX;
    for (var j = ci; j < g.cells.length && x < w; j++) { drawCell(g.cells[j], x, false); x += widthOf(g.cells[j]); }
    x = cx - frac * PX;
    for (j = ci - 1; j >= 0 && x > 0; j--) { x -= widthOf(g.cells[j]); drawCell(g.cells[j], x, true); }
    ctx.beginPath(); ctx.moveTo(cx, 2); ctx.lineTo(cx, h - 2); ctx.strokeStyle = '#ffcf6e'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 4, 2); ctx.lineTo(cx + 4, 2); ctx.lineTo(cx, 7); ctx.closePath(); ctx.fillStyle = '#ffcf6e'; ctx.fill();
  }

  /* ---------- playback ---------- */
  function voiceList() {
    if (!st.speechOK) return [];
    try { return window.speechSynthesis.getVoices() || []; } catch (e) { return []; }
  }
  function pickVoice() {
    var vs = voiceList();
    if (!vs.length) return null;
    for (var i = 0; i < vs.length; i++) if (vs[i].name === st.voiceName) return vs[i];
    var en = vs.filter(function (v) { return /^en/i.test(v.lang); });
    var def = en.filter(function (v) { return v.default; })[0] || en[0] || vs.filter(function (v) { return v.default; })[0] || vs[0];
    return def;
  }
  function populateVoices() {
    var vs = voiceList();
    var cur = pickVoice();
    el.voice.innerHTML = '';
    if (!vs.length) {
      var o = document.createElement('option'); o.textContent = st.speechOK ? 'no voices found (text only)' : 'speech unavailable (text only)'; el.voice.appendChild(o); el.voice.disabled = true; return;
    }
    el.voice.disabled = false;
    var sorted = vs.slice().sort(function (a, b) { var ea = /^en/i.test(a.lang) ? 0 : 1, eb = /^en/i.test(b.lang) ? 0 : 1; return ea - eb || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name); });
    sorted.forEach(function (v) {
      var o = document.createElement('option'); o.value = v.name; o.textContent = v.name.replace(/^Microsoft |^Google /, '') + ' (' + v.lang + ')';
      if (cur && v.name === cur.name) o.selected = true;
      el.voice.appendChild(o);
    });
  }
  function speechUsable() { return st.speechOK && !st.muted && voiceList().length > 0; }

  function startChunk(si, ci, off) {
    var sd = side(); var s = sd.sentences[si]; var c = s.chunks[ci];
    off = off || 0;
    if (off > 0) { var back = c.text.lastIndexOf(' ', off); off = back >= 0 ? back + 1 : 0; if (off >= c.text.length) off = 0; }
    var text = c.text.slice(off);
    var chunk = { si: si, ci: ci, start: s.start + c.off + off, end: s.start + c.off + c.text.length, len: text.length, text: text, t0: performance.now(), boundary: -1, mode: 'timer', utter: null };
    chunk.est = Math.max(0.35, chunk.len / (st.cps * st.rate) + 0.25);
    st.chunk = chunk;
    if (st.idx < chunk.start || st.idx > chunk.end) st.idx = chunk.start;
    if (si !== st.curSent) renderSentence(si);
    if (speechUsable()) {
      try {
        var u = new SpeechSynthesisUtterance(text);
        var v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
        u.rate = st.rate; u.pitch = 1; u.volume = 1;
        u.onboundary = function (e) { if (st.chunk === chunk && typeof e.charIndex === 'number') chunk.boundary = chunk.start + e.charIndex; };
        u.onend = function () { if (st.chunk === chunk) finishChunk(true); };
        u.onerror = function (e) { if (st.chunk !== chunk) return; if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; chunk.mode = 'timer'; chunk.t0 = performance.now(); };
        chunk.mode = 'speech'; chunk.utter = u;
        window.speechSynthesis.speak(u);
      } catch (e) { chunk.mode = 'timer'; }
    }
  }
  function finishChunk(spoken) {
    var chunk = st.chunk; if (!chunk) return;
    if (spoken && chunk.mode === 'speech') {
      var actual = (performance.now() - chunk.t0) / 1000;
      if (actual > 0.4 && chunk.len > 12) st.cps = clamp(0.7 * st.cps + 0.3 * (chunk.len / actual) / st.rate, 6, 40);
    }
    st.chunk = null;
    st.idx = chunk.end;
    var sd = side(); var s = sd.sentences[chunk.si];
    if (chunk.ci + 1 < s.chunks.length) startChunk(chunk.si, chunk.ci + 1, 0);
    else if (chunk.si + 1 < sd.sentences.length) startChunk(chunk.si + 1, 0, 0);
    else endSide();
  }
  function cancelSpeech() {
    st.chunk = null;
    if (st.speechOK) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  }
  function startAt(idx) {
    var sd = side(); if (!sd || !sd.chars) return;
    cancelSpeech();
    idx = clamp(idx, 0, sd.chars - 1);
    st.idx = idx; st.ended = false;
    var si = sentenceAt(idx); var s = sd.sentences[si];
    var ci = 0;
    for (var i = 0; i < s.chunks.length; i++) if (idx >= s.start + s.chunks[i].off) ci = i;
    startChunk(si, ci, idx - (s.start + s.chunks[ci].off));
  }
  function play() {
    var sd = side(); if (!sd || !sd.chars) return;
    if (st.ended || st.idx >= sd.chars - 1) st.idx = 0;
    st.playing = true; st.ended = false;
    el.deck.classList.add('on');
    el.play.innerHTML = '&#10074;&#10074; Pause'; el.play.classList.add('on');
    if (st.crackle) startCrackle();
    startAt(st.idx);
    updateWords(true);
  }
  function pause(keepArm) {
    cancelSpeech();
    st.playing = false;
    if (!keepArm) el.deck.classList.remove('on');
    el.play.innerHTML = '&#9654; Play'; el.play.classList.remove('on');
    stopCrackle();
    updateWords(true);
  }
  function endSide() {
    cancelSpeech();
    st.playing = false; st.ended = true;
    st.idx = side().chars - 1;
    el.play.innerHTML = '&#9654; Play'; el.play.classList.remove('on');
    stopCrackle();
    setArm(null);
    showMessage('End of side ' + st.side + '. Flip the record for side ' + (st.side === 'A' ? 'B' : 'A') + '.');
    el.npLeft.innerHTML = '<b>End of side</b> · side ' + st.side; el.npRight.textContent = fmtDur(side().chars) + ' / ' + fmtDur(side().chars);
  }
  function dropAt(idx, startPlaying) {
    var sd = side(); if (!sd || !sd.chars) return;
    idx = clamp(Math.round(idx), 0, sd.chars - 1);
    st.ended = false;
    st.idx = idx;
    if (st.playing) startAt(idx);
    else if (startPlaying) play();
    else renderSentence(sentenceAt(idx));
    updateWords(true);
    st.scopeDirty = true;
    flashRing(radiusAt(groove(), idx));
  }
  function flashRing(rInternal) {
    var box = el.hit.getBoundingClientRect(); var dia = rInternal / RR * box.width;
    el.ring.style.width = dia + 'px'; el.ring.style.height = dia + 'px';
    el.ring.classList.remove('flash'); void el.ring.offsetWidth; el.ring.classList.add('flash');
  }
  function flip(then) {
    var was = st.playing;
    cancelSpeech();
    st.playing = false; stopCrackle();
    st.side = st.side === 'A' ? 'B' : 'A';
    st.idx = 0; st.ended = false; st.curSent = -1;
    presentSide();
    if (was || then) play(); else { el.deck.classList.remove('on'); el.play.innerHTML = '&#9654; Play'; el.play.classList.remove('on'); setArm(null); }
  }
  function presentSide() {
    var sd = side();
    recCtx.clearRect(0, 0, S, S);
    recCtx.drawImage(st.discs[st.side], 0, 0);
    renderSleeve();
    if (sd.chars) renderSentence(sentenceAt(st.idx)); else showMessage('An empty side.');
    updateWords(true);
    drawScope();
  }

  /* ---------- frame loop ---------- */
  function frame(now) {
    var dt = st.lastT ? Math.min(0.1, (now - st.lastT) / 1000) : 0;
    st.lastT = now;
    var g = groove(), sd = side();
    if (st.chunk && st.playing && !st.scrub) {
      var c = st.chunk, elapsed = (now - c.t0) / 1000;
      var target = c.start + c.len * Math.min(1, elapsed / c.est);
      if (c.boundary > target) target = c.boundary;
      target = Math.min(target, c.end - 0.01);
      if (target > st.idx) st.idx = target;
      if (c.mode === 'timer' && elapsed >= c.est) finishChunk(false);
      else if (c.mode === 'speech' && elapsed > c.est * 2.5 + 3) finishChunk(false);
    }
    // platter
    var spinTarget = (st.playing && !REDUCED && !st.scrub && !st.pose) ? RPM_DEG * st.rate : 0;
    st.spin += (spinTarget - st.spin) * (1 - Math.exp(-dt / (st.playing ? 0.9 : 0.6)));
    if (Math.abs(st.spin) < 0.5 && !st.playing) st.spin = 0;
    if (!st.scrub) st.rot = (st.rot + st.spin * dt) % 360;
    var apparent = st.spin - RPM_DEG * Math.round(st.spin / RPM_DEG);
    st.strobe = (st.strobe + apparent * dt) % 360;
    el.record.style.transform = 'rotate(' + st.rot.toFixed(2) + 'deg)';
    el.strobe.style.transform = 'rotate(' + st.strobe.toFixed(2) + 'deg)';
    // arm
    if (g && sd && sd.chars && (st.playing || st.scrub || st.armTarget !== ARM.rest)) setArm(radiusAt(g, st.idx));
    moveArm(dt);
    // words + scope
    if (sd && sd.chars && st.curSent >= 0 && !st.scrub) {
      var si = sentenceAt(st.idx);
      if (si !== st.curSent && now >= st.scratchUntil) renderSentence(si);
      updateWords(false);
    }
    if (st.playing || st.scrub || st.scopeDirty) { drawScope(); st.scopeDirty = false; }
    // VU
    var len = 0;
    if (sd && sd.chars && st.playing && st.curSent >= 0) { var s = sd.sentences[st.curSent]; if (st.curWord >= 0 && st.curWord < s.words.length) len = s.words[st.curWord].e - s.words[st.curWord].s; }
    var tL = st.playing ? clamp((len - 1) / 11, 0.04, 1) : 0, tR = st.playing ? clamp((st.prevLen - 1) / 11, 0.04, 1) : 0;
    if (st.scrub) { tL = tR = 0.4 + 0.5 * Math.random(); }
    if (st.pose) { tL = 0.62; tR = 0.41; }
    st.vu[0] += (tL - st.vu[0]) * (tL > st.vu[0] ? 0.45 : 0.07);
    st.vu[1] += (tR - st.vu[1]) * (tR > st.vu[1] ? 0.45 : 0.07);
    el.vuL.setAttribute('transform', 'rotate(' + (-42 + 84 * st.vu[0]).toFixed(1) + ' 46 84)');
    el.vuR.setAttribute('transform', 'rotate(' + (-42 + 84 * st.vu[1]).toFixed(1) + ' 46 84)');
    requestAnimationFrame(frame);
  }

  /* ---------- needle drop and scratch ---------- */
  (function pointer() {
    var down = null;
    function angleOf(e) { var b = el.hit.getBoundingClientRect(); return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2)); }
    function radiusOf(e) { var b = el.hit.getBoundingClientRect(); return Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2)) / (b.width / 2) * RR; }
    el.hit.addEventListener('pointerdown', function (e) {
      if (!side() || !side().chars) return;
      e.preventDefault();
      el.hit.setPointerCapture(e.pointerId);
      down = { t: performance.now(), x: e.clientX, y: e.clientY, ang: angleOf(e), idx: st.idx, wasPlaying: st.playing, moved: false, back: 0, lastScratch: 0 };
    });
    el.hit.addEventListener('pointermove', function (e) {
      if (!down) return;
      var g = groove(); if (!g) return;
      var a = angleOf(e), d = a - down.ang;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      if (!down.moved) {
        down.moved = true;
        st.scrub = { rot0: st.rot, idx0: st.idx };
        cancelSpeech();
        el.hit.classList.add('drag');
        st.spin = 0;
      }
      down.ang = a;
      st.rot += d * 180 / Math.PI;
      var r = radiusAt(g, st.idx);
      var charsPerTurn = 2 * Math.PI * r / g.cs;
      st.idx = clamp(st.idx + d / (2 * Math.PI) * charsPerTurn, 0, side().chars - 1);
      if (d < 0) {
        down.back += d;
        if (down.back < -0.12 && performance.now() - down.lastScratch > 260) {
          down.lastScratch = performance.now(); down.back = 0;
          var sd = side(); var s = sd.sentences[sentenceAt(st.idx)];
          var local = clamp(Math.floor(st.idx) - s.start, 0, s.text.length);
          var rev = s.text.slice(0, local).split('').reverse().join('');
          el.sentence.textContent = rev.slice(0, 120) || s.text.split('').reverse().join('').slice(0, 120);
          el.sentence.classList.add('scratch');
          st.curSent = -1;
          st.scratchUntil = performance.now() + 400;
          if (!st.muted) scratchBurst(clamp(-d * 4, 0, 1));
        }
      } else down.back = 0;
      el.npLeft.innerHTML = '<b>Scratch</b> · side ' + side().key;
      el.npRight.textContent = fmtDur(st.idx) + ' / ' + fmtDur(side().chars);
      setArm(radiusAt(g, st.idx));
    });
    function up(e) {
      if (!down) return;
      var d = down; down = null;
      el.hit.classList.remove('drag');
      var g = groove(); if (!g) return;
      if (!d.moved) {
        if (performance.now() - d.t > 600) return;
        var r = radiusOf(e);
        if (r < R1) { toggle(); return; }
        var cell = cellAtRadius(g, r);
        var idx = g.nextChar[cell];
        if (idx >= side().chars) idx = side().chars - 1;
        dropAt(idx, true);
        return;
      }
      st.scrub = null;
      st.scratchUntil = 0;
      renderSentence(sentenceAt(st.idx));
      if (d.wasPlaying) { st.ended = false; startAt(st.idx); }
      updateWords(true);
      st.scopeDirty = true;
    }
    el.hit.addEventListener('pointerup', up);
    el.hit.addEventListener('pointercancel', up);
  })();

  /* ---------- export ---------- */
  function exportPNG() {
    if (!st.meta || !st.discs) return;
    var W = 1800, H = 1000;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#100d0b'; ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W * 0.5, -100, 50, W * 0.5, -100, 1400);
    g.addColorStop(0, '#2b1f17'); g.addColorStop(1, '#0d0a08'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // disc
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
    ctx.translate(1230, 500); ctx.rotate(st.rot * Math.PI / 180);
    ctx.drawImage(st.discs[st.side], -440, -440, 880, 880);
    ctx.restore();
    ctx.save();
    var sheen = ctx.createConicGradient ? ctx.createConicGradient(3.5, 1230, 500) : null;
    if (sheen) {
      sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.05, 'rgba(255,255,255,0.1)'); sheen.addColorStop(0.14, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0)'); sheen.addColorStop(0.55, 'rgba(255,255,255,0.08)'); sheen.addColorStop(0.64, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(1230, 500, 440, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // sleeve
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
    ctx.fillStyle = '#cdbfa3'; ctx.fillRect(60, 60, 880, 880);
    ctx.restore();
    ctx.drawImage(el.cover, 72, 72, 856, 856);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(60, 60, 880, 880);
    ctx.fillStyle = 'rgba(236,227,208,0.55)'; ctx.font = '600 14px Helvetica, Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText((SITE + ' RECORDS · ' + catNo(st.meta.slug) + '-' + st.side + ' · SIDE ' + st.side + ' · ' + fmtDur(side().chars) + ' · nietztein.github.io').split('').join(String.fromCharCode(8202)), W - 60, H - 36);
    c.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'phonograph-' + st.meta.slug + '-side-' + st.side + '.png';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }, 'image/png');
  }

  /* ---------- loading posts ---------- */
  var mdCache = {};
  function loadPost(meta) {
    pause();
    setArm(null);
    st.meta = meta; st.sides = null; st.grooves = null; st.discs = null; st.idx = 0; st.side = 'A'; st.ended = false; st.curSent = -1;
    showMessage('Pressing “' + meta.title + '”…');
    var p = mdCache[meta.file] ? Promise.resolve(mdCache[meta.file]) : fetch('../../blog/posts/' + meta.file).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (t) { mdCache[meta.file] = t; return t; });
    return p.then(function (md) {
      if (st.meta !== meta) return;
      pressRecord(meta, md);
    }).catch(function (err) {
      showMessage('Could not read the post (' + err.message + '). Open this page over http rather than from a file.');
    });
  }
  function pressRecord(meta, md) {
    st.sides = buildSides(meta, md);
    st.hues = postHues(meta);
    st.grooves = { A: buildGroove(st.sides.A), B: buildGroove(st.sides.B) };
    st.discs = { A: document.createElement('canvas'), B: document.createElement('canvas') };
    ['A', 'B'].forEach(function (k) { st.discs[k].width = S; st.discs[k].height = S; drawDisc(st.discs[k], st.grooves[k], meta, st.sides[k], st.hues); });
    drawCover(el.cover, meta, st.hues);
    var punct = (st.sides.A.text.match(/[,.;:!?—–()]/g) || []).length;
    audio.popsPerSec = clamp(punct / Math.max(1, st.sides.A.chars) * 70, 0.4, 6);
    if (params.get('side') === 'B' && !THUMB) st.side = 'B';
    presentSide();
    el.npLeft.innerHTML = '<b>Ready</b> · side ' + st.side + ' · ' + side().paragraphs.length + ' tracks';
    el.npRight.textContent = '0:00 / ' + fmtDur(side().chars);
    st.scopeDirty = true;
    if (THUMB) thumbPose();
    else if (params.get('at') || params.get('play') === '1') { var at = clamp(parseFloat(params.get('at')) || 0, 0, 0.999); dropAt(Math.floor(side().chars * at), params.get('play') === '1'); }
  }
  function thumbPose() {
    var sd = side(), g = groove();
    st.idx = Math.floor(sd.chars * 0.42);
    st.playing = false; st.ended = false; st.pose = true;
    el.deck.classList.add('noanim', 'on');
    setArm(radiusAt(g, st.idx)); moveArm(1);
    st.rot = 23;
    renderSentence(sentenceAt(st.idx));
    st.playing = true; updateWords(true); st.playing = false;
    el.play.innerHTML = '&#10074;&#10074; Pause'; el.play.classList.add('on');
    st.vu = [0.62, 0.41];
    st.scopeDirty = true;
    el.npLeft.innerHTML = '<b>Playing</b> · side A · track ' + (paragraphAt(st.idx) + 1) + '/' + sd.paragraphs.length;
    requestAnimationFrame(function () {
      el.record.style.transform = 'rotate(23deg)';
      el.vuL.setAttribute('transform', 'rotate(10 46 84)'); el.vuR.setAttribute('transform', 'rotate(-8 46 84)');
      drawScope();
    });
  }

  /* ---------- UI wiring ---------- */
  function toggle() { if (st.playing) pause(true); else play(); }
  el.play.addEventListener('click', toggle);
  el.flip.addEventListener('click', function () { flip(false); });
  el.flip2.addEventListener('click', function () { flip(false); });
  el.post.addEventListener('change', function () { var m = st.posts[+el.post.value]; if (m) loadPost(m); });
  el.voice.addEventListener('change', function () { st.voiceName = el.voice.value; savePrefs(); if (st.playing) startAt(st.idx); });
  el.rate.addEventListener('input', function () { st.rate = +el.rate.value; el.rateVal.textContent = st.rate.toFixed(2) + '×'; savePrefs(); });
  el.rate.addEventListener('change', function () { if (st.playing) startAt(st.idx); });
  el.mute.addEventListener('click', function () { st.muted = !st.muted; el.mute.classList.toggle('on', st.muted); el.mute.textContent = st.muted ? 'muted' : 'mute'; savePrefs(); if (st.playing) startAt(st.idx); });
  el.crackle.addEventListener('click', function () {
    st.crackle = !st.crackle;
    if (st.crackle) { var ok = startCrackle(); if (!ok) { st.crackle = false; el.crackle.title = 'Web Audio is not available here'; } }
    else stopCrackle();
    el.crackle.classList.toggle('on', st.crackle);
    if (st.crackle && !st.playing) { /* let the bed run so the toggle is audible, it stops with pause */ }
  });
  el.exportBtn.addEventListener('click', exportPNG);
  $('btn-help').addEventListener('click', function () { el.help.classList.add('show'); });
  $('btn-close').addEventListener('click', function () { el.help.classList.remove('show'); });
  el.help.addEventListener('click', function (e) { if (e.target === el.help) el.help.classList.remove('show'); });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') { el.help.classList.remove('show'); return; }
    if (!side()) return;
    if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); toggle(); }
    else if (e.key === 'f' || e.key === 'F') flip(false);
    else if (e.key === 'm' || e.key === 'M') el.mute.click();
    else if (e.key === '?') el.help.classList.toggle('show');
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      var sd = side(); if (!sd.chars) return;
      var si = sentenceAt(st.idx) + (e.key === 'ArrowRight' ? 1 : (st.idx - sd.sentences[sentenceAt(st.idx)].start > 3 ? 0 : -1));
      si = clamp(si, 0, sd.sentences.length - 1);
      dropAt(sd.sentences[si].start, false);
    }
  });
  window.addEventListener('resize', function () { st.scopeDirty = true; });
  if (st.speechOK) {
    populateVoices();
    try { window.speechSynthesis.addEventListener('voiceschanged', populateVoices); } catch (e) { window.speechSynthesis.onvoiceschanged = populateVoices; }
  } else populateVoices();
  document.addEventListener('visibilitychange', function () { if (document.hidden && st.playing) pause(true); });
  window.addEventListener('pagehide', function () { cancelSpeech(); });

  if (THUMB) document.body.classList.add('thumb');
  loadPrefs();
  el.rate.value = st.rate; el.rateVal.textContent = st.rate.toFixed(2) + '×';
  el.mute.classList.toggle('on', st.muted); el.mute.textContent = st.muted ? 'muted' : 'mute';
  setArm(null);
  requestAnimationFrame(frame);

  fetch('../../blog/index.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (list) {
    st.posts = (Array.isArray(list) ? list : []).filter(function (p) { return p && p.file; }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (!st.posts.length) throw new Error('empty catalogue');
    el.post.innerHTML = '';
    st.posts.forEach(function (p, i) { var o = document.createElement('option'); o.value = i; o.textContent = p.title + ' (' + (p.date || '').slice(0, 4) + ')'; el.post.appendChild(o); });
    var want = params.get('post');
    var idx = 0;
    if (THUMB) { var pref = st.posts.findIndex(function (p) { return p.slug === 'metaphors-we-hallucinate-by'; }); if (pref >= 0) idx = pref; }
    if (want) { var w = st.posts.findIndex(function (p) { return p.slug === want; }); if (w >= 0) idx = w; }
    el.post.value = idx;
    loadPost(st.posts[idx]);
  }).catch(function (err) {
    showMessage('Could not load the blog catalogue (' + err.message + '). The deck still works, but there is nothing on the platter.');
  });
})();
