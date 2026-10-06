// A local fake of the GitHub API, for testing the Desk without GitHub.
//
// It keeps a few repositories in memory and answers the calls desk/gh.js makes
// the way api.github.com does: status codes, sha rules, rate-limit headers and
// CORS headers included. Nothing is written to disk and nothing leaves the machine.
//
// IT MUST NEVER SEE A REAL TOKEN. It accepts only the made-up tokens in TOKENS
// below (they all start with "github_pat_FAKE_"); anything else gets 401, and
// no Authorization header is ever stored or logged.
//
// In a test (Node, or a scripts/qa/drive.mjs script):
//   import { startFakeGitHub, TOKENS } from '<repo>/desk/test/fake-github.mjs';
//   const fake = await startFakeGitHub();           // { url: 'http://127.0.0.1:<port>', ... }
//   ... open  <site>/desk/?api=<fake.url>  and sign in with TOKENS.full ...
//   fake.repo('NietZteiN/desk').text('notes/inbox/x.md')    what the Desk wrote
//   await fake.close();
// By hand:
//   node desk/test/fake-github.mjs [--port 8787]
//   node scripts/serve.mjs                 (in another terminal; prints the site's address)
//   then open  <site address>desk/?api=http://127.0.0.1:8787
//
// Repositories (owner/name):
//   NietZteiN/nietztein.github.io   public; seeded from real files of this repo (see SEED)
//   NietZteiN/desk                  private and EMPTY, as GitHub creates it (no commit yet)
//   NietZteiN/desk-ready            private, with the Desk layout already in it (a second device)
//   NietZteiN/desk-public           PUBLIC (the wizard must refuse it)
//   someone-else/desk               private, belongs to the other user
//
// Tokens (TOKENS.<name>):
//   full        the owner, everything granted
//   readonly    the owner, Contents read-only (every write answers 403)
//   noextras    the owner, Contents write, but no Actions, Pages or Discussions
//   nodesk      the owner, but the private repositories were not selected (they answer 404)
//   stranger    another user (someone-else): can read the public site, cannot push to it
//   expired     answers 401 "Bad credentials"
//
// What the returned object offers:
//   url, port, close()
//   repo('owner/name')          -> Repo: files(), text(path), bytes(path), put(path, content, message),
//                                  remove(path, message), head, log(), isEmpty
//   requests                    every API request so far: { method, path, status, user } (no headers)
//   setDown(true|false)         drop every connection, as if the network were gone
//   setRate(remaining)          set the remaining request budget (0 = rate limited until reset)
//   failNext(test, response)    the next request whose "METHOD /path" matches `test` (string or RegExp)
//                               gets `response` ({ status, body, headers }) instead of the real answer
//   actionDelayMs               how long the pretend GitHub Action takes to rebuild blog/index.json (default 30)
//   settle()                    resolves when no pretend Action is pending
//   reset()                     back to the initial repositories
//
// Differences from the real thing, on purpose or by omission:
//   - A fine-grained token can read Actions (and discussions) of a PUBLIC repository
//     without that permission. Here a token without it gets 403, so the "permission
//     missing" path can be tested.
//   - GraphQL is not executed. Queries get a fixed, generous answer: every field a
//     Desk view may ask for is present, aliases and arguments are ignored.
//   - Tree and commit ids are made up (blob ids are real git blob hashes).
//   - No pagination: lists are short and returned whole (per_page is honoured, page is not).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

export const SITE = { owner: 'NietZteiN', repo: 'nietztein.github.io', branch: 'main' };

export const TOKENS = {
	full: 'github_pat_FAKE_owner_full',
	readonly: 'github_pat_FAKE_owner_readonly',
	noextras: 'github_pat_FAKE_owner_noextras',
	nodesk: 'github_pat_FAKE_owner_nodesk',
	stranger: 'github_pat_FAKE_stranger',
	expired: 'github_pat_FAKE_expired',
};

const GRANTS = {
	[TOKENS.full]: { user: 'NietZteiN', contents: 'write', actions: true, pages: true, discussions: true, privateRepos: true },
	[TOKENS.readonly]: { user: 'NietZteiN', contents: 'read', actions: true, pages: true, discussions: true, privateRepos: true },
	[TOKENS.noextras]: { user: 'NietZteiN', contents: 'write', actions: false, pages: false, discussions: false, privateRepos: true },
	[TOKENS.nodesk]: { user: 'NietZteiN', contents: 'write', actions: true, pages: true, discussions: true, privateRepos: false },
	[TOKENS.stranger]: { user: 'someone-else', contents: 'write', actions: true, pages: true, discussions: true, privateRepos: true },
};

const USERS = {
	NietZteiN: { login: 'NietZteiN', id: 1001, name: 'Jack V. Le', avatar_url: '', html_url: 'https://github.com/NietZteiN', type: 'User' },
	'someone-else': { login: 'someone-else', id: 2002, name: 'Someone Else', avatar_url: '', html_url: 'https://github.com/someone-else', type: 'User' },
};

// Real files of this repository that the fake public site starts with.
const SEED = [
	'blog/index.json',
	'blog/README.md',
	'blog/posts/2026-09-23-benchmarks-we-actually-need.md',
	'blog/posts/2026-09-21-latentland.md',
	'assets/js/config.json',
	'assets/data/publications.json',
	'misc/toys.json',
];

// What GitHub sends (checked against api.github.com on 2026-10-05). Note what
// is NOT exposed to a browser: X-Accepted-GitHub-Permissions and the token's
// expiry header. The Desk cannot rely on either.
const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Expose-Headers': 'ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset',
};
const PREFLIGHT = {
	'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, Accept-Encoding, X-GitHub-OTP, X-Requested-With, User-Agent, GraphQL-Features, X-Github-Next-Global-ID, X-GitHub-Api-Version',
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE',
	'Access-Control-Max-Age': '86400',
};

function sha1(...parts) {
	const h = crypto.createHash('sha1');
	for (const p of parts) h.update(p);
	return h.digest('hex');
}

// The id git itself gives a blob.
export function blobSha(buf) {
	return sha1(`blob ${buf.length}\0`, buf);
}

function wrap60(b64) {
	return b64.replace(/(.{60})/g, '$1\n') + (b64.length % 60 ? '\n' : '');
}

class HttpError extends Error {
	constructor(status, message, extra = {}) {
		super(message);
		this.status = status;
		this.extra = extra;
	}
}

// ---- one repository ---------------------------------------------------------

export class Repo {
	constructor({ owner, name, isPrivate, branch = 'main', description = '' }) {
		this.owner = owner;
		this.name = name;
		this.full = `${owner}/${name}`;
		this.private = isPrivate;
		this.branch = branch;
		this.description = description;
		this.blobs = new Map(); // sha -> Buffer
		this.trees = new Map(); // sha -> Map(path -> blob sha)
		this.commits = new Map(); // sha -> { sha, tree, parents, message, date, author }
		this.head = null; // commit sha, null while the repository is empty
		this.pushedAt = new Date('2026-10-01T12:00:00Z').toISOString();
		this._n = 0;
	}

	get isEmpty() {
		return this.head === null;
	}

	_tree() {
		return this.head ? this.trees.get(this.commits.get(this.head).tree) : new Map();
	}

	addBlob(buf) {
		const sha = blobSha(buf);
		this.blobs.set(sha, buf);
		return sha;
	}

	addTree(map) {
		const lines = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, s]) => `${p}\0${s}\n`);
		const sha = sha1('tree\0', lines.join(''));
		this.trees.set(sha, new Map(map));
		return sha;
	}

	addCommit({ tree, parents, message, author = 'NietZteiN', date }) {
		const when = date || new Date().toISOString();
		const sha = sha1('commit\0', JSON.stringify([tree, parents, message, when, this.full, this._n++]));
		this.commits.set(sha, { sha, tree, parents, message, date: when, author });
		return sha;
	}

	// One commit that applies `changes` ({ path: Buffer | string | null }) to the head.
	commit(changes, message, author = 'NietZteiN') {
		const map = new Map(this._tree());
		for (const [p, content] of Object.entries(changes)) {
			if (content === null) map.delete(p);
			else map.set(p, this.addBlob(Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')));
		}
		const sha = this.addCommit({ tree: this.addTree(map), parents: this.head ? [this.head] : [], message, author });
		this.head = sha;
		this.pushedAt = new Date().toISOString();
		return sha;
	}

	// Conveniences for tests.
	put(p, content, message = `Add ${p}`) {
		return this.commit({ [p]: content }, message);
	}
	remove(p, message = `Delete ${p}`) {
		return this.commit({ [p]: null }, message);
	}
	files() {
		return [...this._tree().keys()].sort();
	}
	bytes(p) {
		const sha = this._tree().get(p);
		return sha ? this.blobs.get(sha) : null;
	}
	text(p) {
		const b = this.bytes(p);
		return b ? b.toString('utf8') : null;
	}
	sha(p) {
		return this._tree().get(p) || null;
	}
	log() {
		const out = [];
		let at = this.head;
		while (at) {
			const c = this.commits.get(at);
			out.push({ sha: c.sha, message: c.message, author: c.author, date: c.date, files: this.changed(c) });
			at = c.parents[0] || null;
		}
		return out;
	}
	changed(c) {
		const now = this.trees.get(c.tree);
		const before = c.parents[0] ? this.trees.get(this.commits.get(c.parents[0]).tree) : new Map();
		const out = [];
		for (const [p, s] of now) if (before.get(p) !== s) out.push({ filename: p, status: before.has(p) ? 'modified' : 'added' });
		for (const p of before.keys()) if (!now.has(p)) out.push({ filename: p, status: 'removed' });
		return out.sort((a, b) => (a.filename < b.filename ? -1 : 1));
	}

	// Directory entries directly under `dir` ('' is the root), or null.
	listDir(dir) {
		const prefix = dir ? dir + '/' : '';
		const seen = new Map();
		for (const [p, sha] of this._tree()) {
			if (!p.startsWith(prefix)) continue;
			const rest = p.slice(prefix.length);
			const slash = rest.indexOf('/');
			if (slash === -1) seen.set(rest, { type: 'file', name: rest, path: p, sha, size: this.blobs.get(sha).length });
			else {
				const name = rest.slice(0, slash);
				if (!seen.has(name)) seen.set(name, { type: 'dir', name, path: prefix + name, sha: this.dirSha(prefix + name), size: 0 });
			}
		}
		if (!seen.size) return null;
		return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
	}

	dirSha(dir) {
		const lines = [];
		for (const [p, s] of this._tree()) if (p.startsWith(dir + '/')) lines.push(`${p}\0${s}\n`);
		return sha1('dir\0', lines.sort().join(''));
	}
}

// ---- the initial world ------------------------------------------------------

function readSeed(rel) {
	return fs.readFileSync(path.join(repoRoot, ...rel.split('/')));
}

export const LAYOUT_README = '# desk\n\nThe private side of nietztein.github.io (fake repository for tests).\n';

function buildWorld() {
	const repos = new Map();
	const add = (r) => {
		repos.set(r.full.toLowerCase(), r);
		return r;
	};

	const site = add(new Repo({ owner: 'NietZteiN', name: 'nietztein.github.io', isPrivate: false, description: 'Personal site' }));
	const seed = {};
	for (const rel of SEED) seed[rel] = readSeed(rel);
	site.commit(seed, 'Seed the fake site from the working tree');

	add(new Repo({ owner: 'NietZteiN', name: 'desk', isPrivate: true }));

	const ready = add(new Repo({ owner: 'NietZteiN', name: 'desk-ready', isPrivate: true }));
	ready.commit(
		{
			'README.md': LAYOUT_README,
			'desk/settings.json': JSON.stringify({ lockMinutes: 30 }, null, '\t') + '\n',
			'drafts/.gitkeep': '',
			'notes/.gitkeep': '',
			'reading/.gitkeep': '',
			'notes/inbox/20261001T101500Z-aa.md': '---\ncreated: 2026-10-01T10:15:00Z\ntags: [inbox]\n---\n\nFixture note one (fake-github).\n',
		},
		'Set up the Desk'
	);

	const pub = add(new Repo({ owner: 'NietZteiN', name: 'desk-public', isPrivate: false }));
	pub.commit({ 'README.md': '# desk-public\n\nA public repository, for the test that the wizard refuses one.\n' }, 'Initial commit');

	const other = add(new Repo({ owner: 'someone-else', name: 'desk', isPrivate: true }));
	other.commit({ 'README.md': '# desk\n' }, 'Initial commit');

	return repos;
}

function cannedRuns(site) {
	const t = (s) => new Date(s).toISOString();
	return [
		{
			id: 9000002, run_number: 41, name: 'pages build and deployment', display_title: 'pages build and deployment', event: 'dynamic',
			status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: site.head, path: 'dynamic/pages/pages-build-deployment',
			created_at: t('2026-10-01T12:01:10Z'), updated_at: t('2026-10-01T12:01:55Z'), run_started_at: t('2026-10-01T12:01:10Z'),
			html_url: 'https://github.com/NietZteiN/nietztein.github.io/actions/runs/9000002', actor: { login: 'NietZteiN' },
		},
		{
			id: 9000001, run_number: 17, name: 'Build blog and story indexes', display_title: 'Seed the fake site from the working tree', event: 'push',
			status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: site.head, path: '.github/workflows/build-blog.yml',
			created_at: t('2026-10-01T12:00:05Z'), updated_at: t('2026-10-01T12:00:40Z'), run_started_at: t('2026-10-01T12:00:05Z'),
			html_url: 'https://github.com/NietZteiN/nietztein.github.io/actions/runs/9000001', actor: { login: 'NietZteiN' },
		},
		{
			id: 8999990, run_number: 16, name: 'Build blog and story indexes', display_title: 'An older push', event: 'push',
			status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: '0'.repeat(40), path: '.github/workflows/build-blog.yml',
			created_at: t('2026-09-28T09:00:05Z'), updated_at: t('2026-09-28T09:00:31Z'), run_started_at: t('2026-09-28T09:00:05Z'),
			html_url: 'https://github.com/NietZteiN/nietztein.github.io/actions/runs/8999990', actor: { login: 'NietZteiN' },
		},
	];
}

function cannedDiscussions() {
	const comment = (id, login, body, at, replies = []) => ({
		id: 'DC_' + id, databaseId: id, url: `https://github.com/NietZteiN/nietztein.github.io/discussions/1#discussioncomment-${id}`,
		author: { login, avatarUrl: '', url: `https://github.com/${login}` },
		body, bodyText: body.replace(/<[^>]*>/g, ''), bodyHTML: '', createdAt: at, updatedAt: at, isAnswer: false, isMinimized: false,
		reactions: { totalCount: 0 }, reactionGroups: [],
		replies: { totalCount: replies.length, nodes: replies },
	});
	return [
		{
			id: 'D_1', number: 1, title: 'latentland', url: 'https://github.com/NietZteiN/nietztein.github.io/discussions/1',
			createdAt: '2026-09-22T08:00:00Z', updatedAt: '2026-09-30T18:30:00Z', locked: false,
			category: { name: 'Announcements' }, author: { login: 'giscus', avatarUrl: '', url: 'https://github.com/apps/giscus' },
			reactions: { totalCount: 3 }, reactionGroups: [{ content: 'THUMBS_UP', users: { totalCount: 2 } }, { content: 'HEART', users: { totalCount: 1 } }],
			comments: {
				totalCount: 2,
				nodes: [
					comment(101, 'reader-one', 'Fixture comment one (fake-github). With **bold** and `code`.', '2026-09-24T10:00:00Z', [
						comment(102, 'NietZteiN', 'Fixture reply (fake-github).', '2026-09-24T12:00:00Z'),
					]),
					comment(103, 'reader-two', 'Fixture comment two <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> (must be shown harmlessly).', '2026-09-30T18:30:00Z'),
				],
			},
		},
		{
			id: 'D_2', number: 2, title: 'benchmarks-we-actually-need', url: 'https://github.com/NietZteiN/nietztein.github.io/discussions/2',
			createdAt: '2026-09-24T08:00:00Z', updatedAt: '2026-09-25T09:00:00Z', locked: false,
			category: { name: 'Announcements' }, author: { login: 'giscus', avatarUrl: '', url: 'https://github.com/apps/giscus' },
			reactions: { totalCount: 1 }, reactionGroups: [{ content: 'THUMBS_UP', users: { totalCount: 1 } }],
			comments: { totalCount: 1, nodes: [comment(201, 'reader-one', 'Fixture comment three (fake-github).', '2026-09-25T09:00:00Z')] },
		},
	];
}

// The post index, built the way scripts/build-blog-index.mjs builds it.
function buildBlogIndex(repo) {
	const posts = [];
	for (const p of repo.files()) {
		const m = /^blog\/posts\/([^/]+\.md)$/i.exec(p);
		if (!m) continue;
		const file = m[1];
		const text = repo.text(p);
		const fm = {};
		const block = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(text);
		if (block) {
			for (const line of block[1].split(/\r?\n/)) {
				const idx = line.indexOf(':');
				if (idx === -1) continue;
				const key = line.slice(0, idx).trim();
				const val = line.slice(idx + 1).trim();
				if (val.startsWith('[') && val.endsWith(']')) fm[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
				else fm[key] = val.replace(/^["']|["']$/g, '');
			}
		}
		const slug = file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
		posts.push({
			slug,
			title: fm.title || slug,
			date: fm.date || (file.match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1] || '',
			summary: fm.summary || '',
			tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [],
			file,
		});
	}
	posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
	return JSON.stringify(posts, null, 2) + '\n';
}

// ---- the server -------------------------------------------------------------

export async function startFakeGitHub({ port = 0, quiet = true } = {}) {
	const fake = {
		url: '',
		port: 0,
		requests: [],
		actionDelayMs: 30,
		repos: buildWorld(),
		runs: [],
		pagesBuilds: [],
		discussions: cannedDiscussions(),
		rate: { limit: 5000, remaining: 4990, reset: Math.floor(Date.now() / 1000) + 3600 },
		_down: false,
		_failNext: [],
		_pending: new Set(),
		repo(full) {
			const r = this.repos.get(String(full).toLowerCase());
			if (!r) throw new Error(`fake-github: no repository ${full}`);
			return r;
		},
		setDown(on) {
			this._down = !!on;
		},
		setRate(remaining, resetInSeconds = 3600) {
			this.rate.remaining = remaining;
			this.rate.reset = Math.floor(Date.now() / 1000) + resetInSeconds;
		},
		failNext(test, response) {
			this._failNext.push({ test, response });
		},
		settle() {
			return Promise.all([...this._pending]).then(() => undefined);
		},
		reset() {
			this.repos = buildWorld();
			this.requests.length = 0;
			this.discussions = cannedDiscussions();
			this.rate = { limit: 5000, remaining: 4990, reset: Math.floor(Date.now() / 1000) + 3600 };
			this._down = false;
			this._failNext.length = 0;
			initSite();
		},
		close() {
			return new Promise((done) => {
				server.close(() => done());
				server.closeAllConnections();
			});
		},
	};

	function initSite() {
		const site = fake.repo('NietZteiN/nietztein.github.io');
		fake.runs = cannedRuns(site);
		fake.pagesBuilds = [
			{ url: '', status: 'built', error: { message: null }, pusher: { login: 'NietZteiN' }, commit: site.head, duration: 31000, created_at: '2026-10-01T12:01:10Z', updated_at: '2026-10-01T12:01:55Z' },
		];
	}
	initSite();

	// The pretend Action: a push that touches blog/posts/ rebuilds blog/index.json
	// a moment later, as .github/workflows/build-blog.yml does, and Pages builds.
	function afterPush(repo, paths, message) {
		if (repo.full !== 'NietZteiN/nietztein.github.io') return;
		const headAtPush = repo.head;
		const touchesPosts = paths.some((p) => p.startsWith('blog/posts/'));
		const job = new Promise((resolve) => {
			setTimeout(() => {
				const now = new Date().toISOString();
				const id = 9100000 + fake.runs.length;
				if (touchesPosts) {
					const next = buildBlogIndex(repo);
					if (next !== repo.text('blog/index.json')) repo.commit({ 'blog/index.json': next }, 'chore(index): rebuild blog and story indexes [skip ci]', 'github-actions[bot]');
					fake.runs.unshift({
						id, run_number: 18 + fake.runs.length, name: 'Build blog and story indexes', display_title: message.split('\n')[0], event: 'push',
						status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: headAtPush, path: '.github/workflows/build-blog.yml',
						created_at: now, updated_at: now, run_started_at: now, html_url: `https://github.com/NietZteiN/nietztein.github.io/actions/runs/${id}`, actor: { login: 'NietZteiN' },
					});
				}
				fake.runs.unshift({
					id: id + 500000, run_number: 42 + fake.runs.length, name: 'pages build and deployment', display_title: 'pages build and deployment', event: 'dynamic',
					status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: repo.head, path: 'dynamic/pages/pages-build-deployment',
					created_at: now, updated_at: now, run_started_at: now, html_url: `https://github.com/NietZteiN/nietztein.github.io/actions/runs/${id + 500000}`, actor: { login: 'NietZteiN' },
				});
				fake.pagesBuilds.unshift({ url: '', status: 'built', error: { message: null }, pusher: { login: 'NietZteiN' }, commit: repo.head, duration: 30000, created_at: now, updated_at: now });
				fake._pending.delete(job);
				resolve();
			}, fake.actionDelayMs);
		});
		fake._pending.add(job);
	}

	function rateHeaders() {
		const r = fake.rate;
		return {
			'X-RateLimit-Limit': String(r.limit),
			'X-RateLimit-Remaining': String(Math.max(0, r.remaining)),
			'X-RateLimit-Reset': String(r.reset),
			'X-RateLimit-Used': String(Math.max(0, r.limit - r.remaining)),
			'X-RateLimit-Resource': 'core',
		};
	}

	function send(res, status, body, extraHeaders = {}) {
		const text = body === undefined || body === null ? '' : JSON.stringify(body);
		res.writeHead(status, {
			...CORS,
			...rateHeaders(),
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'private, max-age=60, s-maxage=60',
			'X-GitHub-Request-Id': 'FAKE:' + crypto.randomBytes(6).toString('hex'),
			'X-GitHub-Media-Type': 'github.v3; format=json',
			...extraHeaders,
		});
		res.end(text);
	}

	const notFound = () => new HttpError(404, 'Not Found');
	const forbidden = (need) => new HttpError(403, 'Resource not accessible by personal access token', { headers: { 'X-Accepted-GitHub-Permissions': need } });

	// What may this token do with this repository?
	function access(grant, repo) {
		const mine = grant.user === repo.owner;
		const visible = !repo.private || (mine && grant.privateRepos);
		return {
			visible,
			read: visible,
			write: visible && mine && grant.contents === 'write' && (!repo.private || grant.privateRepos),
			push: mine, // the account's own right, whatever the token was given
			mine,
		};
	}

	function repoJson(repo, grant) {
		const a = access(grant, repo);
		return {
			id: Math.abs(parseInt(sha1(repo.full).slice(0, 7), 16)),
			name: repo.name,
			full_name: repo.full,
			private: repo.private,
			visibility: repo.private ? 'private' : 'public',
			owner: { login: repo.owner },
			html_url: `https://github.com/${repo.full}`,
			description: repo.description,
			default_branch: repo.branch,
			pushed_at: repo.pushedAt,
			updated_at: repo.pushedAt,
			size: repo.isEmpty ? 0 : Math.ceil([...repo._tree().values()].reduce((n, s) => n + repo.blobs.get(s).length, 0) / 1024),
			has_discussions: !repo.private,
			has_pages: repo.name === 'nietztein.github.io',
			permissions: { admin: a.mine, maintain: a.mine, push: a.push, triage: a.mine, pull: true },
		};
	}

	function fileJson(repo, p, sha) {
		const buf = repo.blobs.get(sha);
		const big = buf.length > 1000000;
		return {
			type: 'file',
			encoding: big ? 'none' : 'base64',
			size: buf.length,
			name: p.split('/').pop(),
			path: p,
			content: big ? '' : wrap60(buf.toString('base64')),
			sha,
			url: `${fake.url}/repos/${repo.full}/contents/${p}?ref=${repo.branch}`,
			git_url: `${fake.url}/repos/${repo.full}/git/blobs/${sha}`,
			html_url: `https://github.com/${repo.full}/blob/${repo.branch}/${p}`,
			download_url: null,
		};
	}

	function commitJson(repo, c) {
		return {
			sha: c.sha,
			html_url: `https://github.com/${repo.full}/commit/${c.sha}`,
			commit: { message: c.message, author: { name: c.author, date: c.date }, committer: { name: c.author, date: c.date }, tree: { sha: c.tree } },
			author: { login: c.author },
			committer: { login: c.author },
			parents: c.parents.map((sha) => ({ sha })),
		};
	}

	function treeJson(repo, sha, recursive) {
		const map = repo.trees.get(sha);
		const entries = [];
		const dirs = new Set();
		for (const [p, s] of map) {
			const parts = p.split('/');
			if (recursive) {
				for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
				entries.push({ path: p, mode: '100644', type: 'blob', sha: s, size: repo.blobs.get(s).length });
			} else if (parts.length === 1) entries.push({ path: p, mode: '100644', type: 'blob', sha: s, size: repo.blobs.get(s).length });
			else dirs.add(parts[0]);
		}
		for (const d of dirs) entries.push({ path: d, mode: '040000', type: 'tree', sha: sha1('dir\0', d, sha) });
		entries.sort((a, b) => (a.path < b.path ? -1 : 1));
		return { sha, url: `${fake.url}/repos/${repo.full}/git/trees/${sha}`, tree: entries, truncated: false };
	}

	function validPath(p) {
		return !!p && !p.startsWith('/') && !p.endsWith('/') && !p.split('/').some((s) => !s || s === '.' || s === '..');
	}

	function decodeContent(body) {
		if (typeof body.content !== 'string') throw new HttpError(422, 'Invalid request.\n\n"content" wasn\'t supplied.');
		if (!/^[A-Za-z0-9+/=\s]*$/.test(body.content)) throw new HttpError(422, 'content is not valid Base64');
		return Buffer.from(body.content, 'base64');
	}

	// ---- routing ----------------------------------------------------------------

	function route(req, url, grant, body) {
		const method = req.method;
		const parts = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
		const q = url.searchParams;
		const user = USERS[grant.user];

		if (method === 'GET' && url.pathname === '/user') return { status: 200, body: user };
		if (method === 'GET' && url.pathname === '/rate_limit') {
			const r = fake.rate;
			const core = { limit: r.limit, remaining: Math.max(0, r.remaining), reset: r.reset, used: Math.max(0, r.limit - r.remaining), resource: 'core' };
			return { status: 200, body: { resources: { core, graphql: { ...core, resource: 'graphql' } }, rate: core }, free: true };
		}
		if (method === 'POST' && url.pathname === '/graphql') return graphql(grant, body);

		if (parts[0] !== 'repos' || parts.length < 3) throw notFound();
		const repo = fake.repos.get(`${parts[1]}/${parts[2]}`.toLowerCase());
		if (!repo) throw notFound();
		const a = access(grant, repo);
		if (!a.visible) throw notFound();
		const rest = parts.slice(3);
		const needWrite = () => {
			if (!a.write) throw forbidden('contents=write');
		};
		const emptyGit = () => {
			if (repo.isEmpty) throw new HttpError(409, 'Git Repository is empty.');
		};
		const refOk = (ref) => !ref || ref === repo.branch || ref === 'heads/' + repo.branch || ref === 'refs/heads/' + repo.branch;

		// /repos/:o/:r
		if (!rest.length && method === 'GET') return { status: 200, body: repoJson(repo, grant) };

		// /repos/:o/:r/contents/<path>
		if (rest[0] === 'contents') {
			const p = rest.slice(1).join('/');
			if (method === 'GET') {
				if (repo.isEmpty) throw new HttpError(404, 'This repository is empty.');
				if (!refOk(q.get('ref'))) throw new HttpError(404, `No commit found for the ref ${q.get('ref')}`);
				const sha = repo.sha(p);
				if (sha) return { status: 200, body: fileJson(repo, p, sha) };
				const dir = repo.listDir(p);
				if (!dir) throw notFound();
				return {
					status: 200,
					body: dir.map((e) => ({ type: e.type, name: e.name, path: e.path, sha: e.sha, size: e.size, url: `${fake.url}/repos/${repo.full}/contents/${e.path}`, html_url: `https://github.com/${repo.full}/${e.type === 'dir' ? 'tree' : 'blob'}/${repo.branch}/${e.path}`, download_url: null })),
				};
			}
			if (method === 'PUT') {
				needWrite();
				if (!validPath(p)) throw new HttpError(422, 'path contains a malformed path component');
				if (!body || typeof body.message !== 'string' || !body.message) throw new HttpError(422, 'Invalid request.\n\n"message" wasn\'t supplied.');
				if (body.branch && body.branch !== repo.branch) throw new HttpError(404, `Branch ${body.branch} not found`);
				const buf = decodeContent(body);
				const current = repo.sha(p);
				if (current && !body.sha) throw new HttpError(422, 'Invalid request.\n\n"sha" wasn\'t supplied.');
				if (current && body.sha !== current) throw new HttpError(409, `${p} does not match ${body.sha}`);
				if (!current && body.sha) throw new HttpError(409, `${p} does not match ${body.sha}`);
				if (repo.listDir(p)) throw new HttpError(422, 'path is a directory');
				const commit = repo.commit({ [p]: buf }, body.message, grant.user);
				afterPush(repo, [p], body.message);
				return { status: current ? 200 : 201, body: { content: { ...fileJson(repo, p, repo.sha(p)), content: undefined, encoding: undefined }, commit: { sha: commit, message: body.message, html_url: `https://github.com/${repo.full}/commit/${commit}` } } };
			}
			if (method === 'DELETE') {
				needWrite();
				const current = repo.sha(p);
				if (!current) throw notFound();
				if (!body || typeof body.message !== 'string' || !body.message) throw new HttpError(422, 'Invalid request.\n\n"message" wasn\'t supplied.');
				if (!body.sha) throw new HttpError(422, 'Invalid request.\n\n"sha" wasn\'t supplied.');
				if (body.sha !== current) throw new HttpError(409, `${p} does not match ${body.sha}`);
				const commit = repo.commit({ [p]: null }, body.message, grant.user);
				afterPush(repo, [p], body.message);
				return { status: 200, body: { content: null, commit: { sha: commit, message: body.message } } };
			}
		}

		// /repos/:o/:r/git/...
		if (rest[0] === 'git') {
			const kind = rest[1];
			if (kind === 'blobs' && method === 'POST') {
				needWrite();
				emptyGit();
				if (!body || typeof body.content !== 'string') throw new HttpError(422, 'Invalid request.\n\n"content" wasn\'t supplied.');
				const buf = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content, 'utf8');
				const sha = repo.addBlob(buf);
				return { status: 201, body: { sha, url: `${fake.url}/repos/${repo.full}/git/blobs/${sha}` } };
			}
			if (kind === 'blobs' && method === 'GET') {
				const buf = repo.blobs.get(rest[2]);
				if (!buf) throw notFound();
				return { status: 200, body: { sha: rest[2], size: buf.length, encoding: 'base64', content: wrap60(buf.toString('base64')), url: `${fake.url}/repos/${repo.full}/git/blobs/${rest[2]}` } };
			}
			if ((kind === 'ref' || kind === 'refs') && method === 'GET') {
				emptyGit();
				if (rest.slice(2).join('/') !== 'heads/' + repo.branch) throw notFound();
				return { status: 200, body: { ref: 'refs/heads/' + repo.branch, object: { type: 'commit', sha: repo.head } } };
			}
			if (kind === 'refs' && method === 'PATCH') {
				needWrite();
				emptyGit();
				if (rest.slice(2).join('/') !== 'heads/' + repo.branch) throw new HttpError(422, 'Reference does not exist');
				const c = body && repo.commits.get(body.sha);
				if (!c) throw new HttpError(422, 'Object does not exist');
				if (!body.force && c.parents[0] !== repo.head) throw new HttpError(422, 'Update is not a fast forward');
				const paths = repo.changed(c).map((f) => f.filename);
				repo.head = c.sha;
				repo.pushedAt = new Date().toISOString();
				afterPush(repo, paths, c.message);
				return { status: 200, body: { ref: 'refs/heads/' + repo.branch, object: { type: 'commit', sha: repo.head } } };
			}
			if (kind === 'commits' && method === 'GET') {
				const c = repo.commits.get(rest[2]);
				if (!c) throw notFound();
				return { status: 200, body: { sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message, author: { name: c.author, date: c.date } } };
			}
			if (kind === 'commits' && method === 'POST') {
				needWrite();
				emptyGit();
				if (!body || typeof body.message !== 'string' || !body.message) throw new HttpError(422, 'Invalid request.\n\n"message" wasn\'t supplied.');
				if (!repo.trees.has(body.tree)) throw new HttpError(422, 'Tree SHA does not exist');
				const parents = Array.isArray(body.parents) ? body.parents : [];
				for (const p of parents) if (!repo.commits.has(p)) throw new HttpError(422, 'Parent SHA does not exist or is not a commit object');
				const sha = repo.addCommit({ tree: body.tree, parents, message: body.message, author: grant.user });
				return { status: 201, body: { sha, tree: { sha: body.tree }, parents: parents.map((p) => ({ sha: p })), message: body.message } };
			}
			if (kind === 'trees' && method === 'GET') {
				emptyGit();
				let sha = rest.slice(2).join('/');
				if (refOk(sha)) sha = repo.commits.get(repo.head).tree;
				else if (repo.commits.has(sha)) sha = repo.commits.get(sha).tree;
				if (!repo.trees.has(sha)) throw notFound();
				return { status: 200, body: treeJson(repo, sha, q.has('recursive')) };
			}
			if (kind === 'trees' && method === 'POST') {
				needWrite();
				emptyGit();
				if (!body || !Array.isArray(body.tree)) throw new HttpError(422, 'Invalid request.\n\n"tree" wasn\'t supplied.');
				let map = new Map();
				if (body.base_tree) {
					if (!repo.trees.has(body.base_tree)) throw new HttpError(422, 'base_tree is not a valid tree oid');
					map = new Map(repo.trees.get(body.base_tree));
				}
				for (const e of body.tree) {
					if (!validPath(e.path)) throw new HttpError(422, 'tree.path contains a malformed path component');
					if (e.sha === null) {
						if (!map.has(e.path)) throw new HttpError(422, 'GitRPC::BadObjectState');
						map.delete(e.path);
					} else if (typeof e.content === 'string') map.set(e.path, repo.addBlob(Buffer.from(e.content, 'utf8')));
					else if (typeof e.sha === 'string') {
						if (!repo.blobs.has(e.sha)) throw new HttpError(422, 'tree.sha ' + e.sha + ' is not a valid blob');
						map.set(e.path, e.sha);
					} else throw new HttpError(422, 'Must supply either tree.sha or tree.content');
				}
				const sha = repo.addTree(map);
				return { status: 201, body: treeJson(repo, sha, false) };
			}
		}

		// /repos/:o/:r/commits
		if (rest[0] === 'commits' && method === 'GET') {
			if (repo.isEmpty) throw new HttpError(409, 'Git Repository is empty.');
			if (rest[1]) {
				const c = repo.commits.get(rest[1] === repo.branch ? repo.head : rest[1]);
				if (!c) throw new HttpError(422, `No commit found for SHA: ${rest[1]}`);
				return { status: 200, body: { ...commitJson(repo, c), files: repo.changed(c) } };
			}
			const wanted = q.get('path');
			const per = Math.max(1, Math.min(100, Number(q.get('per_page')) || 30));
			const out = [];
			let at = repo.head;
			while (at && out.length < per) {
				const c = repo.commits.get(at);
				if (!wanted || repo.changed(c).some((f) => f.filename === wanted || f.filename.startsWith(wanted.replace(/\/$/, '') + '/'))) out.push(commitJson(repo, c));
				at = c.parents[0] || null;
			}
			return { status: 200, body: out };
		}

		// /repos/:o/:r/actions/runs
		if (rest[0] === 'actions' && method === 'GET') {
			if (!grant.actions) throw forbidden('actions=read');
			const runs = repo.name === 'nietztein.github.io' ? fake.runs : [];
			const per = Math.max(1, Math.min(100, Number(q.get('per_page')) || 30));
			if (rest[1] === 'runs' && rest[2]) {
				const run = runs.find((r) => String(r.id) === rest[2]);
				if (!run) throw notFound();
				return { status: 200, body: run };
			}
			if (rest[1] === 'runs') return { status: 200, body: { total_count: runs.length, workflow_runs: runs.slice(0, per) } };
			if (rest[1] === 'workflows') {
				return { status: 200, body: { total_count: runs.length ? 1 : 0, workflows: runs.length ? [{ id: 77, name: 'Build blog and story indexes', path: '.github/workflows/build-blog.yml', state: 'active' }] : [] } };
			}
		}

		// /repos/:o/:r/pages
		if (rest[0] === 'pages' && method === 'GET') {
			if (!grant.pages) throw forbidden('pages=read');
			if (repo.name !== 'nietztein.github.io') throw notFound();
			if (!rest[1]) {
				return { status: 200, body: { url: `${fake.url}/repos/${repo.full}/pages`, status: 'built', cname: null, custom_404: true, html_url: 'https://nietztein.github.io/', build_type: 'legacy', source: { branch: 'main', path: '/' }, public: true, https_enforced: true } };
			}
			if (rest[1] === 'builds' && rest[2] === 'latest') return { status: 200, body: fake.pagesBuilds[0] };
			if (rest[1] === 'builds') return { status: 200, body: fake.pagesBuilds.slice(0, Math.max(1, Math.min(100, Number(q.get('per_page')) || 30))) };
		}

		// /repos/:o/:r/deployments
		if (rest[0] === 'deployments' && method === 'GET') {
			if (repo.name !== 'nietztein.github.io') return { status: 200, body: [] };
			if (rest[2] === 'statuses') return { status: 200, body: [{ id: 1, state: 'success', environment: 'github-pages', created_at: fake.pagesBuilds[0].updated_at, environment_url: 'https://nietztein.github.io/' }] };
			return {
				status: 200,
				body: fake.pagesBuilds.slice(0, 10).map((b, i) => ({ id: 7000 + fake.pagesBuilds.length - i, sha: b.commit, ref: 'main', task: 'deploy', environment: 'github-pages', created_at: b.created_at, updated_at: b.updated_at, creator: { login: 'github-pages[bot]' } })),
			};
		}

		throw notFound();
	}

	function graphql(grant, body) {
		const query = body && typeof body.query === 'string' ? body.query : '';
		if (!query) return { status: 400, body: { message: 'A query attribute must be specified and must be a string.' } };
		const stripped = query.replace(/#[^\n]*/g, '');
		if (/^\s*mutation\b/.test(stripped) || /\bmutation\s*[({\w]/.test(stripped)) {
			return { status: 200, body: { data: null, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token (the fake accepts no mutation)' }] } };
		}
		const data = {};
		const errors = [];
		if (/\bviewer\b/.test(stripped)) data.viewer = { login: grant.user };
		if (/\brateLimit\b/.test(stripped)) data.rateLimit = { limit: 5000, remaining: Math.max(0, fake.rate.remaining), resetAt: new Date(fake.rate.reset * 1000).toISOString(), cost: 1 };
		if (/\brepository\b/.test(stripped)) {
			const v = (body && body.variables) || {};
			const owner = v.owner || (/owner:\s*"([^"]+)"/.exec(stripped) || [])[1] || SITE.owner;
			const name = v.name || v.repo || (/name:\s*"([^"]+)"/.exec(stripped) || [])[1] || SITE.repo;
			const repo = fake.repos.get(`${owner}/${name}`.toLowerCase());
			if (!repo || !access(grant, repo).visible) {
				data.repository = null;
				errors.push({ type: 'NOT_FOUND', path: ['repository'], message: `Could not resolve to a Repository with the name '${owner}/${name}'.` });
			} else if (/\bdiscussions?\b/.test(stripped) && !grant.discussions) {
				data.repository = { id: 'R_fake', nameWithOwner: repo.full, discussions: null, discussion: null };
				errors.push({ type: 'FORBIDDEN', path: ['repository', 'discussions'], message: 'Resource not accessible by personal access token' });
			} else {
				const list = repo.name === 'nietztein.github.io' ? fake.discussions : [];
				const number = Number(v.number || (/discussion\s*\(\s*number:\s*(\d+)/.exec(stripped) || [])[1] || 0);
				data.repository = {
					id: 'R_fake',
					nameWithOwner: repo.full,
					url: `https://github.com/${repo.full}`,
					hasDiscussionsEnabled: !repo.private,
					discussions: { totalCount: list.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: list },
					discussion: list.find((d) => d.number === number) || null,
					discussionCategories: { nodes: [{ id: 'DIC_fake', name: 'Announcements' }] },
				};
			}
		}
		const out = { data };
		if (errors.length) out.errors = errors;
		return { status: 200, body: out };
	}

	// ---- http -------------------------------------------------------------------

	function readBody(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on('data', (c) => {
				size += c.length;
				if (size > 150 * 1024 * 1024) {
					reject(new HttpError(413, 'Payload too large'));
					req.destroy();
				} else chunks.push(c);
			});
			req.on('end', () => resolve(Buffer.concat(chunks)));
			req.on('error', reject);
		});
	}

	async function handle(req, res) {
		if (fake._down) {
			req.socket.destroy();
			return;
		}
		const url = new URL(req.url, 'http://127.0.0.1');
		if (req.method === 'OPTIONS') {
			res.writeHead(204, { ...CORS, ...PREFLIGHT });
			res.end();
			return;
		}
		const entry = { method: req.method, path: url.pathname + url.search, status: 0, user: '' };
		fake.requests.push(entry);
		const finish = (status, body, headers) => {
			entry.status = status;
			if (!quiet) process.stderr.write(`${req.method} ${status} ${url.pathname}\n`);
			send(res, status, body, headers);
		};

		try {
			// Authentication. The header's value is looked at here and nowhere else.
			const auth = String(req.headers.authorization || '');
			const m = /^(?:Bearer|token)\s+(\S+)$/i.exec(auth);
			const token = m ? m[1] : '';
			const raw = await readBody(req);
			if (!token) return finish(401, { message: 'Requires authentication', documentation_url: 'https://docs.github.com/rest', status: '401' });
			if (!/^github_pat_FAKE_[a-z_]+$/.test(token)) {
				return finish(401, { message: 'Bad credentials (fake-github accepts only its own made-up tokens; never give it a real one)', status: '401' });
			}
			const grant = GRANTS[token];
			if (!grant) return finish(401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' });
			entry.user = grant.user;

			let body = null;
			if (raw.length) {
				try {
					body = JSON.parse(raw.toString('utf8'));
				} catch (e) {
					return finish(400, { message: 'Problems parsing JSON' });
				}
			}

			const key = `${req.method} ${url.pathname}`;
			const idx = fake._failNext.findIndex((f) => (typeof f.test === 'string' ? key.includes(f.test) : f.test.test(key)));
			if (idx !== -1) {
				const f = fake._failNext.splice(idx, 1)[0].response;
				return finish(f.status || 500, f.body === undefined ? { message: 'Injected failure' } : f.body, f.headers || {});
			}

			if (url.pathname !== '/rate_limit') {
				if (fake.rate.remaining <= 0) {
					return finish(403, { message: `API rate limit exceeded for user ID ${USERS[grant.user].id}.`, documentation_url: 'https://docs.github.com/rest/overview/rate-limits-for-the-rest-api', status: '403' });
				}
				fake.rate.remaining--;
			}

			const out = route(req, url, grant, body);
			return finish(out.status, out.body, out.headers);
		} catch (e) {
			if (e instanceof HttpError) {
				return finish(e.status, { message: e.message, documentation_url: 'https://docs.github.com/rest', status: String(e.status) }, e.extra.headers || {});
			}
			return finish(500, { message: 'fake-github crashed: ' + (e && e.message) });
		}
	}

	const server = http.createServer((req, res) => {
		handle(req, res).catch(() => {
			try {
				res.destroy();
			} catch (e) {
				/* gone */
			}
		});
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			server.removeListener('error', reject);
			resolve();
		});
	});
	fake.port = server.address().port;
	fake.url = `http://127.0.0.1:${fake.port}`;
	return fake;
}

// ---- command line -------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
	const args = process.argv.slice(2);
	const at = args.indexOf('--port');
	const port = at !== -1 ? Number(args[at + 1]) : 8787;
	const fake = await startFakeGitHub({ port, quiet: false });
	console.log(fake.url);
	console.error('Fake GitHub. Open  <local site>/desk/?api=' + fake.url + '  and sign in with one of:');
	for (const [name, token] of Object.entries(TOKENS)) console.error(`  ${name.padEnd(9)} ${token}`);
	console.error('Private repository name to type in the wizard: desk (empty), desk-ready (set up), desk-public (must be refused).');
}
