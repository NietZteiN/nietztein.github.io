/* film.js - Ghost Commit Player
 *
 * Two halves:
 *   1. Pure data functions (parse a repo spec, normalise GitHub API responses, turn a commit list
 *      into film frames, compute stats, lay out a squarified treemap). These have no DOM
 *      dependency and are exported for Node so they can be tested with a mocked API response.
 *   2. Projector: a canvas renderer that animates the treemap between frames.
 *
 * The projector's monitor ideas (vignette, flash cut, title card, roundRect helper, escapeHtml and
 * the ease-in-out curve) are adapted from misc/08-git-film-timeline/index.html on this same site,
 * which replays one bundled repo as an editing timeline. This page generalises that to any public
 * repo and draws the tree instead of clips.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GhostFilm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------------------ helpers
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  const easeInOut = u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const firstLine = m => String(m || '').split(/\r?\n/)[0].trim() || '(no message)';

  // Lines of a file are the unit of size. Baseline trees come in bytes; ~40 bytes per line is a
  // rough but serviceable conversion so both sources share a scale.
  const BYTES_PER_LINE = 40;

  // ------------------------------------------------------------------ repo spec
  /** Accepts "owner/repo", "github.com/owner/repo", full https URLs (with or without .git or a
   *  trailing /tree/... path) and git@github.com:owner/repo.git. Returns null when unparsable. */
  function parseRepoSpec(text) {
    let s = String(text || '').trim();
    if (!s) return null;
    s = s.replace(/^git@github\.com:/i, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
    if (/^[a-z]+:\/\//i.test(s)) return null;   // some other host
    const m = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[\/#?].*)?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2], full: m[1] + '/' + m[2] };
  }

  // ------------------------------------------------------------------ normalising API data
  /** One item of GET /repos/{o}/{r}/commits -> compact commit record (no file details yet). */
  function normalizeListItem(item) {
    const c = item.commit || {};
    const who = c.author || c.committer || {};
    const date = who.date || '';
    const message = c.message || '';
    return {
      sha: item.sha,
      short: String(item.sha || '').slice(0, 7),
      message: message,
      title: firstLine(message),
      author: (item.author && item.author.login) || who.name || 'unknown',
      name: who.name || '',
      date: date,
      t: Math.round(Date.parse(date) / 1000) || 0,
      parents: (item.parents || []).map(p => p.sha),
      files: null,
      stats: null,
    };
  }

  /** Trim GET /repos/{o}/{r}/commits/{sha} down to what the film needs. */
  function normalizeDetail(detail) {
    const st = detail.stats || {};
    return {
      files: (detail.files || []).map(f => ({
        path: f.filename,
        status: f.status || 'modified',
        additions: f.additions | 0,
        deletions: f.deletions | 0,
        previous: f.previous_filename || null,
      })),
      stats: { additions: st.additions | 0, deletions: st.deletions | 0 },
    };
  }

  /** Trim GET /repos/{o}/{r}/git/trees/{sha}?recursive=1 to blobs, keeping at most `cap` largest. */
  function normalizeTree(tree, cap) {
    cap = cap || 2500;
    const blobs = (tree.tree || []).filter(e => e.type === 'blob').map(e => ({ path: e.path, size: e.size | 0 }));
    const total = blobs.length;
    if (blobs.length > cap) blobs.sort((a, b) => b.size - a.size).splice(cap);
    return { files: blobs, total: total, truncated: !!tree.truncated || total > cap };
  }

  // ------------------------------------------------------------------ commits -> frames
  /**
   * data = { repo: {...}, commits: [chronological normalised commits], baseline: null | [{path,size}] }
   * Returns { repo, frames, baseline, opening, touched, stats }.
   * Each frame: { i, commit, detailed, events:[{path, kind:add|mod|del|ren, from, lines, add, del}], files, lines }
   * Only commits with file details produce events; the others still get an intertitle.
   */
  function buildFilm(data) {
    const tree = new Map();
    if (data.baseline) for (const b of data.baseline) tree.set(b.path, Math.max(1, Math.round(b.size / BYTES_PER_LINE)));
    const opening = tree.size;
    const touched = new Set();
    const frames = data.commits.map((c, i) => {
      const events = [];
      if (c.files) {
        for (const f of c.files) {
          const delta = f.additions - f.deletions;
          let kind = null;
          if (f.status === 'removed') {
            if (tree.has(f.path)) { tree.delete(f.path); kind = 'del'; }
          } else if (f.status === 'renamed' && f.previous) {
            const old = tree.has(f.previous) ? tree.get(f.previous) : Math.max(1, f.additions);
            tree.delete(f.previous);
            tree.set(f.path, Math.max(1, old + delta));
            kind = 'ren';
          } else if (f.status === 'added' || f.status === 'copied' || !tree.has(f.path)) {
            tree.set(f.path, Math.max(1, f.additions));
            kind = 'add';
          } else {
            tree.set(f.path, Math.max(1, tree.get(f.path) + delta));
            kind = 'mod';
          }
          if (kind) events.push({ path: f.path, kind: kind, from: kind === 'ren' ? f.previous : null, lines: tree.get(f.path) || 0, add: f.additions, del: f.deletions });
          touched.add(f.path);
        }
      }
      let total = 0;
      for (const v of tree.values()) total += v;
      return { i: i, commit: c, detailed: !!c.files, events: events, files: tree.size, lines: total };
    });
    return {
      repo: data.repo,
      frames: frames,
      baseline: data.baseline || null,
      opening: opening,
      touched: touched.size,
      detailed: frames.filter(f => f.detailed).length,
      stats: computeStats(data.commits, touched.size),
    };
  }

  /** Replays events into a live Map path -> {lines, born, touched}; caches forward progress. */
  function treeWalker(film) {
    let idx = -1, map = new Map();
    const reset = () => {
      idx = -1; map = new Map();
      if (film.baseline) for (const b of film.baseline) map.set(b.path, { lines: Math.max(1, Math.round(b.size / BYTES_PER_LINE)), born: -1, touched: -1 });
    };
    const apply = frame => {
      for (const e of frame.events) {
        if (e.kind === 'del') map.delete(e.path);
        else if (e.kind === 'ren') {
          const old = map.get(e.from); map.delete(e.from);
          map.set(e.path, { lines: e.lines, born: old ? old.born : frame.i, touched: frame.i });
        } else if (e.kind === 'add') map.set(e.path, { lines: e.lines, born: frame.i, touched: frame.i });
        else { const cur = map.get(e.path); map.set(e.path, { lines: e.lines, born: cur ? cur.born : frame.i, touched: frame.i }); }
      }
    };
    reset();
    return {
      at(i) {
        i = clamp(i, -1, film.frames.length - 1);
        if (i < idx) reset();
        while (idx < i) { idx++; apply(film.frames[idx]); }
        return map;
      },
    };
  }
  /** Convenience: a fresh Map of the tree state after frame i (i = -1 gives the opening tree). */
  function stateAt(film, i) { return new Map(treeWalker(film).at(i)); }

  // ------------------------------------------------------------------ stats
  function computeStats(commits, filesTouched) {
    const n = commits.length;
    if (!n) return { commits: 0, contributors: [], top: [], busiestDay: null, longestGap: null, weeks: [], span: null, filesTouched: 0 };
    const byAuthor = new Map(), byDay = new Map();
    for (const c of commits) {
      byAuthor.set(c.author, (byAuthor.get(c.author) || 0) + 1);
      const day = c.date.slice(0, 10) || '?';
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    const contributors = [...byAuthor].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const busiest = [...byDay].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    // gaps and weekly buckets use time order, which can differ from branch order
    const byTime = commits.slice().sort((a, b) => a.t - b.t);
    let longest = null;
    for (let i = 1; i < byTime.length; i++) {
      const g = byTime[i].t - byTime[i - 1].t;
      if (!longest || g > longest.seconds) longest = { seconds: g, from: byTime[i - 1], to: byTime[i] };
    }
    const t0 = byTime[0].t, t1 = byTime[byTime.length - 1].t, WEEK = 7 * 86400;
    let nWeeks = Math.max(1, Math.floor((t1 - t0) / WEEK) + 1);
    const per = Math.max(1, Math.ceil(nWeeks / 160));           // group weeks when the range is very long
    const bins = Math.ceil(nWeeks / per);
    const weeks = Array.from({ length: bins }, (_, k) => ({ start: t0 + k * per * WEEK, count: 0 }));
    for (const c of byTime) { const k = Math.min(bins - 1, Math.floor((c.t - t0) / (WEEK * per))); weeks[k].count++; }
    return {
      commits: n,
      contributors: contributors,
      top: contributors.slice(0, 5),
      busiestDay: { day: busiest[0], count: busiest[1] },
      longestGap: longest,
      weeks: weeks,
      weeksPerBin: per,
      span: { from: byTime[0].date, to: byTime[byTime.length - 1].date },
      filesTouched: filesTouched | 0,
    };
  }

  function formatGap(seconds) {
    if (seconds == null) return '-';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min';
    if (seconds < 2 * 86400) return (seconds / 3600).toFixed(1) + ' h';
    if (seconds < 90 * 86400) return Math.round(seconds / 86400) + ' days';
    return (seconds / 86400 / 30.44).toFixed(1) + ' months';
  }

  // ------------------------------------------------------------------ treemap
  /** Weight of a file in the treemap: log-scaled lines so one huge file does not swallow the frame. */
  const weightOf = lines => 1 + Math.log2(1 + Math.max(0, lines));

  function buildHierarchy(state) {
    const root = { name: '', path: '', dirs: new Map(), files: [], weight: 0, depth: 0 };
    for (const [path, rec] of state) {
      const parts = path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        let next = node.dirs.get(parts[i]);
        if (!next) { next = { name: parts[i], path: node.path ? node.path + '/' + parts[i] : parts[i], dirs: new Map(), files: [], weight: 0, depth: node.depth + 1 }; node.dirs.set(parts[i], next); }
        node = next;
      }
      node.files.push({ path: path, name: parts[parts.length - 1], lines: rec.lines, weight: weightOf(rec.lines) });
    }
    (function sum(node) {
      let w = 0;
      for (const f of node.files) w += f.weight;
      for (const d of node.dirs.values()) w += sum(d);
      node.weight = w; return w;
    })(root);
    return root;
  }

  /** Squarified treemap (Bruls, Huizing, van Wijk). items need .weight; place(item, x, y, w, h). */
  function squarify(items, x, y, w, h, place) {
    if (!items.length || w <= 0 || h <= 0) return;
    const total = items.reduce((s, it) => s + it.weight, 0) || 1;
    const scale = (w * h) / total;
    const areas = items.map(it => ({ it: it, area: it.weight * scale }));
    let rx = x, ry = y, rw = w, rh = h;
    let row = [];
    const worst = (r, side) => {
      let sum = 0, mx = 0, mn = Infinity;
      for (const a of r) { sum += a.area; mx = Math.max(mx, a.area); mn = Math.min(mn, a.area); }
      const s2 = side * side, sum2 = sum * sum;
      return Math.max(s2 * mx / sum2, sum2 / (s2 * mn));
    };
    const layRow = r => {
      const sum = r.reduce((s, a) => s + a.area, 0);
      if (rw >= rh) {                       // column on the left
        const cw = sum / rh; let yy = ry;
        for (const a of r) { const ch = a.area / cw; place(a.it, rx, yy, cw, ch); yy += ch; }
        rx += cw; rw -= cw;
      } else {                              // row across the top
        const ch = sum / rw; let xx = rx;
        for (const a of r) { const cw = a.area / ch; place(a.it, xx, ry, cw, ch); xx += cw; }
        ry += ch; rh -= ch;
      }
    };
    for (const a of areas) {
      if (!row.length) { row.push(a); continue; }
      const side = Math.min(rw, rh);
      if (worst(row, side) >= worst(row.concat(a), side)) row.push(a);
      else { layRow(row); row = [a]; }
    }
    if (row.length) layRow(row);
  }

  /**
   * Lays out the tree state in rect {x,y,w,h}. Returns { files:[{path,name,top,x,y,w,h,lines}],
   * dirs:[{path,name,depth,x,y,w,h,label}] }. Top-level directories get a label bar when roomy.
   */
  function layoutTreemap(state, rect, opts) {
    opts = opts || {};
    const LABEL_H = opts.labelH || 14, PAD = opts.pad == null ? 2 : opts.pad;
    const out = { files: [], dirs: [] };
    const root = buildHierarchy(state);
    (function lay(node, x, y, w, h) {
      const kids = [...node.dirs.values()].concat(node.files).sort((a, b) => b.weight - a.weight);
      squarify(kids, x, y, w, h, (kid, kx, ky, kw, kh) => {
        if (kid.dirs) {
          const label = kid.depth === 1 && kw > 46 && kh > LABEL_H + 18;
          out.dirs.push({ path: kid.path, name: kid.name, depth: kid.depth, x: kx, y: ky, w: kw, h: kh, label: label });
          const ix = kx + PAD, iy = ky + PAD + (label ? LABEL_H : 0);
          lay(kid, ix, iy, Math.max(0, kw - 2 * PAD), Math.max(0, kh - 2 * PAD - (label ? LABEL_H : 0)));
        } else {
          out.files.push({ path: kid.path, name: kid.name, top: kid.path.includes('/') ? kid.path.split('/')[0] : '', x: kx, y: ky, w: kw, h: kh, lines: kid.lines });
        }
      });
    })(root, rect.x, rect.y, rect.w, rect.h);
    return out;
  }

  // ------------------------------------------------------------------ projector (canvas)
  // Categorical palette for top-level directories (six slots, validated for colour-vision deficiency
  // against the dark surface); slots are assigned in order of first appearance, never cycled, and any
  // further directory folds into the neutral. The directory label is the second cue, so colour never
  // carries identity alone.
  const DIR_COLOURS = ['#3987e5', '#d95926', '#199e70', '#8b6fd6', '#c98500', '#d55181'];
  const ROOT_COLOUR = '#8a857a';
  const EVENT_COLOURS = { add: '#6fd08a', mod: '#f2c14e', del: '#e8635a', ren: '#7fc7ff' };
  const FADE_MS = 900, MOVE_MS = 450, FLASH_MS = 1600;
  const TOP_INSET = 20;   // strip at the top of the screen kept free for the reel marker and timecode

  /** Map top-level directory -> colour slot in order of first appearance across the whole film. */
  function assignColours(film) {
    const slots = new Map();
    const see = path => { const i = path.indexOf('/'); if (i < 0) return; const top = path.slice(0, i); if (!slots.has(top)) slots.set(top, slots.size < DIR_COLOURS.length ? DIR_COLOURS[slots.size] : ROOT_COLOUR); };
    if (film.baseline) film.baseline.slice().sort((a, b) => b.size - a.size).forEach(b => see(b.path));
    for (const f of film.frames) for (const e of f.events) see(e.path);
    return slots;
  }
  function colourFor(slots, top) { return (top && slots && slots.get(top)) || ROOT_COLOUR; }

  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; }

  function Projector(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = new Map();       // path -> animated block
    this.dirs = [];
    this.film = null;
    this.walker = null;
    this.index = -1;
    this.hover = null;
    this.w = 0; this.h = 0;
    this.lastDraw = 0;
    this.lastEvents = [];
    this.showLabels = true;
  }

  Projector.prototype.setFilm = function (film) {
    this.film = film; this.walker = film ? treeWalker(film) : null;
    this.slots = film ? assignColours(film) : new Map();
    this.items.clear(); this.dirs = []; this.index = -1; this.lastEvents = [];
  };

  /** Match the backing store to the CSS size and re-layout at the current frame. */
  Projector.prototype.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(10, Math.round(r.width)); this.h = Math.max(10, Math.round(r.height));
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.film && this.index >= -1) this.show(this.index, false);
  };

  /** Show the tree after frame i. animate=true fades new blocks in, flashes the frame's events. */
  Projector.prototype.show = function (i, animate) {
    if (!this.film) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const state = this.walker.at(i);
    const layout = layoutTreemap(state, { x: 0, y: TOP_INSET, w: this.w, h: Math.max(10, this.h - TOP_INSET) });
    const seen = new Set();
    for (const f of layout.files) {
      seen.add(f.path);
      let it = this.items.get(f.path);
      if (!it) {
        it = { path: f.path, name: f.name, x: f.x, y: f.y, w: f.w, h: f.h, alpha: animate ? 0 : 1, born: now, kind: null, flash: 0, dying: 0 };
        this.items.set(f.path, it);
      } else if (!animate) { it.x = f.x; it.y = f.y; it.w = f.w; it.h = f.h; it.alpha = 1; it.kind = null; }
      if (it.dying) { it.dying = 0; it.alpha = Math.max(it.alpha, 0.01); it.born = now; }
      it.tx = f.x; it.ty = f.y; it.tw = f.w; it.th = f.h;
      it.lines = f.lines; it.top = f.top; it.colour = colourFor(this.slots, f.top);
    }
    for (const [p, it] of this.items) {
      if (!seen.has(p)) { if (!animate) this.items.delete(p); else if (!it.dying) it.dying = now; }
    }
    const frame = i >= 0 ? this.film.frames[i] : null;
    this.lastEvents = frame ? frame.events : [];
    if (animate && frame) {
      for (const e of frame.events) {
        const it = this.items.get(e.path);
        if (it) { it.kind = e.kind; it.flash = now; }
      }
    }
    this.dirs = layout.dirs;
    this.index = i;
    this.fileCount = state.size;
  };

  /** Draw one animation frame. Returns true while something is still moving. */
  Projector.prototype.draw = function (now) {
    const ctx = this.ctx, W = this.w, H = this.h;
    if (!W || !H) return false;
    const dt = this.lastDraw ? Math.min(100, now - this.lastDraw) : 16;
    this.lastDraw = now;
    const k = 1 - Math.exp(-dt / (MOVE_MS / 4));
    let busy = false;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0908';
    ctx.fillRect(0, 0, W, H);

    if (!this.film) return false;

    // directories: faint boxes, labelled at the top level
    for (const d of this.dirs) {
      if (d.w < 2 || d.h < 2) continue;
      ctx.fillStyle = d.depth === 1 ? 'rgba(255,240,210,0.045)' : 'rgba(255,240,210,0.02)';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      if (d.label && this.showLabels) {
        ctx.fillStyle = 'rgba(241,227,194,0.78)';
        ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textBaseline = 'top';
        ctx.fillText(fitText(ctx, d.name + '/', d.w - 8), d.x + 4, d.y + 2);
      }
    }

    // files
    ctx.textBaseline = 'middle';
    for (const [p, it] of this.items) {
      // motion
      it.x += (it.tx - it.x) * k; it.y += (it.ty - it.y) * k; it.w += (it.tw - it.w) * k; it.h += (it.th - it.h) * k;
      if (Math.abs(it.tx - it.x) > 0.3 || Math.abs(it.tw - it.w) > 0.3 || Math.abs(it.ty - it.y) > 0.3 || Math.abs(it.th - it.h) > 0.3) busy = true;
      // fade
      if (it.dying) {
        it.alpha = 1 - (now - it.dying) / FADE_MS;
        if (it.alpha <= 0) { this.items.delete(p); continue; }
        busy = true;
      } else if (it.alpha < 1) { it.alpha = Math.min(1, (now - it.born) / FADE_MS); busy = true; }
      // colour: base by directory, tinted by the last event while the flash lasts
      let fill = it.colour;
      const age = now - it.flash;
      if (it.kind && age < FLASH_MS) {
        const t = it.kind === 'mod' ? 0.75 * (0.5 + 0.5 * Math.cos(age / 130)) * (1 - age / FLASH_MS) : 0.85 * (1 - age / FLASH_MS);
        fill = mix(it.colour, EVENT_COLOURS[it.kind], Math.max(0, t));
        busy = true;
      } else if (it.dying) fill = mix(it.colour, EVENT_COLOURS.del, 0.7);
      const gap = it.w > 6 && it.h > 6 ? 1 : 0.5;
      const bw = Math.max(0.5, it.w - gap), bh = Math.max(0.5, it.h - gap);
      ctx.globalAlpha = 0.92 * clamp(it.alpha, 0, 1);
      ctx.fillStyle = fill;
      roundRect(ctx, it.x + gap / 2, it.y + gap / 2, bw, bh, Math.min(2, bw / 2, bh / 2));
      ctx.fill();
      if (this.showLabels && bw > 44 && bh > 13) {
        ctx.globalAlpha = 0.9 * clamp(it.alpha, 0, 1);
        ctx.fillStyle = '#100e0a';
        ctx.font = (bh > 26 && bw > 90 ? '11px' : '9px') + ' ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.fillText(fitText(ctx, it.name, bw - 8), it.x + 5, it.y + bh / 2 + 0.5);
      }
    }
    ctx.globalAlpha = 1;

    // hover outline
    if (this.hover && this.items.has(this.hover)) {
      const it = this.items.get(this.hover);
      ctx.strokeStyle = '#f1e3c2'; ctx.lineWidth = 1.5;
      roundRect(ctx, it.x + 1, it.y + 1, Math.max(1, it.w - 2), Math.max(1, it.h - 2), 2);
      ctx.stroke();
    }
    return busy;
  };

  /** Which file block is under CSS-pixel point (x, y), or null. */
  Projector.prototype.hitTest = function (x, y) {
    let best = null;
    for (const it of this.items.values()) {
      if (it.dying) continue;
      if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) best = it;
    }
    return best;
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
    return lo > 0 ? text.slice(0, lo) + '…' : '';
  }

  return {
    parseRepoSpec, normalizeListItem, normalizeDetail, normalizeTree,
    buildFilm, treeWalker, stateAt, computeStats, formatGap,
    layoutTreemap, squarify, weightOf, colourFor, assignColours, DIR_COLOURS, EVENT_COLOURS,
    Projector, escapeHtml, easeInOut, firstLine, BYTES_PER_LINE,
  };
});
