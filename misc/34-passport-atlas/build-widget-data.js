// Dev script (Node, no deps): turns countries-110m.json into the compact coastline
// string embedded in widget.js. Run:  node build-widget-data.js
// It decodes the TopoJSON, simplifies each ring (Visvalingam), drops specks and
// writes the result into widget.js between the DATA_BEGIN / DATA_END markers.
'use strict';
const fs = require('fs');
const path = require('path');
const topo = JSON.parse(fs.readFileSync(path.join(__dirname, 'countries-110m.json'), 'utf8'));
const VISITED = ['840', '124', '484', '704', '276', '380', '056', '392'];
const HOME = '840';

// --- decode arcs ---
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
function ring(idx) {
  const pts = [];
  for (const i of idx) {
    const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
  }
  return pts;
}
function polys(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.arcs];
  if (geom.type === 'MultiPolygon') return geom.arcs;
  return [];
}
// --- simplify (Visvalingam-Whyatt) ---
function area3(a, b, c) { return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; }
function simplify(pts, thr) {
  pts = pts.slice(0, -1); // closed ring: last == first
  let changed = true;
  while (changed && pts.length > 4) {
    changed = false;
    let best = -1, bestA = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = area3(pts[(i + pts.length - 1) % pts.length], pts[i], pts[(i + 1) % pts.length]);
      if (a < bestA) { bestA = a; best = i; }
    }
    if (bestA < thr) { pts.splice(best, 1); changed = true; }
  }
  return pts;
}
function ringArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
// --- polyline-style encoding, 0.1 degree precision ---
function encNum(v) { let s = ''; v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); }
function encRing(pts) { let s = '', px = 0, py = 0; for (const [x, y] of pts) { const qx = Math.round(x * 10), qy = Math.round(y * 10); s += encNum(qx - px) + encNum(qy - py); px = qx; py = qy; } return s; }

const THR = 0.012;   // deg^2 triangle area threshold
const MINAREA = 0.08; // deg^2 ring area; tiny islands dropped (unless visited)
// Rings that run along the antimeridian (Eurasia, Fiji) are cut there into pieces so
// a flat projection never draws a line across the whole map. Antarctica is left out.
function splitAtAntimeridian(pts) {
  const pieces = [[]];
  for (let i = 0; i < pts.length; i++) {
    if (i && Math.abs(pts[i][0] - pts[i - 1][0]) > 180) pieces.push([]);
    pieces[pieces.length - 1].push(pts[i]);
  }
  if (pieces.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) <= 180) { pieces[0] = pieces.pop().concat(pieces[0]); }
  return pieces;
}
function build(geom, keepAll) {
  const out = [];
  for (const poly of polys(geom)) {
    const raw = ring(poly[0]);
    if (Math.max(...raw.map(p => p[1])) < -60) continue; // Antarctica
    const outer = simplify(raw, THR);
    if (outer.length < 3) continue;
    if (!keepAll && ringArea(outer) < MINAREA) continue;
    for (const piece of splitAtAntimeridian(outer)) if (piece.length >= 3) out.push(encRing(piece));
  }
  return out;
}
const land = build(topo.objects.land.geometries[0], false);
const visited = {};
for (const g of topo.objects.countries.geometries) if (VISITED.includes(g.id)) visited[g.id] = build(g, g.id === '840' ? false : true);
const data = { land, visited };
const json = JSON.stringify(data);
console.log('land rings', land.length, 'visited', Object.keys(visited).length, 'bytes', json.length);
const wpath = path.join(__dirname, 'widget.js');
if (fs.existsSync(wpath)) {
  const src = fs.readFileSync(wpath, 'utf8');
  const re = /(\/\* DATA_BEGIN \*\/)[\s\S]*?(\/\* DATA_END \*\/)/;
  if (re.test(src)) { fs.writeFileSync(wpath, src.replace(re, '$1 ' + json.replace(/\$/g, '$$$$') + ' $2')); console.log('widget.js updated'); }
}
