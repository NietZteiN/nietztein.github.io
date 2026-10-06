// Tests for desk/gh.js against desk/test/fake-github.mjs.
// Run with: node desk/test/test-gh.mjs
// Prints PASS/FAIL lines; exit code 1 on any failure. No network beyond 127.0.0.1.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeGitHub, TOKENS, SITE, blobSha as gitBlobSha } from './fake-github.mjs';

const require = createRequire(import.meta.url);
const GH = require('../gh.js');
const E = GH.errors;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = 0;
let count = 0;
const seenErrors = [];
function check(name, ok, detail = '') {
	count++;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' : ' + detail : ''}`);
}
async function rejects(promise) {
	try {
		const value = await promise;
		return { resolved: true, value };
	} catch (e) {
		seenErrors.push(e);
		return e;
	}
}
const is = (e, Type) => e instanceof Type;

const fake = await startFakeGitHub();
fake.actionDelayMs = 5;

function mk(token, privRepo = 'desk-ready', extra = {}) {
	const state = { token, unauthorized: 0, rate: null, busy: [] };
	const made = GH.create({
		...extra,
		apiBase: fake.url,
		token: () => state.token,
		site: SITE,
		priv: { owner: 'NietZteiN', repo: privRepo, branch: 'main' },
		onUnauthorized: () => state.unauthorized++,
		onRate: (r) => (state.rate = r),
		onActivity: (n) => state.busy.push(n),
	});
	return { gh: made.client, issue: made.issueTicket, state };
}

const siteRepo = () => fake.repo('NietZteiN/nietztein.github.io');
const ready = () => fake.repo('NietZteiN/desk-ready');
const sent = () => fake.requests.length;
const writesTo = (full) => fake.requests.filter((r) => r.method !== 'GET' && r.path.toLowerCase().startsWith('/repos/' + full.toLowerCase() + '/')).length;

const { gh, issue, state } = mk(TOKENS.full);

// ---- who and where ----------------------------------------------------------
const me = await gh.user();
check('user(): the login behind the token', me.login === 'NietZteiN' && me.id === 1001 && me.name === 'Jack V. Le');
const siteInfo = await gh.repo('site');
check('repo(site): public, pushable by the owner', siteInfo.fullName === 'NietZteiN/nietztein.github.io' && siteInfo.isPrivate === false && siteInfo.canPush === true && siteInfo.defaultBranch === 'main');
const privInfo = await gh.repo('private');
check('repo(private): private', privInfo.fullName === 'NietZteiN/desk-ready' && privInfo.isPrivate === true && privInfo.visibility === 'private');
check('repo(other): an unknown target is refused', is(await rejects(Promise.resolve().then(() => gh.repo('elsewhere'))), E.GitHubError));
const before = fake.rate.remaining;
const rate = await gh.rate();
check('rate(): limit, remaining and a reset time', rate.limit === 5000 && rate.remaining === before && rate.reset instanceof Date && rate.reset > new Date());
check('rate(): asking does not use up a request', fake.rate.remaining === before);
await gh.user();
check('rateSeen(): the headers of the last answer are remembered', gh.rateSeen().remaining === before - 1 && state.rate.remaining === before - 1);
check('activity: the in-flight count goes up and comes back to zero', state.busy.includes(1) && state.busy[state.busy.length - 1] === 0);

// ---- reading ----------------------------------------------------------------
const readmeDisk = fs.readFileSync(path.join(repoRoot, 'blog', 'README.md'));
const readme = await gh.read('site', 'blog/README.md');
check('read(): text equals the file on disk', readme.text === readmeDisk.toString('utf8'));
check('read(): sha is the git blob id', readme.sha === gitBlobSha(readmeDisk) && (await gh.blobSha(readmeDisk)) === readme.sha);
check('read(): a missing file is null', (await gh.read('site', 'blog/posts/nope.md')) === null);
check('read(): a folder is an error, not a file', is(await rejects(gh.read('site', 'blog/posts')), E.GitHubError));
check('read(): a path with .. is refused before any request', await (async () => { const n = sent(); const e = await rejects(gh.read('site', '../secrets')); return is(e, E.GitHubError) && sent() === n; })());
check('read(): leading and trailing slashes are forgiven', (await gh.read('site', '/blog/README.md/')).sha === readme.sha);
const cfg = await gh.readJSON('site', 'assets/js/config.json', null);
check('readJSON(): the site config', cfg && cfg.goatCounterCode === 'nietztein' && cfg.giscus.category === 'Announcements');
check('readJSON(): the fallback for a missing file', (await gh.readJSON('private', 'desk/none.json', { a: 1 })).a === 1);
ready().put('desk/broken.json', '{ not json');
check('readJSON(): bad JSON is an error that names the file', /broken\.json/.test((await rejects(gh.readJSON('private', 'desk/broken.json', null))).message));
const bytes = await gh.readBytes('site', 'blog/index.json');
check('readBytes(): a Uint8Array with the same bytes', bytes.bytes instanceof Uint8Array && Buffer.from(bytes.bytes).equals(fs.readFileSync(path.join(repoRoot, 'blog', 'index.json'))));
const big = Buffer.alloc(1200000);
for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 255;
ready().put('files/big.bin', big);
const bigBack = await gh.readBytes('private', 'files/big.bin');
check('readBytes(): a file over 1 MB comes through the blob API', Buffer.from(bigBack.bytes).equals(big) && bigBack.sha === gitBlobSha(big));
ready().put('notes/empty.md', '');
check('read(): an empty file is an empty string, not null', (await gh.read('private', 'notes/empty.md')).text === '');

const posts = await gh.list('site', 'blog/posts');
check('list(): the two seeded posts', posts.length === 2 && posts.every((p) => p.type === 'file' && /^blog\/posts\/.+\.md$/.test(p.path) && p.sha.length === 40 && p.size > 0));
const rootList = await gh.list('site', '');
check('list(): the root has folders', rootList.some((e) => e.name === 'blog' && e.type === 'dir') && rootList.some((e) => e.name === 'misc' && e.type === 'dir'));
check('list(): a missing folder is an empty list', (await gh.list('private', 'reading/2031')).length === 0);
check('list(): a file is an error', is(await rejects(gh.list('site', 'blog/README.md')), E.GitHubError));

let n0 = sent();
const tree = await gh.tree('site');
check('tree(): every path, files and folders', tree.some((e) => e.path === 'blog/index.json' && e.type === 'file') && tree.some((e) => e.path === 'blog/posts' && e.type === 'dir') && tree.filter((e) => e.type === 'file').length === 7);
await gh.tree('site');
check('tree(): cached', sent() === n0 + 1);
await gh.tree('site', { refresh: true });
check('tree(): refresh asks again', sent() === n0 + 2);
check('shaOf(): remembered from reads and listings', gh.shaOf('site', 'blog/README.md') === readme.sha && gh.shaOf('site', 'misc/toys.json') === siteRepo().sha('misc/toys.json') && gh.shaOf('site', 'nope') === null);

// ---- writing to the private repository -------------------------------------
const odd = 'na' + String.fromCodePoint(0xef) + 've ' + String.fromCodePoint(0x2014) + ' ' + String.fromCodePoint(0x3c0) + ' ' + String.fromCodePoint(0x1f642) + '\n';
const w1 = await gh.write('private', 'notes/a.md', odd, { message: 'Add a note' });
check('write(): creates a file', ready().text('notes/a.md') === odd && w1.sha === gitBlobSha(Buffer.from(odd)) && w1.commit === ready().head);
check('write(): the commit message is the one given', ready().log()[0].message === 'Add a note');
check('write(): text survives as UTF-8', (await gh.read('private', 'notes/a.md')).text === odd);
const w2 = await gh.write('private', 'notes/a.md', 'second\n', { message: 'Edit', sha: w1.sha });
check('write(): updates with the sha that was read', ready().text('notes/a.md') === 'second\n' && w2.sha !== w1.sha && gh.shaOf('private', 'notes/a.md') === w2.sha);
const stale = await rejects(gh.write('private', 'notes/a.md', 'third\n', { message: 'Edit', sha: w1.sha }));
check('write(): a stale sha is a Conflict and nothing is overwritten', is(stale, E.Conflict) && stale.path === 'notes/a.md' && ready().text('notes/a.md') === 'second\n');
const blind = await rejects(gh.write('private', 'notes/a.md', 'blind\n', { message: 'Edit' }));
check('write(): an existing file without a sha is a Conflict', is(blind, E.Conflict) && ready().text('notes/a.md') === 'second\n');
check('write(): a sha for a file that is gone is a Conflict', is(await rejects(gh.write('private', 'notes/never.md', 'x', { sha: w1.sha })), E.Conflict));
const all = new Uint8Array(256);
for (let i = 0; i < 256; i++) all[i] = i;
await gh.write('private', 'files/all.bin', all, { message: 'Bytes' });
check('write(): bytes survive exactly', Buffer.from(all).equals(ready().bytes('files/all.bin')) && Buffer.from((await gh.readBytes('private', 'files/all.bin')).bytes).equals(Buffer.from(all)));
await gh.write('private', 'notes/with space & plus+.md', 'x\n');
check('write(): a path with spaces and symbols', ready().text('notes/with space & plus+.md') === 'x\n' && (await gh.read('private', 'notes/with space & plus+.md')).text === 'x\n');
n0 = sent();
await gh.tree('private');
await gh.write('private', 'notes/b.md', 'b\n');
check('tree(): a write drops the cached tree', (await gh.tree('private')).some((e) => e.path === 'notes/b.md'));

const r1 = await gh.remove('private', 'notes/b.md', { message: 'Drop b', sha: gh.shaOf('private', 'notes/b.md') });
check('remove(): deletes with the sha', ready().text('notes/b.md') === null && r1.commit === ready().head && gh.shaOf('private', 'notes/b.md') === null);
await gh.remove('private', 'notes/with space & plus+.md');
check('remove(): looks the sha up when none is given', ready().text('notes/with space & plus+.md') === null);
check('remove(): a missing file is NotFound', is(await rejects(gh.remove('private', 'notes/b.md')), E.NotFound));
check('remove(): a stale sha is a Conflict', is(await rejects(gh.remove('private', 'notes/a.md', { sha: w1.sha })), E.Conflict) && ready().text('notes/a.md') === 'second\n');

// ---- several files in one commit -------------------------------------------
let commits = ready().log().length;
const c1 = await gh.commit('private', [{ path: 'reading/2026.md', content: 'log\n' }, { path: 'files/pic.bin', bytes: all }, { path: 'notes/a.md', remove: true }, { path: 'notes/zero.md', content: '' }], 'Three things at once');
check('commit(): one commit for several files', ready().log().length === commits + 1 && ready().log()[0].message === 'Three things at once' && c1.commit === ready().head);
check('commit(): text, bytes, an empty file and a removal all landed', ready().text('reading/2026.md') === 'log\n' && Buffer.from(all).equals(ready().bytes('files/pic.bin')) && ready().text('notes/a.md') === null && ready().text('notes/zero.md') === '');
check('commit(): reports the new blob ids', c1.files['reading/2026.md'] === gitBlobSha(Buffer.from('log\n')) && c1.files['notes/a.md'] === null && gh.shaOf('private', 'reading/2026.md') === c1.files['reading/2026.md']);
commits = ready().log().length;
const cStale = await rejects(gh.commit('private', [{ path: 'reading/2026.md', content: 'mine\n', sha: 'f'.repeat(40) }, { path: 'notes/new.md', content: 'n\n' }], 'Should not land'));
check('commit(): an expected sha that no longer matches is a Conflict; nothing lands', is(cStale, E.Conflict) && cStale.path === 'reading/2026.md' && ready().log().length === commits && ready().text('notes/new.md') === null);
const cExists = await rejects(gh.commit('private', [{ path: 'reading/2026.md', content: 'mine\n', sha: null }], 'Should not land'));
check('commit(): "must not exist yet" (sha: null) is a Conflict when it does', is(cExists, E.Conflict) && ready().text('reading/2026.md') === 'log\n');
await gh.commit('private', [{ path: 'reading/2026.md', content: 'log 2\n', sha: c1.files['reading/2026.md'] }], 'With the right sha');
check('commit(): the right expected sha goes through', ready().text('reading/2026.md') === 'log 2\n');
commits = ready().log().length;
fake.failNext('PATCH /repos/NietZteiN/desk-ready/git/refs', { status: 422, body: { message: 'Update is not a fast forward' } });
await gh.commit('private', [{ path: 'notes/race.md', content: 'r\n' }], 'Raced');
check('commit(): "not a fast forward" is retried on the new head', ready().text('notes/race.md') === 'r\n' && ready().log().length === commits + 1);
commits = ready().log().length;
const noop = await gh.commit('private', [{ path: 'notes/not-there.md', remove: true }, { path: 'notes/race.md', content: 'r\n' }], 'Nothing to do');
check('commit(): nothing to change makes no commit', noop.commit === null && ready().log().length === commits);
check('commit(): the same path twice is refused', is(await rejects(gh.commit('private', [{ path: 'a.md', content: '1' }, { path: 'a.md', content: '2' }], 'Twice')), E.GitHubError));
check('commit(): no files, or no message, is refused', is(await rejects(gh.commit('private', [], 'x')), E.GitHubError) && is(await rejects(gh.commit('private', [{ path: 'a.md', content: '1' }], '')), E.GitHubError));

// ---- a brand-new, empty repository ------------------------------------------
const fresh = mk(TOKENS.full, 'desk');
const empty = fake.repo('NietZteiN/desk');
check('empty repository: read is null, list and tree are empty', (await fresh.gh.read('private', 'README.md')) === null && (await fresh.gh.list('private', '')).length === 0 && (await fresh.gh.tree('private')).length === 0);
check('empty repository: probeWrite cannot tell yet', (await fresh.gh.probeWrite('private')) === 'empty');
const c0 = await fresh.gh.commit('private', [{ path: 'drafts/.gitkeep', content: '' }, { path: 'README.md', content: '# desk\n' }, { path: 'desk/settings.json', content: '{}\n' }], 'Set up the Desk');
const log0 = empty.log();
check('empty repository: commit() starts it with the README, then the rest', log0.length === 2 && log0[1].files.length === 1 && log0[1].files[0].filename === 'README.md' && log0[0].files.length === 2 && c0.commit === empty.head);
check('empty repository: every file is there afterwards', empty.files().join(',') === 'README.md,desk/settings.json,drafts/.gitkeep');
const fresh2 = mk(TOKENS.full, 'desk');
fake.reset();
fake.actionDelayMs = 5;
const one = await fresh2.gh.commit('private', [{ path: 'README.md', content: '# desk\n' }], 'Only a README');
check('empty repository: a single file is one commit', fake.repo('NietZteiN/desk').log().length === 1 && one.commit === fake.repo('NietZteiN/desk').head);
// Should GitHub answer 404 instead of 409 for the branch of an empty repository, it still works.
fake.reset();
fake.actionDelayMs = 5;
const fresh3 = mk(TOKENS.full, 'desk');
fake.failNext('GET /repos/NietZteiN/desk/git/ref', { status: 404, body: { message: 'Not Found' } });
await fresh3.gh.commit('private', [{ path: 'README.md', content: '# desk\n' }, { path: 'a/b.md', content: 'b\n' }], 'Start');
check('empty repository: a 404 for the branch is handled like the 409', fake.repo('NietZteiN/desk').files().join(',') === 'README.md,a/b.md');
fake.failNext('POST /repos/NietZteiN/desk-ready/git/blobs', { status: 404, body: { message: 'Not Found' } });
check('probeWrite: a 404 is "cannot tell yet", not a refusal', (await fresh3.gh.probeWrite('private').catch((e) => e.name)) !== 'NotFound' && (await mk(TOKENS.full).gh.probeWrite('private')) === 'empty');
fake.reset();
fake.actionDelayMs = 5;

// ---- the public site: nothing without a ticket ------------------------------
const FIXTURE = '---\ntitle: Test fixture (not a post)\ndate: 2099-01-01\n---\n\nfixture\n';
const POST = 'blog/posts/2099-01-01-fixture.md';
let siteWrites = writesTo('NietZteiN/nietztein.github.io');
n0 = sent();
const noTicket = await rejects(gh.write('site', POST, FIXTURE, { message: 'x' }));
check('site write without a ticket: refused, and no request is sent', is(noTicket, E.PublishNotConfirmed) && sent() === n0 && siteRepo().text(POST) === null);
const forged = await rejects(gh.write('site', POST, FIXTURE, { ticket: { id: 1, paths: [POST], expires: Date.now() + 60000 } }));
check('site write with a made-up ticket object: refused', is(forged, E.PublishNotConfirmed) && sent() === n0);
check('site write with ticket: true: refused', is(await rejects(gh.write('site', POST, FIXTURE, { ticket: true })), E.PublishNotConfirmed) && sent() === n0);
const otherPath = issue({ paths: ['blog/posts/other.md'] });
const wrongPath = await rejects(gh.write('site', POST, FIXTURE, { ticket: otherPath }));
check('site write with a ticket for another path: refused', is(wrongPath, E.PublishNotConfirmed) && /does not cover/.test(wrongPath.message) && sent() === n0);
check('site remove without a ticket: refused, no request', is(await rejects(gh.remove('site', 'blog/README.md')), E.PublishNotConfirmed) && sent() === n0);
check('site commit without a ticket: refused, no request', is(await rejects(gh.commit('site', [{ path: POST, content: FIXTURE }], 'x')), E.PublishNotConfirmed) && sent() === n0);
const partial = issue({ paths: [POST] });
check('site commit with a ticket that misses one path: refused, no request', is(await rejects(gh.commit('site', [{ path: POST, content: FIXTURE }, { path: 'assets/img/blog/x.png', bytes: all }], 'x', { ticket: partial })), E.PublishNotConfirmed) && sent() === n0);
check('site: still untouched after all refusals', writesTo('NietZteiN/nietztein.github.io') === siteWrites && siteRepo().log().length === 1);

const good = issue({ paths: [POST] });
check('ticket: frozen, lists its paths, expires within two minutes', Object.isFrozen(good) && good.paths[0] === POST && good.expires - Date.now() <= 120000 && good.expires > Date.now());
const pub = await gh.write('site', POST, FIXTURE, { message: 'Publish fixture', ticket: good });
check('site write with the right ticket: goes through', siteRepo().text(POST) === FIXTURE && !!pub.commit);
check('ticket: spent after one successful use', is(await rejects(gh.write('site', POST, 'again', { ticket: good, sha: pub.sha })), E.PublishNotConfirmed) && siteRepo().text(POST) === FIXTURE);
await fake.settle();
const idx = JSON.parse(siteRepo().text('blog/index.json'));
check('fake Action: the index was rebuilt after the push', idx.length === 3 && idx[0].slug === 'fixture' && siteRepo().log()[0].author === 'github-actions[bot]');
check('fake Action: a workflow run and a Pages build were recorded', fake.runs[0].name === 'pages build and deployment' && fake.runs.some((r) => r.display_title === 'Publish fixture') && fake.pagesBuilds.length === 2);

// A ticket survives a failed attempt (the owner should not have to confirm twice for a hiccup).
const retry = issue({ paths: [POST] });
fake.failNext('PUT /repos/NietZteiN/nietztein.github.io/contents', { status: 502, body: { message: 'Bad gateway' } });
const hiccup = await rejects(gh.write('site', POST, 'v2\n', { ticket: retry, sha: pub.sha }));
const second = await gh.write('site', POST, 'v2\n', { ticket: retry, sha: pub.sha, message: 'Second try' });
check('ticket: a failed write does not spend it', is(hiccup, E.GitHubError) && hiccup.status === 502 && siteRepo().text(POST) === 'v2\n' && !!second.sha);

// An expired ticket.
const old = issue({ paths: [POST] });
const realNow = Date.now;
Date.now = () => realNow() + 121000;
const expired = await rejects(gh.write('site', POST, 'late', { ticket: old, sha: second.sha }));
Date.now = realNow;
check('ticket: refused after two minutes', is(expired, E.PublishNotConfirmed) && /two minutes/.test(expired.message) && siteRepo().text(POST) === 'v2\n');

// commit() and remove() on the site with proper tickets.
const multi = issue({ paths: ['assets/img/blog/fixture.bin', { path: POST }] });
await gh.commit('site', [{ path: 'assets/img/blog/fixture.bin', bytes: all }, { path: POST, content: 'v3\n', sha: second.sha }], 'Two files', { ticket: multi });
const twoFiles = siteRepo().log().filter((c) => c.message === 'Two files');
check('site commit with a ticket covering every path: one commit', twoFiles.length === 1 && twoFiles[0].files.length === 2 && siteRepo().text(POST) === 'v3\n' && Buffer.from(all).equals(siteRepo().bytes('assets/img/blog/fixture.bin')));
await fake.settle();
await gh.remove('site', POST, { ticket: issue({ paths: [POST] }), message: 'Unpublish fixture' });
check('site remove with a ticket', siteRepo().text(POST) === null);
check('private writes never needed a ticket', ready().log().length >= 1 && true);

// A ticket made by one client is worthless to another.
const otherClient = mk(TOKENS.full);
check('ticket: only the client that issued it accepts it', is(await rejects(otherClient.gh.write('site', POST, 'x', { ticket: issue({ paths: [POST] }) })), E.PublishNotConfirmed));

// GraphQL: reads are free, mutations need a ticket.
const disc = await gh.graphql('query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { discussions(first: 10) { totalCount nodes { title comments(first: 20) { totalCount nodes { body author { login } } } } } } }', { owner: SITE.owner, name: SITE.repo });
check('graphql(): the canned discussions', disc.repository.discussions.totalCount === 2 && disc.repository.discussions.nodes[0].title === 'latentland' && disc.repository.discussions.nodes[0].comments.nodes.length === 2);
n0 = sent();
const mut = await rejects(gh.graphql('mutation { addDiscussionComment(input: { discussionId: "D_1", body: "x" }) { comment { id } } }'));
check('graphql(): a mutation without a ticket is refused, no request', is(mut, E.PublishNotConfirmed) && sent() === n0);
const mut2 = await rejects(gh.graphql('# a comment\n  mutation Reply { x }', {}));
check('graphql(): a mutation behind a comment is still seen', is(mut2, E.PublishNotConfirmed) && sent() === n0);
check('graphql(): the word "mutation" inside a string does not count', !!(await gh.graphql('query { repository(owner: "NietZteiN", name: "nietztein.github.io") { discussions(first: 1) { totalCount } } } # mutation', { note: 'mutation' })).repository);
// GraphQL ignores commas, the byte-order mark and \r-ended comments like whitespace;
// whatever is not plainly a query or a fragment needs a ticket (fail closed).
const sneaky = [
	',mutation { addDiscussionComment(input:{discussionId:"D", body:"x"}) { clientMutationId } }',
	',mutation($i:CreateCommitOnBranchInput!){ createCommitOnBranch(input:$i){ commit { oid } } }',
	',,, \t,mutation{x}',
	String.fromCharCode(0xfeff) + 'mutation{x}',
	'# comment ended by a carriage return\rmutation { x }',
	'query { a } mutation { b }',
	'query Q { a },mutation { b }',
	'fragment F on User { login }\nmutation { x }',
	'{ a } subscription { b }',
	'"""described""" mutation { x }',
	'"desc" mutation { x }',
	'Mutation { x }',
	'query { a(x: "unterminated) } mutation { b }',
	'query { a } }mutation { b }',
	'query { a(x: {y: 1}) { b } } mutation { c }',
	'',
];
n0 = sent();
let sneakyOk = 0;
for (const q of sneaky) {
	const r = await rejects(gh.graphql(q, { i: {} }));
	if (is(r, E.PublishNotConfirmed)) sneakyOk++;
	else console.log('  not refused: ' + JSON.stringify(q));
}
check('graphql(): comma, BOM, \\r comment, mixed and unknown documents all need a ticket, nothing sent', sneakyOk === sneaky.length && sent() === n0, sneakyOk + '/' + sneaky.length);
const legit = [
	'{ viewer { login } }',
	'query mutation { viewer { login } }',
	'query Q($a: Int = 1, $b: [String!] = ["mutation", "x"]) @dir(x: {y: "}"}) { viewer { login } }\nfragment F on User { login }',
	// The queries the Desk itself sends: the Stats view's comments, the wizard's Discussions check.
	(() => {
		const src = fs.readFileSync(path.join(repoRoot, 'desk/views/stats.js'), 'utf8');
		const m = /var COMMENTS_QUERY = \[([\s\S]*?)\]\.join/.exec(src);
		return m ? eval('[' + m[1] + ']').join('\n') : 'mutation { stats query not found }';
	})(),
	(() => {
		const m = /client\.graphql\('([^']+)'/.exec(fs.readFileSync(path.join(repoRoot, 'desk/desk.js'), 'utf8'));
		return m ? m[1] : 'mutation { wizard query not found }';
	})(),
	'query { a(text: """ block with "quotes" and \\""" and mutation{ } """) { b } } # mutation { }',
];
let legitOk = 0;
for (const q of legit) {
	const r = await rejects(gh.graphql(q, {}));
	if (!is(r, E.PublishNotConfirmed)) legitOk++;
	else console.log('  wrongly refused: ' + JSON.stringify(q));
}
check('graphql(): plain queries, fragments, defaults, block strings and a query named "mutation" need no ticket', legitOk === legit.length, legitOk + '/' + legit.length);
check('graphql(): a ticket for that very document lets the mutation through to GitHub', !is(await rejects(gh.graphql(',mutation { x }', {}, { ticket: issue({ graphql: ',mutation { x }' }) })), E.PublishNotConfirmed));
// A ticket is bound to what it was issued for.
n0 = sent();
const STAR = 'mutation { addStar(input:{starrableId:"X"}) { clientMutationId } }';
const pathTicket = issue({ paths: ['blog/posts/2026-10-05-x.md'] });
check('graphql(): a ticket for post paths does not unlock a mutation, nothing sent', is(await rejects(gh.graphql(STAR, {}, { ticket: pathTicket })), E.PublishNotConfirmed) && sent() === n0);
check('graphql(): a ticket for another mutation does not unlock this one, nothing sent', is(await rejects(gh.graphql(STAR, {}, { ticket: issue({ graphql: 'mutation { x }' }) })), E.PublishNotConfirmed) && sent() === n0);
const gqlTicket = issue({ graphql: STAR });
check('ticket: a GraphQL ticket does not cover a file write on the site, nothing sent', is(await rejects(gh.write('site', 'blog/posts/2026-10-05-x.md', 'x', { ticket: gqlTicket })), E.PublishNotConfirmed) && is(await rejects(gh.commit('site', [{ path: 'blog/posts/2026-10-05-x.md', content: 'x' }], 'x', { ticket: gqlTicket })), E.PublishNotConfirmed) && sent() === n0);
check('ticket: issuing one for an empty GraphQL document throws', (() => { try { issue({ graphql: '' }); return false; } catch (e) { return true; } })());
// GraphQL never goes by GET, whatever the spelling.
let getGql = 0;
for (const p of ['/graphql', '/GraphQL', '/graphql/', '/%67raphql']) {
	if (is(await rejects(gh.get(p, { query: STAR })), E.PublishNotConfirmed)) getGql++;
	else console.log('  GET not refused: ' + p);
}
check('get(): /graphql (any case or escape) is refused, nothing sent', getGql === 4 && sent() === n0, getGql + '/4');
check('get(): a path with a dot segment is refused, nothing sent', is(await rejects(gh.get('/repos/x/../../graphql', { query: STAR })), E.PublishNotConfirmed) && sent() === n0);
check('graphql(): a query for something that is not there is NotFound', is(await rejects(gh.graphql('query { repository(owner: "nobody", name: "nothing") { id } }')), E.NotFound));

// ---- other REST reads ---------------------------------------------------------
const runs = await gh.get(gh.repoPath('site', '/actions/runs'), { per_page: 2 });
check('get(): Actions runs', runs.workflow_runs.length === 2 && runs.total_count >= 3);
const pages = await gh.get(gh.repoPath('site', '/pages'));
check('get(): the Pages site', pages.status === 'built' && pages.source.branch === 'main');
check('get(): Pages builds and deployments', (await gh.get(gh.repoPath('site', '/pages/builds'))).length >= 1 && (await gh.get(gh.repoPath('site', '/deployments'))).length >= 1);
const history = await gh.get(gh.repoPath('site', '/commits'), { path: 'blog/posts', per_page: 5 });
check('get(): commits that touched a folder', history.length >= 3 && history.every((c) => c.sha && c.commit.message));
n0 = sent();
check('get(): a full URL is refused (the token goes to the API only)', is(await rejects(gh.get('https://example.com/steal')), E.GitHubError) && is(await rejects(gh.get('//example.com/steal')), E.GitHubError) && is(await rejects(gh.get('/user?x=1')), E.GitHubError) && sent() === n0);
check('get(): 404 is NotFound', is(await rejects(gh.get('/repos/NietZteiN/nietztein.github.io/nope')), E.NotFound));

// ---- probing write access ------------------------------------------------------
commits = siteRepo().log().length;
n0 = sent();
check('probeWrite(site) on a view client: refused, nothing sent', is(await rejects(gh.probeWrite('site')), E.PublishNotConfirmed) && sent() === n0);
const wizardClient = mk(TOKENS.full, 'desk-ready', { probeSite: true });
check('probeWrite(site) on the wizard client: true, and no commit is made', (await wizardClient.gh.probeWrite('site')) === true && siteRepo().log().length === commits);
check('probeWrite(private) needs no such option', (await gh.probeWrite('private')) === true);

// ---- permissions ---------------------------------------------------------------
const ro = mk(TOKENS.readonly);
check('read-only token: reading works', (await ro.gh.read('private', 'README.md')) !== null);
const roWrite = await rejects(ro.gh.write('private', 'notes/x.md', 'x'));
check('read-only token: write is Forbidden and names the permission', is(roWrite, E.Forbidden) && roWrite.permission === 'Contents: read and write' && /Contents: read and write/.test(roWrite.message) && /NietZteiN\/desk-ready/.test(roWrite.message) && roWrite.status === 403);
check('read-only token: probeWrite is Forbidden', is(await rejects(mk(TOKENS.readonly, 'desk-ready', { probeSite: true }).gh.probeWrite('site')), E.Forbidden));
check('read-only token: commit is Forbidden', is(await rejects(ro.gh.commit('private', [{ path: 'a.md', content: 'a' }], 'x')), E.Forbidden));
const ne = mk(TOKENS.noextras);
const neRuns = await rejects(ne.gh.get(ne.gh.repoPath('site', '/actions/runs')));
check('token without Actions: Forbidden, "Actions: read"', is(neRuns, E.Forbidden) && neRuns.permission === 'Actions: read');
const nePages = await rejects(ne.gh.get(ne.gh.repoPath('site', '/pages')));
check('token without Pages: Forbidden, "Pages: read"', is(nePages, E.Forbidden) && nePages.permission === 'Pages: read');
const neDisc = await rejects(ne.gh.graphql('query { repository(owner: "NietZteiN", name: "nietztein.github.io") { discussions(first: 1) { totalCount } } }'));
check('token without Discussions: Forbidden, "Discussions: read"', is(neDisc, E.Forbidden) && neDisc.permission === 'Discussions: read');
check('token without the extras: contents still work', (await ne.gh.write('private', 'notes/ne.md', 'ok\n')).sha.length === 40);
const nd = mk(TOKENS.nodesk);
const ndRepo = await rejects(nd.gh.repo('private'));
check('token without the private repository: NotFound, and the message says why that can be', is(ndRepo, E.NotFound) && /not given access/.test(ndRepo.message));
check('token without the private repository: the public site still reads', (await nd.gh.repo('site')).canPush === true);
const st = mk(TOKENS.stranger);
check('another user: can see the site but cannot push', (await st.gh.repo('site')).canPush === false && (await st.gh.user()).login === 'someone-else');
check('another user: the owner\'s private repository is NotFound', is(await rejects(st.gh.repo('private')), E.NotFound));

// ---- 401 -----------------------------------------------------------------------
const ex = mk(TOKENS.expired);
const e401 = await rejects(ex.gh.user());
check('expired token: Unauthorized, and the frame is told', is(e401, E.Unauthorized) && e401.status === 401 && ex.state.unauthorized === 1);
const notFake = mk('github_pat_' + 'A'.repeat(22) + '_' + 'B'.repeat(59));
check('a token of the real shape: the fake refuses it', is(await rejects(notFake.gh.user()), E.Unauthorized));
const locked = mk('');
n0 = sent();
check('no token in memory: Locked, no request', is(await rejects(locked.gh.user()), E.Locked) && sent() === n0);

// ---- rate limits ----------------------------------------------------------------
fake.setRate(0, 900);
const limited = await rejects(gh.read('site', 'blog/README.md'));
check('rate limit: RateLimited with the reset time', is(limited, E.RateLimited) && limited.resetAt instanceof Date && Math.abs(limited.resetAt - Date.now() - 900000) < 5000);
check('rate limit: rate() still answers', (await gh.rate()).remaining === 0);
fake.setRate(4000);
fake.failNext('GET /user', { status: 429, body: { message: 'You have exceeded a secondary rate limit.' }, headers: { 'Retry-After': '30' } });
const secondary = await rejects(gh.user());
check('secondary rate limit (429 + Retry-After): RateLimited, about 30 s', is(secondary, E.RateLimited) && Math.abs(secondary.resetAt - Date.now() - 30000) < 5000);
fake.failNext('GET /user', { status: 500, body: { message: 'boom' } });
const e500 = await rejects(gh.user());
check('a 500: GitHubError that says it is GitHub\'s problem', is(e500, E.GitHubError) && e500.status === 500 && /problem of its own/.test(e500.message));

// ---- offline ---------------------------------------------------------------------
fake.setDown(true);
const off = await rejects(gh.read('private', 'README.md'));
const offWrite = await rejects(gh.write('private', 'notes/offline.md', 'x'));
fake.setDown(false);
check('network gone: Offline for a read and for a write', is(off, E.Offline) && is(offWrite, E.Offline) && ready().text('notes/offline.md') === null);
check('back online: works again', (await gh.read('private', 'README.md')) !== null);
check('activity: back to zero after errors too', state.busy[state.busy.length - 1] === 0);

// ---- more ways to dress up a mutation (desk-fix2) ----------------------------------
// Whitespace GraphQL knows and does not know, comments, fragments, aliases, case
// and look-alike letters. Everything that is (or might be) a mutation needs a ticket.
const ch = (c) => String.fromCharCode(c);
const dressed = [
	'\n\n\t mutation { x }',
	'\r\nmutation { x }',
	ch(0x0b) + 'mutation { x }', // vertical tab: not GraphQL whitespace
	ch(0x0c) + 'mutation { x }', // form feed
	ch(0xa0) + 'mutation { x }', // no-break space
	ch(0x2028) + 'mutation { x }', // line separator
	ch(0x3000) + 'mutation { x }', // ideographic space
	ch(0x200b) + 'mutation { x }', // zero-width space
	'#' + ch(0x2028) + 'mutation { x }', // U+2028 does not end a comment: an empty document
	'# a\n# b\r\n#c\r,\n,mutation { x }',
	'query { a } # } \n mutation { b }',
	'fragment F on Mutation { x }\nmutation { ...F }',
	'fragment F on Query { viewer { login } } mutation M { ...F }',
	'query { mutation: viewer { login } } mutation { alias: addStar(input: {starrableId: "x"}) { clientMutationId } }',
	'MUTATION { x }',
	'mutatioN { x }',
	ch(0xff4d) + 'utation { x }', // fullwidth m
	ch(0x43c) + 'utation { x }', // Cyrillic em
	'mutation' + ch(0x200b) + ' { x }',
	'query { a(x: "\\"") } mutation { b }',
	'query { a(x: """ \\""" """) } mutation { b }',
	'query { a(x: "a\\\\") } mutation { b }',
	'query @d(x: "}") { a } mutation { b }',
	'query ($v: Int = 1) { a } mutation { b }',
	'query { a } , , mutation { b }',
	'{ a }mutation{ b }',
	'query { a ',
	'query',
	'}{ mutation { x }',
	') mutation { x }',
	'subscription { x }',
	'mutation',
	'x'.repeat(70) + ' mutation { x }',
	'query' + 'x'.repeat(70) + ' { a } mutation { b }',
];
n0 = sent();
let dressedOk = 0;
for (const q of dressed) {
	const r = await rejects(gh.graphql(q, {}));
	if (is(r, E.PublishNotConfirmed)) dressedOk++;
	else console.log('  not refused: ' + JSON.stringify(q));
}
check('graphql(): whitespace, comments, fragments, aliases, case and look-alike letters: all need a ticket, nothing sent', dressedOk === dressed.length && sent() === n0, dressedOk + '/' + dressed.length);
// The same string checked is the string sent: an object whose toString changes gets nowhere.
let flips = 0;
const shifty = { toString: () => (flips++ === 0 ? '{ viewer { login } }' : 'mutation { x }') };
n0 = sent();
const shiftyRes = await rejects(gh.graphql(shifty, {}));
const shiftyBody = fake.requests.slice(n0).map((r) => r.body && r.body.query).filter(Boolean);
check('graphql(): a query object is read once (what is checked is what is sent)', !shiftyBody.some((q) => /mutation/.test(q)) && flips === 1, JSON.stringify({ flips, shiftyBody, res: shiftyRes && shiftyRes.name }));
check('graphql(): an array holding a mutation is refused', is(await rejects(gh.graphql(['mutation { x }'], {})), E.PublishNotConfirmed));
const legit2 = ['{ mutation: viewer { login } }', 'query { a(x: "# not a comment, mutation { }") }', 'query Q { ...F } fragment F on Query { viewer { login } }'];
let legit2Ok = 0;
for (const q of legit2) if (!is(await rejects(gh.graphql(q, {})), E.PublishNotConfirmed)) legit2Ok++;
check('graphql(): an alias named "mutation", a "#" in a string and a fragment after the query need no ticket', legit2Ok === legit2.length, legit2Ok + '/' + legit2.length);

// The last gate under every caller: a client whose "private" repository is the
// site (by any spelling) writes nothing anywhere without a ticket.
for (const spelling of [SITE.repo, SITE.repo.toUpperCase()]) {
	const twin = GH.create({ apiBase: fake.url, token: () => TOKENS.full, site: SITE, priv: { owner: SITE.owner.toLowerCase(), repo: spelling, branch: 'main' } }).client;
	n0 = sent();
	const w = await rejects(twin.write('private', 'blog/posts/2099-01-02-twin.md', 'x'));
	const c = await rejects(twin.commit('private', [{ path: 'blog/posts/2099-01-02-twin.md', content: 'x' }], 'x'));
	const p = await rejects(twin.probeWrite('private'));
	check('a "private" repository that is the site (' + spelling + '): write, commit and probe refused, nothing sent', is(w, E.PublishNotConfirmed) && is(c, E.PublishNotConfirmed) && is(p, E.PublishNotConfirmed) && sent() === n0);
}

// ---- lost answers (desk-fix2) ----------------------------------------------------
// The request reaches GitHub and the change is made, but the answer never arrives.
// The client asks GitHub what is there now and treats "exactly what I sent" as done.
function lossy(rule) {
	const st = { dropped: 0, blocked: 0, rule };
	const made = mk(TOKENS.full, 'desk-ready', {
		retryMs: 0,
		fetch: (url, init) => {
			const method = (init && init.method) || 'GET';
			const r = st.rule(method, String(url), st);
			if (r === 'block') {
				st.blocked++;
				return Promise.reject(new TypeError('Failed to fetch'));
			}
			const p = fetch(url, init);
			if (r === 'drop') {
				st.dropped++;
				return p.then((res) => res.text()).then(() => {
					throw new TypeError('Failed to fetch');
				});
			}
			return p;
		},
	});
	return { ...made, st };
}
await fake.settle();
// write(): the PUT lands, its answer is lost.
let L = lossy((m, u, st) => (m === 'PUT' && !st.dropped ? 'drop' : 'pass'));
const lostW = await L.gh.write('private', 'notes/lost-put.md', 'arrived\n');
check('write(): answer lost after the PUT landed: resolved as done, with the right sha', lostW.reconciled === true && lostW.sha === (await gh.blobSha('arrived\n')) && ready().text('notes/lost-put.md') === 'arrived\n' && L.st.dropped === 1);
check('write(): ...and the next write with that sha works (no conflict)', !!(await L.gh.write('private', 'notes/lost-put.md', 'next\n', { sha: lostW.sha })).sha && ready().text('notes/lost-put.md') === 'next\n');
// write(): the PUT never left: the original Offline, nothing written.
L = lossy((m) => (m === 'PUT' ? 'block' : 'pass'));
const neverW = await rejects(L.gh.write('private', 'notes/never.md', 'x'));
check('write(): the PUT never left: Offline, not "done", nothing written', is(neverW, E.Offline) && !neverW.maybeCommitted && ready().text('notes/never.md') === null);
// write() to the site with a ticket, answer lost: done, and the ticket is spent.
const SITE_LOST = 'blog/posts/2099-01-03-lost.md';
L = lossy((m, u, st) => (m === 'PUT' && !st.dropped ? 'drop' : 'pass'));
const tLost = L.issue({ paths: [SITE_LOST] });
const lostSite = await L.gh.write('site', SITE_LOST, FIXTURE, { ticket: tLost });
check('site write(): answer lost: done, one commit, ticket spent', lostSite.reconciled === true && siteRepo().text(SITE_LOST) === FIXTURE && siteRepo().log().filter((c) => c.message === 'Add ' + SITE_LOST).length === 1 && is(await rejects(L.gh.write('site', SITE_LOST, 'again', { ticket: tLost, sha: lostSite.sha })), E.PublishNotConfirmed));
// write() to the site, PUT never left: Offline, the ticket still works for the retry.
L = lossy((m, u, st) => (m === 'PUT' && !st.blocked ? 'block' : 'pass'));
const tRetry = L.issue({ paths: [SITE_LOST] });
const notSent = await rejects(L.gh.write('site', SITE_LOST, FIXTURE + 'v2\n', { ticket: tRetry, sha: lostSite.sha }));
const retried = await L.gh.write('site', SITE_LOST, FIXTURE + 'v2\n', { ticket: tRetry, sha: lostSite.sha });
check('site write(): never sent: Offline, and the same ticket works for the retry', is(notSent, E.Offline) && !!retried.sha && siteRepo().text(SITE_LOST) === FIXTURE + 'v2\n');
await fake.settle();
// remove(): the DELETE lands, its answer is lost.
L = lossy((m, u, st) => (m === 'DELETE' && !st.dropped ? 'drop' : 'pass'));
const lostD = await L.gh.remove('site', SITE_LOST, { ticket: L.issue({ paths: [SITE_LOST] }) });
check('remove(): answer lost after the DELETE landed: done', lostD.reconciled === true && siteRepo().text(SITE_LOST) === null);
await fake.settle();
// commit(): the PATCH of the branch lands, its answer is lost (the reviewer's case).
const SITE_C = 'blog/posts/2099-01-04-lost-commit.md';
L = lossy((m, u, st) => (m === 'PATCH' && !st.dropped ? 'drop' : 'pass'));
let lcBefore = siteRepo().log().length;
const lostC = await L.gh.commit('site', [{ path: SITE_C, content: FIXTURE, sha: null }], 'Publish lost commit', { ticket: L.issue({ paths: [SITE_C] }) });
check('commit(): answer to the branch update lost: done, one commit', !!lostC.commit && siteRepo().text(SITE_C) === FIXTURE && siteRepo().log().filter((c) => c.message === 'Publish lost commit').length === 1 && siteRepo().log().length - lcBefore <= 2 && L.st.dropped === 1, JSON.stringify({ c: lostC.commit, n: siteRepo().log().length - lcBefore, d: L.st.dropped, msgs: siteRepo().log().slice(0, 3).map((c) => c.message) }));
await fake.settle();
// commit(): answer lost, and GitHub stays out of reach afterwards: says it may be live.
L = lossy((m, u, st) => (m === 'PATCH' && !st.dropped ? 'drop' : st.dropped ? 'block' : 'pass'));
const maybe = await rejects(L.gh.commit('site', [{ path: SITE_C, content: FIXTURE + 'v2\n' }], 'Maybe live', { ticket: L.issue({ paths: [SITE_C] }) }));
check('commit(): answer lost and GitHub unreachable after: Offline with maybeCommitted, plain words', is(maybe, E.Offline) && !!maybe.maybeCommitted && /may already be live/.test(maybe.message) && L.st.blocked === 3);
await fake.settle();
// commit(): the PATCH never left: Offline without maybeCommitted, branch unchanged.
L = lossy((m) => (m === 'PATCH' ? 'block' : 'pass'));
lcBefore = siteRepo().log().length;
const neverC = await rejects(L.gh.commit('site', [{ path: SITE_C, content: 'never\n' }], 'Never', { ticket: L.issue({ paths: [SITE_C] }) }));
check('commit(): the branch update never left: Offline, not maybeCommitted, nothing committed', is(neverC, E.Offline) && !neverC.maybeCommitted && siteRepo().log().length === lcBefore && siteRepo().text(SITE_C) !== 'never\n');

// ---- nothing leaks ---------------------------------------------------------------
const leaky = seenErrors.filter((e) => e && !e.resolved && /github_pat|Bearer/.test(String(e.message) + String(e.stack) + JSON.stringify(e)));
check(`no error (${seenErrors.length} seen) mentions the token`, leaky.length === 0, leaky.map((e) => e.message).join(' | '));
check('no request URL carries the token', fake.requests.every((r) => !/github_pat|FAKE/.test(r.path)));
check('blobSha(): the well-known ids', (await gh.blobSha('')) === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' && (await gh.blobSha('hello\n')) === 'ce013625030ba8dba906f756967f9e9ca394464a');

await fake.close();
const refused = await rejects(gh.user());
check('server gone (connection refused): Offline', is(refused, E.Offline));

console.log(`${count - failed} of ${count} passed`);
process.exit(failed ? 1 : 0);
