/*
 * audio.js : the Paper Theatre's sound (window.VNAudio). Browser only; plays what score.js (VNScore) writes.
 *
 * Every sound is synthesised here from oscillators and noise: no audio files, no library.
 *
 *   unlock()                 create the one AudioContext (only ever from a trusted click) and start
 *   sync(cue, {instant})     move to this cue: a new key crossfades on the next bar line (at once when instant);
 *                            a null cue or a null track fades the music out; ambience layers fade on their own
 *   hold(on)                 a menu: hang on an unresolved chord until hold(false), then resolve
 *   sting(kind)              'chapter' | 'end'
 *   sfx(name)                'page' | 'chime' | 'door' | 'keys' | 'thud' | 'bell' | 'click'
 *   voice(castKey, ch)       a soft blip per typed character (Voices on)
 *   volumes({music, ambience, sfx, voice, mute})
 *   suspend() / resume()
 *   renderOffline(cue, bars) -> Promise<AudioBuffer>   the same graph on an OfflineAudioContext
 *   tempo                    the current tempo in beats per minute
 *
 * The graph: voices -> slot (tone low-pass [-> tape band-pass, with a slow pitch wobble on every voice] -> crossfade
 * gain) -> music bus (volume) -> master; music bus -> reverb send -> high-pass -> convolver (a generated 2.8 s
 * impulse) -> master. Ambience layers -> ambience bus; effects -> effects bus (with a little reverb); voices -> voice
 * bus. master (mute) -> limiter -> out. Every bus node is fixed at two channels (see Engine).
 * A look-ahead scheduler (a 25 ms timer, 150 ms ahead on the audio clock) writes the notes; it does not run while
 * the context is suspended. Finished voices are stopped and disconnected by the scheduler.
 *
 * What moves when: sync() compares the music part of the cue (track, filter, seed) and the ambience names
 * separately. New music crossfades in on the next bar line; a change of ambience alone fades its layers and leaves
 * the phrase alone. An instant sync (Skip, Back, a load) cuts at once and starts what is wanted 0.22 s after the
 * last such call, so skipping does not strike the first note of every scene on the way.
 *
 * For tests: _debug() and _Engine. Nothing else here is called by the stage.
 */
(function (root) {
  'use strict';

  var LOOKAHEAD = 0.15, TICK_MS = 25, MAX_VOICES = 56;
  var SLIDE = 0.15;                       // time constant of volume changes (s)
  var SETTLE = 0.22, SETTLE_FIRST = 0.3;  // how long an instant change, and the first start, wait before sounding (s)

  function SC() { return root.VNScore || null; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strHash(s) {
    var h = 0x811c9dc5;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // volume sliders (0..1) to gains: a square law, so the low half of a slider is usable
  var GAIN = { music: 1.5, ambience: 1.4, sfx: 1.2, voice: 2.2 };
  var DEFAULTS = { music: 0.55, ambience: 0.4, sfx: 0.6, voice: 0.35, mute: false };   // the stage's own defaults
  function curve(x, k) { x = clamp(+x || 0, 0, 1); return x * x * k; }
  // stop whatever a parameter was scheduled to do from `at` on, holding the value it has reached by then
  function hush(param, at) {
    if (param.cancelAndHoldAtTime) { try { param.cancelAndHoldAtTime(at); return; } catch (e) { /* fall through */ } }
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
  }
  function stereo(node) {
    try { node.channelCount = 2; node.channelCountMode = 'explicit'; node.channelInterpretation = 'speakers'; } catch (e) { /* an old browser: leave it */ }
    return node;
  }

  // how loud each ambience is under the music, before the ambience slider
  var AMB_LEVEL = { rain: 0.12, wind: 0.22, sea: 0.25, train: 0.36, hum: 0.03, crowd: 0.2, night: 0.24, room: 0.2 };

  /* ================================================================== the engine: one graph on one context */

  function Engine(ctx) {
    var E = this;
    E.ctx = ctx;
    E.sr = ctx.sampleRate;
    E.rand = mulberry32(0x5eed);
    E.voices = [];
    E.slots = [];
    E.layers = [];
    // Every bus node is told to work in stereo, always. Left to itself a node follows its inputs, and a filter,
    // the convolver or the limiter that goes from two channels to one (a stereo noise burst ending while mono
    // notes ring on) starts again from an empty state: a click as loud as the note.
    E.out = stereo(ctx.createGain()); E.out.gain.value = 0.92;
    E.limiter = stereo(ctx.createDynamicsCompressor());
    E.limiter.threshold.value = -9; E.limiter.knee.value = 6; E.limiter.ratio.value = 12;
    E.limiter.attack.value = 0.003; E.limiter.release.value = 0.25;
    E.master = stereo(ctx.createGain()); E.master.gain.value = 1;
    E.master.connect(E.limiter); E.limiter.connect(E.out); E.out.connect(ctx.destination);

    E.music = stereo(ctx.createGain()); E.music.gain.value = curve(DEFAULTS.music, GAIN.music);
    E.amb = stereo(ctx.createGain()); E.amb.gain.value = curve(DEFAULTS.ambience, GAIN.ambience);
    E.fx = stereo(ctx.createGain()); E.fx.gain.value = curve(DEFAULTS.sfx, GAIN.sfx);
    E.vox = stereo(ctx.createGain()); E.vox.gain.value = curve(DEFAULTS.voice, GAIN.voice);
    E.ambIn = stereo(ctx.createBiquadFilter()); E.ambIn.type = 'lowpass'; E.ambIn.frequency.value = 5000; E.ambIn.Q.value = 0.5;
    E.ambIn.connect(E.amb);
    E.music.connect(E.master); E.amb.connect(E.master); E.fx.connect(E.master); E.vox.connect(E.master);

    E.reverb = stereo(ctx.createConvolver());
    E.reverb.buffer = E.impulse(2.8);
    E.revSend = stereo(ctx.createGain()); E.revSend.gain.value = 0.6;
    E.revHp = stereo(ctx.createBiquadFilter()); E.revHp.type = 'highpass'; E.revHp.frequency.value = 320; E.revHp.Q.value = 0.5;
    // (The low notes stay dry. A noise impulse answers every pitch with its own random gain and phase, so a loud
    // room makes some notes swell and others sink: measured at this setting the room changes the first 0.7 s of a
    // single note by at most 1.7 dB between E2 and C6; at send 0.66 and 200 Hz it was 3.7 dB.)
    E.fxSend = stereo(ctx.createGain()); E.fxSend.gain.value = 0.2;
    E.revOut = stereo(ctx.createGain()); E.revOut.gain.value = 0.9;
    E.music.connect(E.revSend); E.fx.connect(E.fxSend);
    E.revSend.connect(E.revHp); E.fxSend.connect(E.revHp); E.revHp.connect(E.reverb);
    E.reverb.connect(E.revOut); E.revOut.connect(E.master);

    E.noise = E.noiseBuffer(4);
    E.pluckCache = {};
    // the felt piano: two partial sets, one a little brighter, played slightly detuned against each other
    E.waveA = E.wave([0, 1, 0.6, 0.34, 0.2, 0.13, 0.09, 0.06, 0.045, 0.03, 0.02, 0.014, 0.01]);
    E.waveB = E.wave([0, 1, 0.3, 0.26, 0.08, 0.1, 0.03, 0.03, 0.012, 0.01, 0.005]);
    E.trainWave = E.wave([0, 1, 0.7, 0.45, 0.3, 0.2]);
  }

  Engine.prototype.wave = function (amps) {
    var re = new Float32Array(amps.length), im = new Float32Array(amps.length);
    for (var i = 0; i < amps.length; i++) im[i] = amps[i];
    return this.ctx.createPeriodicWave(re, im);
  };

  Engine.prototype.noiseBuffer = function (sec) {
    var ctx = this.ctx, n = Math.floor(this.sr * sec), buf = ctx.createBuffer(2, n, this.sr), r = mulberry32(12345);
    for (var c = 0; c < 2; c++) { var d = buf.getChannelData(c); for (var i = 0; i < n; i++) d[i] = r() * 2 - 1; }
    return buf;
  };

  // about 2.8 s of exponentially decaying noise that grows darker as it decays, with a short pre-delay
  Engine.prototype.impulse = function (sec) {
    var ctx = this.ctx, sr = this.sr, n = Math.floor(sr * sec), pre = Math.floor(sr * 0.012);
    var buf = ctx.createBuffer(2, n, sr), rc = mulberry32(777), rs = mulberry32(778);
    var d0c = buf.getChannelData(0), d1c = buf.getChannelData(1);
    // A middle that both channels share and a side they take with opposite signs, the side only above about
    // 350 Hz: wide, yet a single note's echo leans neither way, and a low note stays in the centre.
    var split = 1 - Math.exp(-2 * Math.PI * 350 / sr), ls = 0, y0 = 0, y1 = 0;
    for (var i = pre; i < n; i++) {
      var t = (i - pre) / sr, p = t / sec;
      var c = rc() * 2 - 1, u = rs() * 2 - 1;
      ls += split * (u - ls);
      var side = 0.4 * (u - ls), x0 = c + side, x1 = c - side;
      var a = 0.55 - 0.35 * p;                           // one-pole low-pass: open at first, darker at the end
      y0 += a * (x0 - y0); y1 += a * (x1 - y1);
      var env = Math.exp(-6.9 * p) * (1 - Math.exp(-t * 400));
      d0c[i] = y0 * env; d1c[i] = y1 * env;
    }
    // the two channels carry the same energy, so the room is centred
    var e0 = 0, e1 = 0, d0 = buf.getChannelData(0), d1 = buf.getChannelData(1), j;
    for (j = 0; j < n; j++) { e0 += d0[j] * d0[j]; e1 += d1[j] * d1[j]; }
    var k1 = Math.sqrt(e0 / (e1 || 1));
    for (j = 0; j < n; j++) d1[j] *= k1;
    return buf;
  };

  /* ------------------------------------------------------------------ voices */

  Engine.prototype.osc = function (type, f, when) {
    var o = this.ctx.createOscillator();
    if (type === 'A') o.setPeriodicWave(this.waveA);
    else if (type === 'B') o.setPeriodicWave(this.waveB);
    else o.type = type;
    o.frequency.value = f;
    o.start(when);
    return o;
  };

  Engine.prototype.noiseSrc = function (when, loop) {
    var s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = !!loop;
    s.start(when, this.rand() * 3);
    return s;
  };

  Engine.prototype.filter = function (type, f, q) {
    var b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q == null ? 0.7 : q;
    return b;
  };

  Engine.prototype.gain = function (v) { var g = this.ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; };

  Engine.prototype.addVoice = function (v) {
    this.voices.push(v);
    if (!this.offline && this.voices.length > MAX_VOICES) {
      // too many voices ringing: release the oldest that is still sounding
      var now = this.ctx.currentTime;
      for (var i = 0; i < this.voices.length; i++) {
        if (!this.voices[i].killed) { this.kill(this.voices[i], Math.max(now, this.voices[i].start)); break; }
      }
    }
    return v;
  };

  Engine.prototype.kill = function (v, at) {
    if (v.killed) return;
    v.killed = true;
    try {
      v.env.gain.cancelScheduledValues(at);
      v.env.gain.setTargetAtTime(0, at, 0.03);
      v.srcs.forEach(function (s) { try { s.stop(at + 0.25); } catch (e) { /* already stopped */ } });
    } catch (e) { /* a node already gone */ }
    v.end = Math.min(v.end, at + 0.3);
  };

  // play one score event at `when` (seconds on the context clock) into `dest`; spb = seconds per beat
  Engine.prototype.play = function (ev, when, spb, dest, wobble) {
    var ctx = this.ctx, f = mtof(ev.midi), dur = Math.max(0.05, ev.d * spb), vel = clamp(ev.vel, 0, 1);
    var nodes = [], srcs = [], env, end, i, wob = [];
    function det(o) { if (wobble) { wobble.connect(o.detune); wob.push(o.detune); } }
    switch (ev.voice) {
      case 'piano': {
        // the second string of the unison: quieter and a third of a hertz sharp, so the pair shimmers slowly and
        // never cancels (two equal partners a few cents apart beat to nothing once a second up high)
        var o1 = this.osc('A', f, when), o2 = this.osc('B', f + 0.33, when), g2 = this.gain(0.42);
        det(o1); det(o2);
        var lp = this.filter('lowpass', 1000, 0.6);
        var bright = Math.min(5200, f * (2.5 + 8 * vel)), dark = Math.max(240, f * 1.6);
        lp.frequency.setValueAtTime(bright, when);
        lp.frequency.setTargetAtTime(dark, when + 0.01, 0.55);
        env = this.gain(0);
        var peak = vel * 0.52, tail = clamp(2.4 - (ev.midi - 48) / 30, 0.7, 2.8);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(peak, when + 0.01);
        env.gain.setTargetAtTime(peak * 0.42, when + 0.01, 0.11);         // the first, fast stage
        env.gain.setTargetAtTime(0.0001, when + 0.3, tail);              // the long ring under the pedal
        var off = when + Math.max(dur, 0.35);
        env.gain.setTargetAtTime(0, off, 0.45);                           // the damper, slow as on a half pedal
        o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(env); env.connect(dest);
        end = off + 2.7;
        o1.stop(end); o2.stop(end);
        nodes.push(o1, o2, g2, lp, env); srcs.push(o1, o2);
        if (vel > 0.22) {
          // a little key noise: the felt hitting the string
          var ns = this.noiseSrc(when, false), bp = this.filter('bandpass', 1600 + f, 1.2), ng = this.gain(0);
          ng.gain.setValueAtTime(vel * 0.009, when);
          ng.gain.setTargetAtTime(0, when + 0.004, 0.012);
          ns.connect(bp); bp.connect(ng); ng.connect(dest);
          ns.stop(when + 0.08);
          nodes.push(ns, bp, ng); srcs.push(ns);
        }
        break;
      }
      case 'pad': {
        env = this.gain(0);
        var plp = this.filter('lowpass', Math.min(1600, f * 3), 0.4);
        var lfo = this.osc('sine', 4.6, when), vib = this.gain(0);
        vib.gain.setValueAtTime(0, when);
        vib.gain.linearRampToValueAtTime(0, when + 0.9);
        vib.gain.linearRampToValueAtTime(4, when + 2.2);                 // a delayed, gentle vibrato (cents)
        lfo.connect(vib);
        var dets = [-7, 0, 7.5];
        for (i = 0; i < 3; i++) {
          var so = this.osc('sawtooth', f, when);
          so.detune.value = dets[i];
          vib.connect(so.detune); det(so);
          so.connect(plp);
          nodes.push(so); srcs.push(so);
        }
        var att = Math.min(1.4, dur * 0.5), poff = when + dur;
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(vel * 0.16, when + att);
        env.gain.setTargetAtTime(0, poff, 0.7);
        plp.connect(env); env.connect(dest);
        end = poff + 3.5;
        srcs.concat([lfo]).forEach(function (s) { s.stop(end); });
        nodes.push(plp, env, lfo, vib); srcs.push(lfo);
        break;
      }
      case 'musicbox': {
        // two-operator FM: a tine with a quickly fading metallic edge
        var car = this.osc('sine', f, when), mo = this.osc('sine', f * 3, when), mg = this.gain(0);
        mg.gain.setValueAtTime(f * 1.1, when);
        mg.gain.setTargetAtTime(f * 0.05, when, 0.06);
        mo.connect(mg); mg.connect(car.frequency);
        det(car);
        env = this.gain(0);
        var mtail = clamp(1.1 - (ev.midi - 72) / 40, 0.4, 1.3);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(vel * 0.42, when + 0.003);
        env.gain.setTargetAtTime(0, when + 0.003, mtail * 0.55);
        car.connect(env); env.connect(dest);
        end = when + mtail * 4 + 0.2;
        car.stop(end); mo.stop(end);
        nodes.push(car, mo, mg, env); srcs.push(car, mo);
        break;
      }
      case 'pluck': {
        var src = this.ctx.createBufferSource();
        src.buffer = this.pluck(ev.midi);
        if (wobble && src.detune) { wobble.connect(src.detune); wob.push(src.detune); }   // (an old Safari has no detune here)
        env = this.gain(vel * 1.2);
        var plf = this.filter('lowpass', Math.min(3200, f * 4), 0.5);
        src.connect(plf); plf.connect(env); env.connect(dest);
        src.start(when);
        var koff = when + Math.max(dur, 0.4);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(vel * 1.2, when + 0.005);       // a soft finger, not a nail
        env.gain.setTargetAtTime(0, koff, 0.25);
        end = Math.min(when + src.buffer.duration, koff + 1.2) + 0.05;
        src.stop(end);
        nodes.push(src, plf, env); srcs.push(src);
        break;
      }
      case 'bass': {
        var bo = this.osc('sine', f, when), bo2 = this.osc('triangle', f * 2, when), b2g = this.gain(0.14);
        det(bo);
        env = this.gain(0);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(vel * 0.48, when + 0.012);
        env.gain.setTargetAtTime(vel * 0.24, when + 0.012, 0.35);
        var boff = when + Math.max(dur, 0.25);
        env.gain.setTargetAtTime(0, boff, 0.16);
        bo.connect(env); bo2.connect(b2g); b2g.connect(env); env.connect(dest);
        // a soft click at the onset
        var cl = this.osc('sine', f * 6, when), cg = this.gain(0);
        cg.gain.setValueAtTime(vel * 0.05, when);
        cg.gain.setTargetAtTime(0, when, 0.006);
        cl.connect(cg); cg.connect(dest);
        end = boff + 1.0;
        bo.stop(end); bo2.stop(end); cl.stop(when + 0.06);
        nodes.push(bo, bo2, b2g, env, cl, cg); srcs.push(bo, bo2, cl);
        break;
      }
      case 'celesta': {
        var c1 = this.osc('sine', f, when), c4 = this.osc('sine', f * 4, when), c4g = this.gain(0);
        det(c1);
        c4g.gain.setValueAtTime(0.22, when);
        c4g.gain.setTargetAtTime(0, when, 0.07);
        c4.connect(c4g);
        env = this.gain(0);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(vel * 0.62, when + 0.003);
        env.gain.setTargetAtTime(0, when + 0.003, 0.6);
        c1.connect(env); c4g.connect(env); env.connect(dest);
        end = when + 3;
        c1.stop(end); c4.stop(when + 0.6);
        nodes.push(c1, c4, c4g, env); srcs.push(c1, c4);
        break;
      }
      default:
        return null;
    }
    return this.addVoice({ nodes: nodes, srcs: srcs, env: env, start: when, end: end, killed: false, dest: dest, wobble: wob.length ? wobble : null, wob: wob });
  };

  // Karplus-Strong, rendered once per pitch into a buffer
  Engine.prototype.pluck = function (midi) {
    if (this.pluckCache[midi]) return this.pluckCache[midi];
    var sr = this.sr, f = mtof(midi), N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 1.8);
    var buf = this.ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), r = mulberry32(midi * 7919), i;
    for (i = 0; i < N; i++) d[i] = r() * 2 - 1;
    for (var pass = 0; pass < 3; pass++) for (i = 1; i < N; i++) d[i] = 0.5 * (d[i] + d[i - 1]);   // a soft pluck
    var rho = clamp(0.9975 - (midi - 48) * 0.00008, 0.993, 0.998), peak = 0;
    for (i = N; i < len; i++) d[i] = rho * 0.5 * (d[i - N] + (i - N - 1 >= 0 ? d[i - N - 1] : 0));
    for (i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (i = 0; i < len; i++) d[i] *= 0.8 / peak;
    this.pluckCache[midi] = buf;
    return buf;
  };

  /* ------------------------------------------------------------------ slots: one per cue, crossfaded */

  Engine.prototype.slot = function (cue, at, fade) {
    var s = { cue: cue, end: Infinity, nodes: [], srcs: [], wobble: null };
    s.input = stereo(this.filter('lowpass', 6500, 0.5));           // nothing bright: the room is dark
    var last = s.input;
    if (cue.filter === 'tape') {
      // a worn tape: a narrower band and a slow pitch wobble
      var hp = stereo(this.filter('highpass', 170, 0.5)), lp = stereo(this.filter('lowpass', 2300, 0.9));
      last.connect(hp); hp.connect(lp); last = lp;
      var lfo = this.osc('sine', 0.55, at), lfo2 = this.osc('sine', 0.13, at), w = this.gain(7), w2 = this.gain(5);
      lfo.connect(w); lfo2.connect(w2);
      var sum = this.gain(1);
      w.connect(sum); w2.connect(sum);
      s.wobble = sum;
      s.nodes.push(hp, lp, lfo, lfo2, w, w2, sum); s.srcs.push(lfo, lfo2);
    }
    s.out = stereo(this.gain(0));
    s.out.gain.setValueAtTime(0, at);
    s.out.gain.linearRampToValueAtTime(1, at + Math.max(0.02, fade));
    last.connect(s.out);
    s.out.connect(this.music);
    s.nodes.push(s.input, s.out);
    this.slots.push(s);
    return s;
  };

  Engine.prototype.retire = function (s, at, fade) {
    if (!s || s.end !== Infinity) return;
    var g = s.out.gain;
    hush(g, at);
    g.setTargetAtTime(0, at, Math.max(0.01, fade / 4));
    s.end = at + fade + 0.5;
    var self = this;
    this.voices.forEach(function (v) { if (v.dest === s.input) { if (fade < 0.6) self.kill(v, at + fade); else v.end = Math.min(v.end, s.end); } });
    s.srcs.forEach(function (o) { try { o.stop(s.end); } catch (e) { /* stopped */ } });
  };

  /* ------------------------------------------------------------------ ambience */

  // a gain whose value is `base` plus a slow sine of depth `depth`
  Engine.prototype.mod = function (base, rate, depth, at, nodes, srcs) {
    var g = this.gain(base), o = this.osc('sine', rate, at), d = this.gain(depth);
    o.connect(d); d.connect(g.gain);
    nodes.push(g, o, d); srcs.push(o);
    return g;
  };

  // a slow random signal in -1..1 with about `hz` of bandwidth (the noise buffer played very slowly), scaled by
  // `depth` and added to `param`: gusts, swells and murmurs that never repeat the way a sine does
  Engine.prototype.drift = function (param, hz, depth, at, nodes, srcs) {
    var s = this.ctx.createBufferSource(), d = this.gain(depth);
    s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = 2 * hz / this.sr;
    s.start(at, this.rand() * 3);
    s.connect(d); d.connect(param);
    nodes.push(s, d); srcs.push(s);
  };

  Engine.prototype.layer = function (name, at, fade) {
    var L = { name: name, nodes: [], srcs: [], end: Infinity, next: at + 0.5, rand: mulberry32(strHash(name) ^ 0xa5a5) };
    var n = L.nodes, s = L.srcs, src, a, b, m;
    L.gain = this.gain(0);
    L.gain.gain.setValueAtTime(0, at);
    L.gain.gain.linearRampToValueAtTime(AMB_LEVEL[name] || 0.1, at + Math.max(0.05, fade));
    L.gain.connect(this.ambIn);
    n.push(L.gain);
    function noise(E) { var x = E.noiseSrc(at, true); n.push(x); s.push(x); return x; }
    switch (name) {
      case 'rain':
        src = noise(this); a = this.filter('bandpass', 1300, 0.45); b = this.filter('lowpass', 4500, 0.5);
        m = this.mod(0.75, 0.05, 0.12, at, n, s);
        src.connect(a); a.connect(b); b.connect(m); m.connect(L.gain);
        n.push(a, b);
        L.event = 'drop';
        break;
      case 'wind':
        src = noise(this); a = this.filter('lowpass', 420, 2.2);
        var fo = this.osc('sine', 0.06, at), fd = this.gain(200);
        fo.connect(fd); fd.connect(a.frequency);
        m = this.mod(0.55, 0.09, 0.2, at, n, s);
        this.drift(m.gain, 0.3, 0.3, at, n, s);                         // gusts
        this.drift(a.frequency, 0.2, 110, at, n, s);
        src.connect(a); a.connect(m); m.connect(L.gain);
        n.push(a, fo, fd); s.push(fo);
        break;
      case 'sea':
        src = noise(this); a = this.filter('lowpass', 620, 0.4);
        m = this.mod(0.5, 0.075, 0.36, at, n, s);
        this.drift(m.gain, 0.12, 0.12, at, n, s);                       // no two swells alike
        src.connect(a); a.connect(m); m.connect(L.gain);
        n.push(a);
        break;
      case 'train':
        src = noise(this); a = this.filter('lowpass', 170, 1.0);
        m = this.gain(0.55);
        var ro = this.ctx.createOscillator(); ro.setPeriodicWave(this.trainWave); ro.frequency.value = 1.15; ro.start(at);
        var rd = this.gain(0.32);
        ro.connect(rd); rd.connect(m.gain);
        src.connect(a); a.connect(m); m.connect(L.gain);
        n.push(a, m, ro, rd); s.push(ro);
        break;
      case 'hum':
        [[60, 0.5], [60.8, 0.5], [120, 0.18], [120.7, 0.16]].forEach(function (p) {
          var o = this.osc('sine', p[0], at), g = this.gain(p[1]);
          o.connect(g); g.connect(L.gain); n.push(o, g); s.push(o);
        }, this);
        break;
      case 'crowd':
        // three bands of murmur, each rising and falling on its own at about the pace of syllables
        [[420, 1.2, 0.5, 3.1], [950, 1.6, 0.34, 4.3], [1900, 2.0, 0.15, 5.7]].forEach(function (p) {
          var x = noise(this), bf = this.filter('bandpass', p[0], p[1]), g = this.gain(p[2]);
          this.drift(g.gain, p[3], p[2] * 0.9, at, n, s);
          x.connect(bf); bf.connect(g); g.connect(L.gain);
          n.push(bf, g);
        }, this);
        break;
      case 'night':
        src = noise(this); a = this.filter('lowpass', 320, 0.5); b = this.gain(0.35);
        src.connect(a); a.connect(b); b.connect(L.gain);
        n.push(a, b);
        L.event = 'chirp';
        break;
      default: // room: the barely audible air of a closed room
        src = noise(this); a = this.filter('lowpass', 150, 0.5);
        src.connect(a); a.connect(L.gain);
        n.push(a);
        break;
    }
    this.layers.push(L);
    return L;
  };

  // the sparse events of a layer (rain drops, crickets) between `from` and `to`
  Engine.prototype.layerEvents = function (L, from, to) {
    if (!L.event || L.end !== Infinity) return;
    if (L.next < from) L.next = from;
    while (L.next < to) {
      var t = L.next, r = L.rand;
      if (L.event === 'drop') {
        this.blip(L, t, 2200 + r() * 2400, 0.012, 0.08 + r() * 0.12, 0.7);
        L.next = t + 0.08 + r() * 0.55;
      } else {
        var f = 4200 + r() * 500, k = 2 + Math.floor(r() * 3);
        for (var i = 0; i < k; i++) this.blip(L, t + i * 0.07, f, 0.022, 0.05, 0.5);
        L.next = t + 1.6 + r() * 3.4;
      }
    }
  };

  Engine.prototype.blip = function (L, when, f, len, vol, drop) {
    var o = this.osc('sine', f, when), g = this.gain(0);
    o.frequency.setValueAtTime(f, when);
    o.frequency.exponentialRampToValueAtTime(f * drop, when + len);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.002, len / 3);
    o.connect(g); g.connect(L.gain);
    o.stop(when + len * 2 + 0.02);
    this.voices.push({ nodes: [o, g], srcs: [o], env: g, start: when, end: when + len * 2 + 0.05, killed: false, dest: L.gain, amb: true });
  };

  Engine.prototype.stopLayer = function (L, at, fade) {
    if (L.end !== Infinity) return;
    hush(L.gain.gain, at);
    L.gain.gain.setTargetAtTime(0, at, Math.max(0.01, fade / 4));
    L.end = at + fade + 0.3;
    L.srcs.forEach(function (o) { try { o.stop(L.end); } catch (e) { /* stopped */ } });
  };

  /* ------------------------------------------------------------------ effects */

  Engine.prototype.sfx = function (name, when) {
    var E = this, dest = this.fx, nodes = [], srcs = [], end = when + 0.5, env;
    function tone(type, f, vol, tau, len) {
      var o = E.osc(type, f, when), g = E.gain(0);
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.004); g.gain.setTargetAtTime(0, when + 0.004, tau);
      o.connect(g); g.connect(dest); o.stop(when + len);
      nodes.push(o, g); srcs.push(o); env = env || g;
      end = Math.max(end, when + len + 0.05);
      return o;
    }
    function burst(t, type, f, q, vol, tau, len) {
      var s = E.noiseSrc(t, false), b = E.filter(type, f, q), g = E.gain(0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, tau);
      s.connect(b); b.connect(g); g.connect(dest); s.stop(t + len);
      nodes.push(s, b, g); srcs.push(s); env = env || g;
      end = Math.max(end, t + len + 0.05);
      return b;
    }
    switch (name) {
      case 'page': {
        var b = burst(when, 'bandpass', 900, 0.9, 0.0, 0.1, 0.45);
        var g = nodes[nodes.length - 1];
        g.gain.cancelScheduledValues(when);
        g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.28, when + 0.09); g.gain.setTargetAtTime(0, when + 0.12, 0.08);
        b.frequency.setValueAtTime(900, when); b.frequency.exponentialRampToValueAtTime(3000, when + 0.3);
        break;
      }
      case 'chime':
        tone('sine', mtof(84), 0.12, 0.6, 3); tone('sine', mtof(91), 0.07, 0.45, 2.5);
        break;
      case 'door': {
        var d = tone('sine', 110, 0.32, 0.13, 0.7);
        d.frequency.setValueAtTime(110, when); d.frequency.exponentialRampToValueAtTime(52, when + 0.25);
        burst(when, 'lowpass', 500, 0.7, 0.2, 0.07, 0.4);
        break;
      }
      case 'keys':
        [0, 0.09, 0.17, 0.31, 0.38].forEach(function (t, i) { burst(when + t, 'bandpass', 2400 + i * 180, 2.2, 0.16, 0.008, 0.06); });
        break;
      case 'thud': {
        var t1 = tone('sine', 72, 0.4, 0.1, 0.6);
        t1.frequency.setValueAtTime(72, when); t1.frequency.exponentialRampToValueAtTime(40, when + 0.3);
        burst(when, 'lowpass', 220, 0.7, 0.22, 0.05, 0.3);
        break;
      }
      case 'bell':
        [[1, 0.13, 1.3], [2, 0.06, 0.8], [2.76, 0.05, 0.5], [5.4, 0.022, 0.25]].forEach(function (p) { tone('sine', 659.25 * p[0], p[1], p[2], p[2] * 6); });
        break;
      case 'click':
        burst(when, 'bandpass', 3000, 1.5, 0.2, 0.004, 0.03);
        break;
      default:
        return;
    }
    this.voices.push({ nodes: nodes, srcs: srcs, env: env, start: when, end: end, killed: false, dest: dest, sfx: true });
  };

  Engine.prototype.blipVoice = function (f, when) {
    var o = this.osc('triangle', f, when), lp = this.filter('lowpass', 2200, 0.5), g = this.gain(0);
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.12, when + 0.006); g.gain.setTargetAtTime(0, when + 0.012, 0.018);
    o.connect(lp); lp.connect(g); g.connect(this.vox);
    o.stop(when + 0.12);
    this.voices.push({ nodes: [o, lp, g], srcs: [o], env: g, start: when, end: when + 0.15, killed: false, dest: this.vox, sfx: true });
  };

  Engine.prototype.volumes = function (v, instant) {
    var now = this.ctx.currentTime, tau = instant ? 0.001 : SLIDE;
    this.music.gain.setTargetAtTime(curve(v.music, GAIN.music), now, tau);
    this.amb.gain.setTargetAtTime(curve(v.ambience, GAIN.ambience), now, tau);
    this.fx.gain.setTargetAtTime(curve(v.sfx, GAIN.sfx), now, tau);
    this.vox.gain.setTargetAtTime(curve(v.voice, GAIN.voice), now, tau);
    // mute is a short ramp to exactly nothing (a muted page should send digital silence), and back
    var m = this.master.gain, target = v.mute ? 0 : 1;
    if (this.muteTarget === target) return;
    this.muteTarget = target;
    if (instant) { m.cancelScheduledValues(now); m.setValueAtTime(target, now); return; }
    hush(m, now);
    m.linearRampToValueAtTime(target, now + 0.12);
  };

  // disconnect what has finished
  Engine.prototype.sweep = function (now) {
    function drop(list) {
      return list.filter(function (x) {
        if (x.end > now) return true;
        x.srcs.forEach(function (s) { try { s.stop(); } catch (e) { /* never started, or stopped already */ } });
        x.nodes.forEach(function (nd) { try { nd.disconnect(); } catch (e) { /* gone */ } });
        // a voice on a tape bus: unhook the bus's wobble from this voice's pitch (a bus has a wobble but no such list)
        if (x.wobble && x.wob) x.wob.forEach(function (p) { try { x.wobble.disconnect(p); } catch (e) { /* gone */ } });
        return false;
      });
    }
    this.voices = drop(this.voices);
    this.slots = drop(this.slots);
    this.layers = drop(this.layers);
  };

  Engine.prototype.nodeCount = function () {
    var n = 0;
    this.voices.forEach(function (v) { n += v.nodes.length; });
    this.slots.forEach(function (s) { n += s.nodes.length; });
    this.layers.forEach(function (l) { n += l.nodes.length; });
    return n;
  };

  /* ================================================================== the live player */

  var ctx = null, E = null, timer = 0;
  var wanted = null;          // the last cue synced (kept from before unlock too)
  var lastCue = null;         // the last cue with a theme, for stings in a silence
  var cur = null;             // {cue, slot, bar, next, spb, events, pending}
  var holding = false, holdIdx = 0, resolveNext = false, quietUntil = 0;
  var settleAt = 0, settleSoft = false;     // an instant change waits this long for the reader to stop moving
  var vols = { music: DEFAULTS.music, ambience: DEFAULTS.ambience, sfx: DEFAULTS.sfx, voice: DEFAULTS.voice, mute: false };
  var lastBlip = 0;
  var hidden = false;

  function beats(cue) { return (cue && cue.theme && cue.theme.beats) || cue && cue.beats || 4; }

  function startCue(cue, at, fade) {
    cur = { cue: cue, slot: E.slot(cue, at, fade), bar: 0, next: at, spb: 60 / (cue.tempo || 66), events: [], pending: null };
    if (resolveNext && !holding) cur.resolve = true;
  }

  // the part of the key that the music hears: the ambience has layers of its own
  function musicKey(c) { return c && c.track ? c.track + '|' + (c.filter || 'none') + '|' + c.seed : null; }

  // move to `cue` now. instant: cut (Skip, Back, a load); soft: the very first notes after a silence
  function apply(cue, instant, soft) {
    if (!E) return;
    var now = ctx.currentTime;
    // ambience: each layer on its own
    var names = (cue && cue.ambience) || [], fade = instant ? 0.4 : 3.5;
    E.layers.forEach(function (L) { if (L.end === Infinity && names.indexOf(L.name) < 0) E.stopLayer(L, now, fade); });
    names.forEach(function (nm) {
      var on = E.layers.some(function (L) { return L.name === nm && L.end === Infinity; });
      if (!on) E.layer(nm, now + 0.02, instant ? 0.6 : 4);
    });
    // music
    var k = musicKey(cue);
    if (cue && cue.theme) lastCue = cue;
    if (cur && k === musicKey(cur.cue)) { cur.cue = cue; cur.pending = null; return; }
    if (!k) {
      if (cur) { E.retire(cur.slot, now, instant ? 0.3 : 3); cur = null; }
      return;
    }
    if (!cur || instant) {
      if (cur) E.retire(cur.slot, now, 0.25);
      startCue(cue, now + 0.06, soft ? 1.2 : 0.3);
      return;
    }
    cur.pending = cue;            // crossfade on the next bar line
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime, horizon = now + LOOKAHEAD;
    E.sweep(now);
    if (settleAt && now >= settleAt) { var soft = settleSoft; settleAt = 0; settleSoft = false; apply(wanted, true, soft); }
    if (cur) {
      if (cur.next < now) cur.next = now + 0.02;            // the clock ran on without us (a stall)
      var guard = 0;
      while (cur && cur.next < horizon && guard++ < 8) {
        if (cur.next < quietUntil) cur.next = quietUntil;
        if (cur.next >= horizon) break;
        if (cur.pending && !holding) {
          var nc = cur.pending, at = cur.next;
          E.retire(cur.slot, at, 2.6);
          startCue(nc, at, 1.6);
          continue;
        }
        var evs, sc = SC();
        if (!sc) evs = [];
        else if (holding) evs = sc.holdBar(cur.cue, holdIdx++);
        else if (cur.resolve) {
          evs = sc.resolveBar(cur.cue);
          cur.resolve = false;
          resolveNext = false;
          cur.bar = Math.ceil((cur.bar + 1) / sc.CYCLE) * sc.CYCLE;   // the next phrase starts fresh after a breath
          cur.breath = 1;
        } else if (cur.breath) { evs = []; cur.breath = 0; }
        else evs = sc.bar(cur.cue, cur.bar++);
        var start = cur.next;
        evs.forEach(function (e) { cur.events.push({ when: start + e.t * cur.spb, ev: e }); });
        cur.next = start + beats(cur.cue) * cur.spb;
      }
      if (cur) {
        var keep = [];
        cur.events.forEach(function (x) {
          if (x.when < horizon) E.play(x.ev, Math.max(x.when, now), cur.spb, cur.slot.input, cur.slot.wobble);
          else keep.push(x);
        });
        cur.events = keep;
      }
    }
    E.layers.forEach(function (L) { E.layerEvents(L, now, horizon); });
  }

  // One failure must not become forty a second: if the scheduler ever throws (a browser this was not tried in),
  // it says so once and stops; the theatre reads on in silence.
  var failed = null;
  function tick() {
    try { schedule(); } catch (e) {
      failed = String(e && e.message || e);
      stopTimer();
      if (root.console && root.console.warn) root.console.warn('[vn] the sound stopped: its scheduler failed', e);
    }
  }
  function startTimer() { if (!timer && !failed) timer = setInterval(tick, TICK_MS); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }

  var api = {
    unlock: function () {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!ctx) {
        if (!AC) return;
        try { ctx = new AC({ latencyHint: 'balanced' }); } catch (e) { ctx = new AC(); }
        E = new Engine(ctx);
        E.volumes(vols, true);
        if (!hidden) startTimer();
        // the cue that was waiting (the title's) starts softly in a moment, unless the stop that follows this
        // click asks for another one first
        settleAt = ctx.currentTime + SETTLE_FIRST; settleSoft = true;
      }
      // (also after an interruption, a phone call on iOS: any later gesture starts it again)
      if (ctx.state !== 'running' && !hidden) { var p = ctx.resume(); if (p && p.then) p.then(null, function () {}); }
    },

    sync: function (cue, o) {
      wanted = cue || null;
      if (cue && cue.theme) lastCue = cue;
      if (!E) return;
      var now = ctx.currentTime;
      if (o && o.instant) {
        // a stop reached by Skip, Back or a load: what no longer fits is cut at once, and anything new waits a
        // moment, so that a run of skipped stops does not strike the first note of every scene it passes
        if (cur && musicKey(wanted) !== musicKey(cur.cue)) { E.retire(cur.slot, now, 0.25); cur = null; }
        if (!settleAt) settleSoft = false;
        settleAt = now + SETTLE;
        return;
      }
      if (settleAt) return;       // still settling: the settled start takes this cue
      apply(wanted, false, !cur);
    },

    hold: function (on) {
      on = !!on;
      if (on === holding) return;
      holding = on;
      if (on) holdIdx = 0;
      if (!E || !cur) { resolveNext = false; return; }
      var now = ctx.currentTime;
      cur.events = cur.events.filter(function (x) { return x.when < now + 0.05; });   // the harmony stops moving
      cur.next = now + 0.08;
      if (on) { resolveNext = false; cur.resolve = false; }
      else { resolveNext = true; cur.resolve = true; }
    },

    sting: function (kind) {
      var sc = SC();
      if (!E || !sc || ctx.state !== 'running') return;
      var c = lastCue || wanted, evs = sc.sting(c, kind);
      if (!evs.length) return;
      var now = ctx.currentTime + 0.05, spb = 60 / ((c && c.tempo) || 64), B = beats(c);
      // straight into the music bus, not into the track's own bus: a sting must not fade with the track it ends,
      // nor pass through a flashback's tape
      evs.forEach(function (e) { E.play(e, now + e.t * spb, spb, E.music, null); });
      if (kind === 'end' && cur) {
        // the cadence speaks alone; the finale follows it
        cur.events = cur.events.filter(function (x) { return x.when < now; });
        quietUntil = now + B * 2 * spb;
      }
    },

    sfx: function (name) {
      if (!E || ctx.state !== 'running') return;
      E.sfx(name, ctx.currentTime + 0.01);
    },

    voice: function (castKey, ch) {
      if (!E || ctx.state !== 'running' || vols.mute) return;
      var now = ctx.currentTime;
      if (now - lastBlip < 0.055) return;           // at most about eighteen a second
      lastBlip = now;
      var base = 58 + (strHash(castKey) % 9), steps = [0, 2, 4, 7, 9];
      var c = String(ch || ' ').charCodeAt(0) || 32;
      E.blipVoice(mtof(base + steps[c % 5] + (/[A-Z]/.test(ch) ? 12 : 0)), now + 0.005);
    },

    volumes: function (v) {
      v = v || {};
      ['music', 'ambience', 'sfx', 'voice'].forEach(function (k) { if (typeof v[k] === 'number') vols[k] = clamp(v[k], 0, 1); });
      if (typeof v.mute === 'boolean') vols.mute = v.mute;
      if (E) E.volumes(vols, false);
    },

    suspend: function () {
      hidden = true;
      stopTimer();
      if (ctx && ctx.state === 'running') { var p = ctx.suspend(); if (p && p.then) p.then(null, function () {}); }
    },

    resume: function () {
      hidden = false;
      if (!ctx) return;
      var p = ctx.resume();
      if (p && p.then) p.then(function () {
        if (cur && cur.next < ctx.currentTime) { cur.events = []; cur.next = ctx.currentTime + 0.1; }
      }, function () {});
      startTimer();
    },

    renderOffline: function (cue, bars) {
      var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext, sc = SC();
      if (!OAC) return Promise.reject(new Error('no OfflineAudioContext'));
      bars = Math.max(1, bars || 8);
      var spb = 60 / ((cue && cue.tempo) || 64), B = beats(cue), len = bars * B * spb + 3.5, sr = 44100;
      var octx = new OAC(2, Math.ceil(len * sr), sr), e = new Engine(octx);
      e.offline = true;           // everything is scheduled at time 0: no voice cap
      e.volumes(DEFAULTS, true);  // always at the default volumes, whatever the reader has set
      if (cue && cue.track && sc) {
        var s = e.slot(cue, 0, 0.02);
        for (var i = 0; i < bars; i++) {
          sc.bar(cue, i).forEach(function (x) { e.play(x, 0.05 + (i * B + x.t) * spb, spb, s.input, s.wobble); });
        }
      }
      ((cue && cue.ambience) || []).forEach(function (nm) { var L = e.layer(nm, 0, 0.3); e.layerEvents(L, 0, len); });
      return octx.startRendering();
    },

    // for tests: what is alive right now. {meter: true} also taps the output and reports its level from then on
    _debug: function (o) {
      var level = null;
      if (E && o && o.meter && !E.meter) { E.meter = ctx.createAnalyser(); E.meter.fftSize = 2048; E.out.connect(E.meter); }
      if (E && E.meter) {
        var b = new Float32Array(2048), sum = 0;
        E.meter.getFloatTimeDomainData(b);
        for (var i = 0; i < b.length; i++) sum += b[i] * b[i];
        level = Math.sqrt(sum / b.length);
      }
      return {
        level: level, settling: !!settleAt, failed: failed,
        // seconds until the last voice now alive is due to end (null in JSON if one would never end)
        farthest: E ? E.voices.reduce(function (a, v) { return Math.max(a, v.end - ctx.currentTime); }, 0) : 0,
        ctx: !!ctx, state: ctx ? ctx.state : null, time: ctx ? ctx.currentTime : 0,
        voices: E ? E.voices.length : 0, sounding: E ? E.voices.filter(function (v) { return !v.killed && !v.amb && !v.sfx && v.end > ctx.currentTime; }).length : 0,
        slots: E ? E.slots.length : 0, layers: E ? E.layers.map(function (L) { return L.name + (L.end === Infinity ? '' : '~'); }) : [],
        nodes: E ? E.nodeCount() : 0, key: cur ? cur.cue.key : null, pending: cur && cur.pending ? cur.pending.key : null,
        holding: holding, bar: cur ? cur.bar : 0, timer: !!timer, vols: vols
      };
    }
  };

  api._Engine = Engine;       // for tests: build the graph on any context

  Object.defineProperty(api, 'tempo', {
    enumerable: true,
    get: function () { return (cur && cur.cue.tempo) || (wanted && wanted.tempo) || 64; }
  });

  root.VNAudio = api;
}(typeof self !== 'undefined' ? self : this));
