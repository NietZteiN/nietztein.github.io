// node desk/test/test-stats.mjs
//
// The arithmetic of the Desk's Stats view (desk/statsmath.js): days at a fixed
// offset, the API's day-and-hour lists, change against the period before,
// paths joined to titles, the public counters, the chart's layout, comments
// flattened from GitHub Discussions and "since you last looked".
// Prints one PASS / FAIL line per check; exit code 1 on any failure.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const S = require('../statsmath.js');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
	if (ok) {
		passed++;
		console.log('PASS ' + name);
	} else {
		failed++;
		console.log('FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
	}
}
function same(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}
function eq(name, got, want) {
	check(name, same(got, want), { got, want });
}

const H = S.HOUR;
const D = S.DAY;
const T = (iso) => Date.parse(iso);
const hours = (pairs) => {
	const a = new Array(24).fill(0);
	for (const [h, n] of pairs) a[h] = n;
	return a;
};

// ---- the module itself -----------------------------------------------------------

{
	const src = fs.readFileSync(path.join(root, 'desk/statsmath.js'), 'utf8');
	check('module: UMD, no Date.now or new Date() without an argument', !/Date\.now\(|new Date\(\)/.test(src.replace(/^\s*\/\/.*$/gm, '')) && /module\.exports = factory\(\)/.test(src) && /root\.DeskStatsMath = factory\(\)/.test(src));
	check('module: no DOM', !/document\.|window\./.test(src.replace(/^\s*\/\/.*$/gm, '')));
	check('module: old-style (no let/const/=>/class)', !/\b(let|const|class)\s|=>/.test(src.replace(/^\s*\/\/.*$/gm, '')));
	// ROUTE_TITLES must equal TITLES in assets/js/main.js
	const main = fs.readFileSync(path.join(root, 'assets/js/main.js'), 'utf8');
	const block = /var TITLES = \{([\s\S]*?)\};/.exec(main);
	const titles = {};
	if (block) for (const m of block[1].matchAll(/(\w+):\s*'([^']*)'/g)) titles[m[1]] = m[2];
	check('routes: TITLES found in main.js', !!block && Object.keys(titles).length > 5);
	eq('routes: ROUTE_TITLES matches main.js TITLES', S.ROUTE_TITLES, titles);
	check('routes: main.js still reports "/" + route + "/" + rest', /trackPageView\('\/' \+ r\.route \+ \(r\.rest \? '\/' \+ r\.rest : ''\)\)/.test(main));
	const blog = fs.readFileSync(path.join(root, 'assets/js/blog.js'), 'utf8');
	check('counter: blog.js still reads /counter/<encodeURIComponent("/post/" + slug)>.json', /var path = '\/post\/' \+ slug;/.test(blog) && /\.goatcounter\.com\/counter\/' \+\s*encodeURIComponent\(path\) \+\s*'\.json'/.test(blog));
	check('comments: blog.js giscus still maps a post by its slug', /'data-mapping': 'specific'/.test(blog) && /'data-term': slug/.test(blog));
}

// ---- small helpers ----------------------------------------------------------------

eq('int: junk is 0', [S.int('x'), S.int(-3), S.int(NaN), S.int(null), S.int('7'), S.int(2.9)], [0, 0, 0, 0, 7, 2]);
eq('fmt: thousands', [S.fmt(0), S.fmt(999), S.fmt(1000), S.fmt(1234567), S.fmt(-4321)], ['0', '999', '1,000', '1,234,567', '-4,321']);
check('parseDay: valid', S.parseDay('2026-10-05') === Date.UTC(2026, 9, 5));
check('parseDay: invalid dates are NaN', [S.parseDay('2026-02-30'), S.parseDay('2026-13-01'), S.parseDay('x'), S.parseDay(null)].every(isNaN));
eq('dayKey: UTC', S.dayKey(T('2026-10-05T03:00:00Z'), 0), '2026-10-05');
eq('dayKey: UTC-5 puts 03:00Z on the day before', S.dayKey(T('2026-10-05T03:00:00Z'), -300), '2026-10-04');
eq('dayKey: UTC+5:30 puts 20:00Z on the next day', S.dayKey(T('2026-10-05T20:00:00Z'), 330), '2026-10-06');
eq('dayStart: UTC-5', S.apiTime(S.dayStart('2026-10-05', -300)), '2026-10-05T05:00:00Z');
eq('addDays: across a month and a year', [S.addDays('2026-09-30', 1), S.addDays('2026-01-01', -1), S.addDays('2028-02-28', 1)], ['2026-10-01', '2025-12-31', '2028-02-29']);
eq('dayList: 3 days ending today, oldest first', S.dayList('2026-10-01', 3), ['2026-09-29', '2026-09-30', '2026-10-01']);
eq('offsetName', [S.offsetName(0), S.offsetName(-300), S.offsetName(330), S.offsetName(-570)], ['UTC', 'UTC-5', 'UTC+5:30', 'UTC-9:30']);
eq('longDay / shortDay', [S.longDay('2026-09-23'), S.longDay('2025-01-02', true), S.shortDay('2026-09-23')], ['September 23', 'January 2, 2025', 'Sep 23']);

// ---- range --------------------------------------------------------------------------

{
	// 2026-10-05 14:30 in Texas (UTC-5) is 19:30Z.
	const r = S.range(T('2026-10-05T19:30:00Z'), -300, 7);
	eq('range: today on his clock', r.today, '2026-10-05');
	eq('range: 7 keys ending today', r.keys, ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
	eq('range: the 7 days before', [r.prevKeys[0], r.prevKeys[6]], ['2026-09-22', '2026-09-28']);
	eq('range: start is midnight of the first day in UTC', r.start, '2026-09-29T05:00:00Z');
	eq('range: prevStart', r.prevStart, '2026-09-22T05:00:00Z');
	eq('range: end is the last whole hour of today', r.end, '2026-10-06T04:00:00Z');
	// late at night his time, already tomorrow in UTC
	const late = S.range(T('2026-10-06T03:30:00Z'), -300, 1);
	eq('range: 22:30 his time is still his today', late.today, '2026-10-05');
	// a half-hour zone: start rounds up into the day, end rounds down inside it
	const india = S.range(T('2026-10-05T06:00:00Z'), 330, 1);
	check('range: half-hour clock, every hour asked for is inside the day', S.dayKey(india.startMs, 330) === '2026-10-05' && S.dayKey(india.endMs, 330) === '2026-10-05' && india.startMs % H === 0 && india.endMs % H === 0, india);
	eq('range: 90 days has 90 keys', S.range(T('2026-10-05T19:30:00Z'), -300, 90).keys.length, 90);
}

// ---- the API's lists --------------------------------------------------------------

{
	const stats = [
		{ day: '2026-10-03', hourly: hours([[1, 2], [23, 1]]), daily: 3 },
		{ day: '2026-10-04', hourly: hours([]), daily: 0 },
		{ day: '2026-10-05', hourly: hours([[9, 4]]), daily: 999 }, // hourly wins
		{ day: '2026-10-05', daily: 1 }, // a second entry for the same day adds
		{ day: 'bad', daily: 50 },
		null,
	];
	eq('dayCount: hourly sum, else daily', [S.dayCount(stats[0]), S.dayCount({ daily: 6 }), S.dayCount(null)], [3, 6, 0]);
	eq('dailyMap', S.dailyMap(stats), { '2026-10-03': 3, '2026-10-04': 0, '2026-10-05': 5 });
	eq('series: missing days are 0, extra days dropped', S.series(stats, ['2026-10-02', '2026-10-03', '2026-10-05']), [
		{ day: '2026-10-02', count: 0 },
		{ day: '2026-10-03', count: 3 },
		{ day: '2026-10-05', count: 5 },
	]);
	eq('sum: numbers or rows', [S.sum([1, 2, 'x']), S.sum([{ count: 4 }, { count: -1 }, null])], [3, 4]);
	eq('series: not a list -> zeros', S.series({ nope: 1 }, ['2026-10-01']), [{ day: '2026-10-01', count: 0 }]);

	const slots = S.hourSlots(stats, -300);
	eq('hourSlots: instants on a UTC-5 clock', slots.slice(0, 2).map((s) => [S.apiTime(s.t), s.n]), [
		['2026-10-03T06:00:00Z', 2],
		['2026-10-04T04:00:00Z', 1],
	]);
	// the same counts on a UTC clock: 23:00 on Oct 3 at -5 is 04:00Z Oct 4
	eq('rebucket: from UTC-5 to UTC moves the 23:00 view to the next day', S.rebucket(stats, -300, 0), { '2026-10-03': 2, '2026-10-04': 1, '2026-10-05': 5 });
	eq('rebucket: same clock changes nothing', S.rebucket(stats, -300, -300), { '2026-10-03': 3, '2026-10-05': 5 });

	// since: Oct 5 09:20 his time = 14:20Z; the 09:00 hour counts whole
	eq('sumSince: the hour he looked in counts whole (a day without hours sits at its first hour)', S.sumSince(stats, -300, T('2026-10-05T14:20:00Z')), 4);
	eq('sumSince: after everything -> 0', S.sumSince(stats, -300, T('2026-10-06T14:20:00Z')), 0);
	eq('sumSince: no time -> 0', [S.sumSince(stats, -300, null), S.sumSince(stats, -300, NaN)], [0, 0]);
	eq('sumSince: before everything -> all', S.sumSince(stats, -300, T('2026-01-01T00:00:00Z')), 8);

	const keys = ['2026-10-03', '2026-10-04', '2026-10-05'];
	eq('compareDays: same clock', S.compareDays(stats, keys), { known: true, same: true, first: '2026-10-03', last: '2026-10-05', shift: '' });
	check('compareDays: labels a day later', S.compareDays([{ day: '2026-10-04' }, { day: '2026-10-06' }], keys).shift === 'later');
	check('compareDays: labels a day earlier', S.compareDays([{ day: '2026-10-02' }, { day: '2026-10-04' }], keys).shift === 'earlier');
	check('compareDays: nothing to compare', S.compareDays([], keys).known === false);
}

// ---- change and share ---------------------------------------------------------------

{
	const c = S.change(120, 100);
	check('change: up 20%', c.dir === 'up' && c.label === '+20%' && c.words === '20% more than' && c.diff === 20 && Math.abs(c.pct - 20) < 1e-9, c);
	const d = S.change(60, 100);
	check('change: down 40%', d.dir === 'down' && d.label === '-40%' && d.words === '40% fewer than', d);
	check('change: from nothing', S.change(5, 0).dir === 'new' && S.change(5, 0).pct === null);
	check('change: nothing either time', S.change(0, 0).dir === 'none' && S.change(0, 0).label === '');
	check('change: same', S.change(7, 7).dir === 'same' && S.change(7, 7).label === 'no change');
	check('change: under 1%', S.change(1001, 1000).label === '+<1%' && S.change(999, 1000).label === '-<1%');
	check('change: junk counts as 0', S.change('x', -4).dir === 'none');
	eq('share', [S.share(3, 40), S.share(1, 1000), S.share(0, 10), S.share(5, 0), S.share(50, 40)], ['8%', '<1%', '0%', '0%', '100%']);
}

// ---- paths joined to titles ------------------------------------------------------------

{
	const posts = JSON.parse(fs.readFileSync(path.join(root, 'blog/index.json'), 'utf8'));
	const toys = JSON.parse(fs.readFileSync(path.join(root, 'misc/toys.json'), 'utf8'));
	const index = S.buildIndex(posts, toys);
	check('index: every published post', Object.keys(index.posts).length === posts.length && posts.length > 0);
	check('index: toys from {toys: [...]}', Object.keys(index.toys).length === toys.toys.length && toys.toys.length > 0);
	check('index: routes default to ROUTE_TITLES', index.routes.about === 'About' && index.routes.misc === 'Miscellaneous');
	check('index: junk entries are skipped', Object.keys(S.buildIndex([null, { slug: '' }, { title: 'x' }], null).posts).length === 0);

	const p = posts[0];
	eq('cleanPath', [S.cleanPath('post/x/?a=1'), S.cleanPath('//about//'), S.cleanPath('/'), S.cleanPath(''), S.cleanPath('/blog#top')], ['/post/x', '/about', '/', '/', '/blog']);
	const dp = S.describe('/post/' + p.slug, index);
	check('describe: a post gets its title and a link', dp.kind === 'post' && dp.title === p.title && dp.link === '#/post/' + encodeURIComponent(p.slug), dp);
	const enc = S.describe('/post/' + encodeURIComponent(p.slug) + '/', index);
	check('describe: an encoded post path is the same post', enc.key === '/post/' + p.slug && enc.title === p.title, enc);
	const gone = S.describe('/post/never-published', index);
	check('describe: an unknown post says so and has no link', gone.kind === 'post' && gone.title === 'never-published' && gone.link === '' && /No published post/.test(gone.detail), gone);
	const route = S.describe('/publications', index, { title: 'Publications · Jack V. Le' });
	check('describe: a route', route.kind === 'route' && route.title === 'Publications' && route.link === '#/publications', route);
	check('describe: home', S.describe('/', index).kind === 'home' && S.describe('/index.html', index).title === 'Home');
	const book = S.describe('/bookshelf/abc%20def', index);
	check('describe: a book card', book.kind === 'book' && book.title === 'Bookshelf: abc def' && book.link === '#/bookshelf/abc%20def', book);
	const t = toys.toys[0];
	const toy = S.describe('/misc/' + t.slug + '/', index);
	check('describe: a toy page gets the toy title', toy.kind === 'toy' && toy.title === t.title && toy.link === 'misc/' + t.slug + '/', toy);
	check('describe: an unknown toy', S.describe('/misc/99-nothing', index).detail === 'Not in misc/toys.json');
	const other = S.describe('/wp-login.php', index, { title: 'Sneaky · Jack V. Le' });
	check('describe: an unknown path keeps GoatCounter title, no link', other.kind === 'other' && other.title === 'Sneaky' && other.link === '', other);
	check('describe: unknown path without a title', S.describe('/x', index).detail === 'Not a page of the site');
	const ev = S.describe('click-cv', index, { event: true, title: 'Clicked CV' });
	check('describe: an event', ev.kind === 'event' && ev.key === 'event:click-cv' && ev.title === 'Clicked CV', ev);
	check('describe: a link is never javascript:', ['/post/javascript:alert(1)', '/misc/javascript:x', '/javascript:alert(1)'].every((x) => !/^javascript:/i.test(S.describe(x, index).link)));
	eq('cleanTitle', [S.cleanTitle('Publications · Jack V. Le'), S.cleanTitle('  A  b '), S.cleanTitle(null)], ['Publications', 'A b', '']);

	const rows = S.joinPages(
		[
			{ path: '/about', count: 10, title: 'Jack V. Le' },
			{ path: '/post/' + p.slug, count: 4 },
			{ path: '/post/' + p.slug + '/', count: 2 },
			{ path: '/publications', count: 6 },
			{ path: 42, count: 100 },
			null,
		],
		index
	);
	eq('joinPages: spellings merged, largest first', rows.map((r) => [r.key, r.count]), [
		['/about', 10],
		['/post/' + p.slug, 6],
		['/publications', 6],
	]);
	check('joinPages: both spellings kept', rows[1].paths.length === 2);
	eq('joinPages: shares of the rows', rows.map((r) => r.share), ['45%', '27%', '27%']);
	eq('joinPages: shares of a given total', S.joinPages([{ path: '/about', count: 10 }], index, { total: 40 })[0].share, '25%');

	const refs = S.topList(
		[
			{ name: '', count: 36 },
			{ name: 'news.ycombinator.com', count: 5 },
			{ name: ' news.ycombinator.com ', count: 1 },
			{ name: 'x', count: 0 },
		],
		{ blank: 'Direct or unknown' }
	);
	eq('topList: blank named, merged, zero dropped', refs.map((r) => [r.name, r.count, r.blank]), [
		['Direct or unknown', 36, true],
		['news.ycombinator.com', 6, false],
	]);
	eq('topList: total smaller than the rows is ignored', S.topList([{ name: 'a', count: 5 }], { total: 2 })[0].share, '100%');
}

// ---- public counters ----------------------------------------------------------------

eq('parseCounter: formats', [S.parseCounter({ count: '1 234' }), S.parseCounter({ count: '1,234' }), S.parseCounter({ count: '1.234' }), S.parseCounter({ count: '1 234' }), S.parseCounter({ count: 7 })], [1234, 1234, 1234, 1234, 7]);
eq('parseCounter: nothing', [S.parseCounter(null), S.parseCounter({}), S.parseCounter({ count: '' }), S.parseCounter({ count: 'n/a' })], [null, null, null, null]);
eq(
	'sinceToDaily: differences, oldest first, negatives are 0',
	S.sinceToDaily([
		{ day: '2026-10-05', since: 3 },
		{ day: '2026-10-03', since: 20 },
		{ day: '2026-10-04', since: 8 },
		{ day: '2026-10-02', since: 15 }, // cached older answer: smaller than the next day's
		{ day: 'x', since: 1 },
	]),
	[
		{ day: '2026-10-02', count: 0 },
		{ day: '2026-10-03', count: 12 },
		{ day: '2026-10-04', count: 5 },
		{ day: '2026-10-05', count: 3 },
	]
);

// ---- chart -------------------------------------------------------------------------

{
	eq('niceScale: 0', S.niceScale(0), { max: 1, step: 1, ticks: [0, 1] });
	eq('niceScale: 7 in 3 steps', S.niceScale(7, 3), { max: 10, step: 5, ticks: [0, 5, 10] });
	const ns = S.niceScale(237, 3);
	check('niceScale: round step covering the max', ns.max >= 237 && [1, 2, 5].includes(ns.step / Math.pow(10, Math.floor(Math.log10(ns.step)))) && ns.ticks.length <= 5, ns);
	check('niceScale: step never under 1', S.niceScale(2, 4).step >= 1);
	eq('labelIndexes: 7 days -> all with 7 labels', S.labelIndexes(7, 7), [0, 1, 2, 3, 4, 5, 6]);
	const li = S.labelIndexes(30, 5);
	check('labelIndexes: 30 days -> at most 5, last included, even stride', li.length <= 5 && li[li.length - 1] === 29 && li.every((v, i) => i === 0 || v - li[i - 1] === li[1] - li[0]), li);
	check('labelIndexes: 90 days -> at most 5', S.labelIndexes(90, 5).length <= 5);
	eq('labelIndexes: none', S.labelIndexes(0), []);

	const list = S.series([{ day: '2026-10-04', daily: 5 }, { day: '2026-10-05', daily: 2 }], ['2026-10-03', '2026-10-04', '2026-10-05']);
	const L = S.chartLayout(list, { width: 300, height: 100, left: 30, right: 0, top: 10, bottom: 20 });
	check('chartLayout: one bar per day', L.bars.length === 3);
	check('chartLayout: empty day has no path', L.bars[0].d === '' && L.bars[0].h === 0);
	check('chartLayout: peak is the 5', L.peak === 1 && L.bars[1].h > L.bars[2].h);
	check('chartLayout: bars stay inside the plot', L.bars.every((b) => b.x >= L.plot.x - 0.01 && b.x + b.w <= L.plot.x + L.plot.w + 0.01 && b.y >= L.plot.y - 0.01 && b.y + b.h <= L.plot.y + L.plot.h + 0.01));
	check('chartLayout: tick 0 at the floor', L.ticks[0].value === 0 && L.ticks[0].y === L.plot.y + L.plot.h);
	check('chartLayout: a small count still shows (at least 2 units)', S.chartLayout([{ day: 'a', count: 1 }, { day: 'b', count: 1000 }], { height: 100 }).bars[0].h >= 2);
	check('chartLayout: 90 bars fit', S.chartLayout(new Array(90).fill(0).map((_, i) => ({ day: 'd' + i, count: i })), { width: 640 }).bars.every((b) => b.w >= 1));
	check('barPath: square foot, rounded top', /^M[\d.]+ [\d.]+V[\d.]+Q/.test(S.barPath(0, 0, 10, 20, 4)) && /^M0 20V0H10V20Z$/.test(S.barPath(0, 0, 10, 20, 0)));
	check('chartLayout: no NaN anywhere', !/NaN/.test(JSON.stringify(L)) && !/NaN/.test(JSON.stringify(S.chartLayout([], {}))));

	eq('summarize: nothing', S.summarize([]), 'There is nothing to show yet.');
	eq('summarize: no views', S.summarize([{ day: '2026-10-05', count: 0 }, { day: '2026-10-04', count: 0 }], { prevTotal: 3 }), 'No views in the last 2 days. The 2 days before had 3.');
	eq(
		'summarize: views, busiest day, change',
		S.summarize(list, { prevTotal: 5 }),
		'7 views in the last 3 days, 2.3 a day on average. The busiest day was October 4 with 5. That is 40% more than the 3 days before (5).'
	);
	eq('summarize: from none', S.summarize([{ day: '2026-10-05', count: 1 }], { prevTotal: 0 }), '1 view today. The day before had none.');
}

// ---- comments ------------------------------------------------------------------------

{
	const index = S.buildIndex([{ slug: 'latentland', title: 'Latentland' }], []);
	const discussions = [
		{
			number: 1,
			title: 'latentland',
			url: 'https://github.com/NietZteiN/nietztein.github.io/discussions/1',
			category: { name: 'Announcements' },
			comments: {
				nodes: [
					{
						id: 'C1',
						url: 'https://github.com/NietZteiN/nietztein.github.io/discussions/1#discussioncomment-1',
						createdAt: '2026-09-24T10:00:00Z',
						bodyText: 'First\r\nline',
						author: { login: 'reader-one' },
						replies: { nodes: [{ id: 'R1', url: 'javascript:alert(1)', createdAt: '2026-09-24T12:00:00Z', bodyText: 'reply', author: { login: 'nietztein' } }] },
					},
					{ id: 'C2', createdAt: '2026-09-30T18:30:00Z', body: '<img src=x onerror=alert(1)>', author: null, isMinimized: true, url: 'https://evil.example/x' },
					{ id: 'C3', createdAt: 'not a date', bodyText: 'dropped' },
				],
			},
		},
		{ number: 2, title: 'gone-post', url: 'http://github.com/x', category: { name: 'Announcements' }, comments: { nodes: [{ id: 'C4', createdAt: '2026-10-01T00:00:00Z', bodyText: 'x', author: { login: 'r' } }] } },
		{ number: 3, title: 'latentland', category: { name: 'General' }, comments: { nodes: [{ id: 'C5', createdAt: '2026-10-02T00:00:00Z', bodyText: 'other category', author: { login: 'r' } }] } },
		null,
	];
	const flat = S.flattenComments(discussions, { index, category: 'Announcements', me: 'NietZteiN' });
	eq('flatten: newest first, bad date and other category dropped', flat.map((c) => c.id), ['C4', 'C2', 'R1', 'C1']);
	const c1 = flat.find((c) => c.id === 'C1');
	check('flatten: comment joined to its post', c1.kind === 'comment' && c1.slug === 'latentland' && c1.postTitle === 'Latentland' && c1.known && c1.number === 1);
	check('flatten: CRLF normalised', c1.text === 'First\nline');
	const r1 = flat.find((c) => c.id === 'R1');
	check('flatten: reply knows whom it answers and that it is his (any case)', r1.kind === 'reply' && r1.replyTo === 'reader-one' && r1.mine === true);
	check('flatten: a non-GitHub link falls back to the discussion', r1.url === 'https://github.com/NietZteiN/nietztein.github.io/discussions/1');
	const c2 = flat.find((c) => c.id === 'C2');
	check('flatten: deleted author, hidden, evil link dropped, body kept as text', c2.author === 'a deleted account' && c2.hidden && c2.url === 'https://github.com/NietZteiN/nietztein.github.io/discussions/1' && c2.text === '<img src=x onerror=alert(1)>');
	const c4 = flat.find((c) => c.id === 'C4');
	check('flatten: unknown post and http link', !c4.known && c4.postTitle === '' && c4.url === '' && c4.discussionUrl === '');
	eq('flatten: junk input', S.flattenComments(null), []);
	eq('githubUrl', [S.githubUrl('https://github.com/a/b'), S.githubUrl('https://github.com.evil/x'), S.githubUrl('https://github.com/a" onclick="x'), S.githubUrl(null)], ['https://github.com/a/b', '', '', '']);

	const since = T('2026-09-28T00:00:00Z');
	eq('isNew: someone else, after the last look', flat.map((c) => S.isNew(c, since)), [true, true, false, false]);
	check('isNew: no last look -> nothing is new', !S.isNew(c4, null));
	check('isNew: his own is never new', !S.isNew({ at: T('2026-10-10T00:00:00Z'), mine: true }, since));

	const ex = S.excerpt('word '.repeat(200), 50);
	check('excerpt: cut at a word, marked', ex.cut && ex.text.length <= 54 && / \.\.\.$/.test(ex.text), ex);
	eq('excerpt: short text whole', S.excerpt('short', 50), { text: 'short', cut: false });
}

// ---- since you last looked -------------------------------------------------------------

{
	const now = T('2026-10-05T19:30:00Z');
	const first = S.lookState(null, null, now);
	check('look: first time -> nothing is "new", now recorded', first.since === null && first.record.lastSeen === '2026-10-05T19:30:00Z' && first.record.seenBefore === null, first);
	const later = S.lookState('2026-10-01T10:00:00Z', null, now);
	check('look: days later -> since the last look, which moves back', later.since === T('2026-10-01T10:00:00Z') && later.record.lastSeen === '2026-10-05T19:30:00Z' && later.record.seenBefore === '2026-10-01T10:00:00Z', later);
	const again = S.lookState('2026-10-05T19:28:00Z', '2026-10-01T10:00:00Z', now);
	check('look: within the sitting -> same "since", nothing written', again.since === T('2026-10-01T10:00:00Z') && again.record === null, again);
	const ahead = S.lookState('2027-01-01T00:00:00Z', '2026-10-01T10:00:00Z', now);
	check('look: a last look in the future is not trusted', ahead.since === T('2026-10-01T10:00:00Z') && ahead.record.lastSeen === '2026-10-05T19:30:00Z', ahead);
	const junk = S.lookState('yesterday', 'x', now);
	check('look: junk is a first time', junk.since === null && junk.record.lastSeen === '2026-10-05T19:30:00Z');
	const custom = S.lookState('2026-10-05T19:00:00Z', null, now, 60 * 60000);
	check('look: the sitting length is a parameter', custom.record === null && custom.since === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
