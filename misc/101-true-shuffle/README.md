# True Shuffle: the core

Toy 101. A music player for one listener's YouTube playlists and Liked videos: sign in with Google (read-only), import, then browse by artist, genre, mood, scene and the anime or game a song is from, and listen in a real shuffle or by other rules. Since 2026-10-08 the page is an app (see "The page" below) and tracks can carry hand-made labels (see "Labels").

| File | What it is | Needs a browser |
| --- | --- | --- |
| `config.js` | The settings the owner fills in: the Google client id. | no |
| `parse.js` | Artist and title from a video's title and channel. | no |
| `library.js` | The library model: tracks, corrections, aliases, genres, facets, search, duplicates, statistics. | no |
| `shuffle.js` | The listening modes, the bag, the limits, the queue reducer, the seeded random source. | no |
| `store.js` | IndexedDB behind a plain interface, with an in-memory twin; export and import. | IndexedDB half |
| `player.js` | One player interface over the YouTube IFrame player and a mock; the controller that walks a queue. | YouTube half |
| `taxonomy.js` | The taste map: genres in families, and the names of the other labels. | no |
| `discover.js` | Related artists and their best songs from Deezer, through a sandboxed JSONP frame. | frame only |
| `embed.js` | Embeddings of the tracks, nearest neighbours, the 2D layout of the map, its regions. | no |
| `demo.js` | An invented library of 160 tracks for `?demo=1` and `?thumb=1`, labelled. | no |
| `yt.js` | Google sign-in, the YouTube Data API client, the resumable import, the refresh, MusicBrainz. | sign-in redirect only |
| `test.js` | `node misc/101-true-shuffle/test.js`: over 700 checks, PASS and FAIL lines, exit 1 on failure. | no |
| `test/fake-youtube.mjs` | A local fake of the Google endpoints, for tests. | no |
| `toy.json` | The manifest (`"status": "wip"` until the page exists). | |
| `ui.js` | The page's small parts: DOM builder, icons, router, menus, dialogs, virtual list, cover art. | yes |
| `index.html`, `app.js`, `app.css` | The page. | yes |

Everything is UMD: in the browser each file adds one member to `window.TrueShuffle` (`config`, `parse`, `library`, `shuffle`, `store`, `player`, `demo`, `yt`); in Node each is a CommonJS module. The sources are plain ASCII (other characters are written as escapes), old-style (`var`, `function`, one IIFE), tabs.

```html
<script src="config.js"></script>
<script src="parse.js"></script>
<script src="library.js"></script>     <!-- needs parse -->
<script src="shuffle.js"></script>
<script src="store.js"></script>
<script src="player.js"></script>      <!-- needs shuffle -->
<script src="taxonomy.js"></script>
<script src="embed.js"></script>
<script src="discover.js"></script>
<script src="demo.js"></script>        <!-- needs library, shuffle -->
<script src="yt.js"></script>          <!-- needs parse, library -->
<script src="ui.js"></script>
<script src="app.js"></script>
```

Loading these contacts no host. Nothing reaches Google, YouTube or MusicBrainz until the reader presses Sign in, Import, Play or the genre button (checked in a browser: a plain load makes requests to the page's own server only).

## The page in one screen

app.js uses all of this; the lines below are the bones of it.

```js
var TS = window.TrueShuffle, L = TS.library, S = TS.shuffle, Y = TS.yt;

// 1. Start-up
var demo = ToyKit.thumb || ToyKit.params.get('demo') === '1';
var ep = Y.endpoints();                                   // Google, or the local fake on localhost
var auth = Y.createAuth({ clientId: TS.config.clientId || ToyKit.load('clientId', ''), mode: TS.config.signIn, endpoints: ep });
var back = demo ? { status: 'none' } : auth.handleRedirect();   // FIRST THING: takes the token out of the address
var client = Y.createClient({ getToken: auth.token, endpoints: ep, onSignedOut: auth.forget, onQuota: countIt });
var store, lib;
(demo ? Promise.resolve(TS.store.memory()) : TS.store.open()).then(function (s) {
	store = s;
	if (demo) { var d = TS.demo.build(now); lib = d.lib; showLabel(d.label); return; }
	return store.loadLibrary().then(function (parts) { lib = L.fromParts(parts); });
}).then(draw).then(ToyKit.ready);

// 2. Sign in (from a click), list, import
auth.signIn();                                            // leaves the page; comes back through handleRedirect()
client.sources().then(function (r) { /* r.sources: Liked videos first, then playlists */ });
Y.importInto({ client: client, lib: lib, store: store, playlist: source, onProgress: show });

// 3. Listen
var built = S.build(L.list(lib), { mode: 'spread', select: { genres: ['Jazz'] }, keepRuns: true, limits: { maxMinutes: 45 } });
var player = TS.player.create(demo ? { kind: 'mock', container: box, durationOf: lengthOf, errorOf: demoErrors } : { kind: 'youtube', container: box });
var ctl = TS.player.controller({
	player: player,
	onChange: function (state) { drawQueue(state); store.set('queue', state); },
	onListened: function (id, info) { var t = L.recordPlay(lib, id, info); store.putTracks([t]); store.addHistory({ id: id, at: info.at, kind: info.completed ? 'play' : 'skip', listenedSec: info.listenedSec }); },
	onUnplayable: function (id, code) { store.putTracks([L.markUnplayable(lib, id, code, Date.now())]); }
});
ctl.load(built.order);

// 4. Leave
auth.signOut();          // revokes the token at Google and forgets it
store.wipe();            // deletes everything stored
```

Every library function that changes something returns the ids (or the track) it changed; write those with `store.putTracks(ids.map(function (id) { return lib.tracks[id]; }))`, and after a change to aliases, channel rules, genre overrides or settings also `store.saveLibraryMeta(L.meta(lib))`.

**Imported data is untrusted text.** Titles come from YouTube and from files the reader imports. Put them on the page with `textContent`, never `innerHTML`.

## The page

An app shell: the kit's header is the top bar (brand, back and forward, the search box; the kit adds theme, help and the link back to the site), then the sections, the view, and the now-playing panel (YouTube's player, this track's labels and rating, the queue and what played), with the player bar at the bottom. Under 1180 px the sections keep only their icons; under 760 px the page is a phone app: tabs at the bottom, the video docked under the top bar once something plays (it never shrinks below 200 px), the queue as a sheet.

Views, by hash: `#/` home (quick starts, today's mix, moods, families, scenes, artists, works, recently added), `#/search?q=`, `#/songs`, `#/artists`, `#/artist/<key>` (play, shuffle, artist radio, appears in, sounds like), `#/genres`, `#/family/<key>`, `#/genre/<name>`, `#/browse` (moods, scenes, languages, decades), `#/c/<mood|scene|lang|decade|role>/<value>`, `#/works`, `#/work/<name>`, `#/track/<id>`, `#/mix` (the mix builder; saved mixes are stations), `#/stats`, `#/fix` (unsure artists with one-tap readings, unlabelled, duplicates, unplayable, blocked), `#/settings` (YouTube, labels, backup, cover art, MusicBrainz, privacy), `#/library` (the phone's hub).

Every collection has Play (in order) and Shuffle (its filters as a plan, in the current order mode); Radio plays songs that share genres, mood, scene, language and family with a seed. Track lists are virtual, select with click, Ctrl or Cmd and Shift, play with a double click or Enter (one tap on a phone), and have a menu per row (the menu key or Shift+F10 too) and a bar for a selection. The editor edits one track or many (fields left alone stay). Cover art is the video's thumbnail from i.ytimg.com when there is a library, never in the demo, and can be switched off in Settings.

**Playlists and focus (#/lists, #/list/<id>).** A playlist is smart (`{ id, name, kind: 'smart', patch, mode }`: a saved filter in the plan's terms, so songs join and leave as their labels change) or hand-picked (`{ kind: 'manual', ids }`). They are kept under the store key `lists` (older `presets` are migrated). Focus (the button left of the search, key `focus`) narrows the whole app to one playlist: every view, search, the index the views count from, the shuffle's selection and bag (its key gains `:<id>`), radio and the map read `scopeTracks()`. Every collection page (genre, family, mood, scene, work, artist, search results) offers Focus and Save as playlist; the playlists page suggests ones built from the library (each scene, openings, endings, mood and scene pairs, the biggest works). Songs are added to a hand-picked playlist from a song's menu, a selection, or by dragging rows onto it in the sidebar; dragging onto the queue panel queues them.

**Shuffle options.** The plan carries `apart` (default on: `S.apart` keeps songs of one work, like one artist, from playing back to back in every order but the true shuffle and the rotations), `oneVersion` (one version of each song, `S.songKey`, per build or per bag round) and `text`. The order modes gain `flow` (`S.flowOrder`, Mood flow): a walk where each song leads to a near one by `S.labelSimilarity` (shared genres, `S.moodDistance` on `S.MOOD_RING`, scene, language), never the same artist or `S.workKey` as the last two.

**The map (#/map).** `embed.js` turns the tracks of the scope into vectors by one of `E.RECIPES`: Sound (the labels), Names (character trigrams of titles, artists and works, hashed), Taste timeline (labels and when each song was added), Blend, and Language model (multilingual MiniLM through transformers.js 4.3.1 from jsDelivr and the model from Hugging Face, about 120 MB, only after the reader asks; the vectors are kept, quantised, under `lm:vectors`). The page finds 15 neighbours each and lays the graph out in slices so it animates, then names k-means regions by their commonest genre or work. Colour by genre family, mood, scene or language (the eight validated categorical hues in a fixed order; the rest fold into Other) or by year and plays (one blue ramp). Drag, scroll or pinch, click a dot (play, play its neighbourhood), Shift-drag a box (shuffle, save as playlist); the legend fades categories; the regions are listed under the map as buttons for the keyboard. The queue's next tracks are drawn as a path.

**Discover (#/discover?seed=<track> or ?artist=<key>).** Songs that are not in the library yet. `discover.js` asks Deezer's public API (no key) for the seed artist, its related artists and their top songs. Deezer sends no CORS header, only JSONP, which runs the server's script; so `sandboxTransport()` runs it in a hidden iframe with `sandbox="allow-scripts"` and no same origin: the frame cannot read this page, its storage or the sign-in token, accepts only `https://api.deezer.com/` addresses, and posts plain JSON back, which the page checks (only Deezer's own picture and preview hosts are used) and shows as text. `createDeezer({ transport })` (`searchArtists`, `related`, `top`, cached), `findArtist(dz, names, titles)` (the artist whose top songs include a title the library has; with titles to check and none matching, another artist of the same name is refused), `suggest(dz, { names, titles, known, hidden, perArtist, artists })` (the related artists, the seed and hidden ones left out, those the library lacks first, each with its top songs), `norm`, `youtubeQuery`, `bestVideo(results, track)` (the Topic channel first, covers last), `API`. When Deezer does not know the artist the page tries the three library artists that sound closest. A preview plays 30 seconds in the page (the YouTube player pauses). Play, when signed in, runs one `client.search(query, { max })` (`SEARCH_UNITS`, 100 quota units; every other call costs one) and one `videoBatch`, adds the video to the local playlist `local:discovered` ("Discovered") with the artist and title as labels, and plays it; signed out, it opens a YouTube search in a new tab. "Not interested" keeps an artist out (`discover:hidden`). The page also lists songs like the seed from the library that were played at most once, and, signed in, a YouTube search box prefilled from the labels.

**Controls (third pass).** The shuffle order is a labelled pill in the player bar (O), in the queue under "Playing from", next to Shuffle everything on the home page, and every Shuffle button is split: the main part shuffles in the current order, the caret picks another; the order menu describes each order and toggles keeping works apart and one version per song. Under the video: S, M and L sizes, theater mode (T: a wide player, the sections as icons) and full screen (F); the panel's edge still drags. Volume and mute (M, - and =; `p.volume(0..100)` and `p.muted(bool)` on both players, remembered); a heart likes a song (rating 5; L), and #/liked lists what is rated 4 or more (`minRating` in the plan). Ctrl+K opens a palette over pages, actions, playlists, artists, works, genres, moods, scenes, years and songs; ? lists the keys. Blocking, removing from a playlist, clearing the queue and liking can be undone from the toast. Long pages keep a compact header with Play. Song lists can be compact (Settings).

**When you added them (#/c/added/<year or year-month>).** `S.firstAdded(track)` is when a track first came into the library (its earliest playlist addition) and `S.addedKeys(track)` its year and month as keys (`['2021', '2021-05']`, UTC). `select` takes `added` (those keys) and `addedFrom`, `addedTo` (ISO days, both included); the plan carries them, so smart playlists and Focus can be "added in 2021" or "added between March and June 2025". Browse shows a tile per year and a column per month (each opens that month); a year or month page has Play, Shuffle, Focus and Save as playlist, and chips for its months and the years around it. The mix builder has year and month rows and a date range; the playlists page suggests one per year with 40 songs or more; the home page shows songs added around this time in earlier years; Your numbers has songs added per year.

**Discover, the hub (#/discover).** Without a seed the page is a hub: explore any artist on Deezer by name; a preview radio from your taste (the Deezer artist mixes of six of your top artists, songs you have left out, artists spread apart); "Because you like X" for five top artists (related artists you lack, each with its own preview radio); new releases from your artists (the last two years); more songs by your artists that are not in the library; picks from Deezer playlists of your top genres; and songs saved for later (`discover:saved`). `#/discover?dz=<id>` is any artist on Deezer: top songs, releases (a release opens its tracks), related artists to follow, an artist mix. The preview radio plays 30-second previews one after another in a bar above the player, with save, play on YouTube and not interested. `createDeezer` also has `artist`, `albums` (newest first, through `albumOf`), `albumTracks`, `radio`, `searchPlaylists` and `playlistTracks`; `trackOf` carries `artistId`; `img` keeps only Deezer's image hosts. Requests leave at least 125 ms apart and a "quota exceeded" answer (Deezer allows 50 requests in 5 seconds) waits and tries again; the Deezer ids of library artists are kept (`discover:ids`), as are recent seeds (`discover:recent`).

**Moods & scenes (#/browse).** A mix-and-match panel combines moods, scenes, languages, genre families, eras and years added (alternatives within a row, rows narrowing each other; every choice shows how many songs it would give with the others), keeps the choice in the address, and offers Play, Shuffle, Focus and Save as playlist with the list below. A grid of moods against scenes, genre families, languages, years added or eras links every cell to that combination. Mood and scene pages show how to split them further.

**History (#/history), the quick labeller (#/label), small things.** History keeps every listen in the store and shows On repeat, plays per month and the days. The labeller walks the unlabelled songs (or a selection) one at a time with suggestions from the channel, the artist and similar titles; 1 to 6 set the mood, Enter saves, the arrows move. Work pages filter by role (openings, endings...). The player bar has repeat and a sleep timer.

**Sync with the Desk.** The page keeps `sync:outbox` in its store: `{ format: 'true-shuffle-sync', version: 1, savedAt, labels (exportLabels), state: { videoId: { rating, blocked, plays, skips, lastPlayed, stateAt } }, stations (the playlists), history }`, the owner's own data and never YouTube's. The Desk's Music view (`desk/views/music.js`) pushes it to the private repository and pulls it back into `sync:inbox`, which the page merges on start and on focus (ratings and blocks by `stateAt`, which `edit` stamps; plays and skips as the larger count; labels applied; playlists and history added) and deletes.

## Labels

A labels file is a hand-made reading of a library, kept apart from it:

```js
{ format: 'true-shuffle-labels', version: 1,
  tracks:  { videoId: { artist, title, titleAlt, origArtist, version, year, genres,
                        scene, work, role, lang, mood, kind } },
  artists: { 'Name': { native, genres, scene, lang } },   // passed on to later imports
  aliases: { 'Other spelling': 'Name' } }
```

`L.applyLabels(lib, data)` stores each track's labels in `track.labels`, the artists' `native`, `scene` and `lang` in `lib.profiles` (kept in the meta) and their genres as artist genres, and derives everything: `-> { ids, matched, missing, artists }`. `L.checkLabels(data)` is the check (`''` or a sentence), `L.LABELS_FORMAT` the format name, `L.exportLabels(lib, now)` writes the labels back out with the user's corrections folded in. The order of authority is the user's correction (`userEdits`), then the label, then the artist's profile (scene, language), then the parser; taking a correction back returns to the label. `L.LABEL_FIELDS` are the fields beyond the corrected five (`titleAlt origArtist scene work role lang mood kind`); `edit` and `editMany` take them too. A labelled artist is fixed like a corrected one (`L.fixedArtist(t)`): never re-read by the parser, never taught over. A track also gets `artistNative` from the profile. `facets()` adds `scene`, `work`, `lang`, `mood`, `kind`; `search()` also looks at `titleAlt`, `artistNative`, `work` and `origArtist`; `S.select` takes `scenes works langs moods kinds roles` (and under `not`). The page leaves clips (`kind: 'clip'`) out of every shuffle unless asked.

The owner's own labels file is not in this repository: it describes a private playlist and lives with the owner.

## embed.js

`TS.embed`: `RECIPES`, `vectors(tracks, recipe, { taxonomy, firstAdded, lm })` (unit-length `Float32Array` rows; `labelVectors`, `nameVectors`, `timeVectors` are the parts), `describe(track, taxonomy)` (the sentence the language model reads), `knn(vecs, k)` and `knnJob(vecs, k)` (the same in slices: `step(budgetMs)` until `done`), `layout(vecs, nn, { rand, epochs })` (a UMAP-like layout from the first two principal components, `pca2`; `step(budgetMs)`, `pos`), `regions(pos, tracks, k, rand)` (k-means on the layout, each `{ x, y, name, mood, size, members }`), `dot`, `unit`. Pure; the seeded random source makes the same map every time.

## taxonomy.js

`TS.taxonomy`: `FAMILIES` (twelve families, each `{ key, name, hue, blurb, genres: [[name, blurb]], list: [{ name, blurb, family }] }`), `SCENES`, `MOODS` (with a sentence each), `LANGS`, `KINDS`, `ROLES` as `[key, name]` rows and `SCENE_NAME`, `MOOD_NAME`, `LANG_NAME`, `KIND_NAME`, `ROLE_NAME` as maps. `genre(name)`, `family(key)`, `familyOf(genre)` (`'other'` for a genre the map does not know, such as YouTube's own Rock), `trackFamily(track)` (its first known genre's), `genresOfFamily(key, known)` (for `'other'`, also the unknown genres in `known`), `hueOf(genre or family key)` (`{ h, s }`: one hue per family, shifted a little per genre). The map was written by hand for one listener's library: anime and visual-novel music, J-rock, city pop and Shibuya-kei, net music, western indie and classics, scores, musicals and classical.

## What YouTube's terms ask of the page

The core does what it can; the rest is the page's.

| Rule | Who |
| --- | --- |
| The player is visible, at least 200 by 200 px, with YouTube's own controls. | `player.js` refuses to build in a smaller or hidden box (`error` with code `'too-small'`) and never turns the controls off. The page must not cover the player, shrink it, move it off screen, or keep playing with the player hidden (no "audio only" view, no background tab trick). |
| A visible link to the YouTube Terms of Service and to Google's Privacy Policy. | The page: `Y.TERMS.youtubeTerms`, `Y.TERMS.googlePrivacy`. Put them in the footer and in the help, and say "This page uses YouTube API Services". |
| A way to delete all stored data and to revoke access. | The page offers both: `store.wipe()` (and `ToyKit.store(key, null)` for anything it kept through the kit), and `auth.signOut()`. Also link `Y.TERMS.googlePermissions`, where Google lets the user remove access himself. |
| Stored API data is refreshed or deleted within 30 days. | At each sign-in: `if (L.stale(lib, Date.now(), TS.config.refreshDays).length) Y.refreshInto({ client, lib, store })`. `L.stats(lib).staleCount` is for a banner when he has not signed in for a month: offer "sign in to refresh" or "delete". |
| "What this page stores." | A short plain note in the help and the footer. The bench's wording can be reused: the imported lists with titles, channels, lengths and topics as YouTube reports them; his corrections, tags, ratings, play counts, history and queues; all in this browser only (IndexedDB); the sign-in token for the tab's session only (sessionStorage); nothing sent anywhere but to Google. |

When a video plays, YouTube's iframe contacts hosts of its own that are not in `toy.json` (seen on 2026-10-05: `*.googlevideo.com`, `yt3.ggpht.com`, `www.gstatic.com`, `ssl.gstatic.com`, `www.google.com`, `jnn-pa.googleapis.com`, `fonts.gstatic.com`). The smoke gate never plays anything, so it does not see them; a drive script that plays a real video needs them in `extraAllowedHosts`.

## Addresses

| Address | What the page does |
| --- | --- |
| plain | The stored library if there is one; otherwise the setup note (no client id) or "sign in". Contacts nothing. |
| `?demo=1` | `TS.demo.build(Date.now())`, `TS.store.memory()`, the mock player. Shows `demo.label`. Never signs in. |
| `?thumb=1` | The demo with a fixed clock and fixed seeds, drawn at once, nothing moving. |
| `?api=http://127.0.0.1:<port>` | Only when the page itself is on localhost: all Google calls go to `test/fake-youtube.mjs`. Remembered for the tab (it has to survive the sign-in redirect); `?api=off` forgets it. Ignored on any other host. |
| `#access_token=...&state=...` | The sign-in answer. `auth.handleRedirect()` consumes and removes it. |

## parse.js

```js
TS.parse.parse(title, channel, { channelRule, known }) ->
  { artist, title, version, versionText, feat, performer, album, trackNo, year, tags,
    soundtrack, classical, whole, confidence, rule, vouched }
```

`artist` is `''` when unknown. `version` is one or more of `TS.parse.VERSION_KINDS` joined by `+` in a fixed order (`cover remix live acoustic instrumental karaoke piano orchestral remaster demo extended edit sped-up slowed tv-size short acapella session language alt`), `''` for the plain recording; `versionText` is what the title said ("Live at Red Hollow 2019"). `whole` is the title with its junk removed but not split. `confidence` is 0 to 1; `rule` names the rule that fired, and `TS.parse.RULES[rule]` is a sentence about it. The parser is conservative, and since 2026-10-05 it follows one policy: **an artist is trusted only when something besides the shape of the title vouches for it.** `vouched` says what did: `'rule'` (a format the user set for the channel), `'topic'` (an auto-generated "Artist - Topic" channel), `'channel'` (the artist is the channel's own name, or that name and a credit, or the channel is the artist's VEVO or Official one, or the other side of a classical title is the channel's name), `'session'` (`dash-session`: a live-session channel named in the title's live tag), `'label'` (`dash-label`: a record label's official upload), `'library'` (`known-artist` where the library names that side from one of these sources or from a correction) or `'composer'` (a composer from the parser's table named first or before a colon). When nothing vouches, `vouched` is `''` and the confidence is capped at 0.5, under `library.js`'s threshold of 0.6: the reading is kept in `track.guess`, and the page shows the channel's name in the artist's place, marked as a guess, with the title as uploaded and one button per reading ("By Chuck Berry?") that saves it in one tap and offers to read the channel's other guesses the same way (only those: see `teachPlan` below). A wrong artist is worse than a guess.

**The channel's name, whole words (third review, 2026-10-06).** Every comparison of a side with the channel goes through `sameArtist`, which works on whole words after the same normalisation on both sides (no accents or case, "&" is "and", a leading "The" dropped, a camel-case channel name split into its words). It answers 2 when the side is the channel's name ("Earth, Wind & Fire" on "Earth Wind and Fire", "Oasis" on "oasisinet", "Lil Nas X" on "Lil Nas X Music", "The Piano Guys" on "ThePianoGuys"), 1 when the side is that name and a credit ("Heart feat. Ann Wilson"; "&", "and", ",", "with" count as a credit only on the artist's Official or VEVO channel or after a name of two words or more, since a song can be called "Heart & Soul"), and 0 otherwise. Where two sides are weighed, the higher level wins, so "Rush Hour - Rush" on the channel Rush is by Rush. A side that only starts with the channel's name is not its artist: before this, "Kissin' Time - KISS" on KISS, "Moonlight - XXXTENTACION" on Moon and "Bohemian Rhapsody - Queen" on "Bohemian Rhapsody Fan" were read with the title as the artist at 0.95. "Fan" and "Fans" are not channel words: "X Fans" does not vouch for X.

**Two more shapes that vouch.** `dash-session` (0.75): "Artist - Title (Live at Red Hollow)" on "Red Hollow Sessions", "(Live on KXFM)" on KXFM, "| A HARBOR SHOW" on HARBOR: the channel's own words (without "Sessions", "Live", "Music" and the like) all stand in a tag that speaks of a performance, and live-session series put the artist first. `dash-label` (0.7): an "(Official Video)" upload, or any upload on a label's "Official" channel, by a channel named as a record label ("Records", "Recordings", "Music Group", "Entertainment", "Label"; not a lyrics, mix or "hits" channel). Neither applies to a lyrics or cover upload, and the library's sure names still decide first.

Measured on 2026-10-05 on two fresh sets of sixty realistic titles that were not used to write the rules (the re-checker's, and a second one): 0 and 0 confidently wrong artists (the first set had 7 before the policy), with 13 and 22 titles shown as guesses; on the first review's 75 rows, 0 wrong and 14 unknown or guessed. Known misreading left: "Name - Other Artist" where Name is a sure artist elsewhere in the library (a song called after an artist). The figures in the table below are the confidence a shape gets when something vouches for it; otherwise it is at most 0.5.

Measured again on 2026-10-06 after the whole-word change: the reviewer's 49 fresh rows aimed at the trust sources give 0 confidently wrong (9 before), its 12 own-channel probes are all right or guesses, and the 75-row and 60-row sets stay at 0 wrong with 14 and 13 guesses. On the fake API's PL_BIG (1,159 tracks after deletions), guesses fall from 386 (33.3%) to 193 (16.7%) with 0 confidently wrong: the "Live at Red Hollow" session uploads are now vouched for, and the lyrics-channel uploads, which use both orders in real life, stay guesses. The demo library keeps its 22 tracks without a sure artist (six soundtrack pieces, four on a channel of ambiguous format, twelve on a stranger's channel).

| Shape | Example (invented) | Result |
| --- | --- | --- |
| Artist - Title, any dash | `Glass Orchard – Winter Almanac` | `dash`, 0.95 when the channel is the artist; on a stranger's channel a guess (0.5) |
| Title - Artist | `Blue Signal - Paper Lanterns` on the channel Paper Lanterns | `dash-title-artist`, 0.9 |
| Title / Artist | `Blue Signal／Paper Lanterns`, or any title with Japanese punctuation or script | `slash-title-artist`, 0.9 when the channel is the artist; otherwise a guess, which Japanese punctuation turns this way round |
| Artist / Title | `Paper Lanterns / Blue Signal` on the channel Paper Lanterns | `slash-artist-title`, 0.9 |
| A - B on a lyrics or cover upload | `Blue Signal - Paper Lanterns (Lyrics)` on a stranger's channel | `dash-guess`, 0.5: "Title - Artist" is as common there as "Artist - Title", so not trusted |
| Work - Composer | `Clair de Lune - Debussy`; `Vivaldi: The Four Seasons - Spring`; `J.S. Bach - Air` | `classical-colon` and Composer - Work (`dash`) 0.85, vouched by a short table of composers' surnames; a surname may follow only given names, initials and particles, so `Chuck Berry - Roll Over Beethoven` is not a composer's title. `dash-composer` (the surname on the right) stays a guess: `Film Composer - Bach` names a piece |
| Performer - Composer: Work | `Ilse Marwen - Bach: Partita No. 2, BWV 1004` | `classical-performer` 0.9 on the performer's own channel (the composer goes to `tags`); elsewhere `classical-colon` with the composer as the artist and `performer` set |
| Artist - Title on a session channel | `Paper Lanterns - Blue Signal (Live at Red Hollow)` on `Red Hollow Sessions` | `dash-session`, 0.75 |
| Artist - Title, a label's official upload | `Paper Lanterns - Blue Signal (Official Video)` on `Sunken Meadow Records` | `dash-label`, 0.7 |
| A - B, the library decides | `Blue Signal - Paper Lanterns (Lyrics)` when another track names Paper Lanterns with confidence | `known-artist`, 0.85 when the library names that side for sure (see `knownArtists` below); a side only guessed elsewhere leans the guess, 0.5 |
| A / B, nothing to decide | `Blue Signal / Paper Lanterns` on a stranger's channel | `slash-guess`, 0.4: reported, not trusted |
| Corner brackets | `Paper Lanterns「Blue Signal」`, `「Blue Signal」/ Paper Lanterns`, also white corner and double angle brackets | `quote-artist-first`, `quote-title-first`, 0.95 when the channel is the artist, otherwise a guess |
| Lenticular tags | `【MV】Paper Lanterns - Blue Signal` | the tag is dropped (junk), noted (a version) or kept in `tags` |
| Topic channel | `Blue Signal` on `Paper Lanterns - Topic` | `topic`, 0.95; the title is never split |
| VEVO, Official | `Blue Signal` on `PaperLanternsVEVO` / `Paper Lanterns Official` | `vevo-channel` 0.75, `official-channel` 0.7 (a label's "Official" channel is a label, not an artist) |
| Junk | `(Official Video)`, `[HD]`, `Lyrics`, `4K`, `(2019)` | dropped; a year goes to `year` |
| Versions | `(Live at ...)`, `(X Remix)`, `(Acoustic)`, `-Piano ver.-`, `(Remastered 2011)` | kept in `version` |
| Credits | `feat.`, `ft.`, `featuring`, in brackets or not | `feat: ['Mira Osei']` |
| Soundtracks | `Starfall Odyssey OST - 03 - Ember Fields`, `Ember Fields (Starfall Odyssey Original Soundtrack)`, `Starfall Odyssey - Ember Fields (Soundtrack)` | `ost`: `album`, `trackNo`, no artist |
| Classical | `Vessant: Nocturne in E-flat major, Op. 9 No. 2 - Ilse Marwen` | `classical-colon`: artist is the composer, `performer` set |
| Quotation marks | `Paper Lanterns "Blue Signal" (Official Video)` | `quote-ascii`, 0.9 when the channel is the artist, otherwise a guess |
| Nothing | `Blue Signal` on an unrelated channel | `none`, artist `''` |

`known` is optional: `function(name) -> { sure, seen, left, right }`, how many tracks of the library name that artist with confidence and how many only guess it from a plain dash. With it an unconfirmed "A - B" takes the side the library knows for sure: on a lyrics or cover upload whichever side is sure; on a plain one, A when A is sure and B is named nowhere, B when B is sure and A is named nowhere else (a song can be called after another band; "Name - Other Artist", where Name has a Topic channel and Other Artist is in the library nowhere, is the one shape this still misreads). When neither side is sure anywhere, a side guessed elsewhere, or a name that heads (or ends) at least three such lyrics or cover uploads three times as often as the other side appears in them, only leans the guess that way (0.5) (`known` also gives `left` and `right`, those counts). Also not taken as artists: a side naming a collection or a stream ("Piano Collection", "lofi", "24/7"); a bracket after the channel's own name ("C418 (Volume Alpha)" gives C418 and the tag). A short capitals channel name such as "PTXofficial" counts as the side it abbreviates.

A rule the user teaches for a channel overrides the guess (`rule: 'channel-rule'`, confidence 1). `channelRule` is one of `TS.parse.CHANNEL_RULES`: `'artist-title'`, `'title-artist'`, `'channel'` (the channel is the artist, the title is the whole title), `'none'` (never guess), or `{ artist: 'Name' }` for a channel that uploads one artist under another name. The page does not call `parse()` itself for this: it calls `L.setChannelRule()`. A rule taught from one tap is stored as `{ scope: 'guesses', rule }` and read by `library.js`, not `parse()`: it applies only where the plain reading names no sure artist, and the reading it gives is `rule: 'channel-taught'` (0.9, vouched `'rule'`).

Also exported: `channelInfo(channel)` (`{ kind: 'topic'|'various'|'vevo'|'official'|'label'|'plain'|'none', name, names }`), `classifyGroup(text)` (what one bracket is), `partOf(title)` (`{ base, n, of }` for "Pt. 2", "II. Andante", "Side B", "[2/3]", "#4"; else null), `releaseYear(description)`, `tidy(s)`, `fold(s)`.

The table in `test.js` has 258 title and channel pairs across these shapes, all invented except the section "The channel's name, whole words only", which quotes the reviewer's real titles (27 rows: its 19 failing or probing titles and eight of the fixer's own), followed by eight invented rows for the session and label shapes and their near misses. The Japanese words in the parser's tables are single tag words (official, live, cover, piano and the like), each with its reading and meaning beside it.

## library.js

A library is one plain object that survives JSON:

```js
{ version, tracks: { id: track }, playlists: { id: playlist },
  aliases, channelRules, genres: { artist, channel, mb }, settings: { minConfidence: 0.6 } }
```

A track:

```js
{ id, title, artist, artistKey, version, versionText, feat, album, trackNo, performer,
  channel, channelId, durationSec, publishedAt, year, yearSource, decade,
  addedAt: { playlistId: ISO date }, playlists: [playlistId],
  genres, genreSource, topics, hints, embeddable, removed, removedReason, playerError,
  rating, plays, skips, lastPlayed, blocked, tags, userEdits,
  raw: { title, channel }, guess: { artist, title, rule, confidence }, artistGuess, spreadKey,
  run: { key, n } | null, live, releaseYear, categoryId, fetchedAt }
```

`title`, `artist`, `artistKey`, `version`, `year`, `decade`, `genres` and `run` are derived by `derive()` from `raw`, the channel's rule, the aliases, the genre overrides and `userEdits` (which always wins). `artistKey` is `''` for an unknown artist. `artistGuess` is the channel's name (`channelName(track)`) when the artist is unknown and the user has neither corrected it nor taught the channel: what the page shows in the artist's place, marked as a guess. It counts for no artist: `artistKey` stays `''`, so artist counts, MusicBrainz and `knownArtists` see an unknown artist. `spreadKey` is the separate "artistKey or channel" field: the sure artist's key, else `'~'` and the channel's key (else the track's id). The shuffle's spread and artist rotation (`S.artistKey`) and the by-artist view use it, and `facets()` lists a guess under it as its own row, named "channel (guess)" with `guess: true`, never among the sure artists. A mixed uploader's guesses therefore count as one "artist" for the spread, labelled as the channel's guess; the honest alternative (each guess its own artist) would let two songs of one real artist play back to back. `yearSource` is `'edit'`, `'release'` (an auto-generated description stated the release date), `'title'` (a year in brackets) or `'upload'`: with `'upload'` the decade is only when the video was uploaded, and the page should say so. `rating` is 0 (unrated) to 5. A playlist record is `{ id, title, privacy, special, count, listed, unavailable, importedAt, refreshedAt }`.

| Call | What it does |
| --- | --- |
| `create()` | An empty library. `VERSION` is the layout's number. |
| `load(data)` | A stored library with every field in place. |
| `toParts(lib)` / `fromParts(parts)` / `meta(lib)` | `{ tracks, playlists, meta }`: what the store keeps, and back. `meta` is everything except the tracks and playlists. |
| `list(lib)`, `get(lib, id)` | All tracks; one track or null. |
| `playable(track)` | Not removed, embeddable, no player error. |
| `upsert(lib, videos, { playlistId, addedAt, now })` | Add or refresh from `yt.js` records. Never touches rating, counts, tags, corrections. `-> { added, updated }` |
| `markMissing(lib, ids, now)` | YouTube no longer returns these: `removed = true`. `-> ids` |
| `markUnplayable(lib, id, code, now)` | The player's verdict: 100 sets `removed`, 101 and 150 clear `embeddable`. `-> track` |
| `clearPlayerErrors(lib, ids)` | "Try the unplayable ones again." `-> ids` |
| `setPlaylist(lib, record)` | Add or update a playlist record. |
| `reconcilePlaylist(lib, playlistId, keepIds)` | Tracks not in `keepIds` leave the playlist. `-> { changed, orphans }` |
| `removePlaylist(lib, playlistId, { dropOrphans })` | Takes a playlist out; deletes only untouched tracks that are in no other playlist, and only when asked. `-> { changed, deleted }` (delete those ids from the store too) |
| `stale(lib, now, days)` | Ids whose YouTube data is older than `days` (30). |
| `edit(lib, id, fields, known)` | Corrections: `title`, `artist`, `version`, `year`, `genres` (null takes one back); and `rating`, `blocked`, `tags`, which derive nothing and parse nothing. `known` (optional) is a `knownArtists(lib)` the caller already has. `-> track` |
| `editMany(lib, ids, fields, known)` | The same correction on many tracks in time linear in their number: `knownArtists` is read once. The page reads `known` itself in slices (`knownCollector`), calls `editMany` on slices of 100 for at most about 12 ms before giving the page a turn, then re-reads the toss-ups the same way; the store writes 400 tracks per transaction with a turn in between. `-> ids` |
| `deriveIds(lib, ids, known)` / `ambiguousIds(lib)` | Derive just these tracks with one reading of the library `-> ids changed`; the ids whose artist was a toss-up. |
| `declareAlias(lib, alias, canonical)` / `declareAliases(lib, aliases, canonical)` / `removeAlias(lib, alias)` | "Paper Lanterns Band" is "Paper Lanterns". Several spellings at once derive each affected track once (the tracks carrying a merged key, and the toss-ups). `planAliases(lib, aliases, canonical)` records them and returns the affected ids without deriving, for the page to derive in slices. `-> ids` |
| `setChannelRule(lib, channelKey, rule)` | "On this channel the format is Title / Artist." null forgets. `-> ids` |
| `learnRule(lib, id, artist)` | What one correction teaches about its channel: the rule (`'artist-title'`, `'title-artist'`, `'channel'`, else `{ artist }`) that reads this track with that artist. The fixer offers it as "Read the whole channel the way I corrected this track" (every track there, as it says). |
| `teachPlan(lib, id, artist)` / `teachChannel(lib, plan)` / `teachable(lib, track)` | The one-tap offer after a guess is answered. `teachPlan` returns `{ key, rule, ids, conflicts }`: the learnt rule, the channel's other tracks it would read (`teachable`: no sure reading and no correction of the artist; tracks it taught earlier count), and how many sure tracks there the rule would read with another artist (the page then warns that the channel mixes orders). The page shows `ids.length` before ("Yes, those 3 tracks"). `teachChannel` stores `{ scope: 'guesses', rule }` for the channel and derives it: `-> { ids: the tracks whose artist or title changed, touched, prev }`; the page reports `ids.length` and offers "Undo this teaching", which is `setChannelRule(lib, key, prev)`. A later import's guesses on that channel are read the same way; a later sure source (a Topic channel, a correction) wins over a taught reading, and taught readings count for no name in `knownArtists`. |
| `setGenres(lib, level, key, genres)` | `level`: `'track'` (id), `'artist'` (artistKey), `'channel'` (channelKey). null takes it back. `-> ids` |
| `setArtistGenresFromMB(lib, artistKey, { genres, mbid, at })` | What MusicBrainz said. `-> ids` |
| `recordPlay(lib, id, { at, completed, listenedSec })` | A play if it ended or half was heard, else a skip. `-> track` |
| `duplicates(lib, { ignoreVersion })` | The same normalised artist and title more than once: `[{ key, artist, title, version, ids }]`. Reports only. |
| `inSeveralPlaylists(lib)` | `[{ id, playlists }]` |
| `facets(lib, tracks, now)` | Counts to choose from; below. |
| `search(lib, query, tracks)` | Every word must occur (title, artist, credits, album, channel, version, genres, tags); accents and case ignored; best first. |
| `stats(lib, now)` | `{ tracks, playlists, playable, removed, notEmbeddable, blocked, artists, unknownArtist, guessedArtist, edited, neverPlayed, played, plays, skips, durationSec, playsHistogram: [{ label, min, max, count }], mostPlayed: [ids], staleCount, oldestFetchedAt }` |
| `channels(lib)` | For teaching formats: `[{ key, name, kind, count, unknown, rule, samples }]`, the channels with most unknown artists first. |
| `genresOf(lib, track)` | `{ genres, source }` with `source` one of `'track' 'artist' 'channel' 'musicbrainz' 'youtube' ''`. |
| helpers | `normArtist(name)`, `normTitle(title)`, `artistOf(lib, name)`, `channelKey(track)`, `parseDuration(iso)`, `lengthClass(sec)`, `decadeOf(year)`, `firstAdded(track)`, `lastAdded(track)`, `genresFromTopics(urls)`, `channelName(track)`, `derive(lib, track, known)`, `deriveAll(lib, test, known)` |
| `knownArtists(lib)` / `knownCollector(lib)` | The `known` function `parse()` takes: `name -> { sure, seen, left, right }` counted over the library. `upsert` and `deriveAll` use it. `knownCollector` gathers the same a part at a time: `add(tracks)` per part, then `result()`. |
| `resolveArtists(lib)` | Re-reads every track whose artist was a toss-up (`dash`, `dash-guess`, `known-artist`, `channel-taught`, `dash-session`, `dash-label`) against what the library now knows; `yt.js` runs it after each import and refresh, `demo.js` after building. `-> ids` |

`facets()` returns

```js
{ total,
  artist:   [{ key, name, count }],     // key '' is "Unknown artist"; most tracks first; name is the commonest spelling
  genre:    [{ key, name, count }],     // key '' is "Unknown genre"
  decade:   [{ key, name, count }],     // '1990s'; in order; key '' is "Unknown year"
  playlist: [{ key, name, count }],
  channel:  [{ key, name, count }],
  length:   [{ key, name, count }],     // LENGTH_CLASSES: short (under 2:30), medium (to 5:00), long (to 10:00), epic, unknown
  tag:      [{ key, name, count }],     // the listener's own tags
  neverPlayed, addedThisMonth, blocked, unplayable }
```

The keys are exactly what `S.select()` takes.

**Genres.** YouTube's `topicCategories` are Wikipedia addresses; `GENRE_TOPICS` is the one table from their last part to a short name: Rock, Pop, Hip hop, Electronic, Indie, Jazz, Classical, Country, R&B, Soul, Reggae, Christian, Asian, Latin. "Music" alone means unknown. Several per track are normal. The parser adds Soundtrack and Classical when the title says so. Who wins: the user's choice for the track, then for the artist, then for the channel, then MusicBrainz for the artist, then the topics.

## shuffle.js

All pure. A mode takes tracks, a random source and options, and returns a list of ids.

```js
var r = S.rng('2026-10-05');   // the same numbers for ever: r(), r.u32(), r.int(n), r.seed
var c = S.cryptoRng();         // the browser's cryptographic source, same interface
S.source(seed)                 // rng(seed), or cryptoRng() when seed is null or ''
S.newSeed()                    // a short random seed, to make "shuffle again" reproducible afterwards
```

| Mode (`MODES[i].key`) | Function | The property it keeps (all tested) |
| --- | --- | --- |
| `true` | `trueShuffle(list, rand)` | Fisher-Yates with unbiased integers: every order equally likely. Chi-square over 120,000 seeded runs of five tracks: 135.5, must lie between 76.9 and 172.5 (df 119, p 0.001 each side); the naive biased shuffle scores 6065 in the same test. |
| | `bagCreate`, `bagNext`, `bagTake`, `bagAdd`, `bagRemove`, `bagSync`, `bagRemaining`, `bagPlayed` | The bag: nothing repeats until everything has played; it is a plain object and survives storage; new tracks go in at uniformly random places among what is left; a new pass never opens with the track that closed the last. |
| `spread` | `spreadShuffle(tracks, rand, { key, after })` | Random; no artist twice in a row whenever such an order exists (no artist has more than half, rounded up); an artist's tracks evenly spaced (squared gap error about 5% of a true shuffle's). When one artist dominates, the unavoidable repeats are the fewest possible. `adjacentRepeats(order, byId)` and `canSeparate(tracks)` measure it. |
| `fresh` | `freshFirst(tracks, rand)` | Never played first (random order), then longest ago to most recent. |
| `newest` | `newestFirst(tracks, rand)` | By the date last added to a playlist, newest first. |
| `favourites` | `favourites(tracks, rand)` | Weighted random order; weight `favouriteWeight(track)`: rating (unrated 1; one to five stars 0.1, 0.4, 1, 2.5, 6) times `1 + log2(1 + plays)`, divided by `1 + skips / (plays + 1)`. |
| `neglected` | `neglected(tracks, rand, now)` | Weighted by `neglectedWeight(track, now)`: more for few plays and a long time since the last; a one- or two-star rating still counts against. |
| `artists` | `artistRotation(tracks, rand)` | One track per artist in turn, round after round. |
| `genres` | `genreBlocks(tracks, rand, { size })`, `genreBlockList(...)` | `size` tracks of one genre, then another genre. `genreBlockList` returns `[{ genre, ids }]`. |

`weightedOrder(tracks, rand, weightFn)` is the engine of the two weighted modes. An unknown artist counts as its channel for "not twice in a row" (`artistKey(track)`).

**Choosing tracks.** `select(tracks, sel, now)`:

```js
{ artists, genres, decades, playlists, channels, lengths, tags,    // lists of facet keys
  not: { artists, genres, decades, playlists, channels, tags },    // leave these out
  neverPlayed, addedThisMonth,          // true to require
  addedWithinDays, minRating,
  text,                                 // words that must all occur
  minSec, maxSec,                       // skip shorter or longer tracks
  notPlayedWithinHours,                 // avoid what played in the last k hours
  includeBlocked, includeUnplayable }   // default false: blocked, removed, non-embeddable are skipped
```

Within one facet the choices are alternatives (Rock or Jazz); different facets must all hold (Rock or Jazz, and the 1990s, and this playlist).

**How the modes compose.** `build(tracks, plan, ctx)` is the whole pipeline:

```js
S.build(L.list(lib), {
	select: { genres: ['Jazz'], decades: ['1970s'], notPlayedWithinHours: 24 },
	mode: 'spread',
	blockSize: 3,                       // for 'genres'
	keepRuns: true,
	limits: { maxTracks: 30, maxMinutes: 90 },
	seed: ToyKit.daily()                // leave out for the cryptographic source
}, { now: Date.now(), after: S.artistKey(currentTrack) })
-> { order: [ids], mode, seed, selected, seconds, stoppedBy: 'tracks' | 'minutes' | null, blocks }
```

1. `select` picks the tracks.
2. With `keepRuns`, each numbered run (parts 1, 2, 3 of one work: "Pt. 2", "II. Andante", "[2/3]"; `track.run`) is folded into one unit (`foldRuns`). The numbered tracks of a soundtrack are separate pieces and are not a run. A run of more than `MAX_RUN` (10) parts, such as forty episodes of a series, is shuffled like separate tracks.
3. The mode orders the units.
4. The runs are unfolded in place, in order (`unfoldRuns`). So under a spread shuffle the only neighbours by one artist are the parts of a run.
5. `limit(order, byId, { maxTracks, maxMinutes })` stops after n tracks or m minutes, whichever comes first; a track that would run over the minutes is not started.

With a seed, the same plan over the same tracks gives the same order whatever order the tracks arrive in. `keepRuns(order, byId)` is the same idea applied after the fact to any order. `signature(sel)` is a short stable name for a selection, for keying a stored bag.

**An endless true shuffle** draws from a stored bag instead of building one order. Besides `bagCreate`, `bagNext`, `bagTake`, `bagAdd`, `bagRemove`, `bagSync`: the bag remembers in `gone` the tracks drawn this round that have left it (blocked, unplayable, out of the selection), and `bagAdd` puts such a track back among the played, so it does not play twice in one round; `bagReturn(bag, ids, rand)` puts drawn but unheard tracks back among what is to come; `bagRunDraw(bag, members)` keeps a numbered run together when keep-runs is on (the run plays where its first part falls, in order; a later part drawn first waits behind the first part). The page uses all three.

```js
var key = 'bag:' + S.signature(sel), chosen = S.select(L.list(lib), sel, Date.now()), rand = S.cryptoRng();
store.get(key, null).then(function (saved) {
	var bag = saved ? S.bagSync(saved, chosen, rand).bag : S.bagCreate(chosen, rand);
	function draw(n) { var t = S.bagTake(bag, n, rand); bag = t.bag; store.set(key, bag); return t.ids; }
	var ctl = TS.player.controller({ player: player, onNeedMore: function () { return draw(5); } /* ... */ });
	ctl.load(draw(8));
});
```

`bagSync` is what makes later imports join the bag at random places. The bag is stored after every draw, so a reload or a new session goes on where it stopped.

**The queue.** `queue(state, action)` is a reducer over `{ items, index, history, done, repeat }` (`queueInit()` is the empty state; `current(state)` and `upcoming(state)` read it). It never changes the state it is given. Actions: `load { ids, index }`, `next`, `previous`, `jump { index }`, `playNext { ids }`, `enqueue { ids }`, `remove { index }` or `{ id }`, `move { from, to }`, `clearUpcoming`, `setRepeat { value }`, `reset`. `history` is what was current and then left, oldest first, at most 500. The page rarely calls it directly: the controller does. Also exported: `hash128(text)`, `lengthClass(sec)`.

## store.js

```js
TS.store.open({ name, memory, fallback }) -> Promise<store>     // IndexedDB database 'true-shuffle' (DB_NAME)
TS.store.memory() -> store                                      // forgets everything; the demo and the tests
```

If the browser refuses IndexedDB, `open()` resolves with an in-memory store whose `fallback` is `true` and whose `reason` says why: tell the reader that nothing will be remembered. `store.kind` is `'indexeddb'` or `'memory'`. Every method returns a Promise; records are copied in and out.

| Call | |
| --- | --- |
| `getTracks()`, `putTracks(tracks)`, `deleteTracks(ids)` | One record per track. |
| `getPlaylists()`, `putPlaylists(list)`, `deletePlaylists(ids)` | |
| `get(key, fallback)`, `set(key, value)`, `remove(key)`, `keys(prefix)`, `entries(prefix)` | Small named records. `set(key, null)` removes. |
| `addHistory(entry)`, `getHistory({ limit, since })`, `clearHistory()` | One record per listen, newest first: `{ id, at, kind: 'play'|'skip', listenedSec }`. |
| `loadLibrary()`, `saveLibraryMeta(meta)` | The parts `L.fromParts()` takes; `L.meta(lib)` to save. |
| `exportAll(now)` | One object: `{ format: 'true-shuffle-export', version, exportedAt, tracks, playlists, kv, history }`. `ToyKit.download('true-shuffle.json', JSON.stringify(data), 'application/json')`. |
| `importAll(data, { mode })` | `'replace'` (default) or `'merge'`. Rejects with a sentence, changing nothing, if the file is not an export (`checkExport(data)` is the check; `FORMAT`, `FORMAT_VERSION`). Reload the library afterwards. |
| `wipe()` | Deletes everything stored; the store stays usable. |
| `destroy()` | `wipe()` and removes the database; the store cannot be used afterwards. |
| `usage()` | `{ tracks, playlists, kv, history, bytes }` (`bytes` null where the browser does not say). |
| `close()` | |

Keys in use: `library` (the meta), `queue`, `plan`, `quota` (`{ day, units }`), `bag:<signature>`, `import:<playlist id>` (written by `importInto`; left out of exports). Nothing about his music is ever written anywhere else.

## player.js

```js
var p = TS.player.create({ kind: 'youtube', container: box, host: 'https://www.youtube-nocookie.com' });
var p = TS.player.create({ kind: 'mock', container: box, durationOf: fn, errorOf: fn, titleOf: fn, speed: 1, auto: true });

p.on(name, fn) -> off()
p.load(id, { autoplay, startSec }) -> Promise      p.play()  p.pause()  p.stop()  p.seek(sec)
p.time() -> { current, duration }   p.listened() -> seconds really heard   p.state()   p.id()   p.destroy()
```

| Event | Data | |
| --- | --- | --- |
| `ready` | `{}` | The player can take commands. |
| `playing`, `paused`, `ended` | `{ id }` | |
| `error` | `{ id, code, message }` | `code`: 2, 5, 100, 101, 150 from YouTube; `'too-small'`, `'api'` from this file. `UNPLAYABLE` maps 100, 101 and 150; `ERROR_TEXT[code]` is a sentence. |
| `time` | `{ id, current, duration }` | About twice a second while playing. |
| `state` | `{ id, state }` | `'idle' 'loading' 'playing' 'paused' 'ended' 'error'` |

The YouTube player fetches nothing until the first `load()`: then `IFRAME_API` (`https://www.youtube.com/iframe_api`) is added to the page (`loadIframeApi()`), and the player is built inside `container`, which must be visible and at least `MIN_SIZE` (200) px each way. Give the box its size in CSS; the iframe fills it. Call the first `load()` from a click so that the browser allows sound. The mock draws a plain card (`.ts-mock`, `.ts-mock-title`, `.ts-mock-bar`, `.ts-mock-time`) and has two extra methods, `tick(ms)` and `finish()`; with `auto: false` its clock moves only by those.

**The controller** joins a player to the queue:

```js
var ctl = TS.player.controller({
	player, state,                     // state: a stored queue to go on from (nothing plays until resume())
	onChange(state, why),              // why: 'load' 'next' 'ended' 'skip' 'jump' 'remove' ...
	onListened(id, { completed, listenedSec, durationSec, at }),   // give it to L.recordPlay
	onUnplayable(id, code),            // 100, 101, 150: mark it (L.markUnplayable); it is skipped
	onError(id, code, message),        // anything else
	onNeedMore(state) -> ids,          // two tracks or fewer left: return more (the bag)
	onHalt(reason),                    // 'finished', 'errors' (five failures in a row), 'player'
	maxErrors, now
});
ctl.load(ids, index)  ctl.next()  ctl.previous()  ctl.jump(index)  ctl.playNext(ids)  ctl.enqueue(ids)
ctl.remove(indexOrId)  ctl.move(from, to)  ctl.clearUpcoming()  ctl.setRepeat(bool)
ctl.pause()  ctl.resume()  ctl.toggle()  ctl.state()  ctl.current()  ctl.destroy()
```

On `ended` the next track starts. On 100, 101 or 150 the track is reported and skipped; it is neither a play nor a skip. Five failures in a row stop playback instead of running through the queue (offline, say).

## yt.js

**Where to talk to.** `Y.endpoints()` returns `{ auth, revoke, api, mb, gis, test }`: Google's (`Y.GOOGLE`), or the local fake under the `?api=` rule above (`isLoopback(hostname)`). Pass it to everything.

**Sign-in.**

```js
var auth = Y.createAuth({ clientId, scope, redirectUri, mode: 'redirect' | 'gis', endpoints });
auth.configured()        // is there a client id
auth.setClientId(id)     // a visitor's own (keep it with ToyKit.store('clientId', id))
auth.handleRedirect()    // -> { status: 'none' | 'signed-in' | 'error', error }
auth.signIn({ prompt })  // from a click
auth.token()             // the access token or null       auth.signedIn()   auth.secondsLeft()
auth.onChange(fn)        // fn(signedIn); returns off()
auth.signOut()           // -> Promise<{ revoked: true | false | 'sent' }>
auth.forget()            // drop the token without telling Google
auth.signInUrl()  auth.redirectUri()  auth.clientId()  auth.mode  auth.test
```

The redirect flow: `signIn()` stores a random 128-bit state and the page's query in sessionStorage and sends the browser to `accounts.google.com/o/oauth2/v2/auth` with `response_type=token`, the scope `Y.SCOPE` (`https://www.googleapis.com/auth/youtube.readonly`) and this page's own address as redirect URI (`redirectUriFor(location)`: the address without `index.html`, query or fragment). Google returns to that address with `#access_token=...&state=...`. `handleRedirect()` accepts the answer only if the state is the one stored and less than ten minutes old, removes the fragment from the address with `history.replaceState`, puts the query back, and keeps the token in memory and in sessionStorage (`Y.KEYS`). A token within a minute of its end counts as gone: there is no refresh, the reader signs in again (one click; nothing else is lost, the import resumes). `signOut()` posts the token to `oauth2.googleapis.com/revoke` and forgets it whatever the answer. The pure parts are exported for tests: `buildAuthUrl`, `parseAuthResponse`, `checkAuthResponse`, `randomState`.

What was found about this flow on 2026-10-05:

- Google's page for it (developers.google.com/identity/protocols/oauth2/javascript-implicit-flow) still documents the endpoint and parameters, and now calls the flow discouraged, "for legacy support and troubleshooting", recommending the authorization-code flow instead. That flow needs a server to exchange the code, which a static site does not have; Google Identity Services' token model, the other browser-only way, is the same implicit grant in a popup run by Google's script. Nothing found says the redirect is switched off for new clients, and it **could not be tried against Google from here** (no credentials). If Google answers the redirect with an error page ("Error 400: invalid_request" or "unsupported_response_type"), set `signIn: 'gis'` in `config.js`: `auth.signIn()` then loads `https://accounts.google.com/gsi/client` when pressed, opens Google's popup and resolves with the token. **The GIS path is written and has never been run.**
- The revoke endpoint is documented as closed to cross-origin reads, but on that day it answered a cross-origin POST with `Access-Control-Allow-Origin`. `signOut()` tries a normal request and, if the browser will not show the answer, sends it again as a request it may send but not read (`{ revoked: 'sent' }`).

**The Data API.**

```js
var client = Y.createClient({ getToken: auth.token, endpoints, onQuota(units, method), onSignedOut, maxRetries });
client.sources()      -> { me, sources: [{ id, title, count, privacy, special }] }   // Liked videos first; private playlists included
client.me()           -> { channelId, title, likes, uploads } | null
client.playlists()    -> [{ id, title, count, privacy, publishedAt }]
client.playlistPage(playlistId, pageToken) -> { items: [{ videoId, addedAt, position, title, unavailable }], nextPageToken, total }
client.videoBatch(ids)                     -> { videos: [records for L.upsert], missing: [ids] }     // at most 50
client.quota()        -> { units, requests, byMethod, since }      client.get(resource, params)   client.endpoints
```

Every list call costs one quota unit, a failed one included, and each is counted (`onQuota`). `Y.tallyQuota(saved, units, now)` keeps a per-day tally `{ day, units }` for the store, starting again when `Y.pacificDay(now)` changes (Google resets at midnight Pacific). The default allowance is 10,000 units a day per Google project (`TS.config.dailyQuota`). The meter counts only what this page spent. 5xx answers, rate limits and network failures are retried up to four times with a doubling wait from half a second. `toVideo(item)` turns a `videos.list` item into a library record (the description is read for a release date and dropped; YouTube's own tags are not kept).

Errors are `YTError` objects (`isYTError(e)`): `e.code` is one of `'signed-out' 'forbidden' 'quota' 'rate' 'not-found' 'bad-request' 'server' 'network' 'aborted' 'config' 'denied' 'state' 'scope'`; `e.message` is a sentence for the reader; `e.status`, `e.reason` (Google's own word, such as `quotaExceeded`, `accessNotConfigured`, `playlistItemsNotAccessible`) and `e.detail` are for the curious. `.catch(function (e) { show(e.message); })` is the whole failure path.

**Importing.**

```js
Y.importInto({ client, lib, store, playlist, onProgress, signal, freshDays })
  -> Promise<{ playlistId, title, total, unique, fetched, skippedFresh, missing, added, updated, left, quota, resumed }>
onProgress({ phase: 'list' | 'details' | 'done', listed, total, detailed, toDetail, quota })
Y.pendingImport(store, playlistId) -> saved progress | null       // "an import of this playlist was interrupted: continue?"
```

It lists the playlist 50 items a call, then fetches details 50 a call, skipping videos the library already has fresh; writes tracks to the store batch by batch; saves its position after every call. Calling it again for the same playlist goes on from the saved position, after a closed tab, an expired token, a spent quota or a lost network alike. It mutates `lib`, sets the playlist record, marks listed videos that are gone, takes tracks that left the playlist out of it, and saves the library meta. A playlist of 1,230 items costs 49 units. Importing a playlist again is how it is synchronised: only the listing is paid for unless details are older than `freshDays` (30). YouTube returns at most 5,000 Liked videos through the API.

**Refreshing.**

```js
Y.refreshInto({ client, lib, store, ids, all, olderThanDays, onProgress, signal })
  -> Promise<{ checked, updated, removed, restored, quota }>
```

Without `ids` or `all` it takes the stale tracks only. One unit per 50 tracks.

**MusicBrainz (optional, only on a button).**

```js
var mb = Y.createMusicBrainz({ endpoints });
mb.artistGenres(name) -> Promise<{ mbid, name, genres } | null>
mb.genresForArtists(L.facets(lib).artist, { lib, onProgress({ done, total, name, found, hit }), signal }) -> { found, notFound, changed }
mb.requests()
```

In a progress report `found` is the running total of artists found and `hit` says whether this one was.

MusicBrainz's web service answers browsers on other origins (`Access-Control-Allow-Origin: *`, checked 2026-10-05 against `musicbrainz.org/ws/2`). It asks for at most one request a second; this keeps 1.1 s between requests and needs two per artist, so 300 artists take eleven minutes: show progress and a Stop button. An artist is accepted only when the best match has the same name or lists it as an alias. Tested against the fake's copy of the two calls only. A browser cannot set the User-Agent MusicBrainz asks applications to send; it sees the browser's own and the page's origin. If the page shows these genres, credit MusicBrainz in the footer (its genre and tag data is under CC BY-NC-SA 3.0 according to musicbrainz.org/doc/About/Data_License; confirm before publishing). The answers are stored only in the reader's browser.

## demo.js

`TS.demo.build(now) -> { lib, errors: { id: code }, label, playlists }`. 160 invented tracks, 13 invented artists (a fourteenth appears once its channel is taught), 13 genres, the 1960s to the 2020s, four playlists, about a third never played, some rated, two blocked, one not embeddable, two songs present twice, four numbered runs, one channel whose format has to be taught, and three tracks the mock player refuses (`errors`: pass it as `errorOf`). Ids are `demo-001` and up, never the shape of a YouTube id. Show `label` (`LABEL`) wherever the demo is on screen. `videos(now)` and `make(now)` are the raw records; `ARTISTS` the names. Under `?thumb=1` pass a fixed `now`.

## config.js

`TS.config`: `clientId` (empty until the owner pastes his), `signIn` (`'redirect'` or `'gis'`), `scope`, `redirectUri` (empty: the page's own address), `refreshDays` (30), `dailyQuota` (10000). A client id is not a secret. There is no client secret anywhere in this design and none must ever be added.

Other people can use the page with their own Google project: they create a client as below (with this site's origin and redirect URI) and paste its id into a field; keep it with `ToyKit.store('clientId', id)` and pass it to `createAuth` or `auth.setClientId`. The owner's own client only admits the test users he listed.

## Setup in Google Cloud (the owner, once)

1. **Project.** Open https://console.cloud.google.com/ signed in with the Google account whose YouTube playlists are to be read. In the project list at the top choose **New project**, name it (for example "True Shuffle"), create it, and select it.
2. **Enable the API.** **APIs & Services > Library**, search for **YouTube Data API v3**, open it, press **Enable**.
3. **Consent screen.** **APIs & Services > OAuth consent screen** (the console now calls this section "Google Auth Platform"; press **Get started** if it asks).
   - App name: True Shuffle. User support email and developer contact: your own address.
   - Audience (user type): **External**.
   - Publishing status: leave it at **Testing**. Do not publish the app.
   - **Test users > Add users**: your own Google account (the one from step 1).
   - **Data access > Add or remove scopes**: tick `https://www.googleapis.com/auth/youtube.readonly` ("View your YouTube account"), update, save. No other scope.
4. **Client.** **APIs & Services > Credentials > Create credentials > OAuth client ID** (or **Clients > Create client**).
   - Application type: **Web application**.
   - Authorised JavaScript origins: `https://nietztein.github.io`
   - Authorised redirect URIs: `https://nietztein.github.io/misc/101-true-shuffle/` (with the final slash, nothing after it).
   - Create. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). Ignore the client secret: a browser app does not use one. Do not paste it anywhere.
5. **Paste the client id** into `misc/101-true-shuffle/config.js`, as the value of `clientId`, and publish the site.
6. **First sign-in.** Press Sign in on the page, choose your account. Google shows **"Google hasn't verified this app"**. That screen means only that the app is in Testing and Google has not reviewed it; it appears for every app in Testing that asks for a scope like this one, and only the test users listed in step 3 can get past it. Press **Continue** (if it is not offered, **Advanced**, then "Go to True Shuffle"). The next screen lists the one permission, "View your YouTube account": allow it. The page then has read-only access for one hour; it cannot change, add or delete anything on YouTube. Anyone not on the test-user list gets "Access blocked" instead.
7. If Google answers the sign-in with an error page instead of the account chooser, see "What was found about this flow" above: set `signIn: 'gis'` in `config.js` and try again.

To try the real sign-in from this machine before publishing, add `http://127.0.0.1:8080` to the JavaScript origins and `http://127.0.0.1:8080/misc/101-true-shuffle/` to the redirect URIs, and run `node scripts/serve.mjs --port 8080`.

Changes to a client can take a few minutes to take effect. Access can be removed at any time at https://myaccount.google.com/permissions.

## Tests

```
node misc/101-true-shuffle/test.js                  over 700 checks, a few seconds
node misc/101-true-shuffle/test.js parse shuffle    only those sections
node misc/101-true-shuffle/test/fake-youtube.mjs --port 8791     the fake, to click against
```

Sections: `parse` (the table, statelessness, 484 odd inputs), `library`, `shuffle` (uniformity by chi-square, the bag across serialise and restore, the spread over 600 random libraries, seeds, limits, 4,000 random queue actions on frozen states), `store` (the in-memory twin), `player` (the mock and the controller), `demo`, `yt` (the sign-in round trip through the fake's real HTTP redirect, typed errors, retries, quota, the 1,230-item import, four kinds of interruption and resume, refresh, MusicBrainz), `readme` (every exported name is in this file).

The fake serves the OAuth redirect, revoke, `channels`, `playlists` (59, two pages), `playlistItems` (PL_BIG has 1,230 items: 1,200 videos, 30 listed twice, 29 deleted, 12 private, 32 not embeddable; PL_PRIVATE; PL_SMALL; PL_EMPTY; LL; PL_FORBIDDEN answers 403), `videos`, MusicBrainz's two calls, all with CORS. Switches (`fake.set({...})` or `POST /__control`): `quotaAfter`, `failNext`, `rateLimitNext`, `expireAfter`, `deny`, `noChannel`, `gone`, `shrink`, `latencyMs`.

**Checking in a browser.** These ran on 2026-10-05 against the bench with `scripts/qa/drive.mjs` (the script is outside the repo):

- a plain load requests the page's own server only, loads no Google or YouTube script and builds no iframe;
- `?demo=1`: a whole spread-shuffled pass of 157 tracks plays to the end on the mock, the three refused tracks are marked (100, 101, 150) and skipped, 154 plays are recorded; the true-shuffle bag plays all 154 once and goes on; 360 px wide without sideways scroll;
- IndexedDB: 3,000 tracks written and read back identical, kept across a reload, export then wipe then import gives the same data, a foreign file is refused, "Delete everything stored" empties it;
- with `?api=`: the redirect sign-in in a real browser (the address is clean afterwards, CORS preflights for the Authorization header go through), an import, a reload in the middle of a 1,230-item import and its resume, Disconnect revoking the token, access denied, a forged token in the address refused;
- the real YouTube IFrame player, once, with the sample video of YouTube's own IFrame API documentation: built on youtube-nocookie.com at 478 by 268 px with default controls; `playing`, `paused` and `ended` arrived; an id that does not exist gave error 150; a 150 px box and a hidden box were refused.

## Not done, not tested

- The sign-in against Google itself, and every call against the real YouTube Data API: no credentials here. The shapes follow Google's documentation and the fake was written from the same pages, so a mismatch between the two would not be caught.
- The GIS popup path (`signIn: 'gis'`): never run.
- MusicBrainz against the real service beyond the one CORS probe.
- Liked videos beyond YouTube's 5,000-item cap; live streams (length 0, class "unknown"); region-blocked videos (they surface as player errors).
- The decade of a track without a stated release date is its upload year (`yearSource: 'upload'`).
- Two tabs on one library: last write wins. The page could listen for `storage`-free signals (BroadcastChannel) if this matters.
