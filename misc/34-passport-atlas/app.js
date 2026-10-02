/* Passport Atlas — app.js
 * The globe, the flat map, the passport stamps, the stats strip and the sun row.
 * Depends on d3@7 and topojson-client@3 from the CDN for the map; everything else
 * works without them. Country shapes: countries-110m.json (world-atlas, ISC).
 */
(function () {
  'use strict';

  // =====================================================================================
  //  THE LIST. To add a country: one line. `id` is the ISO 3166-1 numeric code as a string
  //  (the id used by world-atlas, e.g. France '250', Spain '724', South Korea '410').
  //  `city` + `tz` drive the sun row; `lat`/`lon` are where the threads land; `code` is the
  //  airport code on the stamp; `pop` is the UN WPP 2024 mid-2024 estimate.
  // =====================================================================================
  var VISITED = [
    { id: '840', name: 'United States', home: true, city: 'Garland, Texas', tz: 'America/Chicago',    lat: 32.91, lon:  -96.64, code: 'DFW', continent: 'North America', pop: 345426571 },
    { id: '704', name: 'Vietnam',       city: 'Hanoi',          tz: 'Asia/Ho_Chi_Minh',    lat: 21.03, lon:  105.85, code: 'HAN', continent: 'Asia',          pop: 100987686 },
    { id: '484', name: 'Mexico',        city: 'Mexico City',    tz: 'America/Mexico_City', lat: 19.43, lon:  -99.13, code: 'MEX', continent: 'North America', pop: 130861007 },
    { id: '124', name: 'Canada',        city: 'Toronto',        tz: 'America/Toronto',     lat: 43.65, lon:  -79.38, code: 'YYZ', continent: 'North America', pop:  39742430 },
    { id: '276', name: 'Germany',       city: 'Berlin',         tz: 'Europe/Berlin',       lat: 52.52, lon:   13.40, code: 'BER', continent: 'Europe',        pop:  84552242 },
    { id: '380', name: 'Italy',         city: 'Rome',           tz: 'Europe/Rome',         lat: 41.90, lon:   12.50, code: 'FCO', continent: 'Europe',        pop:  59342867 },
    { id: '056', name: 'Belgium',       city: 'Brussels',       tz: 'Europe/Brussels',     lat: 50.85, lon:    4.35, code: 'BRU', continent: 'Europe',        pop:  11738763 },
    { id: '392', name: 'Japan',         city: 'Tokyo',          tz: 'Asia/Tokyo',          lat: 35.68, lon:  139.69, code: 'HND', continent: 'Asia',          pop: 123753041 }
  ];
  var WORLD_POP = 8161972572;   // UN World Population Prospects 2024, mid-2024
  var WORLD_COUNTRIES = 195;    // 193 UN members + 2 observer states
  var CONTINENTS_TOTAL = 7;
  var DATA_URL = 'countries-110m.json';
  var EARTH_KM = 6371.0088;

  // ---------------------------------------------------------------------------- helpers
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var THUMB = params.get('thumb') === '1';
  var REDUCED = false;
  try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
  var HOME = VISITED.filter(function (c) { return c.home; })[0] || VISITED[0];
  var byId = {};
  VISITED.forEach(function (c) { byId[c.id] = c; });
  var rad = function (d) { return d * Math.PI / 180; }, deg = function (r) { return r * 180 / Math.PI; };
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var x = seed >>> 0 || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d); }
  function haversine(a, b) {
    var dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fmtLat(v) { return Math.abs(v).toFixed(2) + '° ' + (v < 0 ? 'S' : 'N'); }
  function fmtLon(v) { return Math.abs(v).toFixed(2) + '° ' + (v < 0 ? 'W' : 'E'); }

  // ---------------------------------------------------------------------------- sun
  function sunPosition(date) {
    var n = date.getTime() / 86400000 - 10957.5;                 // days since J2000.0
    var L = (280.460 + 0.9856474 * n) % 360;
    var g = rad((357.528 + 0.9856003 * n) % 360);
    var lambda = rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
    var eps = rad(23.439 - 0.0000004 * n);
    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    var gmst = (280.46061837 + 360.98564736629 * n) % 360;
    var lon = ((deg(ra) - gmst) % 360 + 540) % 360 - 180;
    return { lat: deg(dec), lon: lon };
  }
  function solarElevation(sun, lat, lon) {
    var H = rad(lon - sun.lon);
    return deg(Math.asin(Math.sin(rad(lat)) * Math.sin(rad(sun.lat)) + Math.cos(rad(lat)) * Math.cos(rad(sun.lat)) * Math.cos(H)));
  }
  function sunState(sun, c) {
    var el = solarElevation(sun, c.lat, c.lon);
    var H = ((c.lon - sun.lon) % 360 + 540) % 360 - 180;         // < 0: morning, > 0: afternoon
    var s;
    if (el >= 0) s = { key: 'day', label: 'day · ' + Math.round(el) + '° up' };
    else if (el >= -6) s = { key: 'twilight', label: (H < 0 ? 'dawn' : 'dusk') + ' · civil twilight' };
    else if (el >= -12) s = { key: 'twilight', label: (H < 0 ? 'pre-dawn' : 'post-dusk') + ' · ' + Math.round(-el) + '° down' };
    else s = { key: 'night', label: 'night · ' + Math.round(-el) + '° down' };
    s.el = el;
    return s;
  }
  var GLYPH = {
    day: '<svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="6" fill="#f0b65a"/><g stroke="#f0b65a" stroke-width="1.6" stroke-linecap="round"><path d="M15 2v4M15 24v4M2 15h4M24 15h4M5.8 5.8l2.8 2.8M21.4 21.4l2.8 2.8M5.8 24.2l2.8-2.8M21.4 8.6l2.8-2.8"/></g></svg>',
    twilight: '<svg viewBox="0 0 30 30" aria-hidden="true"><path d="M8 17a7 7 0 0 1 14 0z" fill="#ef6f4c"/><path d="M3 17h24" stroke="#ef6f4c" stroke-width="1.4" stroke-linecap="round"/><path d="M6 22h18" stroke="#ef6f4c" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/></svg>',
    night: '<svg viewBox="0 0 30 30" aria-hidden="true"><path d="M19 4a10 10 0 1 0 7 17 8 8 0 0 1-7-17z" fill="#a9b1c9"/><circle cx="8" cy="7" r="1" fill="#a9b1c9"/><circle cx="5" cy="14" r="0.8" fill="#a9b1c9"/></svg>'
  };
  var fmtCache = {};
  function localTime(tz, date) {
    try {
      if (!fmtCache[tz]) fmtCache[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      return fmtCache[tz].format(date).replace(/^24/, '00');
    } catch (e) { return '--:--'; }
  }
  function renderSuns() {
    var now = THUMB ? new Date('2026-10-02T15:40:00Z') : new Date();
    var sun = sunPosition(now);
    var host = $('suns');
    if (!host.children.length) {
      host.innerHTML = VISITED.map(function (c) {
        return '<div class="sun" data-id="' + c.id + '"><div class="city">' + c.city.replace(/,.*$/, '') + '</div><div class="cc">' + c.name + '</div><div class="time">--:--</div><div class="glyph"></div><div class="state"></div></div>';
      }).join('');
    }
    VISITED.forEach(function (c) {
      var el = host.querySelector('[data-id="' + c.id + '"]');
      var st = sunState(sun, c);
      el.className = 'sun ' + st.key;
      el.querySelector('.time').textContent = localTime(c.tz, now);
      el.querySelector('.state').textContent = st.label;
      if (el.getAttribute('data-glyph') !== st.key) { el.querySelector('.glyph').innerHTML = GLYPH[st.key]; el.setAttribute('data-glyph', st.key); }
    });
    var up = VISITED.filter(function (c) { return sunState(sun, c).el >= 0; }).length;
    $('sun-note').textContent = 'the sun is up in ' + up + ' of ' + VISITED.length + ' right now · subsolar point ' + fmtLat(sun.lat) + ', ' + fmtLon(sun.lon);
    return sun;
  }

  // ---------------------------------------------------------------------------- stats
  function renderStaticStats() {
    var n = VISITED.length;
    $('st-countries').innerHTML = n + '<small>/ ' + WORLD_COUNTRIES + '</small>';
    $('st-countries-s').textContent = pct(n / WORLD_COUNTRIES) + '% of the UN’s member and observer states';
    var people = VISITED.reduce(function (s, c) { return s + c.pop; }, 0);
    $('st-people').innerHTML = pct(people / WORLD_POP) + '<small>%</small>';
    $('st-people-s').textContent = (people / 1e6).toFixed(0) + ' million of ' + (WORLD_POP / 1e9).toFixed(2) + ' billion people · UN WPP 2024';
    var conts = []; VISITED.forEach(function (c) { if (conts.indexOf(c.continent) < 0) conts.push(c.continent); });
    $('st-cont').innerHTML = conts.length + '<small>/ ' + CONTINENTS_TOTAL + '</small>';
    $('st-cont-s').textContent = conts.join(', ');
    var alat = -HOME.lat, alon = ((HOME.lon + 180) % 360 + 540) % 360 - 180;
    $('st-anti').innerHTML = fmtLat(alat) + '<small class="nl">' + fmtLon(alon) + '</small>';
    var perth = { lat: -31.95, lon: 115.86 };
    var toPerth = Math.round(haversine({ lat: alat, lon: alon }, perth) / 100) * 100;
    $('st-anti-s').textContent = 'Indian Ocean, southwest of Australia: open water ' + fmtInt(toPerth) + ' km west of Perth. Dig straight down from ' + HOME.city.replace(/,.*$/, '') + ' and you surface there.';
  }
  function renderFurthest(pairs) {
    var best = null;
    for (var i = 0; i < pairs.length; i++) for (var j = i + 1; j < pairs.length; j++) {
      var d = pairs[i].dist(pairs[j]);
      if (!best || d > best.d) best = { a: pairs[i], b: pairs[j], d: d };
    }
    if (!best) return;
    $('st-far').innerHTML = fmtInt(Math.round(best.d / 10) * 10) + '<small>km</small>';
    $('st-far-s').textContent = best.a.name + ' ↔ ' + best.b.name + ', ' + best.a.how;
  }

  // ---------------------------------------------------------------------------- passport
  var INKS = ['#2c3b8e', '#a52a3b', '#2d6a4a', '#5b3a86', '#1d4e7a', '#8a3f12'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var stamps = [];            // ids in the order they were placed
  var stampSvg, stampLayer;
  var STORE_KEY = 'passport-atlas:stamps';
  function initPassport() {
    var page = $('page');
    var svgNS = 'http://www.w3.org/2000/svg';
    stampSvg = document.createElementNS(svgNS, 'svg');
    stampSvg.setAttribute('viewBox', '0 0 360 440');
    stampSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    stampSvg.setAttribute('aria-hidden', 'true');
    var defs = '';
    for (var i = 0; i < 4; i++) {
      defs += '<filter id="ink' + i + '" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="' + (11 + i * 7) + '" result="warp"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="warp" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="rough"/>' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="' + (3 + i * 5) + '" result="grain"/>' +
        '<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.55" result="mask"/>' +
        '<feComposite in="rough" in2="mask" operator="in"/>' +
        '</filter>';
    }
    defs += '<path id="ringpath" d="M -34 0 a 34 34 0 1 1 68 0 a 34 34 0 1 1 -68 0"/>';
    stampSvg.innerHTML = '<defs>' + defs + '</defs><g id="stamp-layer"></g>';
    page.insertBefore(stampSvg, page.firstChild);
    stampLayer = stampSvg.querySelector('#stamp-layer');
  }
  function stampMarkup(c, k) {
    var r = rng(hash(c.id + ':' + k));
    var slot = k % 8, col = slot % 2, row = Math.floor(slot / 2);
    var extra = k >= 8 ? 26 : 0;
    var x = 96 + col * 168 + (r() - 0.5) * (28 + extra), y = 64 + row * 104 + (r() - 0.5) * (22 + extra);
    var rot = (r() < 0.5 ? -1 : 1) * (4 + r() * 14);
    var ink = INKS[hash(c.id) % INKS.length];
    var variant = (hash(c.id) >> 3) % 3;
    var filter = 'ink' + (hash(c.id + k) % 4);
    var dr = rng(hash('date' + c.id));
    var year = 2015 + Math.floor(dr() * 11), month = MONTHS[Math.floor(dr() * 12)], day = 1 + Math.floor(dr() * 28);
    var date = (day < 10 ? '0' : '') + day + ' ' + month + ' ' + year;
    var name = c.name.toUpperCase();
    var body;
    if (variant === 0) {
      body = '<rect class="ink" x="-76" y="-36" width="152" height="72" rx="7" stroke-width="3"/>' +
        '<rect class="ink" x="-70" y="-30" width="140" height="60" rx="4" stroke-width="1"/>' +
        '<text y="-11" font-size="' + (name.length > 11 ? 11 : 13) + '" letter-spacing="2">' + name + '</text>' +
        '<line class="ink" x1="-54" y1="-3" x2="54" y2="-3" stroke-width="1"/>' +
        '<text y="10" font-size="8.5" letter-spacing="1.2">' + (c.home ? 'RE-ENTRY' : 'ENTRY') + ' · ' + date + '</text>' +
        '<text y="23" font-size="9.5" letter-spacing="1.5">' + c.code + '  ✈  ADMITTED</text>';
    } else if (variant === 1) {
      body = '<ellipse class="ink" rx="82" ry="42" stroke-width="3"/>' +
        '<ellipse class="ink" rx="75" ry="35" stroke-width="1"/>' +
        '<text y="-12" font-size="' + (name.length > 11 ? 11 : 13) + '" letter-spacing="2">' + name + '</text>' +
        '<text y="3" font-size="8" letter-spacing="1.2">' + (c.home ? 'RE-ENTRY' : 'ENTRY') + '</text>' +
        '<text y="15" font-size="9" letter-spacing="1">' + date + '</text>' +
        '<text y="27" font-size="9" letter-spacing="2">' + c.code + '</text>';
    } else {
      body = '<circle class="ink" r="46" stroke-width="3"/>' +
        '<circle class="ink" r="40" stroke-width="1"/>' +
        '<circle class="ink" r="27" stroke-width="1"/>' +
        '<text font-size="7.2" letter-spacing="1.8"><textPath href="#ringpath" startOffset="2%">' + (c.home ? 'RE-ENTRY' : 'ENTRY') + ' · ' + name + ' · ' + (c.home ? 'RE-ENTRY' : 'ENTRY') + ' · ' + name + ' ·</textPath></text>' +
        '<text y="-5" font-size="16" letter-spacing="2">' + c.code + '</text>' +
        '<text y="8" font-size="7.5" letter-spacing="1">' + date + '</text>' +
        '<text y="18" font-size="7" letter-spacing="1.5">ADMITTED</text>';
    }
    return '<g class="stamp" style="color:' + ink + '" data-id="' + c.id + '"><g transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + rot.toFixed(1) + ')"><g class="slam" opacity="0.86" filter="url(#' + filter + ')">' + body + '</g></g></g>';
  }
  function refreshCount() {
    var uniq = {}; stamps.forEach(function (id) { uniq[id] = 1; });
    $('stamp-count').textContent = Object.keys(uniq).length;
    $('empty').classList.toggle('hide', stamps.length > 0);
  }
  function addStamp(c, silent) {
    if (!c || !stampLayer) return;
    if (stamps.length >= 16) { var first = stampLayer.firstElementChild; if (first) first.remove(); stamps.shift(); }
    var k = stamps.length;
    stamps.push(c.id);
    stampLayer.insertAdjacentHTML('beforeend', stampMarkup(c, k));
    refreshCount();
    if (!silent) { save(); flashCountry(c.id); }
  }
  function clearStamps() { stamps = []; if (stampLayer) stampLayer.innerHTML = ''; refreshCount(); save(); }
  function stampAll() {
    var pending = VISITED.filter(function (c) { return stamps.indexOf(c.id) < 0; });
    if (!pending.length) pending = VISITED.slice();
    pending.forEach(function (c, i) {
      if (REDUCED || THUMB) addStamp(c, false);
      else setTimeout(function () { addStamp(c, false); }, i * 170);
    });
  }
  function save() { if (THUMB) return; try { localStorage.setItem(STORE_KEY, JSON.stringify(stamps)); } catch (e) { /* ignore */ } }
  function restore() {
    if (THUMB) { ['840', '380', '392', '704', '484'].forEach(function (id) { if (byId[id]) addStamp(byId[id], true); }); return; }
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      if (Array.isArray(raw)) raw.slice(0, 16).forEach(function (id) { if (byId[id]) addStamp(byId[id], true); });
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------- map
  var map = null;      // the live map state once d3 and the data are in
  function flashCountry(id) {
    if (!map) return;
    var el = map.countryEl[id];
    if (!el) return;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 380);
    var c = byId[id];
    var p = map.projection([c.lon, c.lat]);
    if (p && map.visible([c.lon, c.lat]) && !REDUCED) {
      var ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', p[0]); ring.setAttribute('cy', p[1]); ring.setAttribute('r', '3');
      ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#fff6df'); ring.setAttribute('stroke-width', '2'); ring.setAttribute('pointer-events', 'none');
      ring.innerHTML = '<animate attributeName="r" from="3" to="40" dur="0.7s" fill="freeze"/><animate attributeName="opacity" from="1" to="0" dur="0.7s" fill="freeze"/>';
      map.svg.node().appendChild(ring);
      setTimeout(function () { ring.remove(); }, 800);
    }
  }

  function showMapMessage(html) { var m = $('mapmsg'); m.innerHTML = html; m.classList.add('show'); }

  function buildMap(topo) {
    var d3 = window.d3, topojson = window.topojson;
    var countries = topojson.feature(topo, topo.objects.countries).features;
    var land = topojson.feature(topo, topo.objects.land);
    var graticule = d3.geoGraticule10();
    var sphere = { type: 'Sphere' };
    var wrap = $('mapwrap');
    var tip = $('tip');

    // ---- geometry-derived stats
    var landArea = d3.geoArea(land), visitedArea = 0;
    var centroids = {};
    countries.forEach(function (f) {
      if (byId[f.id]) { visitedArea += d3.geoArea(f); centroids[f.id] = d3.geoCentroid(f); }
    });
    $('st-land').innerHTML = pct(visitedArea / landArea) + '<small>%</small>';
    $('st-land-s').textContent = fmtInt(visitedArea * EARTH_KM * EARTH_KM / 1e6) + ' million km² of ' + fmtInt(landArea * EARTH_KM * EARTH_KM / 1e6) + ' million, spherical area of the 110m polygons';
    renderFurthest(VISITED.map(function (c) {
      var p = centroids[c.id] || [c.lon, c.lat];
      return { name: c.name, p: p, how: 'centroid to centroid', dist: function (o) { return d3.geoDistance(p, o.p) * EARTH_KM; } };
    }));
    var threadKm = VISITED.filter(function (c) { return !c.home; }).reduce(function (s, c) { return s + d3.geoDistance([HOME.lon, HOME.lat], [c.lon, c.lat]) * EARTH_KM; }, 0);

    // ---- svg scaffolding
    var svg = d3.select(wrap).insert('svg', ':first-child').attr('role', 'img').attr('aria-label', 'World map with visited countries lit');
    var defs = svg.append('defs');
    var grad = defs.append('radialGradient').attr('id', 'seaGrad').attr('cx', '38%').attr('cy', '32%').attr('r', '72%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#223c7e');
    grad.append('stop').attr('offset', '60%').attr('stop-color', '#12224f');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#0a1535');
    defs.append('filter').attr('id', 'haloBlur').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%').append('feGaussianBlur').attr('stdDeviation', 9);
    defs.append('filter').attr('id', 'nightBlur').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%').append('feGaussianBlur').attr('stdDeviation', 7);
    defs.append('filter').attr('id', 'glow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%').append('feGaussianBlur').attr('stdDeviation', 2);
    var clipPath = defs.append('clipPath').attr('id', 'sphereClip').append('path');

    var halo = svg.append('path').attr('class', 'halo').datum(sphere);
    var sea = svg.append('path').attr('class', 'sphere').datum(sphere);
    var grat = svg.append('path').attr('class', 'graticule').datum(graticule);
    var gCountries = svg.append('g');
    var countryEl = {};
    var paths = gCountries.selectAll('path').data(countries).enter().append('path')
      .attr('class', function (f) { var c = byId[f.id]; return 'country' + (c ? ' visited' : '') + (c && c.home ? ' home' : ''); })
      .attr('data-id', function (f) { return f.id; })
      .each(function (f) { if (byId[f.id]) countryEl[f.id] = this; });
    var gNight = svg.append('g').attr('clip-path', 'url(#sphereClip)');
    var night = gNight.append('path').attr('class', 'night').attr('filter', 'url(#nightBlur)');
    var gThreads = svg.append('g').style('display', 'none');
    var threadData = VISITED.filter(function (c) { return !c.home; }).map(function (c) {
      return { c: c, geo: { type: 'LineString', coordinates: [[HOME.lon, HOME.lat], [c.lon, c.lat]] } };
    });
    var threadShadows = gThreads.selectAll('path.thread-shadow').data(threadData).enter().append('path').attr('class', 'thread-shadow');
    var threads = gThreads.selectAll('path.thread').data(threadData).enter().append('path').attr('class', 'thread')
      .style('animation-delay', function (d, i) { return (-i * 0.37) + 's'; });
    var pinShadows = gThreads.selectAll('circle.pin-shadow').data(threadData).enter().append('circle').attr('class', 'pin-shadow').attr('r', 3.2);
    var pins = gThreads.selectAll('circle.pin').data(threadData).enter().append('circle').attr('class', 'pin').attr('r', 2.8);
    var homePin = svg.append('circle').attr('class', 'pin home').attr('r', 3.4);
    var outline = svg.append('path').datum(sphere).attr('fill', 'none').attr('stroke', 'rgba(236,231,217,0.3)').attr('stroke-width', 0.8).attr('pointer-events', 'none');

    // ---- projections
    var mode0 = 'globe';
    var rot = THUMB ? [40, -30, 0] : [62, -28, 0];
    if (params.get('view') === 'flat') mode0 = 'flat';
    var mode = mode0;
    var GW = 640, GH = 640, FW = 800, FH = 410;
    var globe = d3.geoOrthographic().scale(302).translate([GW / 2, GH / 2]).clipAngle(90).precision(0.5);
    var flat = d3.geoEqualEarth().precision(0.5).fitExtent([[8, 8], [FW - 8, FH - 8]], sphere);
    var projection = globe;
    var path = d3.geoPath(projection);
    var sunNow = sunPosition(THUMB ? new Date('2026-10-02T15:40:00Z') : new Date());
    var nightGeo = d3.geoCircle().center([sunNow.lon + 180, -sunNow.lat]).radius(90)();
    var showNight = params.get('night') !== '0', showThreads = THUMB || params.get('threads') === '1';

    function visible(p) {
      if (mode !== 'globe') return true;
      return d3.geoDistance(p, [-rot[0], -rot[1]]) < Math.PI / 2 - 0.02;
    }
    function applyMode() {
      if (mode === 'globe') {
        projection = globe; svg.attr('viewBox', '0 0 ' + GW + ' ' + GH).classed('flat', false);
        halo.style('display', null);
      } else {
        projection = flat; svg.attr('viewBox', '0 0 ' + FW + ' ' + FH).classed('flat', true);
        halo.style('display', 'none');
      }
      path = d3.geoPath(projection);
      $('btn-globe').classList.toggle('on', mode === 'globe');
      $('btn-flat').classList.toggle('on', mode !== 'globe');
      redraw();
    }
    var frame = 0;
    function redraw() {
      if (mode === 'globe') projection.rotate(rot); else projection.rotate([rot[0], 0, 0]);
      sea.attr('d', path); halo.attr('d', path); outline.attr('d', path); clipPath.attr('d', path(sphere));
      grat.attr('d', path);
      paths.attr('d', path);
      night.attr('d', showNight ? path(nightGeo) : null);
      if (showThreads) {
        threads.attr('d', function (d) { return path(d.geo); });
        threadShadows.attr('d', function (d) { return path(d.geo); });
        pins.each(function (d) {
          var vis = visible([d.c.lon, d.c.lat]), p = vis ? projection([d.c.lon, d.c.lat]) : null;
          d3.select(this).style('display', p ? null : 'none').attr('cx', p && p[0]).attr('cy', p && p[1]);
        });
        pinShadows.each(function (d) {
          var vis = visible([d.c.lon, d.c.lat]), p = vis ? projection([d.c.lon, d.c.lat]) : null;
          d3.select(this).style('display', p ? null : 'none').attr('cx', p && (p[0] + 1.2)).attr('cy', p && (p[1] + 1.6));
        });
      }
      var hp = visible([HOME.lon, HOME.lat]) ? projection([HOME.lon, HOME.lat]) : null;
      homePin.style('display', hp ? null : 'none').attr('cx', hp && hp[0]).attr('cy', hp && hp[1]);
      if ((frame++ & 7) === 0) updateStatus();
    }
    function updateStatus() {
      var st = $('status');
      if (showThreads) st.textContent = fmtInt(Math.round(threadKm / 100) * 100) + ' km of string';
      else if (mode === 'globe') st.textContent = 'centred ' + fmtLat(-rot[1]) + ' ' + fmtLon(((-rot[0]) % 360 + 540) % 360 - 180);
      else st.textContent = 'Equal Earth';
    }

    // ---- interaction: drag with inertia, auto-rotate when idle, pause on hover
    var dragging = false, hovering = false, lastInput = performance.now(), vel = [0, 0], last = null, downAt = null, moved = 0;
    var sens = 75 / globe.scale();
    svg.call(d3.drag()
      .on('start', function (ev) {
        dragging = true; svg.classed('dragging', true); last = [ev.x, ev.y, performance.now()]; vel = [0, 0]; moved = 0; lastInput = performance.now();
      })
      .on('drag', function (ev) {
        var now = performance.now();
        var cssScale = (svg.node().clientWidth || GW) / (mode === 'globe' ? GW : FW);
        var k = (mode === 'globe' ? sens : 360 / FW) / cssScale;
        var dx = ev.x - last[0], dy = ev.y - last[1];
        moved += Math.abs(dx) + Math.abs(dy);
        rot[0] += dx * k;
        if (mode === 'globe') rot[1] = Math.max(-90, Math.min(90, rot[1] - dy * k));
        var dt = Math.max(1, now - last[2]);
        vel = [dx * k / dt * 16, (mode === 'globe' ? -dy * k / dt * 16 : 0)];
        last = [ev.x, ev.y, now]; lastInput = now;
        redraw();
      })
      .on('end', function () {
        dragging = false; svg.classed('dragging', false); lastInput = performance.now();
        if (performance.now() - last[2] > 80) vel = [0, 0];
      }));
    svg.on('pointerenter', function () { hovering = true; }).on('pointerleave', function () { hovering = false; hideTip(); });
    svg.on('pointerdown', function (ev) { downAt = [ev.clientX, ev.clientY]; });

    // tooltip + stamping
    function hideTip() { tip.classList.remove('show'); }
    paths.on('pointermove', function (ev, f) {
      var c = byId[f.id];
      var name = c ? c.name : (f.properties && f.properties.name) || 'unknown';
      tip.innerHTML = '<b>' + name + '</b><span class="k' + (c ? (c.home ? ' home' : '') : ' no') + '">' + (c ? (c.home ? 'home' : 'visited') : 'not yet') + '</span>';
      var r = wrap.getBoundingClientRect();
      tip.style.left = (ev.clientX - r.left) + 'px'; tip.style.top = (ev.clientY - r.top) + 'px';
      tip.classList.add('show');
      lastInput = performance.now();
    }).on('pointerleave', hideTip)
      .on('click', function (ev, f) {
        if (downAt && (Math.abs(ev.clientX - downAt[0]) + Math.abs(ev.clientY - downAt[1])) > 6) return;
        var c = byId[f.id];
        if (c) addStamp(c, false);
        else {
          var r = wrap.getBoundingClientRect();
          tip.innerHTML = '<b>' + ((f.properties && f.properties.name) || 'unknown') + '</b><span class="k no">not yet</span>';
          tip.style.left = (ev.clientX - r.left) + 'px'; tip.style.top = (ev.clientY - r.top) + 'px';
          tip.classList.add('show'); setTimeout(hideTip, 1400);
        }
      });

    // animation loop
    var AUTO = 0.0032; // degrees per ms, roughly one turn every two minutes
    var timer = d3.timer(function () {
      var now = performance.now();
      var changed = false;
      if (!dragging && (Math.abs(vel[0]) > 0.01 || Math.abs(vel[1]) > 0.01)) {
        rot[0] += vel[0]; rot[1] = Math.max(-90, Math.min(90, rot[1] + vel[1]));
        vel[0] *= 0.94; vel[1] *= 0.94; changed = true; lastInput = now;
      } else if (!dragging && !hovering && !REDUCED && !THUMB && mode === 'globe' && now - lastInput > 2500 && document.visibilityState === 'visible') {
        rot[0] += AUTO * 16; changed = true;
      }
      if (changed) redraw();
    });

    // keyboard
    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var k = ev.key.toLowerCase();
      if (k === 'g') setMode('globe'); else if (k === 'f') setMode('flat');
      else if (k === 't') toggleThreads(); else if (k === 'n') toggleNight();
      else if (k === 's') stampAll(); else if (k === 'c') clearStamps();
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault(); lastInput = performance.now();
        if (ev.key === 'ArrowLeft') rot[0] -= 6; if (ev.key === 'ArrowRight') rot[0] += 6;
        if (mode === 'globe') { if (ev.key === 'ArrowUp') rot[1] = Math.min(90, rot[1] + 6); if (ev.key === 'ArrowDown') rot[1] = Math.max(-90, rot[1] - 6); }
        redraw();
      } else return;
    });
    function setMode(m) { if (m === mode) return; mode = m; lastInput = performance.now(); applyMode(); }
    function toggleThreads() { showThreads = !showThreads; gThreads.style('display', showThreads ? null : 'none'); $('btn-threads').classList.toggle('on', showThreads); redraw(); updateStatus(); }
    function toggleNight() { showNight = !showNight; $('btn-night').classList.toggle('on', showNight); redraw(); }
    $('btn-globe').addEventListener('click', function () { setMode('globe'); });
    $('btn-flat').addEventListener('click', function () { setMode('flat'); });
    $('btn-threads').addEventListener('click', toggleThreads);
    $('btn-night').addEventListener('click', toggleNight);
    if (showThreads) { gThreads.style('display', null); $('btn-threads').classList.add('on'); }

    // refresh the terminator every minute
    setInterval(function () {
      if (THUMB) return;
      sunNow = sunPosition(new Date());
      nightGeo = d3.geoCircle().center([sunNow.lon + 180, -sunNow.lat]).radius(90)();
      if (showNight) redraw();
    }, 60000);

    applyMode();
    if (!showNight) $('btn-night').classList.remove('on');
    updateStatus();
    map = { svg: svg, countryEl: countryEl, projection: function (p) { return projection(p); }, visible: visible, stop: function () { timer.stop(); } };
  }

  // ---------------------------------------------------------------------------- boot
  function boot() {
    renderStaticStats();
    if (THUMB) document.body.classList.add('settled');
    initPassport();
    restore();
    refreshCount();
    renderSuns();
    setInterval(renderSuns, 30000);
    $('btn-all').addEventListener('click', stampAll);
    $('btn-clear').addEventListener('click', clearStamps);

    var fallbackFar = function () {
      renderFurthest(VISITED.map(function (c) { return { name: c.name, lat: c.lat, lon: c.lon, how: 'city to city', dist: function (o) { return haversine(c, o); } }; }));
      $('st-land').innerHTML = '—';
      $('st-land-s').textContent = 'needs the map geometry';
    };
    if (!window.d3 || !window.topojson) {
      showMapMessage('<div>The map library (d3 and topojson-client from jsDelivr) did not load, so there is no globe this time.<br>The passport, the stats and the sun row still work: try <b>stamp all</b>.</div>');
      fallbackFar();
      $('mapwrap').style.minHeight = '220px';
      return;
    }
    fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (topo) { buildMap(topo); })
      .catch(function (err) {
        showMapMessage('<div>Could not load the country outlines (' + String(err.message || err) + ').<br>The passport, the stats and the sun row still work.</div>');
        fallbackFar();
      });
    if (!THUMB) {
      document.addEventListener('keydown', function (ev) {
        if (window.d3 && window.topojson && map) return; // handled by the map's own listener
        var k = ev.key.toLowerCase();
        if (k === 's') stampAll(); else if (k === 'c') clearStamps();
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
