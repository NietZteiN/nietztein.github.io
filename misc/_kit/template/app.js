/*
 * Template: one shelf of spines dealt from the library catalogue.
 *
 * This is the file to copy when starting a new toy (see ../README.md). It is
 * small on purpose and uses each part of the kit once; the lines marked KIT
 * are the ones every toy keeps, the drawing in between is the part to replace.
 * Two parts are left out because not every toy needs them, and both have
 * examples in the README: the blog (ToyKit.posts, ToyKit.post) and scripts
 * from a CDN (ToyKit.loadScript).
 */
(function () {
	'use strict';

	// KIT: the header (title, sub line, theme toggle, help button, back link),
	// the help dialog and the footer. The id names this toy's storage keys.
	ToyKit.init({
		id: 'template',
		title: 'Template',
		sub: 'One shelf from the library, dealt by a seeded shuffle.',
		back: 'misc',
		help: '#help-template',
		footer: '#how'
	});

	function $(sel) { return document.querySelector(sel); }
	var stage = $('#stage'), canvas = $('#canvas'), caption = $('#caption');
	var btnColour = $('#btn-colour'), seedNote = $('#seed-note');
	var ctx = canvas.getContext('2d');

	var PAD = 14, BOARD = 8, ROW = 170;
	var lib = null;            // the library, once loaded
	var spines = [];           // what is on the shelf: { b, x, w, h, row }
	var rows = 1;
	var selected = -1;
	var colors = {};
	var raf = 0;

	// KIT: one deterministic state under ?thumb=1 (a fixed seed, nothing read
	// from storage); otherwise ?seed=..., otherwise one shelf a day.
	var baseSeed = ToyKit.thumb ? 'thumb' : (ToyKit.params.get('seed') || ToyKit.daily());
	var shuffles = 0;
	function seed() { return baseSeed + (shuffles ? '#' + shuffles : ''); }

	// KIT: one remembered preference, kept as "toy.template.byColour".
	var byColour = !ToyKit.thumb && ToyKit.load('byColour', false) === true;

	// ---- Dealing the shelf -----------------------------------------------------

	// Spines side by side, row after row, until the stage is full.
	function pack(books, W, H) {
		var out = [], rowH = H / rows, x = PAD, row = 0;
		for (var i = 0; i < books.length; i++) {
			var b = books[i], h = ToyKit.hash(b.id);
			var w = 13 + (h % 16);
			if (x + w > W - PAD) {
				row++; x = PAD;
				if (row >= rows) break;
			}
			out.push({ b: b, x: x, w: w, row: row, h: (0.6 + ((h >>> 5) % 32) / 100) * (rowH - BOARD - 14) });
			x += w + 2;
		}
		return out;
	}

	function deal() {
		var W = stage.clientWidth, H = stage.clientHeight;
		rows = Math.max(1, Math.round(H / ROW));
		// KIT: a seeded generator. The same seed gives the same shuffle on every
		// machine; shuffle() returns a copy, so the shared library list is untouched.
		var pool = ToyKit.rng(seed()).shuffle(lib.books);
		spines = pack(pool, W, H);
		if (byColour) {
			var sorted = spines.map(function (s) { return s.b; }).sort(function (a, b) {
				return a.ch - b.ch || a.cl - b.cl || (a.id < b.id ? -1 : 1);
			});
			spines = pack(sorted, W, H);
		}
		if (selected >= spines.length) selected = -1;
		seedNote.textContent = 'seed ' + seed();
		describe();
	}

	// ---- Drawing ---------------------------------------------------------------

	// KIT: a canvas takes its colours from the theme tokens, read again whenever
	// the theme changes.
	function readColors() {
		colors = {
			surface: ToyKit.token('--surface'),
			board: ToyKit.token('--border-strong'),
			accent: ToyKit.token('--accent'),
			font: ToyKit.token('--font-body'),
			dark: ToyKit.theme() === 'dark'
		};
	}
	readColors();

	// t runs from 0 to 1 while the spines rise; 1 is the finished picture.
	function draw(t) {
		var W = stage.clientWidth, H = stage.clientHeight;
		var dpr = Math.min(2, window.devicePixelRatio || 1);
		var pw = Math.max(1, Math.round(W * dpr)), ph = Math.max(1, Math.round(H * dpr));
		if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = colors.surface;
		ctx.fillRect(0, 0, W, H);

		var rowH = H / rows, r, i;
		ctx.fillStyle = colors.board;
		for (r = 1; r <= rows; r++) ctx.fillRect(0, Math.round(r * rowH) - BOARD, W, BOARD);
		if (!lib) return;

		var lift = colors.dark ? 12 : 0;       // dark spines need a little light on a dark wall
		for (i = 0; i < spines.length; i++) {
			var s = spines[i];
			var grow = Math.max(0, Math.min(1, t * (1 + spines.length * 0.015) - i * 0.015));
			grow = 1 - Math.pow(1 - grow, 3);
			var h = s.h * grow;
			if (h < 1) continue;
			var base = Math.round((s.row + 1) * rowH) - BOARD;
			var y = base - h - (i === selected ? 6 : 0);
			ctx.fillStyle = lib.hsl(s.b, lift);
			ctx.fillRect(s.x, y, s.w, h);
			ctx.fillStyle = lib.hsl(s.b, lift + 12);
			ctx.fillRect(s.x, y, 2, h);
			if (s.w >= 15 && h > 30 && grow === 1) {
				ctx.save();
				ctx.beginPath();
				ctx.rect(s.x, y + 5, s.w, h - 10);
				ctx.clip();
				ctx.translate(s.x + s.w / 2 + 1, y + 8);
				ctx.rotate(Math.PI / 2);
				ctx.font = '500 10px ' + colors.font;
				ctx.textBaseline = 'middle';
				ctx.fillStyle = s.b.cl + lift > 46 ? 'rgba(0, 0, 0, 0.72)' : 'rgba(255, 255, 255, 0.84)';
				ctx.fillText(s.b.t, 0, 0);
				ctx.restore();
			}
			if (i === selected) {
				ctx.strokeStyle = colors.accent;
				ctx.lineWidth = 2;
				ctx.strokeRect(s.x - 1, y - 1, s.w + 2, h + 2);
			}
		}
	}

	// KIT: motion only when the reader has not asked for less. reducedMotion is
	// always true under ?thumb=1, so the thumbnail never depends on a frame.
	function rise() {
		cancelAnimationFrame(raf);
		if (ToyKit.reducedMotion) { draw(1); return; }
		var t0 = performance.now();
		(function frame(now) {
			var t = Math.min(1, (now - t0) / 650);
			draw(t);
			if (t < 1) raf = requestAnimationFrame(frame);
		})(t0);
	}
	// onMotion calls back now and whenever the setting changes; onTheme on changes.
	ToyKit.onMotion(function (reduced) {
		if (reduced) { cancelAnimationFrame(raf); draw(1); }
	});
	ToyKit.onTheme(function () { readColors(); cancelAnimationFrame(raf); draw(1); });

	// ---- Picking a spine -------------------------------------------------------

	// The caption is aria-live, so a screen reader hears each pick.
	function describe() {
		caption.textContent = '';
		if (selected < 0 || !spines[selected]) {
			caption.textContent = spines.length + ' spines from ' + lib.books.length + ' books. Tap one, or use the arrows.';
			return;
		}
		var b = spines[selected].b;
		var title = document.createElement('b');
		title.textContent = b.t;
		caption.appendChild(title);
		var author = lib.authorKey(b.a);
		caption.appendChild(document.createTextNode(
			(author ? ', ' + author : '') + (b.y != null ? ', ' + lib.yearText(b.y) : '') + '. ' + b.g + ', ' + lib.unitName(b.u) + '.'
		));
	}
	function select(i) {
		if (!lib || !spines.length) return;
		selected = (i + spines.length) % spines.length;
		describe();
		cancelAnimationFrame(raf);
		draw(1);
	}
	function spineAt(e) {
		var box = canvas.getBoundingClientRect();
		var x = e.clientX - box.left, y = e.clientY - box.top;
		var row = Math.floor(y / (box.height / rows));
		for (var i = 0; i < spines.length; i++) {
			var s = spines[i];
			if (s.row === row && x >= s.x - 1 && x <= s.x + s.w + 1) return i;
		}
		return -1;
	}
	// Pointer Events cover mouse, pen and touch with one listener.
	canvas.addEventListener('pointerdown', function (e) {
		var i = spineAt(e);
		if (i !== -1) select(i);
	});
	$('#btn-prev').addEventListener('click', function () { select(selected < 0 ? spines.length - 1 : selected - 1); });
	$('#btn-next').addEventListener('click', function () { select(selected + 1); });
	$('#pick').addEventListener('keydown', function (e) {
		if (e.key === 'ArrowLeft') { e.preventDefault(); select(selected < 0 ? spines.length - 1 : selected - 1); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); select(selected + 1); }
	});

	// ---- Buttons ---------------------------------------------------------------

	$('#btn-shuffle').addEventListener('click', function () {
		if (!lib) return;
		shuffles++;
		selected = -1;
		deal();
		rise();
	});

	function syncColour() { btnColour.setAttribute('aria-pressed', byColour ? 'true' : 'false'); }
	btnColour.addEventListener('click', function () {
		byColour = !byColour;
		ToyKit.store('byColour', byColour);
		syncColour();
		if (!lib) return;
		selected = -1;
		deal();
		draw(1);
	});
	syncColour();

	// KIT: sound. audio() hands out the page's one AudioContext; it is made by
	// this click, never before a gesture, and is null under ?thumb=1 and where
	// there is no Web Audio.
	$('#btn-play').addEventListener('click', function () {
		ToyKit.audio().then(function (ac) {
			if (!ac || !spines.length) { ToyKit.toast('There is nothing to play here.'); return; }
			var SCALE = [0, 2, 4, 7, 9];
			var n = Math.min(16, spines.length), t = ac.currentTime + 0.05;
			for (var i = 0; i < n; i++) {
				var step = Math.floor(spines[i].b.ch / 36);       // the hue as one of ten steps
				var osc = ac.createOscillator(), gain = ac.createGain();
				osc.type = 'triangle';
				osc.frequency.value = 220 * Math.pow(2, (SCALE[step % 5] + 12 * Math.floor(step / 5)) / 12);
				gain.gain.setValueAtTime(0.0001, t + i * 0.13);
				gain.gain.linearRampToValueAtTime(0.16, t + i * 0.13 + 0.012);
				gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.13 + 0.24);
				osc.connect(gain);
				gain.connect(ac.destination);
				osc.start(t + i * 0.13);
				osc.stop(t + i * 0.13 + 0.26);
			}
			ToyKit.toast('Playing ' + n + ' spines, one note per hue.');
		});
	});

	// KIT: a file for the reader to keep, and a toast to say so.
	$('#btn-save').addEventListener('click', function () {
		canvas.toBlob(function (blob) {
			if (!blob) { ToyKit.toast('The picture could not be saved.'); return; }
			ToyKit.download('shelf-' + seed().replace(/[^A-Za-z0-9-]+/g, '-') + '.png', blob);
			ToyKit.toast('Saved the shelf as a PNG.');
		}, 'image/png');
	});

	// ---- Start -----------------------------------------------------------------

	function redeal() {
		if (lib) deal();
		cancelAnimationFrame(raf);
		draw(1);
	}
	if (window.ResizeObserver) new ResizeObserver(redeal).observe(stage);
	else window.addEventListener('resize', redeal);

	draw(1);                                   // empty shelves while the catalogue loads

	// KIT: the library. One fetch for the page; the records come with their
	// spine colours (ch, cs, cl) and the bookshelf's tables and helpers.
	ToyKit.library().then(function (library) {
		lib = library;
		deal();
		draw(1);                               // drawn in this task: no waiting for a frame
		ToyKit.ready();                        // KIT: the first real frame is on screen
	}).catch(function (err) {
		// KIT: say what failed in plain words, and still get ready.
		ToyKit.fail(err);
		caption.textContent = 'The shelf is empty because the catalogue did not load.';
		ToyKit.ready();
	});
})();
