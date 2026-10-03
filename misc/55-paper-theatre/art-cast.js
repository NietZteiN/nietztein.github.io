/*
 * Paper Theatre - the cast (pure string builders, no DOM).
 *
 * Tall knee-up figures in a restrained illustrative style: the head is about a
 * sixth of the visible height, hair is drawn in a back and a front layer with a
 * highlight band, the eight faces are eight <g data-face> groups so the stage
 * can crossfade expressions without rebuilding the sprite, and clothing is one
 * of coat / hoodie / cardigan / shirt / uniform over the same body.
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
  function dk(c, t) { return mix(c, '#0b0c1a', t); }
  function lt(c, t) { return mix(c, '#ffffff', t); }
  var MIRROR = 'translate(600 0) scale(-1 1)';
  // the head is drawn at 1:1 around the chin and enlarged a little; the body is slimmed; the figure sits lower in its box
  var HEAD_T = 'translate(300 240) scale(1.22) translate(-300 -240)', BODY_T = 'translate(300 0) scale(0.95 1) translate(-300 0)', FIG_T = 'translate(0 58)';
  function both(s) { return s + G(s, { transform: MIRROR }); }

  var FACES = ['neutral', 'smile', 'puzzled', 'worried', 'surprised', 'thinking', 'deadpan', 'laugh'];
  var HAIR = ['short', 'long', 'bob', 'ponytail', 'bun', 'curly', 'none', 'hood'];
  var CLOTHES = ['coat', 'hoodie', 'cardigan', 'shirt', 'uniform'];
  var SKIN = [['#fbe7d8', '#edc4ae', '#d98f86'], ['#f4d5bc', '#dcab8e', '#cf8377'], ['#dba981', '#b9825e', '#b0625a'], ['#a87250', '#80503a', '#8a4640'], ['#6e4832', '#4b2f22', '#5e2f2c']];
  var HAIRCOL = [[24, 22, 15], [20, 34, 24], [16, 44, 32], [222, 16, 22], [30, 38, 44], [345, 20, 20]];

  function normCast(decl) {
    decl = decl || {};
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
    var hc = HAIRCOL[K.hash(name + ':hh') % HAIRCOL.length];
    return {
      name: name, display: decl.display || decl.label || decl.name || name, hue: hue, skin: skin, hair: hair, clothes: clothes,
      glasses: has('glasses'), hat: has('hat'), lattice: lattice === 'sparse' || lattice === 'dense' ? lattice : null,
      player: has('player'), page: has('page'), coauthor: has('coauthor'),
      hairHue: hc[0], hairCol: hsl(hc[0], hc[1], hc[2]), hairDark: hsl(hc[0], hc[1], hc[2] * 0.55), hairLight: hsl(hc[0], hc[1] + 6, Math.min(70, hc[2] + 22))
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

  /* ------------------------------------------------------------ body */

  var FACE_D = 'M242 150C240 96 268 68 300 68C332 68 360 96 358 150C357 186 345 211 327 225C315 234 306 238 300 238C294 238 285 234 273 225C255 211 243 186 242 150Z';
  var TORSO_D = 'M264 270C236 280 204 290 186 308C180 330 186 360 196 392L200 520C198 570 190 612 184 660L174 1000L426 1000L416 660C410 612 402 570 400 520L404 392C414 360 420 330 414 308C396 290 364 280 336 270Q300 300 264 270Z';
  var ARM_D = 'M194 304C166 314 152 344 150 396L138 600C134 676 138 730 142 772L186 774C190 724 198 664 202 604L212 420C214 380 210 330 194 304Z';
  var HAND_D = 'M142 770C136 806 142 842 162 852C180 856 190 834 187 772Z';

  // the eight faces: eye openness, gaze, brows (outer, inner), mouth, blush
  var EXPR = {
    neutral: { open: 1, brow: [0, 0], mouth: 'M290 212Q300 216 310 212' },
    smile: { open: 0.86, brow: [-1, -1], mouth: 'M285 208Q300 222 315 208', blush: 0.22 },
    puzzled: { open: 0.95, look: [3, 0], browL: [2, 3], browR: [-7, -3], mouth: 'M291 215Q298 209 309 213' },
    worried: { open: 1, look: [0, 1], brow: [4, -5], mouth: 'M290 216Q300 209 310 216' },
    surprised: { open: 1.3, brow: [-8, -7], iris: 0.82, mouthO: true },
    thinking: { open: 0.9, look: [4, -3], browL: [0, 0], browR: [-4, -2], mouth: 'M293 214L308 211' },
    deadpan: { open: 0.5, flat: true, brow: [1, 2], mouth: 'M291 214L309 214' },
    laugh: { closed: true, brow: [-4, -3], mouthOpen: true, blush: 0.3 }
  };
  function eye(cx, e, sk, iris, side) {
    var y = 166, h = 10.5 * e.open, lid = '#3a2a30';
    if (e.closed) return Pa('M' + (cx - 14) + ' ' + (y + 2) + 'Q' + cx + ' ' + (y - 11) + ' ' + (cx + 14) + ' ' + (y + 2), S(lid, 3.4));
    var lx = (e.look ? e.look[0] : 0), ly = (e.look ? e.look[1] : 0), ir = 7 * (e.iris || 1), top = e.flat ? y - h * 0.9 : y - h * 1.5;
    var o = Pa('M' + (cx - 14) + ' ' + y + 'Q' + cx + ' ' + num(top) + ' ' + (cx + 14) + ' ' + (y - 1) + 'Q' + cx + ' ' + num(y + h * 1.15) + ' ' + (cx - 14) + ' ' + y + 'Z', { fill: '#fffdfb' });
    o += El(cx + lx, y + ly - (e.flat ? -1 : 0.5), ir, Math.min(ir * 1.2, h * 1.0 + 1), { fill: iris }) + El(cx + lx, y + ly + 2.5, ir * 0.7, Math.min(ir, h) * 0.55, F(lt(iris, 0.45), 0.7)) +
      Ci(cx + lx, y + ly, ir * 0.42, { fill: '#17121c' }) + Ci(cx + lx - 2.6, y + ly - 3, 2.1, { fill: '#ffffff' });
    // skin above the lid keeps the iris inside the eye
    o += Pa('M' + (cx - 17) + ' ' + (y - 1) + 'Q' + cx + ' ' + num(top - 1) + ' ' + (cx + 17) + ' ' + (y - 2) + 'L' + (cx + 17) + ' ' + (y - 16) + 'L' + (cx - 17) + ' ' + (y - 16) + 'Z', { fill: sk[0] });
    o += Pa('M' + (cx - 15) + ' ' + (y + 0.5) + 'Q' + cx + ' ' + num(top - 0.5) + ' ' + (cx + 15) + ' ' + (y - 1.5), S(lid, 2.6));
    o += Pa('M' + (cx + side * 15) + ' ' + (y - 1) + 'l' + side * 4 + ' -3', S(lid, 2.2));
    o += Pa('M' + (cx - 9) + ' ' + num(y + h * 0.95) + 'Q' + cx + ' ' + num(y + h * 1.3) + ' ' + (cx + 9) + ' ' + num(y + h * 0.9), S(sk[1], 1.6, 0.9));
    return o;
  }
  function brow(cx, b, side, col) {
    // side: -1 for the eye on the viewer's left (its inner end is on the right)
    var xo = cx + side * 15, xi = cx - side * 13;
    return Pa('M' + xo + ' ' + (141 + b[0]) + 'Q' + cx + ' ' + (134 + (b[0] + b[1]) / 2) + ' ' + xi + ' ' + (139 + b[1]), S(col, 2.4, 0.85));
  }
  function faceFeatures(f, c, sk) {
    var e = EXPR[f], iris = hsl(c.hue, 42, 34), o = '';
    if (e.blush) o += El(262, 192, 14, 7, F(sk[2], e.blush, { filter: 'url(#vnf-b4)' })) + El(338, 192, 14, 7, F(sk[2], e.blush, { filter: 'url(#vnf-b4)' }));
    // eyes are drawn small and enlarged about their own centres
    [[272, -1], [328, 1]].forEach(function (p) { o += G(eye(p[0], e, sk, iris, p[1]), { transform: 'translate(' + p[0] + ' 166) scale(1.16) translate(' + (-p[0]) + ' -166)' }); });
    o += brow(272, e.browL || e.brow, -1, c.hair === 'none' ? dk(sk[1], 0.5) : c.hairDark) + brow(328, e.browR || e.brow, 1, c.hair === 'none' ? dk(sk[1], 0.5) : c.hairDark);
    if (e.mouthO) o += El(300, 215, 5.5, 7.5, { fill: '#6e2f3a' });
    else if (e.mouthOpen) o += Pa('M284 206Q300 234 316 206Z', { fill: '#7a3038' }) + Pa('M288 207Q300 213 312 207L310 211Q300 216 290 211Z', { fill: '#fffaf5' });
    else o += Pa(e.mouth, S(sk[2], 2.6));
    return o;
  }

  function hairBack(c) {
    var col = { fill: c.hairDark }, h = c.hair;
    if (h === 'none') return '';
    if (h === 'hood') return '';
    if (h === 'long') return Pa('M228 150C220 70 262 40 300 40C338 40 380 70 372 150C386 262 404 400 394 548C380 560 350 540 340 520L260 520C250 540 220 560 206 548C196 400 214 262 228 150Z', col) +
      Pa('M214 420C216 480 212 520 222 546M386 420C384 480 388 520 378 546M240 300C232 400 236 470 246 524M360 300C368 400 364 470 354 524', S(c.hairCol, 3, 0.7));
    if (h === 'bob') return Pa('M228 150C220 68 262 40 300 40C338 40 380 68 372 150C380 200 378 244 366 270C340 282 260 282 234 270C222 244 220 200 228 150Z', col);
    if (h === 'curly') { var o = '', r = K.rngFor(c.name + ':curl'); for (var i = 0; i < 16; i++) { var a = Math.PI * (0.95 + i / 15 * 1.1), rad = 78 + r() * 14; o += Ci(300 + Math.cos(a) * rad * 0.92, 150 + Math.sin(a) * rad, 26 + r() * 8, col); } return o + El(300, 130, 78, 86, col); }
    var cap = Pa('M236 150C226 78 262 42 300 42C338 42 374 78 364 150C366 170 362 186 357 196L243 196C238 186 234 170 236 150Z', col);
    if (h === 'ponytail') return Pa('M350 96C420 104 452 220 430 350C420 420 434 470 408 520C398 452 378 420 384 330C390 236 372 176 340 140Z', { fill: c.hairCol }) + Pa('M392 150C420 230 412 330 404 400', S(c.hairLight, 3, 0.4)) + cap + El(356, 104, 12, 16, { fill: hsl(c.hue, 50, 52) });
    if (h === 'bun') return Ci(300, 36, 34, { fill: c.hairCol }) + Pa('M278 30Q300 14 322 30', S(c.hairLight, 4, 0.45)) + cap;
    return cap;
  }
  function hairFront(c) {
    var h = c.hair, col = { fill: c.hairCol };
    if (h === 'none') return Pa('M262 92Q300 72 338 92', S('#ffffff', 5, 0.18));
    var fringe = Pa('M238 156C230 92 260 52 300 50C340 52 370 92 362 156C360 134 354 118 346 106C343 124 333 138 321 142C324 128 322 114 317 104C309 124 293 138 276 142C283 128 285 116 284 106C270 118 252 134 238 156Z', col);
    var shade = Pa('M276 142C283 128 285 116 284 106C278 112 270 120 262 130ZM321 142C324 128 322 114 317 104C314 112 308 122 300 130Z', F(c.hairDark, 0.6));
    var shine = Pa('M250 104C270 82 330 82 350 104C330 94 270 94 250 104Z', F(c.hairLight, 0.22)) + Pa('M262 84Q300 68 338 84', S(c.hairLight, 2.5, 0.25));
    var locks = '';
    if (h === 'long') locks = both(Pa('M240 138C230 190 232 250 240 300C244 330 240 350 236 372C254 350 258 320 256 290C252 240 252 190 256 150Z', col) + Pa('M246 170C240 220 244 270 248 310', S(c.hairLight, 2, 0.35)));
    else if (h === 'bob') locks = both(Pa('M240 138C230 180 232 226 238 262C250 268 258 262 260 250C254 220 252 180 256 150Z', col));
    else if (h === 'curly') { var r = K.rngFor(c.name + ':curlf'), o = ''; for (var i = 0; i < 9; i++) o += Ci(246 + i * 13.5, 96 + Math.abs(i - 4) * 7 + r() * 6, 17 + r() * 5, col); return o + Pa('M254 88Q300 64 346 88', S(c.hairLight, 4, 0.3)); }
    else locks = both(Pa('M240 140C234 164 236 186 242 204C248 190 250 168 254 150Z', col));
    return locks + fringe + shade + shine;
  }
  function hoodBack(c, main) {
    return Pa('M206 318C186 190 226 36 300 30C374 36 414 190 394 318Z', { fill: dk(main, 0.25) });
  }
  function hoodFront(c, main) {
    return Pa('M206 318C186 190 226 36 300 30C374 36 414 190 394 318L362 300C380 190 352 70 300 64C248 70 220 190 238 300Z', { fill: main }) +
      Pa('M238 300C220 190 248 70 300 64', S(lt(main, 0.3), 3, 0.5)) + Pa('M362 300C380 190 352 70 300 64', S(dk(main, 0.4), 3, 0.5)) +
      Pa('M246 132C254 92 280 76 300 76C320 76 346 92 354 132C340 116 330 112 318 120C312 108 296 108 286 120C274 110 258 118 246 132Z', { fill: c.hairCol });
  }
  function glasses() {
    var fr = '#2b2630';
    return G(R(250, 151, 44, 30, F('#eaf4ff', 0.16, { rx: 11 })) + R(306, 151, 44, 30, F('#eaf4ff', 0.16, { rx: 11 })) + R(250, 151, 44, 30, S(fr, 2.6, 1, { rx: 11 })) + R(306, 151, 44, 30, S(fr, 2.6, 1, { rx: 11 })) +
      Pa('M294 164Q300 160 306 164M250 162L240 158M350 162L360 158', S(fr, 2.4)) + Pa('M256 158L270 154M312 158L326 154', S('#ffffff', 2, 0.55)), { 'class': 'vn-glasses' });
  }
  function hat(c) {
    var col = hsl(c.hue, 30, 24);
    return G(Pa('M226 104C214 36 300 16 350 28C392 38 388 84 372 100C330 80 268 82 226 104Z', { fill: col }) + Pa('M226 104C268 82 330 80 372 100C376 106 372 112 366 112C326 94 270 96 232 114C226 114 222 110 226 104Z', { fill: dk(col, 0.35) }) +
      Pa('M250 52Q300 30 350 44', S(lt(col, 0.4), 3, 0.4)) + Ci(318, 22, 7, { fill: dk(col, 0.2) }), { 'class': 'vn-hat' });
  }

  // clothing: returns {under, over} drawn on the torso and arms; colours are literal
  function outfit(c) {
    var k = c.clothes, hue = c.hue, main = hsl(hue, 34, 44), white = '#f6f3ee', navy = hsl(hue, 22, 20), o = '', torso, sleeve, lower = hsl((hue + 200) % 360, 12, 24);
    if (k === 'coat') { torso = white; sleeve = white; }
    else if (k === 'hoodie') { torso = main; sleeve = main; }
    else if (k === 'cardigan') { torso = hsl(hue, 30, 62); sleeve = torso; }
    else if (k === 'uniform') { torso = navy; sleeve = navy; }
    else { torso = hsl(hue, 30, 90); sleeve = torso; }
    var shadeT = dk(torso, k === 'uniform' ? 0.4 : 0.22), fold = dk(torso, k === 'uniform' ? 0.55 : 0.32);
    // arms behind the torso
    o += both(Pa(ARM_D, { fill: sleeve }) + Pa('M196 310C204 340 210 380 210 420L202 604', S(shadeT, 5, 0.55)) + Pa('M150 540Q168 552 194 540M146 588Q166 600 196 590', S(fold, 2.5, 0.5)) +
      Pa('M140 742L187 744L186 774L142 772Z', { fill: k === 'hoodie' ? dk(sleeve, 0.18) : k === 'shirt' ? lt(sleeve, 0.3) : dk(sleeve, 0.1) }));
    o += Pa(TORSO_D, { fill: torso }) + both(Pa('M192 318C186 340 190 366 198 394L202 520C200 570 192 612 186 660', S(fold, 3.5, 0.55)) + Pa('M198 394L202 520C200 570 192 612 186 660L170 660L176 400Z', F(fold, 0.16)));
    // lower body: trousers or a pleated skirt, under the hem
    var skirt = (k === 'cardigan' || k === 'uniform') && /^(long|bob|ponytail|bun)$/.test(c.hair);
    if (k !== 'coat') {
      o += Pa('M186 648L174 1000L426 1000L414 648Z', { fill: skirt ? hsl(hue, 18, 30) : lower });
      if (skirt) { var pl = ''; for (var i = 0; i < 9; i++) pl += 'M' + (198 + i * 26) + ' 664L' + (184 + i * 29) + ' 1000'; o += Pa(pl, S(dk(hsl(hue, 18, 30), 0.4), 2.5, 0.7)); }
      else o += Pa('M300 700L300 1000', S(dk(lower, 0.5), 3, 0.8)) + Pa('M188 664L412 664', S(dk(lower, 0.5), 10, 0.6)) + R(286, 656, 28, 18, { fill: '#b9a070', rx: 3 });
    }
    if (k === 'shirt') {
      o += Pa('M300 296L300 660', S(shadeT, 2.5)) + [340, 400, 460, 520, 580].map(function (y) { return Ci(300, y, 3.5, { fill: shadeT }); }).join('');
      o += Pa('M264 270L300 300L284 322L252 284Z', { fill: lt(torso, 0.5) }) + Pa('M336 270L300 300L316 322L348 284Z', { fill: lt(torso, 0.5) }) + Pa('M264 270L300 300L336 270', S(shadeT, 2));
      o += Pa('M214 420Q240 470 222 540M386 420Q360 470 378 540M236 640Q300 660 364 640', S(fold, 3, 0.35));
    } else if (k === 'coat') {
      var inner = hsl(hue, 36, 46);
      o += Pa('M264 270L300 300L336 270L352 300L340 1000L260 1000L248 300Z', { fill: inner }) + Pa('M300 300L300 1000', S(dk(inner, 0.4), 2.5, 0.6)) +
        Pa('M270 274L300 300L288 318L262 286ZM330 274L300 300L312 318L338 286Z', { fill: lt(inner, 0.5) }) +
        Pa('M292 304L308 304L312 420L300 440L288 420Z', { fill: hsl((hue + 180) % 360, 30, 30) });
      // lapels and the long open front
      o += Pa('M252 278L238 300L262 430L282 520L270 1000L174 1000L184 660C190 612 198 570 200 520L196 392C186 360 180 330 186 308C204 292 230 284 252 278Z', { fill: white }) +
        Pa('M348 278L362 300L338 430L318 520L330 1000L426 1000L416 660C410 612 402 570 400 520L404 392C414 360 420 330 414 308C396 292 370 284 348 278Z', { fill: white });
      o += Pa('M252 278L238 300L262 430L282 520M348 278L362 300L338 430L318 520', S(shadeT, 3)) + Pa('M238 300L226 360L262 430M362 300L374 360L338 430', S(shadeT, 2.5, 0.8)) +
        Pa('M282 520L270 1000M318 520L330 1000', S(shadeT, 3)) + R(340, 440, 50, 6, { fill: shadeT }) + R(352, 414, 6, 34, { fill: '#3b5fb0', rx: 3 }) + R(364, 418, 6, 30, { fill: '#b04a4a', rx: 3 }) +
        R(206, 700, 62, 8, { fill: shadeT }) + R(332, 700, 62, 8, { fill: shadeT }) + Pa('M214 440Q232 520 216 620M386 440Q368 520 384 620', S(fold, 3, 0.3));
    } else if (k === 'hoodie') {
      o += Pa('M252 276C262 310 338 310 348 276C370 290 372 320 356 336C330 356 270 356 244 336C228 320 230 290 252 276Z', { fill: dk(main, 0.16) }) + Pa('M252 282C268 312 332 312 348 282', S(dk(main, 0.45), 3, 0.7)) +
        Pa('M282 330L278 420M318 330L322 420', S('#f1ece4', 4)) + Ci(278, 424, 5, { fill: '#f1ece4' }) + Ci(322, 424, 5, { fill: '#f1ece4' }) +
        Pa('M224 560L376 560L392 650L208 650Z', { fill: dk(main, 0.1) }) + Pa('M224 560L376 560M240 562L226 648M360 562L374 648', S(dk(main, 0.4), 3, 0.7)) +
        Pa('M186 650L414 650L416 690L184 690Z', { fill: dk(main, 0.2) }) + Pa('M214 420Q236 480 220 548M386 420Q364 480 380 548', S(fold, 3, 0.35));
    } else if (k === 'cardigan') {
      o += Pa('M264 270L300 300L336 270L350 290L300 500L250 290Z', { fill: white }) + Pa('M270 274L300 300L286 320L260 286ZM330 274L300 300L314 320L340 286Z', { fill: '#ffffff' }) +
        Pa('M286 306L300 300L314 306L320 330L300 322L280 330Z', { fill: hsl((hue + 150) % 360, 50, 46) }) + Pa('M296 322L290 372L300 384L310 372L304 322Z', { fill: hsl((hue + 150) % 360, 50, 40) }) +
        Pa('M250 290L300 500L350 290', S(shadeT, 4)) + Pa('M300 500L300 690', S(shadeT, 3)) + [530, 580, 630].map(function (y) { return Ci(300, y, 5, { fill: lt(torso, 0.5) }); }).join('') +
        Pa('M186 660L414 660L416 694L184 694Z', { fill: dk(torso, 0.16) }) + Pa('M214 420Q236 480 220 548M386 420Q364 480 380 548', S(fold, 3, 0.35));
    } else if (k === 'uniform') {
      o += Pa('M264 270L300 300L336 270L348 290L300 470L252 290Z', { fill: white }) + Pa('M270 274L300 300L286 320L260 286ZM330 274L300 300L314 320L340 286Z', { fill: '#ffffff' }) +
        Pa('M292 304L308 304L313 420L300 444L287 420Z', { fill: hsl(hue, 52, 42) }) + Pa('M292 304L308 304L306 322L294 322Z', { fill: hsl(hue, 52, 32) }) +
        Pa('M252 290L240 330L300 470L360 330L348 290', S(lt(torso, 0.25), 3, 0.9)) + Pa('M240 330L226 380L300 470M360 330L374 380L300 470', S(lt(torso, 0.2), 2.5, 0.7)) +
        Pa('M300 470L300 690', S(dk(torso, 0.5), 3)) + Ci(300, 520, 6, { fill: '#c8a560' }) + Ci(300, 590, 6, { fill: '#c8a560' }) +
        Pa('M340 400L384 400L380 430L362 440L344 430Z', { fill: lt(torso, 0.12) }) + Pa('M352 412h20M356 422h12', S('#c8a560', 2.5)) +
        Pa('M186 690L414 690', S(dk(torso, 0.5), 3)) + Pa('M214 420Q236 480 220 548M386 420Q364 480 380 548', S(lt(torso, 0.2), 3, 0.3));
    }
    return o;
  }

  function person(c, face) {
    var sk = SKIN[c.skin - 1], id = 'vs' + K.hash(c.name + '|' + c.hue + c.clothes).toString(36), main = hsl(c.hue, 34, 44), hood = c.hair === 'hood';
    var defs = K.defs('<clipPath id="' + id + 'c"><path d="' + TORSO_D + '"/><path d="' + ARM_D + '"/><path d="' + ARM_D + '" transform="' + MIRROR + '"/></clipPath>' +
      K.gradient(id + 's', [[0, '#fff4dc', 0.14], [0.45, '#ffffff', 0], [1, '#141026', 0.3]], { x1: '0', y1: '0', x2: '1', y2: '0.15' }) +
      K.gradient(id + 'f', [[0, '#141026', 0], [1, '#141026', 0.22]], { x1: '0.35', y1: '0', x2: '1', y2: '0.3' }));
    var back = hood ? hoodBack(c, main) : hairBack(c);
    var body = both(Pa(HAND_D, { fill: sk[0] }) + Pa('M150 800Q160 830 176 836', S(sk[1], 2, 0.8))) +
      Pa('M278 216L278 270Q300 300 322 270L322 216Z', { fill: sk[0] }) + Pa('M278 228Q300 262 322 228L322 246Q300 276 278 248Z', { fill: sk[1] }) +
      outfit(c) + R(100, 250, 400, 760, { fill: 'url(#' + id + 's)', 'clip-path': 'url(#' + id + 'c)' });
    var head = both(El(241, 170, 8, 15, { fill: sk[0] }) + Pa('M240 162Q236 170 241 178', S(sk[1], 2))) +
      Pa(FACE_D, { fill: sk[0] }) + Pa(FACE_D, { fill: 'url(#' + id + 'f)' }) +
      Pa('M300 184q-5 12 0 17', S(sk[1], 2.2)) + Pa('M293 202q7 4 12 0', S(sk[1], 1.6, 0.8)) +
      faceGroups(face, function (f) { return faceFeatures(f, c, sk); }) +
      (hood ? hoodFront(c, main) : hairFront(c)) + (c.glasses ? glasses() : '') + (c.hat && !hood ? hat(c) : '');
    return spriteRoot(c, defs + G(G(G(back, { transform: HEAD_T }) + G(body, { transform: BODY_T }) + G(head, { transform: HEAD_T }), { transform: FIG_T }), { filter: 'url(#vnf-rim)' }), { 'data-face': face, 'data-clothes': c.clothes, 'data-hair': c.hair });
  }

  /* ------------------------------------------------------------ the reader, seen from behind */

  function player(decl) {
    var c = normCast(decl), sk = SKIN[c.skin - 1], col = hsl(c.hue, 26, 30), hairD = c.hairDark;
    var inner = Pa('M40 1000L70 800C90 720 190 690 250 680L350 680C410 690 510 720 530 800L560 1000Z', { fill: K.gradient ? col : col }) +
      Pa('M250 680Q300 720 350 680L340 640L260 640Z', { fill: sk[1] }) +
      Pa('M70 800C90 720 190 690 250 680', S(lt(col, 0.5), 4, 0.6)) +
      (c.hair === 'none' ? El(300, 540, 118, 138, { fill: sk[1] })
        : c.hair === 'hood' ? Pa('M150 720C120 520 200 380 300 380C400 380 480 520 450 720Z', { fill: dk(col, 0.1) })
          : Pa('M176 560C170 450 230 392 300 392C370 392 430 450 424 560C430 ' + (c.hair === 'long' ? '760 440 860 400 900L200 900C160 860 170 760' : c.hair === 'bob' ? '640 420 690 390 706L210 706C180 690 170 640' : '620 404 664 372 676L228 676C196 664 170 620') + ' 176 560Z', { fill: c.hairCol })) +
      (c.hair !== 'none' && c.hair !== 'hood' ? Pa('M212 470Q300 400 388 470', S(c.hairLight, 6, 0.3)) + Pa('M196 560Q190 470 240 420', S(lt(hairD, 0.6), 4, 0.5)) : '') +
      (c.hair === 'bun' ? Ci(300, 384, 46, { fill: c.hairCol }) : '') +
      (c.hair === 'ponytail' ? Pa('M280 560C270 660 290 760 300 840C316 760 330 660 320 560Z', { fill: c.hairCol }) : '') +
      (c.hat ? Pa('M168 500C160 400 250 360 300 360C350 360 440 400 432 500C390 470 210 470 168 500Z', { fill: hsl(c.hue, 30, 22) }) : '');
    return spriteRoot(c, G(inner, { filter: 'url(#vnf-rim)' }) + R(0, 700, 600, 300, { fill: 'none' }), { 'data-face': 'back' });
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

  function insideBody(x, y) {
    var dx = x - 300, dy = y - 152;
    if ((dx * dx) / (56 * 56) + (dy * dy) / (84 * 84) <= 1) return true;
    if (y >= 226 && y < 276) return Math.abs(dx) <= 20;
    if (y >= 276 && y < 320) return Math.abs(dx) <= 30 + (y - 276) * 2.2;
    if (y >= 320 && y <= 1000) { var half = y < 420 ? 140 : y < 560 ? 140 - (y - 420) * 0.1 : 126 + (y - 560) * 0.02; return Math.abs(dx) <= half; }
    return false;
  }
  function latticePoints(c, dense) {
    var r = K.rngFor(c.name + ':lattice'), pts = [], step = dense ? 30 : 52, jit = dense ? 4 : 19;
    for (var y = 84; y <= 990; y += step) for (var x = 150 + (dense && Math.round(y / step) % 2 ? step / 2 : 0); x <= 450; x += step) {
      var px = x + (r() - 0.5) * 2 * jit, py = y + (r() - 0.5) * 2 * jit;
      if (py > 300 && insideBody(px, py) && Math.abs(px - 300) < 128) pts.push([px, py]);
    }
    var edges = [], thr = step * (dense ? 1.2 : 1.5);
    for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
      var ddx = pts[i][0] - pts[j][0], ddy = pts[i][1] - pts[j][1];
      if (Math.sqrt(ddx * ddx + ddy * ddy) <= thr) edges.push([i, j, 0]);
    }
    if (!dense) for (var k = 0; k < 9 && pts.length > 2; k++) { var a = Math.floor(r() * pts.length), b = Math.floor(r() * pts.length); if (a !== b) edges.push([a, b, 1]); }
    return { pts: pts, edges: edges };
  }
  var LEXPR = {
    neutral: { h: 5 }, smile: { arc: 1, mouth: 'M288 208Q300 218 312 208' }, puzzled: { h: 5, tilt: 4, ring: true }, worried: { h: 5, tilt: -3, mouth: 'M291 214Q300 208 309 214' },
    surprised: { h: 9, mouthO: true }, thinking: { h: 4, look: [4, -3] }, deadpan: { h: 2 }, laugh: { arc: 1, mouth: 'M286 206Q300 226 314 206Z', fillMouth: true }
  };
  function lattice(decl, face, opts) {
    var c = normCast(decl);
    face = normFace(face);
    var dense = opts && typeof opts.dense === 'boolean' ? opts.dense : c.lattice === 'dense';
    var h = c.hue, id = 'vl' + K.hash(c.name + '|' + h).toString(36), hi = hsl(h, 90, 88), mid = hsl(h, 85, 68), deep = hsl(h, 75, 48);
    var sil = '<path transform="' + HEAD_T + '" d="' + FACE_D + '"/>' + G(Pa('M278 216L278 272Q300 296 322 272L322 216Z') + Pa(TORSO_D) + both(Pa(ARM_D)), { transform: BODY_T });
    var defs = K.defs('<linearGradient id="' + id + 'b" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="1000"><stop offset="0" stop-color="#ffffff"/><stop offset="0.2" stop-color="' + hi + '"/><stop offset="0.55" stop-color="' + mid + '"/><stop offset="1" stop-color="' + deep + '"/></linearGradient>' +
      K.gradient(id + 'h', [[0, '#ffffff', 0.95], [0.3, hi, 0.6], [1, mid, 0]], { radial: true, r: '50%' }));
    var r = K.rngFor(c.name + ':hair'), strands = '';
    // hair of light: long filaments streaming from the crown
    for (var s = 0; s < 22; s++) {
      var side = s % 2 ? 1 : -1, sx = 300 + side * (10 + r() * 50), ex = 300 + side * (90 + r() * 170), ey = 380 + r() * 420, bend = 60 + r() * 90;
      strands += '<path d="M' + num(sx) + ' ' + num(74 + r() * 20) + 'C' + num(sx + side * bend) + ' ' + num(70 + r() * 40) + ' ' + num(ex + side * 30) + ' ' + num(ey - 240) + ' ' + num(ex) + ' ' + num(ey) + '" stroke-width="' + num(0.8 + r() * 2.2) + '" stroke-opacity="' + num(0.25 + r() * 0.5) + '"/>';
    }
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
      [272, 328].forEach(function (cx, n) {
        var t = (x.tilt || 0) * (n ? 1 : -1);
        if (x.arc) o += Pa('M' + (cx - 13) + ' 168Q' + cx + ' 155 ' + (cx + 13) + ' 168', S('#ffffff', 4));
        else o += El(cx + lx, 166 + ly, 11, x.h, { fill: '#ffffff', transform: t ? 'rotate(' + t + ' ' + cx + ' 166)' : null });
      });
      if (x.ring) o += Ci(300, 150, 108, S(hi, 2, 0.5)) + Ci(300, 150, 126, S(hi, 1.2, 0.3));
      if (x.mouthO) o += El(300, 214, 5, 7, S('#ffffff', 2.5));
      else if (x.mouth) o += Pa(x.mouth, x.fillMouth ? { fill: '#ffffff', opacity: 0.9 } : S('#ffffff', 2.6));
      return G(o, { filter: 'url(#vnf-glow)' });
    });
    var inner = defs +
      G(sil, { fill: mid, opacity: 0.55, filter: 'url(#vnf-b30)' }) +
      G(strands, { fill: 'none', stroke: hi, 'stroke-linecap': 'round', filter: 'url(#vnf-glow)' }) +
      G(sil, { fill: 'url(#' + id + 'b)', opacity: 0.8 }) +
      Pa(lines, S(hi, dense ? 0.9 : 1.3, dense ? 0.45 : 0.55)) + G(arcs, S('#ffffff', 1.4, 0.6, { filter: 'url(#vnf-glow)' })) +
      G(bright, { filter: 'url(#vnf-b4)' }) + G(nodes, { 'class': 'vn-lattice-nodes' }) +
      Ci(300, 430, 150, { fill: 'url(#' + id + 'h)', opacity: 0.75 }) + Ci(300, 430, 9, F('#ffffff', 0.95, { filter: 'url(#vnf-glow)' })) +
      G(El(300, 150, 120, 130, { fill: 'url(#' + id + 'h)', opacity: 0.4 }) + faces, { transform: HEAD_T });
    return spriteRoot(c, G(inner, { transform: FIG_T }), { 'data-face': face, 'data-lattice': dense ? 'dense' : 'sparse' });
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
