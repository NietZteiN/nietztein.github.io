/* Reading Room: hand-drawn vector props for the 53 non-book objects.
 *
 * Every sprite draws into a box [0,w] x [0,h] whose origin is the bottom-left
 * corner and whose y axis points UP (the caller's transform flips it), in the
 * same units as the shelves: w in tiles (~40 cm), h in height units (~40 cm).
 * `lod` is the number of device pixels per tile so sprites can skip detail
 * when they are a few pixels wide.
 */
window.ReadingRoomSprites = (function () {
  'use strict';

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
  function circle(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function poly(ctx, pts, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  // circles in a sheared/anisotropic transform: draw with explicit ellipse in
  // box units so they look right whatever the caller's scale is.
  function disc(ctx, x, y, rw, rh, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Which prop a catalogue object becomes, keyed by words in its title.
  function kindOf(o) {
    var t = o.t || '';
    if (/Quest|headset/i.test(t)) return 'headset';
    if (/trophies|medal/i.test(t)) return /monkey/i.test(t) ? 'trophies_monkey' : 'medals';
    if (/Catan/i.test(t) || o.ty === 'Games') return 'boardgame';
    if (/Pok.mon card/i.test(t)) return 'cardbox';
    if (/notebook/i.test(t)) return /two /i.test(t) ? 'notebook2' : 'notebook';
    if (/calculator/i.test(t)) return 'calcbox';
    if (/umbrella/i.test(t)) return 'pouchset';
    if (/pouch/i.test(t)) return 'pouch';
    if (/honor cords/i.test(t)) return 'cords';
    if (/ema-style|plaque/i.test(t)) return 'ema';
    if (/Photo Paper/i.test(t)) return 'paperpack';
    if (/papers|pages/i.test(t)) return 'papers';
    if (/folder|binder/i.test(t)) return 'folder';
    if (/cottage|ornament/i.test(t)) return 'cottage';
    if (/pin badge/i.test(t)) return 'pin';
    if (/disc cleaner/i.test(t)) return 'cleaner';
    if (/\(CD\)|CD\)|CD$|ドラマCD|Live \(CD/i.test(t)) return 'cd';
    if (/\(DVD\)|\(DVD,|Casablanca/.test(t)) return 'dvd';
    if (/Limited|限定|Premium|Anniversary|boxed|Box\b/i.test(t)) return 'vnbox_big';
    if (o.ty === 'Game' || o.ty === 'Media') return 'vnbox';
    return 'box';
  }

  // Footprint on the shelf: [width in tiles, height in units].
  var SIZE = {
    headset: [0.34, 0.3], medals: [0.42, 0.62], trophies_monkey: [0.6, 0.62], boardgame: [0.6, 0.26],
    cardbox: [0.32, 0.46], notebook: [0.05, 0.56], notebook2: [0.1, 0.56], calcbox: [0.12, 0.32],
    pouchset: [0.46, 0.5], pouch: [0.2, 0.24], cords: [0.26, 0.66], folder: [0.045, 0.62],
    cottage: [0.22, 0.26], pin: [0.08, 0.08], paperpack: [0.075, 0.36], ema: [0.46, 0.42],
    papers: [0.32, 0.14], cleaner: [0.05, 0.32], cd: [0.035, 0.31], dvd: [0.04, 0.48],
    vnbox: [0.075, 0.5], vnbox_big: [0.12, 0.6], box: [0.12, 0.3],
  };

  var hueCache = {};
  function hueFor(o) {
    if (!(o.id in hueCache)) hueCache[o.id] = hash(o.t) % 360;
    return hueCache[o.id];
  }

  // ---- the props ----------------------------------------------------------

  function cd(ctx, w, h, lod) {
    rect(ctx, 0, 0, w, h, 'rgba(205,215,230,0.92)');
    rect(ctx, 0, 0, w * 0.3, h, 'rgba(255,255,255,0.6)');
    rect(ctx, 0, h * 0.2, w, h * 0.55, 'hsl(' + (lod | 0) % 360 + ',30%,70%)');
    if (lod * w > 4) disc(ctx, w / 2, h * 0.47, w * 0.3, h * 0.08, 'rgba(255,255,255,0.8)');
  }
  function dvd(ctx, w, h, lod, o) {
    rect(ctx, 0, 0, w, h, '#1c1c22');
    rect(ctx, 0, h * 0.15, w, h * 0.5, 'hsl(' + hueFor(o) + ',35%,48%)');
    if (lod * w > 4) rect(ctx, w * 0.2, h * 0.68, w * 0.6, h * 0.1, '#e8e8f0');
  }
  function vnbox(ctx, w, h, lod, o, big) {
    var hue = hueFor(o);
    rect(ctx, 0, 0, w, h, 'hsl(' + hue + ',40%,' + (big ? 92 : 86) + '%)');
    rect(ctx, 0, h * 0.3, w, h * 0.42, 'hsl(' + hue + ',55%,62%)');          // the cover art band
    rect(ctx, 0, h * 0.3, w, h * 0.42, 'rgba(255,255,255,0)');
    rect(ctx, w * 0.15, h * 0.76, w * 0.7, h * 0.14, 'hsl(' + hue + ',30%,30%)'); // title strip
    if (big) rect(ctx, 0, h * 0.2, w, h * 0.06, 'hsl(44,80%,60%)');            // gold limited band
    if (lod * w > 6) { rect(ctx, 0, 0, w * 0.08, h, 'rgba(0,0,0,0.18)'); rect(ctx, w * 0.92, 0, w * 0.08, h, 'rgba(255,255,255,0.25)'); }
  }
  function notebook(ctx, w, h, lod, o, color) {
    rect(ctx, 0, 0, w, h, color);
    rect(ctx, 0, 0, w * 0.35, h, 'rgba(0,0,0,0.2)');
    if (lod * w > 5) for (var i = 0.08; i < 0.95; i += 0.09) disc(ctx, w * 0.18, h * i, w * 0.14, h * 0.025, '#eee');
  }
  function notebookColor(o) {
    var t = o.t;
    if (/pink/i.test(t)) return '#e58aa6';
    if (/blue/i.test(t)) return '#4f7fc4';
    if (/plaid/i.test(t)) return '#9a4a4a';
    if (/black/i.test(t)) return '#2a2a2e';
    if (/cardboard/i.test(t)) return '#b48a5a';
    return '#5a6e8a';
  }
  function headset(ctx, w, h, lod) {
    rect(ctx, w * 0.1, 0, w * 0.8, h * 0.08, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#f0eee8'; ctx.beginPath();
    ctx.moveTo(w * 0.05, h * 0.2); ctx.lineTo(w * 0.95, h * 0.2); ctx.lineTo(w, h * 0.7); ctx.lineTo(w * 0.85, h * 0.9); ctx.lineTo(w * 0.15, h * 0.9); ctx.lineTo(0, h * 0.7); ctx.closePath(); ctx.fill();
    rect(ctx, w * 0.2, h * 0.85, w * 0.6, h * 0.12, '#c9c6bd');                 // strap
    if (lod * w > 8) { disc(ctx, w * 0.33, h * 0.55, w * 0.12, h * 0.18, '#2b2b33'); disc(ctx, w * 0.67, h * 0.55, w * 0.12, h * 0.18, '#2b2b33'); }
  }
  function medals(ctx, w, h, lod, o, withMonkey) {
    var mw = withMonkey ? w * 0.68 : w;
    // trophy
    rect(ctx, mw * 0.08, 0, mw * 0.34, h * 0.08, '#3a2a1a');
    rect(ctx, mw * 0.21, h * 0.08, mw * 0.08, h * 0.2, '#d9a63a');
    poly(ctx, [[mw * 0.1, h * 0.6], [mw * 0.4, h * 0.6], [mw * 0.34, h * 0.28], [mw * 0.16, h * 0.28]], '#e9bb4a');
    if (lod * w > 10) { rect(ctx, mw * 0.03, h * 0.45, mw * 0.08, h * 0.05, '#e9bb4a'); rect(ctx, mw * 0.39, h * 0.45, mw * 0.08, h * 0.05, '#e9bb4a'); }
    // medals on ribbons
    for (var i = 0; i < 2; i++) {
      var x = mw * (0.6 + i * 0.22);
      rect(ctx, x - mw * 0.03, h * 0.35, mw * 0.06, h * 0.65, i ? '#2d4f9a' : '#b83a3a');
      disc(ctx, x, h * 0.3, mw * 0.08, h * 0.08, i ? '#c0c0c8' : '#e2b53a');
    }
    if (withMonkey) {
      var ox = w * 0.7, bw = w * 0.3;
      disc(ctx, ox + bw * 0.5, h * 0.22, bw * 0.45, h * 0.22, '#1d1b1b');       // body
      disc(ctx, ox + bw * 0.5, h * 0.55, bw * 0.4, h * 0.2, '#1d1b1b');         // head
      disc(ctx, ox + bw * 0.5, h * 0.5, bw * 0.22, h * 0.1, '#c8a37a');         // face
      if (lod * w > 10) { disc(ctx, ox + bw * 0.14, h * 0.6, bw * 0.12, h * 0.06, '#1d1b1b'); disc(ctx, ox + bw * 0.86, h * 0.6, bw * 0.12, h * 0.06, '#1d1b1b'); }
    }
  }
  function boardgame(ctx, w, h, lod) {
    rect(ctx, w * 0.05, 0, w * 0.9, h * 0.18, '#4a5a7a');                      // notebooks lying flat
    rect(ctx, w * 0.08, h * 0.18, w * 0.84, h * 0.16, '#9a6a3a');
    rect(ctx, 0, h * 0.34, w, h * 0.5, '#c8742a');                             // Catan box
    rect(ctx, 0, h * 0.5, w, h * 0.2, '#2d6fa8');
    if (lod * w > 12) { rect(ctx, w * 0.15, h * 0.54, w * 0.7, h * 0.12, '#f4e2a8'); }
    rect(ctx, 0, h * 0.84, w, h * 0.06, 'rgba(0,0,0,0.25)');
  }
  function cardbox(ctx, w, h, lod) {
    rect(ctx, 0, 0, w * 0.18, h * 0.6, '#f0e6c8'); if (lod * w > 10) { disc(ctx, w * 0.09, h * 0.42, w * 0.06, h * 0.06, '#333'); }
    rect(ctx, w * 0.2, 0, w * 0.14, h * 0.85, '#1e1e22'); rect(ctx, w * 0.36, 0, w * 0.14, h * 0.85, '#1e1e22');
    rect(ctx, w * 0.54, 0, w * 0.46, h, '#2d5fb0'); rect(ctx, w * 0.6, h * 0.3, w * 0.34, h * 0.4, '#f5d94a');
  }
  function calcbox(ctx, w, h, lod) {
    rect(ctx, 0, 0, w, h, '#2f8a4a'); rect(ctx, w * 0.15, h * 0.35, w * 0.7, h * 0.3, '#e9efe4');
  }
  function pouch(ctx, w, h) {
    disc(ctx, w / 2, h * 0.45, w * 0.5, h * 0.45, '#d9475e');
    rect(ctx, w * 0.1, h * 0.75, w * 0.8, h * 0.08, '#ffd3dc');
    disc(ctx, w * 0.35, h * 0.4, w * 0.08, h * 0.08, '#ffb3c2'); disc(ctx, w * 0.65, h * 0.5, w * 0.08, h * 0.08, '#ffb3c2');
  }
  function pouchset(ctx, w, h, lod) {
    ctx.save(); ctx.translate(0, 0); pouch(ctx, w * 0.42, h * 0.5); ctx.restore();
    rect(ctx, w * 0.46, 0, w * 0.2, h * 0.2, '#f7a8c4');                        // sticky notes
    rect(ctx, w * 0.46, h * 0.2, w * 0.2, h * 0.04, '#ffd0e0');
    rect(ctx, w * 0.78, 0, w * 0.08, h, '#2c2c3c');                              // folded umbrella
    rect(ctx, w * 0.76, h * 0.9, w * 0.12, h * 0.1, '#6b4a2a');
  }
  function cords(ctx, w, h, lod) {
    rect(ctx, w * 0.7, 0, w * 0.3, h, '#1a1a1c');                                // black binder
    rect(ctx, w * 0.2, h * 0.1, w * 0.07, h * 0.9, '#e5832d');
    rect(ctx, w * 0.4, h * 0.1, w * 0.07, h * 0.9, '#20305f');
    rect(ctx, w * 0.17, 0, w * 0.13, h * 0.14, '#e5832d'); rect(ctx, w * 0.37, 0, w * 0.13, h * 0.14, '#20305f');
  }
  function folder(ctx, w, h, lod, o) {
    var c = /red/i.test(o.t) ? '#b8362f' : /pink/i.test(o.t) ? '#e58aa6' : '#242428';
    rect(ctx, 0, 0, w, h, c); rect(ctx, w * 0.6, 0, w * 0.4, h, 'rgba(255,255,255,0.12)');
  }
  function cottage(ctx, w, h, lod) {
    rect(ctx, w * 0.1, 0, w * 0.8, h * 0.55, '#f1d98a');
    poly(ctx, [[0, h * 0.55], [w, h * 0.55], [w * 0.5, h]], '#8a5a3a');
    if (lod * w > 10) { rect(ctx, w * 0.42, 0, w * 0.16, h * 0.3, '#6b3a2a'); disc(ctx, w * 0.22, h * 0.35, w * 0.08, h * 0.08, '#f2b134'); }
  }
  function pin(ctx, w, h) { disc(ctx, w / 2, h / 2, w / 2, h / 2, '#ff7fb0'); disc(ctx, w / 2, h / 2, w * 0.25, h * 0.25, '#ffe6f0'); }
  function paperpack(ctx, w, h) { rect(ctx, 0, 0, w, h, '#f2f2f2'); rect(ctx, 0, h * 0.3, w, h * 0.4, '#1f6fc0'); }
  function papers(ctx, w, h, lod) {
    for (var i = 0; i < 4; i++) rect(ctx, w * (0.02 * i), h * (0.18 * i), w * 0.6, h * 0.14, i % 2 ? '#f4f1ea' : '#e8e4da');
    rect(ctx, w * 0.62, 0, w * 0.38, h * 0.9, '#e58aa6');
  }
  function ema(ctx, w, h, lod) {
    for (var i = 0; i < 3; i++) rect(ctx, w * 0.02 * i, h * 0.12 * i, w * 0.4, h * 0.1, i % 2 ? '#f4f1ea' : '#e8e4da');
    poly(ctx, [[w * 0.45, 0], [w * 0.85, 0], [w * 0.85, h * 0.6], [w * 0.65, h * 0.85], [w * 0.45, h * 0.6]], '#c89a5a'); // ema plaque
    if (lod * w > 10) { disc(ctx, w * 0.65, h * 0.32, w * 0.09, h * 0.12, '#fff'); disc(ctx, w * 0.58, h * 0.5, w * 0.05, h * 0.05, '#e26d8a'); disc(ctx, w * 0.75, h * 0.2, w * 0.05, h * 0.05, '#e26d8a'); }
    rect(ctx, w * 0.88, 0, w * 0.12, h * 0.3, '#9fd3f7');                        // holographic card
  }
  function cleaner(ctx, w, h) { rect(ctx, 0, 0, w, h, '#9aa3b0'); rect(ctx, 0, h * 0.4, w, h * 0.2, '#e3e8ee'); }
  function genericBox(ctx, w, h) { rect(ctx, 0, 0, w, h, '#a98457'); rect(ctx, 0, h * 0.45, w, h * 0.1, '#c9a574'); }

  var DRAW = {
    cd: cd, dvd: dvd,
    vnbox: function (c, w, h, l, o) { vnbox(c, w, h, l, o, false); },
    vnbox_big: function (c, w, h, l, o) { vnbox(c, w, h, l, o, true); },
    notebook: function (c, w, h, l, o) { notebook(c, w, h, l, o, notebookColor(o)); },
    notebook2: function (c, w, h, l, o) { notebook(c, w * 0.48, h, l, o, '#5a6e8a'); c.save(); c.translate(w * 0.52, 0); notebook(c, w * 0.48, h * 0.95, l, o, '#7a5a8a'); c.restore(); },
    headset: headset, medals: function (c, w, h, l, o) { medals(c, w, h, l, o, false); },
    trophies_monkey: function (c, w, h, l, o) { medals(c, w, h, l, o, true); },
    boardgame: boardgame, cardbox: cardbox, calcbox: calcbox, pouch: pouch, pouchset: pouchset, cords: cords,
    folder: folder, cottage: cottage, pin: pin, paperpack: paperpack, papers: papers, ema: ema, cleaner: cleaner, box: genericBox,
  };

  function draw(ctx, kind, w, h, lod, o) { (DRAW[kind] || genericBox)(ctx, w, h, lod, o); }

  // A one-word caption for the shelf view.
  var LABEL = {
    cd: 'CD', dvd: 'DVD', vnbox: 'game box', vnbox_big: 'limited box', notebook: 'notebook', notebook2: 'notebooks',
    headset: 'VR headset', medals: 'medals', trophies_monkey: 'trophies, monkey', boardgame: 'board game', cardbox: 'notebooks, cards',
    calcbox: 'calculator', pouch: 'pouch', pouchset: 'pouch, umbrella', cords: 'honor cords', folder: 'folder', cottage: 'ornament',
    pin: 'pin badge', paperpack: 'photo paper', papers: 'papers', ema: 'ema, papers', cleaner: 'disc cleaner', box: 'box',
  };

  return { kindOf: kindOf, SIZE: SIZE, draw: draw, LABEL: LABEL, hash: hash };
})();
