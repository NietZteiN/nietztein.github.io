/*
 * Paper Theatre - stage.js (browser only).
 *
 * The renderer: story picker, kamishibai stage layers, typewriter, menus,
 * boards, end card, backlog, text-only transcript, save/resume, deep links,
 * theme, keyboard and touch. Pure logic lives in vn.js (window.VN) and the
 * procedural art in art.js (window.VNArt). Both are optional at load time:
 * without VNArt the stage draws grey placeholders; without VN it shows an
 * "engine not loaded" panel instead of crashing.
 */
(function () {
  'use strict';

  var VN = window.VN || null;
  var ART = window.VNArt || null;
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var CASTGRID = params.get('cast') === '1';
  var DRAFTS = params.get('drafts') === '1';
  var AUTOPLAY = params.get('autoplay');   // test hook: advance N stops instantly (option 1 at menus); "end" runs to the end card
  var REDUCED = THUMB || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/';
  var DEFAULT_STORY = 'obfuscation';

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

  /* ------------------------------------------------------------------ DOM */

  var stage = $('#stage');
  var bgA = $('.vn-bg-a'), bgB = $('.vn-bg-b');
  var slots = { left: $('.vn-slot.left'), center: $('.vn-slot.center'), right: $('.vn-slot.right') };
  var cg = $('.vn-cg');
  var box = $('.vn-box'), nameEl = $('.vn-name'), textEl = $('.vn-text');
  var live = $('.vn-live');
  var menuEl = $('.vn-menu');
  var sceneEl = $('.vn-scene');
  var endEl = $('.vn-end');
  var pickerEl = $('.vn-picker');
  var panelEl = $('.vn-panel');
  var badgesEl = $('.vn-badges');
  var toastEl = $('.vn-toast');
  var transcriptEl = $('.vn-transcript');
  var selectEl = $('#story');
  var statusEl = $('#status');
  var errorsEl = $('#errors'), errorsN = $('#errors-n'), errorsList = $('#errors-list');
  var btn = {
    back: $('#btn-back'), auto: $('#btn-auto'), skip: $('#btn-skip'), log: $('#btn-log'),
    text: $('#btn-text'), help: $('#btn-help'), restart: $('#btn-restart'), theme: $('#btn-theme')
  };
  var cpsEl = $('#cps'), cpsVal = $('#cps-val');
  var logOverlay = $('#log'), logList = $('#log-list');
  var helpOverlay = $('#help');

  /* ------------------------------------------------------------------ prefs + theme */

  var prefs = Object.assign({ cps: 28, textOnly: false, sound: false, size: 1 }, readJSON('vn:prefs') || {});
  prefs.cps = clamp(parseInt(prefs.cps, 10) || 28, 15, 80);
  function savePrefs() { lsSet('vn:prefs', JSON.stringify(prefs)); }

  var themeOverride = params.get('theme');
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function applyTheme(t, persist) {
    document.documentElement.setAttribute('data-theme', t);
    if (btn.theme) { btn.theme.textContent = t === 'dark' ? '☀' : '☾'; btn.theme.setAttribute('aria-label', t === 'dark' ? 'switch to light theme' : 'switch to dark theme'); }
    if (persist) lsSet('theme', t);
  }
  applyTheme(themeOverride === 'light' || themeOverride === 'dark' ? themeOverride : currentTheme(), false);
  if (btn.theme) btn.theme.addEventListener('click', function () { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true); });
  window.addEventListener('storage', function (e) { if (e.key === 'theme' && (e.newValue === 'light' || e.newValue === 'dark')) applyTheme(e.newValue, false); });
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) { if (!lsGet('theme') && !themeOverride) applyTheme(e.matches ? 'dark' : 'light', false); });
    } catch (e) { /* older engines */ }
  }
  if (REDUCED) document.documentElement.setAttribute('data-reduced-motion', '1');
  if (THUMB) document.body.classList.add('thumb');

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

  /* ------------------------------------------------------------------ art adapter */

  function placeholderSvg(w, h, label, fill) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect width="' + w + '" height="' + h + '" fill="' + (fill || 'var(--vn-bg-2)') + '"/>' +
      '<text x="' + (w / 2) + '" y="' + (h / 2) + '" text-anchor="middle" font-family="system-ui, sans-serif" font-size="' + Math.round(h / 20) + '" fill="var(--vn-ink-3)">' + esc(label) + '</text></svg>';
  }
  function artBackground(name, mod) {
    if (ART && typeof ART.background === 'function') {
      try { var s = ART.background(name, mod); if (s) return s; } catch (e) { console.warn('art.background failed', e); }
    }
    return '<svg viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="vnph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--vn-bg-2)"/><stop offset="1" stop-color="var(--vn-bg)"/></linearGradient></defs>' +
      '<rect width="1600" height="900" fill="url(#vnph)"/><rect x="0" y="620" width="1600" height="280" fill="var(--vn-bg-3)" opacity="0.5"/>' +
      '<text x="40" y="60" font-family="system-ui, sans-serif" font-size="26" fill="var(--vn-ink-3)">' + esc(name + (mod ? ' (' + mod + ')' : '')) + '</text></svg>';
  }
  function artSprite(decl, face) {
    if (ART && typeof ART.sprite === 'function') {
      try { var s = ART.sprite(decl, face); if (s) return s; } catch (e) { console.warn('art.sprite failed', e); }
    }
    var hue = decl && typeof decl.hue === 'number' ? decl.hue : 0;
    var label = (decl && decl.name) || '?';
    return '<svg viewBox="0 0 500 900" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect x="110" y="330" width="280" height="570" rx="60" fill="hsl(' + hue + ' 18% 62%)" opacity="0.85"/>' +
      '<circle cx="250" cy="230" r="110" fill="var(--vn-skin-2)" opacity="0.9"/>' +
      '<text x="250" y="880" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" fill="var(--vn-ink)" opacity="0.6">' + esc(label) + (face && face !== 'neutral' ? ' (' + esc(face) + ')' : '') + '</text></svg>';
  }
  function artBoard(op) {
    if (ART) {
      var fn = typeof ART[op.kind] === 'function' ? ART[op.kind] : (typeof ART.board === 'function' ? ART.board : null);
      if (fn) { try { var s = fn(op); if (s) return s; } catch (e) { console.warn('art.' + op.kind + ' failed', e); } }
    }
    return null;
  }
  function boardHtml(op) {
    var art = artBoard(op);
    if (art) return art;
    var h = '<div class="vn-board vn-board-' + op.kind + '">';
    if (op.kind === 'card') {
      h += '<div class="vn-kicker">Card</div><h3>' + esc(op.title) + chipsHtml(op.refs) + '</h3><ul>';
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
    var groups = [['Papers', []], ['Posts', []], ['Coming soon', []]];
    catalog.forEach(function (e) { for (var i = 0; i < groups.length; i++) if (groups[i][0] === groupOf(e)) groups[i][1].push(e); });
    var h = '<div class="vn-bill"><h2>Paper Theatre</h2><p class="vn-lede">Every paper and post as a two-minute visual novel: a hook, a question, a bet, the result as the source printed it, a citation.</p>';
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
    $$('button[data-story]', pickerEl).forEach(function (b) {
      b.addEventListener('click', function () { openStory(b.getAttribute('data-story')); });
    });
  }

  /* ------------------------------------------------------------------ run state */

  var S = {
    entry: null, program: null, run: null, stop: null, id: null,
    typing: null, auto: false, skip: false, skipUnseen: false, skipTimer: 0, autoTimer: 0,
    noSave: false, rendered: { left: null, center: null, right: null, bg: null },
    textOnly: false, hasMath: false, lastFocus: null, holdLast: 0
  };

  function setHue(h) { document.documentElement.style.setProperty('--vn-h', String(((h % 360) + 360) % 360)); }

  function clearStage() {
    stopTyping();
    clearTimeout(S.autoTimer); clearTimeout(S.skipTimer);
    box.classList.remove('show', 'done', 'narr'); textEl.innerHTML = ''; nameEl.textContent = '';
    menuEl.classList.remove('show'); menuEl.innerHTML = '';
    sceneEl.classList.remove('show', 'in'); sceneEl.innerHTML = '';
    cg.classList.remove('show'); cg.innerHTML = '';
    endEl.classList.remove('show'); endEl.innerHTML = '';
    pickerEl.classList.remove('show');
    transcriptEl.innerHTML = '';
    hidePanel();
    Object.keys(slots).forEach(function (k) { slots[k].innerHTML = ''; slots[k].className = 'vn-slot ' + k + ' empty'; });
    S.rendered = { left: null, center: null, right: null, bg: null };
    bgA.innerHTML = ''; bgB.innerHTML = '';
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

  // Load one story (manifest entry, or {src} / {post} descriptors) and start it.
  function loadStory(desc, opts) {
    opts = opts || {};
    if (!VN) { showEngineMissing(); return Promise.resolve(); }
    var id, textP, baseDirs;
    if (desc.src) {
      id = 'src:' + desc.src;
      var dir = desc.src.replace(/[^\/]*$/, '');
      baseDirs = [dir, 'stories/'];
      textP = fetchText(desc.src);
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
          // auto-read posts are not authored scripts: only fatals are worth a panel
          if (desc.auto) issues = issues.filter(function (i) { return i.level === 'fatal'; });
          renderIssues(issues, desc.src || (desc.file ? 'stories/' + desc.file : id));
          var fatal = issues.filter(function (i) { return i.level === 'fatal'; });
          if (fatal.length) {
            S.entry = desc; S.program = program; S.run = null; S.id = id;
            clearStage();
            showPanel('The script has a fatal issue', '<p>' + esc(fatal[0].msg) + '</p>' + (fatal[0].hint ? '<p><code>' + esc(fatal[0].hint) + '</code></p>' : '') + '<p>Fix it and reload; the full list is under the stage.</p>');
            setStatus('');
            return;
          }
          startRun(desc, program, id, opts);
        });
      });
    }).catch(function (err) {
      console.warn(err);
      clearStage();
      if (location.protocol === 'file:') showFileMessage();
      else showPanel('Could not load the story', '<p>' + esc(String(err && err.message || err)) + '</p><p>Check the path, or pick another story from the list.</p>');
      setStatus('');
    });
  }

  function openStory(id, opts) {
    var e = findEntry(id);
    if (!e) { renderPicker('No story called “' + id + '”.'); return; }
    if (selectEl) selectEl.value = id;
    setUrl(id, null);
    return loadStory(e, opts || {});
  }

  /* ------------------------------------------------------------------ issues panel */

  function renderIssues(issues, file) {
    if (!errorsEl) return;
    issues = issues || [];
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

  /* ------------------------------------------------------------------ starting a run */

  function startRun(entry, program, id, opts) {
    S.entry = entry; S.program = program; S.id = id; S.noSave = false;
    S.auto = false; S.skip = false; S.skipUnseen = false; badges();
    btn.auto.classList.remove('on'); btn.auto.setAttribute('aria-pressed', 'false');
    btn.skip.classList.remove('on'); btn.skip.setAttribute('aria-pressed', 'false');
    clearStage();
    setStatus('');
    setHue(program.meta.palette.hue);
    var title = program.meta.title || entry.title || id;
    stage.setAttribute('aria-label', title);
    document.title = title + ' · Paper Theatre';
    S.hasMath = program.ops.some(function (o) { return o.text && /\$[^$]+\$|\\\(|\\\[/.test(o.text); });
    if (S.hasMath) loadKatex();

    var saved = readJSON('vn:' + id);
    var seen = saved && Array.isArray(saved.seen) ? saved.seen : [];
    S.run = VN.createRun(program, { seen: seen });
    var stop, instant = THUMB || REDUCED;

    if (!THUMB && !(document.activeElement && menuEl.contains(document.activeElement))) stage.focus({ preventScroll: true });
    if (THUMB) {
      stop = S.run.advance();
      var guard = 0;
      while (stop && !stop.done && guard++ < 5000) {
        if (program.thumb != null && stop.index > program.thumb) break;
        if (program.thumb == null && (stop.op.kind === 'menu' || stop.op.kind === 'card' || stop.op.kind === 'chart')) break;
        stop = stop.op.kind === 'menu' ? S.run.choose(0) : S.run.advance();
      }
      S.noSave = true;
      present(stop, { instant: true });
      return;
    }
    if (AUTOPLAY != null) {
      S.noSave = true;
      stop = gotoAt(AUTOPLAY === 'end' ? '1000000' : String(parseInt(AUTOPLAY, 10) || 1));
      present(stop, { instant: true });
      return;
    }
    if (opts.at != null) {
      S.noSave = true;
      stop = gotoAt(opts.at);
      present(stop, { instant: instant });
      setStatus('Deep link: progress is not saved from here');
      return;
    }
    if (saved && saved.choiceLog && !opts.fresh) {
      if (saved.hash === program.hash) {
        stop = S.run.replay(saved.choiceLog, saved.stopIndex);
        present(stop, { instant: true, resumed: true });
        if (stop && !stop.done && saved.stopIndex > 1) toast('Resumed where you left off. Press R to restart.');
        return;
      }
      stop = S.run.replay(saved.choiceLog, saved.stopIndex);
      if (S.run.state.choiceLog.length < saved.choiceLog.length || (stop && stop.op.kind === 'error')) {
        S.run = VN.createRun(program, { seen: seen });
        lsDel('vn:' + id);
        stop = S.run.advance();
        present(stop, { instant: instant });
        toast('The script changed since your last visit and your choices no longer match; starting over.', 4200);
        return;
      }
      present(stop, { instant: true, resumed: true });
      toast('The script changed since your last visit; resumed by your choices.', 3600);
      return;
    }
    stop = S.run.advance();
    present(stop, { instant: instant });
  }

  function gotoAt(at) {
    var n = parseInt(at, 10);
    if (String(n) === String(at) && n > 0) {
      var stop = S.run.advance(), guard = 0;
      while (stop && !stop.done && S.run.state.stops < n && guard++ < 10000) stop = stop.op.kind === 'menu' ? S.run.choose(0) : S.run.advance();
      return stop;
    }
    if (S.program.labels[at] == null) { toast('No label “' + at + '” in this story; starting from the top.'); return S.run.advance(); }
    return S.run.jumpTo(at);
  }

  function restart(confirmFirst) {
    if (!S.program || !S.run) return;
    if (confirmFirst && S.run.state.stops > 1 && !window.confirm('Start this story over?')) return;
    lsDel('vn:' + S.id);
    var seen = Object.keys(S.run.seen).map(Number);
    S.run = VN.createRun(S.program, { seen: seen });
    S.noSave = false;
    clearStage();
    setStatus('');
    present(S.run.advance(), { instant: REDUCED });
    stage.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ presenting a stop */

  function castOf(key) { return (S.program && S.program.cast && S.program.cast[key]) || null; }
  function displayName(key, who) { var c = castOf(key); return c ? c.name : (who || key); }

  function syncVisuals(state, op) {
    // background crossfade
    var bg = state.bg || { name: 'void', mod: null };
    var bgKey = bg.name + '|' + (bg.mod || '');
    if (S.rendered.bg !== bgKey) {
      var incoming = bgA.classList.contains('out') ? bgA : (S.rendered.bg == null ? bgA : bgB);
      var outgoing = incoming === bgA ? bgB : bgA;
      incoming.innerHTML = artBackground(bg.name, bg.mod);
      incoming.classList.remove('out');
      if (S.rendered.bg != null) outgoing.classList.add('out'); else { outgoing.classList.add('out'); outgoing.innerHTML = ''; }
      S.rendered.bg = bgKey;
    }
    // sprites
    var speakerKey = op && op.kind === 'say' ? op.key : null;
    Object.keys(slots).forEach(function (slot) {
      var key = state.slots[slot];
      var el = slots[slot];
      if (!key) {
        if (S.rendered[slot]) { el.className = 'vn-slot ' + slot + ' empty'; S.rendered[slot] = null; if (REDUCED) el.innerHTML = ''; }
        return;
      }
      var face = (speakerKey === key && op.face) ? op.face : (state.faces[key] || 'neutral');
      var sig = key + '|' + face;
      if (S.rendered[slot] !== sig) {
        var decl = castOf(key) || { id: key, key: key, name: key, hue: hash32(key) % 360, skin: 3, hair: 'short' };
        var sameChar = S.rendered[slot] && S.rendered[slot].split('|')[0] === key;
        el.innerHTML = artSprite(decl, face);
        S.rendered[slot] = sig;
        if (sameChar && !REDUCED) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
      }
      var cls = 'vn-slot ' + slot;
      if (speakerKey) cls += speakerKey === key ? ' speaking' : ' dim';
      el.className = cls;
    });
  }

  function labelAt(index) {
    var best = null, bestIdx = -1, labels = S.program.labels;
    Object.keys(labels).forEach(function (n) { if (labels[n] <= index && labels[n] > bestIdx) { bestIdx = labels[n]; best = n; } });
    return best;
  }

  function present(stop, o) {
    o = o || {};
    if (!stop) { toast('Nothing further back.'); return; }
    S.stop = stop;
    var op = stop.op, state = stop.state;
    stopTyping();
    clearTimeout(S.autoTimer);
    hidePanel();
    menuEl.classList.remove('show'); menuEl.innerHTML = ''; menuEl.style.bottom = '';
    cg.classList.remove('show'); cg.innerHTML = '';
    sceneEl.classList.remove('show', 'in'); sceneEl.innerHTML = '';
    endEl.classList.remove('show'); endEl.innerHTML = '';
    pickerEl.classList.remove('show');
    box.classList.remove('done');
    syncVisuals(state, op);
    var instant = !!o.instant || REDUCED || S.skip || S.textOnly;

    switch (op.kind) {
      case 'say':
      case 'narrate':
        showLine(op, state, instant);
        break;
      case 'read':
        showLine({ kind: 'narrate', text: 'The post could not be loaded here; read it on the site.', refs: [] }, state, instant);
        break;
      case 'menu':
        if (!textEl.textContent) showLastLine(state);
        box.classList.add('done');
        showMenu(stop);
        break;
      case 'scene':
        showScene(op, instant);
        break;
      case 'card':
      case 'chart':
      case 'code':
      case 'withheld':
        showBoard(op, instant);
        break;
      case 'end':
        showEnd();
        break;
      case 'error':
        showPanel('Runtime error', '<p>' + esc(op.msg) + '</p>' + (op.hint ? '<p><code>' + esc(op.hint) + '</code></p>' : ''));
        announce('Runtime error: ' + op.msg);
        break;
    }
    if (S.textOnly) renderTranscript();
    if (!THUMB) setUrl(S.entry && !S.entry.src ? S.id : null, labelAt(stop.index));
    save();
    btn.back.disabled = state.stops <= 1 && !o.back;
    if (op.kind === 'menu' || op.kind === 'end' || op.kind === 'error') { if (S.skip) setSkip(false); }
  }

  function save() {
    if (!S.run || S.noSave || THUMB || !S.id) return;
    var snap = S.run.snapshot();
    snap.ts = Date.now();
    lsSet('vn:' + S.id, JSON.stringify(snap));
  }

  /* ------------------------------------------------------------------ the text box + typewriter */

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

  function showLine(op, state, instant) {
    var who = op.kind === 'say' ? displayName(op.key, op.who) : '';
    var text = VN && VN.interpolate ? VN.interpolate(op.text, state.vars, S.program.cast) : op.text;
    var tokens = splitMath(VN && VN.markup ? VN.markup(text) : [{ type: 'text', text: text }]);
    nameEl.textContent = who;
    box.classList.toggle('narr', op.kind !== 'say');
    box.classList.add('show');
    textEl.innerHTML = '';
    var units = [];      // [{node, g}]
    var mathEls = [];
    tokens.forEach(function (t) {
      var el;
      if (t.type === 'em') el = document.createElement('em');
      else if (t.type === 'code') el = document.createElement('code');
      else if (t.type === 'math') { el = document.createElement('span'); el.className = 'vn-math'; el.setAttribute('data-tex', t.text); mathEls.push(el); }
      else el = document.createElement('span');
      var node = document.createTextNode('');
      el.appendChild(node);
      textEl.appendChild(el);
      var gs = graphemes(t.type === 'math' ? (t.display ? '$$' + t.text + '$$' : '$' + t.text + '$') : t.text);
      gs.forEach(function (g) { units.push({ node: node, g: g }); });
    });
    var chips = document.createElement('span');
    chips.innerHTML = chipsHtml(op.refs);
    chips.style.visibility = 'hidden';
    textEl.appendChild(chips);
    var announceText = (who ? who + ': ' : '') + plainText(text) + ((op.refs && op.refs.length) ? ' (' + op.refs.map(function (r) { return VN && VN.describeRef ? VN.describeRef(r) : r; }).join('; ') + ')' : '');

    function finish() {
      units.forEach(function (u) { if (!u.done) { u.node.data += u.g; u.done = true; } });
      chips.style.visibility = '';
      box.classList.add('done');
      S.typing = null;
      renderMath(mathEls);
      announce(announceText);
      scheduleAuto(units.length);
      if (S.skip) scheduleSkip();
    }
    if (instant || !units.length) { finish(); return; }

    var i = 0, acc = 0, last = 0, raf = 0;
    var base = 1000 / clamp(prefs.cps, 15, 80);
    function frame(ts) {
      if (!last) last = ts;
      var dt = Math.min(ts - last, 200); last = ts;
      acc += dt;
      while (i < units.length && acc >= 0) {
        var u = units[i++];
        u.node.data += u.g; u.done = true;
        var pause = /[.!?…]/.test(u.g) ? 3 : /[,;:]/.test(u.g) ? 1.5 : 1;
        var nextIsSpace = i < units.length && /\s/.test(units[i].g);
        acc -= base * (pause > 1 && (nextIsSpace || i >= units.length) ? pause : 1);
      }
      if (i >= units.length) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    S.typing = { complete: finish, cancel: function () { cancelAnimationFrame(raf); S.typing = null; } };
  }
  // A menu reached by resume, rewind or ?thumb has no line on screen yet: show the last one.
  function showLastLine(state) {
    var h = state.history || [];
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i].kind === 'say' || h[i].kind === 'narrate') {
        var key = h[i].who ? h[i].who.toLowerCase() : null;
        showLine({ kind: h[i].kind, key: key, who: h[i].who, text: h[i].text, refs: h[i].refs }, state, true);
        return;
      }
      if (h[i].kind !== 'choice') return;
    }
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

  /* ------------------------------------------------------------------ menus, scenes, boards, end card */

  function showMenu(stop) {
    var opts = stop.options || [];
    var h = '';
    opts.forEach(function (o, i) {
      var text = VN && VN.interpolate ? VN.interpolate(o.text, stop.state.vars, S.program.cast) : o.text;
      h += '<button type="button" data-i="' + i + '"><span class="vn-key" aria-hidden="true">' + (i + 1) + '</span><span>' + esc(text) + '</span></button>';
    });
    menuEl.innerHTML = h;
    // sit just above the text box, whatever its height
    var sh = stage.clientHeight || 1, bh = box.classList.contains('show') && !S.textOnly ? box.offsetHeight : 0;
    menuEl.style.bottom = bh ? Math.min(62, (bh / sh) * 100 + 4).toFixed(1) + '%' : '';
    menuEl.classList.add('show');
    $$('button', menuEl).forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); choose(parseInt(b.getAttribute('data-i'), 10)); }); });
    announce('Choose: ' + opts.map(function (o, i) { return (i + 1) + '. ' + o.text; }).join(' '));
    if (!THUMB) { var first = $('button', menuEl); if (first) first.focus({ preventScroll: true }); }
  }
  function choose(i) {
    if (!S.stop || S.stop.op.kind !== 'menu') return;
    var stop = S.run.choose(i);
    present(stop, { instant: REDUCED });
    stage.focus({ preventScroll: true });
  }

  function showScene(op, instant) {
    box.classList.remove('show');
    sceneEl.innerHTML = '<div class="vn-title"><small>Scene</small>' + esc(op.title) + '</div>';
    sceneEl.classList.add('show');
    if (instant) sceneEl.classList.add('in');
    else requestAnimationFrame(function () { requestAnimationFrame(function () { sceneEl.classList.add('in'); }); });
    announce('Scene: ' + op.title);
    scheduleAuto(op.title.length + 20);
    if (S.skip) scheduleSkip();
  }

  function showBoard(op, instant) {
    box.classList.remove('show');
    cg.innerHTML = boardHtml(op);
    cg.classList.add('show');
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

  function showEnd() {
    var m = S.program.meta, e = S.entry || {};
    var kindLabel = m.kind === 'blog' ? 'Blog post' : 'Paper';
    var date = m.date || (e.post && e.post.date) || null;
    var links = (m.links || []).slice(0, 2);
    var h = '<div class="vn-end-card" tabindex="-1">';
    if (m.verify) h += '<div class="vn-ribbon" title="figures not yet re-checked against the source">Unverified draft</div>';
    h += '<div class="vn-kicker">' + esc(kindLabel) + (date ? ' · ' + esc(date) : '') + ' · The end</div>';
    h += '<h2>' + esc(m.title || e.title || '') + '</h2>';
    if (m.authors) h += '<p class="vn-authors">' + esc(m.authors) + '</p>';
    if (m.cite) h += '<blockquote class="vn-cite">' + esc(m.cite) + '</blockquote>';
    h += '<div class="vn-links">';
    links.forEach(function (l, i) { h += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener"' + (i === 0 ? ' class="primary"' : '') + '>' + esc(l.label || (m.kind === 'blog' ? 'Read the post' : 'Read the paper')) + '</a>'; });
    if (m.arxiv && VN && VN.bibtex) h += '<button type="button" class="vn-bib">Copy BibTeX</button><span class="vn-copied" aria-live="polite"></span>';
    h += '<button type="button" class="vn-replay">Replay</button></div>';
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
    h += '</div>';
    endEl.innerHTML = h;
    endEl.classList.add('show');
    var bib = $('.vn-bib', endEl);
    if (bib) bib.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var txt = VN.bibtex(m), out = $('.vn-copied', endEl);
      function ok() { out.textContent = 'copied'; setTimeout(function () { out.textContent = ''; }, 2000); }
      function fail() { window.prompt('Copy the BibTeX entry:', txt); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fail); else fail();
    });
    $('.vn-replay', endEl).addEventListener('click', function (ev) { ev.stopPropagation(); restart(false); });
    $$('button[data-story]', endEl).forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); openStory(b.getAttribute('data-story')); }); });
    announce('The end. ' + (m.title || '') + (m.cite ? '. ' + m.cite : ''));
    if (!THUMB) { var card = $('.vn-end-card', endEl); if (card) card.focus({ preventScroll: true }); }
    if (S.auto) setAuto(false);
  }

  /* ------------------------------------------------------------------ advance / back / auto / skip */

  function canAdvance() { return S.run && S.stop && S.stop.op.kind !== 'menu' && S.stop.op.kind !== 'end' && S.stop.op.kind !== 'error'; }

  function advance(o) {
    o = o || {};
    if (!S.run || !S.stop) return;
    if (S.typing) { if (!o.instant) { completeLine(); return; } completeLine(); }
    if (!canAdvance()) return;
    clearTimeout(S.autoTimer);
    var stop = S.run.advance();
    present(stop, { instant: !!o.instant });
  }
  function back() {
    if (!S.run) return;
    clearTimeout(S.autoTimer);
    if (S.auto) setAuto(false);
    var stop = S.run.back();
    if (!stop) { toast('This is the beginning.'); return; }
    present(stop, { instant: true, back: true });
  }

  function setAuto(on) {
    S.auto = on;
    btn.auto.classList.toggle('on', on); btn.auto.setAttribute('aria-pressed', String(on));
    badges();
    clearTimeout(S.autoTimer);
    if (on) { if (S.skip) setSkip(false); if (!S.typing) scheduleAuto(60); }
  }
  function scheduleAuto(chars) {
    clearTimeout(S.autoTimer);
    if (!S.auto || document.hidden || !canAdvance()) return;
    S.autoTimer = setTimeout(function () { if (S.auto && !document.hidden) advance(); }, 1200 + 35 * (chars || 0));
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(S.autoTimer);
    else if (S.auto && !S.typing) scheduleAuto(40);
  });

  function setSkip(on, unseen) {
    S.skip = on; S.skipUnseen = on && !!unseen;
    btn.skip.classList.toggle('on', on); btn.skip.setAttribute('aria-pressed', String(on));
    badges();
    clearTimeout(S.skipTimer);
    if (on) {
      if (S.auto) setAuto(false);
      S.seenAtSkipStart = Object.assign({}, S.run ? S.run.seen : {});
      if (S.typing) completeLine();
      scheduleSkip();
    }
  }
  function scheduleSkip() {
    clearTimeout(S.skipTimer);
    if (!S.skip || !canAdvance()) { if (S.skip && !canAdvance()) setSkip(false); return; }
    S.skipTimer = setTimeout(function () {
      if (!S.skip || !canAdvance()) { setSkip(false); return; }
      var stop = S.run.advance();
      var unseen = !S.seenAtSkipStart[stop.index];
      if (unseen && !S.skipUnseen) { setSkip(false); present(stop, { instant: REDUCED }); return; }
      present(stop, { instant: true });
    }, 120);
  }

  /* ------------------------------------------------------------------ backlog */

  function historyRows() {
    var rows = [], stops = 0, choices = 0;
    (S.run.state.history || []).forEach(function (h) {
      if (h.kind === 'choice') { stops++; choices++; rows.push({ h: h, stopIndex: stops, choices: choices - 1 }); }
      else { stops++; rows.push({ h: h, stopIndex: stops, choices: choices }); }
    });
    return rows;
  }
  function renderLog() {
    var rows = historyRows();
    if (!rows.length) { logList.innerHTML = '<li class="vn-log-empty">Nothing yet.</li>'; return; }
    var cur = S.run.state.stops;
    logList.innerHTML = rows.map(function (r, i) {
      var h = r.h, cls = h.kind === 'choice' ? 'pick' : h.kind === 'say' ? 'say' : h.kind === 'narrate' ? 'narr' : 'board';
      var text;
      if (h.kind === 'choice') text = '> picked: ' + esc(h.text);
      else if (h.kind === 'say') text = '<b>' + esc(displayName(h.who ? h.who.toLowerCase() : '', h.who)) + '</b>' + esc(plainText(VN.interpolate(h.text, {}, S.program.cast)));
      else if (h.kind === 'narrate') text = esc(plainText(VN.interpolate(h.text, {}, S.program.cast)));
      else text = '<b>' + esc(h.kind) + '</b>' + esc(h.title || h.text || '');
      return '<li class="' + cls + (r.stopIndex === cur ? ' cur' : '') + '"><span class="t">' + text + chipsHtml(h.refs) + '</span><button type="button" data-rewind="' + r.stopIndex + '" title="rewind to this moment">rewind here</button></li>';
    }).join('');
    $$('button[data-rewind]', logList).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = parseInt(b.getAttribute('data-rewind'), 10);
        closeOverlay(logOverlay);
        rewindTo(k);
      });
    });
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
    document.body.classList.toggle('text-only', on);
    btn.text.classList.toggle('on', on); btn.text.setAttribute('aria-pressed', String(on));
    transcriptEl.setAttribute('aria-hidden', String(!on));
    if (persist) { prefs.textOnly = on; savePrefs(); }
    if (on && S.run) { completeLine(); renderTranscript(); }
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
      if (e.kind === 'say') return '<p><b>' + esc(displayName(e.who ? e.who.toLowerCase() : '', e.who)) + '</b>' + esc(plainText(VN.interpolate(e.text, S.run.state.vars, S.program.cast))) + fn(e.refs) + '</p>';
      if (e.kind === 'narrate') return '<p class="narr">' + esc(plainText(VN.interpolate(e.text, S.run.state.vars, S.program.cast))) + fn(e.refs) + '</p>';
      if (e.kind === 'scene') return '<p class="scene">' + esc(e.title || e.text) + '</p>';
      return '<p class="board">' + esc(e.kind) + ': ' + esc(e.title || e.text || '') + fn(e.refs) + '</p>';
    }).join('');
    if (S.stop && S.stop.op.kind === 'end') h += '<p class="scene">The end</p>';
    if (foot.length) h += '<ol class="vn-foot">' + foot.map(function (r) { return '<li>' + esc(r) + ' — ' + esc(VN.describeRef(r)) + '</li>'; }).join('') + '</ol>';
    transcriptEl.innerHTML = h;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  /* ------------------------------------------------------------------ overlays (focus trap) */

  function focusables(root) {
    return $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', root).filter(function (el) { return el.offsetParent !== null; });
  }
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
    var back = S.lastFocus && document.contains(S.lastFocus) ? S.lastFocus : stage;
    try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
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
  function toggleLog() { if (logOverlay.classList.contains('show')) closeOverlay(logOverlay); else if (S.run) { renderLog(); openOverlay(logOverlay); } }
  function toggleHelp() { if (helpOverlay.classList.contains('show')) closeOverlay(helpOverlay); else openOverlay(helpOverlay); }

  /* ------------------------------------------------------------------ toolbar */

  btn.back.addEventListener('click', back);
  btn.auto.addEventListener('click', function () { setAuto(!S.auto); });
  btn.skip.addEventListener('click', function (e) { if (S.skip) setSkip(false); else if (e.shiftKey) { if (window.confirm('Skip text you have not read yet?')) setSkip(true, true); } else setSkip(true, false); });
  btn.log.addEventListener('click', toggleLog);
  btn.text.addEventListener('click', function () { setTextOnly(!S.textOnly, true); });
  btn.help.addEventListener('click', toggleHelp);
  btn.restart.addEventListener('click', function () { restart(true); });
  if (cpsEl) {
    cpsEl.value = String(prefs.cps); cpsVal.textContent = prefs.cps + ' cps';
    cpsEl.addEventListener('input', function () { prefs.cps = clamp(parseInt(cpsEl.value, 10) || 28, 15, 80); cpsVal.textContent = prefs.cps + ' cps'; savePrefs(); });
  }
  if (selectEl) selectEl.addEventListener('change', function () { if (selectEl.value) openStory(selectEl.value); else { clearStage(); renderPicker(); } });
  nameEl.addEventListener('click', function (e) { e.stopPropagation(); toggleLog(); });

  /* ------------------------------------------------------------------ keyboard */

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    var inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
    var ov = openOverlayEl();
    if (e.key === 'Escape') {
      if (ov) { e.preventDefault(); closeOverlay(ov); return; }
      if (S.auto) { setAuto(false); return; }
      if (S.skip) { setSkip(false); return; }
      return;
    }
    if (ov) return;                    // dialogs own the rest of the keys
    if (inField) {
      if (tag === 'SELECT' && (e.key === 'Enter' || e.key === ' ')) return;
      if (tag === 'INPUT' && t.type === 'range') return;
      if (tag === 'SELECT') return;
    }
    var k = e.key;
    if (k === 'D' || k === 'd') { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true); return; }
    if (k === 'H' || k === 'h' || k === '?') { e.preventDefault(); toggleHelp(); return; }
    if (k === 'T' || k === 't') { setTextOnly(!S.textOnly, true); return; }
    if (!S.run) return;
    if (k === ' ' || k === 'Enter' || k === 'ArrowRight') {
      if (t && (tag === 'BUTTON' || tag === 'A') && k !== 'ArrowRight') return;   // native activation: toolbar, menu, end card
      e.preventDefault();
      if (S.stop && S.stop.op.kind === 'menu') { var first = $('button', menuEl); if (first && !menuEl.contains(t)) first.focus(); return; }
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
    if (k === 'S' || k === 's') {
      if (S.skip) setSkip(false);
      else if (e.shiftKey) { if (window.confirm('Skip text you have not read yet?')) setSkip(true, true); }
      else setSkip(true, false);
      return;
    }
    if (k === 'L' || k === 'l') { toggleLog(); return; }
    if (k === 'R' || k === 'r') { restart(true); return; }
    if ((k === 'ArrowDown' || k === 'ArrowUp') && S.stop && S.stop.op.kind === 'menu') {
      var bs = $('button', menuEl); if (!bs.length) return;
      var at = bs.indexOf(document.activeElement);
      var nx = at < 0 ? 0 : (at + (k === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length;
      e.preventDefault(); bs[nx].focus();
      return;
    }
    if (/^[1-9]$/.test(k) && S.stop && S.stop.op.kind === 'menu') {
      var i = parseInt(k, 10) - 1;
      if (i < (S.stop.options || []).length) { e.preventDefault(); choose(i); }
      return;
    }
  });

  /* ------------------------------------------------------------------ pointer + touch */

  var ptr = null, longTimer = 0;
  function interactive(target) {
    return !!(target.closest && target.closest('button, a, abbr, input, select, .vn-end, .vn-picker, .vn-panel, .vn-transcript, .vn-board'));
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    ptr = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, target: e.target, consumed: false };
    clearTimeout(longTimer);
    if (e.pointerType === 'touch' && S.run && !interactive(e.target)) {
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
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (e.pointerType === 'touch' && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (!S.run) return;
      if (dx < 0) advance(); else back();
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    if (interactive(p.target)) return;
    if (p.target.closest && p.target.closest('.vn-name')) return;
    if (!S.run) return;
    if (S.stop && S.stop.op.kind === 'menu') return;
    if (S.auto) setAuto(false);
    advance();
    if (document.activeElement !== stage && !(document.activeElement && menuEl.contains(document.activeElement))) stage.focus({ preventScroll: true });
  });
  stage.addEventListener('pointercancel', function () { ptr = null; clearTimeout(longTimer); });
  stage.addEventListener('contextmenu', function (e) { if (ptr && ptr.target && !interactive(ptr.target)) e.preventDefault(); });

  /* ------------------------------------------------------------------ cast grid (?cast=1) */

  function castGrid(program) {
    var faces = (VN && VN.FACES) || ['neutral', 'smile', 'puzzled', 'worried', 'surprised', 'thinking', 'deadpan', 'laugh'];
    var decls = [];
    if (program) Object.keys(program.cast).forEach(function (k) { decls.push(program.cast[k]); });
    else {
      var base = { glasses: false, hat: false, lattice: null, player: false, page: false, coauthor: false, skin: 3, hair: 'short' };
      [
        { id: 'Jack', hue: 210, glasses: true, hair: 'short' },
        { id: 'Long', hue: 28, hair: 'long', skin: 2 },
        { id: 'Bun', hue: 120, hair: 'bun', skin: 4 },
        { id: 'Curly', hue: 10, hair: 'curly', skin: 5 },
        { id: 'None', hue: 250, hair: 'none', skin: 1 },
        { id: 'Hood', hue: 230, hair: 'hood', hat: false },
        { id: 'Hat', hue: 40, hair: 'short', hat: true, glasses: true },
        { id: 'Model', hue: 192, lattice: 'sparse' },
        { id: 'Coder', hue: 300, lattice: 'dense' },
        { id: 'You', hue: 20, player: true },
        { id: 'Page', hue: 40, page: true }
      ].forEach(function (d) { var x = Object.assign({}, base, d); x.key = x.id.toLowerCase(); x.name = x.id; decls.push(x); });
    }
    var frame = $('.vn-frame'), tb = $('.vn-toolbar');
    frame.style.display = 'none'; if (tb) tb.style.display = 'none';
    var grid = document.createElement('div'); grid.className = 'vn-castgrid';
    grid.innerHTML = decls.map(function (d) {
      return '<h2>' + esc(d.name || d.id) + ' <small>(' + esc([d.hair, d.glasses ? 'glasses' : '', d.hat ? 'hat' : '', d.lattice ? 'lattice=' + d.lattice : '', d.player ? 'player' : '', d.page ? 'page' : '', 'hue=' + d.hue, 'skin=' + d.skin].filter(Boolean).join(' ')) + ')</small></h2><div class="row">' +
        faces.map(function (f) { return '<div class="cell">' + artSprite(d, f) + '<small>' + esc(f) + '</small></div>'; }).join('') + '</div>';
    }).join('');
    $('main').insertBefore(grid, frame);
    setStatus('cast sheet');
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    if (prefs.textOnly && !THUMB && !CASTGRID) setTextOnly(true, false);
    if (!VN) { showEngineMissing(); return; }
    if (location.protocol === 'file:') { showFileMessage(); return; }
    var manifestP = fetchJSON('stories/index.json').then(function (j) { allManifest = Array.isArray(j) ? j : []; }).catch(function () { allManifest = []; });
    Promise.all([manifestP, loadPosts()]).then(function () {
      buildCatalog();
      fillSelect();
      var src = params.get('src'), story = params.get('story'), post = params.get('post'), at = params.get('at');
      if (CASTGRID) {
        if (src) return fetchText(src).then(function (t) { return fetchIncludes(t, [src.replace(/[^\/]*$/, ''), 'stories/']).then(function (inc) { castGrid(VN.parse(t, { id: 'src', includes: inc })); }); });
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
      if (window.innerWidth < 480 && !('textOnly' in (readJSON('vn:prefs') || {}))) setStatus('Small screen: press T for text-only.');
    });
  }

  boot();
})();
