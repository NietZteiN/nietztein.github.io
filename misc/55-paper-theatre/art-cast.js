/*
 * Paper Theatre - the cast (pure string builders, no DOM).
 *
 * Standing sprites in the manner of a bishoujo-game illustration: thigh-up
 * figures about 6.7 heads tall, turned a little to one side with the weight on
 * one leg; a large head with the eyes set low; eyes built in layers (sclera,
 * iris gradient, pupil, lid shadow, two highlights, a thick upper lash, a lid
 * crease); hair as overlapping tapered locks with a gradient, a broken ring
 * highlight and a few stray strands; thin coloured outlines; two-tone cel
 * shading. The eight faces are eight <g data-face> groups so the stage can
 * crossfade expressions without rebuilding the sprite. Hands are kept out of
 * trouble: in pockets, behind the back, in long sleeves or under a sketchbook.
 *
 * Also the lattice (the model, a figure of light), the player (back of a head,
 * close to the camera) and the page (a floating manuscript sheet).
 *
 * Sprites are 600 x 1000 with the figure cut at the bottom edge. They rely on
 * the shared filters from VNArt.sharedDefs() (vnf-rim for rim light and contact
 * shadow, vnf-b* blurs); without them the figure still draws, just flatter.
 */
(function (root, f) {
  if (typeof module === 'object' && module.exports) module.exports = f;
  else root.VNArtCast = f;
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';

  var R = K.rect, Ci = K.circle, Pa = K.path, G = K.group, num = K.num, mix = K.mix, hsl = K.hslHex;
  function El(cx, cy, rx, ry, a) { return '<ellipse' + K.attrs(K.merge({ cx: num(cx), cy: num(cy), rx: num(rx), ry: num(ry) }, a)) + '/>'; }
  function F(col, op, extra) { var o = { fill: col }; if (op != null && op !== 1) o.opacity = num(op); return extra ? K.merge(o, extra) : o; }
  function S(col, w, op, extra) { var o = { fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }; if (op != null && op !== 1) o.opacity = num(op); return extra ? K.merge(o, extra) : o; }
  function dk(c, t) { return mix(c, '#241a3a', t); }       // shadows lean violet, never black
  function lt(c, t) { return mix(c, '#ffffff', t); }
  function ln(c) { return mix(c, '#2a1c38', 0.62); }       // the coloured outline of a local colour
  // path data from mixed strings and numbers: D('M', 10, 20, 'L', 30, 40, 'Z')
  function D() { var s = ''; for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; s += typeof a === 'number' ? num(a) + ' ' : a; } return s; }
  // a filled shape with a thin coloured outline
  function shape(d, fill, line, w) { return Pa(d, { fill: fill, stroke: line, 'stroke-width': w || 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }); }
  // several overlapping shapes drawn as one silhouette: outline pass, then fill pass
  function merged(ds, fill, line, w) {
    var p = ''; for (var i = 0; i < ds.length; i++) p += Pa(ds[i]);
    return G(p, { fill: line, stroke: line, 'stroke-width': (w || 1.8) * 2, 'stroke-linejoin': 'round' }) + G(p, { fill: fill });
  }
  function circD(x, y, r) { return D('M', x - r, y, 'a', r, r, 0, 1, 0, 2 * r, 0, 'a', r, r, 0, 1, 0, -2 * r, 0, 'Z'); }
  // a tapered lock of hair from a root to a tip; bend > 0 bows it to the viewer's right when it hangs down
  function lockD(x0, y0, x1, y1, w, bend, open) {
    var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy) || 1, nx = dy / l, ny = -dx / l;
    var mx = (x0 + x1) / 2 + nx * bend, my = (y0 + y1) / 2 + ny * bend;
    return D('M', x0 - nx * w / 2, y0 - ny * w / 2, 'Q', mx - nx * w * 0.46, my - ny * w * 0.46, x1, y1, 'Q', mx + nx * w * 0.46, my + ny * w * 0.46, x0 + nx * w / 2, y0 + ny * w / 2) + (open ? '' : 'Z');
  }
  // a tapered, bent tube through three joints (a sleeve, an arm)
  function limbD(p, w, shift) {
    function nrm(u, v) { var dx = v[0] - u[0], dy = v[1] - u[1], l = Math.sqrt(dx * dx + dy * dy) || 1; return [dy / l, -dx / l]; }
    var n0 = nrm(p[0], p[1]), n2 = nrm(p[1], p[2]), n1 = [(n0[0] + n2[0]) / 2, (n0[1] + n2[1]) / 2], n = [n0, n1, n2], L = [], Rr = [], s = typeof shift === 'number' ? shift : 0;
    for (var i = 0; i < 3; i++) {
      L.push([p[i][0] + n[i][0] * (w[i] / 2 + s * w[i]), p[i][1] + n[i][1] * (w[i] / 2 + s * w[i])]);
      Rr.push([p[i][0] - n[i][0] * (w[i] / 2 - s * w[i]), p[i][1] - n[i][1] * (w[i] / 2 - s * w[i])]);
    }
    function ctl(q) { return [2 * q[1][0] - (q[0][0] + q[2][0]) / 2, 2 * q[1][1] - (q[0][1] + q[2][1]) / 2]; }
    var cl = ctl(L), cr = ctl(Rr);
    if (shift === 'edges') return { L: L, R: Rr, cl: cl, cr: cr };
    return D('M', L[0][0], L[0][1], 'Q', cl[0], cl[1], L[2][0], L[2][1], 'L', Rr[2][0], Rr[2][1], 'Q', cr[0], cr[1], Rr[0][0], Rr[0][1], 'Z');
  }

  var FACES = ['neutral', 'smile', 'puzzled', 'worried', 'surprised', 'thinking', 'deadpan', 'laugh'];
  var HAIR = ['short', 'long', 'bob', 'ponytail', 'bun', 'curly', 'none', 'hood'];
  var CLOTHES = ['coat', 'hoodie', 'cardigan', 'shirt', 'uniform'];
  // [base, shadow, blush]
  var SKIN = [['#fdebdf', '#f0c3b4', '#f29a9a'], ['#f4d5bc', '#e0a98f', '#e88f86'], ['#e2b48e', '#c4875f', '#d37c6c'], ['#b07a56', '#8a553c', '#a8554a'], ['#77503a', '#553427', '#7a3a34']];
  // natural dark tones, picked from the name when hairhue is not given
  var HAIRCOL = [[22, 30, 26], [228, 20, 21], [16, 42, 31], [34, 22, 36], [8, 38, 27], [268, 12, 23], [28, 40, 40]];

  // [saturation, lightness] for hairtone=
  var HAIRTONE = { dark: [30, 19], mid: [36, 32], light: [40, 46], fair: [46, 68] };

  function normCast(decl) {
    decl = decl || {};
    if (decl.hairLine && decl.build) return decl;   // already normalised
    if (typeof decl === 'string') decl = { name: decl };
    var name = decl.id || decl.name || 'Someone';
    var traits = decl.traits || decl.flags || [];
    function has(t) { return decl[t] === true || traits.indexOf(t) >= 0; }
    function pick(list, val) { if (val && list.indexOf(val) >= 0) return val; for (var i = 0; i < list.length; i++) if (has(list[i])) return list[i]; return null; }
    var hair = pick(HAIR, decl.hair) || HAIR[K.hash(name + ':hair') % 4];
    var clothes = pick(CLOTHES, decl.clothes) || ['shirt', 'coat', 'cardigan', 'hoodie'][K.hash(name + ':clothes') % 4];
    var lattice = decl.lattice;
    if (lattice === true) lattice = 'sparse';
    if (!lattice && has('lattice')) lattice = 'sparse';
    var hue = typeof decl.hue === 'number' ? ((decl.hue % 360) + 360) % 360 : K.hash(name) % 360;
    var skin = decl.skin >= 1 && decl.skin <= 5 ? Math.round(decl.skin) : 1 + (K.hash(name + ':skin') % 5);
    var hh = decl.hairhue != null ? decl.hairhue : decl.hairHue, hc;
    // hairtone=dark|mid|light|fair sets how deep the colour is; hairhue alone stays the bright "light" tone
    var tone = HAIRTONE[decl.hairtone] || null;
    if (typeof hh === 'number' && isFinite(hh)) { hh = ((hh % 360) + 360) % 360; hc = tone ? [hh, tone[0], tone[1]] : [hh, 40, 46]; }
    else { hc = HAIRCOL[K.hash(name + ':hh') % HAIRCOL.length]; if (tone) hc = [hc[0], tone[0], tone[1]]; }
    var build = decl.build === 'fem' || decl.build === 'masc' ? decl.build : has('fem') ? 'fem' : has('masc') ? 'masc' : 'neutral';
    return {
      name: name, display: decl.display || decl.label || decl.name || name, hue: hue, skin: skin, hair: hair, clothes: clothes,
      glasses: has('glasses'), hat: has('hat'), lattice: lattice === 'sparse' || lattice === 'dense' ? lattice : null,
      player: has('player'), page: has('page'), coauthor: has('coauthor'), build: build,
      hairHue: hc[0], hairCol: hsl(hc[0], hc[1], hc[2]), hairDark: hsl(hc[0] - 8, hc[1] + 6, hc[2] * 0.6), hairLight: hsl(hc[0] + 8, Math.max(20, hc[1] - 4), Math.min(84, hc[2] + 30)),
      hairTip: hsl(hc[0] + 14, hc[1] + 4, Math.min(74, hc[2] + 12)), hairLine: hsl(hc[0] - 10, hc[1] + 8, Math.max(10, hc[2] * 0.36))
    };
  }
  function normFace(face) { face = String(face || 'neutral').toLowerCase(); return FACES.indexOf(face) >= 0 ? face : 'neutral'; }

  function spriteRoot(c, inner, a) {
    return K.svg('0 0 600 1000', inner, K.merge({
      'class': 'vn-sprite', 'data-name': c.name, preserveAspectRatio: 'xMidYMax meet',
      'data-kind': c.lattice ? 'lattice' : c.player ? 'player' : c.page ? 'page' : 'person',
      style: '--vn-h:' + c.hue
    }, a));
  }
  function faceGroups(active, builder) {
    var out = '';
    for (var i = 0; i < FACES.length; i++) {
      var f = FACES[i], on = f === active;
      out += G(builder(f), { 'data-face': f, 'class': 'vn-face vn-face-' + f + (on ? ' is-on' : ''), opacity: on ? null : 0 });
    }
    return out;
  }

  /* ------------------------------------------------------------ the figure */

  // the head is turned a little to the viewer's right: the far cheek is fuller and the features sit right of centre
  var FACE_D = 'M222 150C219 190 227 222 250 246C268 262 290 271 307 271C321 271 339 261 353 246C373 224 385 192 384 150C384 95 347 60 302 60C257 60 222 95 222 150Z';
  var HEAD_ROT = 'rotate(-4.5 305 290)', LEAN = 'translate(0 34) rotate(1.6 300 1000)', NX = 305, SNY = 326, SFY = 336;
  var EYE_N = [268, 199], EYE_F = [345, 199], MOUTH = [310, 247];
  // near / far x of the silhouette at the shoulder, chest, waist and hip; neck half width; upper arm width; eye height
  var BUILD = {
    fem: { nw: 15, sn: 190, sf: 408, cn: 216, cf: 388, wn: 242, wf: 360, hn: 204, hf: 396, aw: 38, eh: 45, ew: 23 },
    neutral: { nw: 17, sn: 180, sf: 417, cn: 208, cf: 395, wn: 230, wf: 372, hn: 208, hf: 392, aw: 43, eh: 39, ew: 22.5 },
    masc: { nw: 21, sn: 162, sf: 433, cn: 196, cf: 409, wn: 216, wf: 388, hn: 206, hf: 394, aw: 50, eh: 31, ew: 21.5 }
  };
  function torsoD(B, e, hem) {
    var nl = NX - B.nw - 9, nr = NX + B.nw + 9, fl = (hem - 730) * 0.03;
    return D('M', nl, 294, 'C', nl - 26, 302, B.sn + 26, 306, B.sn - e * 0.3, SNY,
      'C', B.sn - e - 5, SNY + 34, B.cn - e - 4, 400, B.cn - e, 440,
      'C', B.cn - e + 6, 500, B.wn - e - 2, 540, B.wn - e, 585,
      'C', B.wn - e - 3, 640, B.hn - e, 680, B.hn - e, 730,
      'L', B.hn - e - fl, hem, 'L', B.hf + e + fl, hem, 'L', B.hf + e, 730,
      'C', B.hf + e, 680, B.wf + e + 3, 640, B.wf + e, 585,
      'C', B.wf + e + 2, 540, B.cf + e - 6, 500, B.cf + e, 440,
      'C', B.cf + e + 4, 400, B.sf + e + 5, SFY + 34, B.sf + e * 0.3, SFY,
      'C', B.sf - 26, 314, nr + 22, 304, nr, 296, 'Z');
  }
  function joint(B, far, e) { var r = (B.aw + (e || 0) * 1.3) / 2; return far ? [B.sf + (e || 0) * 0.3 - r + 7, SFY + r - 1] : [B.sn - (e || 0) * 0.3 + r - 7, SNY + r - 1]; }
  // where the elbow and wrist go for each way of keeping the hands out of trouble
  function armPts(B, pose, far, e) {
    var J = joint(B, far, e), s = far ? -1 : 1, x = J[0];
    if (pose === 'pockets') return [J, [x - s * 14, 592], [x + s * 22, 742]];
    if (pose === 'pouch') return [J, [x - s * 14, 590], [far ? 344 : 266, far ? 704 : 700]];
    if (pose === 'clasp') return [J, [x - s * 15, 596], [far ? 336 : 272, far ? 762 : 758]];
    if (pose === 'back') return [J, [x - s * 18, 598], [x + s * 44, 716]];
    if (pose === 'book') return [J, [x - s * 20, 600], [x + s * 46, 676]];
    return [J, [x - s * 14, 604], [x - s * 16, 786]];   // hanging
  }
  function sleeve(B, e, pts, col, far, cuffCol) {
    var w = [B.aw + e * 1.3, B.aw * 0.84 + e, B.aw * 0.66 + e], line = ln(col), sh = dk(col, 0.2);
    // one open outline: over the round of the shoulder, down the outside, across the cuff, up the inside; no seam on the body side
    var ed = limbD(pts, w, 'edges'), out = far ? ed.L : ed.R, inn = far ? ed.R : ed.L, oc = far ? ed.cl : ed.cr, ic = far ? ed.cr : ed.cl, r = w[0] / 2, J = pts[0];
    var sd = D('M', J[0] + (far ? -1 : 1) * r * 0.7, J[1] - r - 6, 'C', J[0], J[1] - r - 5, out[0][0], J[1] - r * 0.8, out[0][0], out[0][1] + r * 0.3, 'Q', oc[0], oc[1], out[2][0], out[2][1], 'L', inn[2][0], inn[2][1], 'Q', ic[0], ic[1], inn[0][0], inn[0][1] + r * 0.9);
    var o = Pa(sd, { fill: col, stroke: line, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    // the under side takes the shadow; a couple of folds at the elbow
    o += Pa(limbD(pts, [w[0] * 0.36, w[1] * 0.4, w[2] * 0.4], far ? 0.78 : -0.78), { fill: sh });
    var E = pts[1];
    o += Pa(D('M', E[0] - w[1] * 0.42, E[1] - 12, 'q', w[1] * 0.4, 12, w[1] * 0.78, 4, 'M', E[0] - w[1] * 0.4, E[1] + 8, 'q', w[1] * 0.3, 9, w[1] * 0.62, 5), S(line, 1.5, 0.55));
    if (cuffCol) {
      var W = pts[2], dx = W[0] - E[0], dy = W[1] - E[1], l = Math.sqrt(dx * dx + dy * dy) || 1, a = [W[0] - dx / l * 16, W[1] - dy / l * 16];
      o += shape(limbD([a, [(a[0] + W[0]) / 2, (a[1] + W[1]) / 2], W], [w[2] + 3, w[2] + 4, w[2] + 3]), cuffCol, ln(cuffCol));
    }
    return o;
  }

  /* ------------------------------------------------------------ faces */

  // eye openness, lower lid, gaze, iris scale, brows [outer, inner] (near / far), mouth, blush
  var EXPR = {
    neutral: { open: 1, brow: [0, 0], mouth: 'M-9 -1Q0 4 9 -1', blush: 0.3 },
    smile: { open: 0.9, lower: 0.72, brow: [-2, -2], mouth: 'M-13 -4Q0 9 13 -4', blush: 0.6 },
    puzzled: { open: 0.98, look: [2, 0], browN: [-7, -6], browF: [1, 5], mouth: 'M-8 2Q-3 -3 1 1T9 -1', blush: 0.25 },
    worried: { open: 0.95, look: [-1, 2], droop: 0.14, brow: [6, -7], mouth: 'M-8 3Q0 -4 8 3', blush: 0.25 },
    surprised: { open: 1.13, iris: 0.8, brow: [-10, -9], mouthO: true, blush: 0.3 },
    thinking: { open: 0.86, look: [4, -4], browN: [0, 0], browF: [-6, -3], mouth: 'M-1 1Q4 -1 9 0', blush: 0.25 },
    deadpan: { open: 0.5, flat: true, brow: [3, 4], mouth: 'M-8 1L8 1', blush: 0.15 },
    laugh: { closed: true, brow: [-5, -4], mouthOpen: true, blush: 0.8 }
  };
  function eye(e, p, o, w, h, cid, col) {
    var cx = p[0], cy = p[1], op = e.open == null ? 1 : e.open, lo = e.lower == null ? 1 : e.lower, out = '';
    function X(t) { return cx + o * t * w; }
    function Y(v) { return cy + v * h; }
    if (e.closed) {
      // a happy arc, thick in the middle
      out += Pa(D('M', X(-0.9), Y(0.14), 'Q', X(0.02), Y(-0.5), X(1), Y(0.2), 'Q', X(0.05), Y(-0.22), X(-0.9), Y(0.14), 'Z'), { fill: col.lash, stroke: col.lash, 'stroke-width': 1.6, 'stroke-linejoin': 'round' });
      return out + Pa(D('M', X(0.96), Y(0.16), 'l', o * 5, 4, 'M', X(0.74), Y(0.02), 'l', o * 4, 6), S(col.lash, 1.5));
    }
    var top = (e.flat ? -0.36 : -0.5) * op, cyc = e.flat ? top * 1.05 : top * 1.3 - 0.06;
    var I = [X(-0.92), Y(e.flat ? 0.02 : 0.12)], O = [X(1), Y((e.flat ? -0.02 : 0.05) + (e.droop || 0))];
    var c1 = [X(-0.62), Y(cyc)], c2 = [X(0.5), Y(cyc - (e.flat ? 0 : 0.05))];
    var upper = D('C', c1[0], c1[1], c2[0], c2[1], O[0], O[1]);
    var open = D('M', I[0], I[1]) + upper + D('C', X(0.9), Y(0.42 * lo), X(0.45), Y(0.52 * lo), X(0.02), Y(0.5 * lo), 'C', X(-0.5), Y(0.48 * lo), X(-0.9), Y(0.34 * lo), I[0], I[1], 'Z');
    var k = e.iris || 1, rx = w * 0.62 * k, ry = h * 0.57 * k, ix = cx + (e.look ? e.look[0] : 0), iy = cy + h * 0.03 + (e.look ? e.look[1] : 0);
    var inner = El(ix, iy, rx, ry, { fill: 'url(#' + col.grad + ')', stroke: col.irisLine, 'stroke-width': 1.4 }) +
      El(ix, iy + ry * 0.5, rx * 0.68, ry * 0.36, F(col.irisLight, 0.8)) +
      El(ix, iy - ry * 0.08, rx * 0.42, ry * 0.46, { fill: col.pupil }) +
      Pa(D('M', ix - rx * 0.7, iy + ry * 0.36, 'Q', ix, iy + ry * 1.02, ix + rx * 0.7, iy + ry * 0.36), S(col.irisLight, 1.2, 0.7)) +
      // the lid throws a soft shadow across the top of the eye
      Pa(D('M', I[0], I[1]) + upper + D('L', O[0], O[1] + h * 0.2, 'C', c2[0], c2[1] + h * 0.27, c1[0], c1[1] + h * 0.27, I[0], I[1] + h * 0.14, 'Z'), F('#3a2d55', 0.36)) +
      El(ix - rx * 0.36, iy - ry * 0.4, rx * 0.4, ry * 0.25, { fill: '#ffffff', transform: 'rotate(-24 ' + num(ix - rx * 0.36) + ' ' + num(iy - ry * 0.4) + ')' }) +
      Ci(ix + rx * 0.42, iy + ry * 0.4, rx * 0.17, F('#ffffff', 0.92)) + Ci(ix + rx * 0.1, iy + ry * 0.62, rx * 0.08, F('#ffffff', 0.7));
    out += '<clipPath id="' + cid + '"><path d="' + open + '"/></clipPath>' + Pa(open, { fill: '#fffdfa' }) + G(inner, { 'clip-path': 'url(#' + cid + ')' });
    // the upper lash: thickest past the middle, a small flick at the outer corner
    out += Pa(D('M', I[0] - o * 1.5, I[1] + 0.5) + upper + D('L', O[0] + o * 6, O[1] - 2.5, 'L', O[0] - o * 2, O[1] + 5, 'C', c2[0], c2[1] + 5.6, c1[0], c1[1] + 3.4, I[0], I[1] + 1.6, 'Z'), { fill: col.lash });
    if (col.fem) out += Pa(D('M', X(0.86), Y(-0.16), 'l', o * 7, -4, 'M', X(0.98), Y(0), 'l', o * 6, 1.5), S(col.lash, 1.4));
    out += Pa(D('M', X(-0.5), Y(top) - 5, 'Q', X(0.15), Y(top) - 10, X(0.86), Y(top + 0.14) - 5), S(col.line, 1.2, 0.65));
    out += Pa(D('M', X(0.92), Y(0.36 * lo), 'Q', X(0.5), Y(0.57 * lo), X(0.02), Y(0.54 * lo)), S(col.lash, 1.3, 0.75));
    return out;
  }
  function brow(p, o, w, h, b, col, thick) {
    var y0 = p[1] - h * 0.5 - 13;
    return Pa(D('M', p[0] - o * w * 0.86, y0 + b[1] + 2, 'Q', p[0] + o * w * 0.1, y0 - 5 + (b[0] + b[1]) / 2, p[0] + o * w * 1.06, y0 + 3 + b[0]), S(col, thick, 0.9));
  }
  function faceFeatures(f, c, B, sk, skl, id) {
    var e = EXPR[f], o = '', mx = MOUTH[0], my = MOUTH[1], h = B.eh;
    var col = { grad: id + 'i', irisLine: hsl(c.hue, 45, 20), irisLight: hsl(c.hue + 24, 85, 80), pupil: hsl(c.hue, 50, 11), lash: mix(c.hair === 'none' ? '#2b1d22' : c.hairLine, '#24161c', 0.6), line: skl, fem: c.build === 'fem' };
    var bl = e.blush || 0;
    o += El(EYE_N[0] - 10, 231, 22, 11, F(sk[2], bl * 0.6, { filter: 'url(#vnf-b4)' })) + El(EYE_F[0] + 8, 231, 19, 11, F(sk[2], bl * 0.6, { filter: 'url(#vnf-b4)' }));
    if (bl > 0.5) o += Pa(D('M', 247, 233, 'l', 5, -8, 'M', 256, 234, 'l', 5, -8, 'M', 265, 233, 'l', 5, -8, 'M', 345, 233, 'l', 5, -8, 'M', 354, 234, 'l', 5, -8, 'M', 363, 233, 'l', 5, -8), S(sk[2], 1.4, 0.8));
    o += eye(e, EYE_N, -1, B.ew, h, id + f + 'n', col) + eye(e, EYE_F, 1, B.ew - 2.5, h, id + f + 'f', col);
    var bc = c.hair === 'none' ? dk(sk[1], 0.45) : c.hairDark, bt = c.build === 'masc' ? 3.2 : 2.3;
    o += brow(EYE_N, -1, B.ew, h, e.browN || e.brow, bc, bt) + brow(EYE_F, 1, B.ew - 2.5, h, e.browF || e.brow, bc, bt);
    var t = 'translate(' + mx + ' ' + my + ')';
    if (e.mouthO) o += El(mx, my + 2, 5.5, 7.5, { fill: '#9c4450', stroke: skl, 'stroke-width': 1.5 }) + El(mx, my + 5, 3, 2.6, F('#e58b8f', 0.9));
    else if (e.mouthOpen) o += G(Pa('M-14 -5Q0 -1 14 -5Q11 13 0 14Q-11 13 -14 -5Z', { fill: '#a8434f', stroke: skl, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }) + Pa('M-7 9Q0 4 7 9Q4 13 0 13Q-4 13 -7 9Z', { fill: '#ee9296' }) + Pa('M-11 -3.6Q0 -0.4 11 -3.6L10 -1Q0 2 -10 -1Z', { fill: '#fffaf6' }), { transform: t });
    else o += G(Pa(e.mouth, S(mix(skl, '#8a2f3a', 0.35), 2)) + Pa('M-4 8Q0 9.5 4 8', S(sk[1], 1.4, 0.7)), { transform: t });
    return o;
  }

  /* ------------------------------------------------------------ hair */

  var CAP_TOP = 'M203 170C193 80 248 37 302 37C358 37 411 80 401 170';
  function hairParts(c, id) {
    var h = c.hair, fill = 'url(#' + id + 'h)', line = c.hairLine, back = '', front = '', i;
    if (h === 'none') return { back: '', front: Pa('M262 86Q300 66 340 84', S('#ffffff', 5, 0.22)) + Pa('M250 104Q262 88 280 80', S('#ffffff', 3, 0.16)), top: '' };
    function locks(list, colour) { var s = ''; for (var j = 0; j < list.length; j++) s += Pa(lockD.apply(null, list[j].concat([true])), { fill: colour || fill, stroke: line, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }); return s; }
    function strands(list, col, w, op) { var d = ''; for (var j = 0; j < list.length; j++) d += lockD.apply(null, list[j].concat([true])).split('Q').slice(0, 2).join('Q'); return Pa(d, S(col, w, op)); }
    // the fringe: a cap over the crown and locks falling from it to the brows
    // tips (right to left) and the notches between them; one solid mass with a jagged lower edge
    var T = h === 'short' || h === 'hood' ? [[385, 198], [364, 176], [320, 184], [288, 172], [243, 184], [222, 200]] : h === 'bob' ? [[384, 206], [368, 184], [324, 180], [290, 182], [242, 184], [221, 208]] : [[386, 208], [370, 186], [320, 180], [295, 188], [240, 186], [220, 210]];
    var N = h === 'short' || h === 'hood' ? [[376, 160], [343, 142], [303, 152], [266, 142], [233, 160]] : h === 'bob' ? [[378, 170], [346, 152], [307, 162], [267, 152], [231, 170]] : [[380, 170], [346, 144], [307, 158], [268, 144], [230, 168]];
    var fd = CAP_TOP + D('Q', 400, 188, T[0][0], T[0][1]), sliv = '', part = '';
    for (i = 0; i < N.length; i++) {
      var t0 = T[i], t1 = T[i + 1], nn = N[i];
      fd += D('Q', nn[0] + 8, (t0[1] + nn[1]) / 2 + 6, nn[0], nn[1], 'Q', nn[0] - 10, (t1[1] + nn[1]) / 2 + 4, t1[0], t1[1]);
      // the shadow each lock throws on the next, and the line that parts them, fading toward the crown
      sliv += D('M', nn[0], nn[1], 'Q', nn[0] - 10, (t1[1] + nn[1]) / 2 + 4, t1[0], t1[1], 'Q', nn[0] - 1, (t1[1] + nn[1]) / 2 - 6, nn[0] - 4, nn[1] - 34, 'Z');
      part += D('M', nn[0], nn[1], 'Q', nn[0] - 3 + (303 - nn[0]) * 0.1, nn[1] - 30, nn[0] + (303 - nn[0]) * 0.34, nn[1] - 58);
    }
    fd += D('Q', 204, 192, 203, 170, 'Z');
    var fringe = shape(fd, fill, line, 1.5) + Pa(sliv, F(c.hairDark, 0.5)) + Pa(part, S(line, 1.2, 0.6));
    var shade = '';
    // a broken ring of light across the crown, and a few streaks down the locks
    var ring = '', rr = K.rngFor(c.name + ':ring');
    for (i = 0; i < 9; i++) {
      var x = 236 + i * 16.5 + rr() * 5, a = (x - 303) / 80, y = 92 + a * a * 15, wv = 3 + rr() * 5, hv = 12 + rr() * 12;
      if (i === 3 || rr() < 0.12) continue;
      ring += D('M', x, y, 'Q', x + wv * 0.9 - a * 3, y + hv * 0.45, x + wv * 0.5 + a * 5, y + hv, 'Q', x - wv * 0.5 - a * 3, y + hv * 0.5, x, y, 'Z');
    }
    var shine = Pa(ring, F(c.hairLight, 0.55)) + Pa('M252 66Q300 46 350 62', S(c.hairLight, 2, 0.3)) +
      strands([[262, 124, 256, 166, 0, -5], [344, 122, 350, 164, 0, 5], [304, 124, 308, 180, 0, 2]], c.hairLight, 1.5, 0.4);
    var ahoge = Pa(D('M', 296, 42, 'C', 300, 20, 322, 6, 338, 16, 'C', 324, 14, 312, 26, 310, 42, 'Z'), { fill: c.hairCol, stroke: line, 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
    var stray = Pa('M214 120C198 150 196 180 204 206M398 126C410 156 410 180 402 204', S(line, 1.2, 0.6));
    var side;
    if (h === 'short') {
      back = shape(CAP_TOP + 'C405 208 398 238 388 254L376 270L368 250L352 262L252 262L238 250L230 272L218 254C206 238 199 208 203 170Z', fill, line);
      side = locks([[395, 150, 386, 238, 30, 7], [212, 148, 226, 244, 36, -8]]);
    } else if (h === 'bob') {
      back = shape(D('M', 199, 170, 'C', 189, 78, 246, 35, 302, 35, 'C', 360, 35, 415, 78, 405, 170, 'C', 414, 222, 410, 266, 394, 296, 'C', 372, 306, 344, 300, 332, 292, 'L', 276, 292, 'C', 262, 302, 232, 306, 210, 296, 'C', 194, 266, 190, 222, 199, 170, 'Z'), fill, line) +
        Pa('M214 250Q220 280 232 296M392 250Q386 280 374 296', S(c.hairDark, 2, 0.5));
      side = locks([[397, 148, 380, 290, 36, 12], [210, 146, 232, 296, 42, -13]]);
    } else if (h === 'long') {
      back = shape(D('M', 199, 170, 'C', 189, 78, 246, 35, 302, 35, 'C', 360, 35, 415, 78, 405, 170, 'C', 420, 300, 446, 440, 436, 610, 'L', 424, 668, 'L', 408, 628, 'L', 392, 676, 'L', 372, 632, 'L', 232, 632, 'L', 214, 676, 'L', 196, 628, 'L', 180, 668, 'L', 168, 610, 'C', 158, 440, 184, 300, 199, 170, 'Z'), fill, line) +
        Pa('M190 420C184 500 186 560 192 620M414 420C422 500 420 560 414 620M206 330C198 420 200 520 206 600M400 330C408 420 406 520 400 600', S(c.hairDark, 2, 0.45));
      side = locks([[396, 148, 392, 470, 36, 10], [211, 146, 220, 486, 42, -12]]) + strands([[398, 200, 394, 440, 0, 8], [214, 200, 220, 450, 0, -9]], c.hairLight, 1.6, 0.4);
    } else if (h === 'ponytail') {
      var tie = hsl(c.hue, 55, 58);
      back = shape(D('M', 368, 86, 'C', 426, 62, 470, 112, 470, 204, 'C', 472, 304, 450, 390, 464, 486, 'L', 444, 456, 'L', 438, 500, 'C', 414, 440, 408, 380, 412, 316, 'C', 416, 240, 402, 172, 364, 132, 'Z'), fill, line) +
        Pa('M438 150C452 230 438 320 440 400M420 180C432 260 424 330 428 420', S(c.hairLight, 1.8, 0.4)) +
        shape(CAP_TOP + 'C404 204 398 232 388 246L222 248C208 232 200 204 203 170Z', fill, line) +
        shape('M362 84C374 76 388 82 388 98C386 112 372 116 362 108Z', tie, ln(tie)) + shape('M384 86L404 70L402 92L412 106L388 102Z', tie, ln(tie));
      side = locks([[394, 150, 390, 252, 20, 6], [212, 148, 224, 262, 24, -7]]);
    } else if (h === 'bun') {
      var tb = hsl(c.hue, 55, 58);
      back = shape(circD(368, 58, 37), fill, line) + Pa('M346 44C360 30 388 36 392 58C394 74 378 84 364 78C354 72 356 58 368 56', S(c.hairDark, 2, 0.6)) + Pa('M344 50Q356 30 380 34', S(c.hairLight, 2.4, 0.5)) +
        shape(CAP_TOP + 'C404 204 398 232 388 246L222 248C208 232 200 204 203 170Z', fill, line) +
        shape('M338 84Q356 100 384 92L386 100Q356 110 334 92Z', tb, ln(tb));
      side = locks([[394, 150, 392, 262, 18, 7], [212, 148, 222, 272, 22, -8]]);
    } else if (h === 'curly') {
      var r = K.rngFor(c.name + ':curl'), cb = '', cf = '', marks = '', cx0, cy0, cr;
      for (i = 0; i < 28; i++) { var an = Math.PI * (0.8 + i / 27 * 1.4), rad = 100 + r() * 14; cb += circD(302 + Math.cos(an) * rad, 172 + Math.sin(an) * rad * 1.1, 21 + r() * 8); }
      back = merged([cb, circD(302, 150, 102)], fill, line) + Pa('M206 250q12 18 0 34M398 250q-12 18 0 34M190 190q10 16 0 32M414 190q-10 16 0 32', S(c.hairDark, 2, 0.5));
      for (i = 0; i < 11; i++) {
        cx0 = 226 + i * 15.4; cy0 = 124 + Math.abs(i - 5) * 6 + r() * 12; cr = 15 + r() * 6; cf += circD(cx0, cy0, cr);
        marks += D('M', cx0 - cr * 0.5, cy0 + cr * 0.2, 'a', cr * 0.5, cr * 0.5, 0, 1, 1, cr * 0.7, cr * 0.3);
      }
      fringe = merged([CAP_TOP + 'C393 128 372 112 350 108L252 108C231 112 211 128 203 170Z', cf], fill, line, 1.5) + Pa(marks, S(line, 1.2, 0.5));
      shine = Pa('M246 92q14 -16 34 -14M306 80q18 -6 34 6M262 66Q300 48 344 62', S(c.hairLight, 3, 0.45));
      side = merged([circD(212, 190, 20) + circD(216, 224, 18) + circD(224, 254, 15) + circD(394, 190, 19) + circD(391, 222, 17) + circD(384, 250, 14)], fill, line, 1.5);
    } else side = locks([[395, 150, 388, 232, 26, 6], [212, 148, 224, 238, 30, -7]]);
    front = side + fringe + shade + shine;
    return { back: back, front: front, top: h === 'hood' ? '' : ahoge + stray };
  }
  function hoodBack(main) {
    return shape('M196 330C170 190 214 26 304 22C394 26 438 190 412 330Z', dk(main, 0.3), ln(main));
  }
  function hoodFront(main) {
    var line = ln(main);
    return shape('M196 330C170 190 214 26 304 22C394 26 438 190 412 330L376 306C398 196 366 70 304 62C242 70 210 196 234 306Z', main, line) +
      Pa('M214 300C196 196 226 64 304 40C262 70 226 190 240 296Z', F(lt(main, 0.3), 0.5)) + Pa('M394 300C412 196 384 64 304 40C348 70 384 190 370 296Z', F(dk(main, 0.3), 0.6)) +
      Pa('M234 306C210 196 242 70 304 62C366 70 398 196 376 306', S(line, 1.5, 0.7));
  }
  function glasses(B) {
    var fr = '#3a2f3e', y = EYE_N[1] + 1, h = Math.max(38, B.eh + 10), a = [EYE_N[0] - 31, y - h / 2, 61, h], b = [EYE_F[0] - 28, y - h / 2, 56, h];
    return G(R(a[0], a[1], a[2], a[3], F('#eaf4ff', 0.14, { rx: 13 })) + R(b[0], b[1], b[2], b[3], F('#eaf4ff', 0.14, { rx: 13 })) +
      R(a[0], a[1], a[2], a[3], S(fr, 2.2, 1, { rx: 13 })) + R(b[0], b[1], b[2], b[3], S(fr, 2.2, 1, { rx: 13 })) +
      Pa(D('M', a[0] + a[2], y - 4, 'Q', (a[0] + a[2] + b[0]) / 2, y - 9, b[0], y - 4, 'M', a[0], y - 5, 'L', 222, y - 9, 'M', b[0] + b[2], y - 5, 'L', 384, y - 8), S(fr, 2.2)) +
      Pa(D('M', a[0] + 9, a[1] + 12, 'l', 12, -7, 'M', b[0] + 9, b[1] + 12, 'l', 11, -7), S('#ffffff', 2.2, 0.6)), { 'class': 'vn-glasses' });
  }
  function hat(c) {
    var col = hsl(c.hue, 34, 34), line = ln(col);
    return G(shape('M190 112C176 40 262 2 340 14C420 26 442 86 410 116C356 88 250 84 190 112Z', col, line) +
      Pa('M300 20C380 22 430 70 410 116C392 100 372 92 350 88C384 70 360 30 300 20Z', F(dk(col, 0.3), 0.6)) +
      shape('M190 112C250 84 356 88 410 116C412 124 408 130 402 130C350 104 254 100 198 126C190 124 188 118 190 112Z', dk(col, 0.25), line) +
      Pa('M222 60Q270 26 330 30', S(lt(col, 0.5), 3, 0.5)) + shape('M322 16Q326 2 336 4Q334 12 332 18Z', col, line), { 'class': 'vn-hat' });
  }

  /* ------------------------------------------------------------ clothes */

  function skirtD(B) {
    var d = D('M', B.wn - 5, 598, 'C', B.hn - 26, 680, B.hn - 46, 800, B.hn - 60, 930), x0 = B.hn - 60, x1 = B.hf + 60, n = 9;
    for (var i = 1; i <= n; i++) { var x = x0 + (x1 - x0) * i / n; d += D('L', x - 5, 938 + (i % 2 ? 0 : -5), 'L', x, 928 + (i % 2 ? 4 : 0)); }
    return d + D('C', B.hf + 46, 800, B.hf + 26, 680, B.wf + 5, 598, 'Z');
  }
  function lower(c, B, skirt, col) {
    var o = '', line = ln(col), sh = dk(col, 0.26);
    if (skirt) {
      var sk = SKIN[c.skin - 1], skl = mix(sk[1], '#5a2b2e', 0.6);
      // thighs under the hem, the weight on the near leg
      o += shape(D('M', 214, 900, 'L', 210, 1000, 'L', 296, 1000, 'L', 300, 900, 'Z'), sk[0], skl) + shape(D('M', 306, 900, 'L', 310, 1000, 'L', 384, 1000, 'L', 388, 900, 'Z'), sk[0], skl) +
        Pa('M210 900H392V962Q300 944 210 966Z', F(sk[1], 0.9)) + Pa('M372 960L378 1000H384L388 950Z', F(sk[1], 0.7));
      o += shape(skirtD(B), col, line);
      var pl = '', shd = '', x0 = B.hn - 60, x1 = B.hf + 60;
      for (var i = 1; i < 9; i++) {
        var x = x0 + (x1 - x0) * i / 9, xt = B.wn + (B.wf - B.wn) * i / 9;
        pl += D('M', xt, 606, 'Q', (x + xt) / 2 + (i - 4.5) * 2, 780, x, 932);
        if (i % 2) shd += D('M', xt, 606, 'Q', (x + xt) / 2 + (i - 4.5) * 2, 780, x, 932, 'L', x + (x1 - x0) / 18, 936, 'Q', (x + xt) / 2 + 12, 790, xt + 5, 606, 'Z');
      }
      o += Pa(shd, F(sh, 0.75)) + Pa(pl, S(line, 1.4, 0.7)) + Pa(D('M', B.wf - 20, 606, 'C', B.hf + 6, 690, B.hf + 26, 800, B.hf + 34, 934, 'L', B.hf + 60, 928, 'C', B.hf + 46, 800, B.hf + 26, 680, B.wf + 5, 598, 'Z'), F(sh, 0.6));
    } else {
      o += shape(D('M', B.wn - 3, 600, 'C', B.wn - 5, 650, B.hn - 5, 690, B.hn - 5, 740, 'L', B.hn - 10, 1000, 'L', 290, 1000, 'L', 301, 826, 'L', 312, 1000, 'L', B.hf + 9, 1000, 'L', B.hf + 5, 740, 'C', B.hf + 5, 690, B.wf + 5, 650, B.wf + 3, 600, 'Z'), col, line);
      o += Pa(D('M', 301, 826, 'L', 312, 1000, 'L', B.hf + 9, 1000, 'L', B.hf + 5, 740, 'C', B.hf - 20, 790, 330, 800, 301, 826, 'Z'), F(sh, 0.8)) +
        Pa(D('M', B.hn - 9, 940, 'L', B.hn - 10, 1000, 'L', 240, 1000, 'Q', 222, 960, B.hn - 9, 940, 'Z'), F(lt(col, 0.2), 0.4)) +
        Pa(D('M', 301, 700, 'L', 301, 826, 'M', 301, 790, 'Q', 270, 800, 250, 824, 'M', 303, 790, 'Q', 334, 800, 350, 820, 'M', B.hn + 16, 680, 'Q', B.hn + 30, 700, B.hn + 26, 760), S(line, 1.5, 0.7));
    }
    return o;
  }
  function hand(x, y, rot, sk, skl, flip) {
    // a relaxed hanging hand: palm, thumb, a hint of fingers
    return G(shape('M-12 -4C-15 16 -14 34 -8 46C-4 55 6 57 10 48C14 38 15 18 12 -4Z', sk[0], skl) + Pa('M4 30L4 50M-3 32L-4 51', S(skl, 1.2, 0.7)) + shape('M-12 4C-19 12 -20 26 -15 34C-11 30 -11 18 -10 10Z', sk[0], skl) + Pa('M6 -2C10 14 10 34 8 48L11 46C15 34 14 16 12 -4Z', F(sk[1], 0.9)),
      { transform: 'translate(' + num(x) + ' ' + num(y) + ') rotate(' + rot + ')' + (flip ? ' scale(-1 1)' : '') });
  }
  function collar(x, col, line, w, drop) {
    // two collar points around the neck
    return shape(D('M', x - 22, 286, 'L', x - 2, 312 + drop * 0.4, 'L', x - 16 - w, 318 + drop, 'L', x - 30 - w * 0.4, 296, 'Z'), col, line) + shape(D('M', x + 24, 288, 'L', x + 3, 312 + drop * 0.4, 'L', x + 19 + w, 320 + drop, 'L', x + 31 + w * 0.4, 298, 'Z'), col, line);
  }
  function tie(x, col, len) {
    var line = ln(col);
    return shape(D('M', x - 7, 316, 'L', x + 8, 316, 'L', x + 12, 316 + len, 'L', x + 1, 334 + len, 'L', x - 10, 316 + len, 'Z'), col, line) + Pa(D('M', x + 2, 330, 'L', x + 12, 316 + len, 'L', x + 1, 334 + len, 'Z'), F(dk(col, 0.3), 0.7)) + shape(D('M', x - 8, 308, 'L', x + 9, 308, 'L', x + 7, 324, 'L', x - 6, 324, 'Z'), dk(col, 0.12), line);
  }
  function ribbon(x, col) {
    var line = ln(col);
    return shape(D('M', x, 318, 'C', x - 22, 304, x - 34, 310, x - 34, 324, 'C', x - 32, 336, x - 16, 334, x, 322, 'Z'), col, line) + shape(D('M', x, 318, 'C', x + 22, 304, x + 34, 310, x + 34, 324, 'C', x + 32, 336, x + 16, 334, x, 322, 'Z'), col, line) +
      shape(D('M', x - 4, 324, 'L', x - 12, 362, 'L', x - 2, 354, 'L', x, 326, 'Z'), dk(col, 0.1), line) + shape(D('M', x + 4, 324, 'L', x + 13, 358, 'L', x + 3, 352, 'L', x, 326, 'Z'), dk(col, 0.1), line) +
      shape(D('M', x - 6, 314, 'L', x + 6, 314, 'L', x + 5, 328, 'L', x - 5, 328, 'Z'), dk(col, 0.18), line);
  }
  // returns { behind, body, clip } : arms that go behind the figure, everything else, the torso clip path
  function outfit(c, B, sk, skl, id) {
    var k = c.clothes, hue = c.hue, fem = c.build === 'fem', white = '#fbf8f4', main = hsl(hue, 36, 48), cx = NX + 3;
    var skirt = fem || (c.build !== 'masc' && (k === 'cardigan' || k === 'uniform') && /^(long|bob|ponytail|bun)$/.test(c.hair));
    var lowCol = skirt ? hsl(hue, 22, 32) : hsl((hue + 200) % 360, 14, 26), behind = '', o = '', clip = id + 't';
    function shade(inner) { return G(inner, { 'clip-path': 'url(#' + clip + ')' }); }
    // the far side of the torso is in shadow; folds gather at the waist; fem figures get a soft shadow under the bust
    function torsoShade(col, e, amount) {
      var sh = dk(col, amount || 0.2), s = Pa(D('M', cx + 46, 296, 'C', cx + 60, 420, B.wf - 26 + e, 520, B.wf - 34 + e, 600, 'C', B.hf - 44 + e, 690, B.hf - 36 + e, 800, B.hf - 30 + e, 1000, 'L', 600, 1000, 'L', 600, 296, 'Z'), { fill: sh });
      s += Pa(D('M', B.wn - e - 4, 570, 'Q', B.wn + 44, 578, B.wn + 78, 562, 'Q', B.wn + 40, 594, B.wn - e - 4, 598, 'Z', 'M', B.wf + e + 4, 560, 'Q', B.wf - 40, 572, B.wf - 70, 600, 'Q', B.wf - 30, 590, B.wf + e + 4, 590, 'Z'), F(sh, 0.9));
      if (fem) s += Pa(D('M', B.cn + 8, 452, 'Q', B.cn + 40, 492, cx - 6, 470, 'Q', B.cn + 44, 480, B.cn + 8, 452, 'Z', 'M', cx + 8, 470, 'Q', B.cf - 40, 494, B.cf - 6, 452, 'Q', B.cf - 34, 482, cx + 8, 470, 'Z'), F(sh, 0.85));
      s += Pa(D('M', B.sn + 6, SNY + 6, 'Q', B.sn + 60, 322, NX - 40, 306, 'Q', B.sn + 50, 340, B.sn + 6, SNY + 24, 'Z'), F(lt(col, 0.5), 0.5));
      return s;
    }
    var neck = shape(D('M', NX - B.nw, 236, 'L', NX - B.nw - 3, 300, 'Q', NX, 320, NX + B.nw + 3, 300, 'L', NX + B.nw, 236, 'Z'), sk[0], skl) +
      Pa(D('M', NX - B.nw, 240, 'L', NX + B.nw, 240, 'L', NX + B.nw + 2, 290, 'Q', NX + 2, 268, NX - B.nw - 1, 266, 'Z'), { fill: sk[1] });
    var e, tD, col, line, pose, pn, pf;
    if (k === 'coat') {
      e = 10; col = white; line = ln(dk(col, 0.25)); tD = torsoD(B, e, 1000); pose = 'pockets';
      var shirt = hsl(hue, 38, 86), tieC = hsl((hue + 180) % 360, 34, 36);
      o += lower(c, B, skirt, lowCol) + neck;
      // shirt and tie in the open front
      o += shape(D('M', cx - 44, 292, 'L', cx + 46, 294, 'L', cx + 56, 640, 'L', cx - 56, 640, 'Z'), shirt, ln(shirt)) + Pa(D('M', cx + 14, 300, 'L', cx + 46, 294, 'L', cx + 56, 640, 'L', cx + 22, 640, 'Z'), F(dk(shirt, 0.16), 0.9)) + Pa(D('M', cx, 330, 'L', cx - 2, 640), S(ln(shirt), 1.3, 0.6));
      if (!skirt) o += R(cx - 60, 628, 120, 16, { fill: dk(lowCol, 0.3) }) + R(cx - 12, 626, 22, 20, { fill: '#c8ab72', rx: 3, stroke: '#7a6238', 'stroke-width': 1.4 });
      o += tie(cx, tieC, 96) + collar(cx, lt(shirt, 0.5), ln(shirt), 0, 0);
      // the coat: two fronts with lapels, open over the shirt
      var lf = D('M', NX - B.nw - 9, 294, 'C', NX - B.nw - 35, 302, B.sn + 26, 306, B.sn - e * 0.3, SNY, 'C', B.sn - e - 5, SNY + 34, B.cn - e - 4, 400, B.cn - e, 440, 'C', B.cn - e + 6, 500, B.wn - e - 2, 540, B.wn - e, 585, 'C', B.wn - e - 3, 640, B.hn - e, 680, B.hn - e, 730, 'L', B.hn - e - 8, 1000, 'L', cx - 34, 1000, 'L', cx - 26, 560, 'L', cx - 52, 440, 'L', cx - 30, 300, 'Z');
      var rf = D('M', NX + B.nw + 9, 296, 'C', NX + B.nw + 31, 304, B.sf - 26, 314, B.sf + e * 0.3, SFY, 'C', B.sf + e + 5, SFY + 34, B.cf + e + 4, 400, B.cf + e, 440, 'C', B.cf + e - 6, 500, B.wf + e + 2, 540, B.wf + e, 585, 'C', B.wf + e + 3, 640, B.hf + e, 680, B.hf + e, 730, 'L', B.hf + e + 8, 1000, 'L', cx + 40, 1000, 'L', cx + 30, 560, 'L', cx + 54, 440, 'L', cx + 32, 302, 'Z');
      o += shape(lf, col, line) + shape(rf, col, line) + shade(torsoShade(col, e, 0.16) + Pa(D('M', cx - 26, 560, 'L', cx - 34, 1000, 'L', cx - 60, 1000, 'L', cx - 44, 600, 'Z'), F(dk(col, 0.16), 0.8)));
      // lapels
      o += shape(D('M', cx - 30, 300, 'L', cx - 60, 372, 'L', cx - 46, 382, 'L', cx - 52, 440, 'L', cx - 26, 560, 'L', cx - 20, 420, 'Z'), lt(col, 0.4), line) + shape(D('M', cx + 32, 302, 'L', cx + 64, 374, 'L', cx + 50, 386, 'L', cx + 54, 440, 'L', cx + 30, 560, 'L', cx + 24, 420, 'Z'), dk(col, 0.1), line);
      o += Pa(D('M', cx + 60, 470, 'h', 44, 'M', cx + 62, 470, 'v', 6), S(line, 1.6, 0.8)) + R(cx + 70, 448, 5, 30, { fill: '#4a6fc0', rx: 2.5 }) + R(cx + 80, 452, 5, 26, { fill: '#c05a5a', rx: 2.5 });
      pn = armPts(B, pose, false, e); pf = armPts(B, pose, true, e);
      o += sleeve(B, e, pf, col, true) + sleeve(B, e, pn, col, false);
      // pocket welts swallow the hands
      o += Pa(D('M', pn[2][0] - 30, pn[2][1] - 22, 'L', pn[2][0] + 30, pn[2][1] - 4, 'L', pn[2][0] + 30, pn[2][1] + 44, 'L', pn[2][0] - 36, pn[2][1] + 44, 'Z'), { fill: col }) + Pa(D('M', pn[2][0] - 30, pn[2][1] - 22, 'L', pn[2][0] + 30, pn[2][1] - 4), S(line, 2.4, 0.9)) + Pa(D('M', pn[2][0] - 26, pn[2][1] - 15, 'L', pn[2][0] + 28, pn[2][1] + 2), S(line, 1.1, 0.45)) +
        Pa(D('M', pf[2][0] + 30, pf[2][1] - 22, 'L', pf[2][0] - 28, pf[2][1] - 4, 'L', pf[2][0] - 28, pf[2][1] + 44, 'L', pf[2][0] + 36, pf[2][1] + 44, 'Z'), { fill: dk(col, 0.16) }) + Pa(D('M', pf[2][0] + 30, pf[2][1] - 22, 'L', pf[2][0] - 28, pf[2][1] - 4), S(line, 2.4, 0.9));
    } else if (k === 'hoodie') {
      e = 12; col = main; line = ln(col); tD = torsoD(B, e, 752); pose = 'pouch';
      o += lower(c, B, skirt, lowCol) + neck;
      o += shape(D('M', NX - 30, 286, 'L', NX + 30, 288, 'L', NX + 24, 330, 'L', NX - 22, 330, 'Z'), white, ln(white));
      o += shape(tD, col, line) + shade(torsoShade(col, e, 0.22));
      // ribbed hem, the hood lying on the shoulders, drawstrings
      o += shape(D('M', B.hn - e - 1, 716, 'L', B.hf + e + 1, 716, 'L', B.hf + e - 3, 752, 'L', B.hn - e + 3, 752, 'Z'), dk(col, 0.14), line);
      o += shape(D('M', NX - B.nw - 12, 290, 'C', NX - 70, 296, NX - 96, 320, NX - 84, 350, 'C', NX - 50, 376, NX - 10, 372, cx, 350, 'C', NX + 14, 372, NX + 56, 376, NX + 90, 350, 'C', NX + 100, 322, NX + 72, 298, NX + B.nw + 12, 292, 'C', NX + 30, 326, cx + 8, 340, cx, 342, 'C', cx - 10, 340, NX - 28, 326, NX - B.nw - 12, 290, 'Z'), dk(col, 0.08), line) +
        Pa(D('M', cx, 350, 'C', NX + 14, 372, NX + 56, 376, NX + 90, 350, 'C', NX + 60, 356, NX + 30, 352, cx + 6, 344, 'Z'), F(dk(col, 0.3), 0.7));
      o += Pa(D('M', cx - 14, 350, 'Q', cx - 20, 400, cx - 16, 446, 'M', cx + 14, 350, 'Q', cx + 22, 396, cx + 18, 436), S('#f3eee6', 3.2)) + Ci(cx - 16, 450, 4.5, { fill: '#f3eee6' }) + Ci(cx + 18, 440, 4.5, { fill: '#f3eee6' });
      pn = armPts(B, pose, false, e); pf = armPts(B, pose, true, e);
      o += sleeve(B, e, pf, col, true) + sleeve(B, e, pn, col, false);
      // the pouch pocket swallows both hands
      o += shape(D('M', 236, 640, 'L', 372, 644, 'L', 392, 722, 'L', 214, 720, 'Z'), col, line) + Pa(D('M', 236, 640, 'L', 372, 644, 'L', 376, 660, 'L', 232, 656, 'Z'), F(lt(col, 0.3), 0.35)) +
        Pa(D('M', 236, 640, 'L', 214, 720, 'M', 372, 644, 'L', 392, 722), S(line, 2.6, 0.85)) + Pa(D('M', 330, 646, 'L', 392, 722, 'L', 300, 721, 'Z'), F(dk(col, 0.24), 0.7));
    } else if (k === 'cardigan') {
      e = 8; col = hsl(hue, 34, 70); line = ln(col); tD = torsoD(B, e, 748); pose = 'clasp';
      var rib = hsl((hue + 150) % 360, 48, 52);
      o += lower(c, B, skirt, lowCol) + neck;
      o += shape(D('M', cx - 50, 290, 'L', cx + 52, 292, 'L', cx + 30, 540, 'L', cx - 30, 540, 'Z'), white, ln(white)) + Pa(D('M', cx + 14, 300, 'L', cx + 52, 292, 'L', cx + 30, 540, 'L', cx + 4, 540, 'Z'), F('#d9d6ea', 0.8));
      o += collar(cx, '#ffffff', ln(white), 2, 2);
      // two fronts closing in a deep V, buttons below
      var cl = D('M', NX - B.nw - 9, 294, 'C', NX - B.nw - 35, 302, B.sn + 26, 306, B.sn - e * 0.3, SNY, 'C', B.sn - e - 5, SNY + 34, B.cn - e - 4, 400, B.cn - e, 440, 'C', B.cn - e + 6, 500, B.wn - e - 2, 540, B.wn - e, 585, 'C', B.wn - e - 3, 640, B.hn - e, 680, B.hn - e, 730, 'L', B.hn - e, 748, 'L', cx + 6, 748, 'L', cx + 4, 530, 'L', cx - 38, 300, 'Z');
      var cr = D('M', NX + B.nw + 9, 296, 'C', NX + B.nw + 31, 304, B.sf - 26, 314, B.sf + e * 0.3, SFY, 'C', B.sf + e + 5, SFY + 34, B.cf + e + 4, 400, B.cf + e, 440, 'C', B.cf + e - 6, 500, B.wf + e + 2, 540, B.wf + e, 585, 'C', B.wf + e + 3, 640, B.hf + e, 680, B.hf + e, 730, 'L', B.hf + e, 748, 'L', cx + 6, 748, 'L', cx + 4, 530, 'L', cx + 40, 302, 'Z');
      o += shape(cr, col, line) + shape(cl, col, line) + shade(torsoShade(col, e, 0.2));
      o += Pa(D('M', cx - 38, 300, 'L', cx + 4, 530, 'L', cx + 40, 302), S(lt(col, 0.45), 5, 0.9)) + Pa(D('M', cx - 38, 300, 'L', cx + 4, 530, 'L', cx + 40, 302, 'M', cx + 4, 530, 'L', cx + 6, 748), S(line, 1.6));
      [566, 620, 674].forEach(function (y) { o += Ci(cx - 5, y, 5.5, { fill: lt(col, 0.6), stroke: line, 'stroke-width': 1.4 }); });
      o += shape(D('M', B.hn - e, 718, 'L', B.hf + e, 718, 'L', B.hf + e - 2, 748, 'L', B.hn - e + 2, 748, 'Z'), dk(col, 0.12), line) + Pa(D('M', B.wn + 6, 640, 'h', 44, 'M', B.wf - 50, 640, 'h', 44), S(line, 1.6, 0.6));
      o += ribbon(cx, rib);
      pn = armPts(B, pose, false, e); pf = armPts(B, pose, true, e);
      o += sleeve(B, e + 2, pf, col, true, dk(col, 0.12));
      // the far hand lies under the near one; long sleeves leave only the fingers
      o += shape(D('M', 300, 768, 'C', 312, 762, 334, 766, 340, 778, 'C', 340, 792, 322, 800, 306, 796, 'Z'), sk[0], skl);
      o += sleeve(B, e + 2, pn, col, false, dk(col, 0.12));
      o += shape(D('M', 280, 770, 'C', 296, 764, 318, 770, 326, 782, 'C', 330, 794, 318, 804, 302, 804, 'C', 288, 804, 276, 794, 276, 782, 'Z'), sk[0], skl) + Pa(D('M', 300, 776, 'Q', 314, 780, 322, 790, 'M', 294, 784, 'Q', 308, 788, 316, 798, 'M', 288, 792, 'Q', 298, 796, 306, 803), S(skl, 1.2, 0.7));
    } else if (k === 'uniform') {
      e = 7; col = hsl(hue, 26, 24); line = ln(col); tD = torsoD(B, e, 752); pose = 'book';
      var tc = hsl(hue, 58, 50), gold = '#d2b06a', sb = hsl((hue + 40) % 360, 30, 58);
      pf = armPts(B, 'back', true, e);
      behind += sleeve(B, e, pf, col, true);
      o += lower(c, B, skirt, lowCol) + neck;
      o += shape(D('M', cx - 46, 290, 'L', cx + 48, 292, 'L', cx + 26, 520, 'L', cx - 24, 520, 'Z'), white, ln(white)) + Pa(D('M', cx + 16, 300, 'L', cx + 48, 292, 'L', cx + 26, 520, 'L', cx + 8, 520, 'Z'), F('#d9d6ea', 0.8));
      o += (fem ? '' : tie(cx, tc, 110)) + collar(cx, '#ffffff', ln(white), 0, 0);
      var bl = D('M', NX - B.nw - 9, 294, 'C', NX - B.nw - 35, 302, B.sn + 26, 306, B.sn - e * 0.3, SNY, 'C', B.sn - e - 5, SNY + 34, B.cn - e - 4, 400, B.cn - e, 440, 'C', B.cn - e + 6, 500, B.wn - e - 2, 540, B.wn - e, 585, 'C', B.wn - e - 3, 640, B.hn - e, 680, B.hn - e, 730, 'L', B.hn - e + 2, 752, 'L', cx + 2, 752, 'L', cx, 520, 'L', cx - 34, 298, 'Z');
      var br = D('M', NX + B.nw + 9, 296, 'C', NX + B.nw + 31, 304, B.sf - 26, 314, B.sf + e * 0.3, SFY, 'C', B.sf + e + 5, SFY + 34, B.cf + e + 4, 400, B.cf + e, 440, 'C', B.cf + e - 6, 500, B.wf + e + 2, 540, B.wf + e, 585, 'C', B.wf + e + 3, 640, B.hf + e, 680, B.hf + e, 730, 'L', B.hf + e - 2, 752, 'L', cx + 2, 752, 'L', cx, 520, 'L', cx + 36, 300, 'Z');
      o += shape(br, col, line) + shape(bl, col, line) + shade(torsoShade(col, e, 0.34) + Pa(D('M', B.sn, SNY + 10, 'Q', B.cn + 20, 420, B.wn + 10, 580, 'L', B.wn + 30, 580, 'Q', B.cn + 44, 420, B.sn + 40, SNY, 'Z'), F(lt(col, 0.22), 0.5)));
      // notched lapels, piping, an emblem, two buttons
      o += shape(D('M', cx - 34, 298, 'L', cx - 66, 366, 'L', cx - 50, 378, 'L', cx - 58, 396, 'L', cx, 520, 'L', cx - 16, 400, 'Z'), lt(col, 0.1), lt(col, 0.45)) + shape(D('M', cx + 36, 300, 'L', cx + 68, 368, 'L', cx + 52, 380, 'L', cx + 60, 398, 'L', cx, 520, 'L', cx + 18, 402, 'Z'), dk(col, 0.1), lt(col, 0.4));
      o += Pa(D('M', cx, 520, 'L', cx + 2, 752), S(lt(col, 0.4), 1.6)) + Ci(cx - 9, 566, 6, { fill: gold, stroke: '#7a6238', 'stroke-width': 1.3 }) + Ci(cx - 9, 636, 6, { fill: gold, stroke: '#7a6238', 'stroke-width': 1.3 });
      o += shape(D('M', cx + 46, 430, 'h', 34, 'l', -3, 26, 'l', -14, 10, 'l', -14, -10, 'Z'), lt(col, 0.14), gold, 1.5) + Pa(D('M', cx + 56, 442, 'h', 14, 'M', cx + 58, 451, 'h', 10), S(gold, 1.8));
      if (fem) o += ribbon(cx, tc);
      // a sketchbook held against the body; only the fingertips show under its edge
      pn = armPts(B, pose, false, e);
      o += sleeve(B, e, pn, col, false, lt(col, 0.1));
      var bx = pn[2][0] + 22, by = pn[2][1] - 86;
      o += G(R(-64, -92, 128, 184, { fill: dk(sb, 0.3), rx: 4, stroke: ln(sb), 'stroke-width': 1.8 }) + R(-60, -96, 128, 184, { fill: sb, rx: 4, stroke: ln(sb), 'stroke-width': 1.8 }) + R(-60, -96, 22, 184, { fill: dk(sb, 0.2), rx: 4 }) + R(-22, -60, 70, 44, { fill: lt(sb, 0.7), rx: 2, stroke: ln(sb), 'stroke-width': 1.2 }) + Pa('M-12 -46h44M-12 -34h30', S(ln(sb), 1.6, 0.6)) + Pa('M40 -96L68 -96L68 88L52 88Z', F(dk(sb, 0.2), 0.5)),
        { transform: 'translate(' + num(bx) + ' ' + num(by) + ') rotate(-7)' });
      var fg = '';
      for (var i = 0; i < 4; i++) fg += R(pn[2][0] - 14 + i * 11.5, pn[2][1] - 14 - i * 1.4, 10.5, 22, { rx: 5.2 });
      o += G(fg, { fill: sk[0], stroke: skl, 'stroke-width': 1.4 });
    } else {
      e = 4; col = hsl(hue, 34, 91); line = ln(dk(col, 0.2)); tD = torsoD(B, e, 640); pose = skirt ? 'back' : 'pocket';
      pf = skirt ? armPts(B, 'back', true, e) : armPts(B, 'hang', true, e);
      pn = skirt ? armPts(B, 'back', false, e) : armPts(B, 'pockets', false, e);
      if (skirt) behind += sleeve(B, e, pf, col, true) + sleeve(B, e, pn, col, false);
      o += neck + Pa(D('M', NX - 14, 296, 'L', cx, 344, 'L', NX + 18, 298, 'Z'), { fill: sk[0] }) + Pa(D('M', NX - 14, 296, 'L', NX + 18, 298, 'L', NX + 10, 316, 'Q', NX, 306, NX - 10, 310, 'Z'), { fill: sk[1] });
      o += shape(tD, col, line) + shade(torsoShade(col, e, 0.16) + Pa(D('M', B.wn - 8, 610, 'Q', 300, 596, B.wf + 8, 612, 'L', B.wf + 8, 646, 'L', B.wn - 8, 646, 'Z'), F(dk(col, 0.16), 0.9)));
      o += Pa(D('M', cx, 344, 'L', cx - 3, 640), S(line, 1.5, 0.8)) + Pa(D('M', cx + 9, 350, 'L', cx + 6, 640), S(line, 1.1, 0.4));
      [392, 452, 512, 572].forEach(function (y) { o += Ci(cx + 3, y, 3.6, { fill: lt(col, 0.6), stroke: line, 'stroke-width': 1.2 }); });
      o += Pa(D('M', B.cf - 44, 430, 'h', 36, 'v', 40, 'h', -36, 'Z'), S(line, 1.3, 0.55));
      o += lower(c, B, skirt, lowCol);
      if (!skirt) o += shape(D('M', B.wn - 4, 598, 'Q', 300, 588, B.wf + 4, 600, 'L', B.wf + 5, 620, 'Q', 300, 608, B.wn - 5, 618, 'Z'), dk(lowCol, 0.3), ln(lowCol)) + R(cx - 14, 594, 24, 22, { fill: '#c8ab72', rx: 3, stroke: '#7a6238', 'stroke-width': 1.4 });
      else o += shape(D('M', B.wn - 6, 592, 'Q', 300, 582, B.wf + 6, 594, 'L', B.wf + 6, 612, 'Q', 300, 600, B.wn - 6, 610, 'Z'), dk(lowCol, 0.2), ln(lowCol));
      if (c.build === 'masc') o += tie(cx, hsl(hue, 52, 40), 104);
      o += shape(D('M', cx - 20, 286, 'L', cx, 344, 'L', cx - 34, 330, 'L', cx - 40, 298, 'Z'), lt(col, 0.6), line) + shape(D('M', cx + 22, 288, 'L', cx, 344, 'L', cx + 34, 332, 'L', cx + 38, 300, 'Z'), lt(col, 0.3), line);
      if (fem) o += ribbon(cx, hsl((hue + 150) % 360, 48, 52));
      if (!skirt) {
        o += sleeve(B, e, pf, col, true, lt(col, 0.5)) + hand(pf[2][0] + 1, pf[2][1] + 4, -4, sk, skl, true);
        o += sleeve(B, e, pn, col, false, lt(col, 0.5));
        // the near hand rests in the trouser pocket
        o += shape(D('M', pn[2][0] - 20, pn[2][1] - 14, 'L', pn[2][0] + 30, pn[2][1] - 2, 'L', pn[2][0] + 34, pn[2][1] + 70, 'L', pn[2][0] - 26, pn[2][1] + 70, 'Z'), lowCol, ln(lowCol)) + Pa(D('M', pn[2][0] - 20, pn[2][1] - 14, 'L', pn[2][0] + 30, pn[2][1] - 2), S(ln(lowCol), 2.4, 0.9));
      }
    }
    return { behind: behind, body: o, clipD: tD };
  }

  function person(c, face) {
    var sk = SKIN[c.skin - 1], skl = mix(sk[1], '#5a2b2e', 0.6), B = BUILD[c.build], hood = c.hair === 'hood', main = hsl(c.hue, 36, 48);
    var id = 'vs' + K.hash([c.name, c.hue, c.clothes, c.hair, c.build, c.skin, c.hairCol].join('|')).toString(36);
    var fit = outfit(c, B, sk, skl, id), hp = hairParts(c, id), long = c.hair === 'long' || c.hair === 'ponytail';
    var defs = K.defs('<clipPath id="' + id + 't"><path d="' + fit.clipD + '"/></clipPath><clipPath id="' + id + 'k"><path d="' + FACE_D + '"/></clipPath>' +
      '<linearGradient id="' + id + 'h" gradientUnits="userSpaceOnUse" x1="0" y1="36" x2="0" y2="' + (long ? 640 : 300) + '"><stop offset="0" stop-color="' + mix(c.hairCol, c.hairDark, 0.45) + '"/><stop offset="' + (long ? 0.3 : 0.5) + '" stop-color="' + c.hairCol + '"/><stop offset="1" stop-color="' + c.hairTip + '"/></linearGradient>' +
      K.gradient(id + 'i', [[0, hsl(c.hue, 58, 18)], [0.42, hsl(c.hue, 66, 44)], [1, hsl(c.hue + 20, 82, 76)]]));
    var back = hood ? hoodBack(main) : hp.back;
    // the head: ear, face, the shadow the fringe throws, features, hair in front, glasses, hat
    var head = shape('M224 190C212 184 208 204 214 220C218 232 226 236 230 228Z', sk[0], skl) + Pa('M220 200Q216 212 224 222', S(skl, 1.2, 0.7)) +
      shape(FACE_D, sk[0], skl) +
      G((c.hair === 'none' ? '' : Pa('M214 96L392 96L392 176Q372 196 352 180Q336 168 318 182Q304 196 290 182Q270 170 250 186Q232 198 214 176Z', F(sk[1], 0.85))) +
        Pa('M352 246C373 224 385 192 384 150L372 170C372 200 364 226 344 252Z', F(sk[1], 0.55)), { 'clip-path': 'url(#' + id + 'k)' }) +
      Pa('M312 224q5 4 1 9', S(skl, 1.5, 0.8)) + Pa('M306 235q5 3 9 0', S(sk[1], 1.6, 0.9)) + Ci(308, 226, 1.6, F('#ffffff', 0.7)) +
      faceGroups(face, function (f) { return faceFeatures(f, c, B, sk, skl, id); }) +
      (hood ? hp.front + hoodFront(main) : hp.front + hp.top) +
      (c.glasses ? glasses(B) : '') + (c.hat && !hood ? hat(c) : '');
    var fig = G(G(back, { transform: HEAD_ROT }) + fit.behind + fit.body + G(head, { transform: HEAD_ROT }), { transform: LEAN });
    return spriteRoot(c, defs + G(G(fig, { 'class': 'vn-fig' }), { filter: 'url(#vnf-rim)' }), { 'data-face': face, 'data-clothes': c.clothes, 'data-hair': c.hair, 'data-build': c.build });
  }

  /* ------------------------------------------------------------ the reader, seen from behind */

  function player(decl) {
    var c = normCast(decl), sk = SKIN[c.skin - 1], col = hsl(c.hue, 26, 30), hairD = c.hairDark;
    var inner = Pa('M40 1000L70 800C90 720 190 690 250 680L350 680C410 690 510 720 530 800L560 1000Z', { fill: col }) +
      Pa('M250 680Q300 720 350 680L340 640L260 640Z', { fill: sk[1] }) +
      Pa('M70 800C90 720 190 690 250 680', S(lt(col, 0.5), 4, 0.6)) +
      (c.hair === 'none' ? El(300, 540, 118, 138, { fill: sk[1] })
        : c.hair === 'hood' ? Pa('M150 720C120 520 200 380 300 380C400 380 480 520 450 720Z', { fill: dk(col, 0.1) })
          : Pa('M176 560C170 450 230 392 300 392C370 392 430 450 424 560C430 ' + (c.hair === 'long' ? '760 440 860 400 900L200 900C160 860 170 760' : c.hair === 'bob' ? '640 420 690 390 706L210 706C180 690 170 640' : '620 404 664 372 676L228 676C196 664 170 620') + ' 176 560Z', { fill: c.hairCol })) +
      (c.hair !== 'none' && c.hair !== 'hood' ? Pa('M212 470Q300 400 388 470', S(c.hairLight, 6, 0.3)) + Pa('M196 560Q190 470 240 420', S(lt(hairD, 0.6), 4, 0.5)) : '') +
      (c.hair === 'bun' ? Ci(300, 384, 46, { fill: c.hairCol }) : '') +
      (c.hair === 'ponytail' ? Pa('M280 560C270 660 290 760 300 840C316 760 330 660 320 560Z', { fill: c.hairCol }) : '') +
      (c.hat ? Pa('M168 500C160 400 250 360 300 360C350 360 440 400 432 500C390 470 210 470 168 500Z', { fill: hsl(c.hue, 30, 22) }) : '');
    return spriteRoot(c, G(G(inner, { 'class': 'vn-fig' }), { filter: 'url(#vnf-rim)' }) + R(0, 700, 600, 300, { fill: 'none' }), { 'data-face': 'back' });
  }

  /* ------------------------------------------------------------ a floating manuscript sheet */

  function page(decl) {
    var c = normCast(decl), rules = '', ink = '', r = K.rngFor(c.name + ':page');
    for (var i = 0; i < 11; i++) {
      var y = 360 + i * 34;
      rules += Pa('M150 ' + y + 'L450 ' + y, S('#8ea1c0', 1.5, 0.5));
      var x = 196, end = 430 - (r() < 0.3 ? r() * 140 : 0);
      while (x < end) { var len = 14 + r() * 50; ink += R(x, y - 15, Math.min(len, end - x), 5, { rx: 2.5 }); x += len + 9; }
    }
    var inner = El(300, 520, 240, 300, F('#fff3cf', 0.28, { filter: 'url(#vnf-b30)' })) +
      G(R(138, 262, 340, 470, F('#0b0c1a', 0.3, { filter: 'url(#vnf-b8)' })) + R(130, 250, 340, 470, { fill: '#fbf5e4', rx: 3 }) + R(130, 250, 340, 470, { fill: 'url(#vnp-' + K.hash(c.name).toString(36) + ')', rx: 3 }) +
        rules + Pa('M184 250L184 720', S('#d9707a', 2, 0.7)) + R(196, 292, 150, 9, F('#2b3350', 0.8, { rx: 4 })) + G(ink, F('#2b3350', 0.55)) +
        Pa('M470 640L470 720L390 720Q430 708 440 684Q448 656 470 640Z', { fill: '#e2d6b8' }), { transform: 'rotate(-5 300 500)', 'class': 'vn-page' });
    return spriteRoot(c, K.defs(K.gradient('vnp-' + K.hash(c.name).toString(36), [[0, '#ffffff', 0.5], [1, '#c9b78f', 0.35]], { x1: '0', y1: '0', x2: '1', y2: '1' })) + inner, { 'data-face': 'page' });
  }

  /* ------------------------------------------------------------ the model: a figure of light */

  var LB = BUILD.neutral;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function insideBody(x, y) {
    if (y >= 330 && y <= 1000) {
      var n, f;
      if (y < 440) { n = lerp(LB.sn + 14, LB.cn, (y - 330) / 110); f = lerp(LB.sf - 14, LB.cf, (y - 330) / 110); }
      else if (y < 585) { n = lerp(LB.cn, LB.wn, (y - 440) / 145); f = lerp(LB.cf, LB.wf, (y - 440) / 145); }
      else if (y < 730) { n = lerp(LB.wn, LB.hn, (y - 585) / 145); f = lerp(LB.wf, LB.hf, (y - 585) / 145); }
      else { n = LB.hn; f = LB.hf; }
      return x >= n + 8 && x <= f - 8;
    }
    return false;
  }
  function latticePoints(c, dense) {
    var r = K.rngFor(c.name + ':lattice'), pts = [], step = dense ? 30 : 52, jit = dense ? 4 : 19;
    for (var y = 84; y <= 990; y += step) for (var x = 150 + (dense && Math.round(y / step) % 2 ? step / 2 : 0); x <= 450; x += step) {
      var px = x + (r() - 0.5) * 2 * jit, py = y + (r() - 0.5) * 2 * jit;
      if (py > 330 && insideBody(px, py)) pts.push([px, py]);
    }
    var edges = [], thr = step * (dense ? 1.2 : 1.5);
    for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
      var ddx = pts[i][0] - pts[j][0], ddy = pts[i][1] - pts[j][1];
      if (Math.sqrt(ddx * ddx + ddy * ddy) <= thr) edges.push([i, j, 0]);
    }
    if (!dense) for (var k = 0; k < 9 && pts.length > 2; k++) { var a = Math.floor(r() * pts.length), b = Math.floor(r() * pts.length); if (a !== b) edges.push([a, b, 1]); }
    return { pts: pts, edges: edges };
  }
  // gentle eyes of light: openness, lower lid, tilt, gaze
  var LEXPR = {
    neutral: { open: 0.82 }, smile: { arc: 1, mouth: 'M-11 -3Q0 7 11 -3' }, puzzled: { open: 0.82, tilt: 5, ring: true, mouth: 'M-6 1Q-1 -2 6 1' }, worried: { open: 0.8, tilt: -6, look: [0, 2], mouth: 'M-8 3Q0 -3 8 3' },
    surprised: { open: 1.12, small: true, mouthO: true }, thinking: { open: 0.7, look: [4, -3], mouth: 'M-1 1L8 0' }, deadpan: { open: 0.34 }, laugh: { arc: 1, mouth: 'M-12 -4Q0 0 12 -4Q8 12 0 12Q-8 12 -12 -4Z', fillMouth: true }
  };
  function lattice(decl, face, opts) {
    var c = normCast(decl);
    face = normFace(face);
    var dense = opts && typeof opts.dense === 'boolean' ? opts.dense : c.lattice === 'dense';
    var h = c.hue, id = 'vl' + K.hash(c.name + '|' + h).toString(36), hi = hsl(h, 90, 88), mid = hsl(h, 85, 68), deep = hsl(h, 75, 48), ink = hsl(h, 70, 34);
    var an = armPts(LB, 'hang', false), af = armPts(LB, 'hang', true), aw = [LB.aw, LB.aw * 0.8, LB.aw * 0.6];
    var sil = '<path transform="' + HEAD_ROT + '" d="' + FACE_D + '"/>' + Pa(D('M', NX - 17, 236, 'L', NX - 20, 300, 'L', NX + 20, 300, 'L', NX + 17, 236, 'Z')) + Pa(torsoD(LB, 0, 1000)) +
      Pa(circD(an[0][0], an[0][1] - 2, aw[0] / 2)) + Pa(limbD(an, aw)) + Pa(circD(af[0][0], af[0][1] - 2, aw[0] / 2)) + Pa(limbD(af, aw));
    var defs = K.defs('<linearGradient id="' + id + 'b" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="1000"><stop offset="0" stop-color="#ffffff"/><stop offset="0.2" stop-color="' + hi + '"/><stop offset="0.55" stop-color="' + mid + '"/><stop offset="1" stop-color="' + deep + '"/></linearGradient>' +
      K.gradient(id + 'h', [[0, '#ffffff', 0.95], [0.3, hi, 0.6], [1, mid, 0]], { radial: true, r: '50%' }));
    var r = K.rngFor(c.name + ':hair'), strands = '';
    // hair of light: long filaments streaming from the crown
    for (var s = 0; s < 26; s++) {
      var side = s % 2 ? 1 : -1, sx = 302 + side * (8 + r() * 56), ex = 302 + side * (96 + r() * 170), ey = 400 + r() * 440, bend = 60 + r() * 90;
      strands += '<path d="M' + num(sx) + ' ' + num(66 + r() * 20) + 'C' + num(sx + side * bend) + ' ' + num(62 + r() * 40) + ' ' + num(ex + side * 30) + ' ' + num(ey - 250) + ' ' + num(ex) + ' ' + num(ey) + '" stroke-width="' + num(0.8 + r() * 2.2) + '" stroke-opacity="' + num(0.25 + r() * 0.5) + '"/>';
    }
    // a fringe of light across the brow, so the head reads as a head
    var fringe = '';
    [[358, 84, 380, 190, 30, 12], [246, 88, 226, 196, 34, -14], [334, 74, 348, 172, 34, 10], [270, 76, 258, 176, 36, -10], [302, 70, 305, 186, 30, 4]].forEach(function (l) { fringe += Pa(lockD.apply(null, l)); });
    var L = latticePoints(c, dense), pts = L.pts, lines = '', arcs = '', nodes = '', bright = '', rn = K.rngFor(c.name + ':nodes');
    for (var e = 0; e < L.edges.length; e++) {
      var p = pts[L.edges[e][0]], q = pts[L.edges[e][1]];
      if (L.edges[e][2]) arcs += Pa('M' + num(p[0]) + ' ' + num(p[1]) + 'Q' + num((p[0] + q[0]) / 2 + (p[1] - q[1]) * 0.25) + ' ' + num((p[1] + q[1]) / 2 + (q[0] - p[0]) * 0.25) + ' ' + num(q[0]) + ' ' + num(q[1]));
      else lines += 'M' + num(p[0]) + ' ' + num(p[1]) + 'L' + num(q[0]) + ' ' + num(q[1]);
    }
    for (var i = 0; i < pts.length; i++) {
      var fade = Math.max(0.15, 1 - Math.max(0, pts[i][1] - 500) / 560), big = rn() < (dense ? 0.08 : 0.2), rad = (dense ? 2.2 : 3.4) * (big ? 1.8 : 1);
      nodes += Ci(pts[i][0], pts[i][1], rad, F('#ffffff', fade));
      if (big) bright += Ci(pts[i][0], pts[i][1], rad * 2.6, F(hi, fade * 0.8));
    }
    var faces = faceGroups(face, function (f) {
      var x = LEXPR[f], o = '', lx = x.look ? x.look[0] : 0, ly = x.look ? x.look[1] : 0;
      [[EYE_N, -1, 21], [EYE_F, 1, 18.5]].forEach(function (E) {
        var cx = E[0][0], cy = E[0][1], od = E[1], w = E[2], t = (x.tilt || 0) * od;
        if (x.arc) { o += Pa(D('M', cx - w, cy + 4, 'Q', cx, cy - 16, cx + w, cy + 5, 'Q', cx, cy - 8, cx - w, cy + 4, 'Z'), { fill: '#ffffff', stroke: '#ffffff', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }); return; }
        var hh = 19 * x.open, ir = x.small ? 8 : 12.5, iy = Math.min(ir * 1.3, hh * 0.95);
        var g = El(cx + lx, cy + ly, ir, iy, F(deep, 0.9)) + El(cx + lx, cy + ly + iy * 0.35, ir * 0.7, iy * 0.5, F(hi, 0.7)) + El(cx + lx, cy + ly - 1, ir * 0.42, iy * 0.45, F(ink, 0.95)) + El(cx + lx - ir * 0.35, cy + ly - iy * 0.4, ir * 0.36, iy * 0.26, { fill: '#ffffff' }) + Ci(cx + lx + ir * 0.4, cy + ly + iy * 0.4, 1.8, { fill: '#ffffff' }) +
          Pa(D('M', cx - od * w, cy + 2 - hh * 0.2, 'C', cx - od * w * 0.5, cy - hh * 1.1, cx + od * w * 0.6, cy - hh * 1.15, cx + od * (w + 2), cy - hh * 0.1), S(ink, 3.2, 0.9));
        o += G(g, t ? { transform: 'rotate(' + t + ' ' + cx + ' ' + cy + ')' } : null);
      });
      if (x.ring) o += Ci(302, 150, 122, S(hi, 2, 0.5)) + Ci(302, 150, 140, S(hi, 1.2, 0.3));
      var mt = { transform: 'translate(' + MOUTH[0] + ' ' + MOUTH[1] + ')' };
      if (x.mouthO) o += El(MOUTH[0], MOUTH[1] + 2, 5, 7, S('#ffffff', 2.4));
      else if (x.mouth) o += G(Pa(x.mouth, x.fillMouth ? { fill: '#ffffff', opacity: 0.9 } : S('#ffffff', 2.4)), mt);
      else o += G(Pa('M-7 0Q0 3 7 0', S('#ffffff', 2.2, 0.85)), mt);
      return G(o, { filter: 'url(#vnf-glow)' });
    });
    var inner = defs +
      G(sil, { fill: mid, opacity: 0.55, filter: 'url(#vnf-b30)' }) +
      G(strands, { fill: 'none', stroke: hi, 'stroke-linecap': 'round', filter: 'url(#vnf-glow)' }) +
      G(sil, { fill: 'url(#' + id + 'b)', opacity: 0.8 }) +
      Pa(lines, S(hi, dense ? 0.9 : 1.3, dense ? 0.45 : 0.55)) + G(arcs, S('#ffffff', 1.4, 0.6, { filter: 'url(#vnf-glow)' })) +
      G(bright, { filter: 'url(#vnf-b4)' }) + G(nodes, { 'class': 'vn-lattice-nodes' }) +
      Ci(302, 470, 150, { fill: 'url(#' + id + 'h)', opacity: 0.75 }) + Ci(302, 470, 9, F('#ffffff', 0.95, { filter: 'url(#vnf-glow)' })) +
      G(El(302, 160, 130, 140, { fill: 'url(#' + id + 'h)', opacity: 0.4 }) + G(fringe, F('#ffffff', 0.5, { stroke: hi, 'stroke-width': 1.2 })) + faces, { transform: HEAD_ROT });
    return spriteRoot(c, G(inner, { transform: 'translate(0 34)' }), { 'data-face': face, 'data-lattice': dense ? 'dense' : 'sparse' });
  }

  function sprite(decl, face) {
    var c = normCast(decl);
    if (c.lattice) return lattice(c, face);
    if (c.player) return player(c);
    if (c.page) return page(c);
    return person(c, normFace(face));
  }

  return { sprite: sprite, lattice: lattice, player: player, page: page, normCast: normCast, FACES: FACES, HAIR: HAIR, CLOTHES: CLOTHES };
});
