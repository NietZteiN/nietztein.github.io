/*
 * Paper Theatre - the multiplane camera (window.VNCamera).
 *
 * The painted world is a stack of planes (.vn-bg, .vn-fxback, .vn-sprites, .vn-cgart, .vn-fxlayer). The camera
 * moves them by different small amounts so the picture has depth: the background least, the cast more, the
 * weather in front most. On a desktop the pointer leads it; on a touch screen it drifts very slowly by itself
 * (no sensor is read, so nothing asks for a permission). A long line gets a slow push-in (scale 1.00 to 1.03),
 * which comes back to rest on the next line; a CG gets a slow pan.
 *
 * How: this file only writes four CSS custom properties (--cam-x, --cam-y, --cam-push, --cam-pan) on the
 * .vn-world element, and sets the class vn-cam on #stage; camera.css turns them into a transform per plane, with
 * each plane scaled up just enough that its edge never shows. The transition snapshot is world.cloneNode(true)
 * in .vn-trans, so it is born carrying the same four numbers and the same transforms; while it is up the same
 * numbers are written on it too, frame by frame. Every value is eased here and never by a CSS transition or
 * animation (a cloned element would restart one): nothing jumps when a transition starts or ends.
 *
 * Contract (OPS.md, Optional modules): attach(stageEl), present(state, op), reset(), setEnabled(bool).
 * Nothing moves until attach() and setEnabled(true); the stage keeps it disabled under reduced motion, ?thumb=1,
 * ?autoplay=, Effects off and Camera off (camera=1 forces it on). debug() is a read-only view for the harness.
 */
(function (root) {
  'use strict';

  var LONG = 90;               // a say / narrate line at least this long gets the push-in
  var PUSH = 0.03;             // the push-in reaches scale 1 + PUSH
  var SETTLE = 1400;           // ms for the framing to come back to rest at a new line
  var TAU = 480;               // ms, the pointer's easing time constant
  var PAN_MS = 28000;          // a CG pans across in this long, then holds

  var stage = null, world = null, trans = null, enabled = false, active = false;
  var held = false;            // after reset(): at rest until the next present (a full-screen menu is up, or the world is empty)
  var hoverless = false;       // touch only: no pointer to follow, a very slow drift instead
  var raf = 0, last = 0, offTimer = 0;
  // the pointer: target (where the reader looks) and current (eased)
  var tx = 0, ty = 0, cx = 0, cy = 0;
  // the push-in: from its value at the start of the line back to 1 over SETTLE, then up to 1 + PUSH when long
  var push = 1, pushFrom = 1, pushT0 = 0, pushLong = false, pushMs = 9000;
  // the CG pan: from panFrom to panTo over PAN_MS
  var pan = 0, panFrom = 0, panTo = 0, panT0 = 0, panOn = false, lastCg = null;
  var written = null, lastSnap = null;

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function ease(t) { t = clamp(t, 0, 1); return 0.5 - 0.5 * Math.cos(Math.PI * t); }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function isLong(op) {
    if (!op || (op.kind !== 'say' && op.kind !== 'narrate')) return false;
    return String(op.text || '').length >= LONG;
  }

  /* ------------------------------------------------------------------ the values at a moment */

  function pushAt(t) {
    var dt = t - pushT0;
    if (dt < SETTLE) return pushFrom + (1 - pushFrom) * ease(dt / SETTLE);
    return pushLong ? 1 + PUSH * ease((dt - SETTLE) / pushMs) : 1;
  }
  // (when the CG goes away the pan is held where it was: panFrom === panTo; see present)
  function panAt(t) { return panFrom + (panTo - panFrom) * ease((t - panT0) / PAN_MS); }
  function driftAt(t) {
    // two slow incommensurate swells, about forty and fifty seconds long: barely noticed, never still
    // (on a phone the whole travel is a few pixels, so the drift uses most of it)
    return { x: 0.85 * Math.sin(t / 41000 * 2 * Math.PI), y: 0.6 * Math.sin(t / 53000 * 2 * Math.PI + 1.3) };
  }

  /* ------------------------------------------------------------------ writing */

  function put(el, v) {
    var s = el.style;
    s.setProperty('--cam-x', v[0]);
    s.setProperty('--cam-y', v[1]);
    s.setProperty('--cam-push', v[2]);
    s.setProperty('--cam-pan', v[3]);
  }
  // the old picture, while a transition holds it: a clone of the world, the only child of its kind in .vn-trans
  function snapshot() {
    var el = trans && trans.firstElementChild;
    return el && el.classList && el.classList.contains('vn-world') ? el : null;
  }
  function write(force) {
    if (!world) return;
    var v = [cx.toFixed(4), cy.toFixed(4), push.toFixed(5), pan.toFixed(4)];
    var same = !force && written && v[0] === written[0] && v[1] === written[1] && v[2] === written[2] && v[3] === written[3];
    if (!same) { put(world, v); written = v; }
    var old = snapshot();
    if (old && (!same || old !== lastSnap)) put(old, v);
    lastSnap = old;
  }

  function step(t) {
    var dt = last ? Math.min(t - last, 100) : 16;
    last = t;
    if (held) return;
    if (hoverless) { var d = driftAt(t); tx = d.x; ty = d.y; }
    var k = 1 - Math.exp(-dt / TAU);
    cx += (tx - cx) * k; cy += (ty - cy) * k;
    if (Math.abs(tx - cx) < 1e-4) cx = tx;
    if (Math.abs(ty - cy) < 1e-4) cy = ty;
    push = pushAt(t);
    pan = panAt(t);
    write(false);
  }
  // is there anything still on its way?
  function moving(t) {
    if (held) return false;
    if (hoverless) return true;
    if (cx !== tx || cy !== ty) return true;
    var dt = t - pushT0;
    if (dt < SETTLE || (pushLong && dt < SETTLE + pushMs)) return true;
    return panOn && t - panT0 < PAN_MS;
  }
  function frame(t) {
    raf = 0;
    if (!active) return;
    step(t);
    if (moving(t)) raf = root.requestAnimationFrame(frame);
    else last = 0;
  }
  function wake() {
    if (active && !raf && root.requestAnimationFrame) { last = 0; raf = root.requestAnimationFrame(frame); }
  }
  // set every value to where it should be now, with no easing (a settled present, a reset)
  function snap() {
    var t = now();
    if (held) { write(false); return; }
    if (hoverless) { var d = driftAt(t); tx = d.x; ty = d.y; }
    cx = tx; cy = ty;
    push = pushAt(t); pan = panAt(t);
    write(false);
  }

  function setActive(on) {
    if (!stage) return;
    active = on;
    stage.classList.toggle('vn-cam', on);
    if (on) { snap(); wake(); }
    else if (raf) { root.cancelAnimationFrame(raf); raf = 0; last = 0; }
  }

  /* ------------------------------------------------------------------ input */

  function onMove(e) {
    if (e.pointerType === 'touch' || !stage) return;
    var r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    tx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
    ty = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
    wake();
  }
  // the pointer left the window: the frame comes back to the middle
  function onOut(e) {
    if (e.pointerType === 'touch' || e.relatedTarget) return;
    tx = 0; ty = 0;
    wake();
  }

  /* ------------------------------------------------------------------ the contract */

  function attach(stageEl) {
    if (!stageEl || stage === stageEl) return;
    stage = stageEl;
    world = null; trans = null;
    for (var c = stage.firstElementChild; c; c = c.nextElementSibling) {
      if (!world && c.classList.contains('vn-world')) world = c;
      else if (!trans && c.classList.contains('vn-trans')) trans = c;
    }
    try { hoverless = !!(root.matchMedia && root.matchMedia('(hover: none)').matches && !root.matchMedia('(any-hover: hover)').matches); } catch (e) { hoverless = false; }
    // the whole window leads the camera (the letterbox around a 16:9 stage too), measured against the stage
    if (root.document) {
      root.document.addEventListener('pointermove', onMove, { passive: true });
      root.document.addEventListener('pointerout', onOut, { passive: true });
      root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) wake(); });
    }
    write(true);
    if (enabled) setActive(true);
  }

  function present(state, op) {
    var t = now();
    state = state || {};
    held = false;
    // the push-in: every new line starts from where the last one left the frame and comes back to rest
    pushFrom = active ? pushAt(t) : 1;
    pushT0 = t;
    pushLong = isLong(op);
    pushMs = clamp(String((op && op.text) || '').length * 60, 7000, 16000);
    // the CG pan: a new picture starts at one side and crosses to the other; the same picture keeps going
    var cg = state.cg && state.cg.name ? state.cg.name + '|' + (state.cg.mod || '') : null;
    if (cg !== lastCg) {
      var here = panAt(t);
      if (cg && lastCg && active) {
        // from another CG (its snapshot may be dissolving away above): carry on from where the pan is now, towards
        // the side that is further away
        panFrom = here; panTo = here > 0 ? -1 : 1; panOn = true;
      } else if (cg) {
        // from nothing (no CG was up, so no picture can be seen to jump): start at one side and cross to the other
        var dir = (hash(cg) & 1) ? 1 : -1;
        panFrom = -dir; panTo = dir; panOn = true;
      } else {
        // the CG goes away, perhaps under a dissolve: its snapshot keeps the framing it had, so the pan is held
        panFrom = here; panTo = here; panOn = false;
      }
      panT0 = t;
      lastCg = cg;
    }
    if (!enabled) { if (stage) snap(); return; }
    // the new picture is in the page already (the stage draws it, then calls this): give it its numbers before
    // it is painted, then go on easing
    push = pushAt(t); pan = panAt(t);
    write(false);
    wake();
  }

  function reset() {
    // the frame comes back to rest at once and stays there until the next present: a full-screen menu is read
    // over a picture that stands still. The pointer target is kept, so the next present eases back to it.
    held = true;
    cx = 0; cy = 0;
    push = 1; pushFrom = 1; pushT0 = now() - SETTLE; pushLong = false;
    pan = 0; panFrom = 0; panTo = 0; panOn = false; lastCg = null;
    write(false);
  }

  function setEnabled(on) {
    on = !!on;
    enabled = on;
    clearTimeout(offTimer);
    // (already on: a settled present has just set the framing; whatever is still on its way goes on)
    if (on) { if (!active) setActive(true); else wake(); return; }
    // The stage rests the camera around a settled present (Back, a load, a menu closing) and enables it again
    // in the same breath; only a rest that lasts (Camera off, Effects off, Skip) brings the planes back to none.
    offTimer = setTimeout(function () { if (!enabled) { setActive(false); neutral(); } }, 40);
  }
  function neutral() {
    if (!stage) return;
    cx = 0; cy = 0; push = 1; pan = 0;
    write(false);
  }

  function debug() {
    return { attached: !!stage, world: !!world, enabled: enabled, active: active, hoverless: hoverless, x: cx, y: cy, tx: tx, ty: ty, push: push, pan: pan, panOn: panOn, long: pushLong, held: held, running: !!raf };
  }

  var api = { attach: attach, present: present, reset: reset, setEnabled: setEnabled, debug: debug, LONG: LONG, PUSH: PUSH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VNCamera = api;
})(typeof window !== 'undefined' ? window : this);
