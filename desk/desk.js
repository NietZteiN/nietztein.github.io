// The Desk's frame: the first-run wizard, lock and unlock, the shell with its
// navigation and status, the Home view, and the object every view receives.
//
// What lives where:
//   - The GitHub token and the keys derived from the passphrase exist only in
//     variables inside this file, while the Desk is unlocked. Locking drops
//     them; reloading the page drops them; nothing writes them anywhere.
//   - localStorage "desk.vault" holds the encrypted token (desk/vault.js).
//   - IndexedDB "desk" holds the encrypted local cache (desk/store.js).
//   - sessionStorage "desk.wizard" remembers the wizard's step and the private
//     repository's name while the owner is away on github.com. Never a token.
//
// Views plug in with window.Desk.registerView({ id, title, icon, order, mount, unmount }).
// desk/README.md describes the api object that mount() receives.

(function () {
	'use strict';

	var UI = window.DeskUI;
	var Vault = window.DeskVault;
	var GH = window.DeskGH;
	var Store = window.DeskStore;
	var h = UI.el;

	var SITE = { owner: 'NietZteiN', repo: 'nietztein.github.io', branch: 'main' };
	var SITE_URL = 'https://nietztein.github.io/';
	var VAULT_KEY = 'desk.vault';
	var WIZARD_KEY = 'desk.wizard';
	var FRAME = 'desk.frame';
	var SETTINGS_PATH = 'desk/settings.json';
	var DEFAULT_LOCK_MINUTES = 30;
	var LOCK_CHOICES = [5, 15, 30, 60, 120];

	// The test harness waits for this to become true.
	window.__toyReady = false;

	var root = null;
	var env = readEnv();
	var views = [];
	var session = null; // everything that exists only while the Desk is unlocked
	var listeners = {};
	var current = null; // the mounted view: { view, el, api, offs }
	var lockNote = '';
	var screen = 'boot'; // 'wizard' | 'locked' | 'open' | 'refused'

	// ---- where am I, and which GitHub --------------------------------------------

	// ?api= and ?goat= point the Desk at fake servers. They are honoured only
	// when this page itself is served from this machine, and only for servers
	// on this machine.
	function readEnv() {
		var local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
		var out = {
			apiBase: 'https://api.github.com',
			goat: '',
			test: false,
			siteRoot: new URL('../', location.href.split(/[?#]/)[0]).href,
		};
		if (!local) return out;
		var params;
		try {
			params = new URLSearchParams(location.search);
		} catch (e) {
			return out;
		}
		var loopback = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}(\/[^?#]*)?$/;
		var api = params.get('api');
		if (api && loopback.test(api)) {
			out.apiBase = api.replace(/\/+$/, '');
			out.test = true;
		}
		var goat = params.get('goat');
		if (goat && loopback.test(goat)) out.goat = goat.replace(/\/+$/, '');
		return out;
	}

	function quiet() {
		/* the status indicator and Home already say what is wrong */
	}

	// ---- events ---------------------------------------------------------------------

	function on(name, fn) {
		(listeners[name] = listeners[name] || []).push(fn);
		return function () {
			var list = listeners[name] || [];
			var i = list.indexOf(fn);
			if (i !== -1) list.splice(i, 1);
		};
	}

	// Calls every listener; returns what they returned (a lock listener may
	// return a promise the frame waits for).
	function emit(name, data) {
		var out = [];
		(listeners[name] || []).slice().forEach(function (fn) {
			try {
				out.push(fn(data));
			} catch (e) {
				/* one listener must not stop the others */
			}
		});
		return out;
	}

	// ---- the saved sign-in ------------------------------------------------------------

	function readVault() {
		var text = null;
		try {
			text = localStorage.getItem(VAULT_KEY);
		} catch (e) {
			return { error: 'This browser blocks storage for this page, so the Desk cannot remember a sign-in here.' };
		}
		if (!text) return { record: null };
		try {
			return { record: Vault.parseRecord(text) };
		} catch (e) {
			return { error: e.message, damaged: true };
		}
	}

	function writeVault(record) {
		localStorage.setItem(VAULT_KEY, JSON.stringify(record));
	}

	function wizardState() {
		var s = { step: 1, repo: 'desk' };
		try {
			var saved = JSON.parse(sessionStorage.getItem(WIZARD_KEY) || 'null');
			if (saved && saved.step >= 1 && saved.step <= 4) s.step = saved.step;
			if (saved && typeof saved.repo === 'string' && saved.repo) s.repo = saved.repo.slice(0, 140);
		} catch (e) {
			/* start at the beginning */
		}
		return s;
	}

	function saveWizard(s) {
		try {
			sessionStorage.setItem(WIZARD_KEY, JSON.stringify({ step: s.step, repo: s.repo }));
		} catch (e) {
			/* not essential */
		}
	}

	// ---- the gate (wizard, lock screen, refusals) -------------------------------------

	function testBanner() {
		if (!env.test) return null;
		return h('div', { class: 'test-banner', role: 'note', id: 'test-banner' }, 'Test mode: this page is talking to a fake GitHub at ' + env.apiBase.replace(/^http:\/\//, '') + '. Never paste a real token here.');
	}

	function gate(children, foot) {
		UI.closeAllDialogs();
		UI.clear(root);
		var card = h('div', { class: 'gate-card' }, [h('div', { class: 'gate-brand' }, [UI.icon('lock', 18), 'Desk']), children]);
		root.appendChild(h('main', { class: 'gate' }, [testBanner(), card, foot ? h('div', { class: 'gate-foot' }, foot) : null]));
		document.title = 'Desk';
	}

	function renderRefused(title, text, extra) {
		screen = 'refused';
		gate([h('h1', { text: title }), h('p', { text: text }), extra || null]);
		window.__toyReady = true;
	}

	// ---- checks shared by the wizard and "replace the token" ------------------------

	function Failure(message) {
		var e = new Error(message);
		e.name = 'Failure';
		e.plain = true;
		return e;
	}

	function reachable(err, otherwise) {
		if (err && err.plain) return err;
		if (err instanceof GH.errors.Offline) return Failure('GitHub could not be reached. Check the connection and try again.');
		if (err instanceof GH.errors.RateLimited) return Failure(err.message);
		if (err instanceof GH.errors.Unauthorized) return Failure('GitHub did not accept this token. Copy it again (GitHub shows it only once, so you may have to make a new one), and check that it has not expired.');
		return Failure(typeof otherwise === 'function' ? otherwise(err) : otherwise || err.message);
	}

	function looksLikeToken(token) {
		if (!token) return 'Paste the token first.';
		if (/\s/.test(token)) return 'The token has a space or a line break in it. Copy it again.';
		if (env.test) {
			if (!/^github_pat_FAKE_[a-z_]+$/.test(token)) return 'Test mode talks to a fake GitHub. Use one of its made-up tokens (they start with github_pat_FAKE_); never paste a real token here.';
			return '';
		}
		if (/^gh[pousr]_/.test(token)) return 'This is a classic token (it starts with ' + token.slice(0, 4) + '). A classic token reaches every repository you own. Make a fine-grained one instead (step 3); those start with github_pat_.';
		if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(token)) return 'This does not look like a fine-grained token. They start with github_pat_ and have no spaces.';
		return '';
	}

	// "desk" or "owner/desk" -> { owner (may be ''), repo }
	function parseRepoName(text) {
		var s = String(text || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
		var m = /^(?:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/)?([A-Za-z0-9._-]{1,100})$/.exec(s);
		if (!m || m[2] === '.' || m[2] === '..') return null;
		return { owner: m[1] || '', repo: m[2] };
	}

	var LAYOUT_README =
		'# desk\n\n' +
		'The private side of ' + SITE_URL + ' . The Desk (' + SITE_URL + 'desk/) reads and writes this repository; nothing in it is published.\n\n' +
		'- `drafts/`: posts that are not published yet, one Markdown file each.\n' +
		'- `notes/`: notes. Quick captures land in `notes/inbox/`.\n' +
		'- `reading/`: the reading log.\n' +
		'- `desk/settings.json`: the Desk\'s settings, shared by every device.\n\n' +
		'Keep this repository private. Everything in it is plain text and safe to edit by hand.\n';
	var KEEP = 'This file keeps the folder in git.\n';

	// Creates what is missing of the layout, in one commit (two on a repository
	// that has no commit at all: GitHub needs a first one before it accepts more).
	function ensureLayout(client) {
		return client.tree('private', { refresh: true }).then(function (tree) {
			var has = {};
			tree.forEach(function (e) {
				has[e.path] = true;
			});
			var files = [];
			if (!has['README.md']) files.push({ path: 'README.md', content: LAYOUT_README });
			if (!has[SETTINGS_PATH]) files.push({ path: SETTINGS_PATH, content: JSON.stringify({ lockMinutes: DEFAULT_LOCK_MINUTES }, null, '\t') + '\n' });
			['drafts', 'notes', 'reading'].forEach(function (dir) {
				if (!has[dir]) files.push({ path: dir + '/.gitkeep', content: KEEP });
			});
			if (!files.length) return 'Already set up: drafts/, notes/, reading/ and desk/settings.json are there.';
			return client.commit('private', files, 'Set up the Desk').then(function () {
				return (
					'Created ' +
					files
						.map(function (f) {
							return f.path.replace(/\/\.gitkeep$/, '/');
						})
						.join(', ') +
					'.'
				);
			});
		});
	}

	var CHECKS = [
		{ id: 'token', label: 'The token works' },
		{ id: 'owner', label: 'It belongs to the site\'s owner' },
		{ id: 'private', label: 'The private repository exists and is private' },
		{ id: 'site-write', label: 'It may write to the site repository' },
		{ id: 'private-write', label: 'It may write to the private repository' },
		{ id: 'actions', label: 'Actions: read', optional: true },
		{ id: 'pages', label: 'Pages: read', optional: true },
		{ id: 'discussions', label: 'Discussions: read', optional: true },
		{ id: 'layout', label: 'The private repository is set up' },
		{ id: 'seal', label: 'The token is encrypted on this device' },
	];

	// Runs the checks in order and reports each: report(id, state, detail) with
	// state 'run' | 'ok' | 'warn' | 'fail'. Resolves with { login, priv, client }
	// or rejects with a Failure whose message is already on screen.
	function runChecks(token, wanted, report, expectLogin) {
		var secret = { token: token };
		var make = function (priv) {
			return GH.create({
				apiBase: env.apiBase,
				token: function () {
					return secret.token;
				},
				site: SITE,
				priv: priv,
				probeSite: true,
			}).client;
		};
		var client = make({ owner: wanted.owner || 'unknown', repo: wanted.repo, branch: 'main' });
		var login = '';
		var priv = null;

		function step(id, work, optional) {
			report(id, 'run', '');
			return Promise.resolve()
				.then(work)
				.then(
					function (detail) {
						report(id, 'ok', detail || '');
					},
					function (err) {
						var failure = reachable(err);
						if (optional && !(err instanceof GH.errors.Offline) && !(err instanceof GH.errors.Unauthorized)) {
							report(id, 'warn', failure.message);
							return;
						}
						report(id, 'fail', failure.message);
						throw failure;
					}
				);
		}

		return step('token', function () {
			return client.user().then(function (u) {
				login = u.login;
				if (expectLogin && String(expectLogin).toLowerCase() !== String(login).toLowerCase()) {
					throw Failure('This token belongs to ' + login + ', but this device is signed in as ' + expectLogin + '. Use a token of the same account, or forget this device and start again.');
				}
				return 'Signed in to GitHub as ' + login + '.';
			});
		})
			.then(function () {
				return step('owner', function () {
					return client.repo('site').then(
						function (r) {
							// The owner's account can push by definition (what this token
							// may do is the next check); anyone else must be a collaborator.
							var isOwner = String(login).toLowerCase() === SITE.owner.toLowerCase();
							if (!isOwner && !r.canPush) throw Failure('This Desk belongs to the site\'s owner. ' + login + ' cannot push to ' + SITE.owner + '/' + SITE.repo + ', so there is nothing here for this account.');
							return isOwner ? login + ' owns ' + r.fullName + '.' : login + ' can push to ' + r.fullName + '.';
						},
						function (err) {
							throw reachable(err, 'The token cannot see ' + SITE.owner + '/' + SITE.repo + '. When making the token, under Repository access, select it.');
						}
					);
				});
			})
			.then(function () {
				return step('private', function () {
					priv = { owner: wanted.owner || login, repo: wanted.repo, branch: 'main' };
					var name = priv.owner + '/' + priv.repo;
					if (name.toLowerCase() === (SITE.owner + '/' + SITE.repo).toLowerCase()) throw Failure('That is the public site itself. The private repository must be a different one.');
					client = make(priv);
					return client.repo('private').then(
						function (r) {
							if (!r.isPrivate) {
								throw Failure(r.fullName + ' is PUBLIC. Drafts and notes saved there could be read by anyone, so the Desk will not use it. Make it private on GitHub (Settings, Danger Zone, Change visibility) or create another one, then check again.');
							}
							priv = { owner: priv.owner, repo: priv.repo, branch: r.defaultBranch || 'main' };
							client = make(priv);
							return r.fullName + ' exists and is private.';
						},
						function (err) {
							throw reachable(err, 'There is no repository ' + name + ' that this token can see. Either it does not exist yet (step 2), or it was not ticked under "Only select repositories" when the token was made.');
						}
					);
				});
			})
			.then(function () {
				return step('site-write', function () {
					return client.probeWrite('site').then(
						function (result) {
							if (result !== true) throw Failure('GitHub says ' + SITE.owner + '/' + SITE.repo + ' has no commits, which cannot be right. Check that the token was given that repository.');
							return 'Contents: read and write on ' + SITE.owner + '/' + SITE.repo + '. (Checked without changing the site.)';
						},
						function (err) {
							throw reachable(err, 'The token can read ' + SITE.owner + '/' + SITE.repo + ' but not write to it. Edit the token on GitHub: Repository permissions, Contents, Read and write; and make sure the repository is selected.');
						}
					);
				});
			})
			.then(function () {
				return step('private-write', function () {
					return client.probeWrite('private').then(
						function (result) {
							return result === 'empty' ? 'The repository is still empty; setting it up below is the test.' : 'Contents: read and write on ' + priv.owner + '/' + priv.repo + '.';
						},
						function (err) {
							throw reachable(err, 'The token can see ' + priv.owner + '/' + priv.repo + ' but not write to it. Edit the token on GitHub: Repository permissions, Contents, Read and write.');
						}
					);
				});
			})
			.then(function () {
				return step(
					'actions',
					function () {
						return client.get(client.repoPath('site', '/actions/runs'), { per_page: 1 }).then(
							function () {
								return 'Granted.';
							},
							function (err) {
								throw reachable(err, 'Not granted. Optional: the Health view will say that it cannot see the build runs.');
							}
						);
					},
					true
				);
			})
			.then(function () {
				return step(
					'pages',
					function () {
						return client.get(client.repoPath('site', '/pages')).then(
							function () {
								return 'Granted.';
							},
							function (err) {
								throw reachable(err, 'Not granted. Optional: the Health view will say that it cannot see the Pages deployments.');
							}
						);
					},
					true
				);
			})
			.then(function () {
				return step(
					'discussions',
					function () {
						return client.graphql('query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { discussions(first: 1) { totalCount } } }', { owner: SITE.owner, name: SITE.repo }).then(
							function () {
								return 'Granted.';
							},
							function (err) {
								throw reachable(err, 'Not granted. Optional: comments on posts will not be shown here.');
							}
						);
					},
					true
				);
			})
			.then(function () {
				return step('layout', function () {
					return ensureLayout(client).catch(function (err) {
						throw reachable(err, function (e) {
							return e instanceof GH.errors.Forbidden
								? 'The token may not write to ' + priv.owner + '/' + priv.repo + '. Edit the token on GitHub: Repository permissions, Contents, Read and write.'
								: 'The private repository could not be set up: ' + e.message;
						});
					});
				});
			})
			.then(function () {
				secret.token = '';
				return { login: login, priv: priv };
			});
	}

	function checksList() {
		var rows = {};
		var list = h('ol', { class: 'checks', id: 'checks', 'aria-live': 'polite' });
		var glyph = { wait: 'dot', run: 'syncing', ok: 'check', warn: 'info', fail: 'cross' };
		CHECKS.forEach(function (c) {
			var detail = h('div', { class: 'detail' });
			var li = h('li', { data: { state: 'wait', check: c.id } }, [UI.icon('dot', 18), h('div', {}, [h('div', { class: 'what', text: c.label + (c.optional ? ' (optional)' : '') }), detail])]);
			rows[c.id] = { li: li, detail: detail };
			list.appendChild(li);
		});
		return {
			el: list,
			set: function (id, state, text) {
				var r = rows[id];
				if (!r) return;
				r.li.dataset.state = state;
				r.li.replaceChild(UI.icon(glyph[state] || 'dot', 18), r.li.firstChild);
				r.detail.textContent = text || '';
			},
			reset: function () {
				CHECKS.forEach(function (c) {
					rows[c.id].li.dataset.state = 'wait';
					rows[c.id].li.replaceChild(UI.icon('dot', 18), rows[c.id].li.firstChild);
					rows[c.id].detail.textContent = '';
				});
			},
		};
	}

	// ---- the first-run wizard ---------------------------------------------------------

	function renderWizard(note) {
		screen = 'wizard';
		var state = wizardState();
		var titles = ['A private desk on a public site', 'Create the private repository', 'Create a token', 'Paste the token, choose a passphrase'];

		function go(step) {
			state.step = Math.max(1, Math.min(4, step));
			saveWizard(state);
			draw();
		}

		function externalLink(label, href) {
			return h('a', { class: 'btn', href: href, target: '_blank', rel: 'noopener noreferrer' }, [UI.icon('external', 18), h('span', { text: label })]);
		}

		function nav(back, next) {
			return h('div', { class: 'wizard-nav' }, [back || h('span'), next || h('span')]);
		}

		function backButton() {
			return UI.button('Back', {
				icon: 'back',
				id: 'wizard-back',
				onClick: function () {
					go(state.step - 1);
				},
			});
		}

		function nextButton(label) {
			return UI.button(label || 'Next', {
				kind: 'primary',
				id: 'wizard-next',
				onClick: function () {
					go(state.step + 1);
				},
			});
		}

		function stepOne() {
			return [
				h('p', { text: 'This page is the private side of nietztein.github.io: a place to write and publish posts, keep drafts, notes and a reading log, and see how the site is doing, from any device.' }),
				h('h2', { text: 'What is kept where' }),
				h('ul', {}, [
					h('li', { text: 'Published posts go to the public site repository (' + SITE.owner + '/' + SITE.repo + '), and only when you press Publish and confirm.' }),
					h('li', { text: 'Drafts, notes, the reading log and settings go to a private repository of yours on GitHub. Nothing private is ever written to the public one.' }),
					h('li', { text: 'This browser keeps your GitHub token, encrypted with a passphrase you choose, and an encrypted copy of what you opened here, so the Desk keeps working when the connection drops.' }),
					h('li', { text: 'The page talks to GitHub, and to GoatCounter for the visit counts. To nothing else.' }),
				]),
				h('p', { class: 'muted', text: 'Setting up takes about five minutes: make a private repository, make a token, paste it here.' }),
				nav(null, nextButton('Start')),
			];
		}

		function stepTwo() {
			var input = h('input', { class: 'input mono', type: 'text', id: 'wizard-repo', value: state.repo, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
			input.addEventListener('input', function () {
				state.repo = input.value.trim() || 'desk';
				saveWizard(state);
			});
			return [
				h('p', { text: 'Drafts and notes need a home that only you can read: a private repository on GitHub.' }),
				h('ol', {}, [
					h('li', { text: 'Open GitHub\'s new-repository page with the button below. The name "desk" and "Private" should already be filled in; the name is your choice.' }),
					h('li', { text: 'Check that Private is selected, leave everything else as it is, and press "Create repository". An empty repository is fine: the Desk fills it.' }),
					h('li', { text: 'Come back to this tab.' }),
				]),
				h('p', {}, externalLink('Open github.com/new', 'https://github.com/new?name=desk&visibility=private&description=' + encodeURIComponent('The private side of nietztein.github.io'))),
				UI.field('Name of the private repository', input, 'Just the name. Write owner/name only if it is not under your own account.'),
				nav(backButton(), nextButton()),
			];
		}

		function stepThree() {
			var parsed = parseRepoName(state.repo) || { repo: 'desk' };
			var url =
				'https://github.com/settings/personal-access-tokens/new?name=' +
				encodeURIComponent('Desk') +
				'&description=' +
				encodeURIComponent('The Desk on nietztein.github.io') +
				'&expires_in=90&contents=write&actions=read&pages=read&discussions=read';
			return [
				h('p', { text: 'A fine-grained personal access token lets this page act on those two repositories and on nothing else in your account.' }),
				h('p', {}, externalLink('Open the new-token page on GitHub', url)),
				h('p', { text: 'Some of it may already be filled in. Go through every line:' }),
				h('ul', { class: 'todo-list' }, [
					h('li', { text: 'Token name: anything, for example "Desk".' }),
					h('li', { text: 'Expiration: choose a date; 90 days is reasonable. When it runs out the Desk asks for a new token. Nothing is lost.' }),
					h('li', {}, ['Repository access: "Only select repositories", then tick exactly two: ', h('code', { text: SITE.repo }), ' and ', h('code', { text: parsed.repo }), '.']),
					h('li', { text: 'Permissions, Repository permissions, Contents: "Read and write". (GitHub adds "Metadata: Read-only" by itself.)' }),
					h('li', { class: 'optional', text: 'Optional, same list: Actions, Pages and Discussions, each "Read-only". Without them the Health and comments views say what is missing; everything else works.' }),
					h('li', { text: 'Nothing under Account permissions.' }),
					h('li', { text: 'Press "Generate token" and copy it. GitHub shows it only once.' }),
				]),
				nav(backButton(), nextButton('I have the token')),
			];
		}

		function stepFour() {
			var token = h('input', { class: 'input mono', type: 'password', id: 'wizard-token', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'github_pat_...' });
			var show = h('input', { type: 'checkbox', id: 'wizard-show' });
			show.addEventListener('change', function () {
				token.type = show.checked ? 'text' : 'password';
			});
			var pass = h('input', { class: 'input', type: 'password', id: 'wizard-pass', autocomplete: 'new-password' });
			var pass2 = h('input', { class: 'input', type: 'password', id: 'wizard-pass2', autocomplete: 'new-password' });
			var judge = h('span', { text: 'At least 10 characters. Four unrelated words work well.' });
			pass.addEventListener('input', function () {
				judge.textContent = pass.value ? Vault.judgePassphrase(pass.value).words : 'At least 10 characters. Four unrelated words work well.';
			});
			var error = h('p', { class: 'field-error', id: 'wizard-error', role: 'alert', hidden: true });
			var checks = checksList();
			checks.el.hidden = true;
			var submit = UI.button('Check and finish', { kind: 'primary', type: 'submit', id: 'wizard-finish' });

			function fail(message, focus) {
				error.textContent = message;
				error.hidden = false;
				if (focus) focus.focus();
			}

			var form = h('form', { id: 'wizard-form', novalidate: true }, [
				UI.field('The token', token, 'It goes from this field to GitHub and, encrypted, into this browser. Nowhere else.'),
				h('label', { class: 'check' }, [show, 'Show the token']),
				UI.field('A passphrase for this device', pass, judge),
				UI.field('The passphrase again', pass2, 'You type it each time you open the Desk in this browser. It is never sent anywhere and cannot be recovered: if you forget it, choose "Forget this device" and paste a token again.'),
				error,
				nav(backButton(), submit),
				checks.el,
			]);

			form.addEventListener('submit', function (e) {
				e.preventDefault();
				error.hidden = true;
				var value = token.value.trim();
				var problem = looksLikeToken(value);
				if (problem) return fail(problem, token);
				var wanted = parseRepoName(state.repo);
				if (!wanted) return fail('"' + state.repo + '" is not a repository name. Go back to step 2 and write just the name, like desk.');
				var verdict = Vault.judgePassphrase(pass.value);
				if (!verdict.ok) return fail('The passphrase: ' + verdict.words, pass);
				if (pass.value !== pass2.value) return fail('The two passphrases are not the same.', pass2);

				checks.reset();
				checks.el.hidden = false;
				var passphrase = pass.value;
				var work = runChecks(value, wanted, checks.set)
					.then(function (result) {
						checks.set('seal', 'run', '');
						var sessionData = { token: value, login: result.login, priv: result.priv };
						return Vault.newRecord(passphrase, sessionData, { who: result.login }).then(function (made) {
							try {
								writeVault(made.record);
							} catch (err) {
								checks.set('seal', 'fail', 'This browser refused to store the encrypted token (is storage blocked, or is this a private window?).');
								throw Failure('The browser refused to store the sign-in.');
							}
							checks.set('seal', 'ok', 'AES-256-GCM under a key made from your passphrase (PBKDF2, ' + made.record.kdf.iterations.toLocaleString('en-US') + ' rounds).');
							token.value = '';
							pass.value = '';
							pass2.value = '';
							try {
								sessionStorage.removeItem(WIZARD_KEY);
							} catch (err) {
								/* nothing to remove */
							}
							return startSession({ keys: made.keys, session: sessionData }, made.record, { fresh: true });
						});
					})
					.catch(function (err) {
						fail(err && err.plain ? 'One check failed (see below). Fix it and press "Check and finish" again.' : 'Something went wrong: ' + (err && err.message ? err.message : err));
					});
				UI.busy(submit, work);
				return undefined;
			});
			return [h('p', { text: 'Last step. The Desk checks the token, sets up the private repository and locks the token away in this browser.' }), form];
		}

		function draw() {
			var bodies = [stepOne, stepTwo, stepThree, stepFour];
			var dots = h(
				'ol',
				{ class: 'steps', 'aria-hidden': 'true' },
				[1, 2, 3, 4].map(function (n) {
					return h('li', { class: n <= state.step ? 'is-done' : '' });
				})
			);
			var heading = h('h1', { id: 'wizard-title', tabindex: '-1', text: titles[state.step - 1] });
			// A step change made from a control moves the focus to the new
			// heading (the control is about to disappear); the first paint does not.
			var hadFocus = !!document.activeElement && document.activeElement !== document.body && root.contains(document.activeElement);
			gate(
				[dots, h('p', { class: 'muted small', id: 'wizard-step', text: 'Step ' + state.step + ' of 4' }), heading, note && state.step === 1 ? UI.notice(note, 'info') : null, bodies[state.step - 1]()],
				['This is the owner\'s side of nietztein.github.io. Everything meant for readers is on ', h('a', { href: env.siteRoot, text: 'the public site' }), '.']
			);
			if (hadFocus) heading.focus({ preventScroll: true });
			window.scrollTo(0, 0);
		}

		draw();
		window.__toyReady = true;
	}

	// ---- the lock screen ------------------------------------------------------------

	function renderLock(record) {
		screen = 'locked';
		var failures = 0;
		var pass = h('input', { class: 'input', type: 'password', id: 'lock-pass', autocomplete: 'current-password', 'aria-describedby': 'lock-error' });
		var error = h('p', { class: 'field-error', id: 'lock-error', role: 'alert' });
		var submit = UI.button('Unlock', { kind: 'primary', type: 'submit', icon: 'unlock', id: 'lock-submit' });
		var note = lockNote;
		lockNote = '';

		var form = h('form', { id: 'lock-form', novalidate: true }, [UI.field('Passphrase', pass), error, h('div', { class: 'actions' }, [submit])]);
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			if (!pass.value) {
				error.textContent = 'Type the passphrase you chose on this device.';
				pass.focus();
				return;
			}
			error.textContent = '';
			var typed = pass.value;
			// Each wrong try waits a little longer. A guesser with the stored
			// ciphertext is not slowed by this; the key derivation is what slows them.
			var wait = failures >= 3 ? Math.min(8000, 500 * Math.pow(2, failures - 3)) : 0;
			var work = new Promise(function (resolve) {
				setTimeout(resolve, wait);
			})
				.then(function () {
					return Vault.openRecord(typed, record);
				})
				.then(
					function (opened) {
						pass.value = '';
						return startSession(opened, record, {});
					},
					function (err) {
						failures++;
						pass.value = '';
						error.textContent = err instanceof Vault.WrongPassphrase ? 'That passphrase does not open the Desk on this device.' : err.message;
						pass.focus();
					}
				);
			UI.busy(submit, work);
		});

		var forget = UI.button('Forget this device', {
			kind: 'quiet',
			id: 'lock-forget',
			onClick: function () {
				forgetDevice();
			},
		});

		gate(
			[
				h('h1', { text: 'Locked' }),
				h('p', { id: 'lock-who', text: record.who ? 'Signed in as ' + record.who + ' on this device. The passphrase opens it.' : 'The passphrase you chose on this device opens it.' }),
				note ? UI.notice(note, 'info') : null,
				form,
			],
			[forget, h('div', { text: 'Forgetting removes the encrypted token and everything the Desk cached in this browser. Nothing on GitHub changes.' })]
		);
		pass.focus();
		window.__toyReady = true;
	}

	// ---- forgetting the device --------------------------------------------------------

	function wipeDevice() {
		try {
			localStorage.removeItem(VAULT_KEY);
		} catch (e) {
			/* nothing stored */
		}
		try {
			sessionStorage.removeItem(WIZARD_KEY);
		} catch (e) {
			/* nothing stored */
		}
		return Store.destroy();
	}

	function forgetDevice() {
		var pendingCount = session && session.syncState ? session.syncState.pending : 0;
		return UI.confirm({
			title: 'Forget this device?',
			body: [
				'The encrypted token, any stored secrets and the local cache are removed from this browser. To use the Desk here again you will paste a token and choose a passphrase.',
				pendingCount ? pendingCount + (pendingCount === 1 ? ' change that has' : ' changes that have') + ' not reached GitHub yet will be lost.' : null,
				'Nothing on GitHub changes. The token itself keeps working until it expires or you delete it at github.com/settings/personal-access-tokens: do that if this device is lost or was shared.',
			].filter(Boolean),
			action: 'Forget this device',
			danger: true,
		}).then(function (yes) {
			if (!yes) return false;
			var closing = session ? endSession() : Promise.resolve();
			return closing.then(wipeDevice).then(function () {
				renderWizard('This device has forgotten the Desk.');
				return true;
			});
		});
	}

	// ---- a session: from unlock to lock -----------------------------------------------

	function pickBackend() {
		var backend;
		try {
			if (!window.indexedDB) throw new Error('no IndexedDB');
			backend = Store.indexedDBBackend();
		} catch (e) {
			return Promise.resolve({ backend: Store.memoryBackend(), volatile: true });
		}
		return backend.all('desk.probe').then(
			function () {
				return { backend: backend, volatile: false };
			},
			function () {
				return { backend: Store.memoryBackend(), volatile: true };
			}
		);
	}

	function startSession(opened, record, opts) {
		return pickBackend().then(function (picked) {
			var secret = { token: opened.session.token };
			var s = {
				alive: true,
				secret: secret,
				keys: opened.keys,
				record: record,
				login: opened.session.login,
				priv: opened.session.priv,
				backend: picked.backend,
				volatile: picked.volatile,
				settings: {},
				settingsDirty: {},
				settingsTimer: null,
				settingsReady: null,
				dirty: {},
				inFlight: 0,
				writes: 0,
				syncState: { pending: 0, conflicts: 0, flushing: false, offline: false, lastSaved: null, lastError: '' },
				user: { login: opened.session.login, name: '', avatar: '' },
				repos: { site: null, private: null },
				rate: null,
				tokenBad: false,
				lastActivity: Date.now(),
				idleTimer: null,
				retryTimer: null,
				banners: {},
			};
			var made = GH.create({
				apiBase: env.apiBase,
				token: function () {
					return secret.token;
				},
				site: SITE,
				priv: s.priv,
				onRate: function (r) {
					s.rate = r;
					if (session === s) emit('rate', r);
				},
				onActivity: function (inFlight, writes) {
					s.inFlight = inFlight;
					s.writes = writes;
					if (session === s) updateStatus();
				},
				onUnauthorized: function () {
					if (session !== s || s.tokenBad) return;
					s.tokenBad = true;
					showTokenBanner();
				},
			});
			s.gh = made.client;
			s.store = Store.create({ backend: picked.backend, Vault: Vault, keys: opened.keys });
			s.sync = Store.createSync({
				store: s.store,
				gh: made.client,
				onChange: function (state) {
					s.syncState = state;
					if (session === s) {
						updateStatus();
						emit('sync', state);
					}
				},
			});
			s.ui = UI.create({ issueTicket: made.issueTicket, siteRoot: env.siteRoot, siteUrl: SITE_URL });
			session = s;
			s.api = buildApi(s);

			screen = 'open';
			renderShell();
			route();
			startIdleWatch();
			window.__toyReady = true;
			emit('unlock', { login: s.login });
			if (opts && opts.fresh) UI.toast('The Desk is set up on this device.');

			// In the background: what the device kept, then what GitHub says.
			s.settingsReady = loadSettings(s);
			s.sync
				.refresh()
				.then(function () {
					if (session === s) return s.sync.flush();
					return undefined;
				})
				.catch(quiet);
			s.gh.user().then(
				function (u) {
					if (session !== s) return;
					s.user = { login: u.login, name: u.name, avatar: u.avatar };
					emit('user', s.user);
				},
				function () {
					/* offline or a dead token: the banner and the status say so */
				}
			);
			s.gh.repo('private').then(
				function (r) {
					if (session !== s) return;
					s.repos.private = r;
					emit('repos', s.repos);
					if (!r.isPrivate) {
						banner('public', UI.notice(r.fullName + ' is now PUBLIC: everything in it can be read by anyone. Make it private again on GitHub (Settings, Danger Zone, Change visibility).', 'bad'));
					}
				},
				function () {}
			);
			s.retryTimer = setInterval(function () {
				if (session === s && s.syncState.pending > s.syncState.conflicts && navigator.onLine !== false) s.sync.flush().catch(quiet);
			}, 60000);
		});
	}

	// Drops everything secret. Views are told first and get a moment to put
	// unfinished work into the (encrypted) local store.
	function endSession() {
		var s = session;
		if (!s) return Promise.resolve();
		var waits = emit('lock', {}).filter(function (r) {
			return r && typeof r.then === 'function';
		});
		var view = current;
		current = null;
		if (view) {
			view.offs.forEach(function (off) {
				off();
			});
			try {
				var r = view.view.unmount ? view.view.unmount() : null;
				if (r && typeof r.then === 'function') waits.push(r);
			} catch (e) {
				/* a view's problem */
			}
		}
		session = null;
		s.secret.token = '';
		clearInterval(s.idleTimer);
		clearInterval(s.retryTimer);
		clearTimeout(s.settingsTimer);
		var grace = new Promise(function (resolve) {
			setTimeout(resolve, 1500);
		});
		var settled = Promise.all(
			waits.map(function (p) {
				return Promise.resolve(p).catch(function () {});
			})
		);
		return Promise.race([settled, grace]).then(function () {
			s.alive = false;
			s.keys = null;
			s.record = null;
			s.api = null;
			if (s.backend.close) return s.backend.close();
			return undefined;
		});
	}

	function lock(reason) {
		if (!session) return Promise.resolve();
		if (reason === 'idle') lockNote = 'Locked after a while without activity.';
		else if (reason === 'token') lockNote = 'Locked.';
		var done = endSession();
		var vault = readVault();
		if (vault.record) renderLock(vault.record);
		else renderWizard(vault.error || '');
		return done;
	}

	// ---- inactivity -------------------------------------------------------------------

	function lockMinutes() {
		var m = session ? Number(session.settings.lockMinutes) : NaN;
		return m > 0 ? m : DEFAULT_LOCK_MINUTES;
	}

	function touch() {
		if (session) session.lastActivity = Date.now();
	}

	function checkIdle() {
		if (session && Date.now() - session.lastActivity >= lockMinutes() * 60000) lock('idle');
	}

	function startIdleWatch() {
		var s = session;
		if (!s) return;
		clearInterval(s.idleTimer);
		var every = Math.max(250, Math.min(15000, (lockMinutes() * 60000) / 4));
		s.idleTimer = setInterval(checkIdle, every);
	}

	['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (name) {
		window.addEventListener(name, touch, { passive: true, capture: true });
	});
	document.addEventListener('visibilitychange', function () {
		if (!document.hidden) checkIdle();
	});
	// Closing the page, or leaving it, locks: nothing unlocked survives in a
	// page the browser keeps for the Back button.
	window.addEventListener('pagehide', function () {
		if (session) lock('closed');
	});
	window.addEventListener('online', function () {
		if (!session) return;
		emit('online', {});
		updateStatus();
		session.sync.flush().catch(quiet);
	});
	window.addEventListener('offline', function () {
		if (!session) return;
		emit('offline', {});
		updateStatus();
	});
	window.addEventListener('storage', function (e) {
		if (e.key !== VAULT_KEY && e.key !== null) return;
		var gone = e.key === null || !e.newValue;
		if (session && gone) {
			lockNote = '';
			endSession().then(function () {
				renderWizard('This device has forgotten the Desk (from another tab).');
			});
		} else if (session) {
			// Another tab changed the saved sign-in. Same passphrase (a new token,
			// a new secret): take its record. A different one: this tab's keys
			// no longer fit, so lock.
			var fresh = readVault();
			if (fresh.record && fresh.record.kdf.salt === session.record.kdf.salt) session.record = fresh.record;
			else lock('token');
		} else if (screen === 'locked' || screen === 'wizard') {
			var vault = readVault();
			if (vault.record) renderLock(vault.record);
			else if (screen === 'locked') renderWizard(vault.error || '');
		}
	});
	window.addEventListener('beforeunload', function (e) {
		if (!session) return;
		var dirty = Object.keys(session.dirty).some(function (k) {
			return session.dirty[k];
		});
		if (dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	});

	// ---- settings (desk/settings.json in the private repository) ---------------------

	function loadSettings(s) {
		return s.store
			.get(FRAME, 'settings', null)
			.then(function (cached) {
				if (cached && typeof cached === 'object' && session === s) {
					s.settings = cached;
					startIdleWatch();
					emit('settings', { all: true });
				}
				return s.sync.read(SETTINGS_PATH);
			})
			.then(function (file) {
				if (!file || session !== s) return;
				var remote;
				try {
					remote = JSON.parse(file.text);
				} catch (e) {
					UI.toast('desk/settings.json in the private repository is not valid JSON; using the settings this device remembers.', { kind: 'warn' });
					return;
				}
				if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return;
				// What was changed here and not yet saved stays on top.
				Object.keys(s.settingsDirty).forEach(function (k) {
					remote[k] = s.settings[k];
				});
				s.settings = remote;
				startIdleWatch();
				emit('settings', { all: true });
				return s.store.put(FRAME, 'settings', s.settings);
			})
			.catch(function () {
				/* offline with nothing cached: the defaults do */
			});
	}

	function saveSettings(s) {
		clearTimeout(s.settingsTimer);
		s.settingsTimer = setTimeout(function () {
			if (session !== s) return;
			var text = JSON.stringify(s.settings, null, '\t') + '\n';
			var mine = s.settingsDirty;
			s.settingsDirty = {};
			s.sync.save(SETTINGS_PATH, text, { message: 'Update the Desk settings' }).catch(function (err) {
				if (!(err instanceof GH.errors.Conflict) || session !== s) return;
				// Another device changed the settings: take theirs, put this
				// device's changes on top, save once more.
				s.sync
					.resolve(SETTINGS_PATH, 'theirs')
					.then(function () {
						return s.sync.read(SETTINGS_PATH);
					})
					.then(function (file) {
						var remote = {};
						try {
							remote = file ? JSON.parse(file.text) : {};
						} catch (e) {
							remote = {};
						}
						Object.keys(mine).forEach(function (k) {
							remote[k] = s.settings[k];
						});
						s.settings = remote;
						return s.sync.save(SETTINGS_PATH, JSON.stringify(remote, null, '\t') + '\n', { message: 'Update the Desk settings' });
					})
					.catch(function () {
						UI.toast('The settings could not be saved to GitHub. They are kept on this device.', { kind: 'warn' });
					});
			});
		}, 600);
	}

	// ---- the object the views get -----------------------------------------------------

	function buildApi(s) {
		var guard = function (fn) {
			return function () {
				if (!s.alive) return Promise.reject(new GH.errors.Locked());
				return fn.apply(null, arguments);
			};
		};

		var api = {
			gh: s.gh,
			store: {
				get: guard(s.store.get),
				put: guard(s.store.put),
				del: guard(s.store.del),
				keys: guard(s.store.keys),
				entries: guard(s.store.entries),
				clear: guard(s.store.clear),
				read: guard(s.sync.read),
				list: guard(s.sync.list),
				save: guard(s.sync.save),
				remove: guard(s.sync.remove),
				pending: guard(s.sync.pending),
				flush: guard(s.sync.flush),
				resolve: guard(s.sync.resolve),
				state: function () {
					return s.syncState;
				},
			},
			secrets: {
				get: guard(function (name) {
					return Vault.getSecret(s.record, s.keys, String(name));
				}),
				set: guard(function (name, value) {
					return Vault.setSecret(s.record, s.keys, String(name), value).then(function (next) {
						s.record = next;
						writeVault(next);
					});
				}),
			},
			settings: {
				get: function (key, fallback) {
					return Object.prototype.hasOwnProperty.call(s.settings, key) ? s.settings[key] : fallback;
				},
				set: guard(function (key, value) {
					if (value === undefined) delete s.settings[key];
					else s.settings[key] = value;
					s.settingsDirty[key] = true;
					if (key === 'lockMinutes') startIdleWatch();
					emit('settings', { key: key, value: value });
					saveSettings(s);
					return s.store.put(FRAME, 'settings', s.settings);
				}),
				all: function () {
					return JSON.parse(JSON.stringify(s.settings));
				},
				ready: function () {
					return s.settingsReady || Promise.resolve();
				},
			},
			site: { owner: SITE.owner, repo: SITE.repo, branch: SITE.branch },
			priv: { owner: s.priv.owner, repo: s.priv.repo, branch: s.priv.branch },
			siteRoot: env.siteRoot,
			siteUrl: SITE_URL,
			env: { test: env.test, apiBase: env.apiBase, goat: env.goat },
			ui: s.ui,
			user: function () {
				return { login: s.user.login, name: s.user.name, avatar: s.user.avatar };
			},
			nav: nav,
			on: on,
			emit: emit,
			status: function () {
				return statusNow().state;
			},
			dirty: function (flag) {
				s.dirty.frame = !!flag;
				updateStatus();
			},
			capture: guard(capture),
			views: function () {
				return views.map(function (v) {
					return { id: v.id, title: v.title, icon: v.icon, order: v.order, description: v.description || '' };
				});
			},
			lock: function () {
				return lock('button');
			},
			// The public site's own config (assets/js/config.json), fetched from
			// this origin. -> Promise<object>
			siteConfig: function () {
				if (!s.siteConfig) {
					s.siteConfig = fetch(env.siteRoot + 'assets/js/config.json', { cache: 'no-cache' })
						.then(function (r) {
							return r.ok ? r.json() : {};
						})
						.catch(function () {
							s.siteConfig = null;
							return {};
						});
				}
				return s.siteConfig;
			},
			// Where GoatCounter answers: the ?goat= test server, or https://<code>.goatcounter.com.
			goatBase: function () {
				if (env.goat) return Promise.resolve(env.goat);
				return api.siteConfig().then(function (cfg) {
					return cfg && cfg.goatCounterCode ? 'https://' + cfg.goatCounterCode + '.goatcounter.com' : '';
				});
			},
		};
		return api;
	}

	// A quick note for the notes view's inbox:
	//   notes/inbox/<YYYYMMDD>T<HHMMSS>Z-<two characters>.md
	//   ---
	//   created: 2026-10-05T14:03:22Z
	//   tags: [inbox]
	//   ---
	//
	//   the text
	function capture(text, opts) {
		var s = session;
		var body = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
		if (!body) return Promise.reject(new Error('There is nothing to save yet.'));
		var tags = cleanTags(opts && opts.tags);
		if (!tags.length) tags = ['inbox'];
		var now = new Date();
		var path = 'notes/inbox/' + UI.date.stamp(now) + '-' + Math.random().toString(36).slice(2, 4).replace(/[^a-z0-9]/g, 'x').padEnd(2, 'x') + '.md';
		var content = UI.buildPost({ created: UI.date.utc(now), tags: tags }, body);
		return s.sync.save(path, content, { message: 'Capture a note', sha: null }).then(function (r) {
			emit('capture', { path: path });
			return { path: path, state: r.state, text: content };
		});
	}

	function cleanTags(input) {
		var list = Array.isArray(input) ? input : String(input || '').split(/[,\s]+/);
		var seen = {};
		return list
			.map(function (t) {
				return String(t).trim().replace(/^#/, '').replace(/[\[\],\s]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
			})
			.filter(function (t) {
				if (!t || seen[t]) return false;
				seen[t] = true;
				return true;
			});
	}

	// ---- views and routing ------------------------------------------------------------

	function registerView(view) {
		if (!view || typeof view.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(view.id)) throw new Error('Desk.registerView: id must be lowercase letters, digits and dashes.');
		if (typeof view.mount !== 'function') throw new Error('Desk.registerView: "' + view.id + '" has no mount(el, api) function.');
		if (typeof view.title !== 'string' || !view.title) throw new Error('Desk.registerView: "' + view.id + '" has no title.');
		views = views.filter(function (v) {
			return v.id !== view.id;
		});
		views.push(view);
		views.sort(function (a, b) {
			return (a.order || 0) - (b.order || 0) || (a.title < b.title ? -1 : 1);
		});
		if (session && screen === 'open') {
			renderNav();
			emit('views', {});
			// Show it at once when it is the view the address asks for (or a new
			// version of the one on screen).
			if (current === null || current.view.id === view.id || parseHash().id === view.id) route();
		}
	}

	function parseHash() {
		var raw = location.hash.replace(/^#\/?/, '');
		var q = raw.indexOf('?');
		var id = decodeURIComponent(q === -1 ? raw : raw.slice(0, q));
		var params = {};
		if (q !== -1) {
			try {
				new URLSearchParams(raw.slice(q + 1)).forEach(function (v, k) {
					params[k] = v;
				});
			} catch (e) {
				/* no parameters */
			}
		}
		return { id: id, params: params };
	}

	function viewById(id) {
		for (var i = 0; i < views.length; i++) if (views[i].id === id) return views[i];
		return null;
	}

	// nav('write', { draft: 'drafts/x.md' }) -> #/write?draft=drafts%2Fx.md
	function nav(id, params) {
		var hash = '#/' + encodeURIComponent(id || 'home');
		var parts = [];
		Object.keys(params || {}).forEach(function (k) {
			if (params[k] === undefined || params[k] === null) return;
			parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
		});
		if (parts.length) hash += '?' + parts.join('&');
		if (location.hash === hash) route();
		else location.hash = hash;
	}

	function unmountCurrent() {
		var c = current;
		current = null;
		if (!c) return;
		c.offs.forEach(function (off) {
			off();
		});
		if (session) {
			delete session.dirty[c.view.id];
			updateStatus();
		}
		try {
			if (c.view.unmount) c.view.unmount();
		} catch (e) {
			/* a view's problem */
		}
	}

	function route() {
		if (!session || screen !== 'open') return;
		var want = parseHash();
		var view = viewById(want.id) || viewById('home');
		if (!view) return;

		if (current && current.view === view) {
			current.api.params = want.params;
			if (typeof view.update === 'function') {
				try {
					view.update(want.params);
				} catch (e) {
					UI.toast(e.message, { kind: 'bad' });
				}
				return;
			}
			if (JSON.stringify(current.params) === JSON.stringify(want.params)) return;
		}

		unmountCurrent();
		var host = document.getElementById('desk-view');
		if (!host) return;
		UI.clear(host);
		var el = h('section', { class: 'view-body', data: { view: view.id } });
		host.appendChild(el);

		var s = session;
		var offs = [];
		var api = Object.create(s.api);
		api.view = view.id;
		api.params = want.params;
		api.on = function (name, fn) {
			var off = on(name, fn);
			offs.push(off);
			return off;
		};
		api.dirty = function (flag) {
			if (session !== s) return;
			s.dirty[view.id] = !!flag;
			updateStatus();
		};
		current = { view: view, el: el, api: api, offs: offs, params: want.params };

		var title = document.getElementById('desk-title');
		if (title) title.textContent = view.title;
		document.title = view.title + ' · Desk';
		Array.prototype.forEach.call(document.querySelectorAll('.nav-link'), function (a) {
			if (a.dataset.view === view.id) a.setAttribute('aria-current', 'page');
			else a.removeAttribute('aria-current');
		});

		var failed = function (err) {
			if (!current || current.el !== el) return;
			UI.clear(el);
			el.appendChild(UI.errorBox(new Error('The "' + view.title + '" view could not start: ' + (err && err.message ? err.message : err))));
		};
		try {
			var result = view.mount(el, api);
			if (result && typeof result.then === 'function') result.catch(failed);
		} catch (err) {
			failed(err);
		}
		emit('route', { id: view.id, params: want.params });
		window.scrollTo(0, 0);
	}

	window.addEventListener('hashchange', function () {
		touch();
		route();
	});

	// ---- the shell ----------------------------------------------------------------------

	function renderNav() {
		var list = document.getElementById('desk-nav-list');
		if (!list) return;
		UI.clear(list);
		var here = current ? current.view.id : parseHash().id || 'home';
		views.forEach(function (v) {
			var a = h('a', { class: 'nav-link', href: '#/' + v.id, data: { view: v.id }, title: v.title }, [UI.icon(v.icon || 'dot', 22), h('span', { text: v.title })]);
			if (v.id === here) a.setAttribute('aria-current', 'page');
			list.appendChild(h('li', {}, a));
		});
	}

	function renderShell() {
		UI.closeAllDialogs();
		UI.clear(root);
		var s = session;
		var status = h('button', { class: 'status', id: 'desk-status', type: 'button', data: { state: 'saved' }, 'aria-live': 'polite', title: 'Sync state. Press for details.' }, [UI.icon('saved', 16), h('span', { class: 'status-text', text: 'Saved' })]);
		status.addEventListener('click', function () {
			nav('home', {});
		});
		var themeBtn = UI.button('', {
			kind: 'quiet',
			icon: UI.theme.get() === 'dark' ? 'sun' : 'moon',
			id: 'desk-theme',
			label: 'Switch between light and dark',
			title: 'Light or dark',
			onClick: function () {
				UI.theme.toggle();
			},
		});
		var lockBtn = UI.button('', {
			icon: 'lock',
			id: 'desk-lock',
			title: 'Lock the Desk',
			label: 'Lock the Desk',
			onClick: function () {
				lock('button');
			},
		});
		lockBtn.appendChild(h('span', { class: 'lock-label', text: 'Lock' }));

		var app = h('div', { class: 'app' }, [
			h('nav', { class: 'nav', 'aria-label': 'Desk' }, [
				h('a', { class: 'nav-brand', href: '#/home' }, [UI.icon('write', 22), 'Desk']),
				h('ul', { id: 'desk-nav-list' }),
				h('div', { class: 'nav-foot' }, [h('a', { href: env.siteRoot, text: 'The public site' })]),
			]),
			h('div', { class: 'main' }, [
				h('header', { class: 'top' }, [h('h1', { id: 'desk-title', text: 'Desk' }), status, themeBtn, lockBtn]),
				h('div', { class: 'banners', id: 'desk-banners' }),
				h('main', { class: 'view', id: 'desk-view', tabindex: '-1' }),
			]),
		]);
		root.appendChild(app);
		renderNav();
		if (env.test) banner('test', testBanner());
		if (s.volatile) banner('volatile', UI.notice('This browser does not let the Desk keep anything on the device here (a private window?). It works, but nothing is cached and unsent changes do not survive closing the page.', 'warn'));
		updateStatus();
	}

	UI.theme.onChange(function (t) {
		var b = document.getElementById('desk-theme');
		if (b) b.replaceChild(UI.icon(t === 'dark' ? 'sun' : 'moon', 18), b.firstChild);
		emit('theme', t);
	});

	function banner(id, node) {
		var host = document.getElementById('desk-banners');
		if (!host) return;
		var old = host.querySelector('[data-banner="' + id + '"]');
		if (old) host.removeChild(old);
		if (!node) return;
		node.dataset.banner = id;
		host.appendChild(node);
	}

	function showTokenBanner() {
		var box = UI.notice(
			[
				h('p', { text: 'GitHub no longer accepts the token: it has expired or was deleted. Nothing is lost; what you write is kept on this device until a new token is in.' }),
				UI.button('Paste a new token', {
					kind: 'primary',
					id: 'token-replace',
					onClick: function () {
						replaceToken();
					},
				}),
			],
			'bad'
		);
		banner('token', box);
	}

	// ---- status ---------------------------------------------------------------------------

	function statusNow() {
		var s = session;
		if (!s) return { state: 'saved', text: 'Saved', icon: 'saved' };
		var st = s.syncState;
		var dirty = Object.keys(s.dirty).some(function (k) {
			return s.dirty[k];
		});
		if (navigator.onLine === false || st.offline) {
			return { state: 'offline', text: 'Offline' + (st.pending ? ' · ' + st.pending + ' waiting' : ''), icon: 'offline' };
		}
		if (st.flushing || s.writes > 0) return { state: 'syncing', text: 'Syncing', icon: 'syncing' };
		if (st.conflicts) return { state: 'unsaved', text: st.conflicts + (st.conflicts === 1 ? ' conflict' : ' conflicts'), icon: 'warning' };
		if (dirty || st.pending) return { state: 'unsaved', text: st.pending ? st.pending + ' unsent' : 'Unsaved', icon: 'unsaved' };
		return { state: 'saved', text: 'Saved', icon: 'saved' };
	}

	var lastStatus = '';
	function updateStatus() {
		var node = document.getElementById('desk-status');
		if (!node) return;
		var now = statusNow();
		var key = now.state + '|' + now.text;
		if (key === lastStatus && node.dataset.state === now.state) return;
		lastStatus = key;
		node.dataset.state = now.state;
		UI.clear(node);
		node.appendChild(UI.icon(now.icon, 16));
		node.appendChild(h('span', { class: 'status-text', text: now.text }));
		emit('status', now.state);
	}

	// ---- a new token for a signed-in device ---------------------------------------------

	function replaceToken() {
		var s = session;
		if (!s) return Promise.resolve(false);
		return UI.dialog(function (dlg, close) {
			var token = h('input', { class: 'input mono', type: 'password', id: 'replace-token', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'github_pat_...' });
			token.setAttribute('data-autofocus', '');
			var error = h('p', { class: 'field-error', role: 'alert', hidden: true });
			var checks = checksList();
			checks.el.hidden = true;
			var submit = UI.button('Check and use it', { kind: 'primary', type: 'submit', id: 'replace-submit' });
			var form = h('form', { novalidate: true }, [
				h('h2', { id: 'dlg-title', text: 'A new token' }),
				h('div', { class: 'dialog-body' }, [
					h('p', {}, [
						'Make a new fine-grained token as before (',
						h('a', { href: 'https://github.com/settings/personal-access-tokens', target: '_blank', rel: 'noopener noreferrer', text: 'github.com/settings/personal-access-tokens' }),
						'): only the two repositories, Contents read and write. Your passphrase stays the same.',
					]),
					UI.field('The new token', token),
					error,
					checks.el,
				]),
				h('div', { class: 'dialog-actions' }, [
					UI.button('Cancel', {
						onClick: function () {
							close(false);
						},
					}),
					submit,
				]),
			]);
			form.addEventListener('submit', function (e) {
				e.preventDefault();
				error.hidden = true;
				var value = token.value.trim();
				var problem = looksLikeToken(value);
				if (problem) {
					error.textContent = problem;
					error.hidden = false;
					return;
				}
				checks.reset();
				checks.el.hidden = false;
				var work = runChecks(value, { owner: s.priv.owner, repo: s.priv.repo }, checks.set, s.login)
					.then(function (result) {
						checks.set('seal', 'run', '');
						return Vault.setSession(s.record, s.keys, { token: value, login: result.login, priv: result.priv }).then(function (next) {
							if (session !== s) return;
							s.record = next;
							writeVault(next);
							s.secret.token = value;
							s.tokenBad = false;
							token.value = '';
							banner('token', null);
							checks.set('seal', 'ok', 'Encrypted with the same passphrase as before.');
							UI.toast('The new token is in.');
							close(true);
							s.sync.flush().catch(quiet);
							emit('token', {});
						});
					})
					.catch(function (err) {
						error.textContent = err && err.plain ? 'One check failed (see below).' : 'Something went wrong: ' + (err && err.message ? err.message : err);
						error.hidden = false;
					});
				UI.busy(submit, work);
			});
			dlg.appendChild(form);
		});
	}

	// ---- Home -----------------------------------------------------------------------------

	var home = {
		id: 'home',
		title: 'Home',
		icon: 'home',
		order: 0,
		mount: function (el, api) {
			var s = session;
			var ui = api.ui;

			// Who.
			var avatar = h('div', { class: 'avatar', 'aria-hidden': 'true', text: (s.user.login || '?').charAt(0).toUpperCase() });
			var whoName = h('div', { class: 'who-name', id: 'home-who', text: s.user.login });
			var whoMeta = h('div', { class: 'muted small', text: 'Signed in on this device.' });
			function drawWho() {
				whoName.textContent = s.user.name ? s.user.name + ' (' + s.user.login + ')' : s.user.login;
				// Only GitHub's own avatar host is allowed by the page's policy.
				if (s.user.avatar && /^https:\/\/avatars\.githubusercontent\.com\//.test(s.user.avatar) && avatar.tagName !== 'IMG') {
					var img = h('img', { class: 'avatar', alt: '', src: s.user.avatar, width: '48', height: '48', referrerpolicy: 'no-referrer' });
					img.addEventListener('error', function () {
						if (img.parentNode) img.parentNode.replaceChild(avatar, img);
					});
					avatar.parentNode.replaceChild(img, avatar);
				}
			}
			var who = h('section', { class: 'card home-wide who' }, [avatar, h('div', {}, [whoName, whoMeta])]);

			// Quick capture.
			var text = h('textarea', { class: 'input', id: 'capture-text', rows: '3', placeholder: 'A thought, a link, a line to keep. It goes to your private notes.' });
			var tags = h('input', { class: 'input', id: 'capture-tags', type: 'text', placeholder: 'tags, separated by commas (optional)', autocapitalize: 'none', autocomplete: 'off' });
			var captureNote = h('p', { class: 'muted small', id: 'capture-result', 'aria-live': 'polite' });
			var captureBtn = ui.button('Save note', { kind: 'primary', icon: 'plus', id: 'capture-save', type: 'submit' });
			var captureForm = h('form', { id: 'capture-form', novalidate: true }, [
				ui.field('Quick note', text),
				h('div', { class: 'field' }, [h('label', { class: 'sr-only', for: 'capture-tags', text: 'Tags' }), tags]),
				h('div', { class: 'actions' }, [captureBtn, captureNote]),
			]);
			text.addEventListener('input', function () {
				api.dirty(!!text.value.trim());
			});
			text.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					captureForm.requestSubmit ? captureForm.requestSubmit() : captureBtn.click();
				}
			});
			captureForm.addEventListener('submit', function (e) {
				e.preventDefault();
				if (!text.value.trim()) {
					captureNote.textContent = 'Write something first.';
					text.focus();
					return;
				}
				var work = api.capture(text.value, { tags: tags.value }).then(
					function (r) {
						text.value = '';
						tags.value = '';
						api.dirty(false);
						captureNote.textContent = r.state === 'saved' ? 'Saved to ' + r.path + '.' : 'Kept on this device as ' + r.path + '; it goes to GitHub when the connection is back.';
						ui.toast(r.state === 'saved' ? 'Note saved.' : 'Note kept on this device for now.', { kind: r.state === 'saved' ? 'ok' : 'warn' });
						text.focus();
					},
					function (err) {
						captureNote.textContent = '';
						ui.toast('The note was not saved to GitHub: ' + err.message + ' It is kept on this device.', { kind: 'bad' });
					}
				);
				ui.busy(captureBtn, work);
			});
			var captureCard = h('section', { class: 'card home-wide' }, captureForm);

			// Tiles.
			var tiles = h('div', { class: 'tiles', id: 'home-tiles' });
			var tilesNote = h('p', { class: 'muted small' });
			function drawTiles() {
				ui.clear(tiles);
				var others = views.filter(function (v) {
					return v.id !== 'home';
				});
				others.forEach(function (v) {
					tiles.appendChild(h('a', { class: 'tile', href: '#/' + v.id, data: { view: v.id } }, [ui.icon(v.icon || 'dot', 24), h('span', { text: v.title }), v.description ? h('small', { text: v.description }) : null]));
				});
				tilesNote.textContent = others.length ? '' : 'No views are installed yet. Notes captured above are kept in the private repository all the same.';
				tilesNote.hidden = !!others.length;
			}
			var tilesCard = h('section', { class: 'card home-wide' }, [h('h2', { text: 'Views' }), tiles, tilesNote]);

			// Repositories.
			var repoList = h('dl', { class: 'kv', id: 'home-repos' });
			function repoLine(label, spec, info, wantPrivate) {
				var name = spec.owner + '/' + spec.repo;
				var value = [h('a', { href: 'https://github.com/' + name, target: '_blank', rel: 'noopener noreferrer', text: name }), ' '];
				if (info) {
					value.push(h('span', { class: 'badge ' + (info.isPrivate === wantPrivate ? 'badge-ok' : 'badge-bad'), text: info.isPrivate ? 'private' : 'public' }));
					if (info.pushedAt) value.push(h('div', { class: 'muted small', text: 'Last push ' + ui.date.ago(info.pushedAt) + ', branch ' + (info.defaultBranch || spec.branch) }));
				} else value.push(h('span', { class: 'muted small', text: '(not checked yet)' }));
				return [h('dt', { text: label }), h('dd', {}, value)];
			}
			function drawRepos() {
				ui.clear(repoList);
				repoLine('Public site', SITE, s.repos.site, false).concat(repoLine('Private', s.priv, s.repos.private, true)).forEach(function (n) {
					repoList.appendChild(n);
				});
			}
			var reposCard = h('section', { class: 'card' }, [h('h2', { text: 'Repositories' }), repoList]);

			// API budget.
			var rateText = h('p', { id: 'home-rate', class: 'small', text: 'Asking GitHub...' });
			var rateBar = h('span', { style: { width: '0%' } });
			function drawRate() {
				var r = s.rate;
				if (!r || !r.limit) return;
				rateText.textContent = r.remaining.toLocaleString('en-US') + ' of ' + r.limit.toLocaleString('en-US') + ' requests left this hour' + (r.reset ? ' (the count starts over at ' + ui.date.time(r.reset) + ').' : '.');
				rateBar.style.width = Math.max(0, Math.min(100, (r.remaining / r.limit) * 100)) + '%';
			}
			var rateCard = h('section', { class: 'card' }, [h('h2', { text: 'GitHub API' }), h('div', { class: 'meter', 'aria-hidden': 'true' }, rateBar), rateText]);

			// Sync.
			var syncText = h('p', { id: 'home-sync', class: 'small' });
			var pendingList = h('ul', { class: 'pending-list', id: 'home-pending' });
			var syncBtn = ui.button('Sync now', {
				icon: 'refresh',
				id: 'home-sync-now',
				onClick: function () {
					ui.busy(
						syncBtn,
						api.store.flush().then(
							function (r) {
								ui.toast(r.left ? r.left + ' still waiting.' : 'Everything is on GitHub.', { kind: r.left ? 'warn' : 'ok' });
							},
							function (err) {
								ui.toast(err.message, { kind: 'bad' });
							}
						)
					);
				},
			});
			function drawSync() {
				var st = s.syncState;
				var parts = [];
				if (navigator.onLine === false || st.offline) parts.push('Offline.');
				if (!st.pending) parts.push('Everything written here is on GitHub.');
				else parts.push(st.pending + (st.pending === 1 ? ' change is' : ' changes are') + ' waiting on this device.');
				if (st.lastSaved) parts.push('Last saved ' + ui.date.ago(st.lastSaved) + '.');
				syncText.textContent = parts.join(' ');
				api.store.pending().then(function (list) {
					if (!current || current.el !== el) return;
					ui.clear(pendingList);
					list.forEach(function (p) {
						var li = h('li', {}, [h('code', { text: p.path }), h('span', { class: 'badge ' + (p.conflict ? 'badge-bad' : p.error ? 'badge-warn' : ''), text: p.conflict ? 'changed on GitHub too' : p.error ? 'refused' : p.remove ? 'delete, waiting' : 'waiting' })]);
						if (p.conflict) {
							li.appendChild(
								ui.button('Keep mine', {
									onClick: function () {
										api.store.resolve(p.path, 'mine').then(drawSync, function (err) {
											ui.toast(err.message, { kind: 'bad' });
										});
									},
								})
							);
							li.appendChild(
								ui.button('Keep GitHub\'s', {
									onClick: function () {
										api.store.resolve(p.path, 'theirs').then(drawSync, quiet);
									},
								})
							);
						} else if (p.error) {
							li.appendChild(h('span', { class: 'muted small', text: p.error }));
							li.appendChild(
								ui.button('Discard', {
									onClick: function () {
										ui.confirm({ title: 'Discard this change?', body: 'The version of ' + p.path + ' that is kept on this device will be thrown away.', action: 'Discard', danger: true }).then(function (yes) {
											if (yes) api.store.resolve(p.path, 'theirs').then(drawSync, quiet);
										});
									},
								})
							);
						}
						pendingList.appendChild(li);
					});
				}, function () {});
			}
			var syncCard = h('section', { class: 'card' }, [h('div', { class: 'card-head' }, [h('h2', { text: 'Sync' }), syncBtn]), syncText, pendingList]);

			// This device.
			var lockSelect = h('select', { class: 'input', id: 'home-lock-minutes' });
			function drawLock() {
				ui.clear(lockSelect);
				var now = lockMinutes();
				var choices = LOCK_CHOICES.slice();
				if (choices.indexOf(now) === -1) choices.push(now);
				choices
					.sort(function (a, b) {
						return a - b;
					})
					.forEach(function (m) {
						lockSelect.appendChild(h('option', { value: String(m), selected: m === now, text: m < 1 ? Math.round(m * 60) + ' seconds' : m === 60 ? '1 hour' : m === 120 ? '2 hours' : m + ' minutes' }));
					});
			}
			lockSelect.addEventListener('change', function () {
				api.settings.set('lockMinutes', Number(lockSelect.value)).then(
					function () {
						ui.toast('The Desk now locks after ' + lockSelect.options[lockSelect.selectedIndex].text + ' without activity, on every device.');
					},
					function (err) {
						ui.toast(err.message, { kind: 'bad' });
					}
				);
			});
			var deviceCard = h('section', { class: 'card' }, [
				h('h2', { text: 'This device' }),
				ui.field('Lock after this long without activity', lockSelect, 'Closing or reloading the page always locks.'),
				h('div', { class: 'actions' }, [
					ui.button('New token', {
						icon: 'key',
						id: 'home-new-token',
						onClick: function () {
							replaceToken();
						},
					}),
					ui.button('Forget this device', {
						kind: 'danger',
						id: 'home-forget',
						onClick: function () {
							forgetDevice();
						},
					}),
				]),
			]);

			el.appendChild(h('div', { class: 'home-grid' }, [who, captureCard, tilesCard, reposCard, rateCard, syncCard, deviceCard]));

			drawWho();
			drawTiles();
			drawRepos();
			drawRate();
			drawSync();
			drawLock();
			api.on('user', drawWho);
			api.on('views', drawTiles);
			api.on('repos', drawRepos);
			api.on('rate', drawRate);
			api.on('sync', drawSync);
			api.on('settings', drawLock);

			// Fresh numbers each time Home opens.
			api.gh.repo('site').then(
				function (r) {
					if (session !== s) return;
					s.repos.site = r;
					drawRepos();
				},
				function () {}
			);
			if (!s.repos.private) {
				api.gh.repo('private').then(
					function (r) {
						if (session !== s) return;
						s.repos.private = r;
						drawRepos();
					},
					function () {}
				);
			}
			api.gh.rate().then(
				function (r) {
					if (session !== s) return;
					s.rate = r;
					drawRate();
				},
				function (err) {
					rateText.textContent = err instanceof GH.errors.Offline ? 'GitHub cannot be reached right now.' : err.message;
				}
			);
		},
		unmount: function () {},
	};

	// ---- start ----------------------------------------------------------------------------

	function boot() {
		root = document.getElementById('desk-root');

		// A page that holds another page's window can reach into it. The Desk
		// therefore refuses to run inside a frame or as a window some other
		// page opened and still holds.
		var framed = false;
		try {
			framed = window.top !== window.self;
		} catch (e) {
			framed = true;
		}
		if (framed) {
			renderRefused('Not inside a frame', 'The Desk does not run inside another page. Open it in its own tab.');
			return;
		}
		if (window.opener) {
			renderRefused('Open the Desk in its own tab', 'This tab was opened by another page, which could still reach into it. Open the Desk from a bookmark or by typing its address.', h('p', {}, h('a', { class: 'btn btn-primary', href: location.href.split('#')[0], target: '_blank', rel: 'noopener noreferrer', text: 'Open the Desk in a clean tab' })));
			return;
		}
		if (!window.crypto || !window.crypto.subtle || !window.isSecureContext) {
			renderRefused('A secure connection is needed', 'The Desk encrypts the token with the browser\'s own cryptography, which only works over https (or on localhost).');
			return;
		}

		var vault = readVault();
		if (vault.damaged) {
			renderRefused(
				'The saved sign-in is damaged',
				vault.error + ' The token cannot be recovered from it. Forget this device and set the Desk up again; nothing on GitHub is affected.',
				UI.button('Forget this device and start again', {
					kind: 'danger',
					id: 'damaged-forget',
					onClick: function () {
						wipeDevice().then(function () {
							renderWizard('This device has forgotten the Desk.');
						});
					},
				})
			);
			return;
		}
		if (vault.record) renderLock(vault.record);
		else renderWizard(vault.error || '');
	}

	registerView(home);

	window.Desk = {
		registerView: registerView,
		// For tests and for views that want to know: 'wizard', 'locked', 'open' or 'refused'.
		screen: function () {
			return screen;
		},
		lock: function () {
			return lock('button');
		},
		site: { owner: SITE.owner, repo: SITE.repo, branch: SITE.branch },
		version: 1,
	};

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
	else boot();
})();
