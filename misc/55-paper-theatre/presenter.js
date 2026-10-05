/*
 * Paper Theatre: the presenter view (presenter.html, opened from the stage with P).
 *
 * The stage plays in the main window (the projector); this window shows the speaker the line on show, the
 * line after it, the presenter note ("# note:" in the script), chapter and position, a timer and the clock,
 * and big Next / Back buttons that drive the stage.
 *
 * The two talk on BroadcastChannel('vn:presenter') (see OPS.md, "Presenter view"). The stage sends positions,
 * never text: {type:'stop', id, src, hash, choiceLog, stopIndex, index, line, kind, done} and {type:'title', id,
 * src, hash}. This page loads the same script itself (exactly as the stage does), replays the choice log to the
 * stop index on its own run to find the line, and one step further on a second run to find the next one.
 * It sends {type:'hello'}, {type:'advance'}, {type:'back'} and {type:'choose', i}, with the id of the story
 * it follows, so only that stage moves.
 *
 * Keys: Right, Space, Enter (and Page Down, for a clicker) next; Left (Page Up) back; 1 to 9 choose; R resets
 * the timer. Test hook: window.__vnPresenter = {P, render, load, fit}.
 */
(function () {
  'use strict';

  var VN = window.VN || null;
  var params = new URLSearchParams(location.search);
  var DRAFTS = params.get('drafts') === '1';
  var HELLO_WAITING_MS = 2000;   // how often to call for a stage while none answers
  var HELLO_LIVE_MS = 5000;      // how often to ask the stage being followed whether it is still there
  var SILENT_MS = 12000;         // no word for this long: the stage is gone, wait for one again

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(lo, v, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) {
        try { if (r.body) r.body.cancel(); } catch (e) { /* nothing to cancel */ }
        throw new Error(r.status + ' ' + url);
      }
      return r.text();
    });
  }
  function fetchJSON(url) { return fetchText(url).then(function (t) { return JSON.parse(t); }); }

  var el = {
    title: $('pv-title'), pos: $('pv-pos'), progress: $('pv-progress'), status: $('pv-status'), warn: $('pv-warn'),
    elapsed: $('pv-elapsed'), elapsedV: $('pv-elapsed-v'), clockV: $('pv-clock-v'),
    current: $('pv-current'), currentBody: $('pv-current-body'), nextCard: $('pv-next'), nextLabel: $('pv-next-label'), nextBody: $('pv-next-body'),
    noteCard: $('pv-note'), note: $('pv-note-text'), back: $('pv-back'), next: $('pv-nextbtn')
  };

  /* ------------------------------------------------------------------ state */

  var P = {
    want: null,        // the descriptor this window is reading: {story} | {src} | {post, auto}
    askedFor: null,    // the stage id the last load was started for (one load per id the stage announces)
    id: null,          // program id of the loaded script (the stage's S.id for the same story)
    program: null,
    hasNotes: false,   // the script has at least one "# note:"
    loading: null,     // promise while a script loads
    loadError: null,
    msg: null,         // the latest stop / title message from the stage
    sig: '',           // that message as JSON
    drawn: '',         // what the last render() drew (so the stage's answers to hello do not redraw the page)
    view: null,        // what is on show: {kind, stop, next, options, approx, endNext}
    heardAt: 0,        // when the stage last said anything
    refetched: {},     // stage hashes the script was already read again for
    t0: null           // timer start (ms since epoch), null while idle
  };
  (function () { var t = parseInt(ssGet('vn:presenter:t0'), 10); if (isFinite(t) && t > 0) P.t0 = t; })();

  function isLive() { return !!P.msg && Date.now() - P.heardAt < SILENT_MS; }

  /* ------------------------------------------------------------------ theme (the theatre's own rule and key) */

  function applyTheme() {
    var q = params.get('theme'), t = (q === 'light' || q === 'dark') ? q : lsGet('theme');
    if (t !== 'light' && t !== 'dark') {
      var light = false;
      try { light = !!window.matchMedia && !window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { light = false; }
      t = light ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', t);
  }
  // the stage's theme button writes the key: this window follows at once
  window.addEventListener('storage', function (e) { if (e.key === 'theme' || e.key == null) applyTheme(); });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { /* older engines */ }

  /* ------------------------------------------------------------------ loading: the same script the stage reads */

  var manifestP = null, postsP = null, postBySlug = {};
  function manifest() {
    if (!manifestP) manifestP = fetchJSON('stories/index.json').then(function (j) { return Array.isArray(j) ? j : []; }).catch(function () { return []; });
    return manifestP;
  }
  function posts() {
    if (!postsP) {
      postsP = fetchJSON('../../blog/index.json').then(function (j) {
        var list = Array.isArray(j) ? j : [];
        list.forEach(function (p) { if (p.slug) postBySlug[p.slug] = p; });
        return list;
      }).catch(function () { return []; });
    }
    return postsP;
  }
  function slugOf(m) { return m.slug || (/^blog:(.+)$/.exec(m.source || '') || [])[1] || null; }

  // the descriptor for what a message from the stage says it is playing
  function descOf(m) {
    if (m.src) return { src: m.src };
    if (/^src:/.test(m.id)) return { src: m.id.slice(4) };
    if (/^post:/.test(m.id)) return { post: m.id.slice(5), auto: true };   // a post read straight, no story of its own
    return { story: m.id };
  }
  function sameDesc(a, b) { return !!a && !!b && a.src === b.src && a.post === b.post && a.story === b.story; }

  function draftKey(src) { var m = /^draft:(.+)$/.exec(src || ''); return m ? m[1] : null; }
  function readSource(src) {
    var key = draftKey(src);
    if (key == null) return fetchText(src);
    var text = lsGet('vn:studio:' + key);
    return text == null ? Promise.reject(new Error('No draft called “' + key + '” in this browser (vn:studio:' + key + ')')) : Promise.resolve(text);
  }
  function sourceDirs(src) { return draftKey(src) != null ? ['stories/'] : [src.replace(/[^\/]*$/, ''), 'stories/']; }

  function fetchIncludes(text, baseDirs) {
    var names = [], includes = {};
    text.replace(/^\s*@include\s+(\S+)/gm, function (m, p) { if (names.indexOf(p) < 0) names.push(p); return m; });
    function one(name) {
      var p = Promise.reject();
      baseDirs.forEach(function (d) { p = p.catch(function () { return fetchText(d + name); }); });
      return p.then(function (t) {
        includes[name] = t;
        var nested = [];
        t.replace(/^\s*@include\s+(\S+)/gm, function (m, q) { if (!includes[q] && names.indexOf(q) < 0) { names.push(q); nested.push(q); } return m; });
        return Promise.all(nested.map(one));
      }).catch(function () { /* the parser reports include-missing */ });
    }
    return Promise.all(names.map(one)).then(function () { return includes; });
  }

  // Must stay character for character what stage.js builds: the hash of this text is compared with the stage's.
  function syntheticPostVn(p) {
    return [
      '@title ' + (p.title || p.slug),
      '@kind blog',
      '@source blog:' + p.slug,
      '@link ../../#/post/' + p.slug + ' Read the post',
      '@status published',
      '@palette hue=' + (VN.hash(p.slug) % 360),
      '@note Read straight from the post; no dramatization. Chips point at the post’s paragraphs.',
      '',
      '@bg paper',
      '@read post',
      '@end'
    ].join('\n');
  }

  // Resolve a descriptor to {id, text, baseDirs}, the way stage.js boot() and loadStory() do.
  function resolve(desc) {
    if (desc.src) return readSource(desc.src).then(function (t) { return { id: 'src:' + desc.src, text: t, baseDirs: sourceDirs(desc.src) }; });
    return Promise.all([manifest(), posts()]).then(function (r) {
      var list = r[0], m = null;
      if (desc.post) {
        // a story that claims the post (a draft only with ?drafts=1), else the post read straight
        if (!desc.auto) m = list.filter(function (x) { return slugOf(x) === desc.post && ((x.status || 'draft') !== 'draft' || DRAFTS); })[0];
        if (!m) {
          var p = postBySlug[desc.post];
          if (!p || !p.file) throw new Error('No post called “' + desc.post + '”');
          return { id: 'post:' + desc.post, text: syntheticPostVn(p), baseDirs: ['stories/'] };
        }
      } else {
        m = list.filter(function (x) { return x.id === desc.story; })[0];
        if (!m) throw new Error('No story called “' + desc.story + '”');
      }
      return fetchText('stories/' + m.file).then(function (t) { return { id: m.id, text: t, baseDirs: ['stories/'] }; });
    });
  }

  function load(desc) {
    P.want = desc;
    P.loadError = null;
    var p = resolve(desc).then(function (src) {
      return fetchIncludes(src.text, src.baseDirs).then(function (includes) {
        var program = VN.parse(src.text, { id: src.id, includes: includes });
        return posts().then(function () {
          var meta = program.meta;
          if (meta.sourceKind === 'blog') {
            var bp = postBySlug[meta.sourceRef];
            if (bp && !meta.title) meta.title = bp.title;
          }
          if (!program.ops.some(function (o) { return o.kind === 'read'; })) return program;
          var slug = meta.sourceKind === 'blog' ? meta.sourceRef : null, post = slug && postBySlug[slug];
          var file = post ? post.file : meta.file;
          if (!file) return program;
          return fetchText('../../blog/posts/' + file).then(function (md) {
            return VN.expand(program, md, { title: (post && post.title) || meta.title });
          }).catch(function () { return program; });
        });
      }).then(function (program) {
        if (P.loading !== p) return;    // a newer load took over
        P.id = src.id; P.program = program; P.loading = null;
        P.hasNotes = program.ops.some(function (o) { return o.note != null && o.note !== ''; });
      });
    }).catch(function (err) {
      if (P.loading !== p) return;
      P.loading = null; P.program = null; P.id = null; P.hasNotes = false;
      P.loadError = String(err && err.message || err);
    }).then(function () { if (P.loading == null) render(); });
    P.loading = p;
    render();
    return p;
  }

  /* ------------------------------------------------------------------ where the stage is, and what comes next */

  // A fresh run standing on the stop the message names: by replaying its choices (what the stage did), else, for a
  // stop the stage reached by a jump (a Studio goto, a label no choices lead to), by jumping to the op index.
  function reach(msg) {
    var run = VN.createRun(P.program), stop = null, approx = false;
    if (msg.stopIndex > 0) stop = run.replay(msg.choiceLog || [], msg.stopIndex);
    if (!stop || stop.index !== msg.index) {
      stop = null;
      if (msg.index >= 0 && msg.index < P.program.ops.length) { run = VN.createRun(P.program); stop = run.jumpTo(msg.index); approx = true; }
    }
    return { run: run, stop: stop, approx: approx };
  }

  // Where a step leads, looking through pauses: the stage passes a pause by itself, so what the speaker needs to
  // see coming is the line after it.
  function settle(run, stop) {
    var paused = false, guard = 0;
    while (stop && !stop.done && stop.op.kind === 'pause' && guard++ < 50) { stop = run.advance(); paused = true; }
    return { stop: stop, paused: paused };
  }

  function compute(msg) {
    var v = { kind: msg.type, stop: null, next: null, nextPaused: false, options: null, approx: false, endNext: false }, run, n;
    if (msg.type === 'title') {
      run = VN.createRun(P.program);
      n = settle(run, run.advance());
      v.next = n.stop; v.nextPaused = n.paused;
      return v;
    }
    var here = reach(msg);
    v.stop = here.stop; v.approx = here.approx;
    if (!v.stop) return v;
    if (v.stop.done || v.stop.op.kind === 'end' || v.stop.op.kind === 'error') { v.endNext = true; return v; }
    if (v.stop.op.kind === 'menu') {
      // a second run per option, one step further: where each choice leads
      v.options = (v.stop.options || []).map(function (o, i) {
        var r = reach(msg).run, t = settle(r, r.choose(i));
        return { text: o.text, then: t.stop, paused: t.paused };
      });
      return v;
    }
    run = reach(msg).run;                // a second run, one step further
    n = settle(run, run.advance());
    v.next = n.stop; v.nextPaused = n.paused;
    return v;
  }

  /* ------------------------------------------------------------------ describing a stop */

  function castName(key, who) { var c = P.program && P.program.cast && P.program.cast[key]; return c ? c.name : (who || key || ''); }

  function inlineHtml(text, vars) {
    var t = VN.interpolate(text == null ? '' : text, vars || {}, P.program.cast);
    return VN.markup(t).map(function (k) {
      if (k.type === 'em') return '<em>' + esc(k.text) + '</em>';
      if (k.type === 'code') return '<code>' + esc(k.text) + '</code>';
      return esc(k.text);
    }).join('');
  }
  function refsHtml(op) {
    var r = VN.refs ? VN.refs(op) : [];
    return (r || []).map(function (x) { return '<span class="pv-ref">' + esc(x) + '</span>'; }).join('');
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // {who, kind, html, extra, more, thought, meta, refs} for one stop: `extra` is shown with the line on show,
  // `more` stands in for it in the preview of the next line
  function describe(stop) {
    var op = stop.op, vars = stop.state && stop.state.vars, n;
    var d = { who: '', kind: '', html: '', extra: '', more: '', thought: false, meta: false, refs: refsHtml(op) };
    switch (op.kind) {
      case 'say':
        d.who = castName(op.key, op.who);
        d.thought = !!op.thought;
        if (d.thought) d.kind = 'thinks';
        d.html = inlineHtml(op.text, vars);
        break;
      case 'narrate':
        d.who = 'Narration'; d.thought = !!op.thought; d.html = inlineHtml(op.text, vars);
        break;
      case 'menu':
        d.who = 'Choice'; d.kind = plural((stop.options || []).length, 'option');
        break;
      case 'scene':
        d.who = 'Scene title'; d.html = inlineHtml(op.title, vars);
        break;
      case 'chapter':
        d.who = 'Chapter ' + op.n; d.html = inlineHtml(op.title, vars);
        break;
      case 'pause':
        d.who = 'Pause'; d.meta = true; d.html = 'A beat with no words. The stage goes on by itself.';
        break;
      case 'card':
        n = (op.cells || []).length;
        d.who = op.src ? 'Figure' : 'Card'; d.html = inlineHtml(op.title, vars);
        if (n) {
          d.extra = '<ul class="pv-cells' + (n > 5 ? ' is-many' : '') + '">' + op.cells.map(function (c) {
            return '<li>' + (c.label ? '<b>' + inlineHtml(c.label, vars) + '</b>' : '') + inlineHtml(c.value, vars) + '</li>';
          }).join('') + '</ul>';
          d.more = plural(n, 'cell');
        }
        break;
      case 'chart':
        n = (op.series || []).length;
        d.who = 'Chart'; d.kind = (op.type === 'range' ? 'range' : 'bar') + (op.unit ? ', ' + op.unit : ''); d.html = inlineHtml(op.title, vars);
        if (n) {
          d.extra = '<ul class="pv-cells' + (n > 5 ? ' is-many' : '') + '">' + op.series.map(function (s) {
            return '<li><b>' + inlineHtml(s.label, vars) + '</b>' + esc(op.type === 'range' ? s.lo + ' to ' + s.hi : s.value) + '</li>';
          }).join('') + '</ul>';
          d.more = plural(n, 'row');
        }
        break;
      case 'code':
        n = (op.lines || []).length;
        d.who = 'Code'; d.kind = op.lang || '';
        d.extra = '<pre class="pv-code">' + esc((op.lines || []).slice(0, 10).join('\n')) + (n > 10 ? '\n… ' + plural(n - 10, 'more line') : '') + '</pre>';
        d.more = plural(n, 'line');
        break;
      case 'withheld':
        d.who = 'Withheld'; d.html = inlineHtml(op.text, vars);
        break;
      case 'read':
        d.who = 'Post'; d.meta = true; d.html = 'The post is read from here.';
        break;
      case 'end':
        d.who = 'End'; d.meta = true; d.html = 'The end card.';
        break;
      case 'error':
        d.who = 'Script error'; d.meta = true; d.html = esc(op.msg || '');
        break;
      default:
        d.who = op.kind; d.html = inlineHtml(op.text || op.title || '', vars);
    }
    return d;
  }
  function stopHtml(stop, full, tag) {
    var d = describe(stop), kind = [d.kind, tag].filter(Boolean).join(', ');
    var h = '<p class="pv-who">' + esc(d.who) + (kind ? '<span class="pv-kind">' + esc(kind) + '</span>' : '') + (full ? d.refs : '') + '</p>';
    if (d.html) h += '<p class="pv-text' + (d.thought ? ' is-thought' : '') + (d.meta ? ' is-meta' : '') + '">' + d.html + '</p>';
    if (full) h += d.extra;
    else if (d.more) h += '<p class="pv-more">' + esc(d.more) + '</p>';
    return h;
  }
  function oneLine(stop, paused) {
    if (!stop) return '';
    var d = describe(stop);
    return (paused ? 'a pause, then ' : '') + '<strong>' + esc(d.who) + (d.html ? ':' : '') + '</strong> ' + (d.html || (d.kind ? '(' + esc(d.kind) + ')' : '')) + (d.more ? ' (' + esc(d.more) + ')' : '');
  }
  function keyCap(k) { return '<span class="pv-key">' + (k < 9 ? k + 1 : '·') + '</span>'; }
  function meta(text) { return '<p class="pv-text is-meta">' + text + '</p>'; }

  /* ------------------------------------------------------------------ render */

  var RELOAD = '<button type="button" data-act="reload">Read the script again</button>';

  // The DOM is touched only when what it should hold changes (compared with what was last written, not with
  // innerHTML, which spells entities its own way).
  function setHtml(node, html) { if (node.pvHtml !== html) { node.innerHTML = html; node.pvHtml = html; } }
  function setWarn(html) {
    setHtml(el.warn, html || '');
    el.warn.hidden = !html;
  }
  function warnings() {
    var out = [], msg = P.msg, v = P.view, differs = !!(msg && P.program && msg.id === P.id && msg.hash && msg.hash !== P.program.hash);
    if (P.loadError) out.push('<strong>Could not read the script.</strong> ' + esc(P.loadError) + ' ' + RELOAD);
    if (differs) {
      out.push('<strong>The stage is playing another version of this script.</strong> The lines here may not be what the audience sees ' +
        '(the stage has version ' + esc(msg.hash) + ', this window read ' + esc(P.program.hash) + '). Reload the stage to play the file as it is now. ' + RELOAD);
    } else if (v && v.stop && msg.type === 'stop' && !v.approx && (v.stop.op.kind !== msg.kind || (v.stop.op.line | 0) !== (msg.line | 0))) {
      out.push('<strong>This window does not line up with the stage.</strong> The stage is on line ' + esc(msg.line) + ', this window found line ' + esc(v.stop.op.line | 0) +
        ' (an included file or the post may have changed). ' + RELOAD);
    }
    if (v && v.approx && v.stop) out.push('The stage came to this stop by a jump, so it is found by its place in the script; choices made before it are not known here.');
    if (msg && P.program && msg.id === P.id && msg.type === 'stop' && v && !v.stop) out.push('<strong>The stop the stage is on is not in the script this window read.</strong> ' + RELOAD);
    setWarn(out.join('<br>'));
  }

  function renderStatus() {
    var live = isLive();
    var text = live ? 'Following the stage' : P.msg ? 'The stage stopped answering. Waiting for it…' : 'Waiting for the stage…';
    if (el.status.textContent !== text) el.status.textContent = text;
    el.status.classList.toggle('is-live', live);
    document.body.classList.toggle('pv-waiting', !live);
    document.body.classList.toggle('pv-lost', !live && !!P.msg);
  }

  function drawKey() { return [P.sig, P.id, P.program ? P.program.hash : '', P.loadError || '', P.loading ? 'loading' : ''].join('|'); }

  function setButtons(nextOff, nextHtml, backOff) {
    el.next.disabled = !!nextOff; el.back.disabled = !!backOff;
    setHtml(el.next, nextHtml);
  }
  function setNextLabel(text) { if (el.nextLabel.textContent !== text) el.nextLabel.textContent = text; }
  function setNote(text) {
    var empty = text == null || text === '';
    var shown = empty ? 'No note for this line.' : text;
    if (el.note.textContent !== shown) el.note.textContent = shown;
    el.note.classList.toggle('is-empty', empty);
  }

  function render() {
    renderStatus();
    var program = P.program, msg = P.msg;
    if (program) {
      document.documentElement.style.setProperty('--accent-h', String((program.meta.palette && program.meta.palette.hue) || 0));
      el.title.textContent = program.meta.title || P.id || 'Paper Theatre';
      el.title.title = el.title.textContent;
      document.title = 'Presenter · ' + (program.meta.title || 'Paper Theatre');
    } else el.title.textContent = P.loading ? 'Reading the script…' : 'Paper Theatre';
    document.body.classList.toggle('pv-nonotes', !!program && !P.hasNotes);
    P.view = null;

    if (!program || !msg || msg.id !== P.id) {
      setHtml(el.pos, '');
      el.progress.style.width = '0';
      if (!msg) {
        setHtml(el.currentBody, meta('Waiting for the stage. Open ' + (program ? 'this story' : 'a story') + ' in the main window and press <kbd>P</kbd> there, or just play it: this window follows by itself and finds the stage again if it reloads.'));
      } else if (P.loading) setHtml(el.currentBody, meta('Reading the script…'));
      else setHtml(el.currentBody, meta('The stage is playing something this window could not read.'));
      setHtml(el.nextBody, meta('Nothing yet.'));
      setNextLabel('Next');
      setNote(null);
      setButtons(true, 'Next &rarr;<small>Right, Space or Enter</small>', true);
      warnings();
      P.drawn = drawKey();
      fit();
      return;
    }
    var v = P.view = compute(msg);
    warnings();

    // chapter and position
    var chapters = program.chapters || [], ch = v.stop && v.stop.state ? v.stop.state.chapter : null, parts = [], pct = 0;
    if (ch) {
      var ci = -1;
      for (var i = 0; i < chapters.length; i++) if (chapters[i].index === ch.index) ci = i;
      var ofN = chapters.length && ci >= 0 ? (String(ch.n) === String(ci + 1) ? ' of ' + chapters.length : ' (' + (ci + 1) + ' of ' + chapters.length + ')') : '';
      parts.push('<b>Chapter ' + esc(ch.n) + ofN + '</b>' + (ch.title ? ' ' + esc(ch.title) : ''));
    }
    if (msg.type === 'title') parts.push('<b>Title screen</b>');
    else {
      var last = Math.max(1, program.ops.length - 1);
      pct = Math.round(100 * clamp(0, msg.index, last) / last);
      parts.push('stop ' + (msg.stopIndex | 0));
      if (msg.line > 0) parts.push('line ' + (msg.line | 0));
      parts.push(pct + '%');
    }
    setHtml(el.pos, parts.join(' · '));
    el.progress.style.width = pct + '%';

    // the stop on show
    var body = '';
    if (msg.type === 'title') {
      body = '<p class="pv-who">Title screen</p><p class="pv-text">' + esc(program.meta.title || '') + '</p>' + meta('Press Start on the stage to begin.');
    } else if (!v.stop) {
      body = meta('The stage is on line ' + esc(msg.line) + ', which this window cannot find.');
    } else {
      body = stopHtml(v.stop, true);
      if (v.options) {
        body += '<ol class="pv-opts' + (v.options.length > 3 ? ' is-many' : '') + '">' + v.options.map(function (o, k) {
          return '<li><button type="button" class="pv-opt" data-choose="' + k + '">' + keyCap(k) + '<span class="pv-opt-text">' + inlineHtml(o.text, v.stop.state.vars) + '</span></button></li>';
        }).join('') + '</ol>';
      }
    }
    setHtml(el.currentBody, body);

    // what comes next
    var nb = '';
    if (msg.type === 'title') nb = v.next ? stopHtml(v.next, false, v.nextPaused ? 'after a pause' : '') : meta('Nothing.');
    else if (v.endNext) nb = meta('Nothing: this is the end of the story.');
    else if (v.options) {
      nb = '<ol class="pv-opts' + (v.options.length > 3 ? ' is-many' : '') + (v.options.length > 6 ? ' is-lots' : '') + '">' + v.options.map(function (o, k) {
        return '<li class="pv-opt">' + keyCap(k) + '<span class="pv-opt-then">' + oneLine(o.then, o.paused) + '</span></li>';
      }).join('') + '</ol>';
    } else if (v.next && v.next.op.kind === 'menu') {
      nb = '<p class="pv-who">A choice' + (v.nextPaused ? '<span class="pv-kind">after a pause</span>' : '') + '</p><ol class="pv-opts' + ((v.next.options || []).length > 3 ? ' is-many' : '') + '">' + (v.next.options || []).map(function (o, k) {
        return '<li class="pv-opt">' + keyCap(k) + '<span class="pv-opt-text">' + inlineHtml(o.text, v.next.state.vars) + '</span></li>';
      }).join('') + '</ol>';
    } else if (v.next) nb = stopHtml(v.next, false, v.nextPaused ? 'after a pause' : '');
    else nb = meta('Nothing.');
    setHtml(el.nextBody, nb);
    setNextLabel(v.options ? 'Next, by choice' : 'Next');

    // the note of the stop on show
    setNote(v.stop && v.stop.op.note != null ? v.stop.op.note : null);

    // buttons
    if (msg.type === 'title') setButtons(true, 'Start on the stage<small>the title screen is up</small>', true);
    else if (v.options) setButtons(true, 'Choose 1 to ' + Math.min(9, v.options.length) + '<small>the number keys, or press an option</small>', msg.stopIndex <= 1);
    else if (v.endNext) setButtons(true, 'The end<small>Left goes back</small>', msg.stopIndex <= 1);
    else setButtons(false, 'Next &rarr;<small>Right, Space or Enter</small>', msg.stopIndex <= 1);

    P.drawn = drawKey();
    fit();
  }

  /* ------------------------------------------------------------------ type as large as the room allows */

  // The largest size, going down in small steps from `max`, at which the card needs no scrolling.
  function fitOne(card, body, min, max) {
    if (!card.clientHeight) return;
    var size = max, guard = 0;
    body.style.fontSize = size.toFixed(1) + 'px';
    while (size > min && card.scrollHeight > card.clientHeight && guard++ < 80) {
      size = Math.max(min, size * 0.94);
      body.style.fontSize = size.toFixed(1) + 'px';
    }
  }
  function fit() {
    var h = window.innerHeight || 800, nextMax = clamp(15, Math.min(el.nextCard.clientWidth * 0.032, h * 0.04), 30);
    // the preview first: its height decides how much room the line on show has
    el.nextCard.style.maxHeight = '';
    fitOne(el.nextCard, el.nextBody, 13, nextMax);
    fitOne(el.current, el.currentBody, 15, clamp(20, Math.min(el.current.clientWidth * 0.066, h * 0.09), 64));
    // a long menu on a short screen: what is on show comes first, and the preview gives up room for it
    var need = el.current.scrollHeight - el.current.clientHeight, nh = el.nextCard.offsetHeight, floor = Math.max(56, h * 0.16);
    if (need > 0 && nh > floor) {
      el.nextCard.style.maxHeight = Math.max(floor, nh - need - 1) + 'px';
      fitOne(el.nextCard, el.nextBody, 13, nextMax);
    }
    if (el.note.classList.contains('is-empty')) el.note.style.fontSize = '';
    else fitOne(el.noteCard, el.note, 14, clamp(16, Math.min(el.noteCard.clientWidth * 0.07, h * 0.04), 32));
  }
  var fitQueued = false;
  function queueFit() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(function () { fitQueued = false; fit(); });
  }
  window.addEventListener('resize', queueFit);

  /* ------------------------------------------------------------------ timer and clock */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function startTimer() { if (P.t0 == null) { P.t0 = Date.now(); ssSet('vn:presenter:t0', String(P.t0)); tick(); } }
  function resetTimer() { P.t0 = null; ssSet('vn:presenter:t0', null); tick(); }
  function tick() {
    var s = P.t0 == null ? 0 : Math.max(0, Math.floor((Date.now() - P.t0) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    var e = (h ? h + ':' + pad(m) : String(m)) + ':' + pad(sec);
    if (el.elapsedV.textContent !== e) el.elapsedV.textContent = e;
    el.elapsed.classList.toggle('is-idle', P.t0 == null);
    var d = new Date(), c = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (el.clockV.textContent !== c) el.clockV.textContent = c;
  }

  /* ------------------------------------------------------------------ the channel */

  var ch = null;
  function tell(m) { if (ch) { try { ch.postMessage(m); } catch (e) { /* closed */ } } }
  function send(m) {
    if (!P.msg) return;
    m.id = P.msg.id;           // only the stage playing this story moves
    tell(m);
  }
  // Ask for the latest position. While one stage is being followed only that one is asked, so a second stage in
  // the same browser does not pull this window back and forth; while none answers, any stage may.
  function hello() {
    var m = { type: 'hello' };
    if (isLive()) m.id = P.msg.id;
    tell(m);
  }

  function onMessage(ev) {
    var m = ev && ev.data;
    if (!m || typeof m !== 'object' || (m.type !== 'stop' && m.type !== 'title') || typeof m.id !== 'string') return;
    var prev = P.msg;
    P.heardAt = Date.now();
    P.msg = m;
    P.sig = JSON.stringify(m);
    // the timer starts with the first advance: the stage moved from one stop to another (leaving the title screen
    // is not one, and neither is a pause that the stage passes by itself)
    if (prev && prev.type === 'stop' && prev.kind !== 'pause' && m.type === 'stop' && prev.id === m.id && (prev.stopIndex !== m.stopIndex || prev.index !== m.index)) startTimer();
    var desc = descOf(m);
    if (P.loading && sameDesc(desc, P.want)) { renderStatus(); return; }      // drawn when the script lands
    if (m.id !== P.id) {
      // another story than the one read here: read it (once per id; a story that cannot be read is not asked for again)
      if (P.askedFor !== m.id) { P.askedFor = m.id; load(desc); return; }
    } else if (P.program && m.hash && m.hash !== P.program.hash && !P.refetched[m.hash]) {
      // the stage reads another version: read the script again once for that version, and warn if it still differs
      P.refetched[m.hash] = 1;
      load(P.want);
      return;
    }
    if (P.drawn === drawKey()) { renderStatus(); return; }                    // the same position again (an answer to hello)
    render();
  }

  function openChannel() {
    if (typeof BroadcastChannel !== 'function') {
      setWarn('<strong>This browser has no BroadcastChannel</strong>, so this window cannot follow the stage.');
      return;
    }
    try { ch = new BroadcastChannel('vn:presenter'); } catch (e) { ch = null; }
    if (!ch) { setWarn('<strong>The channel to the stage could not be opened</strong>, so this window cannot follow it.'); return; }
    ch.onmessage = onMessage;
    hello();
    var lastHello = Date.now();
    setInterval(function () {
      var now = Date.now();
      if (now - lastHello >= (isLive() ? HELLO_LIVE_MS : HELLO_WAITING_MS)) { lastHello = now; hello(); }
      renderStatus();
    }, 1000);
  }

  /* ------------------------------------------------------------------ input */

  function goNext() {
    if (!P.msg || el.next.disabled) return;
    startTimer();
    send({ type: 'advance' });
  }
  function goBack() { if (P.msg && !el.back.disabled) send({ type: 'back' }); }
  function choose(i) {
    if (!P.view || !P.view.options || i < 0 || i >= P.view.options.length) return;
    startTimer();
    send({ type: 'choose', i: i });
  }
  function reread() {
    if (!P.want) return;
    P.refetched = {};
    if (P.msg && P.msg.hash) P.refetched[P.msg.hash] = 1;    // this press is the one re-read for the stage's version
    load(P.want);
  }
  // A button pressed with the mouse or a finger gives the focus back, so that Space and Enter stay "next";
  // a button reached with Tab keeps it and is pressed by its own key.
  function letGo(e, b) { if (e && e.detail && b && b.blur) b.blur(); }

  el.next.addEventListener('click', function (e) { goNext(); letGo(e, el.next); });
  el.back.addEventListener('click', function (e) { goBack(); letGo(e, el.back); });
  el.elapsed.addEventListener('click', function (e) { resetTimer(); letGo(e, el.elapsed); });
  el.currentBody.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-choose]');
    if (b) choose(parseInt(b.getAttribute('data-choose'), 10));
  });
  el.warn.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="reload"]');
    if (b) reread();
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, a = document.activeElement, act = null;
    if (k === 'ArrowRight' || k === 'PageDown') act = goNext;
    else if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (a && a.tagName === 'BUTTON' && a !== el.next) return;   // the focused button's own key
      act = goNext;
    } else if (k === 'ArrowLeft' || k === 'PageUp') act = goBack;
    else if (/^[1-9]$/.test(k)) act = function () { choose(parseInt(k, 10) - 1); };
    else if (k === 'r' || k === 'R') act = resetTimer;
    if (!act) return;
    e.preventDefault();
    if (!e.repeat) act();          // a key held down moves once
  });

  /* ------------------------------------------------------------------ boot */

  window.__vnPresenter = { P: P, render: render, load: load, fit: fit };
  applyTheme();
  tick();
  setInterval(tick, 250);
  if (!VN) {
    setWarn('<strong>vn.js did not load</strong>, so this window cannot read the script.');
    return;
  }
  var src = params.get('src'), story = params.get('story'), post = params.get('post');
  if (src) load({ src: src });
  else if (post) load({ post: post });
  else if (story) load({ story: story });
  else render();
  openChannel();
})();
