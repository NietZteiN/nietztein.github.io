/* Spectrogram Painter UI. The engine (synthesis, FFT, wav, font, samples) lives in synth.js. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (typeof Synth === 'undefined') {
    $('nojs').textContent = 'The engine script (synth.js) did not load, so nothing can be painted or played. Reload the page.';
    return;
  }

  var W = 512, H = 256, SR = 44100, FMIN = 100, FMAX = 8000, SEED = 1234;
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var NOWORKER = params.get('noworker') === '1';
  if (THUMB) document.body.classList.add('thumb');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- state ---------- */
  var img = new Float32Array(W * H);
  var spec = null;                 // analysed spectrogram of the last render
  var buffer = null;               // Float32Array samples of the last render
  var dirty = true;
  var duration = 6;
  var tool = 'brush', size = 6, soft = 0.4, flow = 1, tscale = 8;
  var mapName = 'phosphor', LUT;
  var undoStack = [], redoStack = [];
  var loop = true, vol = 0.7;
  var hover = null, stroking = false, last = null, lineStart = null;
  var kc = { x: W / 2, y: H / 2, show: false };
  var needImg = true, needOver = true, rafId = 0;
  var renderTimer = 0, jobId = 0, rendering = false, lastReq = null, renderT0 = 0;
  var pending = { play: false, wav: false };
  var worker = null;

  /* audio */
  var ctx = null, gain = null, analyser = null, source = null, startAt = 0, playing = false;
  var tdBuf = null, vuLevel = 0, vuPeak = 0, vuHold = 0;
  /* mic */
  var micOn = false, micStream = null, micAn = null, micData = null, micT0 = 0, micLastX = -1, micX = 0, gate = -72;

  /* ---------- colour maps ---------- */
  var MAPS = {
    phosphor: { stops: [[0, [1, 4, 3]], [0.18, [3, 40, 20]], [0.48, [18, 150, 62]], [0.78, [135, 245, 120]], [1, [242, 255, 228]]], accent: '#7dff8c' },
    magma: { stops: [[0, [0, 0, 4]], [0.22, [60, 12, 112]], [0.5, [182, 54, 96]], [0.76, [250, 134, 50]], [1, [252, 252, 198]]], accent: '#ffad5c' },
    grey: { stops: [[0, [0, 0, 0]], [1, [255, 255, 255]]], accent: '#e4e8ec' }
  };
  function buildLUT(stops) {
    var lut = new Uint8ClampedArray(256 * 3);
    for (var i = 0; i < 256; i++) {
      var t = i / 255, k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      var a = stops[k], b = stops[k + 1], u = (t - a[0]) / (b[0] - a[0]);
      u = Math.max(0, Math.min(1, u));
      for (var c = 0; c < 3; c++) lut[i * 3 + c] = a[1][c] + (b[1][c] - a[1][c]) * u;
    }
    return lut;
  }
  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function setMap(name) {
    if (!MAPS[name]) return;
    mapName = name;
    LUT = buildLUT(MAPS[name].stops);
    var rgb = hexToRgb(MAPS[name].accent), st = document.documentElement.style;
    st.setProperty('--accent', MAPS[name].accent);
    st.setProperty('--accent-dim', 'rgba(' + rgb.join(',') + ',0.18)');
    st.setProperty('--accent-glow', 'rgba(' + rgb.join(',') + ',0.35)');
    document.querySelectorAll('[data-map]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.map === name)); });
    needImg = true; needOver = true; drawAnalysis(); kick();
  }

  /* ---------- canvases ---------- */
  var paint = $('paint'), paintCtx = paint.getContext('2d');
  var ana = $('ana'), anaCtx = ana.getContext('2d');
  var over = $('over'), overCtx = over.getContext('2d');
  var stagePaint = $('stage-paint');
  var vu = $('vu'), vuCtx = vu.getContext('2d');
  var paintPD = paintCtx.createImageData(W, H), anaPD = anaCtx.createImageData(W, H);
  var dpr = Math.min(2, window.devicePixelRatio || 1);

  function blit(context, pd, data) {
    var d = pd.data;
    for (var i = 0, n = W * H; i < n; i++) {
      var v = data ? data[i] : 0, idx = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0, k = idx * 3, o = i * 4;
      d[o] = LUT[k]; d[o + 1] = LUT[k + 1]; d[o + 2] = LUT[k + 2]; d[o + 3] = 255;
    }
    context.putImageData(pd, 0, 0);
  }
  function paintImage() { blit(paintCtx, paintPD, img); }
  function drawAnalysis() { blit(anaCtx, anaPD, spec); }

  function sizeOverlay() {
    var r = stagePaint.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (over.width !== w || over.height !== h) { over.width = w; over.height = h; }
    needOver = true; kick();
  }
  function drawOverlay() {
    var c = overCtx, sx = over.width / W, sy = over.height / H, sm = (sx + sy) / 2;
    c.clearRect(0, 0, over.width, over.height);
    c.lineWidth = Math.max(1, dpr);
    var accent = MAPS[mapName].accent;
    var p = hover || (kc.show ? kc : null);
    if (micOn) {
      c.strokeStyle = 'rgba(255,95,86,0.9)'; c.lineWidth = 2 * dpr;
      c.beginPath(); c.moveTo((micX + 0.5) * sx, 0); c.lineTo((micX + 0.5) * sx, over.height); c.stroke();
      c.lineWidth = Math.max(1, dpr);
    }
    if (tool === 'line' && lineStart && p) {
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(1, 2 * size * sm); c.lineCap = 'round';
      c.beginPath(); c.moveTo(lineStart.x * sx, lineStart.y * sy); c.lineTo(p.x * sx, p.y * sy); c.stroke();
      c.lineWidth = Math.max(1, dpr);
    }
    if (p) {
      if (tool === 'text') {
        var word = $('word').value || '';
        if (word) {
          var tw = Synth.textWidthCells(word) * tscale * sx, th = 7 * tscale * sy;
          c.strokeStyle = accent; c.setLineDash([4 * dpr, 3 * dpr]);
          c.strokeRect(p.x * sx - tw / 2, p.y * sy - th / 2, tw, th);
          c.setLineDash([]);
        }
      } else {
        var rx = Math.max(1.5 * dpr, size * sx), ry = Math.max(1.5 * dpr, size * sy);
        c.strokeStyle = tool === 'eraser' ? '#ff5f56' : '#ffffff';
        c.beginPath(); c.ellipse(p.x * sx, p.y * sy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.beginPath(); c.ellipse(p.x * sx, p.y * sy, rx + dpr, ry + dpr, 0, 0, Math.PI * 2); c.stroke();
      }
    }
    if (kc.show && !hover) {
      c.strokeStyle = accent;
      c.beginPath();
      c.moveTo(kc.x * sx - 12 * dpr, kc.y * sy); c.lineTo(kc.x * sx + 12 * dpr, kc.y * sy);
      c.moveTo(kc.x * sx, kc.y * sy - 12 * dpr); c.lineTo(kc.x * sx, kc.y * sy + 12 * dpr);
      c.stroke();
    }
    if (tool === 'line' && lineStart) {
      c.fillStyle = accent;
      c.beginPath(); c.arc(lineStart.x * sx, lineStart.y * sy, 3 * dpr, 0, Math.PI * 2); c.fill();
    }
  }

  /* ---------- axes ---------- */
  function fmtHz(f) { return f >= 1000 ? (f / 1000) + 'k' : String(f); }
  function buildYAxis(el, freqs) {
    el.innerHTML = '';
    freqs.forEach(function (f) {
      var sp = document.createElement('span');
      sp.textContent = fmtHz(f);
      sp.style.top = ((Synth.freqToRow(f, H, FMIN, FMAX) + 0.5) / H * 100) + '%';
      el.appendChild(sp);
    });
  }
  function buildXAxis() {
    var el = $('xaxis'); el.innerHTML = '';
    var step = duration >= 12 ? 2 : 1;
    for (var t = 0; t <= duration; t += step) {
      var sp = document.createElement('span');
      sp.textContent = t === duration ? t + ' s' : String(t);
      sp.style.left = (t / duration * 100) + '%';
      el.appendChild(sp);
    }
  }

  /* ---------- readouts ---------- */
  var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function noteName(f) {
    var m = 69 + 12 * Math.log2(f / 440), n = Math.round(m), cents = Math.round((m - n) * 100);
    return NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1) + (cents ? (cents > 0 ? ' +' : ' ') + cents + '¢' : '');
  }
  function cursorReadout(p) {
    var el = $('cursor-readout');
    if (!p) { el.innerHTML = '&nbsp;'; return; }
    var f = Synth.rowFreq(p.y, H, FMIN, FMAX);
    el.textContent = (p.x / W * duration).toFixed(2) + ' s · ' + Math.round(f) + ' Hz · ' + noteName(f);
  }
  var noticeUntil = 0;
  function status(html) { $('status').innerHTML = html; }
  function notice(html) { noticeUntil = performance.now() + 3500; status(html); }
  function toolStatus() {
    if (playing || micOn) return;
    var t = { brush: 'brush', eraser: 'eraser', line: 'line', text: 'text' }[tool];
    if (tool === 'text') status(t + ' <span class="dim">·</span> ' + ($('word').value || '…').toUpperCase().slice(0, 12) + ' <span class="dim">· ' + tscale + ' px cells</span>');
    else if (tool === 'line' && lineStart) status('line <span class="dim">· start set, click or press Enter at the end</span>');
    else status(t + ' <span class="dim">·</span> ' + size + ' px <span class="dim">· soft</span> ' + Math.round(soft * 100) + '% <span class="dim">·</span> ' + Math.round(flow * 100) + '%');
  }

  /* ---------- rendering (synthesis + analysis) ---------- */
  function hop() { return Math.round(duration * SR / W); }
  function setProgress(p) {
    var el = $('progress');
    if (p == null) { el.classList.add('idle'); return; }
    el.classList.remove('idle'); el.firstElementChild.style.width = (p * 100).toFixed(1) + '%';
  }
  function markDirty() {
    dirty = true; needImg = true; kick();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(requestRender, 350);
    updateEditButtons();
  }
  function requestRender() {
    clearTimeout(renderTimer);
    var id = ++jobId;
    rendering = true; renderT0 = performance.now();
    setProgress(0.02);
    $('render-readout').textContent = 'rendering…';
    var copy = new Float32Array(img);
    lastReq = { id: id, img: copy };
    var msg = { cmd: 'render', id: id, img: copy, W: W, H: H, hop: hop(), sr: SR, fmin: FMIN, fmax: FMAX, seed: SEED };
    if (worker) worker.postMessage(msg);
    else runOnMainThread(id, copy);
  }
  function runOnMainThread(id, copy) {
    var job = Synth.createRenderJob({ img: copy, W: W, H: H, hop: hop(), sr: SR, fmin: FMIN, fmax: FMAX, seed: SEED });
    (function step() {
      if (id !== jobId) return;
      var t = performance.now();
      while (!job.done && performance.now() - t < 12) job.step(8);
      setProgress(job.progress * 0.85);
      if (!job.done) { requestAnimationFrame(step); return; }
      var r = job.finish();
      var s = Synth.analyze(r.samples, SR, W, H, { gain: r.gain, fmin: FMIN, fmax: FMAX });
      onRendered(id, { samples: r.samples, spec: s, gain: r.gain, active: r.activeCells });
    })();
  }
  function onRendered(id, res) {
    if (id !== jobId) return;
    rendering = false; dirty = false;
    buffer = res.samples; spec = res.spec;
    var ms = Math.round(performance.now() - renderT0);
    $('render-readout').textContent = (buffer.length / SR).toFixed(1) + ' s · ' + res.active.toLocaleString() + ' partials · ' + ms + ' ms';
    setProgress(null);
    drawAnalysis();
    if (pending.play) { pending.play = false; startPlayback(0); }
    else if (playing) { startPlayback(position() % (buffer.length / SR)); }
    if (pending.wav) { pending.wav = false; downloadWav(); }
    if (!playing && !micOn) toolStatus();
  }
  function initWorker() {
    if (typeof Worker === 'undefined' || NOWORKER) return;
    try {
      worker = new Worker('worker.js');
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.done) onRendered(m.id, m);
        else if (m.progress != null && m.id === jobId) setProgress(m.progress);
      };
      worker.onerror = function (e) {
        e.preventDefault();
        worker.terminate(); worker = null;
        if (lastReq && lastReq.id === jobId && rendering) runOnMainThread(lastReq.id, lastReq.img);
      };
    } catch (e) { worker = null; }
  }

  /* ---------- audio ---------- */
  function ensureAudio() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { status('<span class="dim">this browser has no Web Audio</span>'); return null; }
    ctx = new AC();
    gain = ctx.createGain(); gain.gain.value = vol * vol;
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.3;
    tdBuf = new Float32Array(analyser.fftSize);
    gain.connect(analyser); analyser.connect(ctx.destination);
    return ctx;
  }
  function stopSource() {
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch (e) { /* already stopped */ }
    source.disconnect();
    source = null;
  }
  function startPlayback(offset) {
    var c = ensureAudio();
    if (!c || !buffer) return;
    if (c.state === 'suspended') c.resume();
    stopSource();
    var ab = c.createBuffer(1, buffer.length, SR);
    ab.getChannelData(0).set(buffer);
    var src = c.createBufferSource();
    src.buffer = ab; src.loop = loop; src.connect(gain);
    src.onended = function () { if (source === src) stopPlayback(); };
    offset = Math.max(0, Math.min(offset || 0, ab.duration - 0.001));
    src.start(0, offset);
    source = src; startAt = c.currentTime - offset;
    playing = true;
    $('btn-play').innerHTML = '&#9632; stop';
    $('btn-play').classList.add('playing');
    $('ph-paint').classList.add('show'); $('ph-ana').classList.add('show');
    kick();
  }
  function stopPlayback() {
    stopSource();
    playing = false;
    $('btn-play').innerHTML = '&#9654; play';
    $('btn-play').classList.remove('playing');
    $('ph-paint').classList.remove('show'); $('ph-ana').classList.remove('show');
    toolStatus();
    kick();
  }
  function position() { return ctx ? ctx.currentTime - startAt : 0; }
  function togglePlay() {
    if (playing) { stopPlayback(); return; }
    if (!ensureAudio()) return;
    if (buffer && !dirty) startPlayback(0);
    else { pending.play = true; status('rendering…'); if (!rendering) requestRender(); }
  }
  function setPlayheads(frac) {
    var t = 'translateX(' + (frac * stagePaint.clientWidth).toFixed(1) + 'px)';
    $('ph-paint').style.transform = t; $('ph-ana').style.transform = t;
  }
  function updatePlayhead() {
    if (!playing || !buffer) return;
    var dur = buffer.length / SR, pos = position();
    if (loop) pos = ((pos % dur) + dur) % dur;
    else if (pos >= dur) { stopPlayback(); return; }
    setPlayheads(pos / dur);
    status('playing <span class="dim">·</span> ' + pos.toFixed(1) + ' / ' + dur.toFixed(1) + ' s' + (loop ? ' <span class="dim">· loop</span>' : ''));
  }

  /* VU meter */
  function drawVU(level, peak) {
    var c = vuCtx, w = vu.width, h = vu.height, n = 28, gap = 3, seg = (w - gap) / n;
    c.fillStyle = '#06080a'; c.fillRect(0, 0, w, h);
    for (var i = 0; i < n; i++) {
      var f = (i + 1) / n, on = f <= level;
      var col = f < 0.68 ? '#4de36a' : f < 0.88 ? '#ffb347' : '#ff5f56';
      c.globalAlpha = on ? 1 : 0.16;
      c.fillStyle = col;
      c.fillRect(gap + i * seg, 6, seg - gap, h - 12);
    }
    c.globalAlpha = 1;
    if (peak > 0.02) {
      var pi = Math.min(n - 1, Math.floor(peak * n));
      c.fillStyle = '#ffffff';
      c.fillRect(gap + pi * seg, 6, seg - gap, h - 12);
    }
  }
  function updateVU() {
    var target = 0;
    if (playing && analyser) {
      analyser.getFloatTimeDomainData(tdBuf);
      var sum = 0;
      for (var i = 0; i < tdBuf.length; i++) sum += tdBuf[i] * tdBuf[i];
      var rms = Math.sqrt(sum / tdBuf.length);
      var db = 20 * Math.log10(rms + 1e-9);
      target = Math.max(0, Math.min(1, (db + 42) / 42));
    }
    vuLevel = target > vuLevel ? target : vuLevel * 0.82;
    if (vuLevel > vuPeak) { vuPeak = vuLevel; vuHold = 30; }
    else if (vuHold > 0) vuHold--;
    else vuPeak = Math.max(0, vuPeak - 0.015);
    if (vuLevel < 0.004 && vuPeak <= 0) { vuLevel = 0; drawVU(0, 0); return false; }
    drawVU(vuLevel, vuPeak);
    return true;
  }

  /* ---------- microphone ---------- */
  function startMic() {
    if (micOn) return;
    var c = ensureAudio();
    if (!c) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status('<span class="dim">no microphone access in this browser</span>'); return; }
    if (c.state === 'suspended') c.resume();
    status('asking for the microphone…');
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      micStream = stream;
      var src = c.createMediaStreamSource(stream);
      micAn = c.createAnalyser(); micAn.fftSize = 4096; micAn.smoothingTimeConstant = 0;
      src.connect(micAn);
      micData = new Float32Array(micAn.frequencyBinCount);
      pushUndo();
      micOn = true; micT0 = performance.now(); micLastX = -1; micX = 0;
      $('btn-mic').setAttribute('aria-pressed', 'true'); $('mic-dot').classList.add('live');
      $('micpanel').classList.add('show');
      kick();
    }).catch(function (err) {
      notice('<span class="dim">microphone unavailable: ' + (err && err.name ? err.name : 'blocked') + '</span>');
    });
  }
  function stopMic() {
    if (!micOn) return;
    micOn = false;
    if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
    micStream = null; micAn = null;
    $('btn-mic').setAttribute('aria-pressed', 'false'); $('mic-dot').classList.remove('live');
    $('micpanel').classList.remove('show');
    needOver = true;
    markDirty();
    toolStatus();
  }
  function micStep() {
    if (!micOn || !micAn) return;
    var elapsed = (performance.now() - micT0) / 1000;
    var x = Math.floor((elapsed / duration) * W) % W;
    if (x === micLastX) return;
    micAn.getFloatFrequencyData(micData);
    var binHz = ctx.sampleRate / micAn.fftSize, half = micData.length - 1;
    var col = new Float32Array(H);
    for (var r = 0; r < H; r++) {
      var lo = Synth.rowFreq(r + 0.5, H, FMIN, FMAX) / binHz, hi = Synth.rowFreq(r - 0.5, H, FMIN, FMAX) / binHz, m;
      if (hi - lo < 1) {
        var b = Synth.rowFreq(r, H, FMIN, FMAX) / binHz, b0 = Math.floor(b), fr = b - b0;
        m = micData[Math.min(half, b0)] * (1 - fr) + micData[Math.min(half, b0 + 1)] * fr;
      } else {
        m = -Infinity;
        for (var k = Math.max(0, Math.floor(lo)); k <= Math.min(half, Math.ceil(hi)); k++) if (micData[k] > m) m = micData[k];
      }
      var v = (m - gate) / 50;
      col[r] = v <= 0 ? 0 : v >= 1 ? 1 : v;
    }
    /* fill every column the sweep passed since the last frame */
    var from = micLastX < 0 ? x : micLastX + 1, count = ((x - from + W) % W) + 1;
    if (count > W / 4) { from = x; count = 1; }
    for (var i = 0; i < count; i++) {
      var cx = (from + i) % W;
      for (r = 0; r < H; r++) img[r * W + cx] = col[r];
    }
    micLastX = x; micX = x;
    needImg = true; needOver = true;
    status('listening <span class="dim">·</span> ' + (x / W * duration).toFixed(1) + ' s <span class="dim">· gate</span> ' + gate + ' dB');
  }

  /* ---------- editing ---------- */
  function pushUndo() {
    undoStack.push(new Float32Array(img));
    if (undoStack.length > 30) undoStack.shift();
    redoStack.length = 0;
    updateEditButtons();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(new Float32Array(img));
    img.set(undoStack.pop());
    markDirty();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(new Float32Array(img));
    img.set(redoStack.pop());
    markDirty();
  }
  function updateEditButtons() {
    $('btn-undo').disabled = !undoStack.length;
    $('btn-redo').disabled = !redoStack.length;
  }
  function stampAt(x, y) {
    var word = $('word').value.trim();
    if (!word) { notice('type a word first'); return; }
    pushUndo();
    Synth.stampText(img, W, H, word, x, y, tscale, flow);
    markDirty();
  }
  function actAt(p) {        // keyboard "Enter" with the current tool
    if (tool === 'brush' || tool === 'eraser') {
      pushUndo();
      Synth.dab(img, W, H, p.x, p.y, size, soft, flow, tool === 'eraser');
      markDirty();
    } else if (tool === 'line') {
      if (!lineStart) { lineStart = { x: p.x, y: p.y }; needOver = true; toolStatus(); kick(); }
      else { pushUndo(); Synth.line(img, W, H, lineStart.x, lineStart.y, p.x, p.y, size, soft, flow, false); lineStart = null; markDirty(); toolStatus(); }
    } else if (tool === 'text') stampAt(p.x, p.y);
  }
  function loadGrey(src, sw, sh) {
    pushUndo();
    img.fill(0);
    Synth.fitImage(img, W, H, src, sw, sh);
    markDirty();
  }
  function importFile(file) {
    if (!file || !/^image\//.test(file.type)) { status('<span class="dim">that is not an image</span>'); return; }
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      URL.revokeObjectURL(url);
      var sc = Math.min(1, 1024 / im.naturalWidth, 512 / im.naturalHeight);
      var sw = Math.max(1, Math.round(im.naturalWidth * sc)), sh = Math.max(1, Math.round(im.naturalHeight * sc));
      var cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
      var cc = cv.getContext('2d');
      cc.fillStyle = '#000'; cc.fillRect(0, 0, sw, sh);
      cc.drawImage(im, 0, 0, sw, sh);
      var d = cc.getImageData(0, 0, sw, sh).data, g = new Float32Array(sw * sh);
      for (var i = 0; i < sw * sh; i++) g[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      loadGrey(g, sw, sh);
      notice('imported <span class="dim">' + (file.name || 'image').slice(0, 24) + '</span>');
    };
    im.onerror = function () { URL.revokeObjectURL(url); status('<span class="dim">could not decode that image</span>'); };
    im.src = url;
  }

  /* ---------- downloads ---------- */
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function downloadWav() {
    if (!buffer) return;
    saveBlob(new Blob([Synth.encodeWav(buffer, SR)], { type: 'audio/wav' }), 'spectrogram-painter-' + duration + 's.wav');
    notice('saved <span class="dim">.wav · 16-bit · 44.1 kHz · mono</span>');
  }
  function downloadPng() {
    var cv = document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2;
    var cc = cv.getContext('2d'); cc.imageSmoothingEnabled = true; cc.drawImage(paint, 0, 0, cv.width, cv.height);
    cv.toBlob(function (b) { if (b) saveBlob(b, 'spectrogram-painter.png'); }, 'image/png');
    notice('saved <span class="dim">.png · ' + cv.width + '×' + cv.height + '</span>');
  }

  /* ---------- frame loop ---------- */
  function kick() { if (!rafId) rafId = requestAnimationFrame(frame); }
  function frame() {
    rafId = 0;
    var again = false;
    if (micOn) { micStep(); again = true; }
    if (needImg) { needImg = false; paintImage(); }
    if (needOver) { needOver = false; drawOverlay(); }
    if (playing) { updatePlayhead(); again = true; }
    if (updateVU()) again = true;
    if (again) kick();
  }

  /* ---------- pointer input ---------- */
  function toImg(e) {
    var r = over.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  over.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    over.focus({ preventScroll: true });
    var p = toImg(e);
    hover = p; kc.show = false;
    if (tool === 'brush' || tool === 'eraser') {
      pushUndo();
      stroking = true; last = p;
      Synth.dab(img, W, H, p.x, p.y, size, soft, flow, tool === 'eraser');
      needImg = true;
    } else if (tool === 'line') {
      if (lineStart && e.shiftKey) { pushUndo(); Synth.line(img, W, H, lineStart.x, lineStart.y, p.x, p.y, size, soft, flow, false); lineStart = null; markDirty(); }
      else { lineStart = p; stroking = true; }
    } else if (tool === 'text') stampAt(p.x, p.y);
    try { over.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    needOver = true; kick();
  });
  over.addEventListener('pointermove', function (e) {
    var p = toImg(e);
    hover = p;
    cursorReadout(p);
    if (stroking && (tool === 'brush' || tool === 'eraser')) {
      var events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!events || !events.length) events = [e];
      for (var i = 0; i < events.length; i++) {
        var q = toImg(events[i]);
        Synth.line(img, W, H, last.x, last.y, q.x, q.y, size, soft, flow, tool === 'eraser');
        last = q;
      }
      needImg = true;
    }
    needOver = true; kick();
  });
  function endStroke(e) {
    if (!stroking) return;
    stroking = false;
    if (tool === 'line' && lineStart) {
      var p = toImg(e);
      var d = Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
      if (d > 1.5) { pushUndo(); Synth.line(img, W, H, lineStart.x, lineStart.y, p.x, p.y, size, soft, flow, false); lineStart = null; markDirty(); }
      /* a plain click keeps the start point so the end can be clicked with Shift or pressed with Enter */
    } else markDirty();
    toolStatus();
    needOver = true; kick();
  }
  over.addEventListener('pointerup', endStroke);
  over.addEventListener('pointercancel', endStroke);
  over.addEventListener('pointerleave', function () { if (!stroking) { hover = null; cursorReadout(null); needOver = true; kick(); } });

  /* drag and drop */
  ['dragenter', 'dragover'].forEach(function (ev) {
    stagePaint.addEventListener(ev, function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; stagePaint.classList.add('drop'); });
  });
  stagePaint.addEventListener('dragleave', function () { stagePaint.classList.remove('drop'); });
  stagePaint.addEventListener('drop', function (e) {
    e.preventDefault(); stagePaint.classList.remove('drop');
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  /* ---------- keyboard ---------- */
  function setTool(t) {
    tool = t;
    if (t !== 'line') lineStart = null;
    document.querySelectorAll('[data-tool]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tool === t)); });
    $('textpanel').classList.toggle('show', t === 'text');
    toolStatus(); needOver = true; kick();
  }
  function setSize(v) { size = Math.max(1, Math.min(40, v)); $('size').value = size; $('size-out').textContent = size; fill($('size')); toolStatus(); needOver = true; kick(); }
  function fill(input) {
    var p = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--fill', p.toFixed(1) + '%');
  }
  over.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 10 : 2, moved = true;
    switch (e.key) {
      case 'ArrowLeft': kc.x = Math.max(0, kc.x - step); break;
      case 'ArrowRight': kc.x = Math.min(W - 1, kc.x + step); break;
      case 'ArrowUp': kc.y = Math.max(0, kc.y - step); break;
      case 'ArrowDown': kc.y = Math.min(H - 1, kc.y + step); break;
      case 'Enter': kc.show = true; actAt(kc); moved = false; break;
      case 'Escape': lineStart = null; kc.show = false; toolStatus(); break;
      default: return;
    }
    e.preventDefault();
    if (moved) { kc.show = true; hover = null; cursorReadout(kc); }
    needOver = true; kick();
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type === 'text') return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case ' ': if (tag !== 'button' && tag !== 'input') { e.preventDefault(); togglePlay(); } break;
      case 'b': case 'B': setTool('brush'); break;
      case 'e': case 'E': setTool('eraser'); break;
      case 'l': case 'L': setTool('line'); break;
      case 't': case 'T': setTool('text'); $('word').focus(); e.preventDefault(); break;
      case '[': setSize(size - (size > 10 ? 2 : 1)); break;
      case ']': setSize(size + (size >= 10 ? 2 : 1)); break;
      case 'r': case 'R': setLoop(!loop); break;
      case 'm': case 'M': if (micOn) stopMic(); else startMic(); break;
      case 'Escape': if (micOn) stopMic(); break;
    }
  });

  /* ---------- controls ---------- */
  document.querySelectorAll('[data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
  $('size').addEventListener('input', function () { setSize(+this.value); });
  $('soft').addEventListener('input', function () { soft = this.value / 100; $('soft-out').textContent = this.value + '%'; fill(this); toolStatus(); });
  $('flow').addEventListener('input', function () { flow = this.value / 100; $('flow-out').textContent = this.value + '%'; fill(this); toolStatus(); });
  $('tscale').addEventListener('input', function () { tscale = +this.value; $('tscale-out').textContent = this.value; fill(this); toolStatus(); needOver = true; kick(); });
  $('word').addEventListener('input', function () { this.value = this.value.toUpperCase(); toolStatus(); needOver = true; kick(); });
  $('word').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); stampAt(W / 2, H / 2); } });
  $('btn-stamp').addEventListener('click', function () { stampAt(W / 2, H / 2); });
  $('btn-import').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { if (this.files[0]) importFile(this.files[0]); this.value = ''; });
  $('btn-invert').addEventListener('click', function () { pushUndo(); for (var i = 0; i < img.length; i++) img[i] = 1 - img[i]; markDirty(); });
  $('sample-sine').addEventListener('click', function () { pushUndo(); Synth.samples.sine(img, W, H, FMIN, FMAX); markDirty(); status('sample <span class="dim">·</span> sine wave <span class="dim">· A4 with two harmonics</span>'); });
  $('sample-jvl').addEventListener('click', function () { pushUndo(); Synth.samples.jvl(img, W, H, FMIN, FMAX); markDirty(); status('sample <span class="dim">·</span> JVL'); });
  $('sample-stair').addEventListener('click', function () { pushUndo(); Synth.samples.staircase(img, W, H, FMIN, FMAX); markDirty(); status('sample <span class="dim">·</span> staircase chord <span class="dim">· C major 9 stacked</span>'); });
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-clear').addEventListener('click', function () { pushUndo(); img.fill(0); lineStart = null; markDirty(); });
  $('btn-mic').addEventListener('click', function () { if (micOn) stopMic(); else startMic(); });
  $('gate').addEventListener('input', function () { gate = +this.value; $('gate-out').textContent = gate + ' dB'; fill(this); });
  $('btn-play').addEventListener('click', togglePlay);
  function setLoop(v) { loop = v; $('btn-loop').setAttribute('aria-pressed', String(v)); if (source) source.loop = v; }
  $('btn-loop').addEventListener('click', function () { setLoop(!loop); });
  document.querySelectorAll('[data-dur]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = +b.dataset.dur;
      if (d === duration) return;
      duration = d;
      document.querySelectorAll('[data-dur]').forEach(function (x) { x.setAttribute('aria-pressed', String(+x.dataset.dur === d)); });
      buildXAxis();
      if (micOn) { micT0 = performance.now(); micLastX = -1; }
      if (playing) { stopPlayback(); pending.play = true; }
      markDirty();
    });
  });
  $('vol').addEventListener('input', function () {
    vol = this.value / 100; fill(this);
    if (gain) gain.gain.setTargetAtTime(vol * vol, ctx.currentTime, 0.02);
  });
  document.querySelectorAll('[data-map]').forEach(function (b) { b.addEventListener('click', function () { setMap(b.dataset.map); }); });
  $('btn-wav').addEventListener('click', function () {
    if (buffer && !dirty) downloadWav();
    else { pending.wav = true; status('rendering…'); if (!rendering) requestRender(); }
  });
  $('btn-png').addEventListener('click', downloadPng);

  /* ---------- init ---------- */
  ['size', 'soft', 'flow', 'tscale', 'gate', 'vol'].forEach(function (id) { fill($(id)); });
  buildYAxis($('yaxis-paint'), [8000, 4000, 2000, 1000, 500, 200, 100]);
  buildYAxis($('yaxis-ana'), [8000, 2000, 500, 100]);
  buildXAxis();
  setMap('phosphor');
  if ('ResizeObserver' in window) new ResizeObserver(sizeOverlay).observe(stagePaint);
  else window.addEventListener('resize', sizeOverlay);
  sizeOverlay();
  drawVU(0, 0);
  updateEditButtons();

  Synth.samples.thumb(img, W, H, FMIN, FMAX);
  if (THUMB) {
    /* photogenic, synchronous: render and analyse on the main thread so the screenshot has both */
    var job = Synth.createRenderJob({ img: img, W: W, H: H, hop: hop(), sr: SR, fmin: FMIN, fmax: FMAX, seed: SEED });
    var r = job.finish();
    buffer = r.samples; dirty = false;
    spec = Synth.analyze(buffer, SR, W, H, { gain: r.gain, fmin: FMIN, fmax: FMAX });
    paintImage(); drawAnalysis();
    $('render-readout').textContent = (buffer.length / SR).toFixed(1) + ' s · ' + r.activeCells.toLocaleString() + ' partials';
    $('ph-paint').classList.add('show'); $('ph-ana').classList.add('show');
    setPlayheads(0.44);
    $('btn-play').innerHTML = '&#9632; stop'; $('btn-play').classList.add('playing');
    drawVU(0.74, 0.86);
    $('cursor-readout').textContent = '2.64 s · 440 Hz · A4';
    status('playing <span class="dim">·</span> 2.6 / 6.0 s <span class="dim">· loop</span>');
  } else {
    initWorker();
    paintImage(); drawAnalysis();
    toolStatus();
    requestRender();
  }
  if (reduced) $('progress').style.display = 'none';
})();
