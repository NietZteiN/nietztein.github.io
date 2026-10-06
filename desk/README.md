# The Desk

`https://nietztein.github.io/desk/` is the owner's private side of the site: write and publish posts, keep drafts, notes and a reading log, and see how the site is doing, from any device. The site stays static. The page talks to the GitHub API straight from the browser with a token the owner pastes once per browser; everything private lives in a private repository of his, never in this one.

The code here is public and does nothing without that token.

- [How it works](#how-it-works)
- [Threat model](#threat-model)
- [Setting it up (the owner)](#setting-it-up-the-owner)
- [The interface views are written against](#the-interface-views-are-written-against)
- [How to write a view](#how-to-write-a-view)
- [Tests](#tests)
- [Vendored libraries](#vendored-libraries)
- [Limits and things to know](#limits-and-things-to-know)

## How it works

| File | What it is |
| --- | --- |
| `index.html` | The page. Content-Security-Policy, `noindex`, no referrer. Loads only files from this folder. |
| `ui.js` | Theme (the site's `localStorage.theme`), DOM builder, icons, toast, dialogs, the Markdown preview, dates, list/detail layout. Loaded in `<head>` so the first paint has the right theme. |
| `vault.js` | The token at rest: PBKDF2-SHA-256 (600,000 rounds, random 16-byte salt) to HKDF to an AES-256-GCM key and an HMAC key, both non-extractable. |
| `gh.js` | The GitHub client: typed errors, sha-based concurrency, multi-file commits, and the ticket rule for the public site. |
| `store.js` | The local cache in IndexedDB, encrypted with the vault keys, and the queue of private writes that waits for the network. |
| `desk.js` | The frame: wizard, lock and unlock, auto-lock, navigation, status, the Home view, and the `api` object views receive. |
| `desk.css` | One stylesheet. The site's colour tokens, both themes, phone layout, reduced motion. |
| `views/*.js` | One file per view. Each calls `window.Desk.registerView(...)`. |
| `vendor/` | marked, DOMPurify, highlight.js, KaTeX, Bootstrap's stylesheet and the two fonts, copied from jsDelivr (see `vendor/LICENSES.md`). |
| `test/` | A fake GitHub API and the tests. |

Where things are kept:

- **Memory only, while unlocked:** the token and the keys derived from the passphrase. Locking, reloading or closing the page drops them.
- **`localStorage["desk.vault"]`:** the encrypted token (with the login and the private repository's name inside the ciphertext), encrypted extra secrets, and the login in the clear for the lock screen. Nothing else.
- **IndexedDB `desk`:** the local cache and the write queue. Every value and every key name is encrypted; only the "space" a record belongs to is readable.
- **`sessionStorage["desk.wizard"]`:** the wizard's step and the private repository's name while the owner is on github.com. Never a token.
- **The private repository:** `drafts/`, `notes/` (quick captures in `notes/inbox/`), `reading/`, `desk/settings.json`, a README.
- **The public repository:** only what the owner publishes, after the confirm dialog.

Unlocking needs no network: the passphrase opens the vault, and what was cached is readable offline. There is no service worker, though: the page itself has to be loaded (or still be in the browser's cache) before the connection goes.

## Threat model

1. **Someone copies the stored ciphertext** (a backup, malware reading the browser profile): they must guess the passphrase, at 600,000 PBKDF2 rounds a guess. A weak passphrase falls; a long one does not. The token they would get reaches two repositories and expires.
2. **A lost or borrowed phone, Desk locked:** the same as 1. The Desk locks after 30 minutes without activity (a setting) and whenever the page is closed or reloaded. Cached drafts and notes are encrypted with the same key.
3. **A lost phone, Desk open:** whoever holds it can do what the token can, until the lock. Delete the token at github.com/settings/personal-access-tokens; that ends it everywhere.
4. **Another page on this origin** (a toy under `misc/`): it can read the ciphertext (then see 1), delete the Desk's storage (the owner signs in again), and imitate the lock screen at another address. It cannot read the token or the keys, which live in another page's memory.
5. **The Desk refuses to run inside a frame or in a window another page opened and still holds**, because that page could reach into it and watch the passphrase being typed.
6. **So: type the passphrase only at `/desk/`**, opened from a bookmark, and do not merge code into the site that you have not read. Anyone who can commit to the site repository can change the Desk itself; that account is the root of trust.
7. **No third-party code runs here.** The CSP allows scripts, styles and fonts from this origin only, and connections to this site, `api.github.com` and `*.goatcounter.com` (plus `http://127.0.0.1:*` and `http://localhost:*`, for the tests: see "Why the CSP allows localhost" below).
8. **Text from outside** (file contents, commit messages, comments, names) is inserted as text. Markdown is sanitised with DOMPurify and shown in a frame without `allow-scripts`.
9. **Publishing by accident:** the GitHub client refuses every write to the public repository that does not carry a ticket, and tickets are made only when the owner presses the button in the confirm dialog (two minutes, one use, the listed paths only).
10. **Not defended against:** a compromised browser or operating system, a malicious browser extension with access to the page, and the owner's GitHub account being taken over.

`?api=` and `?goat=` (for the tests) are honoured only when the page itself is served from `127.0.0.1` or `localhost`, and only for addresses on this machine. In that mode a banner says so and the wizard accepts only the fake server's made-up tokens.

### Why the CSP allows localhost

`connect-src` in `index.html` lists `http://127.0.0.1:*` and `http://localhost:*`. The tests need them: they serve the Desk from `127.0.0.1` and point it at the fake GitHub and fake GoatCounter on other ports of the same machine. The policy is a `<meta>` tag in a static page. GitHub Pages cannot send a different header per host, and the site has no build step, so the published page carries the same allowance.

What an attacker would need to use it:

- **To send the token there**, code of their own must run inside the Desk page. `script-src 'self'` permits only files from this site, so that means committing to the site repository, which already gives them everything (point 6 above). Even then the allowance only reaches a server on the owner's own device. Such code could just as well send the token to `api.github.com`, which has to stay allowed, for example in a gist. The allowance adds no way out that the attacker did not already have.
- **The Desk itself never connects there in production.** `?api=` and `?goat=` are read only when the page is served from `127.0.0.1` or `localhost` (`readEnv` in `desk.js`). On `nietztein.github.io` the API base is fixed to `https://api.github.com`, and the client sends the token only to its API base. A link to `/desk/?api=http://127.0.0.1:8787` therefore does nothing there.
- **A program listening on the owner's machine** cannot pull anything. The page would have to send to it, and nothing in the page does. A program already running on that machine is outside what the Desk defends against (point 10).

To remove the allowance, the tests would have to serve their own copy of `index.html` with a wider policy (for example through `--mount`), so that the published page could list only `'self'`, `api.github.com` and `*.goatcounter.com`. That is not done yet.

## Setting it up (the owner)

The wizard at `/desk/` walks through this; it is repeated here for reference.

1. **Create a private repository**, for example `desk`: <https://github.com/new?name=desk&visibility=private>. Leave it empty.
2. **Create a fine-grained personal access token**: <https://github.com/settings/personal-access-tokens/new>
   - Expiration: a date (90 days is reasonable).
   - Repository access: *Only select repositories*: `nietztein.github.io` and `desk`.
   - Repository permissions: **Contents: Read and write**. Optional, each Read-only: **Actions**, **Pages**, **Discussions**.
3. **Open `/desk/`**, paste the token, choose a passphrase of at least ten characters (four unrelated words work well). The wizard checks the token, refuses a public "private" repository, creates the layout in it and encrypts the token in that browser.
4. Repeat step 3 on each device. GitHub shows a token only once, so either keep it in a password manager and paste the same one, or make one token per device (that also lets you revoke one device without the others).
5. When the token expires, the Desk shows a banner; make a new token the same way and paste it in ("New token"). Drafts and notes are untouched.
6. If a device is lost: delete the token on GitHub. "Forget this device" removes the Desk's data from a browser you still have.

The blog's own one-time settings still apply (see `blog/README.md`): the index-building Action needs "Read and write permissions" under Settings, Actions, General.

## The interface views are written against

```js
window.Desk.registerView({ id, title, icon, order, mount(el, api), unmount() })
```

| Field | |
| --- | --- |
| `id` | Lowercase letters, digits, dashes. It is the route: `#/<id>`. |
| `title` | The tab's label and the page heading. Keep it to one word on a phone. |
| `icon` | A name from `DeskUI.icons` (`home write notes reading todos stats health lock key settings plus back close external trash warning info check eye image sun moon search refresh comment globe ...`) or SVG path data for a 24 by 24 grid, drawn as a 1.8 px stroke. |
| `order` | Position in the navigation. Home is 0. Suggested: write 10, notes 20, reading 30, todos 40, stats 50, health 60. |
| `description` | Optional. One short line for the tile on Home. |
| `mount(el, api)` | Fill `el` (an empty `<section data-view="<id>">`). May return a promise; a rejection is shown as an error box. |
| `unmount()` | Optional. Stop timers, drop private data. Called on navigation and on lock. |
| `update(params)` | Optional. Called instead of a remount when only the parameters after `?` in the route change. |

Each mount gets its own `api` (it inherits the shared one). Do not keep it, or anything read through it, after `unmount()`: after a lock every call on it rejects with `Locked`.

### `api.gh`: the GitHub client

`target` is `'private'` or `'site'`. Everything returns a promise.

| Call | Result |
| --- | --- |
| `gh.user()` | `{ login, id, name, avatar, url }` |
| `gh.repo(target)` | `{ fullName, isPrivate, visibility, defaultBranch, pushedAt, url, sizeKb, canPush, hasDiscussions, hasPages }` |
| `gh.rate()` | `{ limit, remaining, used, reset }` (`reset` is a Date). Costs no request budget. `gh.rateSeen()` is the same from the last answer's headers, without a request. |
| `gh.read(target, path)` | `{ text, sha }`, or `null` when there is no such file |
| `gh.readJSON(target, path, fallback)` | the parsed value, or `fallback` when the file is missing; bad JSON rejects |
| `gh.readBytes(target, path)` | `{ bytes, sha }` (`bytes` is a Uint8Array), or `null`. Works up to 100 MB. |
| `gh.list(target, dir)` | `[{ name, path, sha, size, type }]`, `type` is `'file'` or `'dir'`. A missing folder is `[]`. At most 1,000 entries (GitHub's limit). |
| `gh.tree(target, { refresh })` | every path: `[{ path, sha, size, type }]`. Cached until this client writes to that repository; `{ refresh: true }` asks again. |
| `gh.shaOf(target, path)` | the sha this client last saw for the path (from read, list, tree or a write), or `null`. Not a promise. |
| `gh.blobSha(textOrBytes)` | the sha GitHub would give this content: compare without downloading |
| `gh.write(target, path, textOrBytes, { message, sha, ticket })` | `{ sha, commit }`. Creates or updates. Pass the `sha` you read: if the file changed meanwhile the call rejects with `Conflict` and nothing is overwritten. Without a `sha` an existing file is a `Conflict` too. |
| `gh.remove(target, path, { message, sha, ticket })` | `{ commit }`. Without `sha` the current one is looked up. |
| `gh.commit(target, changes, message, { ticket })` | `{ commit, files: { path: sha or null } }`. One commit for several files: `{ path, content }`, `{ path, bytes }`, `{ path, remove: true }`. A change may carry `sha` (what you expect to be there; `null` for "must not exist yet"): a mismatch rejects with `Conflict` and commits nothing. `commit` is `null` when nothing would change. |
| `gh.graphql(query, variables, { ticket })` | the `data` object. A mutation needs a ticket issued for that exact document (`issueTicket({ graphql: doc })`). A ticket for paths does not unlock it. No view issues one today. |
| `gh.get(apiPath, params)` | parsed JSON of any other REST GET. `gh.repoPath('site', '/actions/runs')` builds the path. Full URLs, `/graphql` (in any spelling) and paths with `.` or `..` segments are refused. |
| `gh.probeWrite(target)` | `true` if the token may write (it makes an unreferenced blob; no branch changes) |

**Every write to `'site'` needs a ticket**: `write`, `remove` and `commit` take it as `ticket` in their last argument. Without one, with a used or expired one, or with one that does not cover every path of the call, the client rejects with `PublishNotConfirmed` before sending anything. A ticket comes only from `api.ui.confirmPublish(...)`. A failed write does not spend it. Under every method sits one more gate: a request that is not GET or HEAD goes out only to the private repository, or to GraphQL with a document that holds no mutation (it is read token by token, as GitHub's parser reads it, and anything it cannot vouch for counts as a mutation), only with the grant of a ticket the method above it has checked. The gate then compares again: a grant for files covers only the site repository and the paths it was issued for, and a grant for a GraphQL mutation covers only that document. GraphQL goes only by POST; any other method to `/graphql` is refused outright.

**Lost answers.** When a write reached GitHub but its answer did not come back (the connection broke, or a 5xx after the fact), `write`, `remove` and `commit` ask GitHub what is there now: exactly what was sent counts as done (`write` and `remove` then carry `reconciled: true`; `commit` looks for its commit in the branch, or for the same content). If GitHub cannot be asked either, the call rejects with `Offline` and `.maybeCommitted`, and the message says the change may already be live (for a removal: that the file may already be gone).

The Write view builds on this. A publish or an unpublish whose outcome is unknown says "may or may not" and offers "Try again", never "it did not happen". The view remembers what it attempted (the path and the sha it wrote, or the path it removed) for as long as the view is open. The next attempt, whether "Try again" or the main button, looks at the site first. A removed file means the unpublish is done: the draft stays in the private repository, the page says so, and the main button goes back to Publish. The main button never offers to put a post back while an unpublish is unsettled. A file holding exactly what the publish wrote means the publish is done, and edits made since then go out as an update of that post, not as a new post refused for using its own address. After a reload the view no longer remembers the attempt. Opening the draft then compares it with the site (`checkLive`), and that covers the same cases.

Errors are `instanceof api.gh.errors.<Name>`, with `.name`, a `.message` in plain words that can be shown as it is, and:

| Name | When | Extra |
| --- | --- | --- |
| `Unauthorized` | 401: the token expired or was revoked. The frame shows its banner by itself. | |
| `Forbidden` | 403: a permission is missing | `.permission`, for example `'Actions: read'` |
| `NotFound` | 404 on a call that does not turn it into `null` | `.path`, `.target` |
| `Conflict` | the file changed on GitHub since it was read | `.path` |
| `RateLimited` | primary or secondary limit | `.resetAt` (Date or null) |
| `Offline` | no connection | |
| `PublishNotConfirmed` | a site write without a valid ticket | |
| `Locked` | the Desk was locked | |
| `GitHubError` | anything else | `.status`, `.detail` |

### `api.store`: on the device, encrypted

```js
api.store.get(space, key, fallback)   api.store.put(space, key, value)   api.store.del(space, key)
api.store.keys(space)                 api.store.entries(space)           api.store.clear(space)
```

Values are anything `JSON.stringify` takes. Use your view id as the space (or `'<id>.<something>'`); spaces that start with `desk.` are the frame's.

The private repository, with a cache and a queue:

| Call | |
| --- | --- |
| `api.store.read(path, { prefer })` | `{ text, sha, pending, cached }` or `null`. `pending`: your own version that GitHub does not have yet. `cached`: GitHub could not be reached, this is the device's copy. `{ prefer: 'cache' }` answers from the device without asking GitHub when it can. |
| `api.store.list(dir)` | like `gh.list('private', dir)`, with queued changes merged in (`pending: true` on those entries) and `.cached === true` on the array when it comes from the device |
| `api.store.save(path, text, { message, sha })` | `{ state: 'saved', sha }`, or `{ state: 'queued' }` when there is no network: the text is kept on the device and written when the network returns. Rejects with `Conflict` when GitHub has a newer version (yours stays queued, flagged, and Home offers "Keep mine" and "Keep GitHub's"). The `sha` defaults to the one last read. |
| `api.store.remove(path, { message, sha })` | the same for a deletion |
| `api.store.pending()` | `[{ path, at, remove, conflict, error }]` |
| `api.store.flush()` | `{ sent, left, conflicts }` |
| `api.store.resolve(path, 'mine' or 'theirs')` | settles a conflict |

The queue is for text files in the private repository. Nothing is ever published from a queue.

### The rest of `api`

| | |
| --- | --- |
| `api.secrets.get(name)`, `api.secrets.set(name, value)` | extra secrets (the GoatCounter token), encrypted with the same passphrase, kept on this device only. `set(name, null)` removes one. |
| `api.settings.get(key, fallback)`, `api.settings.set(key, value)` | `desk/settings.json` in the private repository, cached on the device, shared by all devices. `get` is synchronous; `api.settings.ready()` resolves once GitHub's copy has been read. Name your keys `'<id>.<name>'`. The frame's own key is `lockMinutes`. |
| `api.site`, `api.priv` | `{ owner, repo, branch }` |
| `api.siteRoot` | the URL of the site root this page is served from, for same-origin fetches (`api.siteRoot + 'blog/index.json'`). `api.siteUrl` is always `https://nietztein.github.io/`. |
| `api.siteConfig()` | the site's `assets/js/config.json` (promise) |
| `api.goatBase()` | where GoatCounter answers (promise): `https://nietztein.goatcounter.com`, or the `?goat=` test server |
| `api.env` | `{ test, apiBase, goat }` |
| `api.user()` | `{ login, name, avatar }` |
| `api.nav(viewId, params)` | go to `#/<viewId>?key=value` |
| `api.params`, `api.view` | the parameters of this route, and your id |
| `api.on(event, fn)` | returns a function that removes the listener; listeners added through a view's `api` are removed at unmount |
| `api.emit(event, data)` | name your own events `'<id>:<event>'` |
| `api.dirty(true or false)` | say that the view holds unsaved work: the status shows "Unsaved" and the browser asks before closing the page |
| `api.status()` | `'saved'`, `'unsaved'`, `'syncing'` or `'offline'` |
| `api.capture(text, { tags })` | saves a quick note (below) |

Events the frame emits: `unlock`, `lock` (a listener may return a promise; the frame waits up to 1.5 s so that unfinished work can be put into `api.store`), `status`, `sync`, `settings`, `user`, `repos`, `rate`, `route`, `views`, `theme`, `online`, `offline`, `capture`, `token`.

### `api.ui`

| | |
| --- | --- |
| `ui.el(tag, props, children)` | DOM builder. `props`: `class`, `text`, `on: { click }`, `data: {}`, `style: {}`, any attribute. Children are nodes or strings; strings become text. |
| `ui.clear(node)`, `ui.icon(name, size)`, `ui.button(label, { kind, icon, onClick, type, id })`, `ui.field(label, control, hint)` | `kind`: `primary`, `danger`, `quiet` |
| `ui.toast(text, { kind })` | `kind`: `ok` (default), `warn`, `bad` |
| `ui.confirm({ title, body, action, danger })` | promise of `true` or `false` |
| `ui.confirmPublish({ title, paths, summary, previewNode, action })` | promise of a ticket, or `null` when cancelled. `paths` is every path the write will touch: strings, or `{ path, note }`. Cancel has the focus. |
| `ui.dialog(build, { wide })` | a modal of your own: `build(dialogElement, close)` |
| `ui.busy(element, promise)` | marks a button as working until the promise settles; returns the promise |
| `ui.renderMarkdown(el, markdown, { theme, post, title, date, resolveUrl })` | renders as the blog does (marked 12.0.2 with gfm and no breaks, DOMPurify 3.1.6, highlight.js 11.9.0, KaTeX 0.16.9 with the same delimiters) into a frame inside `el` that has the site's stylesheet and cannot run scripts. `post: true`: `markdown` is a whole post file; the title and date from its front matter are shown above the body as on the site. `resolveUrl(url, 'src' or 'href')` may return a `blob:` URL for an image that is not published yet. Resolves with `{ frame, body, title, date, fm }`. Call it again with the same `el` to update in place. |
| `ui.safeHTML(el, html)` | sets sanitised HTML (promise) |
| `ui.parsePost(text)`, `ui.buildPost(fm, body)` | front matter exactly as `assets/js/blog.js` reads it, and the inverse |
| `ui.date` | `iso()` `2026-10-05` (local day), `stamp()` `20261005T140322Z`, `utc()` `2026-10-05T14:03:22Z`, `long(v)` `October 5, 2026`, `short(v)`, `time(v)`, `ago(v)`, `parse(v)` |
| `ui.listDetail(el, { label, onClose })` | `{ list, detail, open(), close(), isOpen(), isNarrow() }`: two panes on a wide screen, one at a time under 760 px with a Back button |
| `ui.row({ title, meta, badge, badgeKind, current, onClick })` | a row for such a list |
| `ui.errorBox(err, retry)`, `ui.notice(text, kind)` | plain-words boxes |
| `ui.theme` | `get()`, `set()`, `toggle()`, `onChange(fn)` |

### Shared conventions

- **Quick notes** (`api.capture`, the box on Home) are files `notes/inbox/<YYYYMMDD>T<HHMMSS>Z-<two characters>.md`:

  ```
  ---
  created: 2026-10-05T14:03:22Z
  tags: [inbox]
  ---

  the text
  ```

  `created` is UTC; `tags` defaults to `[inbox]`; tags are lowercase with dashes. `ui.parsePost` reads it.
- Files whose name starts with a dot (`.gitkeep`) are housekeeping: skip them in listings.
- Desk-wide JSON that is not a setting goes under `desk/` in the private repository.
- Never write to `blog/index.json`: the Action builds it after a push that touches `blog/posts/`.
- The page's `<h1>` is the view's title in the top bar. Start your own headings at `<h2>`.
- A private image is shown by reading it through the API and making a `blob:` URL: `gh.readBytes('private', path)` then `URL.createObjectURL(new Blob([r.bytes], { type: 'image/png' }))`. Revoke the URL in `unmount()`. The CSP allows images from this site, `data:`, `blob:` and `avatars.githubusercontent.com` only.

## How to write a view

```js
// desk/views/notes.js
(function () {
	'use strict';

	var timer = null;

	window.Desk.registerView({
		id: 'notes',
		title: 'Notes',
		icon: 'notes',
		order: 20,
		description: 'Everything captured, newest first.',

		mount: function (el, api) {
			var ui = api.ui;
			var list = ui.el('div', { class: 'card' }, 'Loading...');
			el.appendChild(list);
			return api.store.list('notes/inbox').then(function (files) {
				ui.clear(list);
				files
					.filter(function (f) { return f.type === 'file' && f.name.charAt(0) !== '.'; })
					.forEach(function (f) {
						list.appendChild(ui.row({ title: f.name, badge: f.pending ? 'not sent yet' : '', onClick: function () { /* ... */ } }));
					});
			});
		},

		unmount: function () {
			clearTimeout(timer);
		},
	});
})();
```

- Old-style JavaScript like the rest of the site: one IIFE, `'use strict'`, `var`, `function`, tabs, no modules.
- Build DOM with `ui.el`. Never set `innerHTML` from a file, a commit message, a comment or a name; use `ui.renderMarkdown` or `ui.safeHTML` for anything that is HTML.
- Load nothing from another origin: the CSP blocks it, and a blocked request fails the smoke test.
- Use the classes in `desk.css` (`card`, `card-head`, `btn`, `input`, `field`, `notice`, `badge`, `kv`, `actions`, `row`, `muted`, `small`, `mono`, `sr-only`). For more, add one `<style>` element from your file and start every selector with `[data-view="<id>"]`; use the colour tokens (`var(--surface)`, `var(--accent)`, `var(--ok)`, `var(--warn)`, `var(--bad)` ...) so both themes work.
- 360 px wide, targets of 44 px, everything reachable by keyboard, nothing moving under `prefers-reduced-motion`.
- Prefer `api.store.read` / `save` / `list` for private text: they work offline. Use `api.gh` directly for bytes, for multi-file commits and for the site.
- To publish: `ui.confirmPublish({ paths, summary, previewNode })`, then `gh.commit('site', changes, message, { ticket })` with exactly those paths. Publish only what the owner typed.
- Catch errors and show `err.message`; it is written to be read. On `Forbidden` say which view feature needs `err.permission`.

## Tests

```
node desk/test/test-vault.mjs      the vault: round trip, wrong passphrase, tampering, parameters
node desk/test/test-gh.mjs         every client method against the fake server: conflict, 401, 403, 404,
                                   rate limit, offline, the ticket rule
node desk/test/test-store.mjs      the encrypted store and the offline queue
node scripts/qa/smoke.mjs --path desk
node desk/vendor/fetch-vendor.mjs --check
```

`test/fake-github.mjs` is a fake GitHub API with repositories in memory (its header lists the repositories, the tokens and what a test can ask of it). It accepts only its own made-up tokens. By hand: `node desk/test/fake-github.mjs` and `node scripts/serve.mjs`, then open `<site address>desk/?api=http://127.0.0.1:8787`.

Browser tests are `scripts/qa/drive.mjs` scripts kept in a scratch folder. `test/drive-helpers.mjs` saves the boilerplate:

```js
import { startFakeGitHub, TOKENS } from 'file:///<repo>/desk/test/fake-github.mjs';
import { openDesk, signIn, lock, unlock, screen, fill, stubView, storageDump } from 'file:///<repo>/desk/test/drive-helpers.mjs';

export default async function (ctx) {
	const fake = await startFakeGitHub();
	try {
		fake.repo('NietZteiN/desk-ready').put('notes/a.md', 'seeded by the test\n');
		const page = await openDesk(ctx, fake, { width: 390, height: 844, mobile: true, theme: 'dark' });
		await signIn(page);                               // the owner, repository desk-ready
		await page.goto(page.deskUrl + '#/notes');
		// ... page.click, page.type, ctx.assert ...
		ctx.assert.equal(fake.repo('NietZteiN/desk-ready').text('notes/a.md'), 'seeded by the test\n');
	} finally {
		await fake.close();
	}
}
```

Hooks for tests: `window.Desk.screen()` is `'wizard'`, `'locked'`, `'open'` or `'refused'`; `#desk-status[data-state]` is the sync state; `window.__toyReady` becomes true once the first screen is drawn. The browser logs every non-2xx answer as a `log.error` with `source: 'network'`; filter those when asserting on `page.errors`. Requests to the fake server are on another port, so pass `extraAllowedHosts: ['127.0.0.1']` (`openDesk` does).

## Vendored libraries

`node desk/vendor/fetch-vendor.mjs` fetches them from jsDelivr and rewrites `vendor/LICENSES.md` (source URL, licence, size, SHA-256 of each file). marked 12.0.2, DOMPurify 3.1.6, highlight.js 11.9.0 (with the `github` and `github-dark` themes) and KaTeX 0.16.9 (auto-render, stylesheet, woff2 fonts) are the versions `index.html` and `assets/js/blog.js` load. Bootstrap 5.3.3's stylesheet and the Inter and JetBrains Mono fonts are there so that the preview frame looks like the live post. The libraries are loaded on the first preview, not at start.

If the blog's versions change, change them in `fetch-vendor.mjs` too and run it again.

## Limits and things to know

- A brand-new private repository has no commit, and GitHub's git data API refuses to work on it, so the layout arrives in two commits there (the README, then the rest). On a repository with at least one commit it is one.
- GitHub does not let a browser read the token's expiry date or the list of missing permissions (those headers are not exposed to scripts). The Desk names the missing permission from the call that failed, and learns of an expired token from the first 401.
- A fine-grained token can read the Actions runs and discussions of a public repository without those permissions, so on the real site the optional checks will usually pass either way.
- The preview frame shows images from this site, `data:` and `blob:` URLs. An image hosted elsewhere is blocked by the CSP in the preview, although it would show on the live post.
- The preview shows the post title twice when the body starts with its own `# Title`: so does the live site.
- Password managers may offer to save the passphrase. That is the owner's choice; a saved passphrase is as safe as the device's own lock.
- The Write view stores what is typed on the device (encrypted) at the first change, then at most a second apart and 0.3 s after the last key. Its status says "On this device" only once the device has confirmed the write; until then it says "Writing the latest changes to this device...". The encryption is asynchronous, so a write begun as the page unloads may not finish: a reload or a closed tab can lose up to the last second of typing, never what the status already called kept. A post longer than 200,000 characters gets its preview on a button press instead of on every key.
- `localStorage` and IndexedDB are per browser. Private windows, and browsers that clear site data on exit, forget the Desk each time.
- Two tabs of the Desk can be open at once; each is unlocked separately. "Forget this device" in one tab ends the session in the others. If both send the same queued change, the second finds GitHub already has that exact text and treats it as saved.
- Everything was tested against the fake GitHub in `test/`, never against github.com (the builder had no token). The first real sign-in is the first real test of the calls: the wizard reports each one, and stores nothing if one fails.
