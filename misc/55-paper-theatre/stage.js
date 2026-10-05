/*
 * Paper Theatre - stage.js (browser only).
 *
 * The renderer: story picker (inside the kamishibai frame), then a full-bleed
 * visual-novel stage: per-story title screen, painted world (background, cast,
 * event CG, particles, colour grade, flashback), transitions, the ADV text
 * window with its quick menu, NVL pages, choices, chapter cards, boards, the
 * ending, six save slots, config, backlog, text-only transcript, deep links,
 * theme, keyboard and touch.
 *
 * Pure logic lives in vn.js (window.VN) and the procedural art in art.js
 * (window.VNArt, with art-scenes.js and art-cast.js). Both are optional at
 * load time: without VNArt the stage draws grey placeholders; without VN it
 * shows an "engine not loaded" panel instead of crashing.
 *
 * Every animated effect has a settled state: under reduced motion, ?autoplay,
 * ?thumb and Skip, transitions are cuts, particles stand still and text is
 * instant.
 *
 * Six more modules are optional and are only ever reached through ext():
 * score.js (VNScore), audio.js (VNAudio), paint.js (VNPaint), live.js (VNLive),
 * camera.js (VNCamera) and op.js (VNOp). Any of them may be missing or broken;
 * the stage plays on without it. Their contract is in OPS.md.
 */
(function () {
  'use strict';

  var VN = window.VN || null;
  var ART = window.VNArt || null;
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var CASTGRID = params.get('cast') === '1';
  var GALLERY = params.get('gallery');
  var DRAFTS = params.get('drafts') === '1';
  var AUTOPLAY = params.get('autoplay');   // test hook: advance N stops instantly; "end" runs to the end card. &pick=K takes option K at menus, &screen=save|load|config|log|chapters opens that screen
  var PICK = parseInt(params.get('pick'), 10) || 0;
  var HOOK_SCREEN = params.get('screen');
  var HOOK_CLICK = parseInt(params.get('click'), 10) || 0;   // test hook: Start, then N animated advances (typewriter, transitions, timers all live)
  var HOOK_TRANS = params.get('trans');    // test hook: with &autoplay=N, freeze that transition half-way into stop N
  var REDUCED = THUMB || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var STUDIO = params.get('studio') === '1';   // a live preview driven by the Studio page over BroadcastChannel('vn:studio'): nothing is saved
  var TESTRUN = THUMB || AUTOPLAY != null;     // a capture or a test run: every optional module rests unless its hook forces it on
  // test hooks: ?paint=1|0 &live=1|0 &camera=1|0 &op=1|0 switch that module on or off whatever the prefs and the
  // settled-state rule say; ?audio=0 switches the sound off (no unlock, no call into score.js or audio.js at all);
  // ?audio=1 lets the cue be computed and synced in a test run too (the sound is still never unlocked there)
  function hookOf(name) { var v = params.get(name); return v === '1' ? true : v === '0' ? false : null; }
  var FORCE = { paint: hookOf('paint'), live: hookOf('live'), camera: hookOf('camera'), op: hookOf('op'), audio: hookOf('audio') };
  var AUDIO_HOOK_OFF = FORCE.audio === false;
  var KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/';
  var DEFAULT_STORY = 'obfuscation';
  var SLOT_NAMES = ['left', 'center', 'right'];
  var DEFAULT_TR = { name: 'dissolve', ms: 600 };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function readJSON(k) { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } }
  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); });
  }
  function fetchJSON(url) { return fetchText(url).then(function (t) { return JSON.parse(t); }); }
  function hash32(s) { if (VN && VN.hash) return VN.hash(s); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // In the Studio preview the author's caret is in the editor around this frame: the stage never pulls the focus out of it.
  function mayFocus() { return !(STUDIO && !document.hasFocus()); }

  /* ------------------------------------------------------------------ DOM */

  var stage = $('#stage');
  var world = $('.vn-world'), bgEl = $('.vn-bg'), spritesEl = $('.vn-sprites'), cgEl = $('.vn-cgart'), fxEl = $('.vn-fxlayer'), fxBackEl = $('.vn-fxback');
  var transEl = $('.vn-trans'), flashEl = $('.vn-flash'), captionEl = $('.vn-caption');
  var boardsEl = $('.vn-boards');
  var box = $('.vn-box'), nameEl = $('.vn-name'), textEl = $('.vn-text');
  var nvlEl = $('.vn-nvl'), nvlPage = $('.vn-nvl-page');
  var live = $('.vn-live');
  var menuEl = $('.vn-menu');
  var quickEl = $('.vn-quick');
  var sceneEl = $('.vn-scene');
  var endEl = $('.vn-end');
  var titleEl = $('.vn-titlescreen');
  var screenEl = $('.vn-screen');
  var pickerEl = $('.vn-picker');
  var panelEl = $('.vn-panel');
  var badgesEl = $('.vn-badges');
  var toastEl = $('.vn-toast');
  var transcriptEl = $('.vn-transcript');
  var selectEl = $('#story');
  var statusEl = $('#status');
  var errorsEl = $('#errors'), errorsN = $('#errors-n'), errorsList = $('#errors-list');
  var btnTheme = $('#btn-theme'), btnHelp = $('#btn-help'), btnFull = $('#btn-full'), btnTitle = $('#btn-title'), btnIssues = $('#btn-issues');
  var helpOverlay = $('#help');
  function qbtn(name) { return $('button[data-q="' + name + '"]', quickEl); }

  /* ------------------------------------------------------------------ optional modules */

  // score.js (VNScore), audio.js (VNAudio), paint.js (VNPaint), live.js (VNLive), camera.js (VNCamera) and
  // op.js (VNOp) may each be absent or half-built at any time. ext() is the only way the stage reaches them:
  // a missing module or method answers undefined; a method that throws, or a promise that rejects, is reported
  // once per (module, method) with console.warn and otherwise ignored. Never console.error: a broken module
  // is not an error of the theatre.
  var HOOK_OFF = { VNScore: AUDIO_HOOK_OFF, VNAudio: AUDIO_HOOK_OFF, VNPaint: FORCE.paint === false, VNLive: FORCE.live === false, VNCamera: FORCE.camera === false, VNOp: FORCE.op === false };
  // modules the stage does not call at all: switched off by a hook, or resting in a capture / test run
  var OFF = {
    VNScore: AUDIO_HOOK_OFF || (TESTRUN && FORCE.audio !== true), VNAudio: AUDIO_HOOK_OFF || (TESTRUN && FORCE.audio !== true),
    VNPaint: FORCE.paint === false || (TESTRUN && FORCE.paint !== true),
    VNLive: FORCE.live === false || (TESTRUN && FORCE.live !== true),
    VNCamera: FORCE.camera === false || (TESTRUN && FORCE.camera !== true),
    VNOp: FORCE.op === false || (TESTRUN && FORCE.op !== true)
  };
  var extWarned = {};
  function extFail(mod, fn, err) {
    if (extWarned[mod + '.' + fn]) return;
    extWarned[mod + '.' + fn] = true;
    console.warn('[vn] ' + mod + '.' + fn + ' failed; the theatre carries on without it', err);
  }
  function callMod(mod, fn, args) {
    var m = window[mod], f = m && m[fn];
    if (typeof f !== 'function') return undefined;
    try {
      var r = f.apply(m, args);
      // a promise that rejects must not surface as an unhandled rejection: hand back one that settles to undefined
      if (r && typeof r.then === 'function') return Promise.resolve(r).then(null, function (e) { extFail(mod, fn, e); });
      return r;
    } catch (e) { extFail(mod, fn, e); return undefined; }
  }
  function ext(mod, fn) {
    if (OFF[mod]) return undefined;
    return callMod(mod, fn, Array.prototype.slice.call(arguments, 2));
  }
  // Is the module loaded (and not switched off by its hook)? Read once, at boot: it decides which Config rows,
  // buttons and keys exist.
  function has(mod) { return !!window[mod] && !HOOK_OFF[mod]; }
  var HAS = { audio: has('VNAudio'), paint: has('VNPaint'), live: has('VNLive'), camera: has('VNCamera'), op: has('VNOp') };

  /* ------------------------------------------------------------------ prefs + theme */

  var prefs = Object.assign({
    cps: 34, autoSpeed: 1, opacity: 0.74, effects: true, size: 1, textOnly: false,
    music: 0.55, ambience: 0.4, sfx: 0.6, voice: 0.35, mute: false, paint: true, live: true, camera: true, opening: true, babble: false
  }, readJSON('vn:prefs') || {});
  prefs.cps = clamp(parseInt(prefs.cps, 10) || 34, 15, 80);
  prefs.autoSpeed = clamp(parseFloat(prefs.autoSpeed) || 1, 0.5, 2.5);
  prefs.opacity = clamp(parseFloat(prefs.opacity) || 0.74, 0.3, 1);
  prefs.size = clamp(parseFloat(prefs.size) || 1, 0.85, 1.35);
  prefs.effects = prefs.effects !== false;
  function volPref(v, d) { v = parseFloat(v); return isFinite(v) ? clamp(v, 0, 1) : d; }
  prefs.music = volPref(prefs.music, 0.55); prefs.ambience = volPref(prefs.ambience, 0.4); prefs.sfx = volPref(prefs.sfx, 0.6); prefs.voice = volPref(prefs.voice, 0.35);
  prefs.mute = prefs.mute === true; prefs.babble = prefs.babble === true;
  prefs.paint = prefs.paint !== false; prefs.live = prefs.live !== false; prefs.camera = prefs.camera !== false; prefs.opening = prefs.opening !== false;
  function savePrefs() { lsSet('vn:prefs', JSON.stringify(prefs)); }
  function applyPrefs() {
    var st = document.documentElement.style;
    st.setProperty('--vn-win-a', String(prefs.opacity));
    st.setProperty('--vn-fs', String(prefs.size));
    document.body.classList.toggle('fx-off', !prefs.effects);
  }
  applyPrefs();

  var themeOverride = params.get('theme');
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function applyTheme(t, persist) {
    document.documentElement.setAttribute('data-theme', t);
    if (btnTheme) { btnTheme.textContent = t === 'dark' ? '☀' : '☾'; btnTheme.setAttribute('aria-label', t === 'dark' ? 'switch to light theme' : 'switch to dark theme'); }
    if (persist) lsSet('theme', t);
  }
  applyTheme(themeOverride === 'light' || themeOverride === 'dark' ? themeOverride : currentTheme(), false);
  if (btnTheme) btnTheme.addEventListener('click', function () { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true); });
  window.addEventListener('storage', function (e) { if (e.key === 'theme' && (e.newValue === 'light' || e.newValue === 'dark')) applyTheme(e.newValue, false); });
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) { if (!lsGet('theme') && !themeOverride) applyTheme(e.matches ? 'dark' : 'light', false); });
    } catch (e) { /* older engines */ }
  }
  if (REDUCED) document.documentElement.setAttribute('data-reduced-motion', '1');
  if (THUMB) document.body.classList.add('thumb');
  if (ART && ART.sharedDefs) document.body.insertAdjacentHTML('afterbegin', ART.sharedDefs());

  /* ------------------------------------------------------------------ small UI helpers */

  var toastTimer = 0;
  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2600);
  }
  function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }
  function announce(text) { if (!live) return; live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); }
  function badges() {
    if (!badgesEl) return;
    var b = [];
    if (S.auto) b.push('auto');
    if (S.skip) b.push('skip');
    badgesEl.innerHTML = b.map(function (x) { return '<span>' + x + '</span>'; }).join('');
  }
  function showPanel(title, html) {
    panelEl.innerHTML = '<div class="vn-panel-box" tabindex="-1"><h2>' + esc(title) + '</h2>' + html + '</div>';
    panelEl.classList.add('show');
  }
  function hidePanel() { panelEl.classList.remove('show'); }
  function chipHtml(ref) {
    var d = VN && VN.describeRef ? VN.describeRef(ref) : ref;
    return '<abbr class="vn-chip" title="' + esc(d) + '">' + esc(ref) + '</abbr>';
  }
  function chipsHtml(refs) { return (refs || []).map(chipHtml).join(''); }
  function fmtDate(ts) {
    var d = new Date(ts); function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ------------------------------------------------------------------ art adapter */

  function artBackground(name, mod, opts) {
    if (ART && typeof ART.background === 'function') {
      try { var s = ART.background(name, mod, opts); if (s) return s; } catch (e) { console.warn('art.background failed', e); }
    }
    return '<svg viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice">' +
      '<rect width="1600" height="900" fill="#20242e"/><rect x="0" y="620" width="1600" height="280" fill="#2c3240"/>' +
      '<text x="40" y="60" font-family="system-ui, sans-serif" font-size="26" fill="#8a90a0">' + esc(name + (mod ? ' (' + mod + ')' : '')) + '</text></svg>';
  }
  function artCg(name, mod, opts) {
    if (ART && typeof ART.cg === 'function') {
      try { var s = ART.cg(name, mod, opts); if (s) return s; } catch (e) { console.warn('art.cg failed', e); }
    }
    return artBackground('void', null);
  }
  function artSprite(decl, face) {
    if (ART && typeof ART.sprite === 'function') {
      try { var s = ART.sprite(decl, face); if (s) return s; } catch (e) { console.warn('art.sprite failed', e); }
    }
    var hue = decl && typeof decl.hue === 'number' ? decl.hue : 0;
    var label = (decl && decl.name) || '?';
    return '<svg viewBox="0 0 600 1000" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect x="170" y="330" width="260" height="670" rx="60" fill="hsl(' + hue + ' 18% 62%)" opacity="0.85"/>' +
      '<circle cx="300" cy="220" r="100" fill="#e9c3a0" opacity="0.9"/>' +
      '<text x="300" y="960" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" fill="#fff" opacity="0.7">' + esc(label) + (face && face !== 'neutral' ? ' (' + esc(face) + ')' : '') + '</text></svg>';
  }
  function artBoard(op) {
    if (ART) {
      var fn = typeof ART[op.kind] === 'function' ? ART[op.kind] : null;
      if (fn && op.kind !== 'scene') { try { var s = fn(op); if (s) return s; } catch (e) { console.warn('art.' + op.kind + ' failed', e); } }
    }
    return null;
  }
  function boardHtml(op) {
    var art = artBoard(op);
    if (art) return art;
    var h = '<div class="vn-board vn-board-' + op.kind + '">';
    if (op.kind === 'card') {
      h += '<h3>' + esc(op.title) + chipsHtml(op.refs) + '</h3><ul>';
      (op.cells || []).forEach(function (c) {
        h += '<li>' + (c.label != null ? '<b>' + esc(c.label) + '</b><span>' + esc(c.value) + '</span>' : esc(c.value)) + '</li>';
      });
      h += '</ul>';
      if (op.src) h += '<p class="vn-sr">Image: ' + esc(op.src) + '</p>';
    } else if (op.kind === 'chart') {
      var max = 0;
      (op.series || []).forEach(function (s) { max = Math.max(max, s.num || 0, s.hiNum || 0, s.loNum || 0); });
      max = max || 1;
      h += '<div class="vn-kicker">' + esc(op.type === 'range' ? 'Range' : 'Bar') + ' chart' + (op.unit ? ' · ' + esc(op.unit) : '') + '</div><h3>' + esc(op.title) + chipsHtml(op.refs) + '</h3>';
      h += '<table><thead><tr><th scope="col">Series</th><th scope="col">' + (op.type === 'range' ? 'From' : 'Value') + '</th>' + (op.type === 'range' ? '<th scope="col">To</th>' : '') + '<th scope="col"></th></tr></thead><tbody>';
      (op.series || []).forEach(function (s) {
        if (op.type === 'range') {
          h += '<tr><th scope="row">' + esc(s.label) + '</th><td>' + esc(s.lo) + '</td><td>' + esc(s.hi) + '</td><td style="width:40%"><span class="vn-bar lo" style="width:' + (100 * (s.loNum || 0) / max).toFixed(1) + '%"></span><span class="vn-bar" style="width:' + (100 * (s.hiNum || 0) / max).toFixed(1) + '%"></span></td></tr>';
        } else {
          h += '<tr><th scope="row">' + esc(s.label) + '</th><td>' + esc(s.value) + '</td><td style="width:50%"><span class="vn-bar" style="width:' + (100 * (s.num || 0) / max).toFixed(1) + '%"></span></td></tr>';
        }
      });
      h += '</tbody></table>';
    } else if (op.kind === 'code') {
      h += '<div class="vn-kicker">' + esc(op.lang || 'code') + '</div><pre>' + (op.lines || []).map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</pre>';
    } else if (op.kind === 'withheld') {
      h += '<div class="vn-withheld"><div class="vn-kicker">Embargo</div><h3>' + esc(op.text) + '</h3><p>This story is listed under “Coming soon”. The result card will replace this board once the paper is public.</p></div>';
    }
    return h + '</div>';
  }

  /* ------------------------------------------------------------------ catalogue */

  var catalog = [];          // visible entries, picker order
  var allManifest = [];      // raw manifest
  var posts = [];            // blog/index.json
  var postBySlug = {};

  function entryFromManifest(m) {
    return {
      id: m.id, file: m.file, title: m.title || m.id, kind: m.kind || 'paper', status: m.status || 'draft',
      source: m.source || '', blurb: m.blurb || '', slug: m.slug || (/^blog:(.+)$/.exec(m.source || '') || [])[1] || null,
      pub: m.pub || null, auto: false
    };
  }
  function buildCatalog() {
    var claimed = {};
    var out = [];
    allManifest.forEach(function (m) {
      var e = entryFromManifest(m);
      if (e.status === 'draft' && !DRAFTS) return;
      if (e.slug) claimed[e.slug] = true;
      out.push(e);
    });
    posts.forEach(function (p) {
      if (!p.slug || claimed[p.slug]) return;
      if (!p.file) return;
      out.push({ id: 'post:' + p.slug, title: p.title || p.slug, kind: 'blog', status: 'published', auto: true, post: p, blurb: p.summary || '', slug: p.slug, date: p.date || null });
    });
    catalog = out;
  }
  function groupOf(e) {
    if (e.status === 'embargo') return 'Coming soon';
    return e.kind === 'blog' ? 'Posts' : 'Papers';
  }
  function findEntry(id) { for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i]; return null; }
  function hasSave(id) { return !!readJSON('vn:' + id); }

  function fillSelect() {
    if (!selectEl) return;
    var groups = { Papers: [], Posts: [], 'Coming soon': [] };
    catalog.forEach(function (e) { groups[groupOf(e)].push(e); });
    var h = '<option value="">Choose a story…</option>';
    Object.keys(groups).forEach(function (g) {
      if (!groups[g].length) return;
      h += '<optgroup label="' + esc(g) + '">' + groups[g].map(function (e) {
        var tag = e.auto ? ' (auto)' : e.status === 'draft' ? ' (draft)' : '';
        return '<option value="' + esc(e.id) + '">' + esc(e.title) + tag + '</option>';
      }).join('') + '</optgroup>';
    });
    selectEl.innerHTML = h;
  }

  function renderPicker(notice) {
    setMode('picker');
    clearStage();
    leaveStory();
    document.title = 'Paper Theatre';
    var groups = [['Papers', []], ['Posts', []], ['Coming soon', []]];
    catalog.forEach(function (e) { for (var i = 0; i < groups.length; i++) if (groups[i][0] === groupOf(e)) groups[i][1].push(e); });
    var h = '<div class="vn-bill"><h2>Paper Theatre</h2><p class="vn-lede">Every paper and post as a short visual novel: a hook, a question, a bet, the result as the source printed it, a citation.</p>';
    if (notice) h += '<p class="vn-notice">' + esc(notice) + '</p>';
    var any = false;
    groups.forEach(function (g) {
      h += '<h3>' + esc(g[0]) + '</h3>';
      if (!g[1].length) { h += '<p class="vn-empty">' + (g[0] === 'Coming soon' ? 'Nothing embargoed right now.' : 'Nothing here yet.') + '</p>'; return; }
      any = true;
      h += '<ul>' + g[1].map(function (e) {
        var tags = '';
        if (e.auto) tags += '<span class="vn-tag" title="read straight from the blog post">auto</span>';
        if (e.status === 'draft') tags += '<span class="vn-tag">draft</span>';
        if (hasSave(e.id)) tags += '<span class="vn-tag resume">resume</span>';
        return '<li><button type="button" data-story="' + esc(e.id) + '"><span><b>' + esc(e.title) + '</b>' + tags + '</span>' + (e.blurb ? '<small>' + esc(e.blurb) + '</small>' : '') + '</button></li>';
      }).join('') + '</ul>';
    });
    if (!any) h += '<p class="vn-empty">No stories are listed yet. Preview a script with <code>?src=stories/name.vn</code>.</p>';
    h += '</div>';
    pickerEl.innerHTML = h;
    pickerEl.classList.add('show');
    stage.setAttribute('aria-label', 'story picker');
    if (selectEl) selectEl.value = '';
    try { var u = new URL(location.href); u.searchParams.delete('story'); u.searchParams.delete('post'); u.searchParams.delete('at'); u.hash = ''; if (!params.get('src')) history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ }
    $$('button[data-story]', pickerEl).forEach(function (b) {
      b.addEventListener('click', function () { openStory(b.getAttribute('data-story')); });
    });
  }

  /* ------------------------------------------------------------------ run state */

  var S = {
    entry: null, program: null, run: null, stop: null, id: null, mode: 'picker',
    typing: null, auto: false, skip: false, skipUnseen: false, skipTimer: 0, autoTimer: 0, pauseTimer: 0, wait: null,
    noSave: false, noSlots: false, textOnly: false, hasMath: false, lastFocus: null, holdLast: 0, hidden: false, screen: null,
rendered: { bg: null, cg: null, fb: false, bgPaint: null, cgPaint: null }, actors: {}, issues: [], seenAll: {}, transTimers: [],
    // optional modules: the last cue sent to the audio, whether a sync is owed a silence, the music hold at a menu,
    // the opening movie in progress, and the picture each layer holds for paint.js ({svg, key, seq, mounted, good})
    cue: null, synced: false, held: false, opening: null, paint: { bg: null, cg: null },
    // Studio and presenter: the source text and descriptor of the last load, whether a fatal issue blocks play
    source: null, lastDesc: null, blocked: false
  };

  /* ------------------------------------------------------------------ optional modules: settings, sound, painting */

  // Live cast and camera move only when motion is wanted at all (Effects on, no reduced motion, not the text-only
  // transcript) and are told to rest around a settled present (Skip, Back, Load): setEnabled(false) before it,
  // setEnabled(true) once it stands. Each module is told only when its value changes.
  var told = {};
  function tell(mod, on) {
    if (OFF[mod] || !window[mod] || told[mod] === on) return;
    told[mod] = on;
    ext(mod, 'setEnabled', on);
  }
  function motionOn() { return prefs.effects && !REDUCED && !S.textOnly; }
  function paintOn() { return FORCE.paint != null ? FORCE.paint : prefs.paint; }
  function syncCamera(still) { tell('VNCamera', FORCE.camera != null ? FORCE.camera : prefs.camera && motionOn() && !still); }
  function syncEnabled(still) {
    tell('VNPaint', paintOn());
    tell('VNLive', FORCE.live != null ? FORCE.live : prefs.live && motionOn() && !still);
    syncCamera(still);
  }
  function pushVolumes() { ext('VNAudio', 'volumes', { music: prefs.music, ambience: prefs.ambience, sfx: prefs.sfx, voice: prefs.voice, mute: prefs.mute }); }

  // Sound may start only from a real gesture: never from a script, a capture, a test hook or under ?audio=0.
  var CAN_UNLOCK = !TESTRUN && !HOOK_CLICK && !AUDIO_HOOK_OFF;
  function unlockAudio(ev) { if (CAN_UNLOCK && ev && ev.isTrusted) ext('VNAudio', 'unlock'); }

  // The score: one cue per stop, computed by score.js from the state and handed to audio.js. `instant` is true
  // when the stop was not reached by reading forward (Skip, Back, Load, a rewind): no crossfade, no one-shots.
  function scoreSync(state, op, instant, extra) {
    if (OFF.VNAudio) return;
    var bg = state.bg || { name: 'void', mod: null }, hints = { hour: null, indoor: isIndoor(state) }, k;
    try { hints.hour = (ART && ART.timeOf && ART.timeOf(bg.name, bg.mod)) || null; } catch (e) { hints.hour = null; }
    if (extra) for (k in extra) hints[k] = extra[k];
    var cue = ext('VNScore', 'cue', state, op, S.program, hints);
    S.cue = cue == null ? null : cue;
    S.synced = true;
    ext('VNAudio', 'sync', S.cue, { instant: !!instant });
  }
  // the story has left the stage (picker, a script that will not play): everything fades out
  function scoreStop() {
    if (!S.synced) return;
    S.synced = false; S.cue = null;
    ext('VNAudio', 'sync', null, { instant: false });
  }
  function holdMusic(on) { if (S.held === on) return; S.held = on; ext('VNAudio', 'hold', on); }
  function setMute(on) {
    prefs.mute = !!on; savePrefs(); pushVolumes();
    var b = qbtn('mute'); if (b) { b.classList.toggle('on', prefs.mute); b.setAttribute('aria-pressed', String(prefs.mute)); }
  }

  // Painted pictures. paint.js puts an <img class="vn-painted"> inside the layer, over the SVG it was painted
  // from, so the transition snapshot (a clone of the world) carries it. Replacing the layer's markup removes the
  // image with it; a painting that arrives after its picture was replaced is taken out again here.
  var paintSeq = 0;
  function paintKey(which, name, mod, opts) {
    var o = opts || {};
    return which + '|' + name + '|' + (mod || '') + '|' + Object.keys(o).sort().map(function (k) { return k + '=' + o[k]; }).join(',');
  }
  function paintedIn(layer) { return $$('img.vn-painted', layer); }
  function mountPaint(which, layer) {
    var cur = S.paint[which];
    if (!cur || !paintOn() || OFF.VNPaint || !window.VNPaint) return;
    var seq = cur.seq = ++paintSeq;
    cur.mounted = true; cur.good = null;
    function settle() {
      var now = S.paint[which];
      if (now === cur && cur.seq === seq && cur.mounted) { cur.good = paintedIn(layer); return; }
      // overtaken while it worked (the picture changed, was cleared, or painting was switched off): nothing it added may stay
      var keep = now && now.mounted && now.good ? now.good : [];
      paintedIn(layer).forEach(function (img) { if (keep.indexOf(img) < 0) img.remove(); });
    }
    var p = ext('VNPaint', 'mount', layer, cur.svg, cur.key);
    if (p && typeof p.then === 'function') p.then(settle); else settle();
  }
  // called right after layer.innerHTML has been set to `svg` ('' when the layer was emptied)
  function repaint(which, layer, svg, key) {
    var was = S.paint[which];
    S.paint[which] = svg ? { svg: svg, key: key, seq: 0, mounted: false, good: null } : null;
    if (svg) { layer.setAttribute('data-paint', key); mountPaint(which, layer); }
    else { layer.removeAttribute('data-paint'); if (was && was.mounted) ext('VNPaint', 'unmount', layer); }
  }
  // the Painted backgrounds switch: off unmounts both layers, on paints the pictures that are up
  function refreshPaint() {
    syncEnabled(false);
    [['bg', bgEl], ['cg', cgEl]].forEach(function (p) {
      var cur = S.paint[p[0]];
      if (paintOn()) { if (cur && !cur.mounted) mountPaint(p[0], p[1]); return; }
      ext('VNPaint', 'unmount', p[1]);
      if (cur) { cur.mounted = false; cur.good = null; }
      paintedIn(p[1]).forEach(function (img) { img.remove(); });
    });
  }

  function setHue(h) { document.documentElement.style.setProperty('--vn-h', String(((h % 360) + 360) % 360)); }
  function setMode(m) {
    S.mode = m;
    document.body.classList.toggle('playing', m !== 'picker');
    stage.classList.toggle('in-play', m === 'play');
    stage.classList.toggle('at-title', m === 'title');
    if (m !== 'play') { setHidden(false); }
  }

  function endTransition() {
    S.transTimers.forEach(clearTimeout); S.transTimers = [];
    transEl.className = 'vn-trans'; transEl.innerHTML = '';
  }
  function clearWorld() {
    endTransition();
    Object.keys(S.actors).forEach(function (k) { ext('VNLive', 'detach', S.actors[k].el); });
    bgEl.innerHTML = ''; cgEl.innerHTML = ''; cgEl.classList.remove('show'); world.classList.remove('has-cg');
    repaint('bg', bgEl, '', ''); repaint('cg', cgEl, '', '');
    ext('VNCamera', 'reset');
    spritesEl.innerHTML = ''; fxEl.innerHTML = ''; if (fxBackEl) fxBackEl.innerHTML = '';
    stage.classList.remove('menu-up');
    S.actors = {}; S.rendered = { bg: null, cg: null, fb: false, bgPaint: null, cgPaint: null };
    stage.classList.remove('flashback', 'shake', 'pulse'); flashEl.classList.remove('go');
    stage.removeAttribute('data-tone'); stage.removeAttribute('data-tod');
    captionEl.classList.remove('show'); captionEl.textContent = '';
  }
  function clearStage() {
    stopTyping();
    clearTimeout(S.autoTimer); clearTimeout(S.skipTimer); clearTimeout(S.pauseTimer);
    if (S.wait) { clearTimeout(S.wait.timer); S.wait = null; }
    if (S.opening) S.opening.cancel();
    holdMusic(false);
    box.classList.remove('show', 'done', 'narr', 'thought'); textEl.innerHTML = ''; nameEl.textContent = '';
    nvlEl.classList.remove('show', 'done'); nvlPage.innerHTML = '';
    menuEl.classList.remove('show'); menuEl.innerHTML = ''; stage.classList.remove('menu-up');
    sceneEl.className = 'vn-scene'; sceneEl.innerHTML = '';
    boardsEl.classList.remove('show'); boardsEl.innerHTML = '';
    endEl.classList.remove('show'); endEl.innerHTML = '';
    titleEl.classList.remove('show'); titleEl.innerHTML = '';
    pickerEl.classList.remove('show');
    transcriptEl.innerHTML = '';
    closeScreen(true);
    hidePanel();
    clearWorld();
  }

  function setUrl(entryId, label) {
    try {
      var u = new URL(location.href);
      if (entryId && !params.get('src')) {
        if (/^post:/.test(entryId)) { u.searchParams.delete('story'); u.searchParams.set('post', entryId.slice(5)); }
        else { u.searchParams.delete('post'); u.searchParams.set('story', entryId); }
      }
      u.searchParams.delete('at');
      u.hash = label ? '#' + label : '';
      history.replaceState(null, '', u.toString());
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ loading */

  function syntheticPostVn(p) {
    return [
      '@title ' + (p.title || p.slug),
      '@kind blog',
      '@source blog:' + p.slug,
      '@link ../../#/post/' + p.slug + ' Read the post',
      '@status published',
      '@palette hue=' + (hash32(p.slug) % 360),
      '@note Read straight from the post; no dramatization. Chips point at the post’s paragraphs.',
      '',
      '@bg paper',
      '@read post',
      '@end'
    ].join('\n');
  }

  function fetchIncludes(text, baseDirs) {
    var names = [];
    text.replace(/^\s*@include\s+(\S+)/gm, function (m, p) { if (names.indexOf(p) < 0) names.push(p); return m; });
    var includes = {};
    function one(name) {
      var tries = baseDirs.map(function (d) { return d + name; });
      var p = Promise.reject();
      tries.forEach(function (u) { p = p.catch(function () { return fetchText(u); }); });
      return p.then(function (t) {
        includes[name] = t;
        // one level of nested includes
        var nested = [];
        t.replace(/^\s*@include\s+(\S+)/gm, function (m, q) { if (!includes[q] && names.indexOf(q) < 0) { names.push(q); nested.push(q); } return m; });
        return Promise.all(nested.map(one));
      }).catch(function () { /* parser reports include-missing */ });
    }
    return Promise.all(names.map(one)).then(function () { return includes; });
  }

  function loadPosts() {
    if (posts.length) return Promise.resolve(posts);
    return fetchJSON('../../blog/index.json').then(function (j) {
      posts = Array.isArray(j) ? j : [];
      posts.forEach(function (p) { if (p.slug) postBySlug[p.slug] = p; });
      return posts;
    }).catch(function () { posts = []; return posts; });
  }

  // Resolve the blog post behind a program (for @read post / @source blog:slug).
  function postFor(program) {
    var meta = program.meta;
    var slug = meta.sourceKind === 'blog' ? meta.sourceRef : null;
    var p = slug && postBySlug[slug];
    if (p) return { slug: slug, title: p.title, date: p.date, file: p.file, url: '../../blog/posts/' + p.file, known: true };
    if (meta.file) return { slug: slug, title: meta.title, date: null, file: meta.file, url: '../../blog/posts/' + meta.file, known: false };
    return null;
  }

  function hasReadOp(program) { return program.ops.some(function (o) { return o.kind === 'read'; }); }

  // ?src=draft:<key> is a script the Studio keeps in this browser (localStorage 'vn:studio:<key>'), not a file.
  function draftKey(src) { var m = /^draft:(.+)$/.exec(src || ''); return m ? m[1] : null; }
  function readSource(src) {
    var key = draftKey(src);
    if (key == null) return fetchText(src);
    var text = lsGet('vn:studio:' + key);
    return text == null ? Promise.reject(new Error('No draft called “' + key + '” in this browser (vn:studio:' + key + ')')) : Promise.resolve(text);
  }
  function sourceDirs(src) { return draftKey(src) != null ? ['stories/'] : [src.replace(/[^\/]*$/, ''), 'stories/']; }

  // Leaving the story altogether (the picker, a script that will not load or play).
  function leaveStory() {
    scoreStop();
    presLast = null;
  }

  // Load one story (manifest entry, or {src} / {post} descriptors) and open it.
  function loadStory(desc, opts) {
    opts = opts || {};
    if (!VN) { showEngineMissing(); return Promise.resolve(); }
    var id, textP, baseDirs;
    S.lastDesc = desc;
    if (desc.src) {
      id = 'src:' + desc.src;
      baseDirs = sourceDirs(desc.src);
      textP = readSource(desc.src);
    } else if (desc.auto) {
      id = desc.id; baseDirs = ['stories/'];
      textP = Promise.resolve(syntheticPostVn(desc.post));
    } else {
      id = desc.id; baseDirs = ['stories/'];
      textP = fetchText('stories/' + desc.file);
    }
    setStatus('Loading…');
    return textP.then(function (text) {
      return fetchIncludes(text, baseDirs).then(function (includes) {
        var program = VN.parse(text, { id: id, includes: includes });
        return loadPosts().then(function () {
          if (program.meta.sourceKind === 'blog') {
            var p = postBySlug[program.meta.sourceRef];
            if (p) {
              if (!program.meta.title) program.meta.title = p.title;
              program.meta.date = p.date || null;
              if (!program.meta.links.length) program.meta.links.push({ url: '../../#/post/' + p.slug, label: 'Read the post' });
            }
          }
          if (!hasReadOp(program)) return program;
          var post = postFor(program);
          if (!post) return program;
          return fetchText(post.url).then(function (md) {
            return VN.expand(program, md, { title: post.title || program.meta.title });
          }).catch(function () { return program; });
        }).then(function (program) {
          var issues = VN.lint(program);
          studioPost({ type: 'ready', title: program.meta.title || null, issues: issues.map(function (i) { return { level: i.level, line: i.line, msg: i.msg, code: i.code }; }) });
          // auto-read posts are not authored scripts: only fatals are worth a panel
          if (desc.auto) issues = issues.filter(function (i) { return i.level === 'fatal'; });
          renderIssues(issues, desc.src || (desc.file ? 'stories/' + desc.file : id), !!desc.src);
          var fatal = issues.filter(function (i) { return i.level === 'fatal'; });
          S.source = text;
          if (fatal.length) {
            S.entry = desc; S.program = program; S.run = null; S.id = id; S.blocked = true;
            setMode('picker');
            clearStage();
            leaveStory();
            showPanel('The script has a fatal issue', '<p>' + esc(fatal[0].msg) + '</p>' + (fatal[0].hint ? '<p><code>' + esc(fatal[0].hint) + '</code></p>' : '') + '<p>Fix it and reload; the full list is under the stage.</p>');
            setStatus('');
            return;
          }
          openProgram(desc, program, id, opts);
        });
      });
    }).catch(function (err) {
      console.warn(err);
      S.blocked = true;
      setMode('picker');
      clearStage();
      leaveStory();
      if (location.protocol === 'file:') showFileMessage();
      else showPanel('Could not load the story', '<p>' + esc(String(err && err.message || err)) + '</p><p>Check the path, or pick another story from the list.</p>');
      setStatus('');
      studioPost({ type: 'ready', title: null, issues: [{ level: 'fatal', line: 0, msg: String(err && err.message || err), code: 'load-failed' }] });
    });
  }

  function openStory(id, opts) {
    var e = findEntry(id);
    if (!e) { renderPicker('No story called “' + id + '”.'); return; }
    if (selectEl) selectEl.value = id;
    setUrl(id, null);
    return loadStory(e, opts || {});
  }

  /* ------------------------------------------------------------------ issues */

  function renderIssues(issues, file, loudInPlay) {
    issues = issues || [];
    S.issues = issues;
    if (btnIssues) {
      btnIssues.hidden = !(issues.length && (loudInPlay || DRAFTS));
      btnIssues.textContent = '⚠ ' + issues.length;
    }
    if (!errorsEl) return;
    if (!issues.length) { errorsEl.classList.remove('show'); errorsEl.open = false; errorsList.innerHTML = ''; errorsN.textContent = '0'; return; }
    var fatal = issues.filter(function (i) { return i.level === 'fatal'; }).length;
    errorsN.textContent = fatal ? fatal + ' fatal, ' + (issues.length - fatal) + ' warning' + (issues.length - fatal === 1 ? '' : 's') : issues.length + ' warning' + (issues.length === 1 ? '' : 's');
    errorsN.className = 'n' + (fatal ? ' fatal' : '');
    errorsList.innerHTML = issues.map(function (i) {
      return '<li class="' + esc(i.level) + '"><span class="lvl">' + esc(i.level) + '</span>' + (i.file ? esc(i.file) + ' ' : '') + esc(i.msg) + (i.hint ? '<span class="hint">' + esc(i.hint) + '</span>' : '') + '</li>';
    }).join('');
    errorsEl.classList.add('show');
    var loud = fatal > 0 || issues.some(function (i) { return i.code === 'speaker-undeclared' || i.code === 'show-undeclared'; });
    errorsEl.open = loud;
    issues.forEach(function (i) { (i.level === 'fatal' ? console.error : console.warn)('[vn] ' + (file || '') + ' ' + i.msg + (i.hint ? ' — ' + i.hint : '')); });
  }

  function showEngineMissing() {
    clearStage();
    showPanel('Engine not loaded', '<p><code>vn.js</code> did not load, so there is nothing to play yet. The stage, styles and controls are here; the parser and interpreter live in that file.</p><p>If you are serving the folder locally, check that <code>misc/55-paper-theatre/vn.js</code> exists and reload.</p>');
    if (selectEl) selectEl.disabled = true;
    setStatus('engine not loaded');
  }
  function showFileMessage() {
    showPanel('Serve the folder', '<p>Stories are fetched over HTTP, which browsers block from <code>file://</code>.</p><p>Run <code>npx serve</code> (or any static server) in the repository root and open <code>http://localhost:3000/misc/55-paper-theatre/</code>, or open this toy from the site.</p>');
  }

  /* ------------------------------------------------------------------ opening a story: title screen or straight in */

  // The Studio preview keeps nothing: no autosave, no slots, no memory of what was read.
  function autosave() { return S.id && !STUDIO ? readJSON('vn:' + S.id) : null; }
  function seenList() {
    var saved = autosave(), all = {}, kept = S.id && !STUDIO ? readJSON(seenKey()) : null;
    if (saved && Array.isArray(saved.seen)) saved.seen.forEach(function (i) { all[i] = 1; });
    if (kept && kept.hash === (S.program && S.program.hash) && Array.isArray(kept.seen)) kept.seen.forEach(function (i) { all[i] = 1; });
    if (S.run) Object.keys(S.run.seen).forEach(function (i) { all[i] = 1; });
    S.seenAll = all;
    return Object.keys(all).map(Number);
  }
  function newRun() { return VN.createRun(S.program, { seen: seenList() }); }
  // What has been read outlives the autosave: Start-over deletes the save, not the memory of having read.
  function seenKey() { return 'vn:seen:' + S.id; }

  // The opening movie (op.js). It plays before the first stop when the reader presses Start, and again from the
  // title menu; never in a settled state (reduced motion, Effects off) unless ?op=1 forces it.
  function opReady() {
    if (!HAS.op || OFF.VNOp || !S.program) return false;
    if (!(FORCE.op != null ? FORCE.op : (prefs.effects && !REDUCED))) return false;
    return !!ext('VNOp', 'available', S.program);
  }
  // Play it, then call `then`. While it plays the stage carries the class op-playing, its own controls rest and
  // its keys and pointer do nothing (the module handles its own skip); Escape always ends the wait.
  function playOpening(then) {
    var o = { done: false };
    function close() { o.done = true; if (S.opening === o) S.opening = null; stage.classList.remove('op-playing'); }
    o.finish = function () { if (o.done) return; close(); then(); };
    o.cancel = function () { if (o.done) return; close(); ext('VNOp', 'stop'); };
    S.opening = o;
    stage.classList.add('op-playing');
    // the cue is the title's, so the movie can start the theme from its first bar
    var p = ext('VNOp', 'play', S.program, stage, { audio: OFF.VNAudio ? null : (window.VNAudio || null), cue: OFF.VNAudio ? null : (S.cue || null) });
    if (p && typeof p.then === 'function') p.then(o.finish); else o.finish();
  }
  function withForcedOpening(fn) { if (FORCE.op === true && opReady()) playOpening(fn); else fn(); }

  function openProgram(entry, program, id, opts) {
    S.entry = entry; S.program = program; S.id = id; S.run = null; S.stop = null; S.noSave = false; S.noSlots = false; S.blocked = false;
    setAuto(false); setSkip(false);
    setStatus('');
    setHue(program.meta.palette.hue);
    var title = program.meta.title || entry.title || id;
    stage.setAttribute('aria-label', title);
    document.title = title + ' · Paper Theatre';
    S.hasMath = program.ops.some(function (o) { return o.text && /\$[^$]+\$|\\\(|\\\[/.test(o.text); });
    if (S.hasMath) loadKatex();

    var stop;
    if (THUMB) {
      beginPlay();
      stop = S.run.advance();
      var guard = 0;
      while (stop && !stop.done && guard++ < 5000) {
        if (program.thumb != null && stop.index > program.thumb) break;
        if (program.thumb == null && (stop.op.kind === 'menu' || stop.op.kind === 'card' || stop.op.kind === 'chart')) break;
        stop = stop.op.kind === 'menu' ? S.run.choose(0) : S.run.advance();
      }
      S.noSave = true;
      withForcedOpening(function () { present(stop, { instant: true }); });
      return;
    }
    if (AUTOPLAY != null) {
      beginPlay();
      S.noSave = true;
      withForcedOpening(function () {
        var an = AUTOPLAY === 'end' ? 1000000 : (parseInt(AUTOPLAY, 10) || 1), frozen = null;
        if (HOOK_TRANS && an > 1 && AUTOPLAY !== 'end') {
          // test hook: hold the named transition half-way between stop N-1 and stop N
          stop = gotoAt(String(an - 1));
          present(stop, { instant: true });
          frozen = world.cloneNode(true);
          stop = stop.op.kind === 'menu' ? S.run.choose(Math.min(PICK, stop.options.length - 1)) : S.run.advance();
        } else stop = gotoAt(String(an));
        present(stop, { instant: true });
        if (frozen) {
          transEl.innerHTML = ''; transEl.appendChild(frozen);
          transEl.className = 'vn-trans on t-' + HOOK_TRANS;
          transEl.style.setProperty('--ms', '1000ms');
          if (HOOK_TRANS === 'fade' || HOOK_TRANS === 'white') { var cv = document.createElement('div'); cv.className = 'vn-cover'; cv.style.transition = 'none'; cv.style.opacity = '0.6'; transEl.appendChild(cv); }
          else { transEl.style.animationDelay = '-500ms'; transEl.style.animationPlayState = 'paused'; }
        }
        if (HOOK_SCREEN) {
          if (HOOK_SCREEN === 'save' || HOOK_SCREEN === 'load') { writeSlot('1'); writeSlot('q'); }
          if (HOOK_SCREEN === 'title') showTitle(); else openScreen(HOOK_SCREEN);
        }
      });
      return;
    }
    if (opts.at != null) {
      var at = String(opts.at);
      if (!/^\d+$/.test(at) && program.labels[at] == null) {
        showTitle();
        toast('No label “' + at + '” in this story.', 3600);
        return;
      }
      beginPlay();
      // A deep link never touches the autosave (the reader's own place), but the moment itself is an ordinary
      // one: it is reached by replaying a route of choices from the top, so slots, quick save and rewind work.
      S.noSave = true;
      if (/^\d+$/.test(at)) stop = gotoAt(at);
      else {
        var route = VN.routeTo(program, program.labels[at], { prefer: (autosave() || {}).choiceLog });
        if (route) stop = S.run.replay(route.choiceLog, route.stopIndex);
        else { stop = S.run.jumpTo(at); S.noSlots = true; }   // no choices lead here: dress the stage and land on it
      }
      present(stop, { instant: REDUCED, live: true });
      toast('Deep link: your saved place is untouched; the save slots work from here', 3600);
      return;
    }
    // a Studio reload comes back to the line it was on
    if (opts.line != null) { studioGoto(opAtLine(opts.line)); return; }
    showTitle();
    if (HOOK_CLICK > 0) {
      // test hook: Start, then N real (animated) advances 350 ms apart, taking the first option at menus
      startFresh({ opening: FORCE.op === true });
      var left = HOOK_CLICK, iv = setInterval(function () {
        if (S.opening) return;     // (?op=1: the advances begin once the opening is over)
        if (left-- <= 0 || !S.stop || S.stop.op.kind === 'end') { clearInterval(iv); return; }
        if (S.stop.op.kind === 'menu') choose(Math.min(PICK, S.stop.options.length - 1)); else advance();
      }, 350);
    }
  }

  function beginPlay() {
    setMode('play');
    clearStage();
    S.run = newRun();
    S.stop = null;
    S.noSave = false; S.noSlots = false;
    if (!THUMB && mayFocus()) stage.focus({ preventScroll: true });
  }

  function gotoAt(at) {
    var n = parseInt(at, 10);
    if (String(n) === String(at) && n > 0) {
      var stop = S.run.advance(), guard = 0;
      while (stop && !stop.done && S.run.state.stops < n && guard++ < 10000) stop = stop.op.kind === 'menu' ? S.run.choose(Math.min(PICK, stop.options.length - 1)) : S.run.advance();
      return stop;
    }
    if (S.program.labels[at] == null) { toast('No label “' + at + '” in this story; starting from the top.'); return S.run.advance(); }
    return S.run.jumpTo(at);
  }

  // o.opening: the reader pressed Start, so the opening movie may play before the first stop
  function startFresh(o) {
    if (!STUDIO) {
      if (S.program && S.id) lsSet(seenKey(), JSON.stringify({ hash: S.program.hash, seen: seenList() }));
      lsDel('vn:' + S.id);
    }
    beginPlay();
    var run = S.run;
    function first() { if (S.run === run && S.mode === 'play') present(S.run.advance(), { instant: REDUCED, live: true }); }
    if (o && o.opening && (FORCE.op === true || prefs.opening) && opReady()) playOpening(first); else first();
  }
  function continueSaved() {
    var saved = autosave();
    if (!saved || !saved.choiceLog) { startFresh(); return; }
    beginPlay();
    var stop = S.run.replay(saved.choiceLog, saved.stopIndex);
    if (saved.hash !== S.program.hash && (S.run.state.choiceLog.length < saved.choiceLog.length || (stop && stop.op.kind === 'error'))) {
      lsDel('vn:' + S.id);
      S.run = newRun();
      present(S.run.advance(), { instant: REDUCED, live: true });
      toast('The script changed since your last visit and your choices no longer match; starting over.', 4200);
      return;
    }
    present(stop, { instant: true, resumed: true });
    if (saved.hash !== S.program.hash) toast('The script changed since your last visit; resumed by your choices.', 3600);
  }
  function restart(confirmFirst) {
    if (!S.program) return;
    if (confirmFirst && S.run && S.run.state.stops > 1 && !window.confirm('Start this story over?')) return;
    startFresh();
  }
  // Jump to a chapter by replaying from the top: the reader's own choices where they lead there, any other
  // route of choices otherwise, so the place can be saved like any other. Only a chapter that no choices
  // reach falls back to a bare jump (stage dressed in file order; slots off, rewind by stepping back).
  function jumpChapter(ch) {
    var saved = autosave(), log = (S.run && S.run.state.choiceLog.length ? S.run.state.choiceLog : (saved && saved.choiceLog)) || [];
    var route = VN.routeTo(S.program, ch.index, { prefer: log }), stop = null;
    beginPlay();
    if (route) stop = S.run.replay(route.choiceLog, route.stopIndex);
    if (!stop || stop.index !== ch.index) {
      S.run = newRun();
      stop = S.run.jumpTo(ch.index);
      S.noSave = true; S.noSlots = true;
      toast('Jumped straight to the chapter: progress is not saved from here', 3200);
    }
    present(stop, { instant: REDUCED, live: true });
  }

  /* ------------------------------------------------------------------ title screen */

  function shortCite(m, e) {
    if (m.kind === 'blog') return 'A blog post' + ((m.date || (e && e.post && e.post.date)) ? ' · ' + (m.date || e.post.date) : '');
    var c = m.cite || '';
    var ax = /(arXiv:\s*[\d.]*\d)(?:\s*\[[^\]]+\])?\.?\s*(.*)$/.exec(c);
    var year = (/\((\d{4})\)/.exec(c) || [])[1];
    if (ax) return (ax[2] ? ax[2].replace(/\.$/, '') + ' · ' : '') + ax[1] + (year ? ' · ' + year : '');
    var parts = c.split(/\.\s+/).filter(Boolean);
    return parts.length > 1 ? parts.slice(-1)[0].replace(/\.$/, '') + (year ? ' · ' + year : '') : (m.source && m.sourceKind === 'text' ? m.source : 'A paper');
  }
  var TITLE_FX = { sakura: 'petals', garden: 'petals', night: 'fireflies', station: 'fireflies', sea: 'dust', rooftop: 'dust' };
  function showTitle() {
    var p = S.program, m = p.meta, e = S.entry || {};
    stopTyping(); setAuto(false); setSkip(false);
    setMode('title');
    clearStage();
    var first = null;
    for (var i = 0; i < p.ops.length; i++) if (p.ops[i].kind === 'bg') { first = p.ops[i]; break; }
    var fx = {}; fx[TITLE_FX[first ? first.name : ''] || 'dust'] = true; fx.petals = true;   // petals always drift across a title
    var titleState = { bg: first ? { name: first.name, mod: first.mod, opts: first.opts } : { name: 'void', mod: null }, cg: null, slots: {}, faces: {}, dist: {}, fx: fx, tone: 'none', flashback: null, oneshot: [], change: null, music: 'auto', ambience: 'auto', sfx: [] };
    syncWorld(titleState, null, true);
    // the title has a cue of its own: the first scene's, asked for with op.kind 'title' and hints.title
    function titleCue() { scoreSync(titleState, { kind: 'title', line: 0 }, TESTRUN, { title: true }); }
    titleCue();
    presenterPost({ type: 'title', id: S.id, src: e.src || null, hash: p.hash });
    if (STUDIO) studioLine = null;
    var saved = autosave(), canContinue = !!(saved && saved.choiceLog && saved.stopIndex > 1);
    seenList();
    var chapters = p.chapters || [], seenCh = chapters.filter(function (c) { return S.seenAll[c.index] || e.src || STUDIO; });
    var opItem = opReady(), items = 5 + (canContinue ? 1 : 0) + (chapters.length ? 1 : 0) + (opItem ? 1 : 0);
    var h = '<div class="ts-inner"><p class="ts-kicker">Paper Theatre &nbsp;·&nbsp; 紙芝居</p><h2 class="ts-title' + ((m.title || e.title || '').length > 44 ? ' is-long' : '') + '">' + esc(m.title || e.title || '') + '</h2><div class="ts-rule"></div>' +
      '<p class="ts-sub">' + esc(shortCite(m, e)) + (m.authors ? '<br>' + esc(m.authors.replace(/\s*\(co-first\)/, '')) : '') + '</p></div>';
    h += '<p class="ts-vert" aria-hidden="true" lang="ja">紙芝居<span>論文と随想のための小さな劇場</span></p>';
    h += '<ul class="ts-menu' + (items > 6 ? ' is-tall' : '') + '" role="menu" aria-label="title menu">' +
      '<li><button type="button" data-t="start">Start</button></li>' +
      (canContinue ? '<li><button type="button" data-t="continue">Continue</button></li>' : '') +
      (chapters.length ? '<li><button type="button" data-t="chapters"' + (seenCh.length ? '' : ' disabled title="chapters you have reached appear here"') + '>Chapters</button></li>' : '') +
      '<li><button type="button" data-t="load">Load</button></li>' +
      '<li><button type="button" data-t="log"' + (canContinue ? '' : ' disabled') + '>Log</button></li>' +
      '<li><button type="button" data-t="config">Config</button></li>' +
      (opItem ? '<li><button type="button" data-t="opening" title="play the opening movie again">Opening</button></li>' : '') +
      '<li><button type="button" data-t="back">Back to stories</button></li></ul>';
    h += '<div class="ts-foot">' + (m.status === 'draft' ? 'draft · ' : m.status === 'embargo' ? 'coming soon · ' : '') + 'dialogue is dramatized</div>';
    titleEl.innerHTML = h;
    titleEl.classList.add('show');
    setUrl(S.entry && !S.entry.src ? S.id : null, null);
    $$('button[data-t]', titleEl).forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (S.opening) return;
        var t = b.getAttribute('data-t');
        // the buttons that lead into the story are the gesture the sound waits for
        if (t === 'start' || t === 'continue' || t === 'load' || t === 'log' || t === 'chapters' || t === 'opening') unlockAudio(ev);
        if (t === 'start') { if (canContinue && !window.confirm('Start from the beginning? Your place is kept in the save slots, not the autosave.')) return; startFresh({ opening: true }); }
        else if (t === 'continue') continueSaved();
        else if (t === 'chapters') openScreen('chapters');
        else if (t === 'load') openScreen('load');
        else if (t === 'log') { continueSaved(); openScreen('log'); }
        else if (t === 'config') openScreen('config');
        else if (t === 'opening') playOpening(function () { if (S.mode !== 'title') return; titleCue(); b.focus({ preventScroll: true }); });
        else if (t === 'back') renderPicker();
      });
    });
    announce((m.title || '') + '. Title menu.');
    var f = $('button[data-t="continue"]', titleEl) || $('button[data-t="start"]', titleEl);
    if (f && mayFocus()) f.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ the world: background, CG, cast, particles, grade */

  function castOf(key) { return (S.program && S.program.cast && S.program.cast[key]) || null; }
  function displayName(key, who) { var c = castOf(key); return c ? c.name : (who || key); }
  function hueOf(key) { var c = castOf(key); return c ? c.hue : 210; }

  function restartAnim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function flash() { restartAnim(flashEl, 'go'); }

  function syncActors(state, op, instant) {
    var speaker = op && op.kind === 'say' ? op.key : null, want = {}, onStage = false;
    SLOT_NAMES.forEach(function (slot) { var k = state.slots[slot]; if (k) { want[k] = slot; if (k === speaker) onStage = true; } });
    Object.keys(S.actors).forEach(function (k) {
      if (want[k]) return;
      var el = S.actors[k].el; delete S.actors[k];
      ext('VNLive', 'detach', el);
      if (instant) el.remove();
      else { el.classList.add('exit'); setTimeout(function () { el.remove(); }, 520); }
    });
    Object.keys(want).forEach(function (k) {
      var face = (speaker === k && op.face) ? op.face : (state.faces[k] || 'neutral');
      var a = S.actors[k], fresh = false, drawn = false;
      if (!a) {
        var decl = castOf(k) || { id: k, key: k, name: k, hue: hash32(k) % 360, skin: 3, hair: 'short' };
        var el = document.createElement('div');
        el.setAttribute('data-key', k);
        el.innerHTML = artSprite(decl, face);
        var svg = el.firstElementChild;
        el.setAttribute('data-kind', (svg && svg.getAttribute('data-kind')) || 'person');
        a = S.actors[k] = { el: el, face: face, decl: decl };
        fresh = !instant; drawn = true;
        spritesEl.appendChild(el);
      } else if (a.face !== face) {
        var groups = $$('.vn-face', a.el);
        if (groups.length) groups.forEach(function (g) { g.classList.toggle('is-on', g.getAttribute('data-face') === face); });
        else { a.el.innerHTML = artSprite(castOf(k), face); drawn = true; }
        a.face = face;
      }
      var cls = 'vn-actor pos-' + want[k] + (state.dist && state.dist[k] ? ' ' + state.dist[k] : '');
      if (speaker && onStage) cls += speaker === k ? ' speaking' : ' dim';
      if (fresh) {
        a.el.className = cls + ' enter';
        void a.el.offsetWidth;
        requestAnimationFrame(function () { a.el.classList.remove('enter'); });
        setTimeout(function () { a.el.classList.remove('enter'); }, 60);   // headless browsers may not run the frame
      } else a.el.className = cls;
      // a new sprite, or one whose markup was just replaced, is handed to the living-cast module
      if (drawn) ext('VNLive', 'attach', a.el, a.decl);
    });
  }

  // Particles. Weather (rain, snow, petals) falls in front of the cast outdoors; in a room it is drawn behind
  // the cast and fainter, as something seen through the windows. Dust and fireflies are in the air of the place
  // itself and stay in front. While a CG is up every layer rests (vn.css) and comes back with `@cg off`.
  var WEATHER = { rain: 1, snow: 1, petals: 1 };
  function isIndoor(state) { return !!(state.bg && ART && ART.INDOOR && ART.INDOOR[state.bg.name]); }
  function syncFx(state) {
    var want = prefs.effects ? Object.keys(state.fx || {}) : [], indoor = isIndoor(state);
    $$('.vn-fx', world).forEach(function (el) { if (want.indexOf(el.getAttribute('data-fx')) < 0) el.remove(); });
    want.forEach(function (name) {
      var home = indoor && WEATHER[name] && fxBackEl ? fxBackEl : fxEl, el = $('.vn-fx[data-fx="' + name + '"]', world);
      if (el) { if (el.parentNode !== home) home.appendChild(el); return; }
      if (ART && ART.fx) home.insertAdjacentHTML('beforeend', ART.fx(name));
    });
  }
  // rain or snow closes the sky: no moon, no stars, in the background and in the CGs that have a window
  function skyOpts(state, opts) {
    var o = Object.assign({}, opts || {});
    if (state.fx && (state.fx.rain || state.fx.snow)) o.overcast = true;
    return o;
  }

  function runTransition(tr) {
    var ms = clamp(tr.ms || 600, 60, 10000);
    transEl.style.setProperty('--ms', ms + 'ms');
    if (tr.name === 'fade' || tr.name === 'white') {
      var cover = document.createElement('div');
      cover.className = 'vn-cover';
      transEl.classList.add('t-' + tr.name);
      transEl.appendChild(cover);
      void cover.offsetWidth;
      cover.classList.add('in');
      S.transTimers.push(setTimeout(function () {
        var w = $('.vn-world', transEl); if (w) w.remove();
        transEl.classList.add('out');
        S.transTimers.push(setTimeout(endTransition, ms / 2 + 40));
      }, ms / 2));
    } else {
      transEl.classList.add('t-' + tr.name);
      S.transTimers.push(setTimeout(endTransition, ms + 40));
    }
    return ms;
  }

  // Bring the painted world to `state`. Returns the milliseconds a transition will take (0 for a cut).
  function syncWorld(state, op, instant) {
    var bg = state.bg || { name: 'void', mod: null };
    var bgOpts = skyOpts(state, bg.opts), cgOpts = state.cg ? skyOpts(state, state.cg.opts) : null;
    var bgKey = bg.name + '|' + (bg.mod || '') + '|' + JSON.stringify(bg.opts || {}), cgKey = state.cg ? state.cg.name + '|' + (state.cg.mod || '') + '|' + JSON.stringify(state.cg.opts || {}) : '', fb = !!state.flashback;
    // the weather repaints the sky in place (no transition); a new scene or picture is a change to play
    var bgPaint = bgKey + '|' + (bgOpts.overcast ? 'o' : ''), cgPaint = cgKey ? cgKey + '|' + (cgOpts.overcast ? 'o' : '') : '';
    var first = S.rendered.bg === null;
    var bgChanged = S.rendered.bg !== bgKey, cgChanged = S.rendered.cg !== cgKey && !(first && !cgKey), fbChanged = S.rendered.fb !== fb;
    var tr = null, wait = 0;
    endTransition();
    if (!instant && prefs.effects && !first && (bgChanged || cgChanged)) {
      var ch = state.change || {};
      tr = (cgChanged && ch.cg) || (bgChanged && ch.bg) || ch.cg || ch.bg || DEFAULT_TR;
      if (tr.name === 'cut') tr = null;
    }
    if (tr) {
      // hold the old picture on the transition layer; the new one is drawn underneath
      var snap = world.cloneNode(true);
      transEl.innerHTML = ''; transEl.appendChild(snap); transEl.className = 'vn-trans on';
    }
    if (S.rendered.bgPaint !== bgPaint) {
      var bgSvg = artBackground(bg.name, bg.mod, bgOpts);
      bgEl.innerHTML = bgSvg; S.rendered.bg = bgKey; S.rendered.bgPaint = bgPaint;
      repaint('bg', bgEl, bgSvg, paintKey('bg', bg.name, bg.mod, bgOpts));
    }
    if (S.rendered.cgPaint !== cgPaint) {
      var cgSvg = cgKey ? artCg(state.cg.name, state.cg.mod, cgOpts) : '';
      cgEl.innerHTML = cgSvg;
      cgEl.classList.toggle('show', !!cgKey);
      world.classList.toggle('has-cg', !!cgKey);
      S.rendered.cg = cgKey; S.rendered.cgPaint = cgPaint;
      repaint('cg', cgEl, cgSvg, cgKey ? paintKey('cg', state.cg.name, state.cg.mod, cgOpts) : '');
    }
    var tod = 'day';
    if (cgKey) { var cs = cgEl.firstElementChild; tod = (cs && cs.getAttribute('data-tod')) || 'night'; }
    else if (ART && ART.timeOf) tod = ART.timeOf(bg.name, bg.mod);
    stage.setAttribute('data-tod', tod);
    stage.setAttribute('data-tone', state.tone || 'none');
    if (fbChanged) {
      stage.classList.toggle('flashback', fb);
      if (!instant && prefs.effects && !first) flash();
      S.rendered.fb = fb;
    }
    var cap = fb && state.flashback.caption ? state.flashback.caption : (state.cg && state.cg.caption) || '';
    captionEl.textContent = cap;
    captionEl.classList.toggle('show', !!cap);
    captionEl.classList.toggle('cg', !(fb && state.flashback.caption));
    syncFx(state);
    syncActors(state, op, instant || !!tr);
    if (tr) wait = runTransition(tr);
    if (!instant && prefs.effects) (state.oneshot || []).forEach(function (name) {
      if (name === 'flash') flash();
      else if (name === 'shake' || name === 'pulse') restartAnim(stage, name);
    });
    return wait;
  }

  function labelAt(index) {
    var best = null, bestIdx = -1, labels = S.program.labels;
    Object.keys(labels).forEach(function (n) { if (labels[n] <= index && labels[n] > bestIdx) { bestIdx = labels[n]; best = n; } });
    return best;
  }

  /* ------------------------------------------------------------------ presenting a stop */

  function present(stop, o) {
    o = o || {};
    if (!stop) { toast('Nothing further back.'); return; }
    S.stop = stop;
    var op = stop.op, state = stop.state;
    stopTyping();
    clearTimeout(S.autoTimer); clearTimeout(S.pauseTimer);
    if (S.wait) { clearTimeout(S.wait.timer); S.wait = null; }
    hidePanel();
    menuEl.classList.remove('show'); menuEl.innerHTML = ''; stage.classList.remove('menu-up');
    boardsEl.classList.remove('show'); boardsEl.innerHTML = '';
    sceneEl.className = 'vn-scene'; sceneEl.innerHTML = '';
    endEl.classList.remove('show'); endEl.innerHTML = '';
    titleEl.classList.remove('show'); pickerEl.classList.remove('show');
    // whatever held the focus may just have been removed (a choice, the end card): the keys stay with the stage
    if (!THUMB && !S.screen && mayFocus() && (document.activeElement === document.body || !document.activeElement)) stage.focus({ preventScroll: true });
    box.classList.remove('done'); nvlEl.classList.remove('done');
    var instant = !!o.instant || REDUCED || S.skip || S.textOnly;
    // a stop that was not reached by reading forward (Skip, Back, Load, a rewind, a capture): the sound cuts
    // instead of crossfading, one-shots stay silent, the living cast and the camera rest while it is set up
    var replayed = (!!o.instant && !o.live) || S.skip;
    if (op.kind !== 'menu') holdMusic(false);
    syncEnabled(replayed);
    var wait = syncWorld(state, op, instant);
    scoreSync(state, op, replayed);
    if (!replayed) (state.sfx || []).forEach(function (name) { ext('VNAudio', 'sfx', name); });
    ext('VNCamera', 'present', state, op);
    var nvl = state.mode === 'nvl';

    function later(fn) {
      if (!wait) { fn(); return; }
      box.classList.remove('show'); nvlEl.classList.remove('show');
      S.wait = { fn: fn, timer: setTimeout(function () { S.wait = null; fn(); }, wait) };
    }

    switch (op.kind) {
      case 'say':
      case 'narrate':
        later(function () { if (nvl) showNvl(op, state, instant); else showLine(op, state, instant); });
        break;
      case 'read':
        showLine({ kind: 'narrate', text: 'The post could not be loaded here; read it on the site.', refs: [] }, state, instant);
        break;
      case 'menu':
        if (nvl) showNvl(null, state, true);
        else {
          nvlEl.classList.remove('show');
          // arriving by Back, load or rewind the window still holds some other line: show the one that led here
          if (o.back || o.resumed || o.instant || !textEl.textContent || !box.classList.contains('show')) { if (!showLastLine(state)) box.classList.remove('show'); }
          box.classList.add('done');
        }
        showMenu(stop);
        break;
      case 'scene':
      case 'chapter':
        showScene(op, instant);
        if (op.kind === 'chapter' && !replayed) ext('VNAudio', 'sting', 'chapter');
        break;
      case 'pause':
        box.classList.remove('show'); nvlEl.classList.remove('show');
        // (a beat that passes at once because nothing animates is still part of reading forward)
        if (instant) S.pauseTimer = setTimeout(function () { if (S.stop === stop && !S.skip) advance({ instant: true, live: !replayed }); }, 0);
        else S.pauseTimer = setTimeout(function () { if (S.stop === stop) advance(); }, Math.max(wait, 0) + op.ms);
        if (S.skip) scheduleSkip();
        break;
      case 'card':
      case 'chart':
      case 'code':
      case 'withheld':
        showBoard(op, instant);
        break;
      case 'end':
        box.classList.remove('show'); nvlEl.classList.remove('show');
        showEnd();
        if (!replayed) ext('VNAudio', 'sting', 'end');
        break;
      case 'error':
        showPanel('Runtime error', '<p>' + esc(op.msg) + '</p>' + (op.hint ? '<p><code>' + esc(op.hint) + '</code></p>' : ''));
        announce('Runtime error: ' + op.msg);
        break;
    }
    stage.classList.toggle('no-window', !box.classList.contains('show') || S.textOnly);
    if (S.textOnly) renderTranscript();
    if (!THUMB) setUrl(S.entry && !S.entry.src ? S.id : null, labelAt(stop.index));
    save();
    var b = qbtn('back'); if (b) b.disabled = state.stops <= 1 && !o.back;
    if (op.kind === 'menu' || op.kind === 'end' || op.kind === 'error') { if (S.skip) setSkip(false); }
    syncEnabled(S.skip);     // the stop stands: motion returns, unless Skip is still running
    announceStop(stop);
  }

  function save() {
    if (!S.run || S.noSave || THUMB || STUDIO || !S.id || S.mode !== 'play') return;
    var snap = S.run.snapshot();
    snap.ts = Date.now();
    lsSet('vn:' + S.id, JSON.stringify(snap));
  }

  /* ------------------------------------------------------------------ text: typewriter shared by the window and the NVL page */

  var segmenter = null;
  try { if (window.Intl && Intl.Segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); } catch (e) { segmenter = null; }
  function graphemes(s) {
    if (segmenter) { var out = []; for (var it = segmenter.segment(s)[Symbol.iterator](), r = it.next(); !r.done; r = it.next()) out.push(r.value.segment); return out; }
    return Array.from(s);
  }
  function splitMath(tokens) {
    var out = [];
    tokens.forEach(function (t) {
      if (t.type !== 'text' || t.text.indexOf('$') < 0) { out.push(t); return; }
      var re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g, last = 0, m;
      while ((m = re.exec(t.text))) {
        if (m.index > last) out.push({ type: 'text', text: t.text.slice(last, m.index) });
        out.push({ type: 'math', text: m[1] || m[2], display: !!m[1] });
        last = re.lastIndex;
      }
      if (last < t.text.length) out.push({ type: 'text', text: t.text.slice(last) });
    });
    return out;
  }
  function plainText(text) {
    return (VN && VN.markup ? VN.markup(text) : [{ type: 'text', text: text }]).map(function (t) { return t.text; }).join('');
  }
  function isThought(op, text) { return !!(op.thought || (VN && VN.isThought && VN.isThought(text))); }

  // Fill `el` with the whole line (markup, math placeholders, chips) and return what the typewriter needs.
  function buildLine(el, text, refs) {
    var tokens = splitMath(VN && VN.markup ? VN.markup(text) : [{ type: 'text', text: text }]);
    var units = [], mathEls = [];
    tokens.forEach(function (t) {
      var node;
      if (t.type === 'em') node = document.createElement('em');
      else if (t.type === 'code') node = document.createElement('code');
      else if (t.type === 'math') { node = document.createElement('span'); node.className = 'vn-math'; node.setAttribute('data-tex', t.text); mathEls.push(node); }
      else node = document.createElement('span');
      var tn = document.createTextNode('');
      node.appendChild(tn);
      el.appendChild(node);
      var full = t.type === 'math' ? (t.display ? '$$' + t.text + '$$' : '$' + t.text + '$') : t.text;
      tn.data = full;
      graphemes(full).forEach(function (g) { units.push({ node: tn, g: g }); });
    });
    var chips = document.createElement('span');
    chips.innerHTML = chipsHtml(refs);
    el.appendChild(chips);
    return { units: units, mathEls: mathEls, chips: chips };
  }

  // The cast member whose line is being typed (for the living cast: the mouth moves while the text runs).
  var speaking = null;
  function speakEnd() { if (speaking != null) { var k = speaking; speaking = null; ext('VNLive', 'speak', k, false); } }

  // voice: the cast key when the line is spoken aloud (a say line that is not a thought), else null
  function typeLine(container, line, announceText, instant, voice) {
    var units = line.units;
    function finish() {
      units.forEach(function (u) { if (!u.done) { u.node.data += u.g; u.done = true; } });
      line.chips.style.visibility = '';
      container.classList.add('done');
      S.typing = null;
      speakEnd();
      renderMath(line.mathEls);
      announce(announceText);
      scheduleAuto(units.length);
      if (S.skip) scheduleSkip();
    }
    speakEnd();
    if (instant || !units.length) { units.forEach(function (u) { u.done = true; }); finish(); return; }
    var seenNodes = [];
    units.forEach(function (u) { if (seenNodes.indexOf(u.node) < 0) { seenNodes.push(u.node); u.node.data = ''; } });
    line.chips.style.visibility = 'hidden';
    if (voice) { speaking = voice; ext('VNLive', 'speak', voice, true); }
    var i = 0, acc = 0, last = 0, raf = 0;
    var base = 1000 / clamp(prefs.cps, 15, 80);
    function frame(ts) {
      if (!last) last = ts;
      var dt = Math.min(ts - last, 200); last = ts;
      acc += dt;
      while (i < units.length && acc >= 0) {
        var u = units[i++];
        u.node.data += u.g; u.done = true;
        if (voice && prefs.babble && /\S/.test(u.g)) ext('VNAudio', 'voice', voice, u.g);
        var pause = /[.!?…]/.test(u.g) ? 3 : /[,;:]/.test(u.g) ? 1.5 : 1;
        var nextIsSpace = i < units.length && /\s/.test(units[i].g);
        acc -= base * (pause > 1 && (nextIsSpace || i >= units.length) ? pause : 1);
      }
      if (i >= units.length) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    // completing must also stop the frame loop, or the rest of the line is typed a second time after it
    S.typing = { complete: function () { cancelAnimationFrame(raf); finish(); }, cancel: function () { cancelAnimationFrame(raf); S.typing = null; speakEnd(); } };
  }
  function announceOf(who, text, refs) {
    return (who ? who + ': ' : '') + plainText(text) + ((refs && refs.length) ? ' (' + refs.map(function (r) { return VN && VN.describeRef ? VN.describeRef(r) : r; }).join('; ') + ')' : '');
  }

  // ADV: the glass window at the bottom with its name plate
  function showLine(op, state, instant) {
    var who = op.kind === 'say' ? displayName(op.key, op.who) : '';
    var text = VN && VN.interpolate ? VN.interpolate(op.text, state.vars, S.program.cast) : op.text;
    nvlEl.classList.remove('show');
    nameEl.textContent = who;
    box.style.setProperty('--who-h', String(op.kind === 'say' ? hueOf(op.key) : 210));
    box.classList.toggle('narr', op.kind !== 'say');
    box.classList.toggle('thought', isThought(op, text));
    box.classList.remove('done');
    box.classList.add('show');
    stage.classList.remove('no-window');
    textEl.innerHTML = '';
    typeLine(box, buildLine(textEl, text, op.refs), announceOf(who, text, op.refs), instant, op.kind === 'say' && op.key && !isThought(op, text) ? op.key : null);
  }
  // A menu reached by resume, rewind or ?thumb has no line on screen yet: show the last one.
  function showLastLine(state) {
    var h = state.history || [];
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i].kind === 'say' || h[i].kind === 'narrate') {
        var key = h[i].who ? h[i].who.toLowerCase() : null;
        showLine({ kind: h[i].kind, key: key, who: h[i].who, text: h[i].text, refs: h[i].refs, thought: h[i].thought }, state, true);
        return true;
      }
      if (h[i].kind !== 'choice') return false;
    }
    return false;
  }
  // NVL: lines since the last @page accumulate on a full-stage page; the newest one types itself
  function showNvl(op, state, instant) {
    var h = state.history || [], rows = [];
    for (var i = state.pageStart || 0; i < h.length; i++) if (h[i].kind === 'say' || h[i].kind === 'narrate') rows.push(h[i]);
    box.classList.remove('show');
    nvlEl.classList.remove('done');
    nvlEl.classList.add('show');
    nvlPage.innerHTML = '';
    var line = null, who = '', text = '';
    rows.forEach(function (r, idx) {
      var cur = !!op && idx === rows.length - 1;
      var t = VN.interpolate(r.text, state.vars, S.program.cast), p = document.createElement('p');
      p.className = (cur ? 'cur' : 'old') + ((r.thought || VN.isThought(t)) ? ' thought' : '');
      if (r.kind === 'say') {
        var key = r.who ? r.who.toLowerCase() : '', w = document.createElement('span');
        w.className = 'who'; w.textContent = displayName(key, r.who); w.style.setProperty('--who-h', String(hueOf(key)));
        p.appendChild(w);
        if (cur) who = w.textContent;
      }
      var built = buildLine(p, t, r.refs);
      if (cur) { line = built; text = t; }
      nvlPage.appendChild(p);
    });
    // a page that has run out of room lets its oldest lines go
    var guard = 0;
    while (nvlPage.scrollHeight > nvlPage.clientHeight + 2 && nvlPage.children.length > 1 && guard++ < 60) nvlPage.removeChild(nvlPage.firstChild);
    if (line) typeLine(nvlEl, line, announceOf(who, text, op.refs), instant, op.kind === 'say' && op.key && !isThought(op, text) ? op.key : null);
    else nvlEl.classList.add('done');
  }
  function stopTyping() { if (S.typing) { S.typing.cancel(); S.typing = null; } }
  function completeLine() { if (S.typing) { var t = S.typing; S.typing = null; t.complete(); return true; } return false; }

  /* ------------------------------------------------------------------ KaTeX (lazy, optional) */

  var katexState = 0;   // 0 idle, 1 loading, 2 ready, 3 failed
  var katexWaiting = [];
  function loadKatex() {
    if (katexState) return;
    katexState = 1;
    var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = KATEX + 'katex.min.css';
    document.head.appendChild(link);
    var s = document.createElement('script'); s.src = KATEX + 'katex.min.js'; s.async = true;
    s.onload = function () { katexState = window.katex ? 2 : 3; var w = katexWaiting; katexWaiting = []; w.forEach(renderMath); };
    s.onerror = function () { katexState = 3; katexWaiting = []; };
    document.head.appendChild(s);
  }
  function renderMath(els) {
    if (!els || !els.length) return;
    if (katexState === 1) { katexWaiting.push(els); return; }
    if (katexState !== 2 || !window.katex) return;   // plain mono fallback stays
    els.forEach(function (el) {
      try { window.katex.render(el.getAttribute('data-tex'), el, { throwOnError: false, displayMode: false }); } catch (e) { /* keep text */ }
    });
  }

  /* ------------------------------------------------------------------ choices, title boards, inserts, ending */

  function showMenu(stop) {
    var opts = stop.options || [];
    var h = '';
    opts.forEach(function (o, i) {
      var text = VN && VN.interpolate ? VN.interpolate(o.text, stop.state.vars, S.program.cast) : o.text;
      h += '<button type="button" data-i="' + i + '"><span class="vn-key" aria-hidden="true">' + (i + 1) + '</span><span>' + esc(text) + '</span></button>';
    });
    menuEl.innerHTML = h;
    menuEl.classList.toggle('many', opts.length > 6);
    menuEl.classList.add('show');
    stage.classList.add('menu-up');
    holdMusic(true);
    placeMenu();
    $$('button', menuEl).forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); unlockAudio(e); choose(parseInt(b.getAttribute('data-i'), 10)); }); });
    announce('Choose: ' + opts.map(function (o, i) { return (i + 1) + '. ' + o.text; }).join(' '));
    if (!THUMB && !S.screen && mayFocus()) { var first = $('button', menuEl); if (first) first.focus({ preventScroll: true }); }
  }
  // The choices sit just above the text window (and its name plate), clear of the faces; a list too long for
  // that space scrolls. With no window (NVL page, boards, text-only) the stylesheet centres them.
  function placeMenu() {
    var st = menuEl.style;
    st.top = st.bottom = st.transform = st.maxHeight = '';
    if (!menuEl.classList.contains('show') || !box.classList.contains('show') || S.textOnly) return;
    var sr = stage.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (!sr.height || !br.height) return;
    var top = br.top - sr.top;
    if (nameEl.textContent) top = Math.min(top, nameEl.getBoundingClientRect().top - sr.top);
    var room = top - sr.height * 0.03 - sr.height * 0.05;      // a gap above the window, a margin under the top edge
    if (room < 120) return;                                     // no sensible space: keep the centred default
    st.top = 'auto'; st.transform = 'translateX(-50%)';
    st.bottom = (sr.height - top + sr.height * 0.03) + 'px';
    st.maxHeight = room + 'px';
  }
  window.addEventListener('resize', placeMenu);
  function choose(i) {
    if (!S.stop || S.stop.op.kind !== 'menu') return;
    var stop = S.run.choose(i);
    holdMusic(false);
    present(stop, { instant: REDUCED, live: true });
    if (mayFocus()) stage.focus({ preventScroll: true });
  }

  function showScene(op, instant) {
    box.classList.remove('show'); nvlEl.classList.remove('show');
    var chapter = op.kind === 'chapter';
    sceneEl.innerHTML = chapter
      ? '<div class="vn-title"><small>Chapter</small><span class="num">' + esc(op.n) + '</span><span class="rule brush"></span>' + esc(op.title) + '<span class="bloom" aria-hidden="true"></span></div>'
      : '<div class="vn-title">' + esc(op.title) + '<span class="rule"></span></div>';
    sceneEl.className = 'vn-scene show ' + (chapter ? 'chapter' : 'scene');
    if (instant) sceneEl.classList.add('in');
    else { void sceneEl.offsetWidth; sceneEl.classList.add('in'); }
    announce((chapter ? 'Chapter ' + op.n + (op.title ? ': ' : '') : 'Scene: ') + op.title);
    scheduleAuto(op.title.length + (chapter ? 50 : 20));
    if (S.skip) scheduleSkip();
  }

  function showBoard(op, instant) {
    box.classList.remove('show'); nvlEl.classList.remove('show');
    boardsEl.innerHTML = boardHtml(op);
    boardsEl.classList.add('show');
    var text = op.kind === 'withheld' ? op.text : (op.title || op.lang || '');
    if (op.kind === 'card') text += '. ' + (op.cells || []).map(function (c) { return (c.label ? c.label + ': ' : '') + c.value; }).join('; ');
    if (op.kind === 'chart') text += '. ' + (op.series || []).map(function (s) { return s.label + ' ' + (op.type === 'range' ? s.lo + ' to ' + s.hi : s.value); }).join('; ');
    if (op.kind === 'code') text = 'Code, ' + (op.lang || '') + ': ' + (op.lines || []).join(' / ');
    announce(text);
    scheduleAuto(text.length);
    if (S.skip) scheduleSkip();
  }

  function usedFacts() {
    var facts = S.program.facts || {}, used = {}, order = [];
    S.program.ops.forEach(function (op) {
      var chips = (op.chips || []).slice();
      (op.cells || []).forEach(function (c) { (c.chips || []).forEach(function (x) { chips.push(x); }); });
      (op.series || []).forEach(function (s) { (s.chips || []).forEach(function (x) { chips.push(x); }); });
      chips.forEach(function (c) { if (c && c.key && !used[c.key]) { used[c.key] = true; order.push(c.key); } });
    });
    if (!order.length) order = Object.keys(facts);
    return order.map(function (k) { return facts[k] || { key: k, value: '', ref: null }; });
  }

  // The ending: a staff roll that is also the citation card.
  function showEnd() {
    var m = S.program.meta, e = S.entry || {};
    var kindLabel = m.kind === 'blog' ? 'Blog post' : 'Paper';
    var date = m.date || (e.post && e.post.date) || null;
    var links = (m.links || []).slice(0, 2);
    var h = '<div class="vn-end-card" tabindex="-1">';
    if (m.verify) h += '<div class="vn-ribbon" title="figures not yet re-checked against the source">Unverified draft</div>';
    h += '<p class="vn-fin">Fin</p>';
    h += '<div class="vn-kicker">' + esc(kindLabel) + (date ? ' · ' + esc(date) : '') + ' · The end</div>';
    h += '<h2>' + esc(m.title || e.title || '') + '</h2>';
    h += '<div class="vn-rule"></div>';
    var credits = '';
    if (m.authors) credits += '<dt>' + (m.kind === 'blog' ? 'Written by' : 'Authors') + '</dt><dd class="vn-authors">' + esc(m.authors) + '</dd>';
    var cast = Object.keys(S.program.cast).map(function (k) { return S.program.cast[k]; }).filter(function (c) { return !c.page; }).map(function (c) { return c.name; });
    if (cast.length) credits += '<dt>Cast</dt><dd>' + esc(cast.join(', ')) + '</dd>';
    credits += '<dt>Script, stage, art</dt><dd>Paper Theatre, drawn in code</dd>';
    h += '<dl class="vn-credits">' + credits + '</dl>';
    if (m.cite) h += '<blockquote class="vn-cite">' + esc(m.cite) + '</blockquote>';
    h += '<div class="vn-links">';
    links.forEach(function (l, i) { h += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener"' + (i === 0 ? ' class="primary"' : '') + '>' + esc(l.label || (m.kind === 'blog' ? 'Read the post' : 'Read the paper')) + '</a>'; });
    if (m.arxiv && VN && VN.bibtex) h += '<button type="button" class="vn-bib">Copy BibTeX</button><span class="vn-copied" aria-live="polite"></span>';
    h += '<button type="button" class="vn-replay">Replay</button><button type="button" class="vn-totitle">Title</button></div>';
    var facts = usedFacts().filter(function (f) { return f.value; });
    if (facts.length) {
      h += '<h4>Figures used</h4><ul class="vn-facts">' + facts.map(function (f) {
        return '<li><span><small>' + esc(f.key.replace(/_/g, ' ')) + '</small> <b>' + esc(f.value) + '</b></span>' + (f.ref ? chipHtml(f.ref) : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (m.note) h += '<p class="vn-note">' + esc(m.note) + '</p>';
    var others = catalog.filter(function (c) { return c.id !== S.id; }).slice(0, 6);
    if (others.length) {
      h += '<h4>Other stories</h4><ul class="vn-others">' + others.map(function (c) {
        return '<li><button type="button" data-story="' + esc(c.id) + '">' + esc(c.title) + '<small>' + esc(groupOf(c)) + '</small></button></li>';
      }).join('') + '</ul>';
    }
    h += '<p class="vn-theend">紙芝居</p></div>';
    endEl.innerHTML = h;
    endEl.classList.add('show');
    stage.classList.add('no-window');
    var bib = $('.vn-bib', endEl);
    if (bib) bib.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var txt = VN.bibtex(m), out = $('.vn-copied', endEl);
      function ok() { out.textContent = 'copied'; setTimeout(function () { out.textContent = ''; }, 2000); }
      function fail() { window.prompt('Copy the BibTeX entry:', txt); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fail); else fail();
    });
    $('.vn-replay', endEl).addEventListener('click', function (ev) { ev.stopPropagation(); restart(false); });
    $('.vn-totitle', endEl).addEventListener('click', function (ev) { ev.stopPropagation(); showTitle(); });
    $$('button[data-story]', endEl).forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); openStory(b.getAttribute('data-story')); }); });
    announce('The end. ' + (m.title || '') + (m.cite ? '. ' + m.cite : ''));
    if (!THUMB && !S.screen && mayFocus()) { var card = $('.vn-end-card', endEl); if (card) card.focus({ preventScroll: true }); }
    if (S.auto) setAuto(false);
  }

  /* ------------------------------------------------------------------ advance / back / auto / skip / hide */

  function canAdvance() { return S.mode === 'play' && S.run && S.stop && S.stop.op.kind !== 'menu' && S.stop.op.kind !== 'end' && S.stop.op.kind !== 'error'; }

  function advance(o) {
    o = o || {};
    if (S.mode !== 'play' || !S.run || !S.stop) return;
    if (S.wait) { var w = S.wait; S.wait = null; clearTimeout(w.timer); endTransition(); w.fn(); if (!o.instant) return; }
    if (S.typing) { if (!o.instant) { completeLine(); return; } completeLine(); }
    if (!canAdvance()) return;
    clearTimeout(S.autoTimer); clearTimeout(S.pauseTimer);
    var stop = S.run.advance();
    present(stop, { instant: !!o.instant, live: !!o.live });
  }
  function back() {
    if (S.mode !== 'play' || !S.run) return;
    clearTimeout(S.autoTimer); clearTimeout(S.pauseTimer);
    if (S.auto) setAuto(false);
    var stop = S.run.back();
    while (stop && stop.op.kind === 'pause') stop = S.run.back();   // a beat is not a place to stand
    if (!stop) {
      toast('This is the beginning.');
      if (!S.run.current()) present(S.run.replay([], 1), { instant: true, back: true });
      return;
    }
    present(stop, { instant: true, back: true });
  }

  function setAuto(on) {
    S.auto = on;
    var b = qbtn('auto'); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    badges();
    clearTimeout(S.autoTimer);
    if (on) { if (S.skip) setSkip(false); if (!S.typing) scheduleAuto(60); }
  }
  function scheduleAuto(chars) {
    clearTimeout(S.autoTimer);
    if (!S.auto || document.hidden || !canAdvance() || S.screen) return;
    S.autoTimer = setTimeout(function () { if (S.auto && !document.hidden && !S.screen) advance(); }, (1200 + 35 * (chars || 0)) / prefs.autoSpeed);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(S.autoTimer);
    else if (S.auto && !S.typing) scheduleAuto(40);
    // the sound rests while the tab is hidden (never touched in a capture or a test run)
    if (CAN_UNLOCK) ext('VNAudio', document.hidden ? 'suspend' : 'resume');
  });

  function setSkip(on, unseen) {
    S.skip = on; S.skipUnseen = on && !!unseen;
    var b = qbtn('skip'); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    badges();
    clearTimeout(S.skipTimer);
    if (on) {
      if (S.auto) setAuto(false);
      S.seenAtSkipStart = Object.assign({}, S.run ? S.run.seen : {});
      if (S.wait) { var w = S.wait; S.wait = null; clearTimeout(w.timer); endTransition(); w.fn(); }
      if (S.typing) completeLine();
      scheduleSkip();
    } else syncEnabled(false);   // Skip is over: the living cast and the camera may move again
  }
  function scheduleSkip() {
    clearTimeout(S.skipTimer);
    if (!S.skip || !canAdvance()) { if (S.skip && !canAdvance()) setSkip(false); return; }
    S.skipTimer = setTimeout(function () {
      if (!S.skip || !canAdvance()) { setSkip(false); return; }
      clearTimeout(S.pauseTimer);
      var stop = S.run.advance();
      var unseen = !S.seenAtSkipStart[stop.index];
      if (unseen && !S.skipUnseen) { setSkip(false); present(stop, { instant: REDUCED, live: true }); return; }
      present(stop, { instant: true });
    }, 110);
  }
  function toggleSkip(shift) {
    if (S.skip) setSkip(false);
    else if (shift) { if (window.confirm('Skip text you have not read yet?')) setSkip(true, true); }
    else setSkip(true, false);
  }

  function setHidden(on) {
    S.hidden = on;
    stage.classList.toggle('ui-hidden', on);
    if (on) { setAuto(false); setSkip(false); announce('Text window hidden. Press any key to bring it back.'); }
  }

  function toggleFullscreen() {
    var el = document.documentElement;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen();
      else toast('Fullscreen is not available here.');
    } catch (e) { toast('Fullscreen is not available here.'); }
  }

  /* ------------------------------------------------------------------ save slots */

  function slotsKey() { return 'vn:slots:' + S.id; }
  function readSlots() { return STUDIO ? {} : (readJSON(slotsKey()) || {}); }
  function lastLineText(state) {
    var h = state.history || [];
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i].kind === 'say') return displayName((h[i].who || '').toLowerCase(), h[i].who) + ': ' + plainText(VN.interpolate(h[i].text, state.vars, S.program.cast));
      if (h[i].kind === 'narrate') return plainText(VN.interpolate(h[i].text, state.vars, S.program.cast));
      if (h[i].kind !== 'choice') return (h[i].title || h[i].text || h[i].kind);
    }
    return '';
  }
  function writeSlot(k) {
    if (!S.run || S.mode !== 'play') return false;
    if (STUDIO) { toast('The Studio preview does not save.'); return false; }
    if (S.noSlots) { toast('This place was reached by a deep link and cannot be saved.'); return false; }
    var snap = S.run.snapshot(), st = S.run.state, all = readSlots();
    snap.ts = Date.now();
    snap.chapter = st.chapter ? 'Chapter ' + st.chapter.n + (st.chapter.title ? ' · ' + st.chapter.title : '') : (st.label ? st.label : 'Prologue');
    snap.text = lastLineText(st).slice(0, 160);
    delete snap.seen;
    all[k] = snap;
    lsSet(slotsKey(), JSON.stringify(all));
    return true;
  }
  function loadSlot(k) {
    var d = readSlots()[k];
    if (!d) { toast(k === 'q' ? 'No quick save yet.' : 'That slot is empty.'); return; }
    beginPlay();
    var stop = S.run.replay(d.choiceLog, d.stopIndex);
    present(stop, { instant: true, resumed: true });
    toast(d.hash !== S.program.hash ? 'Loaded; the script changed since this save, so it was replayed by your choices.' : 'Loaded.', 2200);
  }

  /* ------------------------------------------------------------------ backlog rows (also the transcript) */

  function historyRows() {
    var rows = [], stops = 0, choices = 0;
    (S.run.state.history || []).forEach(function (h) {
      if (h.kind === 'choice') { stops++; choices++; rows.push({ h: h, stopIndex: null, choices: choices - 1 }); }
      else { stops++; rows.push({ h: h, stopIndex: stops, choices: choices }); }
    });
    return rows;
  }
  // History has no entries for menus or pauses, but both count as stops: walk a shadow run with the
  // same choices and note the stop number at which each recorded line was reached (for "rewind here").
  function stopIndexOfRows() {
    var h = S.run.state.history || [], log = S.run.state.choiceLog, target = S.run.state.stops, rows = [], hi = 0;
    if (!S.noSlots) {
      var shadow = VN.createRun(S.program, {}), stop = shadow.advance(), li = 0, guard = 0;
      while (stop && hi < h.length && guard++ < 100000) {
        var kind = stop.op.kind;
        if (kind === 'menu') {
          if (shadow.state.stops >= target || !log[li] || h[hi].kind !== 'choice') break;
          var vi = 0;
          for (var v = 0; v < stop.options.length; v++) if (stop.options[v].index === log[li].optionIndex) vi = v;
          rows.push({ h: h[hi++], stopIndex: null }); li++;
          stop = shadow.choose(vi);
          continue;
        }
        if (kind === 'error') break;
        if (kind !== 'pause' && kind !== 'end') rows.push({ h: h[hi++], stopIndex: shadow.state.stops });
        if (shadow.state.stops >= target || stop.done) break;
        stop = shadow.advance();
      }
    }
    // a run that began with a bare jump cannot be replayed: its rows rewind by stepping back instead
    for (; hi < h.length; hi++) rows.push({ h: h[hi], stopIndex: null, hist: S.noSlots && h[hi].kind !== 'choice' ? hi + 1 : null });
    return rows;
  }
  function rewindBack(histLen) {
    if (!S.run) return;
    var stop = S.run.current(), guard = 0;
    while (S.run.state.history.length > histLen && guard++ < 600) { var prev = S.run.back(); if (!prev) break; stop = prev; }
    if (!stop) stop = S.run.advance();
    present(stop, { instant: true, back: true });
    stage.focus({ preventScroll: true });
  }
  function rewindTo(stopIndex) {
    if (!S.run) return;
    var log = JSON.parse(JSON.stringify(S.run.state.choiceLog));
    var stop = S.run.replay(log, stopIndex);
    present(stop, { instant: true, back: true });
    stage.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ text-only transcript */

  function setTextOnly(on, persist) {
    S.textOnly = on;
    syncEnabled(false);
    document.body.classList.toggle('text-only', on);
    transcriptEl.setAttribute('aria-hidden', String(!on));
    if (persist) { prefs.textOnly = on; savePrefs(); }
    if (on && S.run && S.mode === 'play') { completeLine(); renderTranscript(); }
    if (!on && S.run && S.stop && S.mode === 'play') present(S.stop, { instant: true });
  }
  function renderTranscript() {
    if (!S.run) return;
    var rows = historyRows(), foot = [], footIdx = {};
    function fn(refs) {
      return (refs || []).map(function (r) {
        if (!footIdx[r]) { foot.push(r); footIdx[r] = foot.length; }
        return '<sup>' + footIdx[r] + '</sup>';
      }).join('');
    }
    var h = rows.map(function (r) {
      var e = r.h;
      if (e.kind === 'choice') return '<p class="pick">&gt; ' + esc(e.text) + '</p>';
      if (e.kind === 'say') return '<p' + (e.thought ? ' class="thought"' : '') + '><b>' + esc(displayName(e.who ? e.who.toLowerCase() : '', e.who)) + '</b>' + esc(plainText(VN.interpolate(e.text, S.run.state.vars, S.program.cast))) + fn(e.refs) + '</p>';
      if (e.kind === 'narrate') return '<p class="narr' + (e.thought ? ' thought' : '') + '">' + esc(plainText(VN.interpolate(e.text, S.run.state.vars, S.program.cast))) + fn(e.refs) + '</p>';
      if (e.kind === 'scene') return '<p class="scene">' + esc(e.title || e.text) + '</p>';
      if (e.kind === 'chapter') return '<p class="scene">Chapter ' + esc(e.n || '') + ' · ' + esc(e.title || '') + '</p>';
      return '<p class="board">' + esc(e.kind) + ': ' + esc(e.title || e.text || '') + fn(e.refs) + '</p>';
    }).join('');
    if (S.stop && S.stop.op.kind === 'end') h += '<p class="scene">The end</p>';
    if (foot.length) h += '<ol class="vn-foot">' + foot.map(function (r) { return '<li>' + esc(r) + ' — ' + esc(VN.describeRef(r)) + '</li>'; }).join('') + '</ol>';
    transcriptEl.innerHTML = h;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  /* ------------------------------------------------------------------ full-stage screens: save, load, config, log, chapters, issues */

  function focusables(root) {
    return $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', root).filter(function (el) { return el.offsetParent !== null; });
  }
  var SCREEN_TITLES = { save: ['Save', 'セーブ'], load: ['Load', 'ロード'], config: ['Config', '設定'], log: ['Backlog', '履歴'], chapters: ['Chapters', '章'], issues: ['Script issues', 'lint'] };

  function slotButtons(kind) {
    var all = readSlots(), h = '<ul class="vn-slots">';
    var keys = ['1', '2', '3', '4', '5', '6'];
    keys.forEach(function (k) {
      var d = all[k];
      h += '<li><button type="button" data-slot="' + k + '"' + (kind === 'load' && !d ? ' disabled' : '') + '><span class="no">Slot ' + k + '</span>' +
        (d ? '<span class="ch">' + esc(d.chapter || '') + '</span><span class="tx">' + esc(d.text || '') + '</span><span class="dt">' + esc(fmtDate(d.ts)) + '</span>' : '<span class="empty">— empty —</span>') + '</button></li>';
    });
    h += '</ul>';
    var q = all.q, a = autosave();
    h += '<div class="foot">' +
      (kind === 'load' ? '<button type="button" data-slot="q"' + (q ? '' : ' disabled') + '>Quick save' + (q ? ' · ' + esc(fmtDate(q.ts)) : ' · none') + '</button>' +
        '<button type="button" data-slot="auto"' + (a && a.choiceLog ? '' : ' disabled') + '>Autosave' + (a && a.ts ? ' · ' + esc(fmtDate(a.ts)) : ' · none') + '</button>' : '<span>Choose a slot to write. Your place is also kept automatically.</span>') +
      '</div>';
    return h;
  }
  function configHtml() {
    function row(id, label, min, max, step, val, out) {
      return '<label for="cf-' + id + '">' + label + '</label><input id="cf-' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output id="cfo-' + id + '">' + out + '</output>';
    }
    // rows for the optional modules: each is drawn only when its module was loaded at boot
    function vol(id, label) { var v = Math.round(prefs[id] * 100); return row(id, label, 0, 100, 1, v, v + '%'); }
    function sw(key, label) { return '<button type="button" data-sw="' + key + '" class="' + (prefs[key] ? 'on' : '') + '" aria-pressed="' + !!prefs[key] + '">' + label + '</button>'; }
    var sound = HAS.audio ? vol('music', 'Music') + vol('ambience', 'Ambience') + vol('sfx', 'Sound effects') +
      '<label>Sound</label><div class="row-btns">' + sw('mute', 'Mute') + sw('babble', 'Voices') + '</div>' : '';
    var pics = (HAS.paint ? sw('paint', 'Painted backgrounds') : '') + (HAS.live ? sw('live', 'Living cast') : '') + (HAS.camera ? sw('camera', 'Camera') : '') + (HAS.op ? sw('opening', 'Opening movie') : '');
    var picture = pics ? '<label>Picture</label><div class="row-btns">' + pics + '</div>' : '';
    var text = row('cps', 'Text speed', 15, 80, 1, prefs.cps, prefs.cps + ' cps') +
      row('auto', 'Auto speed', 0.5, 2.5, 0.1, prefs.autoSpeed, prefs.autoSpeed.toFixed(1) + '×') +
      row('opacity', 'Window opacity', 30, 100, 1, Math.round(prefs.opacity * 100), Math.round(prefs.opacity * 100) + '%') +
      row('size', 'Font size', 85, 135, 5, Math.round(prefs.size * 100), Math.round(prefs.size * 100) + '%');
    var effects = '<label>Effects</label><div class="row-btns"><button type="button" data-cf="fx-on" class="' + (prefs.effects ? 'on' : '') + '" aria-pressed="' + prefs.effects + '">On</button><button type="button" data-cf="fx-off" class="' + (prefs.effects ? '' : 'on') + '" aria-pressed="' + !prefs.effects + '">Off</button></div>';
    var reading = '<label>Reading</label><div class="row-btns"><button type="button" data-cf="text" class="' + (S.textOnly ? 'on' : '') + '" aria-pressed="' + S.textOnly + '">Text-only</button><button type="button" data-cf="theme">Theme: ' + currentTheme() + '</button><button type="button" data-cf="full">Fullscreen</button><button type="button" data-cf="help">Keys</button></div>' +
      (S.mode === 'play' ? '<label>Story</label><div class="row-btns"><button type="button" data-cf="restart">Restart</button><button type="button" data-cf="title">Title screen</button><button type="button" data-cf="stories">Back to stories</button></div>' : '');
    var foot = '<div class="foot"><span>Particles, transitions and shakes follow Effects; your system’s reduced-motion setting always wins.</span></div>';
    // with the sound rows the screen is set in two columns (reading on the left, sound and picture on the right);
    // without them it is the single column it has always been
    if (sound) return '<div class="vn-config-cols"><div class="vn-config">' + text + reading + '</div><div class="vn-config">' + sound + effects + picture + '</div></div>' + foot;
    return '<div class="vn-config">' + text + effects + picture + reading + '</div>' + foot;
  }
  function logHtml() {
    if (!S.run) return '<p>Nothing yet.</p>';
    var rows = stopIndexOfRows();
    if (!rows.length) return '<p>Nothing yet.</p>';
    var cur = S.run.state.stops, st = S.run.state;
    return '<ol class="vn-loglist">' + rows.map(function (r) {
      var h = r.h, cls, who = '', text;
      if (h.kind === 'choice') { cls = 'pick'; text = '› ' + esc(h.text); }
      else if (h.kind === 'say') { cls = 'say' + (h.thought ? ' thought' : ''); who = esc(displayName(h.who ? h.who.toLowerCase() : '', h.who)); text = esc(plainText(VN.interpolate(h.text, st.vars, S.program.cast))); }
      else if (h.kind === 'narrate') { cls = 'narr' + (h.thought ? ' thought' : ''); text = esc(plainText(VN.interpolate(h.text, st.vars, S.program.cast))); }
      else if (h.kind === 'chapter') { cls = 'chapter'; who = 'Chapter ' + esc(h.n || ''); text = esc(h.title || ''); }
      else { cls = 'board'; who = esc(h.kind); text = esc(h.title || h.text || ''); }
      return '<li class="' + cls + (r.stopIndex === cur ? ' cur' : '') + '"><span class="w">' + who + '</span><span class="t">' + text + chipsHtml(h.refs) + '</span>' +
        (r.stopIndex ? '<button type="button" data-rewind="' + r.stopIndex + '" title="rewind to this moment">rewind here</button>' :
          r.hist ? '<button type="button" data-hist="' + r.hist + '" title="rewind to this moment">rewind here</button>' : '<span></span>') + '</li>';
    }).join('') + '</ol>';
  }
  function chaptersHtml() {
    var list = (S.program && S.program.chapters) || [];
    seenList();
    if (!list.length) return '<p>This story has no chapters.</p>';
    return '<ul class="vn-chapters">' + list.map(function (c, i) {
      var ok = S.seenAll[c.index] || (S.entry && S.entry.src) || STUDIO;
      return '<li><button type="button" data-ch="' + i + '"' + (ok ? '' : ' disabled') + '><span class="num">' + esc(c.n) + '</span><span>' + (ok ? esc(c.title) : '— not reached yet —') + '</span></button></li>';
    }).join('') + '</ul>';
  }
  function issuesHtml() {
    return '<ol class="vn-issues">' + S.issues.map(function (i) { return '<li class="' + esc(i.level) + '">' + esc(i.level) + ' · ' + (i.file ? esc(i.file) + ' ' : '') + esc(i.msg) + (i.hint ? '<span class="hint">' + esc(i.hint) + '</span>' : '') + '</li>'; }).join('') + '</ol>';
  }

  function openScreen(kind) {
    if (!SCREEN_TITLES[kind] || !S.program) return;
    if (kind === 'save' && S.mode !== 'play') return;
    if (kind === 'save' && STUDIO) { toast('The Studio preview does not save.'); return; }
    if (kind === 'save' && S.noSlots) { toast('This place was reached by a deep link and cannot be saved.'); return; }
    // a full-screen menu is read over a picture that stands still (once per opening, not per redraw)
    if (!S.screen) { S.lastFocus = document.activeElement; ext('VNCamera', 'reset'); }
    S.screen = kind;
    clearTimeout(S.autoTimer);
    completeLine();
    var t = SCREEN_TITLES[kind];
    var body = kind === 'save' || kind === 'load' ? slotButtons(kind) : kind === 'config' ? configHtml() : kind === 'log' ? logHtml() : kind === 'chapters' ? chaptersHtml() : issuesHtml();
    screenEl.innerHTML = '<header><h2 id="vn-screen-title">' + esc(t[0]) + '<small>' + esc(t[1]) + '</small></h2><button type="button" data-close>Close · Esc</button></header><div class="body">' + body + '</div>';
    screenEl.hidden = false;
    screenEl.classList.add('show');
    screenEl.setAttribute('data-screen', kind);
    wireScreen(kind);
    var f = focusables(screenEl);
    if (kind === 'log') { var b = $('.body', screenEl); b.scrollTop = b.scrollHeight; }
    if (f.length) f[kind === 'log' ? 0 : Math.min(1, f.length - 1)].focus({ preventScroll: true });
    announce(t[0]);
  }
  function closeScreen(silent) {
    if (!S.screen && !screenEl.classList.contains('show')) return;
    S.screen = null;
    screenEl.classList.remove('show'); screenEl.hidden = true; screenEl.innerHTML = '';
    if (silent) return;
    var backTo = S.lastFocus && document.contains(S.lastFocus) && S.lastFocus.offsetParent !== null ? S.lastFocus : stage;
    try { backTo.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    if (S.auto && !S.typing) scheduleAuto(40);
    // back at the same stop: the camera, reset when the menu opened, takes its framing again without a move
    if (S.mode === 'play' && S.stop) { syncCamera(true); ext('VNCamera', 'present', S.stop.state, S.stop.op); syncCamera(S.skip); }
  }
  function wireScreen(kind) {
    $('button[data-close]', screenEl).addEventListener('click', function () { closeScreen(); });
    $$('button[data-slot]', screenEl).forEach(function (b) {
      b.addEventListener('click', function (ev) {
        var k = b.getAttribute('data-slot');
        if (kind === 'save') {
          if (readSlots()[k] && !window.confirm('Overwrite slot ' + k + '?')) return;
          if (writeSlot(k)) { openScreen('save'); toast('Saved to slot ' + k + '.', 1600); }
        } else {
          unlockAudio(ev);
          closeScreen(true);
          if (k === 'auto') continueSaved(); else loadSlot(k);
        }
      });
    });
    $$('button[data-rewind]', screenEl).forEach(function (b) {
      b.addEventListener('click', function () { var k = parseInt(b.getAttribute('data-rewind'), 10); closeScreen(true); rewindTo(k); });
    });
    $$('button[data-hist]', screenEl).forEach(function (b) {
      b.addEventListener('click', function () { var k = parseInt(b.getAttribute('data-hist'), 10); closeScreen(true); rewindBack(k); });
    });
    $$('button[data-ch]', screenEl).forEach(function (b) {
      b.addEventListener('click', function (ev) { var c = S.program.chapters[parseInt(b.getAttribute('data-ch'), 10)]; unlockAudio(ev); closeScreen(true); jumpChapter(c); });
    });
    if (kind !== 'config') return;
    function bind(id, fn) { var el = $('#cf-' + id, screenEl), out = $('#cfo-' + id, screenEl); el.addEventListener('input', function () { out.textContent = fn(parseFloat(el.value)); savePrefs(); applyPrefs(); }); }
    bind('cps', function (v) { prefs.cps = clamp(v, 15, 80); return prefs.cps + ' cps'; });
    bind('auto', function (v) { prefs.autoSpeed = clamp(v, 0.5, 2.5); return prefs.autoSpeed.toFixed(1) + '×'; });
    bind('opacity', function (v) { prefs.opacity = clamp(v / 100, 0.3, 1); return Math.round(prefs.opacity * 100) + '%'; });
    bind('size', function (v) { prefs.size = clamp(v / 100, 0.85, 1.35); return Math.round(prefs.size * 100) + '%'; });
    // the optional modules' rows (present only when the module is): volumes go to the audio at every move
    ['music', 'ambience', 'sfx'].forEach(function (id) {
      if ($('#cf-' + id, screenEl)) bind(id, function (v) { prefs[id] = clamp(v / 100, 0, 1); pushVolumes(); return Math.round(prefs[id] * 100) + '%'; });
    });
    $$('button[data-sw]', screenEl).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sw');
        prefs[k] = !prefs[k]; savePrefs();
        b.classList.toggle('on', prefs[k]); b.setAttribute('aria-pressed', String(prefs[k]));
        if (k === 'mute') setMute(prefs.mute);
        else if (k === 'paint') refreshPaint();
        else if (k === 'live' || k === 'camera') syncEnabled(false);
        // (opening is read when Start is pressed, babble while a line types)
      });
    });
    $$('button[data-cf]', screenEl).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-cf');
        if (k === 'fx-on' || k === 'fx-off') { prefs.effects = k === 'fx-on'; savePrefs(); applyPrefs(); syncEnabled(false); if (S.stop && S.mode === 'play') syncFx(S.stop.state); openScreen('config'); }
        else if (k === 'text') { setTextOnly(!S.textOnly, true); openScreen('config'); }
        else if (k === 'theme') { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true); openScreen('config'); }
        else if (k === 'full') toggleFullscreen();
        else if (k === 'help') { closeScreen(); toggleHelp(); }
        else if (k === 'restart') { if (window.confirm('Start this story over?')) { closeScreen(true); startFresh(); } }
        else if (k === 'title') { closeScreen(true); showTitle(); }
        else if (k === 'stories') { closeScreen(true); renderPicker(); }
      });
    });
  }
  screenEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var f = focusables(screenEl); if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  function toggleScreen(kind) { if (S.screen === kind) closeScreen(); else openScreen(kind); }

  /* ------------------------------------------------------------------ help overlay (page-level dialog) */

  function openOverlay(ov) {
    if (!ov) return;
    S.lastFocus = document.activeElement;
    ov.hidden = false; ov.classList.add('show');
    clearTimeout(S.autoTimer);
    var f = focusables(ov); if (f.length) f[0].focus();
  }
  function closeOverlay(ov) {
    if (!ov || !ov.classList.contains('show')) return;
    ov.classList.remove('show'); ov.hidden = true;
    var backTo = S.lastFocus && document.contains(S.lastFocus) ? S.lastFocus : stage;
    try { backTo.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    if (S.auto && !S.typing) scheduleAuto(40);
  }
  function openOverlayEl() { return $$('.vn-overlay.show')[0] || null; }
  $$('.vn-overlay').forEach(function (ov) {
    ov.addEventListener('click', function (e) { if (e.target === ov) closeOverlay(ov); });
    ov.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = focusables(ov); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });
  $$('.vn-close').forEach(function (b) { b.addEventListener('click', function () { closeOverlay($('#' + b.getAttribute('data-close'))); }); });
  function toggleHelp() { if (helpOverlay.classList.contains('show')) closeOverlay(helpOverlay); else openOverlay(helpOverlay); }

  /* ------------------------------------------------------------------ quick menu, top bar, header */

  quickEl.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-q]');
    if (!b) return;
    e.stopPropagation();
    // a mouse or touch click must not leave the focus on the button, or the next Space / Enter presses it again
    // instead of advancing; keyboard activation (detail 0) keeps the focus where the reader put it
    if (e.detail > 0) stage.focus({ preventScroll: true });
    var q = b.getAttribute('data-q');
    if (q === 'back') back();
    else if (q === 'qsave') { if (writeSlot('q')) toast('Quick saved.', 1400); }
    else if (q === 'qload') { unlockAudio(e); if (readSlots().q) loadSlot('q'); else toast('No quick save yet.'); }
    else if (q === 'save') openScreen('save');
    else if (q === 'load') openScreen('load');
    else if (q === 'auto') setAuto(!S.auto);
    else if (q === 'skip') toggleSkip(e.shiftKey);
    else if (q === 'log') openScreen('log');
    else if (q === 'config') openScreen('config');
    else if (q === 'hide') setHidden(true);
    else if (q === 'mute') setMute(!prefs.mute);
  });
  if (btnFull) btnFull.addEventListener('click', function (e) { e.stopPropagation(); if (e.detail > 0 && S.mode === 'play') stage.focus({ preventScroll: true }); toggleFullscreen(); });
  if (btnTitle) btnTitle.addEventListener('click', function (e) { e.stopPropagation(); if (S.program) showTitle(); });
  if (btnIssues) btnIssues.addEventListener('click', function (e) { e.stopPropagation(); openScreen('issues'); });
  if (btnHelp) btnHelp.addEventListener('click', toggleHelp);
  if (selectEl) selectEl.addEventListener('change', function () { if (selectEl.value) openStory(selectEl.value); else renderPicker(); });
  nameEl.addEventListener('click', function (e) { e.stopPropagation(); openScreen('log'); });

  /* ------------------------------------------------------------------ keyboard */

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    var inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
    var ov = openOverlayEl(), k = e.key;
    if (S.opening) {
      // the opening movie handles its own keys; Escape always ends the wait, F and M keep working
      if (k === 'Escape') { e.preventDefault(); ext('VNOp', 'stop'); S.opening.finish(); }
      else if (k === 'F' || k === 'f') toggleFullscreen();
      else if ((k === 'M' || k === 'm') && HAS.audio) setMute(!prefs.mute);
      return;
    }
    if (k === 'Escape') {
      if (ov) { e.preventDefault(); closeOverlay(ov); return; }
      if (S.screen) { e.preventDefault(); closeScreen(); return; }
      if (S.hidden) { setHidden(false); return; }
      if (S.auto) { setAuto(false); return; }
      if (S.skip) { setSkip(false); return; }
      if (S.mode === 'play' && !document.fullscreenElement) { showTitle(); return; }
      return;
    }
    if (ov) return;                    // dialogs own the rest of the keys
    if (S.screen) return;
    if (inField) {
      if (tag === 'SELECT' && (k === 'Enter' || k === ' ')) return;
      if (tag === 'INPUT' && t.type === 'range') return;
      if (tag === 'SELECT') return;
    }
    if (S.hidden) { e.preventDefault(); setHidden(false); return; }   // any key brings the window back
    if (k === 'D' || k === 'd') { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true); return; }
    if (k === '?') { e.preventDefault(); toggleHelp(); return; }
    if ((k === 'M' || k === 'm') && HAS.audio && S.mode !== 'picker') { setMute(!prefs.mute); toast(prefs.mute ? 'Sound off' : 'Sound on', 1200); return; }
    // P: the presenter view in a second window (a real key press only, and not while typing in a field)
    if ((k === 'P' || k === 'p') && e.isTrusted && !inField && S.program && !S.blocked && S.mode !== 'picker') { openPresenter(); return; }
    if (S.mode === 'title') {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        var tb = $$('.ts-menu button:not([disabled])', titleEl); if (!tb.length) return;
        var ti = tb.indexOf(document.activeElement);
        e.preventDefault(); tb[ti < 0 ? 0 : (ti + (k === 'ArrowDown' ? 1 : tb.length - 1)) % tb.length].focus();
      } else if ((k === 'Enter' || k === ' ') && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); var fb = $('button[data-t="continue"]', titleEl) || $('button[data-t="start"]', titleEl); if (fb) { unlockAudio(e); fb.click(); } }
      else if (k === 'F' || k === 'f') toggleFullscreen();
      else if (k === 'C' || k === 'c') openScreen('config');
      return;
    }
    if (S.mode !== 'play') return;
    if (k === 'F' || k === 'f') { toggleFullscreen(); return; }
    if (k === 'T' || k === 't') { setTextOnly(!S.textOnly, true); return; }
    if (k === 'C' || k === 'c') { openScreen('config'); return; }
    if (k === 'H' || k === 'h') { setHidden(true); return; }
    if (k === 'F5') { e.preventDefault(); if (writeSlot('q')) toast('Quick saved.', 1400); return; }
    if (k === 'F9') { e.preventDefault(); unlockAudio(e); if (readSlots().q) loadSlot('q'); else toast('No quick save yet.'); return; }
    if (!S.run) return;
    if (k === ' ' || k === 'Enter' || k === 'ArrowRight') {
      if (t && (tag === 'BUTTON' || tag === 'A') && k !== 'ArrowRight') return;   // native activation: quick menu, choices, ending
      e.preventDefault();
      if (S.stop && S.stop.op.kind === 'menu') { var first = $('button', menuEl); if (first && !menuEl.contains(t)) first.focus(); return; }
      unlockAudio(e);     // the key that advances the story is a gesture the sound may start from
      if (k === ' ' && e.repeat) {           // hold Space: skip
        var now = performance.now();
        if (now - S.holdLast < 120) return;
        S.holdLast = now;
        if (S.typing) completeLine(); else advance({ instant: true });
        return;
      }
      if (e.repeat) return;
      if (S.auto) setAuto(false);
      advance();
      return;
    }
    if (k === 'ArrowLeft' || k === 'Backspace') { e.preventDefault(); back(); return; }
    if (k === 'A' || k === 'a') { setAuto(!S.auto); return; }
    if (k === 'S' || k === 's') { toggleSkip(e.shiftKey); return; }
    if (k === 'L' || k === 'l') { openScreen('log'); return; }
    if (k === 'R' || k === 'r') { restart(true); return; }
    if ((k === 'ArrowDown' || k === 'ArrowUp') && S.stop && S.stop.op.kind === 'menu') {
      var bs = $$('button', menuEl); if (!bs.length) return;
      var at = bs.indexOf(document.activeElement);
      var nx = at < 0 ? 0 : (at + (k === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length;
      e.preventDefault(); bs[nx].focus();
      return;
    }
    if (/^[1-9]$/.test(k) && S.stop && S.stop.op.kind === 'menu') {
      var i = parseInt(k, 10) - 1;
      if (i < (S.stop.options || []).length) { e.preventDefault(); unlockAudio(e); choose(i); }
      return;
    }
  });

  /* ------------------------------------------------------------------ pointer + touch */

  var ptr = null, longTimer = 0;
  function interactive(target) {
    return !!(target.closest && target.closest('button, a, abbr, input, select, .vn-end, .vn-picker, .vn-panel, .vn-transcript, .vn-screen, .vn-titlescreen, .vn-quick, .vn-topbar'));
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || S.opening) return;     // while the opening movie plays the pointer is its own
    ptr = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, target: e.target, consumed: false };
    clearTimeout(longTimer);
    if (e.pointerType === 'touch' && S.mode === 'play' && !interactive(e.target)) {
      longTimer = setTimeout(function () { if (ptr) { ptr.consumed = true; setAuto(!S.auto); toast(S.auto ? 'Auto on' : 'Auto off', 1200); } }, 600);
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!ptr) return;
    if (Math.abs(e.clientX - ptr.x) > 10 || Math.abs(e.clientY - ptr.y) > 10) clearTimeout(longTimer);
  });
  stage.addEventListener('pointerup', function (e) {
    clearTimeout(longTimer);
    if (!ptr || ptr.id !== e.pointerId) { ptr = null; return; }
    var p = ptr; ptr = null;
    if (p.consumed) return;
    if (S.mode !== 'play' || S.opening) return;
    if (S.hidden) { setHidden(false); return; }
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (e.pointerType === 'touch' && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      ghostUntil = performance.now() + 450;
      if (dx < 0) { unlockAudio(e); advance(); } else back();
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    if (interactive(p.target)) return;
    if (p.target.closest && p.target.closest('.vn-name')) return;
    if (!S.run) return;
    if (S.stop && S.stop.op.kind === 'menu') return;
    if (S.auto) setAuto(false);
    if (e.pointerType === 'touch') ghostUntil = performance.now() + 450;
    unlockAudio(e);     // the click or tap that advances the story is a gesture the sound may start from
    advance();
    if (document.activeElement !== stage && !(document.activeElement && menuEl.contains(document.activeElement))) stage.focus({ preventScroll: true });
  });
  // After a touch the browser sends a click to whatever is under the finger by then. When the tap has just
  // advanced the story that can be a choice bar or an end-card button that was not there when the finger came
  // down: swallow that one click so a tap never answers a question the reader has not seen.
  var ghostUntil = 0;
  stage.addEventListener('click', function (e) {
    if (e.detail > 0 && performance.now() < ghostUntil && e.target.closest && e.target.closest('button, a')) { e.preventDefault(); e.stopPropagation(); }
    ghostUntil = 0;
  }, true);
  stage.addEventListener('pointercancel', function () { ptr = null; clearTimeout(longTimer); });
  // right-click: hide the window to look at the picture, as in any visual novel
  stage.addEventListener('contextmenu', function (e) {
    if (S.mode !== 'play' || S.screen || S.opening || interactive(e.target)) return;
    e.preventDefault();
    setHidden(!S.hidden);
  });

  /* ------------------------------------------------------------------ Studio preview and presenter view (BroadcastChannel) */

  // The op index of the stop a source line belongs to: the first stop at or after that line (a caret on a
  // continuation line, or on any option of a menu, belongs to the statement it is part of).
  function stopFrom(index) {
    var ops = S.program.ops;
    for (var i = Math.max(0, index); i < ops.length; i++) if (VN.BLOCKING[ops[i].kind]) return i;
    return ops.length - 1;
  }
  function opAtLine(line) {
    var ops = S.program.ops, src = S.source != null ? String(S.source).split(/\r\n|\r|\n/) : null;
    line = Math.max(1, parseInt(line, 10) || 1);
    if (src) while (line > 1 && /^[ \t]+\S/.test(src[line - 1] || '') && (src[line - 2] || '').trim()) line--;
    for (var i = 0; i < ops.length; i++) {
      if (!VN.BLOCKING[ops[i].kind]) continue;
      var end = ops[i].kind === 'menu' && ops[i].options.length ? ops[i].options[ops[i].options.length - 1].line : ops[i].line;
      if (end >= line) return i;
    }
    return ops.length - 1;
  }
  // Go to the stop at op `index`: by replaying a route of choices from the top where one exists (the reader's own
  // choices first), so the moment is an ordinary one; else by a bare jump with the stage dressed in file order.
  function studioGoto(index) {
    if (!S.program || S.blocked) return;
    var route = VN.routeTo(S.program, index, { prefer: S.run ? S.run.state.choiceLog : [] }), stop = null;
    beginPlay();
    if (route) stop = S.run.replay(route.choiceLog, route.stopIndex);
    if (!stop || stop.index !== index) { S.run = newRun(); stop = S.run.jumpTo(index); S.noSlots = true; }
    present(stop, { instant: true });
  }

  // ?studio=1: a live preview driven by the Studio page (same origin: another window, or the frame around this one).
  //   in:  {type:'reload'} | {type:'goto', line} | {type:'goto', label}
  //   out: {type:'ready', title, issues:[{level, line, msg, code}]} after each load, {type:'stop', line, index, kind} after each present
  var studioCh = null, studioLine = null;
  function studioPost(msg) { if (studioCh) { try { studioCh.postMessage(msg); } catch (e) { /* closed */ } } }
  function studioReload() {
    if (!S.lastDesc) return;
    loadStory(S.lastDesc, { line: studioLine });
  }
  function onStudio(ev) {
    var m = ev && ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'reload') studioReload();
    else if (m.type === 'goto' && S.program && !S.blocked) {
      if (m.line != null) studioGoto(opAtLine(m.line));
      else if (m.label != null) {
        if (S.program.labels[m.label] == null) toast('No label “' + m.label + '” in this story.', 2600);
        else studioGoto(stopFrom(S.program.labels[m.label]));
      }
    }
  }

  // The presenter view (presenter.html, opened with P) follows the stage and can drive it.
  //   out: {type:'stop', id, src, hash, choiceLog, stopIndex, index, line, kind, done} after each present,
  //        {type:'title', id, src, hash} when the title screen opens; the latest one again in answer to {type:'hello'}
  //   in:  {type:'hello'} | {type:'advance'} | {type:'back'} | {type:'choose', i}   (a message with an `id` is for that story only)
  // Positions only, never text: the presenter rebuilds the lines from the script itself.
  var presCh = null, presLast = null;
  function presenterPost(msg) {
    if (THUMB) return;
    presLast = msg;
    if (presCh) { try { presCh.postMessage(msg); } catch (e) { /* closed */ } }
  }
  function announceStop(stop) {
    var op = stop.op;
    if (STUDIO) { if (op.line > 0) studioLine = op.line; studioPost({ type: 'stop', line: op.line | 0, index: stop.index, kind: op.kind }); }
    presenterPost({
      type: 'stop', id: S.id, src: (S.entry && S.entry.src) || null, hash: S.program.hash,
      choiceLog: JSON.parse(JSON.stringify(S.run.state.choiceLog)), stopIndex: S.run.state.stops,
      index: stop.index, line: op.line | 0, kind: op.kind, done: !!stop.done
    });
  }
  function onPresenter(ev) {
    var m = ev && ev.data;
    if (!m || typeof m !== 'object') return;
    if (m.id != null && m.id !== S.id) return;
    if (m.type === 'hello') { if (presLast && presCh) { try { presCh.postMessage(presLast); } catch (e) { /* closed */ } } return; }
    if (S.mode !== 'play' || !S.run || S.screen || S.opening || openOverlayEl()) return;
    if (m.type === 'advance') {
      // the reader's own advance: the first one completes a line that is still typing; a question waits for a choice
      if (S.hidden) { setHidden(false); return; }
      if (S.stop && S.stop.op.kind === 'menu') return;
      if (S.auto) setAuto(false);
      advance();
    } else if (m.type === 'back') back();
    else if (m.type === 'choose') {
      var i = parseInt(m.i, 10);
      if (S.stop && S.stop.op.kind === 'menu' && i >= 0 && i < (S.stop.options || []).length) choose(i);
    }
  }
  function openChannels() {
    if (typeof BroadcastChannel !== 'function' || THUMB) return;
    try {
      presCh = new BroadcastChannel('vn:presenter'); presCh.onmessage = onPresenter;
      if (STUDIO) { studioCh = new BroadcastChannel('vn:studio'); studioCh.onmessage = onStudio; }
    } catch (e) { presCh = presCh || null; }
  }
  // the same story, by the same parameter this page was given: story=<id>, src=<path>, src=draft:<key>, or post=<slug>
  function presenterUrl() {
    var e = S.entry || {};
    if (e.src) return 'presenter.html?src=' + encodeURIComponent(e.src);
    if (e.auto && e.slug) return 'presenter.html?post=' + encodeURIComponent(e.slug);
    return 'presenter.html?story=' + encodeURIComponent(S.id);
  }
  function openPresenter() {
    try { window.open(presenterUrl(), 'vn-presenter', 'popup=yes,width=1180,height=760'); } catch (e) { /* blocked */ }
  }

  /* ------------------------------------------------------------------ cast sheet (?cast=1) and scenery gallery (?gallery=bg|cg) */

  function castGrid(program) {
    var faces = (VN && VN.FACES) || ['neutral', 'smile', 'puzzled', 'worried', 'surprised', 'thinking', 'deadpan', 'laugh'];
    var decls = [];
    if (program) Object.keys(program.cast).forEach(function (k) { decls.push(program.cast[k]); });
    else {
      var base = { glasses: false, hat: false, lattice: null, player: false, page: false, coauthor: false, skin: 3, hair: 'short' };
      [
        { id: 'Jack', hue: 210, glasses: true, hair: 'short', clothes: 'coat' },
        { id: 'Long', hue: 28, hair: 'long', skin: 2, clothes: 'cardigan', build: 'fem', hairhue: 340 },
        { id: 'Bob', hue: 330, hair: 'bob', skin: 1, clothes: 'uniform', build: 'fem' },
        { id: 'Ponytail', hue: 140, hair: 'ponytail', skin: 3, clothes: 'hoodie', build: 'fem', hairhue: 30 },
        { id: 'Bun', hue: 120, hair: 'bun', skin: 4, clothes: 'shirt' },
        { id: 'Curly', hue: 10, hair: 'curly', skin: 5, clothes: 'cardigan' },
        { id: 'None', hue: 250, hair: 'none', skin: 1, clothes: 'coat', build: 'masc' },
        { id: 'Hood', hue: 230, hair: 'hood', clothes: 'hoodie' },
        { id: 'Hat', hue: 40, hair: 'short', hat: true, glasses: true, clothes: 'shirt' },
        { id: 'Model', hue: 192, lattice: 'sparse' },
        { id: 'Coder', hue: 300, lattice: 'dense' },
        { id: 'You', hue: 20, player: true },
        { id: 'Page', hue: 40, page: true }
      ].forEach(function (d) { var x = Object.assign({}, base, d); x.key = x.id.toLowerCase(); x.name = x.id; decls.push(x); });
    }
    var frame = $('.vn-frame');
    frame.style.display = 'none';
    var grid = document.createElement('div'); grid.className = 'vn-castgrid' + (params.get('mod') === 'night' ? ' night' : '');
    grid.innerHTML = decls.map(function (d) {
      return '<h2>' + esc(d.name || d.id) + ' <small>(' + esc([d.hair, d.clothes, d.glasses ? 'glasses' : '', d.hat ? 'hat' : '', d.build || '', d.hairhue != null ? 'hairhue=' + d.hairhue : '', d.lattice ? 'lattice=' + d.lattice : '', d.player ? 'player' : '', d.page ? 'page' : '', 'hue=' + d.hue, 'skin=' + d.skin].filter(Boolean).join(' ')) + ')</small></h2><div class="row">' +
        faces.map(function (f) { return '<div class="cell">' + artSprite(d, f) + '<small>' + esc(f) + '</small></div>'; }).join('') + '</div>';
    }).join('');
    $('main').insertBefore(grid, frame);
    setStatus('cast sheet');
  }
  function gallery(kind) {
    var frame = $('.vn-frame'), mod = params.get('mod') || '', only = (params.get('only') || '').split(',').filter(Boolean);
    frame.style.display = 'none';
    var names = kind === 'cg' ? (ART.CGS || []).concat(['(fallback)']) : (ART.BACKGROUNDS || []);
    if (only.length) names = only;
    var grid = document.createElement('div'); grid.className = 'vn-gallery';
    var gopts = {}; if (params.get('overcast') === '1') gopts.overcast = true; if (params.get('board')) gopts.board = params.get('board'); if (params.get('text')) gopts.text = params.get('text');
    grid.innerHTML = names.map(function (n) { return '<figure>' + (kind === 'cg' ? artCg(n, mod, gopts) : artBackground(n, mod, gopts)) + '<figcaption>' + esc(n + (mod ? ' ' + mod : '')) + '</figcaption></figure>'; }).join('');
    $('main').insertBefore(grid, frame);
    setStatus(kind === 'cg' ? 'event illustrations' : 'backgrounds' + (mod ? ' (' + mod + ')' : ''));
  }

  /* ------------------------------------------------------------------ boot */

  // The optional modules get their first settings, and the controls that exist only with a module are put in.
  function bootModules() {
    // a module that rests for this whole run (a capture, a test) is told so once and then never called
    if (TESTRUN) ['VNPaint', 'VNLive', 'VNCamera'].forEach(function (m) { if (OFF[m] && !HOOK_OFF[m]) callMod(m, 'setEnabled', [false]); });
    ext('VNCamera', 'attach', stage);
    pushVolumes();
    syncEnabled(false);
    if (HAS.audio) {
      var mb = document.createElement('button');
      mb.type = 'button'; mb.setAttribute('data-q', 'mute'); mb.setAttribute('aria-pressed', String(prefs.mute)); mb.title = 'sound on / off (M)'; mb.textContent = 'Mute';
      if (prefs.mute) mb.classList.add('on');
      quickEl.insertBefore(mb, qbtn('config'));
    }
    // help rows that describe a module's key appear with the module
    $$('[data-if]').forEach(function (el) { if (HAS[el.getAttribute('data-if')]) el.hidden = false; });
  }

  function boot() {
    if (!CASTGRID && !GALLERY) { bootModules(); openChannels(); }
    if (prefs.textOnly && !THUMB && !CASTGRID && !GALLERY) setTextOnly(true, false);
    if (!VN) { showEngineMissing(); return; }
    if (GALLERY && ART) { gallery(GALLERY); return; }
    if (location.protocol === 'file:') { showFileMessage(); return; }
    var manifestP = fetchJSON('stories/index.json').then(function (j) { allManifest = Array.isArray(j) ? j : []; }).catch(function () { allManifest = []; });
    Promise.all([manifestP, loadPosts()]).then(function () {
      buildCatalog();
      fillSelect();
      var src = params.get('src'), story = params.get('story'), post = params.get('post'), at = params.get('at');
      if (CASTGRID) {
        if (src) return readSource(src).then(function (t) { return fetchIncludes(t, sourceDirs(src)).then(function (inc) { castGrid(VN.parse(t, { id: 'src', includes: inc })); }); });
        var e = story && findEntry(story);
        if (e && !e.auto) return fetchText('stories/' + e.file).then(function (t) { return fetchIncludes(t, ['stories/']).then(function (inc) { castGrid(VN.parse(t, { id: e.id, includes: inc })); }); });
        castGrid(null); return;
      }
      if (src) { setStatus('Previewing ' + src); return loadStory({ src: src }, { at: at }); }
      if (post) {
        var claimed = catalog.filter(function (c) { return c.slug === post && !c.auto; })[0];
        if (claimed) return openStory(claimed.id, { at: at });
        var autoEntry = findEntry('post:' + post);
        if (autoEntry) return openStory(autoEntry.id, { at: at });
        var p = postBySlug[post];
        if (p && p.file) return loadStory({ id: 'post:' + post, title: p.title, kind: 'blog', status: 'published', auto: true, post: p, slug: post }, { at: at });
        renderPicker('No post called “' + post + '”.'); return;
      }
      if (THUMB) {
        var want = story || DEFAULT_STORY;
        var rawT = allManifest.filter(function (m) { return m.id === want; })[0] || allManifest.filter(function (m) { return m.id === DEFAULT_STORY; })[0];
        var te = rawT ? entryFromManifest(rawT) : (findEntry(want) || catalog[0]);
        if (te) return loadStory(te, {});
        return loadStory({ id: DEFAULT_STORY, file: DEFAULT_STORY + '.vn', title: DEFAULT_STORY }, {});
      }
      if (story) {
        var se = findEntry(story);
        if (se) return openStory(story, { at: at });
        // a draft hidden by status, or an id not in the manifest: try the file directly
        var raw = allManifest.filter(function (m) { return m.id === story; })[0];
        if (raw) return loadStory(entryFromManifest(raw), { at: at });
        renderPicker('No story called “' + story + '”.'); return;
      }
      renderPicker();
    });
  }

  // Test hook for the browser harness (read-only by convention): the live run state, prefs and catalogue, and
  // which optional modules are loaded (has), resting (off) or forced by a URL hook (force).
  window.__vnStage = { S: S, prefs: prefs, catalog: function () { return catalog; }, mods: { has: HAS, off: OFF, force: FORCE } };

  boot();
})();
