// node desk/test/test-checks.mjs
//
// Tests desk/checks.js, the pure part of the Desk's To-dos and Health views,
// against hand-made cases and against this repository's real files read from
// disk (blog/index.json and the posts it lists, misc/toys.json,
// assets/data/publications.json, index.html, the Paper Theatre's stories index).
// Prints PASS / FAIL lines; exit code 1 on any failure.
//
// It never opens a post that blog/index.json does not list: the list of files
// in blog/posts comes from `git ls-files` (read-only), so untracked private
// files are neither read nor counted.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const C = require(path.join(root, 'desk', 'checks.js'));

let passed = 0;
let failed = 0;
function ok(cond, name, detail) {
	if (cond) {
		passed++;
		console.log('PASS ' + name);
	} else {
		failed++;
		console.log('FAIL ' + name + (detail !== undefined ? '\n     ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
	}
}
function eq(a, b, name) {
	const x = JSON.stringify(a);
	const y = JSON.stringify(b);
	ok(x === y, name, x === y ? undefined : 'got ' + x + '\n     want ' + y);
}
const readText = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJSON = (p) => JSON.parse(readText(p));
const exists = (p) => fs.existsSync(path.join(root, decodeURIComponent(p.replace(/[?#].*$/, ''))));

// ---- UMD ----------------------------------------------------------------------
{
	const src = readText('desk/checks.js');
	ok(/'use strict'/.test(src) && !/\bimport\s|\bexport\s|=>|\blet\s|\bconst\s/.test(src), 'checks.js is old-style JavaScript (no modules, arrows, let or const)');
	const sandbox = {};
	new Function('globalThis', 'module', src)(sandbox, undefined);
	ok(sandbox.DeskChecks && typeof sandbox.DeskChecks.extractLinks === 'function', 'checks.js sets window.DeskChecks in a browser');
	ok(!/document\.|window\.|fetch\(|localStorage|Date\.now\(\)\s*[;,)]/.test(src.replace(/\/\/.*$/gm, '').replace(/Date\.now\(\)\)/, '')), 'checks.js touches no DOM, network or storage');
}

// ---- links in Markdown --------------------------------------------------------
{
	const md = [
		'---',
		'title: "A [link](https://front.matter/no)"',
		'date: 2026-01-01',
		'---',
		'',
		'See [the toy](misc/32-latentland-map/) and ![a figure](assets/img/x.png "Title").',
		'A [post](#/post/latentland), [another](https://nietztein.github.io/#/post/nope) and <https://example.org/a>.',
		'Bare https://example.com/path). and an email <mailto:x@example.org>.',
		'',
		'```js',
		'var s = "[not a link](misc/none/)";',
		'```',
		'',
		'Inline `[code](misc/code/)` stays out. \\[escaped](misc/escaped/)',
		'<!-- [hidden](misc/hidden/) -->',
		'<a href="assets/documents/x.pdf">pdf</a> <img src=\'assets/img/y.jpg\'>',
		'[ref]: https://nietztein.github.io/misc/ "ref"',
		'[^1]: a footnote, not a link',
		'[nested [brackets]](misc/nested/)',
		'[with parens](https://en.wikipedia.org/wiki/Foo_(bar))',
		'[spaced](<misc/a b/>)',
	].join('\n');
	const links = C.extractLinks(md);
	const urls = links.map((l) => l.url);
	eq(
		urls,
		[
			'misc/32-latentland-map/',
			'assets/img/x.png',
			'#/post/latentland',
			'https://nietztein.github.io/#/post/nope',
			'https://example.org/a',
			'https://example.com/path',
			'mailto:x@example.org',
			'assets/documents/x.pdf',
			'assets/img/y.jpg',
			'https://nietztein.github.io/misc/',
			'misc/nested/',
			'https://en.wikipedia.org/wiki/Foo_(bar)',
			'misc/a b/',
		],
		'extractLinks finds links, images, autolinks, bare URLs, HTML and references, and skips front matter, code, comments, escapes and footnotes'
	);
	eq(links.map((l) => l.kind), ['link', 'image', 'link', 'link', 'autolink', 'autolink', 'autolink', 'html', 'html', 'ref', 'link', 'link', 'link'], 'extractLinks says what kind each link is');
	eq(links[0].line, 6, 'extractLinks gives the line number in the whole file');
	eq(C.extractLinks(''), [], 'extractLinks of nothing is empty');
	eq(C.extractLinks('~~~\n[x](a/)\n~~~\n[y](b/)').map((l) => l.url), ['b/'], 'a tilde fence hides its links');
	eq(C.extractLinks('```\n[x](a/)\n').map((l) => l.url), [], 'an unclosed fence hides the rest');
	eq(C.extractLinks('[a](b/)\n\n[c] (d/)').map((l) => l.url), ['b/'], 'a space between ] and ( is not a link');
	const tricky = C.extractLinks('[x](javascript:alert(1)) <a href="data:text/html,hi">d</a>');
	eq(tricky.map((l) => C.classifyLink(l.url).type), ['other', 'other'], 'javascript: and data: links are classified "other"');
}

// ---- classifying a link -------------------------------------------------------
{
	const c = (u) => C.classifyLink(u);
	eq([c('https://example.org/x').type, c('https://example.org/x').host], ['external', 'example.org'], 'another host is external');
	eq([c('//example.org/x').type], ['external'], 'a scheme-relative link to another host is external');
	const r = c('https://nietztein.github.io/#/post/latentland');
	eq([r.type, r.route, r.arg, r.absolute], ['route', 'post', 'latentland', true], 'an absolute link to a post is a route');
	eq([c('#/misc').type, c('#/misc').route], ['route', 'misc'], 'a hash route is a route');
	eq([c('index.html#/publications').type, c('index.html#/publications').route], ['route', 'publications'], 'index.html#/route is a route');
	eq(c('#section').type, 'anchor', 'a plain #anchor is an anchor');
	const f = c('https://NietZteiN.github.io/misc/32-latentland-map/?x=1#top');
	eq([f.type, f.path, f.fetchPath, f.absolute], ['file', 'misc/32-latentland-map/', 'misc/32-latentland-map/?x=1', true], 'an absolute file link keeps its query for fetching, drops the hash, ignores host case');
	eq(c('./assets/../assets/img/a%20b.png').path, 'assets/img/a b.png', 'dots are resolved and the path decoded');
	eq(c('mailto:x@y.z').type, 'mail', 'mailto: is mail');
	eq(c('   ').type, 'empty', 'blank is empty');
	eq(C.routeProblem({ route: 'nope' }), 'the site has no page "#/nope"', 'an unknown route is a problem');
	eq(C.routeProblem({ route: 'post', arg: 'x' }, { slugs: ['y'] }), 'there is no post "x" in blog/index.json', 'an unknown post is a problem');
	eq(C.routeProblem({ route: 'post', arg: '' }), 'the link names no post', 'a post link without a slug is a problem');
	eq(C.routeProblem({ route: 'misc' }), '', 'a known route is fine');
}

// ---- safe paths ---------------------------------------------------------------
{
	eq(C.safeSitePath('misc/01-x/'), 'misc/01-x/', 'safeSitePath keeps a plain folder');
	eq(C.safeSitePath('/assets//img/./a.jpg?v=2#x'), 'assets/img/a.jpg?v=2', 'safeSitePath tidies slashes, dots and the hash');
	eq(['https://evil.example/x', '//evil.example/x', '../secret', 'a/../../b', 'a\\b', 'javascript:x', 'a\nb', '', null].map(C.safeSitePath), [null, null, null, null, null, null, null, null, null], 'safeSitePath refuses anything that could leave the site');
	eq(['ok.vn', '../x', 'a/b', '.', '', 'a?b'].map(C.safeFileName), ['ok.vn', null, null, null, null, null], 'safeFileName accepts only a bare file name');
}

// ---- the routes match the site's shell ----------------------------------------------
{
	const main = readText('assets/js/main.js');
	const m = /var ROUTES = \{([\s\S]*?)\};/.exec(main);
	const routes = m ? [...m[1].matchAll(/^\s*([a-z]+)\s*:/gm)].map((x) => x[1]) : [];
	eq(C.SITE_ROUTES.slice().sort(), routes.slice().sort(), 'SITE_ROUTES matches ROUTES in assets/js/main.js');
}

// ---- the real posts ---------------------------------------------------------------
const index = readJSON('blog/index.json');
const tracked = execFileSync('git', ['ls-files', 'blog/posts'], { cwd: root, encoding: 'utf8' })
	.split('\n')
	.filter(Boolean)
	.map((p) => p.replace(/^blog\/posts\//, ''));
{
	const t = C.postTargets(index);
	eq(t.problems, [], 'blog/index.json: every entry has a slug and a usable file name');
	ok(t.targets.length === index.length && t.targets.length > 0, 'blog/index.json: one target per post (' + t.targets.length + ')');
	const missing = t.targets.filter((x) => !exists(x.path));
	eq(missing.map((x) => x.path), [], 'blog/index.json: every post file exists on disk');
	const cmp = C.comparePostsIndex(index, tracked);
	eq([cmp.missingFromIndex, cmp.missingFiles, cmp.indexed, cmp.files], [[], [], index.length, tracked.length], 'the tracked files in blog/posts and blog/index.json agree (' + tracked.length + ' posts)');

	const cmp2 = C.comparePostsIndex(index.slice(1), tracked.concat(['2099-01-01-new.md', 'notes.txt']));
	eq([cmp2.missingFromIndex.sort(), cmp2.missingFiles], [[index[0].file, '2099-01-01-new.md'].sort(), []], 'comparePostsIndex finds files left out of the index (and ignores non-Markdown)');
	const cmp3 = C.comparePostsIndex(index, tracked.slice(1));
	eq(cmp3.missingFiles.length, 1, 'comparePostsIndex finds an index entry without its file');
	const dup = C.postTargets([{ slug: 'a', file: 'x.md' }, { slug: 'a', file: 'y.md' }, { slug: 'b', file: '../z.md' }, 'junk']);
	eq(dup.problems.length, 3, 'postTargets reports a repeated slug, a bad file name and a non-object');

	const slugs = index.map((p) => p.slug);
	let internal = 0;
	const report = [];
	for (const p of index) {
		const md = readText('blog/posts/' + p.file);
		const r = C.postLinks(p.file, md, { slugs });
		ok(r.total >= r.external + r.internal.length, 'postLinks counts add up for ' + p.file + ' (' + r.total + ' links, ' + r.external + ' external, ' + r.internal.length + ' internal)');
		for (const l of r.internal) {
			internal++;
			const target = l.type === 'file' ? (exists(l.path) || exists(l.path + 'index.html') ? 'exists' : 'MISSING on disk') : l.problem || 'route ok';
			report.push('     ' + p.file + ':' + l.line + '  ' + l.url + '  -> ' + target);
		}
	}
	ok(internal > 0, 'the real posts have internal links to check (' + internal + ')');
	console.log('     What the live check will find in the real posts today:');
	console.log(report.join('\n'));
}

// ---- the real toys -----------------------------------------------------------------
{
	const toys = readJSON('misc/toys.json');
	const t = C.toyTargets(toys);
	eq(t.problems, [], 'misc/toys.json: every toy has a usable href and thumbnail');
	ok(t.targets.length === toys.toys.length && t.targets.length > 40, 'misc/toys.json: one target per toy (' + t.targets.length + ')');
	const missingPages = t.targets.filter((x) => !(exists(x.page) && (!/\/$/.test(x.page) || exists(x.page + 'index.html'))));
	eq(missingPages.map((x) => x.page), [], 'misc/toys.json: every toy page exists on disk');
	eq(t.targets.filter((x) => !exists(x.thumb)).map((x) => x.thumb), [], 'misc/toys.json: every thumbnail exists on disk');
	const bad = C.toyTargets({ toys: [{ slug: 'x', href: 'https://evil.example/', thumbnail: '../../etc/passwd' }] });
	eq([bad.problems.length, bad.targets[0].page, bad.targets[0].thumb], [2, null, null], 'toyTargets refuses hrefs and thumbnails that leave the site');
	eq(C.toyTargets(null).problems.length, 1, 'toyTargets of a broken file is one problem');
}

// ---- the real stories ----------------------------------------------------------------
const stories = readJSON('misc/55-paper-theatre/stories/index.json');
{
	const t = C.storyTargets(stories);
	eq(t.problems, [], 'stories index: every story has a usable file name');
	eq(t.targets.filter((x) => !exists(x.path)).map((x) => x.path), [], 'stories index: every story file exists on disk (' + t.targets.length + ')');
	eq(C.storyTargets([{ id: 'x', file: '../../x' }]).problems.length, 1, 'storyTargets refuses a path in a file name');
}

// ---- publications --------------------------------------------------------------------
const pubs = readJSON('assets/data/publications.json');
{
	const html = readText('index.html');
	const r = C.comparePublications(pubs, html);
	ok(r.ok && r.jsonCount === r.htmlCount, 'publications.json and the Publications section agree (' + r.jsonCount + ' and ' + r.htmlCount + ')', r);
	const fewer = C.comparePublications(pubs.slice(1), html);
	eq([fewer.ok, fewer.what], [false, 'assets/data/publications.json lists ' + (pubs.length - 1) + ' entries, the Publications section of index.html shows ' + pubs.length], 'a missing entry is reported in plain words');
	eq(C.comparePublications(pubs, '<section id="other"></section>').what, 'index.html has no section with id "publicationsContent"', 'a missing section is reported');
	eq(C.countPublicationBlocks('<section id="publicationsContent"><div class="pub-block a">1</div><!-- <div class="pub-block"> --><p class=\'x pub-block\'>2</p></section><div class="pub-block">out</div>').count, 2, 'countPublicationBlocks counts inside the section only and skips comments');
	eq(C.comparePublications({}, html).what, 'assets/data/publications.json is not a list', 'a publications file that is not a list is reported');
}

// ---- roll-up ------------------------------------------------------------------------
{
	eq(C.stateOf([]), 'ok', 'no problems is ok');
	eq(C.stateOf([{ level: 'warn' }]), 'warn', 'a warning is warn');
	eq(C.stateOf([{ level: 'warn' }, {}]), 'fail', 'a problem without a level is a failure');
	eq(C.stateOf([], true), 'skip', 'a skipped check is skip');
	const roll = C.rollUp([
		{ state: 'ok', checked: 10, problems: [] },
		{ state: 'fail', checked: 5, problems: [{}, {}] },
		{ state: 'warn', checked: 1, problems: [{ level: 'warn' }] },
		{ state: 'skip', checked: 0 },
		{ state: 'weird', checked: 0, problems: [] },
	]);
	eq([roll.state, roll.total, roll.ok, roll.fail, roll.warn, roll.skip, roll.problems, roll.checked], ['fail', 5, 1, 2, 1, 1, 4, 16], 'rollUp: worst state wins, an unknown state counts as a failure');
	eq(C.summaryText(roll), '2 of 5 checks failing, 1 warning, 1 skipped', 'summaryText of failures');
	eq(C.summaryText(C.rollUp([{ state: 'ok' }, { state: 'ok' }, { state: 'skip' }])), 'All green, 1 skipped', 'summaryText of all green');
	eq(C.rollUp([{ state: 'ok' }, { state: 'skip' }]).state, 'ok', 'a skipped check does not spoil an all-green run');
	eq(C.summaryText(C.rollUp([])), 'No checks have run', 'summaryText of nothing');
	eq(C.summaryText(C.rollUp([{ state: 'skip' }])), 'Nothing could be checked', 'summaryText when everything was skipped');
	eq(C.homeLine({ text: 'All green' }, '2 hours ago'), 'All green 2 hours ago', 'homeLine');
}

// ---- deploys --------------------------------------------------------------------------
{
	const commits = C.commitList([
		{ sha: 'c'.repeat(40), commit: { message: 'Third\n\nbody', committer: { date: '2026-10-05T10:00:00Z' }, author: { name: 'A' } }, author: { login: 'NietZteiN' }, html_url: 'https://github.com/NietZteiN/nietztein.github.io/commit/ccc' },
		{ sha: 'b'.repeat(40), commit: { message: 'Second', committer: { date: '2026-10-04T10:00:00Z' } }, html_url: 'javascript:alert(1)' },
		{ sha: 'a'.repeat(40), commit: { message: 'First', committer: { date: '2026-10-03T10:00:00Z' } } },
		'junk',
	]);
	eq(commits.map((c) => [c.short, c.message, c.author]), [['ccccccc', 'Third', 'NietZteiN'], ['bbbbbbb', 'Second', ''], ['aaaaaaa', 'First', '']], 'commitList: short sha, first line, author');
	eq(commits[1].url, '', 'a non-github.com URL from the API is not made a link');
	eq(C.notYetLive(commits, 'b'.repeat(40)).pending.map((c) => c.short), ['ccccccc'], 'notYetLive: commits newer than the live one');
	eq(C.notYetLive(commits, 'c'.repeat(40)).pending, [], 'notYetLive: nothing pending when the newest is live');
	const far = C.notYetLive(commits, 'f'.repeat(40));
	eq([far.known, far.found, far.pending.length], [true, false, 3], 'notYetLive: a live commit older than the list');
	eq(C.notYetLive(commits, '').known, false, 'notYetLive: unknown without a live commit');
	const builds = C.buildList([{ status: 'building', commit: 'c'.repeat(40) }, { status: 'errored', commit: 'b'.repeat(40), error: { message: 'Page build failed.' } }, { status: 'built', commit: 'a'.repeat(40), duration: 31000 }]);
	eq(C.lastGoodBuild(builds).short, 'aaaaaaa', 'lastGoodBuild skips building and errored builds');
	eq([C.buildState(builds[0]).kind, C.buildState(builds[1]).kind, C.buildState(builds[2]).kind, C.buildState(null).kind], ['run', 'bad', 'ok', 'warn'], 'buildState');
	eq(builds[1].error, 'Page build failed.', 'buildList keeps the error message');
	eq(C.buildList({ status: 'built', commit: 'x' }).length, 1, 'buildList accepts the single "latest" build');
	const runs = { workflow_runs: [
		{ id: 3, path: '.github/workflows/build-blog.yml', name: 'Build blog', status: 'in_progress', conclusion: null, head_sha: 'c'.repeat(40) },
		{ id: 2, path: 'dynamic/pages/pages-build-deployment', name: 'pages build and deployment', status: 'completed', conclusion: 'success', head_sha: 'b'.repeat(40), updated_at: '2026-10-04T10:01:00Z' },
		{ id: 1, path: '.github/workflows/build-blog.yml', name: 'Build blog', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40) },
	] };
	const groups = C.groupRuns(runs);
	eq(groups.map((g) => [g.name, g.runs.map((r) => r.state.kind)]), [['Build blog', ['run', 'bad']], ['pages build and deployment', ['ok']]], 'groupRuns: one group per workflow, newest first, with states');
	eq(C.groupRuns(runs, 1)[0].runs.length, 1, 'groupRuns keeps at most N runs per workflow');
	eq(C.liveFromRuns(runs).sha, 'b'.repeat(40), 'liveFromRuns: the newest successful Pages deployment');
	eq(['cancelled', 'skipped', 'timed_out', 'success'].map((c) => C.runState({ status: 'completed', conclusion: c }).kind), ['warn', 'muted', 'bad', 'ok'], 'runState for each conclusion');
}

// ---- to-dos ----------------------------------------------------------------------------
{
	const T = C.todos;
	const now = '2026-10-05T12:00:00Z';
	let seq = 0;
	const makeId = () => 'id' + ++seq;
	const p = T.parse(JSON.stringify({ items: ['Plain string', { title: 'With fields', done: 'true', tags: '#Decisions, paper', due: '2026-10-12T00:00', url: 'https://example.org' }, { text: '' }, { id: 'same', text: 'a' }, { id: 'same', text: 'b' }] }), { now, makeId });
	eq(p.items.map((i) => [i.id, i.text, i.done, i.tags, i.due, i.link]), [['id1', 'Plain string', false, [], '', ''], ['id2', 'With fields', true, ['decisions', 'paper'], '2026-10-12', 'https://example.org'], ['same', 'a', false, [], '', ''], ['id3', 'b', false, [], '', '']], 'parse: strings, other field names, a repeated id renamed');
	eq(p.problems, ['Entry 3 has no text and was left out.'], 'parse: an entry without text is reported');
	eq(p.items[0].created, '2026-10-05T12:00:00Z', 'parse: a missing created date is now');
	ok(T.parse('{nope').invalid && /not valid JSON/.test(T.parse('{nope').problems[0]), 'parse: bad JSON says so');
	ok(T.parse('{"x":1}').invalid, 'parse: JSON without a list says so');
	eq(T.parse('').items, [], 'parse: an empty file is an empty list');
	eq(T.parse(String.fromCharCode(0xfeff) + '[]').invalid, undefined, 'parse: a byte-order mark is skipped');
	eq(T.parse([{ text: 'x', due: '2026-02-30' }], { now }).items[0].due, '', 'parse: an impossible due date is dropped');

	const text = T.serialize(p.items);
	const back = T.parse(text, { now: '2030-01-01T00:00:00Z' });
	eq(back.items, p.items, 'serialize then parse gives the same items');
	ok(/^\{\n\t"version": 1,\n\t"items": \[/.test(text) && text.endsWith('\n'), 'serialize writes tab-indented JSON with a version');

	eq(T.parseQuick('Email the editor #Decisions due:2026-10-12 https://x.org/a  #paper'), { text: 'Email the editor', tags: ['decisions', 'paper'], due: '2026-10-12', link: 'https://x.org/a' }, 'parseQuick reads tags, due date and link');
	eq(T.parseQuick('due:tomorrow is not a date').text, 'due:tomorrow is not a date', 'parseQuick leaves a bad due date in the text');
	eq(T.parseQuick('https://only.link/').text, 'https://only.link/', 'parseQuick: a lone link becomes the text');
	eq(T.parseQuick('C# is #1').tags, [], 'parseQuick: "C#" and "#1" are not tags');

	const items = T.parse([{ id: 'a', text: 'A', tags: ['x'] }, { id: 'b', text: 'B', tags: ['decisions'] }, { id: 'c', text: 'C', tags: ['x'], done: true }, { id: 'd', text: 'D' }], { now }).items;
	eq(T.tagCounts(items), [{ tag: 'decisions', open: 1, total: 1 }, { tag: 'x', open: 1, total: 2 }], 'tagCounts: decisions first, open and total');
	eq(T.filter(items, { tag: 'x' }).map((i) => i.id), ['a', 'c'], 'filter by tag');
	eq(T.filter(items, { done: false }).map((i) => i.id), ['a', 'b', 'd'], 'filter open');
	const ids = (l) => l.map((i) => i.id).join('');
	eq(ids(T.move(items, 'b', -1)), 'bacd', 'move up');
	eq(ids(T.move(items, 'b', 1)), 'acbd', 'move down');
	eq(ids(T.move(items, 'a', -1)), 'abcd', 'move up at the top does nothing');
	eq(ids(T.move(items, 'd', 'top')), 'dabc', 'move to top');
	eq(ids(T.move(items, 'a', 'bottom')), 'bcda', 'move to bottom');
	eq(ids(T.move(items, 'a', 1, ['a', 'c'])), 'bcad', 'move among the visible items jumps over hidden ones');
	eq(ids(T.move(items, 'c', -1, ['a', 'c'])), 'cabd', 'move up among the visible items');

	const imp = T.importItems(items, T.parse([{ id: 'a', text: 'other' }, { text: 'b' }, { text: 'E' }], { now, makeId }).items, 'merge');
	eq([ids(imp.items), imp.added, imp.skipped], ['abcd' + imp.items[4].id, 1, 2], 'import merge skips the same id and the same text');
	eq(T.importItems(items, items.slice(0, 1), 'replace').items.length, 1, 'import replace');

	const base = items;
	const mine = T.move(base.map((i) => (i.id === 'a' ? { ...i, done: true, updated: '2026-10-05T13:00:00Z' } : i)), 'd', 'top').filter((i) => i.id !== 'c');
	mine.push({ id: 'm', text: 'mine new', done: false, created: now, tags: [] });
	const theirs = base.map((i) => (i.id === 'b' ? { ...i, text: 'B edited', updated: '2026-10-05T14:00:00Z' } : i)).filter((i) => i.id !== 'd');
	theirs.splice(1, 0, { id: 't', text: 'theirs new', done: false, created: now, tags: [] });
	const merged = T.merge(base, mine, theirs);
	eq(merged.map((i) => i.id + (i.done ? '*' : '') + (i.text === 'B edited' ? '!' : '')).join(' '), 'a* t b! m', 'merge: both edits kept, both deletions kept, both new items placed');
	const both = T.merge([{ id: 'a', text: 'x', created: now }], [{ id: 'a', text: 'mine', created: now, updated: '2026-10-05T13:00:00Z' }], [{ id: 'a', text: 'theirs', created: now, updated: '2026-10-05T14:00:00Z' }]);
	eq(both[0].text, 'theirs', 'merge: the later of two edits wins');
	const editDel = T.merge([{ id: 'a', text: 'x', created: now }], [{ id: 'a', text: 'edited', created: now }], []);
	eq(editDel.map((i) => i.text), ['edited'], 'merge: an edit beats a deletion');
	eq(T.merge([], [{ id: 'a', text: 'x' }], [{ id: 'b', text: 'y' }]).map((i) => i.id), ['b', 'a'], 'merge without a base keeps both (the other side\'s first item stays first)');

	eq(['2026-10-01', '2026-10-05', '2026-10-10', '2026-11-30', '', 'x'].map((d) => T.dueState(d, '2026-10-05')), ['overdue', 'today', 'soon', 'later', '', ''], 'dueState');
	eq(['https://x.org/a', 'mailto:a@b.c', '#/write?draft=drafts%2Fa.md', 'javascript:alert(1)', 'http://x y', 'ftp://x', 'data:text/html,x', '//evil.example'].map((l) => (T.safeLink(l) ? T.safeLink(l).external : null)), [true, true, false, null, null, null, null, null], 'safeLink lets through only http(s), mailto and Desk routes');
	eq(T.cleanTags('#A b,  A  ,c[d]'), ['a', 'b', 'c-d'], 'cleanTags');
	ok(/^t[0-9a-z]+$/.test(T.makeId(Date.parse(now), () => 0.5)), 'makeId gives a short id');
}

// ---- drafts ---------------------------------------------------------------------------
{
	const D = C.drafts;
	eq(D.title('---\ntitle: "Hello"\n---\n# Other', 'drafts/x.md'), 'Hello', 'draft title from front matter');
	eq(D.title('Intro\n\n# Heading here #\n', 'drafts/x.md'), 'Heading here', 'draft title from the first heading');
	eq(D.title('just text', 'drafts/2026-10-01-my_draft-name.md'), 'my draft name', 'draft title from the file name');
	eq(D.wordCount('---\ntitle: x\n---\nOne two, three-four. don\u2019t'), 4, 'wordCount skips front matter');
	const s = D.summary([{ name: 'b', at: '2026-10-03T00:00:00Z' }, { name: 'a', at: '' }, { name: 'c', at: '2026-09-01T00:00:00Z' }]);
	eq([s.count, s.oldest.name, s.sorted.map((d) => d.name).join('')], [3, 'c', 'cba'], 'draft summary: oldest untouched first, unknown dates last');
	eq(D.summary([]).oldest, null, 'no drafts, no oldest');
}

// ---- the stories board on the real files ---------------------------------------------------
{
	const b = C.stories.board(pubs, index, stories);
	eq(b.papers.length, pubs.length, 'board: one row per publication');
	eq(b.posts.length, index.length, 'board: one row per published post');
	eq(b.papers.map((r) => r.title), pubs.map((p) => p.title), 'board: publication titles verbatim');
	eq(b.papers.map((r) => r.venue), pubs.map((p) => String(p.venue)), 'board: venues verbatim');
	eq(b.posts.map((r) => r.title), index.map((p) => p.title), 'board: post titles verbatim');
	for (const p of pubs.filter((x) => x.story)) {
		const row = b.papers.find((r) => r.title === p.title);
		eq(row.story && row.story.id, p.story, 'board: "' + p.title.slice(0, 40) + '..." gets the story its entry names');
	}
	for (const s of stories.filter((x) => x.kind === 'blog')) {
		const row = b.posts.find((r) => r.slug === s.slug);
		if (row) eq(row.story && row.story.id, s.id, 'board: post "' + s.slug + '" has its story');
	}
	const ids = b.papers.concat(b.posts).filter((r) => r.story).map((r) => r.story.id);
	eq(ids.length, new Set(ids).size, 'board: no story is used twice');
	eq(ids.length + b.orphans.length, stories.length, 'board: every story is either on a row or listed as without one');
	for (const r of b.papers.concat(b.posts)) {
		if (!r.story) continue;
		const s = stories.find((x) => x.id === r.story.id);
		if (s.status !== r.story.status || (s.verify === true) !== r.story.verify) {
			ok(false, 'board: status and verify flag copied for ' + s.id);
		}
	}
	ok(true, 'board: status and verify flag copied for every story');
	ok(b.papers.concat(b.posts).every((r) => !r.story || r.story.href === 'misc/55-paper-theatre/?story=' + encodeURIComponent(r.story.id)), 'board: links go to the story in the Paper Theatre');
	console.log('     Board today: ' + JSON.stringify(b.counts) + '; papers without a story: ' + JSON.stringify(b.papers.filter((r) => !r.story).map((r) => r.title)) + '; stories without a row: ' + JSON.stringify(b.orphans.map((o) => o.id)));
	const empty = C.stories.board(null, undefined, 'x');
	eq([empty.papers, empty.posts, empty.orphans], [[], [], []], 'board of broken files is empty, not an exception');
	const evil = C.stories.board([{ title: '<img src=x onerror=alert(1)>', venue: '<b>v</b>' }], [], []);
	eq(evil.papers[0].title, '<img src=x onerror=alert(1)>', 'board passes markup through as text (the view sets textContent)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
