// Desk GitHub client: everything the Desk does on GitHub goes through here.
//
//   var made = DeskGH.create({ apiBase, token: function () { return '...'; }, site: {...}, priv: {...} });
//   made.client        the object views get as api.gh
//   made.issueTicket   kept by the frame; only ui.confirmPublish calls it
//
// Two repositories are known by name: 'site' (the public site; a commit there
// is publication) and 'private' (drafts, notes, settings).
//
// The rule that makes accidental publishing impossible lives here, not in the
// views: every call that changes 'site' must carry a ticket, and tickets are
// made only by the function this module hands to the frame, after the owner
// has confirmed a list of paths. A ticket covers exactly those paths, works
// once, and expires after two minutes. A GraphQL mutation needs a ticket
// issued for that very document ({ graphql: '...' }); a ticket for paths
// does not unlock it, nor the other way round. The last gate, in request(),
// compares again what each request touches with the ticket's grant.
//
// The token is read through config.token() for each request and sent only in
// the Authorization header, only to config.apiBase. It is never put in a URL,
// an error message or a log line.
//
// Errors are typed (DeskGH.errors): Unauthorized, Forbidden, NotFound,
// Conflict, RateLimited, Offline, PublishNotConfirmed, Locked, GitHubError.
// Each has .name, a .message in plain words, and where it applies .status,
// .target, .path, .permission (Forbidden) and .resetAt (RateLimited).
//
// Loads in the browser (window.DeskGH) and in Node (module.exports), where
// desk/test/test-gh.mjs runs every method against desk/test/fake-github.mjs.

(function (root, factory) {
	'use strict';
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.DeskGH = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
	'use strict';

	var API_VERSION = '2022-11-28';
	var TICKET_MS = 2 * 60 * 1000;
	var EMPTY_RE = /repository is empty/i;

	// ---- errors -------------------------------------------------------------

	function defineError(name, fallback) {
		function E(message, fields) {
			var e = new Error(message || fallback);
			e.name = name;
			Object.setPrototypeOf(e, E.prototype);
			if (fields) {
				Object.keys(fields).forEach(function (k) {
					if (fields[k] !== undefined) e[k] = fields[k];
				});
			}
			return e;
		}
		E.prototype = Object.create(Error.prototype);
		E.prototype.constructor = E;
		E.prototype.name = name;
		return E;
	}

	var errors = {
		GitHubError: defineError('GitHubError', 'GitHub answered with an error.'),
		Unauthorized: defineError('Unauthorized', 'GitHub did not accept the token. It may have expired or been revoked.'),
		Forbidden: defineError('Forbidden', 'The token is not allowed to do this.'),
		NotFound: defineError('NotFound', 'Not found on GitHub.'),
		Conflict: defineError('Conflict', 'The file changed on GitHub since it was read.'),
		RateLimited: defineError('RateLimited', 'GitHub is rate limiting this token.'),
		Offline: defineError('Offline', 'GitHub could not be reached. The device seems to be offline.'),
		PublishNotConfirmed: defineError('PublishNotConfirmed', 'A change to the public site needs the owner\'s confirmation first.'),
		Locked: defineError('Locked', 'The Desk is locked.'),
	};

	// ---- bytes and text -----------------------------------------------------

	function utf8(text) {
		return new TextEncoder().encode(String(text));
	}

	function fromUtf8(bytes) {
		return new TextDecoder('utf-8').decode(bytes);
	}

	function toBase64(bytes) {
		var s = '';
		for (var i = 0; i < bytes.length; i += 0x8000) {
			s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(s);
	}

	function fromBase64(text) {
		var s = atob(String(text || '').replace(/\s+/g, ''));
		var out = new Uint8Array(s.length);
		for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	function asBytes(textOrBytes) {
		if (textOrBytes instanceof Uint8Array) return textOrBytes;
		if (typeof ArrayBuffer !== 'undefined' && textOrBytes instanceof ArrayBuffer) return new Uint8Array(textOrBytes);
		if (textOrBytes && typeof textOrBytes === 'object' && typeof textOrBytes.byteLength === 'number' && textOrBytes.buffer) {
			return new Uint8Array(textOrBytes.buffer, textOrBytes.byteOffset, textOrBytes.byteLength);
		}
		return utf8(textOrBytes == null ? '' : textOrBytes);
	}

	function toHex(buffer) {
		var u8 = new Uint8Array(buffer);
		var s = '';
		for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
		return s;
	}

	// The id git gives a file with this content: what GitHub reports as its sha.
	function blobSha(textOrBytes) {
		var body = asBytes(textOrBytes);
		var head = utf8('blob ' + body.length + '\0');
		var all = new Uint8Array(head.length + body.length);
		all.set(head, 0);
		all.set(body, head.length);
		return root.crypto.subtle.digest('SHA-1', all).then(toHex);
	}

	// 'notes//a.md' and '/notes/a.md' are mistakes, '..' is refused outright.
	function cleanPath(path, allowEmpty) {
		var p = String(path == null ? '' : path).replace(/^\/+|\/+$/g, '');
		if (!p) {
			if (allowEmpty) return '';
			throw new errors.GitHubError('A file path is needed.');
		}
		var parts = p.split('/');
		for (var i = 0; i < parts.length; i++) {
			if (!parts[i] || parts[i] === '.' || parts[i] === '..' || /[\\\0]/.test(parts[i])) {
				throw new errors.GitHubError('"' + path + '" is not a usable file path.');
			}
		}
		return p;
	}

	function encodePath(p) {
		return p.split('/').map(encodeURIComponent).join('/');
	}

	// ---- the client ---------------------------------------------------------

	function create(config) {
		var apiBase = String(config.apiBase || 'https://api.github.com').replace(/\/+$/, '');
		var doFetch = config.fetch || function (url, init) {
			return root.fetch(url, init);
		};
		var repos = { site: config.site, private: config.priv };
		var tickets = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
		var ticketCount = 0;
		var shas = { site: {}, private: {} };
		var trees = { site: null, private: null };
		var lastRate = null;
		var inFlight = 0;
		var writesInFlight = 0;

		function repoOf(target) {
			var r = repos[target];
			if (!r || !r.owner || !r.repo) throw new errors.GitHubError('Unknown repository "' + target + '". Use \'private\' or \'site\'.');
			// 'private' writes need no ticket, so it must never be the site under another name.
			if (target === 'private' && repos.site && String(r.owner).toLowerCase() === String(repos.site.owner).toLowerCase() && String(r.repo).toLowerCase() === String(repos.site.repo).toLowerCase()) {
				throw new errors.PublishNotConfirmed('The private repository is set to the public site. Nothing was sent.', { target: target });
			}
			return r;
		}

		function repoPath(target, suffix) {
			var r = repoOf(target);
			return '/repos/' + encodeURIComponent(r.owner) + '/' + encodeURIComponent(r.repo) + (suffix || '');
		}

		function fullName(target) {
			var r = repoOf(target);
			return r.owner + '/' + r.repo;
		}

		// ---- tickets ----------------------------------------------------------

		// Called by the frame once the owner has pressed the confirm button.
		// spec: { paths: [...] } for file changes on 'site', or { graphql: 'mutation ...' }
		// for that one GraphQL document. The grant (kept here, never handed out)
		// is what the last gate in request() compares each request with.
		var grants = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
		function issueTicket(spec) {
			var entry;
			if (spec && spec.graphql !== undefined) {
				if (typeof spec.graphql !== 'string' || !spec.graphql) throw new errors.GitHubError('A GraphQL ticket needs the document it is for.');
				entry = { op: 'graphql', graphql: spec.graphql, paths: [], used: false };
			} else {
				var paths = ((spec && spec.paths) || []).map(function (p) {
					return cleanPath(typeof p === 'string' ? p : p && p.path);
				});
				entry = { op: 'files', paths: paths, used: false };
			}
			entry.expires = Date.now() + TICKET_MS;
			var ticket = Object.freeze({ id: ++ticketCount, op: entry.op, paths: Object.freeze(entry.paths.slice()), expires: entry.expires });
			Object.freeze(entry.paths);
			tickets.set(ticket, entry);
			grants.add(entry);
			return ticket;
		}

		// The grant 'site' probes run under (only a client made with { probeSite: true }).
		var PROBE_GRANT = { op: 'probe', paths: [] };
		grants.add(PROBE_GRANT);

		// Returns a function to call when the write has succeeded (the ticket is
		// then spent); its .grant goes with each request as ctx.cleared. A failed
		// write leaves the ticket usable until it expires.
		function useTicket(target, ticket, paths) {
			if (target !== 'site') return function () {};
			var entry = ticket && typeof ticket === 'object' ? tickets.get(ticket) : null;
			if (!entry) throw new errors.PublishNotConfirmed('This would change the public site, and nobody confirmed it. Nothing was sent.', { target: target, paths: paths });
			if (entry.op !== 'files') throw new errors.PublishNotConfirmed('That confirmation was for something else, not for changing files on the site. Nothing was sent.', { target: target, paths: paths });
			if (entry.used) throw new errors.PublishNotConfirmed('That confirmation was already used. Confirm again to publish again. Nothing was sent.', { target: target, paths: paths });
			if (Date.now() > entry.expires) throw new errors.PublishNotConfirmed('The confirmation is more than two minutes old. Confirm again. Nothing was sent.', { target: target, paths: paths });
			for (var i = 0; i < paths.length; i++) {
				if (entry.paths.indexOf(paths[i]) === -1) {
					throw new errors.PublishNotConfirmed('The confirmation does not cover ' + paths[i] + '. Nothing was sent.', { target: target, paths: paths });
				}
			}
			var spend = function () {
				entry.used = true;
			};
			spend.grant = entry;
			return spend;
		}

		// ---- one request ------------------------------------------------------

		function permissionFor(method, apiPath, hint) {
			if (hint) return hint;
			if (/^\/repos\/[^/]+\/[^/]+\/actions\b/.test(apiPath)) return 'Actions: read';
			if (/^\/repos\/[^/]+\/[^/]+\/pages\b/.test(apiPath)) return 'Pages: read';
			if (/^\/repos\/[^/]+\/[^/]+\/deployments\b/.test(apiPath)) return 'Deployments: read';
			if (/^\/repos\/[^/]+\/[^/]+\/(contents|git|commits)\b/.test(apiPath)) return method === 'GET' ? 'Contents: read' : 'Contents: read and write';
			if (/^\/repos\/[^/]+\/[^/]+$/.test(apiPath)) return 'Metadata: read';
			return '';
		}

		function noteRate(headers) {
			if (!headers || !headers.get) return;
			var remaining = headers.get('x-ratelimit-remaining');
			var reset = headers.get('x-ratelimit-reset');
			if (remaining == null || remaining === '') return;
			lastRate = {
				limit: Number(headers.get('x-ratelimit-limit')) || 0,
				remaining: Number(remaining),
				used: Number(headers.get('x-ratelimit-used')) || 0,
				reset: reset ? new Date(Number(reset) * 1000) : null,
			};
			if (config.onRate) {
				try {
					config.onRate(lastRate);
				} catch (e) {
					/* a listener's problem */
				}
			}
		}

		function toError(status, data, headers, ctx) {
			var detail = data && typeof data.message === 'string' ? data.message : '';
			var where = ctx.target ? fullName(ctx.target) : '';
			var fields = { status: status, target: ctx.target, path: ctx.path, detail: detail };

			if (status === 401) {
				if (config.onUnauthorized) {
					try {
						config.onUnauthorized();
					} catch (e) {
						/* a listener's problem */
					}
				}
				return new errors.Unauthorized('GitHub did not accept the token. It may have expired or been revoked; make a new one and paste it in.', fields);
			}

			if (status === 403 || status === 429) {
				var remaining = headers && headers.get ? headers.get('x-ratelimit-remaining') : null;
				var retryAfter = headers && headers.get ? headers.get('retry-after') : null;
				if (remaining === '0' || retryAfter || /rate limit/i.test(detail)) {
					var resetAt = null;
					if (retryAfter && Number(retryAfter) > 0) resetAt = new Date(Date.now() + Number(retryAfter) * 1000);
					else if (headers && headers.get && headers.get('x-ratelimit-reset')) resetAt = new Date(Number(headers.get('x-ratelimit-reset')) * 1000);
					fields.resetAt = resetAt;
					return new errors.RateLimited('GitHub is rate limiting this token' + (resetAt ? ' until ' + clock(resetAt) : '') + '. Nothing is lost; try again then.', fields);
				}
				var permission = permissionFor(ctx.method, ctx.apiPath, ctx.permission);
				fields.permission = permission;
				return new errors.Forbidden(
					'The token is not allowed to do this' + (permission ? ': it lacks the permission "' + permission + '"' + (where ? ' on ' + where : '') : where ? ' on ' + where : '') + '.',
					fields
				);
			}

			if (status === 404) {
				return new errors.NotFound((ctx.path ? ctx.path + ' was not found' : 'Not found') + (where ? ' in ' + where : '') + '. (GitHub also answers this when the token was not given access to the repository.)', fields);
			}

			if (status === 409 && EMPTY_RE.test(detail)) {
				fields.emptyRepository = true;
				return new errors.Conflict((where || 'The repository') + ' is empty: it has no commit yet.', fields);
			}

			if (status === 409 || (status === 422 && ctx.write && /"sha" wasn't supplied|does not match|not a fast forward/i.test(detail))) {
				return new errors.Conflict((ctx.path || 'The file') + ' changed on GitHub since it was read here. Nothing was overwritten.', fields);
			}

			if (status >= 500) return new errors.GitHubError('GitHub had a problem of its own (HTTP ' + status + '). Try again in a moment.', fields);
			return new errors.GitHubError('GitHub refused the request (HTTP ' + status + ')' + (detail ? ': ' + detail.split('\n')[0] : '') + '.', fields);
		}

		function clock(date) {
			var h = date.getHours();
			var m = date.getMinutes();
			return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
		}

		// onActivity(requests in flight, of which writes)
		function activity(delta, write) {
			inFlight += delta;
			if (write) writesInFlight += delta;
			if (config.onActivity) {
				try {
					config.onActivity(inFlight, writesInFlight);
				} catch (e) {
					/* a listener's problem */
				}
			}
		}

		// Is apiPath inside the private repository (/repos/<owner>/<repo> or below)?
		function inPrivate(apiPath) {
			return inRepo(apiPath, repos.private);
		}

		function inRepo(apiPath, r) {
			if (!r || !r.owner || !r.repo) return false;
			var m = /^\/repos\/([^/?#]+)\/([^/?#]+)(?:\/|$)/.exec(apiPath);
			if (!m) return false;
			var owner;
			var name;
			try {
				owner = decodeURIComponent(m[1]);
				name = decodeURIComponent(m[2]);
			} catch (e) {
				return false;
			}
			return owner.toLowerCase() === String(r.owner).toLowerCase() && name.toLowerCase() === String(r.repo).toLowerCase() && !/(^|\/)\.\.?(\/|$)|%2e|%2f|\\/i.test(apiPath);
		}

		// The last gate. GraphQL goes only by POST, and a mutation only with the
		// grant of a ticket issued for exactly that document. Anything else that
		// is not GET or HEAD goes to the private repository, or to the site with
		// the grant of a ticket for files that covers the file it names (or the
		// sign-in probe's grant, for one blob). The grant (ctx.cleared) is set
		// only by the ticket checks above; anything else in it counts as none.
		function guardWrite(method, apiPath, ctx) {
			var m = String(method || '').toUpperCase();
			var grant = ctx.cleared && typeof ctx.cleared === 'object' && grants.has(ctx.cleared) ? ctx.cleared : null;
			// The path as the server will read it: percent escapes decoded, and no
			// "." or ".." segment or backslash that the URL parser would fold away.
			var plain;
			try {
				plain = decodeURIComponent(String(apiPath));
			} catch (e) {
				plain = null;
			}
			if (plain === null || /(^|\/)\.\.?(\/|$)|\\/.test(plain)) throw new errors.PublishNotConfirmed('That API path is not one the Desk sends. Nothing was sent.');
			if (/^\/+graphql(?![_0-9A-Za-z-])/i.test(plain)) {
				if (m !== 'POST' || apiPath !== '/graphql') throw new errors.PublishNotConfirmed('GraphQL is only sent by POST through gh.graphql(). Nothing was sent.');
				var doc = ctx.body && ctx.body.query;
				if (!isMutation(doc)) return;
				if (grant && grant.op === 'graphql' && typeof doc === 'string' && grant.graphql === doc) return;
				throw new errors.PublishNotConfirmed('A GraphQL mutation changes something public, and nobody confirmed it. Nothing was sent.');
			}
			if (m === 'GET' || m === 'HEAD') return;
			if (inPrivate(apiPath)) return;
			if (grant && inRepo(apiPath, repos.site)) {
				if (grant.op === 'files' && (!ctx.path || grant.paths.indexOf(ctx.path) !== -1)) return;
				if (grant.op === 'probe' && m === 'POST' && /\/git\/blobs$/.test(apiPath)) return;
			}
			throw new errors.PublishNotConfirmed('This would change the public site (or something outside the private repository), and nobody confirmed it. Nothing was sent.', { target: ctx.target, path: ctx.path });
		}

		// ctx: { target, path, permission, write, query, body, cleared }
		// Resolves with { status, data }.
		function request(method, apiPath, ctx) {
			ctx = ctx || {};
			ctx.method = method;
			ctx.apiPath = apiPath;
			var token;
			try {
				token = config.token ? config.token() : '';
			} catch (e) {
				return Promise.reject(e);
			}
			if (!token) return Promise.reject(new errors.Locked());
			// The last gate, under every caller: anything but a read goes only to
			// the private repository, or to GraphQL as a query, unless the caller
			// above has already checked a ticket for it (ctx.cleared).
			try {
				guardWrite(method, apiPath, ctx);
			} catch (e) {
				token = null;
				return Promise.reject(e);
			}

			var url = apiBase + apiPath;
			if (ctx.query) {
				var parts = [];
				Object.keys(ctx.query).forEach(function (k) {
					var v = ctx.query[k];
					if (v === undefined || v === null || v === '') return;
					parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
				});
				if (parts.length) url += '?' + parts.join('&');
			}
			var init = {
				method: method,
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: 'Bearer ' + token,
					'X-GitHub-Api-Version': API_VERSION,
				},
				cache: 'no-store',
				credentials: 'omit',
				mode: 'cors',
				redirect: 'manual',
				referrerPolicy: 'no-referrer',
			};
			if (ctx.body !== undefined) {
				init.headers['Content-Type'] = 'application/json';
				init.body = JSON.stringify(ctx.body);
			}
			token = null;

			activity(1, ctx.write);
			return doFetch(url, init).then(
				function (res) {
					noteRate(res.headers);
					if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
						activity(-1, ctx.write);
						if (res.body && res.body.cancel) res.body.cancel().catch(function () {});
						throw new errors.GitHubError('GitHub redirected this request: the repository may have been renamed or moved.', { status: res.status, target: ctx.target, path: ctx.path });
					}
					return res.text().then(
						function (text) {
							activity(-1, ctx.write);
							var data = null;
							if (text) {
								try {
									data = JSON.parse(text);
								} catch (e) {
									data = null;
								}
							}
							if (res.ok) return { status: res.status, data: data };
							throw toError(res.status, data, res.headers, ctx);
						},
						function () {
							activity(-1, ctx.write);
							throw new errors.Offline('The connection to GitHub broke off mid-answer.', { target: ctx.target, path: ctx.path });
						}
					);
				},
				function () {
					activity(-1, ctx.write);
					// fetch() rejects without detail when the network is down, the name
					// does not resolve, or the browser blocked the request.
					throw new errors.Offline(undefined, { target: ctx.target, path: ctx.path });
				}
			);
		}

		// ---- who and where ----------------------------------------------------

		function user() {
			return request('GET', '/user', {}).then(function (r) {
				var u = r.data || {};
				return { login: u.login, id: u.id, name: u.name || '', avatar: u.avatar_url || '', url: u.html_url || '' };
			});
		}

		function repo(target) {
			return request('GET', repoPath(target), { target: target }).then(function (r) {
				var d = r.data || {};
				return {
					fullName: d.full_name,
					isPrivate: d.private === true,
					visibility: d.visibility || (d.private ? 'private' : 'public'),
					defaultBranch: d.default_branch,
					pushedAt: d.pushed_at || null,
					url: d.html_url || '',
					sizeKb: d.size || 0,
					canPush: !!(d.permissions && d.permissions.push),
					hasDiscussions: !!d.has_discussions,
					hasPages: !!d.has_pages,
				};
			});
		}

		function rate() {
			return request('GET', '/rate_limit', {}).then(function (r) {
				var core = (r.data && r.data.resources && r.data.resources.core) || (r.data && r.data.rate) || {};
				lastRate = { limit: core.limit || 0, remaining: core.remaining || 0, used: core.used || 0, reset: core.reset ? new Date(core.reset * 1000) : null };
				return lastRate;
			});
		}

		// ---- reading ----------------------------------------------------------

		function remember(target, path, sha) {
			if (sha) shas[target][path] = sha;
			else delete shas[target][path];
		}

		function contents(target, path) {
			var r;
			try {
				r = repoOf(target);
			} catch (e) {
				return Promise.reject(e);
			}
			return request('GET', repoPath(target, '/contents/' + encodePath(path)), { target: target, path: path, query: { ref: r.branch } });
		}

		// -> { bytes, sha } or null when there is no such file.
		function readBytes(target, path) {
			var p;
			try {
				p = cleanPath(path);
			} catch (e) {
				return Promise.reject(e);
			}
			return contents(target, p).then(
				function (r) {
					var d = r.data;
					if (Array.isArray(d)) throw new errors.GitHubError(p + ' is a folder, not a file.', { target: target, path: p });
					if (!d || d.type !== 'file') throw new errors.GitHubError(p + ' is not a plain file.', { target: target, path: p });
					remember(target, p, d.sha);
					if (d.encoding === 'base64' && (d.content || d.size === 0)) return { bytes: fromBase64(d.content), sha: d.sha };
					// Over 1 MB the contents API sends no content; the blob API does (up to 100 MB).
					return request('GET', repoPath(target, '/git/blobs/' + d.sha), { target: target, path: p }).then(function (b) {
						return { bytes: fromBase64(b.data.content), sha: d.sha };
					});
				},
				function (err) {
					if (err instanceof errors.NotFound || (err instanceof errors.Conflict && err.emptyRepository)) {
						remember(target, p, null);
						return null;
					}
					throw err;
				}
			);
		}

		// -> { text, sha } or null.
		function read(target, path) {
			return readBytes(target, path).then(function (r) {
				return r ? { text: fromUtf8(r.bytes), sha: r.sha } : null;
			});
		}

		// -> the parsed JSON, or `fallback` when the file does not exist.
		function readJSON(target, path, fallback) {
			return read(target, path).then(function (r) {
				if (!r) return fallback;
				try {
					return JSON.parse(r.text.charCodeAt(0) === 0xfeff ? r.text.slice(1) : r.text);
				} catch (e) {
					throw new errors.GitHubError(path + ' is not valid JSON: ' + e.message, { target: target, path: path });
				}
			});
		}

		// -> [{ name, path, sha, size, type }], type 'file' or 'dir'. A folder that
		// does not exist is an empty list.
		function list(target, dir) {
			var d;
			try {
				d = cleanPath(dir, true);
			} catch (e) {
				return Promise.reject(e);
			}
			return contents(target, d).then(
				function (r) {
					if (!Array.isArray(r.data)) throw new errors.GitHubError((d || '/') + ' is a file, not a folder.', { target: target, path: d });
					return r.data.map(function (e) {
						if (e.type === 'file') remember(target, e.path, e.sha);
						return { name: e.name, path: e.path, sha: e.sha, size: e.size || 0, type: e.type === 'dir' ? 'dir' : e.type };
					});
				},
				function (err) {
					if (err instanceof errors.NotFound || (err instanceof errors.Conflict && err.emptyRepository)) return [];
					throw err;
				}
			);
		}

		// A copy the caller may change; .truncated says GitHub cut the listing short
		// (over 100,000 entries or 7 MB, far beyond these two repositories).
		function copyTree(list) {
			var out = list.slice();
			out.truncated = !!list.truncated;
			return out;
		}

		// -> every path in the repository: [{ path, sha, size, type }], type 'file'
		// or 'dir'. Cached until this client writes to the repository; pass
		// { refresh: true } to ask GitHub again.
		function tree(target, opts) {
			if (trees[target] && !(opts && opts.refresh)) return Promise.resolve(copyTree(trees[target]));
			var r;
			try {
				r = repoOf(target);
			} catch (e) {
				return Promise.reject(e);
			}
			return request('GET', repoPath(target, '/git/trees/' + encodeURIComponent(r.branch)), { target: target, query: { recursive: 1 } }).then(
				function (res) {
					var out = ((res.data && res.data.tree) || []).map(function (e) {
						if (e.type === 'blob') remember(target, e.path, e.sha);
						return { path: e.path, sha: e.sha, size: e.size || 0, type: e.type === 'tree' ? 'dir' : 'file' };
					});
					out.truncated = !!(res.data && res.data.truncated);
					trees[target] = out;
					return copyTree(out);
				},
				function (err) {
					// A repository with no commit yet has no tree (409, or 404 for the branch).
					if ((err instanceof errors.Conflict && err.emptyRepository) || err instanceof errors.NotFound) return [];
					throw err;
				}
			);
		}

		// The sha this client last saw for a path (from read, list, tree or a
		// write), or null. Handy as the `sha` of the next write.
		function shaOf(target, path) {
			var p = String(path || '').replace(/^\/+|\/+$/g, '');
			return (shas[target] && shas[target][p]) || null;
		}

		// ---- writing ----------------------------------------------------------

		// A write whose answer never arrived (the connection broke, or GitHub
		// failed after the fact) may have landed anyway.
		function maybeLanded(err) {
			return err instanceof errors.Offline || (err instanceof errors.GitHubError && err.status >= 500);
		}

		var RETRY_MS = config.retryMs >= 0 ? Number(config.retryMs) : 1500;

		// Runs look() up to three times while GitHub is out of reach. If it stays
		// out of reach, the error says the change may be live (.maybeCommitted).
		function askAgain(look, target, maybe, after) {
			var tries = 0;
			function again() {
				return look().catch(function (err) {
					if (++tries < 3 && err instanceof errors.Offline) {
						return new Promise(function (resolve) {
							setTimeout(resolve, RETRY_MS * tries);
						}).then(again);
					}
					throw new errors.Offline('GitHub\'s answer was lost, and GitHub could not be asked afterwards whether the change arrived. ' + (after || 'It may already be live: look before trying again.'), { target: target, maybeCommitted: maybe || true });
				});
			}
			return again();
		}

		// The blob sha at path now, or null when there is no such file.
		function shaNow(target, p) {
			return contents(target, p).then(
				function (res) {
					return res.data && !Array.isArray(res.data) ? res.data.sha || null : null;
				},
				function (e) {
					if (e instanceof errors.NotFound) return null;
					throw e;
				}
			);
		}

		// After a lost answer: is what we asked for there now (want: the blob
		// sha we wrote, or null for a removal)? Already there with the same
		// content counts as done; anything else is the original error.
		function reconcile(target, p, err, want) {
			if (!maybeLanded(err)) return Promise.reject(err);
			return askAgain(
				function () {
					return shaNow(target, p);
				},
				target,
				true,
				want === null ? 'The file may already be gone: look before trying again.' : ''
			).then(function (have) {
				if (have === want) return have;
				throw err;
			});
		}

		// Creates or updates one file. Pass the sha you read ({ sha }) so that a
		// change made elsewhere in the meantime is refused (Conflict) instead of
		// overwritten; without a sha an existing file is refused too.
		// 'site' needs { ticket }. -> { sha, commit }
		function write(target, path, textOrBytes, opts) {
			opts = opts || {};
			var p;
			var spend;
			var r;
			try {
				p = cleanPath(path);
				r = repoOf(target);
				spend = useTicket(target, opts.ticket, [p]);
			} catch (e) {
				return Promise.reject(e);
			}
			var body = {
				message: opts.message || (opts.sha ? 'Update ' : 'Add ') + p,
				content: toBase64(asBytes(textOrBytes)),
				branch: r.branch,
			};
			if (opts.sha) body.sha = opts.sha;
			var bytes = asBytes(textOrBytes);
			return request('PUT', repoPath(target, '/contents/' + encodePath(p)), { target: target, path: p, write: true, cleared: spend.grant, body: body }).then(
				function (res) {
					spend();
					trees[target] = null;
					var sha = res.data && res.data.content ? res.data.content.sha : null;
					remember(target, p, sha);
					return { sha: sha, commit: res.data && res.data.commit ? res.data.commit.sha : null };
				},
				function (err) {
					if (!maybeLanded(err)) throw err;
					return blobSha(bytes).then(function (want) {
						return reconcile(target, p, err, want).then(function (sha) {
							spend();
							trees[target] = null;
							remember(target, p, sha);
							return { sha: sha, commit: null, reconciled: true };
						});
					});
				}
			);
		}

		// Deletes one file. Without { sha } the current one is looked up first.
		// 'site' needs { ticket }. -> { commit }
		function remove(target, path, opts) {
			opts = opts || {};
			var p;
			var spend;
			var r;
			try {
				p = cleanPath(path);
				r = repoOf(target);
				spend = useTicket(target, opts.ticket, [p]);
			} catch (e) {
				return Promise.reject(e);
			}
			var known = opts.sha
				? Promise.resolve(opts.sha)
				: contents(target, p).then(function (res) {
						if (Array.isArray(res.data)) throw new errors.GitHubError(p + ' is a folder, not a file.', { target: target, path: p });
						return res.data.sha;
					});
			return known
				.then(function (sha) {
					return request('DELETE', repoPath(target, '/contents/' + encodePath(p)), {
						target: target,
						path: p,
						write: true,
						cleared: spend.grant,
						body: { message: opts.message || 'Delete ' + p, sha: sha, branch: r.branch },
					}).catch(function (err) {
						// The answer was lost: if the file is gone now, it is done.
						return reconcile(target, p, err, null).then(function () {
							return { data: null, reconciled: true };
						});
					});
				})
				.then(function (res) {
					spend();
					trees[target] = null;
					remember(target, p, null);
					var out = { commit: res.data && res.data.commit ? res.data.commit.sha : null };
					if (res.reconciled) out.reconciled = true;
					return out;
				});
		}

		// One commit that touches several files:
		//   [{ path, content: 'text' } | { path, bytes: Uint8Array } | { path, remove: true }]
		// A change may carry `sha` (the blob sha you expect to be there now; null
		// for "must not exist yet"): if GitHub has something else, nothing is
		// committed and the call rejects with Conflict.
		// 'site' needs { ticket } covering every path. -> { commit, files: { path: sha | null } }
		function commit(target, changes, message, opts) {
			opts = opts || {};
			var list;
			var spend;
			var r;
			try {
				r = repoOf(target);
				if (!Array.isArray(changes) || !changes.length) throw new errors.GitHubError('A commit needs at least one file.');
				if (!message || typeof message !== 'string') throw new errors.GitHubError('A commit needs a message.');
				var seen = {};
				list = changes.map(function (c) {
					var p = cleanPath(c && c.path);
					if (seen[p]) throw new errors.GitHubError(p + ' appears twice in one commit.');
					seen[p] = true;
					var item = { path: p, remove: c.remove === true, expect: c.sha, bytes: null, blob: null };
					if (!item.remove) {
						if (c.bytes != null) item.bytes = asBytes(c.bytes);
						else if (typeof c.content === 'string') item.bytes = utf8(c.content);
						else throw new errors.GitHubError(p + ' has neither content nor bytes.');
					}
					return item;
				});
				spend = useTicket(target, opts.ticket, list.map(function (c) {
					return c.path;
				}));
			} catch (e) {
				return Promise.reject(e);
			}
			var base = repoPath(target);
			var refPath = '/git/refs/heads/' + encodeURIComponent(r.branch);
			var ctx = function (extra) {
				// The ticket (for 'site') was checked above, before anything was sent.
				var c = { target: target, write: true, cleared: spend.grant };
				Object.keys(extra || {}).forEach(function (k) {
					c[k] = extra[k];
				});
				return c;
			};

			// What is still to be committed (the first file of a brand-new
			// repository goes in separately, see firstCommit).
			function todo() {
				return list.filter(function (item) {
					return !item.done;
				});
			}

			// Blobs are made once and reused if the commit has to be rebuilt.
			function makeBlobs() {
				var chain = Promise.resolve();
				todo().forEach(function (item) {
					if (item.remove || item.blob) return;
					chain = chain.then(function () {
						return request('POST', base + '/git/blobs', ctx({ path: item.path, body: { content: toBase64(item.bytes), encoding: 'base64' } })).then(function (res) {
							item.blob = res.data.sha;
						});
					});
				});
				return chain;
			}

			function attempt(triesLeft) {
				var head;
				return request('GET', base + '/git/ref/heads/' + encodeURIComponent(r.branch), { target: target })
					.catch(function (err) {
						// No such branch: a repository without any commit answers 409
						// here, but a 404 means the same thing for our purpose.
						if (err instanceof errors.NotFound) err.noBranch = true;
						throw err;
					})
					.then(function (res) {
						head = res.data.object.sha;
						return request('GET', base + '/git/commits/' + head, { target: target });
					})
					.then(function (res) {
						var baseTree = res.data.tree.sha;
						return request('GET', base + '/git/trees/' + baseTree, { target: target, query: { recursive: 1 } }).then(function (t) {
							var now = {};
							((t.data && t.data.tree) || []).forEach(function (e) {
								if (e.type === 'blob') now[e.path] = e.sha;
							});
							todo().forEach(function (item) {
								if (item.expect === undefined) return;
								var have = now[item.path] || null;
								if (have !== (item.expect || null)) {
									throw new errors.Conflict(item.path + ' changed on GitHub since it was read here. Nothing was committed.', { target: target, path: item.path, status: 409 });
								}
							});
							return makeBlobs().then(function () {
								var entries = [];
								todo().forEach(function (item) {
									if (item.remove) {
										if (now[item.path]) entries.push({ path: item.path, mode: '100644', type: 'blob', sha: null });
									} else if (now[item.path] !== item.blob) entries.push({ path: item.path, mode: '100644', type: 'blob', sha: item.blob });
								});
								if (!entries.length) return null;
								return request('POST', base + '/git/trees', ctx({ body: { base_tree: baseTree, tree: entries } }));
							});
						});
					})
					.then(function (res) {
						if (!res) return null; // nothing would change: no empty commit is made
						return request('POST', base + '/git/commits', ctx({ body: { message: message, tree: res.data.sha, parents: [head] } }));
					})
					.then(function (res) {
						if (!res) return null;
						var sha = res.data.sha;
						return request('PATCH', base + refPath, ctx({ body: { sha: sha, force: false } })).then(
							function () {
								return sha;
							},
							function (err) {
								// Someone (the index-building Action, another device) pushed in
								// between. Rebuild on the new head; the expected shas are
								// checked again there, so nothing is silently overwritten.
								if (err instanceof errors.Conflict && triesLeft > 0) return attempt(triesLeft - 1);
								// The answer was lost (or GitHub failed after the fact):
								// the branch may well point at the commit already. Ask.
								if (err instanceof errors.Offline || (err instanceof errors.GitHubError && !(err.status >= 400 && err.status < 500))) {
									return landed(sha).then(function (yes) {
										if (yes) return sha;
										throw err;
									});
								}
								throw err;
							}
						);
					});
			}

			// Did the branch take this commit, although the answer to the
			// PATCH never arrived? It is the head, or a few commits below it
			// (the index-building Action pushes right after a post). Asks up to
			// three times; if GitHub stays out of reach, the error says that the
			// commit may be live, and carries .maybeCommitted.
			function landed(sha) {
				function look() {
					return request('GET', base + '/git/ref/heads/' + encodeURIComponent(r.branch), { target: target }).then(function (res) {
						var head = res.data && res.data.object && res.data.object.sha;
						var at = head;
						var steps = 0;
						function walk() {
							if (at === sha) return true;
							if (!at || steps++ >= 8) return sameContent(head);
							return request('GET', base + '/git/commits/' + at, { target: target }).then(function (c) {
								var parents = (c.data && c.data.parents) || [];
								at = parents.length ? parents[0].sha : null;
								return walk();
							});
						}
						return walk();
					});
				}
				// Not in the recent history: does the branch hold exactly what this
				// commit was to make (every file as written, every removal gone)?
				// Then it is there, whoever's commit put it there.
				function sameContent(head) {
					if (!head) return false;
					return request('GET', base + '/git/commits/' + head, { target: target })
						.then(function (c) {
							return request('GET', base + '/git/trees/' + c.data.tree.sha, { target: target, query: { recursive: 1 } });
						})
						.then(function (t) {
							var now = {};
							((t.data && t.data.tree) || []).forEach(function (e) {
								if (e.type === 'blob') now[e.path] = e.sha;
							});
							return todo().every(function (item) {
								return item.remove ? !now[item.path] : !!item.blob && now[item.path] === item.blob;
							});
						});
				}
				return askAgain(look, target, sha);
			}

			// A brand-new repository has no commit, and the git data API refuses to
			// work on it. The contents API can make the first commit, with one file
			// (the README when there is one); the rest follows as a second commit.
			function firstCommit() {
				var first = null;
				list.forEach(function (item) {
					if (item.remove) return;
					if (!first || item.path.toLowerCase() === 'readme.md') first = item;
				});
				if (!first) return Promise.resolve(null);
				return request('PUT', base + '/contents/' + encodePath(first.path), ctx({ path: first.path, body: { message: message, content: toBase64(first.bytes), branch: r.branch } })).then(function (res) {
					first.blob = res.data.content.sha;
					first.done = true;
					var sha = res.data.commit.sha;
					var left = todo().filter(function (item) {
						return !item.remove;
					});
					if (!left.length) return sha;
					return attempt(2).then(function (second) {
						return second || sha;
					});
				});
			}

			return attempt(2)
				.catch(function (err) {
					if ((err instanceof errors.Conflict && err.emptyRepository) || err.noBranch) return firstCommit();
					throw err;
				})
				.then(function (sha) {
					spend();
					trees[target] = null;
					var files = {};
					list.forEach(function (item) {
						files[item.path] = item.remove ? null : item.blob;
						remember(target, item.path, item.remove ? null : item.blob);
					});
					return { commit: sha, files: files };
				});
		}

		// Can this token write to the repository? Makes an unreferenced blob: no
		// branch changes, nothing is published. -> true, or 'empty' when the
		// repository has no commit yet (GitHub cannot say then). Rejects with
		// Forbidden when the token may only read.
		// Only a client made with { probeSite: true } (the wizard's own, which no
		// view ever sees) may probe 'site': it is a write call, even if nothing
		// becomes visible, and views write to 'site' only with a ticket.
		function probeWrite(target) {
			if (target === 'site' && config.probeSite !== true) {
				return Promise.reject(new errors.PublishNotConfirmed('Probing the public site is only done by the sign-in checks. Nothing was sent.', { target: target }));
			}
			var blobs;
			try {
				blobs = repoPath(target, '/git/blobs');
			} catch (e) {
				return Promise.reject(e);
			}
			return request('POST', blobs, {
				target: target,
				write: true,
				cleared: target === 'site' && config.probeSite === true ? PROBE_GRANT : null,
				body: { content: 'Desk permission check. This blob belongs to no commit.\n', encoding: 'utf-8' },
			}).then(
				function () {
					return true;
				},
				function (err) {
					// 409 is what an empty repository answers; a 404 on a repository
					// that was just seen can only mean the same. Either way the
					// first real write is the test.
					if ((err instanceof errors.Conflict && err.emptyRepository) || err instanceof errors.NotFound) return 'empty';
					throw err;
				}
			);
		}

		// ---- everything else ----------------------------------------------------

		// A GET on any other REST path of the API: gh.get('/repos/o/r/actions/runs', { per_page: 5 }).
		// gh.repoPath('site', '/actions/runs') builds such a path. -> the parsed JSON
		function get(apiPath, params) {
			if (typeof apiPath !== 'string' || apiPath.charAt(0) !== '/' || apiPath.indexOf('//') !== -1 || /[?#]/.test(apiPath)) {
				return Promise.reject(new errors.GitHubError('gh.get takes an API path that starts with "/" and has no query string; pass the query as the second argument.'));
			}
			// GraphQL goes through gh.graphql() only, by POST, where mutations need a ticket.
			if (/^\/+graphql(?![_0-9A-Za-z-])/i.test(apiPath)) {
				return Promise.reject(new errors.PublishNotConfirmed('gh.get does not send GraphQL; use gh.graphql(). Nothing was sent.'));
			}
			var target;
			var m = /^\/repos\/([^/]+)\/([^/]+)/.exec(apiPath);
			if (m) {
				['site', 'private'].forEach(function (t) {
					var r = repos[t];
					if (r && r.owner && String(r.owner).toLowerCase() === decodeURIComponent(m[1]).toLowerCase() && String(r.repo).toLowerCase() === decodeURIComponent(m[2]).toLowerCase()) target = t;
				});
			}
			return request('GET', apiPath, { target: target, query: params }).then(function (r) {
				return r.data;
			});
		}

		// Does this document need a ticket? Allow-list, failing closed: the
		// document is read the way GitHub's parser reads it (whitespace, commas,
		// the byte-order mark and # comments up to \n or \r are all ignored;
		// strings and block strings are skipped), and every top-level
		// definition must begin with `{` (the query shorthand), `query` or
		// `fragment`. Anything else (`mutation`, `subscription`, a word we do
		// not know, unbalanced brackets, a character GraphQL has no use for)
		// needs a ticket.
		var BOM = String.fromCharCode(0xfeff);
		function isMutation(query) {
			var q = String(query == null ? '' : query);
			var i = 0;
			var n = q.length;
			var depth = 0; // { } ( ) [ ] nesting
			var start = true; // the next token begins a top-level definition
			var defs = 0; // definitions begun
			while (i < n) {
				var c = q.charAt(i);
				if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === BOM) {
					i++;
					continue;
				}
				if (c === '#') {
					while (i < n && q.charAt(i) !== '\n' && q.charAt(i) !== '\r') {
						// A character another parser might take for the end of the line
						// (NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR): what follows is
						// not ours to judge.
						var cc = q.charCodeAt(i);
						if (cc === 0x85 || cc === 0x2028 || cc === 0x2029) return true;
						i++;
					}
					continue;
				}
				if (c === '"') {
					if (start) return true;
					if (q.substr(i, 3) === '"""') {
						i += 3;
						for (;;) {
							if (i >= n) return true;
							if (q.charAt(i) === '\\' && q.substr(i, 4) === '\\"""') i += 4;
							else if (q.substr(i, 3) === '"""') {
								i += 3;
								break;
							} else i++;
						}
					} else {
						i++;
						for (;;) {
							if (i >= n) return true;
							var d = q.charAt(i);
							if (d === '\n' || d === '\r') return true;
							if (d === '\\') i += 2;
							else if (d === '"') {
								i++;
								break;
							} else i++;
						}
					}
					continue;
				}
				var word = /^[_A-Za-z][_0-9A-Za-z]*/.exec(q.slice(i, i + 64));
				if (word) {
					if (start) {
						if (word[0] !== 'query' && word[0] !== 'fragment') return true;
						start = false;
						defs++;
					}
					i += word[0].length;
					continue;
				}
				if (c === '{' || c === '(' || c === '[') {
					if (start) {
						if (c !== '{') return true;
						start = false;
						defs++;
					}
					depth++;
					i++;
					continue;
				}
				if (c === '}' || c === ')' || c === ']') {
					depth--;
					if (depth < 0) return true;
					i++;
					if (depth === 0 && c === '}') start = true;
					continue;
				}
				if (start) return true;
				// Punctuation and numbers inside a definition: $ ! : = @ | & . - digits.
				if (!/[$!:=@|&.\-+0-9]/.test(c)) return true;
				i++;
			}
			// An empty document, or one whose last definition is unfinished, is
			// nothing we can vouch for.
			return depth !== 0 || !start || defs === 0;
		}

		// A GraphQL query. -> the `data` object. A mutation is a change to
		// something public, so it needs { ticket } like any write to 'site'.
		function graphql(query, variables, opts) {
			// One string, read once: what is checked is exactly what is sent (an
			// object whose toString changes between calls gets nowhere).
			var doc = typeof query === 'string' ? query : String(query == null ? '' : query);
			var spend = function () {};
			var cleared = null;
			if (isMutation(doc)) {
				var ticket = opts && opts.ticket;
				var entry = ticket && typeof ticket === 'object' ? tickets.get(ticket) : null;
				if (!entry || entry.used || Date.now() > entry.expires) {
					return Promise.reject(new errors.PublishNotConfirmed('A GraphQL mutation changes something public, and nobody confirmed it. Nothing was sent.'));
				}
				// The ticket must be for this very document, not for some files or another mutation.
				if (entry.op !== 'graphql' || entry.graphql !== doc) {
					return Promise.reject(new errors.PublishNotConfirmed('That confirmation was for something else, not for this GraphQL mutation. Nothing was sent.'));
				}
				spend = function () {
					entry.used = true;
				};
				cleared = entry;
			}
			var about = /discussion/i.test(doc) ? 'Discussions: read' : '';
			return request('POST', '/graphql', { permission: about, cleared: cleared, body: { query: doc, variables: variables || {} } }).then(function (r) {
				var body = r.data || {};
				if (body.errors && body.errors.length) {
					var first = body.errors[0] || {};
					var text = body.errors
						.map(function (e) {
							return e && e.message;
						})
						.filter(Boolean)
						.join(' ');
					var fields = { status: 200, detail: text, data: body.data || null };
					if (first.type === 'FORBIDDEN' || /not accessible/i.test(text)) {
						fields.permission = about;
						throw new errors.Forbidden('The token is not allowed to read this' + (about ? ': it lacks the permission "' + about + '" on ' + fullName('site') : '') + '.', fields);
					}
					if (first.type === 'NOT_FOUND') throw new errors.NotFound('GitHub could not find what the query asked for.', fields);
					if (first.type === 'RATE_LIMITED') throw new errors.RateLimited(undefined, fields);
					throw new errors.GitHubError('GitHub could not answer the query: ' + text, fields);
				}
				spend();
				return body.data;
			});
		}

		var client = {
			user: user,
			repo: repo,
			rate: rate,
			rateSeen: function () {
				return lastRate;
			},
			read: read,
			readJSON: readJSON,
			readBytes: readBytes,
			list: list,
			tree: tree,
			shaOf: shaOf,
			blobSha: blobSha,
			write: write,
			remove: remove,
			commit: commit,
			probeWrite: probeWrite,
			get: get,
			graphql: graphql,
			repoPath: repoPath,
			fullName: fullName,
			errors: errors,
			apiBase: apiBase,
		};

		return { client: client, issueTicket: issueTicket };
	}

	return { create: create, errors: errors, blobSha: blobSha, API_VERSION: API_VERSION };
});
