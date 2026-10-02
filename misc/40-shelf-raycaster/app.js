/* Stacks — a software raycaster through the library. No engine, no libraries. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SW = window.StacksWorld;
  var CELL = SW.CELL_PX, FLOOR_Y = SW.FLOOR_Y;
  var FONT_SERIF = 'Georgia, "Palatino Linotype", Palatino, "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif';
  var FONT_SANS = '"Segoe UI", Helvetica, Arial, "Hiragino Sans", "Yu Gothic", sans-serif';

  /* ---------------- pixel art (drawn as data) ---------------- */
  var ART = {
    cat: { pal: { k: [26, 24, 30, 255], K: [44, 40, 50, 255], y: [240, 200, 60, 255], p: [210, 120, 130, 255], w: [230, 225, 220, 255] }, rows: [
      '....................',
      '..kk......kk........',
      '..kKk....kKk........',
      '..kKKKKKKKKk........',
      '..kKKKKKKKKk........',
      '..kKyKKKKyKk........',
      '..kKKKKKKKKk........',
      '...kKKpKKKk.........',
      '....kwkkwk..........',
      '....kKKKKKKk........',
      '...kKKKKKKKKk.......',
      '...kKKKKKKKKKk......',
      '...kKKKKKKKKKKk..kk.',
      '...kKKKKKKKKKKKkkKk.',
      '...kKKKKKKKKKKKKKk..',
      '...kk..kk..kk.......'] },
    chair: { pal: { r: [112, 40, 40, 255], R: [150, 58, 54, 255], d: [66, 22, 22, 255], w: [84, 56, 34, 255], c: [176, 80, 72, 255], h: [196, 104, 92, 255] }, rows: [
      '........................',
      '....rrrrrrrrrrrrrrrr....',
      '...rRRRRRRRRRRRRRRRRr...',
      '...rRhRRRRRRRRRRRRhRr...',
      '...rRRrrrrrrrrrrrrRRr...',
      '...rRRrrrrrrrrrrrrRRr...',
      '...rRRrrrrrrrrrrrrRRr...',
      '...rRRrrrrrrrrrrrrRRr...',
      '..rrRRrrrrrrrrrrrrRRrr..',
      '..rRRRRrrrrrrrrrrrRRRr..',
      '..rRhRRrrrrrrrrrrrRhRr..',
      '..rRRRRcccccccccccRRRr..',
      '..rRRRRchhhhhhhhhcRRRr..',
      '..rRRRRcccccccccccRRRr..',
      '..rRRRRcccccccccccRRRr..',
      '..rrrrrrrrrrrrrrrrrrrr..',
      '..rddddddddddddddddddr..',
      '..rddddddddddddddddddr..',
      '..rrrrrrrrrrrrrrrrrrrr..',
      '...ww..............ww...',
      '...ww..............ww...',
      '...ww..............ww...',
      '........................',
      '........................'] },
    lamp: { pal: { k: [30, 26, 22, 255], b: [190, 150, 80, 255], g: [40, 70, 50, 255], G: [60, 100, 70, 255], y: [255, 220, 150, 255], Y: [255, 250, 225, 255], h: [255, 200, 120, 90], H: [255, 210, 140, 40] }, rows: [
      '.....kk.....',
      '.....kk.....',
      '.....kk.....',
      '.....kk.....',
      '.....kk.....',
      '....bbbb....',
      '....bGGb....',
      '...gGGGGg...',
      '..gGGGGGGg..',
      '.gGGGGGGGGg.',
      'gGGGGGGGGGGg',
      'gggggggggggg',
      'HyYYYYYYYYyH',
      'HhyYYYYYYyhH',
      '.HhhyyyyhhH.',
      '..HHhhhhHH..',
      '...HHHHHH...',
      '....HHHH....',
      '............',
      '............'] },
    plant: { pal: { g: [60, 110, 60, 255], G: [36, 78, 44, 255], t: [150, 84, 56, 255], T: [120, 64, 44, 255] }, rows: [
      '................',
      '......gg..gg....',
      '....ggGGggGGg...',
      '...gGGggGGggGg..',
      '..gGggGGGGggGGg.',
      '..gGGGgGGgGGGg..',
      '...ggGGGGGGgg...',
      '....gGGGGGGg....',
      '.....ggGgg......',
      '......gGg.......',
      '......gGg.......',
      '.....tttttt.....',
      '....tttttttt....',
      '....tttttttt....',
      '....tTTTTTTt....',
      '....tTTTTTTt....',
      '.....tTTTTt.....',
      '.....tTTTTt.....',
      '.....tTTTTt.....',
      '......tttt......',
      '................',
      '................',
      '................',
      '................'] }
  };
  function artImage(art, flip) {
    var h = art.rows.length, w = art.rows[0].length, data = new Uint32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var c = art.pal[art.rows[y].charAt(flip ? w - 1 - x : x)];
      data[y * w + x] = c ? ((c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0 : 0;
    }
    return { w: w, h: h, data: data };
  }
  function drawArt(ctx, art, x, y, s) { // onto a 2D canvas (for the cat on a shelf)
    for (var r = 0; r < art.rows.length; r++) for (var c = 0; c < art.rows[r].length; c++) {
      var p = art.pal[art.rows[r].charAt(c)]; if (!p) continue;
      ctx.fillStyle = 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + (p[3] / 255) + ')';
      ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }

  /* ---------------- texture helpers ---------------- */
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(cv) { var ctx = cv.getContext('2d'); var id = ctx.getImageData(0, 0, cv.width, cv.height); return { w: cv.width, h: cv.height, data: new Uint32Array(id.data.buffer) }; }
  function rgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')'; }
  function rnd(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  var noiseCv = null;
  function noisePattern(ctx) {
    if (!noiseCv) {
      noiseCv = canvas(64, 64); var nc = noiseCv.getContext('2d'); var id = nc.createImageData(64, 64); var r = rnd(7);
      for (var i = 0; i < id.data.length; i += 4) { var v = 128 + (r() - 0.5) * 70; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      nc.putImageData(id, 0, 0);
    }
    return ctx.createPattern(noiseCv, 'repeat');
  }
  function grain(ctx, w, h, alpha) { ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = noisePattern(ctx); ctx.fillRect(0, 0, w, h); ctx.restore(); }

  function woodGrain(ctx, x, y, w, h, seed, vertical) {
    var r = rnd(seed); ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    var n = vertical ? w / 3 : h / 3;
    for (var i = 0; i < n; i++) {
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.08 + r() * 0.12) + ')'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (vertical) { var gx = x + r() * w; ctx.moveTo(gx, y); ctx.bezierCurveTo(gx + (r() - 0.5) * 6, y + h / 3, gx + (r() - 0.5) * 6, y + 2 * h / 3, gx + (r() - 0.5) * 4, y + h); }
      else { var gy = y + r() * h; ctx.moveTo(x, gy); ctx.bezierCurveTo(x + w / 3, gy + (r() - 0.5) * 6, x + 2 * w / 3, gy + (r() - 0.5) * 6, x + w, gy + (r() - 0.5) * 4); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function bookcaseFrame(ctx, w) {
    // back panel
    ctx.fillStyle = '#2a1b11'; ctx.fillRect(0, 0, w, CELL);
    woodGrain(ctx, 0, 0, w, CELL, 11, true);
    var g = ctx.createLinearGradient(0, 0, 0, CELL); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.35, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, CELL);
    // top rail
    ctx.fillStyle = '#5e3d24'; ctx.fillRect(0, 0, w, 16); woodGrain(ctx, 0, 0, w, 16, 3, false);
    ctx.fillStyle = 'rgba(255,220,170,0.25)'; ctx.fillRect(0, 0, w, 2); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 14, w, 2);
    // shelf board + plinth
    ctx.fillStyle = '#7a5231'; ctx.fillRect(0, FLOOR_Y, w, 12); woodGrain(ctx, 0, FLOOR_Y, w, 12, 5, false);
    ctx.fillStyle = 'rgba(255,230,190,0.35)'; ctx.fillRect(0, FLOOR_Y, w, 2);
    ctx.fillStyle = '#3a2416'; ctx.fillRect(0, FLOOR_Y + 12, w, CELL - FLOOR_Y - 12); woodGrain(ctx, 0, FLOOR_Y + 12, w, CELL - FLOOR_Y - 12, 9, true);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, FLOOR_Y + 12, w, 3); ctx.fillRect(0, CELL - 4, w, 4);
  }
  function initials(a) {
    if (!a) return '';
    var parts = a.replace(/[(),.&]/g, ' ').split(/\s+/).filter(Boolean);
    if (/[　-鿿]/.test(a)) return parts[0].slice(0, 2);
    return parts.slice(0, 3).map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
  }
  function bookend(ctx, x) {
    ctx.fillStyle = '#5a5a60'; ctx.fillRect(x, FLOOR_Y - 60, 5, 60); ctx.fillRect(x, FLOOR_Y - 3, 26, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, FLOOR_Y - 60, 1, 60);
  }

  function makeShelfTexture(shelf) {
    var w = shelf.texW, cv = canvas(w, CELL), ctx = cv.getContext('2d');
    bookcaseFrame(ctx, w);
    var bookAt = new Int16Array(w); bookAt.fill(-1);
    shelf.layout.forEach(function (it, li) {
      var sp = it.spec, x = it.x, bw = it.w, top = FLOOR_Y - it.hpx, bh = it.hpx;
      var r = rnd(SW.hash(it.book.id));
      // shadow behind (cast onto the back panel) then the spine
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + bw, top + 4, 3, bh);
      ctx.fillStyle = rgb(sp.rgb); ctx.fillRect(x, top, bw, bh);
      if (sp.style === 'cloth') { ctx.save(); ctx.globalAlpha = 0.18; ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = noisePattern(ctx); ctx.fillRect(x, top, bw, bh); ctx.restore(); }
      if (sp.band) {
        var bhgt = Math.max(8, Math.round(bh * 0.13));
        ctx.fillStyle = rgb(sp.bandRGB); ctx.fillRect(x, top + 6, bw, bhgt); ctx.fillRect(x, top + bh - 6 - bhgt, bw, bhgt);
      }
      if (sp.gloss) {
        var gg = ctx.createLinearGradient(x, top, x + bw, top + bh);
        var gc = sp.gloss === 'gold' ? '255,220,140' : '220,230,245';
        gg.addColorStop(0, 'rgba(' + gc + ',0)'); gg.addColorStop(0.42, 'rgba(' + gc + ',0.05)'); gg.addColorStop(0.5, 'rgba(' + gc + ',0.42)'); gg.addColorStop(0.58, 'rgba(' + gc + ',0.05)'); gg.addColorStop(1, 'rgba(' + gc + ',0)');
        ctx.fillStyle = gg; ctx.fillRect(x, top, bw, bh);
      }
      // rounding: highlight left, shadow right, top edge
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x, top, 2, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x + bw - 3, top, 3, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, top, bw, 1);
      // a few spines get horizontal rules
      if (r() < 0.35) { ctx.fillStyle = rgb(sp.ink, 0.5); ctx.fillRect(x + 3, top + bh - 22, bw - 6, 1); ctx.fillRect(x + 3, top + 14, bw - 6, 1); }
      // title
      var t = it.book.t || '';
      ctx.fillStyle = rgb(sp.ink, 0.95);
      if (sp.cjk) {
        var fs = Math.max(8, Math.min(18, Math.round(bw * 0.62)));
        ctx.font = fs + 'px ' + FONT_SERIF; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        var maxN = Math.floor((bh - 34) / (fs + 1)), cy;
        var chars = Array.from(t.replace(/\s+/g, ''));
        if (chars.length > maxN) { chars = chars.slice(0, Math.max(1, maxN - 1)); chars.push('…'); }
        cy = top + Math.max(10, Math.round((bh - 16 - chars.length * (fs + 1)) / 2));
        for (var ci = 0; ci < chars.length; ci++) { ctx.fillText(chars[ci], x + bw / 2, cy); cy += fs + 1; }
      } else {
        var fs2 = Math.max(8, Math.min(13, Math.round(bw * 0.42)));
        ctx.font = (sp.gloss ? 'bold ' : '') + fs2 + 'px ' + FONT_SERIF; ctx.textBaseline = 'middle';
        var maxW = bh - 30, tw = ctx.measureText(t).width;
        if (t.length <= 3 && tw <= bw - 6) { ctx.textAlign = 'center'; ctx.fillText(t, x + bw / 2, top + 20); }
        else {
          var txt = t;
          if (tw > maxW) { while (txt.length > 1 && ctx.measureText(txt + '…').width > maxW) txt = txt.slice(0, -1); txt = txt.trim() + '…'; }
          ctx.save(); ctx.translate(x + bw / 2 + 1, top + (bh - 14) / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(txt, 0, 0); ctx.restore();
        }
      }
      // author initials
      var ini = initials(it.book.a);
      if (ini && bw >= 14) { ctx.font = '7px ' + FONT_SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = rgb(sp.ink, 0.8); ctx.fillText(ini, x + bw / 2, FLOOR_Y - 7); }
      for (var k = x; k < x + bw && k < w; k++) bookAt[k] = li;
    });
    var last = shelf.layout.length ? shelf.layout[shelf.layout.length - 1] : null;
    var endX = last ? last.x + last.w + 4 : SW.MARGIN + 4;
    if (shelf.cat) { drawArt(ctx, ART.cat, endX + 6, FLOOR_Y - 16 * 4, 4); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(endX + 12, FLOOR_Y - 2, 60, 2); }
    else if (shelf.leftover >= 30 && last) bookend(ctx, endX);
    var tex = texOf(cv); tex.bookAt = bookAt; return tex;
  }

  function makeEmptyTexture(face, aisle) {
    var cv = canvas(CELL, CELL), ctx = cv.getContext('2d'); bookcaseFrame(ctx, CELL);
    var r = rnd(face.seed);
    var hue = SW.hash(aisle.topGenre) % 360;
    // a flat pile of returns
    var n = 2 + Math.floor(r() * 4), x = 30 + Math.floor(r() * 80), y = FLOOR_Y;
    for (var i = 0; i < n; i++) {
      var pw = 90 + Math.floor(r() * 60), ph = 9 + Math.floor(r() * 8); y -= ph;
      ctx.fillStyle = 'hsl(' + ((hue + r() * 60) | 0) + ',' + (30 + r() * 30) + '%,' + (28 + r() * 20) + '%)';
      ctx.fillRect(x + (r() - 0.5) * 14, y, pw, ph);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y, pw, 1);
    }
    if (r() < 0.6) bookend(ctx, CELL - 70);
    return texOf(cv);
  }

  function plasterBase(ctx, w, h, seed) {
    ctx.fillStyle = '#cfc4ad'; ctx.fillRect(0, 0, w, h); grain(ctx, w, h, 0.35);
    var r = rnd(seed);
    for (var i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(0,0,0,' + (r() * 0.06) + ')'; ctx.fillRect(r() * w, r() * h, r() * 40, r() * 40); }
    // dado rail and baseboard
    ctx.fillStyle = '#6c4a2e'; ctx.fillRect(0, h - 26, w, 26); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(0, h - 26, w, 2);
    ctx.fillStyle = '#8a6a4a'; ctx.fillRect(0, Math.round(h * 0.68), w, 5);
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  function makePlaster() { var cv = canvas(CELL, CELL), ctx = cv.getContext('2d'); plasterBase(ctx, CELL, CELL, 99); return texOf(cv); }
  function makeSignTexture(face) {
    var cv = canvas(CELL, CELL), ctx = cv.getContext('2d'); plasterBase(ctx, CELL, CELL, SW.hash(face.unit));
    ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = '#243a2a';
    var label = face.unit.toUpperCase(), big = label.length <= 2 ? 118 : label.length <= 5 ? 56 : 40;
    ctx.font = 'bold ' + big + 'px ' + FONT_SERIF; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, CELL / 2, 118);
    ctx.fillStyle = '#5a2a22'; ctx.fillRect(40, 128, CELL - 80, 2);
    ctx.fillStyle = '#243a2a'; ctx.font = '13px ' + FONT_SANS;
    ctx.fillText((face.count + ' books · ' + face.shelfCount + (face.shelfCount === 1 ? ' shelf' : ' shelves')).toUpperCase(), CELL / 2, 148);
    ctx.font = 'italic 15px ' + FONT_SERIF; ctx.fillStyle = '#4a2a22';
    face.genres.forEach(function (g, i) { ctx.fillText(g, CELL / 2, 166 + i * 17); });
    ctx.restore();
    // painted border
    ctx.strokeStyle = 'rgba(36,58,42,0.7)'; ctx.lineWidth = 2; ctx.strokeRect(22, 22, CELL - 44, CELL * 0.68 - 36);
    return texOf(cv);
  }
  function makePlaqueTexture(face) {
    var cv = canvas(CELL, CELL), ctx = cv.getContext('2d'); plasterBase(ctx, CELL, CELL, 5);
    ctx.fillStyle = 'rgba(36,58,42,0.9)'; ctx.font = 'bold 44px ' + FONT_SERIF; ctx.textBaseline = 'middle';
    var ty = 92;
    ctx.textAlign = 'left'; if (face.left) ctx.fillText('‹ ' + face.left.slice(0, 5), 18, ty);
    ctx.textAlign = 'right'; if (face.right) ctx.fillText(face.right.slice(0, 5) + ' ›', CELL - 18, ty);
    ctx.fillStyle = 'rgba(90,42,34,0.7)'; ctx.fillRect(18, ty + 30, CELL - 36, 2);
    return texOf(cv);
  }
  function makeFloor() {
    var S = 128, cv = canvas(S, S), ctx = cv.getContext('2d'), r = rnd(21);
    ctx.fillStyle = '#4a2f1b'; ctx.fillRect(0, 0, S, S);
    for (var by = 0; by < 4; by++) for (var bx = 0; bx < 4; bx++) {
      var vert = (bx + by) % 2 === 0;
      for (var k = 0; k < 4; k++) {
        var l = 22 + r() * 16, hue = 22 + r() * 10;
        ctx.fillStyle = 'hsl(' + hue + ',45%,' + l + '%)';
        var x = bx * 32 + (vert ? k * 8 : 0), y = by * 32 + (vert ? 0 : k * 8), w = vert ? 8 : 32, h = vert ? 32 : 8;
        ctx.fillRect(x, y, w, h);
        woodGrain(ctx, x, y, w, h, (bx * 7 + by * 13 + k) | 0, vert);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; if (vert) ctx.fillRect(x + w - 1, y, 1, h); else ctx.fillRect(x, y + h - 1, w, 1);
        ctx.fillStyle = 'rgba(255,230,190,0.08)'; if (vert) ctx.fillRect(x, y, 1, h); else ctx.fillRect(x, y, w, 1);
      }
    }
    grain(ctx, S, S, 0.25);
    return texOf(cv);
  }
  function makeCeiling() {
    var S = 64, cv = canvas(S, S), ctx = cv.getContext('2d');
    ctx.fillStyle = '#2a2420'; ctx.fillRect(0, 0, S, S); grain(ctx, S, S, 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, S, 1); ctx.fillRect(0, 0, 1, S);
    return texOf(cv);
  }

  /* ---------------- state ---------------- */
  var world, books, faceTex = [], plasterTex, floorTex, ceilTex, sprites = [], spriteImgs = {};
  var LM, LMW, LMH, LMR = 4;             // lightmap
  var explored;
  var player = { x: 2.5, y: 1.5, a: 0, pitch: 0 };
  var keys = {}, touch = { move: null, look: null }, moveVec = { f: 0, s: 0 };
  var W = 640, H = 400, P = 457, buf, px, zbuf, colBook, colShelf, colDist, colFace;
  var view = $('view'), vctx = view.getContext('2d');
  var mini = $('minimap'), mctx = mini.getContext('2d'), miniScale = 5;
  var paused = false, bobPhase = 0, lastT = 0, highlight = -1, highlightUntil = 0, crt = false;
  var bookStamp, stampNo = 0, centre = { item: null, shelf: null, dist: 99, face: null };
  var hudTimer = 0, resScale = 0.5, slowFrames = 0;

  function resize() {
    var stage = $('stage'), cw = stage.clientWidth || 640, ch = stage.clientHeight || 400;
    W = Math.max(240, Math.min(640, Math.round(cw * resScale))); H = Math.max(150, Math.round(W * ch / cw));
    P = (W / 2) / Math.tan(35 * Math.PI / 180);
    view.width = W; view.height = H;
    buf = vctx.createImageData(W, H); px = new Uint32Array(buf.data.buffer);
    zbuf = new Float32Array(W); colBook = new Int32Array(W); colShelf = new Int32Array(W); colDist = new Float32Array(W); colFace = new Int32Array(W);
    miniScale = cw < 640 ? 3 : 5;
    if (world) { mini.width = world.W * miniScale; mini.height = world.H * miniScale; mini.style.width = mini.width + 'px'; mini.style.height = mini.height + 'px'; }
  }

  function buildLightmap() {
    LMW = world.W * LMR; LMH = world.H * LMR; LM = new Float32Array(LMW * LMH);
    var g = world.grid, gw = world.W;
    function clear(x0, y0, x1, y1) {
      var dx = x1 - x0, dy = y1 - y0, d = Math.sqrt(dx * dx + dy * dy), n = Math.ceil(d / 0.2);
      for (var i = 1; i < n; i++) { var t = i / n; if (g[((y0 + dy * t) | 0) * gw + ((x0 + dx * t) | 0)]) return false; }
      return true;
    }
    for (var iy = 0; iy < LMH; iy++) for (var ix = 0; ix < LMW; ix++) {
      var sx = (ix + 0.5) / LMR, sy = (iy + 0.5) / LMR;
      var sum = 0;
      for (var li = 0; li < world.lamps.length; li++) {
        var L = world.lamps[li], dx = L.x - sx, dy = L.y - sy, d2 = dx * dx + dy * dy;
        if (d2 > 49) continue;
        if (!clear(L.x, L.y, sx, sy)) continue;
        sum += 1.2 / (1 + 1.4 * d2);
      }
      LM[iy * LMW + ix] = sum;
    }
    // walls: borrow from the nearest open sample so wall faces are lit by the room they face
    var copy = new Float32Array(LM);
    for (var y2 = 0; y2 < LMH; y2++) for (var x2 = 0; x2 < LMW; x2++) {
      if (!g[((y2 + 0.5) / LMR | 0) * gw + ((x2 + 0.5) / LMR | 0)]) continue;
      var best = 0;
      for (var oy = -2; oy <= 2; oy++) for (var ox = -2; ox <= 2; ox++) {
        var nx = x2 + ox, ny = y2 + oy; if (nx < 0 || ny < 0 || nx >= LMW || ny >= LMH) continue;
        if (g[((ny + 0.5) / LMR | 0) * gw + ((nx + 0.5) / LMR | 0)]) continue;
        if (copy[ny * LMW + nx] > best) best = copy[ny * LMW + nx];
      }
      LM[y2 * LMW + x2] = best;
    }
  }
  function light(x, y) { // bilinear
    var fx = x * LMR - 0.5, fy = y * LMR - 0.5;
    var ix = fx | 0, iy = fy | 0;
    if (ix < 0) ix = 0; if (iy < 0) iy = 0; if (ix >= LMW - 1) ix = LMW - 2; if (iy >= LMH - 1) iy = LMH - 2;
    var tx = fx - ix, ty = fy - iy; if (tx < 0) tx = 0; if (ty < 0) ty = 0; if (tx > 1) tx = 1; if (ty > 1) ty = 1;
    var i = iy * LMW + ix;
    var a = LM[i] + (LM[i + 1] - LM[i]) * tx, b = LM[i + LMW] + (LM[i + LMW + 1] - LM[i + LMW]) * tx;
    return a + (b - a) * ty;
  }

  /* ---------------- rendering ---------------- */
  function shadePx(p, sr, sg, sb) {
    var r = ((p & 255) * sr) | 0, g = (((p >>> 8) & 255) * sg) | 0, b = (((p >>> 16) & 255) * sb) | 0;
    if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
  var AMB = 0.1, WARM_R = 1.0, WARM_G = 0.9, WARM_B = 0.7;

  function render(t) {
    var dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    var tanH = Math.tan(35 * Math.PI / 180);
    var plX = -dirY * tanH, plY = dirX * tanH;
    var bob = REDUCED ? 0 : Math.sin(bobPhase) * H * 0.012;
    var horizon = (H / 2 + player.pitch * H + bob) | 0;
    var posX = player.x, posY = player.y;
    var x, y, i;

    // floor and ceiling, row by row
    var rdx0 = dirX - plX, rdy0 = dirY - plY, rdx1 = dirX + plX, rdy1 = dirY + plY;
    var fw = floorTex.w, fh = floorTex.h, fd = floorTex.data, cw = ceilTex.w, chh = ceilTex.h, cd = ceilTex.data;
    for (var p = 1; p < H; p++) {
      var yF = horizon + p, yC = horizon - p;
      if (yF >= H && yC < 0) break;
      var rowDist = P * 0.5 / p;
      var fog = 1 / (1 + rowDist * rowDist * 0.045);
      var stepX = rowDist * (rdx1 - rdx0) / W, stepY = rowDist * (rdy1 - rdy0) / W;
      var fx = posX + rowDist * rdx0, fy = posY + rowDist * rdy0;
      var rowF = yF * W, rowC = yC * W;
      var doF = yF < H, doC = yC >= 0;
      for (x = 0; x < W; x++) {
        var cx = fx | 0, cy = fy | 0;
        var L = light(fx, fy);
        var sr = (AMB + L * WARM_R) * fog, sg = (AMB + L * WARM_G) * fog, sb = (AMB + L * WARM_B) * fog;
        if (doF) {
          var tx = ((fx - cx) * fw) | 0, ty = ((fy - cy) * fh) | 0;
          px[rowF + x] = shadePx(fd[ty * fw + tx], sr, sg, sb);
        }
        if (doC) {
          var tx2 = ((fx - cx) * cw) | 0, ty2 = ((fy - cy) * chh) | 0;
          px[rowC + x] = shadePx(cd[ty2 * cw + tx2], sr * 0.8, sg * 0.8, sb * 0.8);
        }
        fx += stepX; fy += stepY;
      }
    }

    // walls
    var grid = world.grid, gw = world.W, faces = world.faces;
    var cItem = null, cShelf = null, cDist = 99, cFace = null;
    stampNo++;
    var inView = 0;
    var now = t;
    var hl = now < highlightUntil ? highlight : -1;
    for (x = 0; x < W; x++) {
      var camX = 2 * x / W - 1;
      var rdX = dirX + plX * camX, rdY = dirY + plY * camX;
      var mapX = posX | 0, mapY = posY | 0;
      var ddX = rdX === 0 ? 1e30 : Math.abs(1 / rdX), ddY = rdY === 0 ? 1e30 : Math.abs(1 / rdY);
      var sX, sY, sdX, sdY, side = 0, hit = 0, steps = 0;
      if (rdX < 0) { sX = -1; sdX = (posX - mapX) * ddX; } else { sX = 1; sdX = (mapX + 1 - posX) * ddX; }
      if (rdY < 0) { sY = -1; sdY = (posY - mapY) * ddY; } else { sY = 1; sdY = (mapY + 1 - posY) * ddY; }
      while (!hit && steps++ < 64) {
        if (sdX < sdY) { sdX += ddX; mapX += sX; side = 0; } else { sdY += ddY; mapY += sY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= gw || mapY >= world.H) { hit = 1; break; }
        explored[mapY * gw + mapX] = 1;
        if (grid[mapY * gw + mapX]) hit = 1;
      }
      var perp = side === 0 ? sdX - ddX : sdY - ddY;
      if (perp < 0.01) perp = 0.01;
      zbuf[x] = perp;
      var wallX = side === 0 ? posY + perp * rdY : posX + perp * rdX; wallX -= wallX | 0;
      var dir = side === 0 ? (sX > 0 ? 3 : 1) : (sY > 0 ? 0 : 2);
      var u = dir === 0 ? 1 - wallX : dir === 2 ? wallX : dir === 3 ? wallX : 1 - wallX;
      var fi = (mapX >= 0 && mapY >= 0 && mapX < gw && mapY < world.H) ? faces[(mapY * gw + mapX) * 4 + dir] : -1;
      var face = fi >= 0 ? world.faceList[fi] : null;
      var tex = fi >= 0 ? faceTex[fi] : plasterTex;
      var U = face && face.kind === 'shelf' ? (face.idx + u) / face.span : u;
      var texX = (U * tex.w) | 0; if (texX >= tex.w) texX = tex.w - 1; if (texX < 0) texX = 0;
      var book = -1, shelfIdx = -1;
      if (face && face.kind === 'shelf') {
        shelfIdx = face.shelf.index;
        var li = tex.bookAt[texX];
        if (li >= 0) { book = face.shelf.layout[li].book._i; if (bookStamp[book] !== stampNo) { bookStamp[book] = stampNo; inView++; } }
      }
      colBook[x] = book; colShelf[x] = shelfIdx; colDist[x] = perp; colFace[x] = fi;
      var lineH = P / perp;
      var top = horizon - lineH / 2, ds = top | 0, de = (top + lineH) | 0;
      if (ds < 0) ds = 0; if (de > H) de = H;
      // light at the hit point, pulled slightly back into the room
      var hx = posX + rdX * perp * 0.96, hy = posY + rdY * perp * 0.96;
      var Lw = light(hx, hy);
      var fogw = 1 / (1 + perp * perp * 0.045);
      if (side === 1) fogw *= 0.86;
      var boost = (hl >= 0 && book === hl) ? (1.6 + 0.4 * Math.sin(now / 90)) : 1;
      var wr = (AMB + Lw * WARM_R) * fogw * boost, wg = (AMB + Lw * WARM_G) * fogw * boost, wb = (AMB + Lw * WARM_B) * fogw * boost;
      var step = tex.h / lineH, texPos = (ds - top) * step;
      var td = tex.data, tw = tex.w, th = tex.h;
      for (y = ds; y < de; y++) {
        var tY = texPos | 0; if (tY >= th) tY = th - 1;
        texPos += step;
        px[y * W + x] = shadePx(td[tY * tw + texX], wr, wg, wb);
      }
    }
    // centre column (average of the middle few)
    var cx0 = W >> 1;
    if (colBook[cx0] >= 0 || colFace[cx0] >= 0) {
      cDist = colDist[cx0]; cFace = colFace[cx0] >= 0 ? world.faceList[colFace[cx0]] : null;
      if (colBook[cx0] >= 0) { cItem = books[colBook[cx0]]; cShelf = world.shelves[colShelf[cx0]]; }
    }
    centre.item = cItem; centre.shelf = cShelf; centre.dist = cDist; centre.face = cFace; centre.inView = inView;

    // sprites
    var invDet = 1 / (plX * dirY - dirX * plY);
    for (i = 0; i < sprites.length; i++) {
      var s = sprites[i], rx = s.x - posX, ry = s.y - posY;
      s.tx = invDet * (dirY * rx - dirX * ry); s.ty = invDet * (-plY * rx + plX * ry);
    }
    sprites.sort(function (a, b) { return b.ty - a.ty; });
    for (i = 0; i < sprites.length; i++) {
      var sp = sprites[i]; if (sp.ty <= 0.08) continue;
      var img = sp.img, sw = img.w, sh = img.h;
      var scrX = (W / 2) * (1 + sp.tx / sp.ty);
      var hPx = sp.hs * P / sp.ty, wPx = sp.ws * P / sp.ty;
      var sTop = horizon - (sp.z0 + sp.hs - 0.5) * P / sp.ty, sBot = sTop + hPx;
      var x0 = (scrX - wPx / 2) | 0, x1 = (scrX + wPx / 2) | 0;
      var ys = sTop < 0 ? 0 : sTop | 0, ye = sBot > H ? H : sBot | 0;
      if (x1 < 0 || x0 >= W || ye <= ys) continue;
      var Ls = light(sp.x, sp.y), fogs = 1 / (1 + sp.ty * sp.ty * 0.045);
      var er = sp.emissive ? 1 : (AMB + Ls * WARM_R) * fogs, eg = sp.emissive ? 1 : (AMB + Ls * WARM_G) * fogs, eb = sp.emissive ? 1 : (AMB + Ls * WARM_B) * fogs;
      if (sp.emissive) { er = eg = eb = 0.75 + fogs * 0.35; }
      for (x = x0 < 0 ? 0 : x0; x < x1 && x < W; x++) {
        if (sp.ty >= zbuf[x]) continue;
        var sx = (((x - (scrX - wPx / 2)) / wPx) * sw) | 0; if (sx < 0) sx = 0; if (sx >= sw) sx = sw - 1;
        for (y = ys; y < ye; y++) {
          var sy = (((y - sTop) / hPx) * sh) | 0; if (sy < 0) sy = 0; if (sy >= sh) sy = sh - 1;
          var c = img.data[sy * sw + sx], al = c >>> 24; if (!al) continue;
          var o = y * W + x, shaded = shadePx(c, er, eg, eb);
          if (al === 255) px[o] = shaded;
          else {
            var q = px[o], a = al / 255, ia = 1 - a;
            var r2 = ((q & 255) * ia + (shaded & 255) * a) | 0, g2 = (((q >>> 8) & 255) * ia + ((shaded >>> 8) & 255) * a) | 0, b2 = (((q >>> 16) & 255) * ia + ((shaded >>> 16) & 255) * a) | 0;
            px[o] = (0xff000000 | (b2 << 16) | (g2 << 8) | r2) >>> 0;
          }
        }
      }
    }
    vctx.putImageData(buf, 0, 0);
  }

  function drawMinimap() {
    var gw = world.W, gh = world.H, s = miniScale;
    mctx.clearRect(0, 0, mini.width, mini.height);
    for (var y = 0; y < gh; y++) for (var x = 0; x < gw; x++) {
      if (!explored[y * gw + x]) continue;
      mctx.fillStyle = world.grid[y * gw + x] ? '#6a4a2e' : '#d8c9a6';
      mctx.fillRect(x * s, y * s, s, s);
    }
    mctx.fillStyle = '#ffd37a';
    for (var i = 0; i < world.lamps.length; i++) { var L = world.lamps[i]; if (explored[(L.y | 0) * gw + (L.x | 0)]) mctx.fillRect(L.x * s - 1, L.y * s - 1, 2, 2); }
    mctx.strokeStyle = '#ff5a3c'; mctx.lineWidth = 1.5; mctx.beginPath();
    mctx.moveTo(player.x * s, player.y * s); mctx.lineTo(player.x * s + Math.cos(player.a) * s * 1.6, player.y * s + Math.sin(player.a) * s * 1.6); mctx.stroke();
    mctx.fillStyle = '#ff5a3c'; mctx.beginPath(); mctx.arc(player.x * s, player.y * s, Math.max(1.6, s * 0.4), 0, Math.PI * 2); mctx.fill();
  }

  /* ---------------- movement ---------------- */
  function free(x, y) {
    var r = 0.24, gw = world.W, g = world.grid;
    return !g[((y - r) | 0) * gw + ((x - r) | 0)] && !g[((y - r) | 0) * gw + ((x + r) | 0)] && !g[((y + r) | 0) * gw + ((x - r) | 0)] && !g[((y + r) | 0) * gw + ((x + r) | 0)];
  }
  function aisleAt(x, y) {
    if (y < 3) return null;
    for (var i = 0; i < world.aisles.length; i++) if (world.aisles[i].x === (x | 0)) return world.aisles[i];
    return null;
  }
  function update(dt) {
    var f = 0, s = 0, turn = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD) s += 1; if (keys.KeyA) s -= 1;
    if (keys.ArrowRight) turn += 1; if (keys.ArrowLeft) turn -= 1;
    f += moveVec.f; s += moveVec.s;
    if (f > 1) f = 1; if (f < -1) f = -1; if (s > 1) s = 1; if (s < -1) s = -1;
    player.a += turn * 2.0 * dt;
    var sp = 2.5 * dt, dx = Math.cos(player.a), dy = Math.sin(player.a);
    var mx = (dx * f - dy * s) * sp, my = (dy * f + dx * s) * sp;
    if (free(player.x + mx, player.y)) player.x += mx;
    if (free(player.x, player.y + my)) player.y += my;
    var moving = Math.abs(f) + Math.abs(s) > 0.1;
    if (moving) bobPhase += dt * 9; else bobPhase = 0;
  }

  /* ---------------- HUD / card ---------------- */
  function hud() {
    var a = aisleAt(player.x, player.y), where;
    var shelfName = centre.shelf ? centre.shelf.name : (centre.face && centre.face.kind === 'shelf' ? centre.face.shelf.name : null);
    if (a) where = 'Aisle ' + a.unit + (shelfName ? ' · shelf ' + shelfName : '') + ' · ' + centre.inView + (centre.inView === 1 ? ' book' : ' books') + ' in view';
    else where = 'The hall · ' + world.aisles.length + ' aisles' + (shelfName ? ' · shelf ' + shelfName : '') + ' · ' + centre.inView + ' books in view';
    $('where').textContent = where;
    var look = $('look'), ret = $('reticle');
    if (centre.item && centre.dist < 2.6) {
      look.innerHTML = ''; var b = document.createElement('b'); b.textContent = centre.item.t; look.appendChild(b);
      var d = document.createElement('span'); d.className = 'dim'; d.textContent = '  — E to pull'; look.appendChild(d); ret.classList.add('hot');
    } else if (centre.face && centre.face.kind === 'sign' && centre.dist < 6) {
      look.textContent = 'Aisle ' + centre.face.unit + ': ' + centre.face.genres.join(' · '); ret.classList.remove('hot');
    } else { look.textContent = ''; ret.classList.remove('hot'); }
  }
  function openCard(b, shelf) {
    var loc = world.bookLoc[b.id], it = shelf ? shelf.layout[loc.item] : null;
    $('card-title').textContent = b.t;
    $('card-by').textContent = b.a ? b.a : 'author not recorded';
    var meta = $('card-meta'); meta.innerHTML = '';
    [['year', b.yr || b.y || '—'], ['genre', b.g || '—'], ['type', b.ty || '—'], ['lang', b.l || '—'], b.pub ? ['publisher', b.pub] : null].forEach(function (m) {
      if (!m) return; var s = document.createElement('span'); s.textContent = m[0] + ' '; var v = document.createElement('b'); v.textContent = m[1]; s.appendChild(v); meta.appendChild(s);
    });
    $('card-desc').textContent = b.d || 'No description in the catalogue.';
    $('card-loc').textContent = 'unit ' + b.u + ' · shelf ' + b.s + ' · position ' + b.p + ' · ' + b.id;
    $('card-spine').style.background = it ? rgb(it.spec.rgb) : '#555';
    $('shade').classList.add('show'); $('card').classList.add('show'); paused = true;
    $('card-close').focus();
  }
  function closeCard() { $('shade').classList.remove('show'); $('card').classList.remove('show'); paused = false; lastT = 0; }
  function pull() {
    if (paused) return;
    if (centre.item && centre.dist < 2.6) openCard(centre.item, centre.shelf);
  }
  function findTitle(q) {
    q = (q || '').trim().toLowerCase(); if (!q) return;
    var b = books.find(function (x) { return x.t.toLowerCase() === q; }) || books.find(function (x) { return x.t.toLowerCase().indexOf(q) === 0; }) || books.find(function (x) { return x.t.toLowerCase().indexOf(q) >= 0; }) || books.find(function (x) { return (x.a || '').toLowerCase().indexOf(q) >= 0; });
    if (!b) { $('look').textContent = 'no such title on these shelves'; return; }
    var st = SW.standAt(world, b.id); if (!st) return;
    player.x = st.x; player.y = st.y; player.a = st.a; player.pitch = 0;
    highlight = b._i; highlightUntil = performance.now() + 5000;
    $('find').blur();
  }

  /* ---------------- input ---------------- */
  function bindInput() {
    var stage = $('stage');
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Escape') { if (paused) closeCard(); $('help').classList.remove('show'); return; }
      if (e.code === 'KeyE' || ((e.code === 'Space' || e.code === 'Enter') && !(e.target && e.target.tagName === 'BUTTON'))) { if (paused) closeCard(); else pull(); e.preventDefault(); return; }
      if (e.code === 'KeyC') { toggleCrt(); return; }
      if (e.code === 'KeyM') { miniScale = miniScale >= 8 ? (stage.clientWidth < 640 ? 3 : 5) : 8; resize(); return; }
      if (e.code === 'Slash' || e.key === '?') { $('help').classList.toggle('show'); return; }
      if (e.code === 'KeyF' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('find').focus(); return; }
      keys[e.code] = true;
      if (/^Arrow|^Key[WASD]$/.test(e.code)) { e.preventDefault(); $('keys').classList.add('fade'); }
    });
    document.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { keys = {}; });

    // mouse look
    var locked = false;
    view.addEventListener('click', function () {
      if (paused) return;
      if (document.pointerLockElement === view) { pull(); return; }
      try { var pr = view.requestPointerLock && view.requestPointerLock(); if (pr && pr.catch) pr.catch(function () {}); } catch (err) { /* unavailable */ }
      $('keys').classList.add('fade');
    });
    document.addEventListener('pointerlockchange', function () { locked = document.pointerLockElement === view; });
    document.addEventListener('mousemove', function (e) {
      if (!locked || paused) return;
      player.a += e.movementX * 0.0028;
      player.pitch -= e.movementY * 0.0012; if (player.pitch > 0.3) player.pitch = 0.3; if (player.pitch < -0.3) player.pitch = -0.3;
    });

    // touch: left half joystick, right half look, centre tap pulls
    var stick = $('stick');
    stage.addEventListener('touchstart', function (e) {
      if (paused) return;
      var r = stage.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i], lx = t.clientX - r.left;
        var rec = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, t0: performance.now(), moved: 0 };
        if (lx < r.width / 2 && !touch.move) { touch.move = rec; stick.style.display = 'block'; stick.style.left = (lx - 45) + 'px'; stick.style.top = (t.clientY - r.top - 45) + 'px'; }
        else if (!touch.look) touch.look = rec;
      }
      e.preventDefault();
    }, { passive: false });
    stage.addEventListener('touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (touch.move && t.identifier === touch.move.id) {
          var m = touch.move, dx = t.clientX - m.x0, dy = t.clientY - m.y0, d = Math.hypot(dx, dy);
          m.moved = Math.max(m.moved, d);
          if (d > 50) { dx *= 50 / d; dy *= 50 / d; }
          moveVec.f = -dy / 50; moveVec.s = dx / 50;
          stick.firstElementChild.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        } else if (touch.look && t.identifier === touch.look.id) {
          var l = touch.look; player.a += (t.clientX - l.x) * 0.006; player.pitch -= (t.clientY - l.y) * 0.002;
          if (player.pitch > 0.3) player.pitch = 0.3; if (player.pitch < -0.3) player.pitch = -0.3;
          l.moved = Math.max(l.moved, Math.hypot(t.clientX - l.x0, t.clientY - l.y0)); l.x = t.clientX; l.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    function touchEnd(e) {
      var r = stage.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i], rec = null;
        if (touch.move && t.identifier === touch.move.id) { rec = touch.move; touch.move = null; moveVec.f = moveVec.s = 0; stick.style.display = 'none'; stick.firstElementChild.style.transform = ''; }
        else if (touch.look && t.identifier === touch.look.id) { rec = touch.look; touch.look = null; }
        if (rec && rec.moved < 8 && performance.now() - rec.t0 < 400) {
          var lx = (t.clientX - r.left) / r.width, ly = (t.clientY - r.top) / r.height;
          if (lx > 0.3 && lx < 0.7 && ly > 0.25 && ly < 0.75) { if (paused) closeCard(); else pull(); }
        }
      }
    }
    stage.addEventListener('touchend', touchEnd); stage.addEventListener('touchcancel', touchEnd);

    $('card-close').addEventListener('click', closeCard);
    $('shade').addEventListener('click', closeCard);
    $('btn-help').addEventListener('click', function () { $('help').classList.toggle('show'); });
    $('btn-close').addEventListener('click', function () { $('help').classList.remove('show'); });
    $('help').addEventListener('click', function (e) { if (e.target === $('help')) $('help').classList.remove('show'); });
    $('btn-crt').addEventListener('click', toggleCrt);
    $('find').addEventListener('change', function () { findTitle(this.value); });
    $('find').addEventListener('keydown', function (e) { if (e.key === 'Enter') { findTitle(this.value); e.preventDefault(); } if (e.key === 'Escape') this.blur(); e.stopPropagation(); });
    window.addEventListener('resize', resize);
  }
  function toggleCrt() { crt = !crt; $('stage').classList.toggle('crt', crt); $('btn-crt').classList.toggle('on', crt); }

  /* ---------------- main loop ---------------- */
  var bench = params.get('bench') === '1', benchN = 0, benchMs = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    if (paused) return;
    var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0; lastT = t;
    update(dt);
    var t0 = performance.now();
    render(t);
    // adaptive: if rendering alone eats most of a 60 Hz frame for a while, drop the internal resolution a notch
    if (performance.now() - t0 > 15) { if (++slowFrames > 45 && resScale > 0.34) { resScale -= 0.08; slowFrames = 0; resize(); } } else if (slowFrames > 0) slowFrames--;
    if (bench) { benchMs += performance.now() - t0; if (++benchN === 10) { console.log('bench ' + W + 'x' + H + ' avg render ms ' + (benchMs / 10).toFixed(2)); benchN = 0; benchMs = 0; } }
    drawMinimap();
    hudTimer += dt; if (hudTimer > 0.12 || dt === 0) { hudTimer = 0; hud(); }
  }

  /* ---------------- boot ---------------- */
  function boot(data) {
    books = data.books.filter(function (b) { return b && b.t; });
    books.forEach(function (b, i) { b._i = i; });
    world = SW.build(books);
    explored = new Uint8Array(world.W * world.H);
    bookStamp = new Uint32Array(books.length);
    // textures
    plasterTex = makePlaster(); floorTex = makeFloor(); ceilTex = makeCeiling();
    var shelfTex = world.shelves.map(makeShelfTexture);
    world.faceList.forEach(function (f, i) {
      if (f.kind === 'shelf') faceTex[i] = shelfTex[f.shelf.index];
      else if (f.kind === 'sign') faceTex[i] = makeSignTexture(f);
      else if (f.kind === 'plaque') faceTex[i] = makePlaqueTexture(f);
      else if (f.kind === 'empty') faceTex[i] = makeEmptyTexture(f, world.aisles[f.aisle]);
      else faceTex[i] = plasterTex;
    });
    buildLightmap();
    // sprites
    spriteImgs.chair = artImage(ART.chair, false); spriteImgs.chairF = artImage(ART.chair, true);
    spriteImgs.lamp = artImage(ART.lamp, false); spriteImgs.plant = artImage(ART.plant, false);
    world.sprites.forEach(function (s) {
      if (s.type === 'chair') sprites.push({ x: s.x, y: s.y, img: s.flip ? spriteImgs.chairF : spriteImgs.chair, hs: 0.62, ws: 0.62, z0: 0 });
      if (s.type === 'plant') sprites.push({ x: s.x, y: s.y, img: spriteImgs.plant, hs: 0.6, ws: 0.4, z0: 0 });
    });
    world.lamps.forEach(function (L) { sprites.push({ x: L.x, y: L.y, img: spriteImgs.lamp, hs: 0.36, ws: 0.216, z0: 0.64, emissive: true }); });
    // datalist
    var dl = $('titles'), frag = document.createDocumentFragment();
    books.slice().sort(function (a, b) { return a.t.localeCompare(b.t); }).forEach(function (b) { var o = document.createElement('option'); o.value = b.t; frag.appendChild(o); });
    dl.appendChild(frag);
    // start position
    var st = THUMB ? world.thumb : world.spawn;
    player.x = st.x; player.y = st.y; player.a = st.a;
    var at = (params.get('at') || '').split(',').map(Number);
    if (at.length === 3 && at.every(isFinite)) { player.x = at[0]; player.y = at[1]; player.a = at[2]; }
    if (params.get('find')) findTitle(params.get('find'));
    if (params.get('card')) { var cb = books.find(function (b) { return b.id === params.get('card'); }); if (cb) requestAnimationFrame(function () { requestAnimationFrame(function () { openCard(cb, world.shelves[world.bookLoc[cb.id].shelf]); }); }); }
    if (THUMB) { $('keys').style.display = 'none'; }
    if (params.get('crt') === '1') toggleCrt();
    resize();
    bindInput();
    requestAnimationFrame(loop);
  }

  var msg = $('msg');
  msg.textContent = 'Shelving ' + '…'; msg.classList.add('show');
  fetch('../../assets/data/library.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { msg.classList.remove('show'); boot(data); })
    .catch(function (err) {
      msg.textContent = 'Could not load the library catalogue (' + err.message + '). The stacks need assets/data/library.json to build the level.';
      $('where').textContent = 'catalogue unavailable';
    });
})();
