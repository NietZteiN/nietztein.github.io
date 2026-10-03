// Static file server for local preview and for the QA harness (scripts/qa).
// It behaves like GitHub Pages where the difference bites: paths are
// case-sensitive, a directory serves its index.html, a directory asked for
// without the trailing slash redirects to it, and unknown paths get 404.html
// with status 404.
//
// Zero dependencies. Run with:
//   node scripts/serve.mjs [--port N] [--quiet] [--root <dir>] [--mount <url path>=<dir>]
//
// It prints exactly one line on stdout, the address it listens on:
//   http://127.0.0.1:<port>/
// The default port is 0 (the OS picks a free one), so read that line. Requests
// are logged to stderr unless --quiet is given. Stop it with Ctrl+C.
//
// --root serves another folder instead of the repo. --mount adds a folder from
// outside the repo under a URL path (repeatable), which is how a test page is
// served without putting it in the repo:
//   node scripts/serve.mjs --mount misc/99-probe=C:\some\scratch\probe
//
// In-process use (smoke.mjs, shot.mjs and drive.mjs do this):
//   import { startServer } from '../serve.mjs';
//   const server = await startServer({ port: 0 });   // { url, port, root, resolve(), close() }
//
// Never served (always 404): anything under .git/ or blog/drafts/, any *.xlsx,
// and anything under blog/ that git does not track (unpublished posts). The
// tracked list is read once at startup with `git ls-files`; if git cannot be
// run, nothing under blog/ is served at all.
//
// It binds 127.0.0.1 only and sends Cache-Control: no-store on everything.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '..');

const TEXT = '; charset=utf-8';
const MIME = {
	'.html': 'text/html' + TEXT,
	'.htm': 'text/html' + TEXT,
	'.js': 'text/javascript' + TEXT,
	'.mjs': 'text/javascript' + TEXT,
	'.css': 'text/css' + TEXT,
	'.json': 'application/json' + TEXT,
	'.map': 'application/json' + TEXT,
	'.webmanifest': 'application/manifest+json' + TEXT,
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
	'.otf': 'font/otf',
	'.ttf': 'font/ttf',
	'.wasm': 'application/wasm',
	'.bin': 'application/octet-stream',
	'.txt': 'text/plain' + TEXT,
	'.md': 'text/markdown' + TEXT,
	'.vn': 'text/plain' + TEXT,
	'.csv': 'text/csv' + TEXT,
	'.tsv': 'text/tab-separated-values' + TEXT,
	'.pdf': 'application/pdf',
	'.xml': 'application/xml' + TEXT,
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
};

function mimeFor(file) {
	return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// The set of files git tracks under blog/, as repo-relative paths with forward
// slashes. Returns null when the root has no blog/ folder (nothing to guard)
// and an empty set when git fails (then nothing under blog/ is served).
function trackedBlogFiles(root) {
	if (!fs.existsSync(path.join(root, 'blog'))) return null;
	try {
		const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', 'blog'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024,
		});
		return new Set(out.split('\0').filter(Boolean));
	} catch (e) {
		return new Set();
	}
}

// "misc/99-probe" -> ['misc', '99-probe']
function mountSegments(urlPath) {
	return String(urlPath)
		.replace(/\\/g, '/')
		.split('/')
		.filter(Boolean);
}

// Does `dir` hold an entry spelled exactly `name`? Windows would happily open
// INDEX.HTML, "index.html." or an 8.3 short name; production would not.
function hasExact(dir, name) {
	try {
		return fs.readdirSync(dir).includes(name);
	} catch (e) {
		return false;
	}
}

function makeResolver(root, mounts) {
	const tracked = trackedBlogFiles(root);
	const mountList = Object.entries(mounts || {})
		.map(([urlPath, dir]) => ({ segs: mountSegments(urlPath), dir: path.resolve(dir) }))
		.filter((m) => m.segs.length)
		.sort((a, b) => b.segs.length - a.segs.length);

	// Maps a URL pathname to { status: 200, file } | { status: 301, location } |
	// { status: 404 } | { status: 400 }.
	return function resolve(pathname) {
		if (typeof pathname !== 'string' || !pathname.startsWith('/')) return { status: 400 };
		const trailingSlash = pathname.endsWith('/');
		const raw = pathname.split('/').slice(1);
		if (trailingSlash) raw.pop();
		const segs = [];
		for (const part of raw) {
			let seg;
			try {
				seg = decodeURIComponent(part);
			} catch (e) {
				return { status: 400 };
			}
			// Path traversal guard. Every segment must also match a real directory
			// entry below, so "..", drive letters and stream names cannot get through.
			if (!seg || seg === '.' || seg === '..' || /[\\/:\0]/.test(seg)) return { status: 404 };
			segs.push(seg);
		}

		let base = root;
		let rest = segs;
		let mounted = false;
		for (const m of mountList) {
			if (m.segs.length <= segs.length && m.segs.every((s, i) => s === segs[i])) {
				base = m.dir;
				rest = segs.slice(m.segs.length);
				mounted = true;
				break;
			}
		}

		if (!mounted) {
			const rel = segs.join('/');
			const lower = rel.toLowerCase();
			if (lower === '.git' || lower.startsWith('.git/')) return { status: 404 };
			if (lower === 'blog/drafts' || lower.startsWith('blog/drafts/')) return { status: 404 };
		}
		if (segs.length && /\.xlsx$/i.test(segs[segs.length - 1])) return { status: 404 };

		let cur = base;
		for (const seg of rest) {
			if (!hasExact(cur, seg)) return { status: 404 };
			cur = path.join(cur, seg);
		}
		const inside = path.relative(base, cur);
		if (inside.startsWith('..') || path.isAbsolute(inside)) return { status: 404 };

		let stat;
		try {
			stat = fs.statSync(cur);
		} catch (e) {
			return { status: 404 };
		}
		let relSegs = segs;
		if (stat.isDirectory()) {
			if (!trailingSlash && segs.length) return { status: 301, location: pathname + '/' };
			if (!hasExact(cur, 'index.html')) return { status: 404 };
			cur = path.join(cur, 'index.html');
			relSegs = segs.concat('index.html');
			try {
				stat = fs.statSync(cur);
			} catch (e) {
				return { status: 404 };
			}
			if (!stat.isFile()) return { status: 404 };
		} else if (!stat.isFile() || trailingSlash) {
			return { status: 404 };
		}

		if (!mounted && tracked && relSegs[0].toLowerCase() === 'blog' && !tracked.has(relSegs.join('/'))) {
			return { status: 404 };
		}
		return { status: 200, file: cur, size: stat.size };
	};
}

// Starts the server. Resolves to { url, port, root, resolve(pathname), close() }.
//   port    0 lets the OS pick
//   root    folder to serve (default: the repo)
//   quiet   false logs one line per request to stderr
//   mounts  { 'url/path': 'C:\\folder' } extra folders served under a URL path
export function startServer({ port = 0, root = repoRoot, quiet = true, mounts = {} } = {}) {
	const rootDir = path.resolve(root);
	const resolve = makeResolver(rootDir, mounts);

	function send404(req, res) {
		const page = path.join(rootDir, '404.html');
		let body = Buffer.from('404 Not Found\n');
		let type = 'text/plain' + TEXT;
		if (hasExact(rootDir, '404.html')) {
			try {
				body = fs.readFileSync(page);
				type = MIME['.html'];
			} catch (e) {
				/* keep the plain body */
			}
		}
		res.writeHead(404, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
		res.end(req.method === 'HEAD' ? undefined : body);
	}

	function handle(req, res) {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
			res.end();
			return 405;
		}
		let url;
		try {
			url = new URL(req.url, 'http://127.0.0.1');
		} catch (e) {
			res.writeHead(400, { 'Cache-Control': 'no-store' });
			res.end();
			return 400;
		}
		const r = resolve(url.pathname);
		if (r.status === 400) {
			res.writeHead(400, { 'Cache-Control': 'no-store' });
			res.end();
			return 400;
		}
		if (r.status === 301) {
			res.writeHead(301, { Location: r.location + url.search, 'Cache-Control': 'no-store' });
			res.end();
			return 301;
		}
		if (r.status !== 200) {
			send404(req, res);
			return 404;
		}

		const headers = {
			'Content-Type': mimeFor(r.file),
			'Cache-Control': 'no-store',
			'Accept-Ranges': 'bytes',
			'Access-Control-Allow-Origin': '*',
		};
		let start = 0;
		let end = r.size - 1;
		let status = 200;
		const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
		if (range && (range[1] || range[2]) && r.size > 0) {
			if (range[1]) {
				start = Number(range[1]);
				if (range[2]) end = Math.min(Number(range[2]), r.size - 1);
			} else {
				start = Math.max(0, r.size - Number(range[2]));
			}
			if (start > end || start >= r.size) {
				res.writeHead(416, { 'Content-Range': `bytes */${r.size}`, 'Cache-Control': 'no-store' });
				res.end();
				return 416;
			}
			status = 206;
			headers['Content-Range'] = `bytes ${start}-${end}/${r.size}`;
		}
		headers['Content-Length'] = r.size === 0 ? 0 : end - start + 1;
		res.writeHead(status, headers);
		if (req.method === 'HEAD' || r.size === 0) {
			res.end();
			return status;
		}
		const stream = fs.createReadStream(r.file, { start, end });
		stream.on('error', () => res.destroy());
		stream.pipe(res);
		return status;
	}

	const server = http.createServer((req, res) => {
		let status = 500;
		try {
			status = handle(req, res);
		} catch (e) {
			if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' });
			res.end();
		}
		if (!quiet) process.stderr.write(`${req.method} ${status} ${req.url}\n`);
	});

	return new Promise((resolvePromise, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			server.removeListener('error', reject);
			const actual = server.address().port;
			resolvePromise({
				url: `http://127.0.0.1:${actual}/`,
				port: actual,
				root: rootDir,
				// The file a URL path would be served from, or null (same rules as a request).
				resolve(pathname) {
					const r = resolve(pathname.startsWith('/') ? pathname : '/' + pathname);
					return r.status === 200 ? r.file : null;
				},
				close() {
					return new Promise((done) => {
						server.close(() => done());
						server.closeAllConnections();
					});
				},
			});
		});
	});
}

// True when the module at `metaUrl` is the script node was started with.
// Compared through the real path and, on Windows, without regard to case, so
// that an oddly spelled path can never turn a command into a silent no-op.
export function isMainModule(metaUrl) {
	if (!process.argv[1]) return false;
	const norm = (p) => {
		let s = path.resolve(p);
		try {
			s = fs.realpathSync.native(s);
		} catch (e) {
			/* keep the resolved path */
		}
		return process.platform === 'win32' ? s.toLowerCase() : s;
	};
	return norm(process.argv[1]) === norm(fileURLToPath(metaUrl));
}

// "a=b" pairs from --mount into { a: b }.
export function parseMounts(list) {
	const mounts = {};
	for (const item of list || []) {
		const i = item.indexOf('=');
		if (i < 1) throw new Error(`--mount expects <url path>=<dir>, got "${item}"`);
		mounts[item.slice(0, i)] = item.slice(i + 1);
	}
	return mounts;
}

// ---- CLI ----------------------------------------------------------------------

if (isMainModule(import.meta.url)) {
	let values;
	try {
		({ values } = parseArgs({
			options: {
				port: { type: 'string', default: '0' },
				quiet: { type: 'boolean', default: false },
				root: { type: 'string' },
				mount: { type: 'string', multiple: true },
				help: { type: 'boolean', short: 'h', default: false },
			},
		}));
	} catch (e) {
		console.error(e.message);
		console.error('Usage: node scripts/serve.mjs [--port N] [--quiet] [--root <dir>] [--mount <url path>=<dir>]');
		process.exit(2);
	}
	if (values.help) {
		console.log('Usage: node scripts/serve.mjs [--port N] [--quiet] [--root <dir>] [--mount <url path>=<dir>]');
		process.exit(0);
	}
	const port = Number(values.port);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		console.error(`--port must be a whole number from 0 to 65535, got "${values.port}"`);
		process.exit(2);
	}
	try {
		const server = await startServer({
			port,
			root: values.root ? path.resolve(values.root) : repoRoot,
			quiet: values.quiet,
			mounts: parseMounts(values.mount),
		});
		console.log(server.url);
	} catch (e) {
		console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : e.message);
		process.exit(1);
	}
}
