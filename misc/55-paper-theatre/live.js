/*
 * Paper Theatre - the living cast (optional module, reached only through the stage's ext()).
 *
 *   VNLive.attach(actorEl, castDecl)   start breathing and blinking for a .vn-actor (again when its markup is replaced)
 *   VNLive.detach(actorEl)             stop and forget it; the figure keeps the pose it has while it fades out
 *   VNLive.speak(castKey, on)          flap that character's mouth while on; shut when off
 *   VNLive.setEnabled(bool)            off: every actor still, every overlay hidden, nothing scheduled
 *
 * The drawing is art-cast.js's: each face group holds a hidden shut-eye overlay (.vn-blink) and a hidden open
 * mouth (.vn-mouth); this module only sets data-live, data-blink and data-mouth on the actor element, and
 * vn-live.css does the rest. The stage rewrites the actor's class on every stop, so state lives in data
 * attributes, which it leaves alone; a change of face is only a class on the face groups, so the overlays follow
 * it with no work here.
 *
 * Timing: breathing is a CSS animation (4 to 6 s, its delay from a hash of the key; vn-live.css says why it moves
 * in steps). Blinks come every 3 to 7 s (about 120 ms shut, now and then twice) and the mouth opens and shuts
 * every 90 to 160 ms, both from one scheduler (a single timer for every actor) driven by seeded generators per
 * character (one for the eyes, one for the mouth, so how long a line took to type does not move the blinks): a run
 * is the same twice. The scheduler stops while the tab is hidden and holds nothing once every actor is detached.
 *
 * Two moments would make a breathing figure jump, and both are handled here. An actor that leaves is detached
 * before its fade-out: its animations are paused (data-live="hold"), so it fades in the pose it had. And a
 * transition shows a clone of the world, whose animations would start again from rest: the clone's are paused
 * too (vn-live.css), and each cloned actor is given the delay that puts it at the pose of the original.
 */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var enabled = false;
  var actors = [];          // {el, key, kind, delay, rng (blinks), talk (mouth), ev: {blink, mouth}}
  var speaking = {};        // castKey -> true while that character's line is typing
  var queue = [];           // {t, fn, a, tag}
  var timer = null, hiddenAt = 0;
  var gone = {};            // key -> {at, lag}: the pose of an actor detached a moment ago (for a transition's clone)
  var watching = false;

  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function between(rng, lo, hi) { return lo + rng() * (hi - lo); }

  /* ---------------------------------------------------------------- the one scheduler */

  function arm() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length || document.hidden) return;
    var first = queue[0].t;
    for (var i = 1; i < queue.length; i++) if (queue[i].t < first) first = queue[i].t;
    timer = setTimeout(tick, Math.max(0, first - now()));
  }
  function tick() {
    timer = null;
    var t = now() + 4, due = [];
    queue = queue.filter(function (ev) { if (ev.t <= t) { due.push(ev); return false; } return true; });
    due.sort(function (x, y) { return x.t - y.t; });
    due.forEach(function (ev) {
      if (ev.a.ev[ev.tag] !== ev) return;
      ev.a.ev[ev.tag] = null;
      if (!ev.a.el.isConnected) { drop(ev.a); return; }
      ev.fn();
    });
    arm();
  }
  function later(a, tag, ms, fn) {
    cancel(a, tag);
    var ev = { t: now() + ms, fn: fn, a: a, tag: tag };
    a.ev[tag] = ev;
    queue.push(ev);
    arm();
  }
  function cancel(a, tag) {
    var ev = a.ev[tag];
    if (!ev) return;
    a.ev[tag] = null;
    var i = queue.indexOf(ev);
    if (i >= 0) queue.splice(i, 1);
    if (!queue.length && timer) { clearTimeout(timer); timer = null; }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = now();
      if (timer) { clearTimeout(timer); timer = null; }
      // nobody is left with the eyes shut while the tab is away
      actors.forEach(function (a) { a.el.removeAttribute('data-blink'); });
    } else {
      var gap = hiddenAt ? now() - hiddenAt : 0;
      hiddenAt = 0;
      queue.forEach(function (ev) { ev.t += gap; });
      arm();
    }
  });

  /* ---------------------------------------------------------------- one actor */

  function find(el) { for (var i = 0; i < actors.length; i++) if (actors[i].el === el) return actors[i]; return null; }
  function byKey(key) { for (var i = 0; i < actors.length; i++) if (actors[i].key === key) return actors[i]; return null; }
  function blinks(a) { return !!a.el.querySelector('.vn-blink'); }
  function talks(a) { return !!a.el.querySelector('.vn-mouth'); }

  // How far the actor's CSS animations have run, in ms (they all start together, when data-live is set);
  // null when that cannot be known.
  function clock(el) {
    var g = el.querySelector('.vn-breath, .vn-drift'), list, i;
    if (!g || typeof g.getAnimations !== 'function') return null;
    try { list = g.getAnimations(); } catch (e) { return null; }
    for (i = 0; i < list.length; i++) if (list[i].animationName && typeof list[i].currentTime === 'number') return list[i].currentTime;
    return null;
  }

  // Stop the overlays and the timers. Then either rest (the still drawing) or, with hold, keep the pose: the
  // animations are paused where they are, for a figure that is on its way out.
  function still(a, hold) {
    cancel(a, 'blink');
    cancel(a, 'mouth');
    a.el.removeAttribute('data-blink');
    a.el.removeAttribute('data-mouth');
    if (hold && a.el.hasAttribute('data-live')) { a.el.setAttribute('data-live', 'hold'); return; }
    a.el.removeAttribute('data-live');
    a.el.style.removeProperty('--vn-breath');
    a.el.style.removeProperty('--vn-breath-at');
  }
  function drop(a, hold) {
    still(a, hold);
    var i = actors.indexOf(a);
    if (i >= 0) actors.splice(i, 1);
  }

  function nextBlink(a, first) {
    if (!blinks(a)) return;
    later(a, 'blink', first ? between(a.rng, 900, 4200) : between(a.rng, 3000, 7000), function () { shut(a, a.rng() < 0.16); });
  }
  function shut(a, twice) {
    a.el.setAttribute('data-blink', '');
    later(a, 'blink', between(a.rng, 105, 140), function () {
      a.el.removeAttribute('data-blink');
      if (twice) later(a, 'blink', between(a.rng, 90, 130), function () { shut(a, false); });
      else nextBlink(a, false);
    });
  }

  function flap(a) {
    if (!talks(a)) return;
    var open = !a.el.hasAttribute('data-mouth');
    if (open) a.el.setAttribute('data-mouth', ''); else a.el.removeAttribute('data-mouth');
    later(a, 'mouth', between(a.talk, 90, 160), function () { flap(a); });
  }
  function hush(a) { cancel(a, 'mouth'); a.el.removeAttribute('data-mouth'); }

  function wake(a) {
    var h = fnv(a.key);
    a.delay = (h >>> 11) % 1800;
    a.el.style.setProperty('--vn-breath', (4 + (h % 2001) / 1000).toFixed(3) + 's');
    a.el.style.setProperty('--vn-breath-at', a.delay + 'ms');
    a.el.setAttribute('data-live', '');
    if (!a.ev.blink) nextBlink(a, true);
    if (speaking[a.key.toLowerCase()] && !a.ev.mouth) flap(a);
  }

  /* ---------------------------------------------------------------- the snapshot a transition holds */

  // The stage clones the world onto .vn-trans and changes the real one underneath. The clone's animations are
  // paused by vn-live.css; a paused animation with the delay (own delay - time run) stands at the same pose.
  function settle(world) {
    if (!world.querySelectorAll) return;
    var list = world.querySelectorAll('.vn-actor[data-live]'), t = now();
    for (var i = 0; i < list.length; i++) {
      var c = list[i], key = c.getAttribute('data-key') || '', a = byKey(key), lag = null;
      if (a && a.el.hasAttribute('data-live')) { var run = clock(a.el); if (run != null) lag = a.delay - run; }
      else if (gone[key] && t - gone[key].at < 250) lag = gone[key].lag;
      if (lag != null) c.style.setProperty('--vn-breath-at', lag.toFixed(1) + 'ms');
    }
  }
  function watch() {
    if (watching || typeof root.MutationObserver !== 'function') return;
    var layer = document.querySelector('.vn-trans');
    if (!layer) return;
    watching = true;
    new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) for (var j = 0; j < recs[i].addedNodes.length; j++) {
        var n = recs[i].addedNodes[j];
        if (n.nodeType === 1) settle(n);
      }
      gone = {};
    }).observe(layer, { childList: true });
  }

  /* ---------------------------------------------------------------- the API the stage calls */

  function attach(el, decl) {
    if (!el || el.nodeType !== 1) return;
    watch();
    var a = find(el);
    if (!a) {
      var key = el.getAttribute('data-key') || (decl && (decl.key || decl.id)) || 'someone';
      a = { el: el, key: String(key), delay: 0, rng: seeded(fnv('live:' + key)), talk: seeded(fnv('talk:' + key)), ev: { blink: null, mouth: null } };
      actors.push(a);
    }
    // a new sprite, or new markup in an old one: start from the still drawing
    still(a);
    a.kind = el.getAttribute('data-kind') || 'person';
    if (enabled) wake(a);
  }
  function detach(el) {
    var a = find(el);
    if (!a) return;
    if (a.el.hasAttribute('data-live')) {
      var run = clock(a.el), t = now();
      Object.keys(gone).forEach(function (k) { if (t - gone[k].at > 250) delete gone[k]; });
      if (run != null) gone[a.key] = { at: t, lag: a.delay - run };
    }
    drop(a, true);
  }
  function speak(key, on) {
    key = String(key || '').toLowerCase();
    if (on) speaking[key] = true; else delete speaking[key];
    actors.forEach(function (a) {
      if (a.key.toLowerCase() !== key) return;
      if (!on) hush(a);
      else if (enabled && a.el.isConnected && !a.ev.mouth) flap(a);
    });
  }
  function setEnabled(on) {
    enabled = !!on;
    actors.slice().forEach(function (a) {
      if (!a.el.isConnected) { drop(a); return; }
      if (enabled) wake(a); else still(a);
    });
  }
  // for the tests: what is attached and what is scheduled
  function state() {
    return {
      enabled: enabled, actors: actors.map(function (a) { return a.key; }), queue: queue.length, timer: !!timer,
      speaking: Object.keys(speaking)
    };
  }

  root.VNLive = { attach: attach, detach: detach, speak: speak, setEnabled: setEnabled, _state: state };
})(typeof self !== 'undefined' ? self : this);
