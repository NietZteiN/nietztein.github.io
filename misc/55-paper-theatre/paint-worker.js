/*
 * paint-worker.js: runs VNPaint.filter (paint.js, the very same function) off the main thread and encodes the result.
 *
 * Message in:  {id, w, h, seed, bmp, ovBmp}       the picture and (optionally) its text as ImageBitmaps, or
 *              {id, w, h, seed, rgba, overlay}    the same as pixel arrays, when the page could not make bitmaps
 * Message out: {id, blob}                         the painting, JPEG when the picture is opaque, else PNG; or
 *              {id, rgba, opaque}                 the painted pixels, when this worker cannot encode (no OffscreenCanvas); or
 *              {id, error}
 */
/* global importScripts, VNPaint, OffscreenCanvas, ImageData */
importScripts('paint.js');

function vnpRead(bmp, w, h) {
  var c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return g.getImageData(0, 0, w, h).data;
}

self.onmessage = function (ev) {
  var d = ev.data || {};
  function fail(err) { self.postMessage({ id: d.id, error: String((err && err.message) || err) }); }
  try {
    var rgba = d.rgba, overlay = d.overlay || null, opaque = true, i;
    if (d.bmp) {
      rgba = vnpRead(d.bmp, d.w, d.h);
      overlay = d.ovBmp ? vnpRead(d.ovBmp, d.w, d.h) : null;
    }
    if (!rgba) { fail('no picture'); return; }
    for (i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) { opaque = false; break; }
    var out = VNPaint.filter(rgba, d.w, d.h, { seed: d.seed, overlay: overlay });
    if (typeof OffscreenCanvas === 'function' && OffscreenCanvas.prototype.convertToBlob) {
      var c = new OffscreenCanvas(d.w, d.h);
      c.getContext('2d').putImageData(new ImageData(out, d.w, d.h), 0, 0);
      c.convertToBlob(opaque ? { type: 'image/jpeg', quality: 0.93 } : { type: 'image/png' }).then(function (blob) {
        self.postMessage({ id: d.id, blob: blob });
      }, fail);
    } else {
      self.postMessage({ id: d.id, rgba: out, opaque: opaque }, [out.buffer]);
    }
  } catch (err) { fail(err); }
};
