// node desk/test/test-postfile.mjs
//
// Tests desk/postfile.js against the site's own two readers of a post file:
// parseFrontMatter() in scripts/build-blog-index.mjs and parsePost() in
// assets/js/blog.js. Their source is read from those files and evaluated here
// (neither script is run: build-blog-index.mjs would rewrite blog/index.json).
//
// Every published post is round-tripped. Posts are enumerated through
// blog/index.json; blog/drafts/ and unlisted files in blog/posts/ are never opened.
// No file is written anywhere.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const require = createRequire(import.meta.url);
const P = require(join(root, 'desk', 'postfile.js'));

let pass = 0;
let fail = 0;
function ok(cond, name, detail) {
	if (cond) {
		pass++;
	} else {
		fail++;
		console.log('FAIL ' + name + (detail !== undefined ? '\n     ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
	}
}
function eq(a, b, name) {
	const sa = JSON.stringify(a);
	const sb = JSON.stringify(b);
	ok(sa === sb, name, sa === sb ? undefined : 'got      ' + sa + '\n     expected ' + sb);
}

// ---- the site's own readers, taken from their files ---------------------------------

function extractFunction(source, name) {
	const start = source.indexOf('function ' + name + '(');
	if (start === -1) throw new Error('no function ' + name);
	let depth = 0;
	let i = source.indexOf('{', start);
	for (; i < source.length; i++) {
		if (source[i] === '{') depth++;
		else if (source[i] === '}') {
			depth--;
			if (depth === 0) break;
		}
	}
	return source.slice(start, i + 1);
}

const indexSrc = readFileSync(join(root, 'scripts', 'build-blog-index.mjs'), 'utf8');
const blogSrc = readFileSync(join(root, 'assets', 'js', 'blog.js'), 'utf8');
const siteParseFrontMatter = new Function(extractFunction(indexSrc, 'parseFrontMatter') + '\nreturn parseFrontMatter;')();
const siteSlugFromFile = new Function(extractFunction(indexSrc, 'slugFromFile') + '\nreturn slugFromFile;')();
const siteParsePost = new Function(extractFunction(blogSrc, 'parsePost') + '\nreturn parsePost;')();

// The index entry, as build() in build-blog-index.mjs makes it.
function siteEntry(file, text) {
	const fm = siteParseFrontMatter(text);
	const dateFromName = (file.match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1] || '';
	const slug = siteSlugFromFile(file);
	return { slug, title: fm.title || slug, date: fm.date || dateFromName || '', summary: fm.summary || '', tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [], file };
}

function fmOnly(o) {
	const out = {};
	for (const k of Object.keys(o).sort()) out[k] = o[k];
	return out;
}

// ---- 1. every published post ------------------------------------------------------

const FORBIDDEN = 'blog/posts/2026-09-08-i-am-an-ai-loop.md';
const index = JSON.parse(readFileSync(join(root, 'blog', 'index.json'), 'utf8'));
ok(Array.isArray(index) && index.length > 0, 'blog/index.json lists posts');

let roundTripped = 0;
for (const e of index) {
	const rel = 'blog/posts/' + e.file;
	if (rel === FORBIDDEN || /\.\.|[\\/]/.test(e.file)) {
		ok(false, 'index entry points at a file this test must not open', e.file);
		continue;
	}
	const text = readFileSync(join(root, rel), 'utf8');
	const mine = P.parse(text);
	const theirs = siteParsePost(text);
	eq(fmOnly(mine.fm), fmOnly(theirs.fm), e.file + ': front matter as blog.js reads it');
	eq(mine.body, theirs.body, e.file + ': body as blog.js reads it');
	eq(fmOnly(mine.fm), fmOnly(siteParseFrontMatter(text)), e.file + ': front matter as build-blog-index.mjs reads it');
	eq(P.indexEntry(e.file, text), siteEntry(e.file, text), e.file + ': index entry as build-blog-index.mjs makes it');
	eq(P.indexEntry(e.file, text), e, e.file + ': index entry equals the one in blog/index.json');

	// Round trip: read as a draft, write the public file again, read it back.
	const d = P.readDraft(text, e.file);
	const rebuilt = P.buildPost(d, d.body);
	eq(siteEntry(e.file, rebuilt), siteEntry(e.file, text), e.file + ': rebuilt file gives the same index entry');
	// (A working-tree copy may have CRLF from core.autocrlf; git and GitHub hold LF, which build() writes.)
	eq(siteParsePost(rebuilt).body, siteParsePost(text).body.replace(/^\s+/, '').replace(/\r\n/g, '\n'), e.file + ': rebuilt file gives the same body');
	ok(P.buildPost(P.readDraft(rebuilt, e.file), P.readDraft(rebuilt, e.file).body) === rebuilt, e.file + ': building is stable (a second round trip changes nothing)');

	// As a draft (with slug and published), and back to the public file.
	const draftText = P.buildDraft({ ...d, slug: e.slug, published: rel, publishedSha: 'abc123' }, d.body);
	const d2 = P.readDraft(draftText);
	eq([d2.title, d2.date, d2.summary, d2.tags, d2.slug, d2.published, d2.publishedSha], [d.title, d.date, d.summary, d.tags, e.slug, rel, 'abc123'], e.file + ': draft keeps every field');
	ok(P.buildPost(d2, d2.body) === rebuilt, e.file + ': draft -> public file is the same file');

	// The publish checks pass for it as an update of itself.
	const existing = {};
	for (const x of index) existing[x.slug] = x.file;
	const c = P.checkPublish({ title: d.title, date: d.date, summary: d.summary, tags: d.tags, slug: e.slug, body: d.body, existing, ownFile: e.file, today: '2026-10-05' });
	ok(c.ok, e.file + ': publish checks pass as an update', c.errors);
	ok(c.path === rel, e.file + ': update keeps the path', c.path);
	// ...and fail as a new post with the same slug.
	const c2 = P.checkPublish({ title: d.title, date: '2026-10-05', summary: d.summary, tags: d.tags, slug: e.slug, body: d.body, existing, ownFile: '', today: '2026-10-05' });
	ok(!c2.ok && c2.errors.some((x) => x.code === 'slug-taken'), e.file + ': its slug is taken for a new post');
	roundTripped++;
}
ok(roundTripped === index.length, 'every listed post round-tripped (' + roundTripped + ')');

// ---- 2. awkward values survive both readers ---------------------------------------

const AWKWARD = [
	'Plain title',
	'Title: with a colon',
	'"Quoted" at the start',
	'Ends with a quote "',
	"'single' quotes",
	'[Looks like a list]',
	'[only an opening bracket',
	'# Hash at the start',
	'Commas, many, of them',
	'日本語のタイトル',
	'Tiếng Việt có dấu',
	'  spaces around  ',
	'Line\nbreak',
	'---',
	'a: b: c',
	'"',
	"''",
	'Emoji \u{1F600} and é',
];
for (const v of AWKWARD) {
	const want = v.replace(/\r\n?|\n/g, ' ').trim();
	const text = P.buildPost({ title: v, date: '2026-10-05', summary: v, tags: ['a'] }, 'Body.\n');
	const a = siteParseFrontMatter(text);
	const b = siteParsePost(text).fm;
	eq([a.title, a.summary], [want, want], 'build-blog-index reads back ' + JSON.stringify(v));
	eq([b.title, b.summary], [want, want], 'blog.js reads back ' + JSON.stringify(v));
	eq(siteParsePost(text).body, 'Body.\n', 'body intact after ' + JSON.stringify(v));
}

// Tags: whatever is typed becomes lowercase-dash tags that survive the list syntax.
eq(P.cleanTags(['LLM', ' Machine Learning ', 'llm', '#nlp', 'a,b', '[x]', '"q"', 'language_acquisition', '']), ['llm', 'machine-learning', 'nlp', 'a-b', 'x', 'q', 'language-acquisition'], 'cleanTags');
{
	const text = P.buildPost({ title: 'T', date: '2026-10-05', summary: 'S', tags: ['日本語', 'two words', 'x'] }, 'B');
	eq(siteParseFrontMatter(text).tags, ['日本語', 'two words', 'x'], 'tags as a list for the index');
	eq(P.buildPost({ title: 'T', date: '2026-10-05', summary: 'S', tags: [] }, 'B').split('\n')[4], 'tags: []', 'no tags is written as []');
	eq(siteParseFrontMatter(P.buildPost({ title: 'T', date: '2026-10-05', summary: 'S', tags: [] }, 'B')).tags, [], 'tags: [] reads as an empty list');
}

// Front matter order and shape, as blog/README.md shows it.
eq(
	P.buildPost({ tags: ['tag-one', 'tag-two'], summary: 'One line shown in the post list.', date: '2026-08-01', title: 'Your title here' }, '# Your title here\n\nBody goes here.'),
	'---\ntitle: Your title here\ndate: 2026-08-01\nsummary: One line shown in the post list.\ntags: [tag-one, tag-two]\n---\n\n# Your title here\n\nBody goes here.\n',
	'the README example, byte for byte'
);
// CRLF, a byte-order mark and blank lines at the top are cleaned.
eq(P.buildPost({ title: 'T', date: '2026-10-05', summary: 'S', tags: [] }, String.fromCharCode(0xfeff) + '\r\n\r\nA\r\nB'), '---\ntitle: T\ndate: 2026-10-05\nsummary: S\ntags: []\n---\n\nA\nB\n', 'line ends and BOM');
// The draft-only keys never reach the public file.
ok(!/slug:|published/.test(P.buildPost({ title: 'T', date: '2026-10-05', summary: 'S', tags: [], slug: 'x', published: 'p' }, 'B')), 'public file has no draft keys');
// A draft without front matter (written elsewhere) still opens.
eq(P.readDraft('Just some text\n').body, 'Just some text\n', 'a draft with no front matter keeps its text');
eq(P.readDraft('---\ntitle: X\n---\n\n\nBody\n', 'drafts/2026-01-02-from-name.md').slug, 'from-name', 'slug from a dated draft file name');

// ---- 3. slugs, dates, file names ----------------------------------------------------

eq(P.slugify('Benchmarks We Actually Need'), 'benchmarks-we-actually-need', 'slugify: existing post 1');
eq(P.slugify('Open Questions in Language Acquisition'), 'open-questions-in-language-acquisition', 'slugify: existing post 2');
eq(P.slugify('Metaphors We Hallucinate By'), 'metaphors-we-hallucinate-by', 'slugify: existing post 3');
eq(P.slugify("Don't Panic & Relax"), 'dont-panic-and-relax', 'slugify: apostrophe and ampersand');
eq(P.slugify('Tiếng Việt: Đi học'), 'tieng-viet-di-hoc', 'slugify: Vietnamese folds to ASCII');
eq(P.slugify('Über Straße'), 'uber-strasse', 'slugify: German folds to ASCII');
eq(P.slugify('日本語 and English'), 'and-english', 'slugify: keeps the ASCII words');
eq(P.slugify('日本語のタイトル'), '', 'slugify: no ASCII words gives nothing');
eq(P.slugify('  --  '), '', 'slugify: punctuation only');
ok(P.slugify('word '.repeat(40)).length <= 60 && !/-$/.test(P.slugify('word '.repeat(40))), 'slugify: long titles are cut at a word');
eq(P.suggestSlug('日本語のタイトル', '2026-10-05'), { slug: 'post-20261005', fromTitle: false, needsName: true }, 'a title with no ASCII keeps a date-based slug and asks for a name');
eq(P.suggestSlug('Hello', '2026-10-05'), { slug: 'hello', fromTitle: true, needsName: false }, 'suggestSlug from a title');
ok(P.isDateSlug('post-20261005') && P.isDateSlug('post-untitled') && !P.isDateSlug('post-hello'), 'isDateSlug');
ok(P.isValidSlug('a-b-1') && !P.isValidSlug('A-b') && !P.isValidSlug('a--b') && !P.isValidSlug('-a') && !P.isValidSlug('a b') && !P.isValidSlug(''), 'isValidSlug');
ok(P.isValidDate('2026-10-05') && P.isValidDate('2024-02-29') && !P.isValidDate('2026-02-29') && !P.isValidDate('2026-13-01') && !P.isValidDate('2026-1-5') && !P.isValidDate('5 Oct 2026'), 'isValidDate');
eq(P.postPath('2026-10-05', 'hello'), 'blog/posts/2026-10-05-hello.md', 'postPath');
eq(siteSlugFromFile(P.fileName('2026-10-05', 'hello')), 'hello', 'the index takes the slug back from the file name');
eq(P.slugFromFile('blog/posts/2026-08-27-untitled.md'), 'untitled', 'slugFromFile with a folder');

// ---- 4. words -----------------------------------------------------------------------

eq(P.wordCount('Hello, world. Two more').words, 4, 'words: English');
eq(P.wordCount('日本語です').words, 5, 'words: each Japanese character counts');
eq(P.wordCount('I study 日本語 every day').words, 7, 'words: mixed');
eq(P.wordCount('Before\n\n```js\nconst a = 1;\n```\n\nAfter').words, 2, 'words: fenced code is not counted');
eq(P.wordCount('').words, 0, 'words: empty');
eq(P.wordCount('# Heading\n\n- item one\n- item two\n\n$x^2$').words, 6, 'words: Markdown marks are not words');

// ---- 5. images ----------------------------------------------------------------------

{
	const body = 'A ![one](drafts/images/my-post/a.png) and ![two](drafts/images/old-slug/a.png "t")\n<img src="drafts/images/my-post/b.jpg">\nAgain ![one](drafts/images/my-post/a.png).\n';
	eq(P.privateImages(body), ['drafts/images/my-post/a.png', 'drafts/images/old-slug/a.png', 'drafts/images/my-post/b.jpg'], 'privateImages finds each once');
	const plan = P.planImages(P.privateImages(body), 'my-post', () => null, () => false);
	eq(plan.map((x) => x.to), ['assets/img/blog/my-post/a.png', 'assets/img/blog/my-post/a-2.png', 'assets/img/blog/my-post/b.jpg'], 'planImages: same names get -2');
	const out = P.rewriteImages(body, plan);
	eq(P.privateImages(out), [], 'rewriteImages leaves no private link');
	ok(out.includes('![two](assets/img/blog/my-post/a-2.png "t")') && out.includes('<img src="assets/img/blog/my-post/b.jpg">') && out.includes('Again ![one](assets/img/blog/my-post/a.png).'), 'rewriteImages keeps the rest of the line', out);
	// A name already on the site is reused only for the same picture.
	const onSite = { 'assets/img/blog/my-post/a.png': 'sha-a' };
	const plan2 = P.planImages(['drafts/images/my-post/a.png'], 'my-post', (p) => onSite[p] || null, () => false);
	eq(plan2[0].to, 'assets/img/blog/my-post/a-2.png', 'planImages: a different picture under the same name gets a new name');
	const plan3 = P.planImages(['drafts/images/my-post/a.png'], 'my-post', (p) => onSite[p] || null, () => true);
	eq([plan3[0].to, plan3[0].existing], ['assets/img/blog/my-post/a.png', 'sha-a'], 'planImages: the same picture is reused');
	// And back to private for a post taken off the site.
	eq(P.siteImages(out), ['assets/img/blog/my-post/a.png', 'assets/img/blog/my-post/a-2.png', 'assets/img/blog/my-post/b.jpg'], 'siteImages');
	eq(P.rewriteToPrivate('![x](assets/img/blog/p/a.png)', { 'assets/img/blog/p/a.png': 'drafts/images/p/a.png' }), '![x](drafts/images/p/a.png)', 'rewriteToPrivate');
}
eq(P.imageName('Café Photo.JPEG', 'image/jpeg', {}), 'cafe-photo.jpg', 'imageName: ASCII, lowercase, jpg');
eq(P.imageName('', 'image/png', { 'image.png': true }), 'image-2.png', 'imageName: unique');
eq(P.imageName('スクリーン.png', 'image/png', {}), 'image.png', 'imageName: a name with no ASCII');
ok(P.isImageType('image/webp') && !P.isImageType('text/html'), 'isImageType');
eq(P.mimeFor('a.JPG'), 'image/jpeg', 'mimeFor');

// ---- 6. publish checks --------------------------------------------------------------

const base = { title: 'A Test Title', date: '2026-10-05', summary: 'One line.', tags: ['test'], slug: 'a-test-title', body: 'Text.\n', existing: { latentland: '2026-09-21-latentland.md' }, ownFile: '', today: '2026-10-05' };
{
	const c = P.checkPublish(base);
	ok(c.ok, 'checks pass for a complete post', c.errors);
	eq(c.path, 'blog/posts/2026-10-05-a-test-title.md', 'the path');
	eq(c.text, '---\ntitle: A Test Title\ndate: 2026-10-05\nsummary: One line.\ntags: [test]\n---\n\nText.\n', 'the file text');
	eq(siteEntry(c.file, c.text), { slug: 'a-test-title', title: 'A Test Title', date: '2026-10-05', summary: 'One line.', tags: ['test'], file: '2026-10-05-a-test-title.md' }, 'the index would list it as meant');
}
function codes(o) {
	const c = P.checkPublish({ ...base, ...o });
	return { e: c.errors.map((x) => x.code), w: c.warnings.map((x) => x.code) };
}
ok(codes({ title: '' }).e.includes('title'), 'missing title');
ok(codes({ title: '   ' }).e.includes('title'), 'blank title');
ok(codes({ date: '' }).e.includes('date'), 'missing date');
ok(codes({ date: '2026-02-30' }).e.includes('date'), 'impossible date');
ok(codes({ date: '10/05/2026' }).e.includes('date'), 'date in another format');
ok(codes({ summary: '' }).e.includes('summary'), 'missing summary');
ok(codes({ summary: 'x'.repeat(300) }).w.includes('summary-long'), 'long summary warns');
ok(codes({ summary: 'two\nlines' }).w.includes('one-line'), 'a line break in the summary warns');
ok(codes({ slug: '' }).e.includes('slug'), 'missing slug');
ok(codes({ slug: 'Bad Slug' }).e.includes('slug'), 'invalid slug');
ok(codes({ slug: 'latentland' }).e.includes('slug-taken'), 'slug of another post');
ok(codes({ slug: 'latentland', ownFile: '2026-09-21-latentland.md' }).e.length === 0, 'own slug on an update');
ok(codes({ slug: 'post-20261005' }).w.includes('slug-date'), 'a date-based slug warns');
ok(codes({ body: '  \n ' }).e.includes('body'), 'empty body');
ok(codes({ body: '![x](drafts/images/a/b.png)' }).e.includes('private-image'), 'a private image left');
ok(codes({ body: '![x](blob:http://x/1)' }).e.includes('blob-link'), 'a blob: link');
ok(codes({ missingImages: ['drafts/images/a/b.png'] }).e.includes('missing-image'), 'a missing image');
ok(codes({ body: '![x](https://example.org/a.png)' }).w.includes('remote-image'), 'remote image warns');
ok(codes({ tags: [] }).w.includes('tags'), 'no tags warns');
ok(codes({ date: '2027-01-01' }).w.includes('future'), 'future date warns');
ok(codes({ body: '    indented first line' }).w.includes('leading-space'), 'leading spaces warn');
ok(codes({ title: '[x]', summary: '"q"' }).e.length === 0, 'awkward but valid values pass');
{
	const c = P.checkPublish({ ...base, slug: 'renamed', ownFile: '2026-09-21-latentland.md', existing: { latentland: '2026-09-21-latentland.md' } });
	ok(c.ok && c.path === 'blog/posts/2026-10-05-renamed.md' && c.warnings.some((w) => w.code === 'rename'), 'renaming a published post: new path and a warning', c);
}
{
	const c = P.checkPublish({ ...base, slug: 'latentland', date: '2026-10-01', ownFile: '2026-09-21-latentland.md', existing: { latentland: '2026-09-21-latentland.md' } });
	ok(c.ok && c.path === 'blog/posts/2026-09-21-latentland.md' && c.warnings.some((w) => w.code === 'date-differs'), 'changing the date of a published post keeps its file');
}

console.log((fail ? 'FAIL' : 'PASS') + ' test-postfile: ' + pass + ' passed, ' + fail + ' failed (' + roundTripped + ' published posts round-tripped)');
process.exit(fail ? 1 : 0);
