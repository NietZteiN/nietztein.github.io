/*
 * Theatre Studio: the publish checklist, the facts table and the status board's join. Pure: no DOM, no fetch.
 * UMD: window.VNChecklist in the browser (after vn.js), module.exports in Node.
 *
 *   check(program, issues, opts)  -> { status, items: [Item], manual: [Reminder], counts: {pass, fail, skip}, ready }
 *        opts = { text, walk, publications }   all optional
 *        Item = { id, rule, label, state: 'pass'|'fail'|'skip', line, detail, lines: [n] }
 *   factUsage(program)            -> [{ key, value, ref, file, line, uses: [{index, line, kind}] }]  in declaration order
 *   unchipped(issues)             -> the numeric-literal and chart-literal issues: figures with no chip
 *   directiveLines(text)          -> { name: [line, ...] }  for every header-style "@name" line
 *   matchPublication(meta, pubs)  -> the publication whose title contains @source paper:<ref>, or null
 *   boardRows(pubs, posts, index) -> { pubs: [Row], posts: [Row], orphans: [Row] }
 *
 * The rules come from misc/55-paper-theatre/stories/README.md ("Accuracy rules", "Status lifecycle"). Each rule that a
 * program can be checked against is an item; the rest are reminders the author ticks by hand. Nothing here ever writes
 * a script: the panel shows these results and never changes @status or removes @verify.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory(require('../../55-paper-theatre/vn.js'));
	else root.VNChecklist = factory(root.VN);
})(typeof self !== 'undefined' ? self : this, function (VN) {
	'use strict';

	var BLOCKER_CODES = { 'numeric-literal': 1, 'chip-in-branch': 1, 'coauthor-unchipped': 1, 'cite-missing': 1, 'no-chips': 1 };
	// the site owner's name as it is written in @authors lines; he is never a "coauthor" of his own stories
	var OWNER_WORDS = { jack: 1, le: 1 };
	// words that would upgrade a venue string ("Submitted to FSE" must not become "Accepted at FSE")
	var UPGRADE = /\b(accepted|to appear|in press|published in|proceedings of|camera[- ]ready)\b/i;

	function blockers(issues) {
		if (VN && typeof VN.publishBlockers === 'function') return VN.publishBlockers(issues);
		return issues.filter(function (x) { return x.level === 'fatal' || BLOCKER_CODES[x.code]; });
	}

	function directiveLines(text) {
		var out = {};
		if (typeof text !== 'string') return out;
		var lines = text.replace(/\r\n?/g, '\n').split('\n');
		for (var i = 0; i < lines.length; i++) {
			var ln = lines[i].charCodeAt(0) === 0xFEFF ? lines[i].slice(1) : lines[i];
			var m = /^@([a-z]+)\b/.exec(ln);
			if (m) (out[m[1]] = out[m[1]] || []).push(i + 1);
		}
		return out;
	}

	function opChips(op) {
		var out = (op.chips || []).slice();
		if (op.kind === 'card') (op.cells || []).forEach(function (c) { out = out.concat(c.chips || []); });
		if (op.kind === 'chart') (op.series || []).forEach(function (s) { out = out.concat(s.chips || []); });
		return out;
	}

	function factUsage(program) {
		if (!program || !program.facts) return [];
		var uses = {};
		(program.ops || []).forEach(function (op, index) {
			var seen = {};
			opChips(op).forEach(function (c) {
				if (!c || !c.key || seen[c.key]) return;
				seen[c.key] = 1;
				(uses[c.key] = uses[c.key] || []).push({ index: index, line: op.line, kind: op.kind });
			});
		});
		return Object.keys(program.facts).map(function (k) {
			var f = program.facts[k];
			return { key: k, value: f.value, ref: f.ref || null, file: f.file || null, line: f.line || 0, uses: uses[k] || [] };
		});
	}

	function unchipped(issues) {
		return (issues || []).filter(function (i) { return i.code === 'numeric-literal' || i.code === 'chart-literal'; });
	}

	function norm(s) { return String(s == null ? '' : s).toLowerCase(); }

	function matchPublication(meta, pubs) {
		if (!meta || meta.sourceKind !== 'paper' || !meta.sourceRef || !Array.isArray(pubs)) return null;
		for (var i = 0; i < pubs.length; i++) if (pubs[i] && String(pubs[i].title || '').indexOf(meta.sourceRef) >= 0) return pubs[i];
		return null;
	}

	// the words of each name in @authors except the owner's (J. V. Le, Jack V. Le): "Anh", "Nguyen", "Coronado"
	function coauthorWords(authors) {
		var words = {};
		String(authors || '').replace(/[†*‡]/g, ' ').split(/,|\band\b|\(|\)/).forEach(function (name) {
			var w = name.trim().split(/\s+/).filter(Boolean);
			if (!w.length) return;
			var lw = w.map(norm);
			if (lw.indexOf('le') >= 0 && (lw.indexOf('jack') >= 0 || lw.indexOf('j.') >= 0)) return;    // the owner
			w.forEach(function (x) {
				x = x.replace(/[^A-Za-zÀ-ɏ'-]/g, '');
				if (x.length >= 3 && !OWNER_WORDS[norm(x)] && /^[A-ZÀ-Þ]/.test(x)) words[norm(x)] = 1;
			});
		});
		return words;
	}
	function authorCount(authors) {
		return String(authors || '').replace(/\(.*?\)/g, ' ').split(/,|\band\b/).filter(function (s) { return /[A-Za-z]{2,}/.test(s); }).length;
	}

	function item(id, rule, label, ok, line, detail, lines) {
		return { id: id, rule: rule, label: label, state: ok === null ? 'skip' : ok ? 'pass' : 'fail', line: line || 0, detail: detail || '', lines: lines || (line ? [line] : []) };
	}
	function issueItem(id, rule, label, list, okDetail) {
		var lines = list.map(function (i) { return i.line; });
		var first = list[0];
		return item(id, rule, label, list.length === 0, first ? first.line : 0,
			list.length ? (list.length === 1 ? first.msg : list.length + ' issues; first: ' + first.msg) : okDetail, lines);
	}

	/* ------------------------------------------------------------------ the checklist */

	function check(program, issues, opts) {
		opts = opts || {};
		issues = issues || [];
		var items = [];
		if (!program || !program.meta) {
			return { status: null, items: [item('program', 'file', 'The script parses', false, 0, 'no program yet')], manual: manual(null), counts: { pass: 0, fail: 1, skip: 0 }, ready: false };
		}
		var meta = program.meta, paper = meta.kind === 'paper';
		var dl = directiveLines(opts.text);
		function at(name) { return (dl[name] || [])[0] || 0; }
		var ops = program.ops || [];

		// lifecycle
		var status = meta.status || 'draft';
		items.push(item('status', 'Status lifecycle', '@status is published', status === 'published', at('status'),
			status === 'published' ? 'published' : '@status ' + status + (at('status') ? '' : ' (no @status line: draft is the default)') +
			(status === 'embargo' ? '; flip to draft once the figures are in @fact lines with chips' : status === 'draft' ? '; flip to published only after @verify is gone and the publication link is in index.html' : '')));
		var verifyLines = dl.verify || [];
		items.push(item('verify', 'Status lifecycle', '@verify removed (every figure checked against the source)', !meta.verify, verifyLines[0] || 0,
			meta.verify ? '@verify is still present; only the author removes it, after checking each figure' : 'no @verify', verifyLines));
		if (status === 'embargo') {
			var wh = ops.filter(function (o) { return o.kind === 'withheld'; });
			items.push(item('withheld', 'Status lifecycle', 'An embargoed story stops at @withheld', wh.length > 0, wh.length ? wh[0].line : at('status'),
				wh.length ? '@withheld at line ' + wh[0].line : 'embargo without @withheld: the result beat would play'));
		}
		var withheldOps = ops.filter(function (o) { return o.kind === 'withheld'; });
		if (status === 'published' && withheldOps.length) {
			items.push(item('withheld-published', 'Status lifecycle', 'A published story has no @withheld', false, withheldOps[0].line, 'still withholds the results'));
		}

		// the engine's own verdicts
		var fatals = issues.filter(function (i) { return i.level === 'fatal'; });
		items.push(issueItem('fatal', 'Lint', 'No fatal issues', fatals, 'none'));
		var bl = blockers(issues);
		items.push(issueItem('blockers', 'Lint', 'No publish blockers (VN.publishBlockers)', bl, 'none'));
		if (opts.walk) {
			var w = opts.walk;
			items.push(item('walk', 'Lint', 'Every path reaches an ending', !!w.ok, ((w.issues || [])[0] || {}).line || 0,
				w.ok ? w.paths + ' path' + (w.paths === 1 ? '' : 's') : ((w.issues || [])[0] || {}).msg || 'the walk did not finish'));
		}

		// header
		items.push(item('title', 'File shape', '@title present', !!meta.title, at('title'), meta.title ? meta.title : 'add @title'));
		items.push(item('kind', 'File shape', '@kind paper or blog', meta.kind === 'paper' || meta.kind === 'blog', at('kind'), meta.kind || 'add @kind paper or @kind blog'));
		var srcOk = paper ? meta.sourceKind === 'paper' && !!meta.sourceRef : meta.kind === 'blog' ? meta.sourceKind === 'blog' && !!meta.sourceRef : !!meta.source;
		items.push(item('source', 'Accuracy rule 7', paper ? '@source paper:<title words>' : '@source blog:<slug>', srcOk, at('source'),
			meta.source ? '@source ' + meta.source : 'add @source'));
		if (paper) {
			items.push(item('cite', 'Accuracy rule 7', '@cite present (paper)', !!meta.cite, at('cite'), meta.cite ? 'present' : 'add @cite with the venue string as index.html prints it'));
		}
		var pubs = Array.isArray(opts.publications) ? opts.publications : null;
		var pub = paper && pubs ? matchPublication(meta, pubs) : null;
		if (paper) {
			items.push(item('source-match', 'Accuracy rule 7', '@source names a publication on the site', pubs ? !!pub : null, at('source'),
				!pubs ? 'publication list not loaded' : pub ? pub.title : 'no title in assets/data/publications.json contains "' + (meta.sourceRef || '') + '"'));
			var up = meta.cite && UPGRADE.exec(meta.cite);
			var venueUp = !!(up && pub && !UPGRADE.test(String(pub.venue || '')));
			items.push(item('venue', 'Accuracy rule 7', 'The venue is not upgraded in @cite', meta.cite ? (pub ? !venueUp : (up ? null : true)) : null, at('cite'),
				!meta.cite ? 'no @cite' : venueUp ? '@cite says "' + up[0] + '" but the publication list says: ' + pub.venue : pub ? 'publication list: ' + pub.venue : up ? '@cite says "' + up[0] + '"; no publication to compare with' : 'no upgrade words'));
			if (pub) {
				var linked = !!pub.story;
				var want = status === 'published';
				items.push(item('pub-link', 'Status lifecycle', want ? 'index.html links the story (a.pub-play)' : 'index.html does not link a story that is not published', linked === want, at('status'),
					linked ? 'the publication links ?story=' + pub.story : 'no a.pub-play link on that publication'));
			}
		}

		// facts and chips (rule 1, 2, 3)
		var noRef = [];
		Object.keys(program.facts || {}).forEach(function (k) { var f = program.facts[k]; if (!f.ref) noRef.push({ line: f.file ? 0 : f.line, msg: "fact '" + k + "' has no ref" + (f.file ? ' (' + f.file + ':' + f.line + ')' : '') }); });
		ops.forEach(function (op) { opChips(op).forEach(function (c) { if (c && !c.ref) noRef.push({ line: op.line, msg: "chip {" + c.key + "} has no ref" }); }); });
		items.push(issueItem('chip-refs', 'Accuracy rule 1', 'Every fact and chip has a ref', noRef, Object.keys(program.facts || {}).length + ' facts, all with a ref'));
		items.push(issueItem('numeric', 'Accuracy rule 2', 'Every figure carries a chip', issues.filter(function (i) { return i.code === 'numeric-literal'; }), paper ? 'none unchipped' : 'none unchipped (the rule is for papers)'));
		items.push(issueItem('chart', 'Accuracy rule 1', 'Every chart value is a {fact} or chipped', issues.filter(function (i) { return i.code === 'chart-literal'; }), 'none'));
		items.push(issueItem('branch', 'Accuracy rule 3', 'No chipped figure inside a choice-dependent branch', issues.filter(function (i) { return i.code === 'chip-in-branch'; }), 'none'));
		if (paper) {
			var chipped = ops.filter(function (o) { return (o.refs && o.refs.length) || o.ref; }).length;
			items.push(item('chips', 'Accuracy rule 1', 'The story has citation chips', chipped > 0, 0, chipped + ' chipped stop' + (chipped === 1 ? '' : 's')));
		}

		// coauthors (rule 4)
		items.push(issueItem('coauthor-lines', 'Accuracy rule 4', 'Every coauthor line ends with ^§n or ^para', issues.filter(function (i) { return i.code === 'coauthor-unchipped'; }), 'none'));
		var cw = coauthorWords(meta.authors);
		var lookalike = [];
		Object.keys(program.cast || {}).forEach(function (k) {
			var c = program.cast[k];
			if (c.coauthor) return;
			var words = (String(c.id) + ' ' + String(c.name)).split(/[^A-Za-zÀ-ɏ'-]+/).map(norm);
			var hit = words.filter(function (x) { return cw[x]; })[0];
			if (hit) lookalike.push({ line: c.line || 0, msg: "cast '" + c.id + "' shares the name '" + hit + "' with an author in @authors but is not declared coauthor" });
		});
		items.push(issueItem('coauthor-cast', 'Accuracy rule 4', 'Coauthors are voiced only through @cast … coauthor', lookalike, 'no cast member is named after a coauthor'));

		// the end-card note (rule 8)
		var note = String(meta.note || '');
		var many = authorCount(meta.authors) > 1;
		var fiction = /dramati[sz]|fiction/i.test(note);
		var coNote = !paper || !many || /co-?authors?/i.test(note);
		items.push(item('note', 'Accuracy rule 8', 'The end-card note says the dialogue is dramatized' + (paper && many ? ' and coauthors did not say it' : ''), fiction && coNote, at('note'),
			!fiction ? 'the @note does not say the frame or dialogue is fiction or dramatized' : !coNote ? 'the @note does not mention the coauthors' : (at('note') ? 'own @note' : 'the default note')));

		var counts = { pass: 0, fail: 0, skip: 0 };
		items.forEach(function (i) { counts[i.state]++; });
		return { status: status, items: items, manual: manual(meta), counts: counts, ready: counts.fail === 0 };
	}

	// the rules a program cannot show; the author ticks them by hand
	function manual(meta) {
		var paper = !meta || meta.kind === 'paper';
		var out = [
			{ id: 'figures-checked', rule: 'Status lifecycle', label: 'Every figure was checked against the cited source (only then remove @verify)' },
			{ id: 'refs-right', rule: 'Accuracy rule 1', label: 'Each chip points at the right section, page or paragraph' },
			{ id: 'from-repo', rule: 'Accuracy rule 5', label: 'Drafted only from text in the repo or supplied by the owner; anything else stays embargo with @withheld' },
			{ id: 'nothing-invented', rule: 'Accuracy rule 6', label: 'No invented code, datasets, quotes or anecdotes; examples are the source’s own' },
			{ id: 'read-through', rule: 'Status lifecycle', label: 'Read through once in the browser and in test.js' }
		];
		if (paper) {
			out.splice(3, 0, { id: 'venue-verbatim', rule: 'Accuracy rule 7', label: 'The venue in @cite is copied from index.html, never upgraded' });
			out.push({ id: 'pub-play', rule: 'Status lifecycle', label: 'On publishing: the a.pub-play link is added inside the matching .pub-block of index.html' });
		}
		return out;
	}

	/* ------------------------------------------------------------------ the status board's join */

	// pubs: assets/data/publications.json; posts: blog/index.json (ToyKit.posts()); index: stories/index.json
	function boardRows(pubs, posts, index) {
		pubs = Array.isArray(pubs) ? pubs : [];
		posts = Array.isArray(posts) ? posts : [];
		index = Array.isArray(index) ? index : [];
		var used = {};
		function storyRow(s) {
			if (!s) return { story: null, status: null, verify: null, file: null, storyTitle: null };
			used[s.id] = 1;
			return { story: s.id, status: s.status || 'draft', verify: !!s.verify, file: s.file || null, storyTitle: s.title || null };
		}
		function merge(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }
		var pubRows = pubs.map(function (p) {
			var s = null;
			if (p.story) s = index.filter(function (x) { return x.id === p.story; })[0] || null;
			if (!s) s = index.filter(function (x) { return x.kind === 'paper' && x.pub && String(p.title || '').indexOf(x.pub) >= 0; })[0] || null;
			return merge({ type: 'paper', key: p.id, title: p.title, venue: p.venue || '', year: p.year, section: p.section || '', linked: p.story || null }, storyRow(s));
		});
		var postRows = posts.map(function (p) {
			var s = index.filter(function (x) { return x.kind === 'blog' && x.slug === p.slug; })[0] || null;
			return merge({ type: 'post', key: p.slug, title: p.title, venue: p.date || '', year: null, section: 'Blog', linked: null }, storyRow(s));
		});
		var orphans = index.filter(function (s) { return !used[s.id]; }).map(function (s) {
			return merge({ type: s.kind === 'blog' ? 'post' : 'paper', key: s.id, title: s.title, venue: s.source ? '@source ' + s.source : '', year: null, section: 'No row above', linked: null }, storyRow(s));
		});
		return { pubs: pubRows, posts: postRows, orphans: orphans };
	}

	return {
		check: check, manual: manual, factUsage: factUsage, unchipped: unchipped, directiveLines: directiveLines,
		matchPublication: matchPublication, coauthorWords: coauthorWords, boardRows: boardRows, blockers: blockers
	};
});
