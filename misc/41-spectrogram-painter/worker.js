/* Render worker: synthesises the painted spectrogram off the main thread, then analyses the result. */
importScripts('synth.js');
self.onmessage = function (e) {
  var m = e.data;
  if (m.cmd !== 'render') return;
  var job = Synth.createRenderJob({ img: m.img, W: m.W, H: m.H, hop: m.hop, sr: m.sr, fmin: m.fmin, fmax: m.fmax, seed: m.seed });
  var lastPost = 0;
  while (!job.done) {
    job.step(24);
    var now = Date.now();
    if (now - lastPost > 60) { lastPost = now; self.postMessage({ id: m.id, progress: job.progress * 0.8 }); }
  }
  var res = job.finish();
  self.postMessage({ id: m.id, progress: 0.85 });
  var spec = Synth.analyze(res.samples, m.sr, m.W, m.H, { gain: res.gain, fmin: m.fmin, fmax: m.fmax });
  self.postMessage({ id: m.id, done: true, samples: res.samples, spec: spec, gain: res.gain, active: res.activeCells }, [res.samples.buffer, spec.buffer]);
};
