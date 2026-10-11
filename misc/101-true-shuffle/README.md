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
| `match.js` | Is it the same song: keys across scripts and spellings, the evidence two songs share, the library's copy of a found song, the best upload of a song. | no |
| `sources.js` | The free sources of new songs (AnimeThemes, AniList, iTunes, Last.fm, YouTube oEmbed and lists, Deezer) and the network and cache layer under them: per-source lines, retries, the breaker, a cache with time limits. Every answer becomes a find. | no |
| `finds.js` | Found songs: light tracks the queue can hold (the registry), keeping one, and the cost ladder that finds a song's YouTube video (the resolver). | no |
| `feeder.js` | What keeps the queue fed: a list of found songs in order, or an endless radio. | no |
| `engine.js` | The discovery engine: the one object the page calls about songs the library does not have. | no |
| `share.js` | A queue as a link anyone can open (`#/share`), and a pasted list of songs (`#/paste`). | the pages only |
| `embed.js` | Embeddings of the tracks, nearest neighbours, the 2D layout of the map, its regions. | no |
| `demo.js` | An invented library of 160 tracks for `?demo=1` and `?thumb=1`, labelled. | no |
| `yt.js` | Google sign-in, the YouTube Data API client, the resumable import, the refresh, MusicBrainz. | sign-in redirect only |
| `test.js` | `node misc/101-true-shuffle/test.js`: over 1,700 checks, PASS and FAIL lines, exit 1 on failure. | no |
| `test/fake-youtube.mjs` | A local fake of the Google endpoints, for tests. | no |
| `toy.json` | The manifest (`"status": "wip"` until the page exists). | |
| `ui.js` | The page's small parts: DOM builder, icons, one button component, router, menus, dialogs, virtual list, cover art, toasts, progress chips, an event bus, the player-safe zone. | yes |
| `actions.js` | The action vocabulary: one label, icon and key for each thing the page lets you do, and the list of keys. | no |
| `transport.js` | What the operating system sees: the Media Session and the media-key anchor. | the anchor only |
| `ds.css` | The design system: tokens, the button, badges, progress chips, the player-safe zone, touch screens. | yes |
| `index.html`, `app.js`, `app.css` | The page. | yes |

Everything is UMD: in the browser each file adds one member to `window.TrueShuffle` (`config`, `parse`, `library`, `shuffle`, `store`, `player`, `demo`, `yt`, and since 2026-10-10 `transport`, `actions`, `match`, `sources`, `finds`, `feeder`, `engine` and `share`); in Node each is a CommonJS module. The sources are plain ASCII (other characters are written as escapes), old-style (`var`, `function`, one IIFE), tabs.

```html
<script src="config.js"></script>
<script src="parse.js"></script>
<script src="library.js"></script>     <!-- needs parse -->
<script src="shuffle.js"></script>
<script src="store.js"></script>
<script src="player.js"></script>      <!-- needs shuffle -->
<script src="transport.js"></script>
<script src="taxonomy.js"></script>
<script src="embed.js"></script>
<script src="discover.js"></script>
<script src="match.js"></script>       <!-- needs parse, library -->
<script src="sources.js"></script>     <!-- needs discover -->
<script src="finds.js"></script>       <!-- needs library -->
<script src="feeder.js"></script>
<script src="engine.js"></script>
<script src="demo.js"></script>        <!-- needs library, shuffle -->
<script src="yt.js"></script>          <!-- needs parse, library -->
<script src="ui.js"></script>
<script src="actions.js"></script>
<script src="lyrics.js"></script>
<script src="quiz.js"></script>
<script src="wrapped.js"></script>
<script src="share.js"></script>
<script src="app.js"></script>
```

Loading these contacts no host. Nothing reaches Google, YouTube, MusicBrainz, AnimeThemes, AniList, iTunes, Last.fm, LRCLIB or Deezer until the reader presses Sign in, Import, Play or the genre button, or opens a page that needs one of them (checked in a browser: a plain load makes requests to the page's own server only).

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

**Songs like this one.** The queue panel has a third tab, Like this, beside Up next and Played: songs like the one that is on, following it as the queue moves (the chosen tab is remembered). The track page shows the same, roomier, under Because you like this, with Play them and Queue them next, and new songs from Deezer close to the artist (with Add). `S.similar(seed, tracks, { history, people, limit, perArtist, perWork, min })` scores the library against the song from its labels (shared genres, the first counting most; the same mood; the era within two years; the scene; the language), the people credited (`people(t)`, here `L.people` without the characters, so a character song and the voice actor's solo single meet: "also sung by"), the same work and artist, and how often the two were played next to each other (`S.coPlays(history, id, { gapMs })`, skips left out, 20 minutes apart at most); other uploads of the same song (`S.songKey`) and sets are left out, and no artist or work fills more than two places. It returns `{ close: [{ t, score, why }], work, together }`: `why` lists the reasons, most telling first, and the page shows two of them in words ("also from Oregairu · also bright"). The work's other songs come OP first.

**Journeys.** From any song (its menu, or the map icon in the now playing panel): pick the song to end on (search, Surprise me: one of the furthest 12%, or click it on the map) and how many songs (10 to 50, remembered); `E.journey` on the map's own vectors (`mapState.recipe`, the labels when the language model is not loaded) finds the way, and it plays in order as `Journey: A to B` (the context carries `journey`). On the map, a selected song has Journey from here: the start is ringed, a dashed line follows the pointer, and a click on another dot sets off. While a journey plays the map draws the whole route, Start to End, the steps already played faded.

**Versions and voice actors.** A song's versions share `S.songKey` (the folded title and the original artist): the track page lists them under Versions, the original first (no version and no other original artist), with Play every version and Another version; the now playing panel says how many there are and its menu puts another take on next and skips to it, the rest of the queue staying; the track menu has Other versions. Voice actors come out of the credits with `L.people` (`A (CV: X), B (CV: Y)`, `A & B (CV: X & Y)` paired in order, full-width brackets too): `#/people` lists everyone credited as a voice, `#/person/<key>` shows the characters they sing as (each song says which) and what they sing under their own name, the player and the track page link the voices, an artist page that is also a voice has As a voice actor, and Your numbers has Most versions and Voice actors.

**Channels and artists.** `#/channel/<id>` (a track's Channel fact, More from this channel in its menu) shows the library's songs from that YouTube channel and its other uploads (`client.playlistPage` on the uploads list, `UU` + the id after `UC`, the newest hundred, about 2 quota units), each with Play and Add. Listing uploads needs a sign-in or an API key; without either the page says so, with Sign in and Add an API key. Either way it shows what needs no YouTube call: when the channel's songs here are mostly one artist's, their other songs and releases from Deezer (the same as an artist page's), and Sounds like this channel, the library's songs closest to the channel's own (`S.similar` from up to six of them, the channel's own left out), each with its reason.

**The map (#/map).** `embed.js` turns the tracks of the scope into vectors by one of `E.RECIPES`: Sound (the labels), Names (character trigrams of titles, artists and works, hashed), Taste timeline (labels and when each song was added), Blend, and Language model (multilingual MiniLM through transformers.js 4.3.1 from jsDelivr and the model from Hugging Face, about 120 MB, only after the reader asks; the vectors are kept, quantised, under `lm:vectors`). The page finds 15 neighbours each and lays the graph out in slices so it animates, then names k-means regions by their commonest genre or work. Colour by genre family, mood, scene or language (the eight validated categorical hues in a fixed order; the rest fold into Other) or by year and plays (one blue ramp). Drag, scroll or pinch, click a dot (play, play its neighbourhood), Shift-drag a box (shuffle, save as playlist); the legend fades categories; the regions are listed under the map as buttons for the keyboard. The queue's next tracks are drawn as a path.

**Discover (#/discover?seed=<track> or ?artist=<key>).** Songs that are not in the library yet. `discover.js` asks Deezer's public API (no key) for the seed artist, its related artists and their top songs. Deezer sends no CORS header, only JSONP, which runs the server's script; so `sandboxTransport()` runs it in a hidden iframe with `sandbox="allow-scripts"` and no same origin: the frame cannot read this page, its storage or the sign-in token, accepts only `https://api.deezer.com/` addresses, and posts plain JSON back, which the page checks (only Deezer's own picture and preview hosts are used) and shows as text. `createDeezer({ transport })` (`searchArtists`, `related`, `top`, cached), `findArtist(dz, names, titles)` (the artist whose top songs include a title the library has; with titles to check and none matching, another artist of the same name is refused), `suggest(dz, { names, titles, known, hidden, perArtist, artists })` (the related artists, the seed and hidden ones left out, those the library lacks first, each with its top songs), `norm`, `youtubeQuery`, `bestVideo(results, track)` (the Topic channel first, covers last), `API`. When Deezer does not know the artist the page tries the three library artists that sound closest. A preview plays 30 seconds in the page (the YouTube player pauses). Play, when signed in, runs one `client.search(query, { max })` (`SEARCH_UNITS`, 100 quota units; every other call costs one) and one `videoBatch`, adds the video to the local playlist `local:discovered` ("Discovered") with the artist and title as labels, and plays it; signed out, it opens a YouTube search in a new tab. **Add** puts the song at the end of one of the account's own YouTube playlists (`client.addToPlaylist`, 50 quota units, plus the search when the video is not known yet): the first time, a dialog explains and the page signs in again asking for `Y.WRITE_SCOPE` as well, keeping the add in sessionStorage (`toy.101-true-shuffle.pendingAdd`) and finishing it when Google sends the reader back. The song joins the library under that playlist; the toast's Undo takes it out again on YouTube (`removeFromPlaylist`). With several playlists a menu asks which (the last one used comes first; one the song is already in is greyed out). Add is on Discover's rows, the artist page's other songs, a channel's uploads, the YouTube search results, the preview bar, and, for a song in the library but not in a playlist (one played from Discover), the track menu and the track page. "Not interested" keeps an artist out (`discover:hidden`). The page also lists songs like the seed from the library that were played at most once, and, signed in, a YouTube search box prefilled from the labels.

**Controls (third pass).** The shuffle order is a labelled pill in the player bar (O), in the queue under "Playing from", next to Shuffle everything on the home page, and every Shuffle button is split: the main part shuffles in the current order, the caret picks another; the order menu describes each order and toggles keeping works apart and one version per song. Under the video: S, M and L sizes, theater mode (T: a wide player, the sections as icons) and full screen (F); the panel's edge still drags. Volume and mute (M, - and =; `p.volume(0..100)` and `p.muted(bool)` on both players, remembered); a heart likes a song (rating 5; L), and #/liked lists what is rated 4 or more (`minRating` in the plan). Ctrl+K opens a palette over pages, actions, playlists, artists, works, genres, moods, scenes, years and songs; ? lists the keys. Blocking, removing from a playlist, clearing the queue and liking can be undone from the toast. Long pages keep a compact header with Play. Song lists can be compact (Settings).

**Playing, queueing and the buttons (2026-10-10).** Play on one song (a menu, the track page, a history row, the palette, the map, a version, a found song) plays it now and keeps the queue: `playNow(ids)` puts it right after the song that was on, which joins Played, and what was coming follows (`ctl.playNow`, the reducer's `playNow`); a song that was queued already moves up instead of playing twice. Play in a list plays the list from there (`playFrom(ids, index, ctx)`, once called `playIds`, a name the test hook keeps). Songs queued by hand (Play next, Add to queue, dragged onto the queue) play before the rest of what is coming, in the order given (`insert`), and survive a new list: they are kept under the store key `queue:hand`. On a wide window Q and the Queue button fold the queue to one line under the player (`body.queue-hidden`, remembered as `queueHidden`); the panel itself stays, since the player must. The bar's title opens the song's page (on a phone, the sheet). The bar's More (`#btn-bar-more`) holds the sleep timer (a dot on it while one runs), theater mode, full screen, Edit details, Repeat and Shuffle again; from 761 to 1100 px wide, Repeat and Shuffle again are only there, so the bar never overflows. The heart likes a song (four stars or more is liked); liking a song rated under four remembers that rating (`rating:beforeLike`), and taking the like back restores it, else leaves three stars. Every button is one component (ui.js `btn`, styled in ds.css): pills, round icon buttons, one blue for every play, at most three actions and More in a page's header, a cost shown as a badge. Labels, icons and keys come from actions.js; the track menu is grouped (Play, Find more, Keep, Go to, Fix) and Rating opens its own small menu. A new page puts the focus on its title; a redraw keeps the focus on the same row; the phone's sheet is a dialog (the rest of the page inert, never the video). Work in progress shows as a chip above the bar (ui.js `job`), not only to screen readers.

**Media keys and car buttons.** A browser sends the keyboard's media keys, a phone's lock-screen buttons and a car's steering-wheel buttons (Bluetooth AVRCP) only to a frame that plays something itself (Chromium's `MediaSessionImpl::ComputeFrameForRouting`, read on 2026-10-10). The only player was YouTube's cross-origin iframe, so next and previous never reached the page. transport.js adds an anchor: a looping, unmuted `<audio>` of digital silence, built in memory, that plays while YouTube's player plays and pauses with it; the page then owns the Media Session (title, artist, the work or the playlist as album, artwork, position) and its play, pause, next, previous and seek handlers. On a phone it pauses the moment the page is hidden and ignores everything but pause while hidden. Settings > Playback switches it (`mediaKeys`) and lists the last twenty buttons received, for trying it: the PC's media keys or the Windows media overlay, or a car's steering wheel.

**Found songs play like library songs (2026-10-10, Phase 2).** A song from Discover, an artist's other songs, a channel's uploads, the YouTube search or Saved for later is a find (sources.js). It plays now, plays next or goes to the queue like a library song, and what was coming stays. Its row has Preview (when there is one), Save for later, Play and More (Play next, Add to queue, Add to YouTube playlist, Not interested, Open on YouTube).

- **Finding the video.** engine.js finds the song's YouTube video the cheapest way first (finds.js's resolver), and the Play button shows a cost badge when that will take a YouTube search (100 units). Without a key or a sign-in, such a song opens a YouTube search in a new tab, as before.
- **Light tracks.** A find is not added to the library: it plays as a light track (`transient`) that the bar, the queue and the now-playing panel show like any other.
- **Keeping a find.** It joins the library, in the playlist Discovered, when it is liked or kept, or after it has been finished twice.
- **Saved for later** has Play all.
- **Feeders.** A list of finds, or a radio, plays through a feeder (feeder.js), which looks songs up a few ahead. The queue shows the ones still being found ("Finding...", "Coming up"), and the line under the queue says what the radio does.
- **Endless** (on by default; the bar's More switches it, and it is remembered as `endless`). When the queue runs out, a radio from the last song carries on instead of "That was the last track". Start radio is the same endless radio. Its share of new songs (`newRatio`, 0.5) matters once a radio has sources of new songs; until then it plays your library.
- **The bar's More** also says how much of today's YouTube allowance is used: a song search costs 100 units, and 1,500 are kept for imports and adds.

**Playback extras (2026-10-10).**
- **Trim and volume.** A song's menu (and the bar's More, for the song that is on) has Trim and volume: start later, end sooner, louder or softer, for that song only. It is kept under the store key `songprefs` as `{ id: { start, end, vol } }`. `load` starts at `start`; the time event moves on at `end`; `vol` (50 to 150%) scales the base volume.
- **Fades** (Settings > Playback, on by default, `fades`). The last three seconds of a song soften and the first one and a half come in gently. This is done with the player's volume, so the volume slider keeps showing the base volume.
- **Speed.** The bar's More sets the playback speed (0.75 to 1.5x; the player's `rate`). A badge by the time says when the speed is not normal; it lasts for the session.
- **Ambient glow** (Settings > Appearance, `ambient`). The song's thumbnail, blurred, glows behind the video, never over it; not on phones.
- **History as CSV.** Settings > Backup saves the listening history as a CSV file.

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

The owner's labels ship with the page as `labels.json` (the public Music playlist, researched by hand: tie-ins checked against VGMdb, ErogameScape, VNDB, Japanese Wikipedia and the uploads themselves; no history, ratings or notes). On start, and after every import or refresh, `applySiteLabels()` fetches it and applies it only when at least half of this library (and 50 songs) is in it, so anyone else's library is left alone. It applies the whole file once per version (`createdAt`, remembered under `labels:applied`, which a dropped labels file also sets), and after that only to songs that are in the file but have no labels yet. The demo never loads it. Corrections made in the app still win over it.

## embed.js

`TS.embed`: `RECIPES`, `vectors(tracks, recipe, { taxonomy, firstAdded, lm })` (unit-length `Float32Array` rows; `labelVectors`, `nameVectors`, `timeVectors` are the parts), `describe(track, taxonomy)` (the sentence the language model reads), `knn(vecs, k)` and `knnJob(vecs, k)` (the same in slices: `step(budgetMs)` until `done`), `layout(vecs, nn, { rand, epochs })` (a UMAP-like layout from the first two principal components, `pca2`; `step(budgetMs)`, `pos`), `regions(pos, tracks, k, rand)` (k-means on the layout, each `{ x, y, name, mood, size, members }`), `dot`, `unit`. Pure; the seeded random source makes the same map every time. `journey(vecs, from, to, { steps, pull, keyOf, workOf, sameOf, maxPerKey, gap, skip })`: the songs between two, each the unused one closest to a point sliding from the start's vector to the end's and leaning on the one before (`pull`), no key (an artist) again within `gap` (3) steps or more than `maxPerKey` (2) times, no work more than twice, one song per `sameOf`; the start first and the end last.

## match.js

`TS.match`: is this the same song? A song reaches the page from the library (a YouTube upload with a parsed or labelled title), from the free music services (clean titles, often in another script) and from YouTube's searches and lists (raw upload titles). This file says when two of them are the same song, when they are the same recording, and which upload of a song to play. Pure; it reads parse.js and library.js.

```js
var M = TS.match;
M.sameSong(track, find)                 // -> { score, why, same, sameRecording }
M.inLibrary(M.index(tracks), find)      // -> { id, score, why, sameRecording } | null
M.bestVideo(videos, find)               // -> { video, score, why, alts } | null
M.query(find)                           // -> 'Glass Orchard ガラスノマチ'
```

**Keys.**

| Name | What it does |
| --- | --- |
| `fold(s)` | discover.js `norm`: no case, accents, spaces or punctuation, "&" is "and", a leading "the" dropped; letters and digits of every script stay. Its NFKD also takes the sound marks off kana (ガ folds to カ), so kana are read as romaji before folding, never after. |
| `kana(s)` | Katakana to hiragana (U+30A1 to U+30F6); the rest as it is. |
| `romaji(s)` | Kana to Hepburn romaji in lower case; every other character kept, kanji too (they are never romanised). Digraphs (kya, sha, cha, ja), loanword sounds (fa, ti, di, tu, du, wi, we, wo, va, she, che, je, tsa, ye, kwa, dyu, fyu), the small tsu doubling the next consonant (tch before chi, dropped at the end), the long mark repeating the vowel (raamen), n before a vowel or y written plain n, を read o, the iteration marks, half-width katakana. The table is one ASCII string of readings in code point order from U+3041. |
| `loose(s)` | `fold`, then the spellings romanisations disagree on made one: long vowels (ou, oo, oh before a consonant or at the end, uu, aa, ii, ee, ei: one vowel), wo is o, Hepburn against Kunrei (shi si, chi ti, tsu tu, fu hu, ji zi, then sh sy, ch ty, j zy), m before b, p or m is n, cch is tch. "Toukyou", "Tōkyō", "Tohkyoh" and "Tokyo" are all `tokyo`; "Shinjuku" and "Sinzyuku" are `sinzyuku`. |
| `baseTitle(s)` | The song's title without decoration. Brackets and dash tails that name a version, a medium, a credit or a place in a show go: TV size, TV ver., TV edit, short and full versions, off vocal, instrumental, karaoke, MV, PV, official video or audio, lyric video, lyrics, audio, HD, 4K, remastered, covered by, feat. and ft. (also without brackets), every recording word parse.js knows (live, piano, remix ...), "from" a film, and OP, ED, NCOP, Opening, Ending and their Japanese words. Lenticular tags go, a ~subtitle~ (tilde or wave dash) goes, and corner brackets or quotation marks around the whole title come off. A bracket that only names an anime stays: "Blue Signal (Starfall Odyssey)". So does a dash tail with a / or | of its own ("Blue Signal / THE FIRST TAKE" holds more than decoration). "Op. 9" is not OP. When nothing would be left, the title as it was. |
| `titleKeys(title, alt, raw)` | The keys a title is known by, each once: `fold(baseTitle(title))`, `fold(title)`, `fold(baseTitle(alt))`, the loose key of each base (kana read as romaji first), both halves of a "窓 (Mado)" title, and, given `raw` (an upload's title, or a track's `{ title, channel }`), the title parse.js reads there, unless the upload's title holds the cleaner title already. For an upload's own keys, pass its title both ways: `titleKeys(video.title, '', { title: video.title, channel: video.channel })` adds "Ai" for "Neon Abacus - Ai (Official Video)". Keys under two characters are dropped, except one kanji. |
| `artistKeys(credit, native, aliasOf)` | The keys an artist credit is known by: the whole credit first, each person in it (library.js `people`: "A & B", "A feat. B", the character and the voice actor of "Character (CV: Name)"), the native name, each folded and loose (kana read as romaji), and what `aliasOf(name)` (optional) calls each of them. |
| `signature(x, { aliasOf })` | What a track or a found song is matched by: `{ t: titleKeys, a: artistKeys, v: videoId or null, d: durationSec or 0, ver, w: fold(work), r: role }`, plus `tf` and `tl` (the fold and the loose title keys) and `aw` (the whole-credit artist keys). `v` is `x.videoId`, else `x.id` when that is a YouTube id. `ver` is `x.version`, else the versions the title's tails name ("(TV Size)" gives `'tv-size'`). A track's `artistKey` and a find's `people` count as artist keys. |

**The same song.** `sameSong(a, b)` takes tracks, finds or signatures and adds the evidence up; `same` is a score of `SAME` (5) or more.

| Evidence | Points | `why` |
| --- | --- | --- |
| A fold title key in common | +4 | `title` |
| Else a loose title key in common | +3 | `title-loose` |
| Else one key inside the other, both of 6 characters or more | +1.5 | `title-part` |
| Else nothing in common: the score is 0 and nothing else counts | 0 | `no-title` |
| The same credit (a whole-credit key in common) | +3 | `artist` |
| Else a person in common, a voice actor too | +2.5 | `person` |
| Else, both artists known | -3 | `other-artist` |
| The same work; the same role | +1.5; +0.5 | `work`, `role` |
| Versions that differ (cover, live, remix, instrumental, karaoke, piano ...) | -2 | `other-version` |
| Lengths within 4 s; over 40 s apart unless one is a TV size, short, edit or extended cut | +1; -1.5 | `length`, `length-off` |
| The same video | 99 | `video` |

`sameRecording` is `same`, the same versions and the lengths unknown or within 4 s. A cut (TV size, short, edit, extended) costs nothing but is never the same recording; a remaster is the same recording. An equal title by another known artist scores 1, so two different songs called "Hikari" stay apart; a character song and the voice actor's own upload meet (4 + 2.5). `STRONG` (7) is sure enough to act on without asking.

**The library.** `index(tracks, { aliasOf })` takes a list or `{ id: track }` and returns `{ title: { key: [ids] }, video: { videoId: true }, sig: { id: signature }, tracks: { id: track }, artist: { key: [ids] } }` (and `aliasOf`). Building it for 1,855 tracks takes about 100 ms the first time and 35 ms after: the string steps remember their answers (20,000 at most), which are only read. `inLibrary(index, find)` is the library's copy of a found song: the track whose video the find names (score 99), else the best track whose `sameSong` reaches `SAME`, the same recording first, then one that plays (`L.playable`, and not blocked), then the higher score. It returns `{ id, score, why, sameRecording }` or null; a caller that must play exactly the find's recording checks `sameRecording`.

**Uploads.** `scoreVideo(video, find)` scores one upload (`{ videoId, title, channel, channelId, durationSec }`) for a find; `bestVideo(videos, find, { min })` returns the highest score (the first of equal ones) as `{ video, score, why, alts }`, `alts` being the next three that also reach `min`, or null when the best is under `min` (`MIN_VIDEO`, 5). This replaces discover.js `bestVideo`, which always returned something.

| Evidence | Points | `why` |
| --- | --- | --- |
| The artist's Topic channel | +6 | `topic` |
| Else a channel named as the artist | +3 | `channel` |
| An Official or VEVO channel | +1 | `official` |
| A title key of the find in the upload's title (a Latin key under four letters, or any under three, as whole words) | +4 | `title` |
| Without that, the score is at most 0 | | `no-title` |
| The artist in the upload's title | +1.5 | `artist-in-title` |
| Each version the find asks for (its `version`, or its title's tails) that the upload's title shows, 4 at most | +2 | `version` |
| The find asks for a version the upload's title does not show; the three channel points are not given then | -3 | `not-version` |
| Each of cover, sung by, utattemita, karaoke, nightcore, sped up, slowed, 8D, hours, loop, reaction, instrumental, off vocal, live (also THE FIRST TAKE), TV size, short, that the find does not ask for; 6 at most | -3 | `cover`, `karaoke`, `nightcore`, `sped-up`, `slowed`, `8d`, `hour`, `loop`, `reaction`, `instrumental`, `live`, `tv-size` |
| Lyrics | -1 | `lyrics` |
| The length within 5 s; over 30 s off | +2; -2 | `length`, `length-off` |

The song's own words (its base title and its artist) are taken out of the upload's title before the version words are read, so "Live Wire Heart" is not a live version. A cover word costs nothing when the find asks for an arrangement the upload shows (a piano version is usually somebody's piano cover). So the artist's Topic upload beats the official video, which beats a lyrics video, a cover and a nightcore; a find asking for a piano version takes the piano upload, and finds nothing rather than the original.

**Works and searches.** `workScore(work, { name, synonyms })` (or a name) says how well a work label names an anime, 0 to 1: 1 for an equal fold or loose key with the name or a synonym, 0.8 when one holds the other (both 4 or more), else the share of letter trigrams the loose keys have in common. `query(find)` is what to type into a YouTube search: the artist and the base title, the Japanese title instead when the find has one in `titleAlt` and its title is romaji; at most 100 characters.

**What it cannot do.** Kanji are never romanised: a kanji title meets the same kanji, or the song's `titleAlt`. Katakana loanwords do not meet their English spelling (コネクト is `konekuto`, not Connect): of the 183 labelled anime songs whose title has kana and no kanji and whose `titleAlt` is in Latin letters, 61 meet it without the `titleAlt`, and the rest are loanwords and translations, which only `titleAlt` bridges. The particle は is read ha, so "kimi wa" written in kana meets "kimi ha" only. Fold keys lose kana sound marks (ガラス and カラス fold alike); the loose keys keep them.

The `match` test section (293 checks) has 122 kana rows (both syllabaries, digraphs, the small tsu, long marks, n, loanword sounds), 14 groups of romanisation styles, 55 base titles, the cases of `sameSong` (kana and romaji, Kunrei and Hepburn, the TV size, a cover, the "Hikari" trap, voice actors, no title), the index and `inLibrary`, a ranking of uploads (Topic, official video, lyrics, cover, nightcore), a piano find, works and queries, and purity (frozen inputs, the same answers twice, any library order). It also reads labels.json: every labelled anime song with a `titleAlt` (592) must find itself from that `titleAlt` and its artist, at least 95% of them (all do).

## sources.js

`TS.sources`: where new songs come from, and the network and the cache under every source. Each source answers a browser on another origin (CORS), so the page needs no server. Nothing is asked until a page calls a client, and a client is only made when a page needs it.

```js
var S = TS.sources;
var http = S.createHttp({ hosts: S.endpointsFor(Y.endpoints()) });   // the local fake under ?api=
var cache = S.createCache({ store: store });
S.animeThemes(http, cache).series('some_series').then(function (s) { /* s.anime[i].themes: finds */ });
```

**The network.** `createHttp({ fetch, now, sleep, onLine, hosts })` gives `http`:

| Call | What it does |
| --- | --- |
| `get(host, path, { query, signal })` | One GET; resolves with the answer's JSON. `host` is a key of `HOSTS` or a base address of its own. `query` values that are null or empty are left out. A `path` may be a full address on the source's own base (a "next page" link); any other site is refused. |
| `post(host, path, body, { signal })` | One POST of `body` as JSON (AniList's GraphQL). |
| `stats()` | `{ host: { sent, failed, queued, active, down } }`: tries sent, tries that failed (no answer, 5xx, a rate limit), what waits in line, what is in flight, whether the breaker holds the line closed. |
| `now()` | The clock it was given. |

`HOSTS` (copy it with `endpointsFor`):

| Source | Base | `gap` (ms between starts) | `at` (at once) | `tries` | Notes |
| --- | --- | --- | --- | --- | --- |
| `animethemes` | `https://api.animethemes.moe` | 700 | 1 | 3 | 90 requests a minute |
| `anilist` | `https://graphql.anilist.co` | 1,000 | 1 | 2 | 30 a minute at present |
| `itunes` | `https://itunes.apple.com` | 3,100 | 1 | 2 | `pauseOn: [403, 429]`, `pauseMs: 60000`: Apple's "too many" holds the whole line a minute |
| `lastfm` | `https://ws.audioscrobbler.com/2.0` | 250 | 2 | 2 | `errors`: Last.fm's error numbers in the body (6 not-found, 10 and 26 auth, 29 rate, 8, 11 and 16 server); `rateMs: 30000` after error 29; `authText` |
| `oembed` | `https://www.youtube.com` | 150 | 3 | 1 | |
| `vndb` | `https://api.vndb.org/kana` | 1,500 | 1 | 2 | nothing calls it yet |

Each source has its own line: requests leave in order, `gap` apart, at most `at` at once.
- **429** waits `Retry-After` (seconds or a date), else 1 s, 2 s, 4 s, and tries again; the whole line waits with it. A `Retry-After` over two minutes is not waited for: the request fails with `'rate'`.
- **5xx and no answer at all** wait 1 s, 2 s, 4 s (2^n x 1 s) and try again, up to `tries` in all.
- **404 and 410** are `'not-found'`; **401 and 403** `'auth'`; any other 4xx `'bad'`. None of these is tried again.
- **The breaker:** three failures in a row (no answer or a 5xx; rate limits do not count) close the line for a minute. What waits in it, and every new request, fails at once with `'down'`.
- **Offline:** while `onLine()` is false (by default `navigator.onLine`), a request fails at once with `'offline'`, and so does one whose turn comes then.
- **Shared requests:** identical requests in flight (method, address and body) share one answer. Callers must not change the JSON they get.
- **Abort:** a caller's `signal` takes a request that has not been sent out of the line, and the caller is told `'aborted'`. When the last caller of a request in flight gives up, the request is cut off.
- **What is sent:** `credentials: 'omit'` (no cookies), `referrerPolicy: 'no-referrer'`, an `Accept: application/json` header and nothing else (and `Content-Type` with a POST). The questions carry artist, song and work names only. The Last.fm key goes only to Last.fm, and is never part of a cache key.

Errors are `SourceError` objects (`isSourceError(e)`): `e.code` is one of `'network' 'offline' 'rate' 'server' 'not-found' 'bad' 'auth' 'aborted' 'down'`; `e.message` is a sentence that names the source ("AnimeThemes is not answering; trying again in a minute."); `e.host`, `e.status` and `e.body` (the answer, when there was one) are for the curious.

`endpointsFor(ep)` gives the hosts map: copies of `HOSTS`, or, when `ep` (from `Y.endpoints()`) is the local fake, every base pointed at it: `<fake>/animethemes`, `/anilist`, `/itunes`, `/lastfm`, `/vndb`, and oEmbed at the fake's own `/oembed`.

**The cache.** `createCache({ store, now, memoryMax })` keeps answers in the store's cache (store.js, below) behind an in-memory front of the `memoryMax` (300) most recent entries. Without a store it lives in memory only.

| Call | What it does |
| --- | --- |
| `get(key)` | The value, or `undefined` when there is none. `null` is a stored "no". |
| `getMany(keys)` | `{ key: value }` for the keys that are there, in the order asked. |
| `put(key, value, ttlMs)` | Keep it `ttlMs`. **Anything under `yt:` or `oe:` is kept 30 days at most, whatever was asked** (YouTube's terms). |
| `wrap(key, ttlMs, fn, { negTtlMs, signal })` | The cached value, else `fn()`'s, kept for `ttlMs` (or `ttlMs(value)` when it is a function). A `SourceError` `'not-found'` from `fn`, or a `null` result, is kept as a "no" for `negTtlMs` (default: `ttlMs`, at most 7 days) and resolves `null`. Calls for one key at the same time share one `fn()`; a caller whose signal fires is told `'aborted'`, and one still waiting on the shared work starts it again. |
| `range(prefix)` | `[{ key, value, exp, at }]` for the unexpired keys under `prefix`. |
| `sweep({ maxRows, maxBytes })` | Expired entries go, then the store keeps to its limits (store.js `cacheSweep`). Run it when the page starts. |
| `clear(prefix)`, `remove(keys)` | Forget a prefix (everything without one), or exact keys. |
| `stats()` | `{ hits, misses, rows }` (rows: the in-memory front). |
| `now()` | The clock it was given. |

`TTL` (milliseconds), with the keys each client uses:

| Kind | Time | Key |
| --- | --- | --- |
| `oembed`, `oembedNo` | 30 days, 7 days | `oe:<videoId>` |
| `ytRes`, `ytResNo` | 30 days, 7 days | `yt:res:<find key>` (finds.js); `yt:v:<videoId>` (ytLists `videos`); `yt:q:<kind>:<words>` (searches) |
| `listRD`, `listUU`, `listPL` | 2 days, 6 hours, 7 days | `yt:list:<list id>` |
| `atSearch`, `atAnimeAiring`, `atAnime`, `atSeries`, `atArtist`, `atSeason`, `atTrack` | 7, 14, 180, 30, 30, 1 and 90 days | `at:q:...`, `at:anime:<slug>` (14 days while it airs: this season or the last), `at:series:<slug>`, `at:artist:<slug>`, `at:season:<year>:<season>`; `atTrack` is for "which anime is this song from" |
| `alSeason` | 1 day | `al:season:<year>:<season>:<perPage>` |
| `itSearch`, `itArtist`, `itAlbums`, `itAlbum` | 30, 7, 3 and 90 days | `it:q:...`, `it:artist:<id>:songs:...`, `it:artist:<id>:albums:...`, `it:album:<id>:...` |
| `lfm` | 14 days | `lfm:sim:...`, `lfm:art:...`, `lfm:top:...` |
| `dz` | 7 days | `dz:<Deezer path>` |

**The find.** `find(fields)` returns a find with every field of the shape filled: strings are strings, numbers numbers, a `cover` that fails `okImage` or a `preview` that fails `okPreview` becomes `''`, empty `ids` are dropped, and `key` is made when missing. Fields outside the shape are kept.

```js
{ key, videoId: null, title: '', titleAlt: '', artist: '', artistNative: '', people: [], album: '', albumId: '',
  work: '', workKey: '', series: '', seriesKey: '', role: '', seq: 0, season: null, year: 0, durationSec: 0, version: '',
  cover: '', preview: '', channel: '', channelId: '', source: '', ids: {}, why: [], score: 0, at: 0 }
```

- **Keys:** `at:song:<id>` (AnimeThemes), `it:track:<id>` (iTunes), `dz:track:<id>` (Deezer), `lfm:<artist>|<title>` (Last.fm, both folded as discover.js `norm` folds), `v:<videoId>` (when only a video is known). A find with no id at all gets the name form.
- `artist` is a credit library.js `people()` reads: `'A & B'`, or `'Character (CV: Singer)'` for a singer credited as a part. `people` lists the singers' own names.
- `season` is `{ year, season }` with `season` one of `'winter' 'spring' 'summer' 'fall'`; `seasonAt(ms)` gives the season a moment falls in (UTC).
- `seq` is a theme's sequence (OP2 is 2), or a track's number on its album.
- `role` is `'OP'`, `'ED'` or `'insert'`.
- `okImage(url)`: only `https://is<n>-ssl.mzstatic.com/` (Apple), `https://s4.anilist.co/`, `https://i.ytimg.com/`, `https://e-cdns-images.dzcdn.net/` and `https://cdn-images.dzcdn.net/`. `okPreview(url)`: only `https://audio-ssl.itunes.apple.com/`, `https://cdnt-preview.dzcdn.net/` and `https://cdns-preview-<x>.dzcdn.net/`. Both are true or false.

**The clients.** Each takes the http and the cache, keeps its answers for the times above, and gives finds or plain objects, never a source's own JSON. Every call takes an options object with `signal`.

| Client | Calls |
| --- | --- |
| `oEmbed(http, cache)` | `video(id)` -> `{ id, title, channel, channelId (when the author is /channel/UC...), handle (when it is /@...), ok: true }` or `{ id, ok: false, reason: 'not-embeddable' \| 'not-found' }` (401 means the owner does not allow embedding, or the video is private). `videos(ids)`: four at a time, answers in the order asked; rejects with the first error that is not an answer. No quota. |
| `animeThemes(http, cache)` | `search(q, types)` -> `{ anime: [{ slug, name, year, season }], series: [{ slug, name }], songs: [{ id, title, artists, credit, anime: [{ slug, name, year, season, role, seq, themeId }] }], artists: [{ slug, name }] }` (`types`: some of `'anime' 'series' 'songs' 'artists'`). `anime(slug)` -> `{ slug, name, year, season, format, series: [slugs], resources: { anilist, mal }, synonyms, themes: [find] }` or `null`. `series(slug)` -> `{ slug, name, anime: [{ slug, name, year, season, themes }] }`, oldest first. `artist(slug)` -> `{ slug, name, songs: [find] }`, newest first. `season(year, season)` -> `[{ slug, name, year, season, format, resources, themes }]`, following `links.next`. |
| `aniList(http, cache)` | `season(year, season, { perPage })` (50 at most) -> `[{ id, idMal, title: { romaji, english, native }, popularity, cover, format, startDate: { year, month, day } }]`, most popular first, adult titles left out. |
| `iTunes(http, cache)` | `searchArtist(name)` -> `[{ id, name, genre, link, country }]`; `artistSongs(id, { limit })` -> `[find]`; `albums(id)` -> `[{ id, title, date, type, trackCount, cover, artist, genre, link }]`, newest first; `albumTracks(collectionId)` -> `[find]`, disc by disc; `searchAlbums(term, { limit })` -> albums. Options: `country` (default: `JP` for a name in Japanese script, else `US`; pass the `country` an artist was found in), `name`. |
| `lastFm(http, cache, getKey)` | `available()` (is there a key); `similarTracks(artist, title, { limit })` -> `[find]` scored by match; `similarArtists(name, { limit })` -> `[{ name, match }]`; `topTracks(name, { limit })` -> `[find]`. Without a key each rejects with `'auth'` and sends nothing. |
| `ytLists(client, cache)` | Through yt.js's client (a key or a sign-in): `uploads(channelId, { max })` (100) -> `[find]` with `videoId`, `source: 'ytuploads'` and `addedAt`; `playlist(id, { max })` (200) -> `[find]`, `source: 'ytplaylist'`; `videos(ids)` -> `{ videos, missing }` (videoBatch, 1 unit per 50, each video kept 30 days, a missing one 7); `searchVideos(q, { max, category })` and `searchPlaylists(q, { max })` (100 units each, kept 30 days; a later search for fewer is answered from the cache). A list is read 50 a page (1 unit each) and kept with where it stopped, so a longer read goes on from there. Answers from the cache cost nothing: count units with the client's `onQuota`, not by estimate. |
| `deezerFinds(dz, cache)` | discover.js's `createDeezer` as finds (`source: 'deezer'`, `dz:track:<id>`), with the lasting cache `dz:<path>` (7 days) in front of its memory cache: `related(artistId)` -> `[{ id, name, picture, fans }]`, `top(artistId, n)`, `albums(artistId)` (typed as iTunes albums are), `albumTracks(album)`, `radio(artistId, n)`, `searchArtists(name)`. A Deezer failure is a `SourceError` `'network'` ("Deezer did not answer."). |

Theme finds carry `work` (the anime's name), `workKey` (`at:anime:<slug>`), `series` and `seriesKey` (`at:series:<slug>`) when the anime has one, `ids: { at: themeId, anilist, mal }`, and the same `key` (`at:song:<song id>`) wherever a song is used again, so a page can show it once. The real AnimeThemes refuses `include=anime.animethemes.song.artists` on `/series` (422, seen 2026-10-10): `series()` reads the series with its anime, then each anime on its own (each cached), and remembers the refusal for the session.

What was seen of these sources on 2026-10-10 (with `test/fixtures-check.mjs`): iTunes answers `text/javascript` with blank lines before the JSON, and `collectionType` is `Album` for singles too (the name ends " - Single" or " - EP"); Last.fm sends a list of one as an object; AniList and Last.fm answer with CORS; AnimeThemes, behind Cloudflare, refuses Node's own User-Agent (a browser's is fine).

## finds.js

`TS.finds`: what turns a find (a song the library does not have; the shape is in sources.js) into something the queue can hold.

**The registry.** `registry(lib, { L, now })` returns a registry:

| Call | What it does |
| --- | --- |
| `add(find, video)` | A light track for a find that has a YouTube id (`video`: `{ videoId, title, channel, channelId, durationSec, publishedAt }`). It is made by library.js `upsert` on a shadow library that shares the real one's aliases, profiles and channel rules, so parse.js reads it like an import. A structured find's artist, title, work and role win, as labels do. The track carries `transient: true` and `foundVia: { source, key, why }`. `null` without an id. |
| `get(id)`, `has(id)`, `find(id)`, `ids()` | A light track, and the find behind it. |
| `drop(ids)`, `keepOnly(ids)` | Forget finds; `keepOnly` returns what it dropped. |
| `setDuration(id, sec)` | What the player measured. |
| `listened(id, info)` | A listen, counted the way library.js `recordPlay` counts it. |
| `toJSON()` | Plain data, for the store key `finds:queue`. |

`registryFrom(lib, json, opts)` reads it back.

**Keeping a find.** `promote(lib, reg, id, { L, playlistId, now })` moves a find into the library, in the local playlist `DISCOVERED` (`local:discovered`, "Discovered"), and out of the registry. It returns the ids to write. `FOUND` (`local:found`) is the shadow library's playlist.

**The resolver.** `resolver(deps)` finds a YouTube id for a find that has none, cheapest way first (`RUNGS`, `COST`):

| Rung | Where it looks | Units | When |
| --- | --- | --- | --- |
| known | the find carries an id (a Mix, an upload, the library) | 0 | always |
| cache | `yt:res:<key>` (30 days; "not found" 7 days) | 0 | always |
| library | match.js `inLibrary` (the user's own upload first) | 0 | always |
| pool | a video any list or search returned | 0 | always |
| topic | the artist's Topic channel uploads (learnt from "X - Topic" channels), then the pool again | 1 per 50 | `allow: 'cheap'` or `'search'`, within the automatic allowance |
| search | one YouTube search, match.js `bestVideo` with its minimum | 101 | `allow: 'search'` (a press on Play), within today's allowance less the reserve |

- **`deps`**: `{ M (match.js), cache, index(), lists: { uploads(channelId, { max }) }, canList(), search(q, { max }), canSearch(), budget: { left(), autoLeft(), spend(units, auto) }, topicChannels(), now }`.
- **Calls**:
  - `prepare(finds)` reads the cache once.
  - `estimate(finds)` is synchronous: `{ perFind: { key: { rung, units, status } }, ready, cheap, search, blocked, units }`. The status is `ready`, `cheap`, `search`, `needs-key`, `over-budget` or `not-found`.
  - `resolve(find, { allow })` returns `{ videoId, rung, units, video }`, or `{ none, rung, reason }`, where the reason is `needs-search`, `needs-key`, `over-budget` or `not-found`.
  - `learn(videos)`, `forget(videoId)` (the player refused it), `topicOf(name)` and `known()`.

## feeder.js

`TS.feeder`: what keeps the queue fed. The controller asks for more synchronously (`onNeedMore`). A feeder answers from a buffer of songs that are ready (a library id, or a find with a light track) and fills the buffer in the background, so the queue only ever holds playable ids.

`create(spec, deps)` returns a feeder.
- **`spec`**: `{ kind: 'list' | 'radio', label, href, seed, finds, ratio, ahead, allow, searchCap }`.
- **`deps`**: `{ resolver, registry, providers: { name: fn(ctx) -> Promise<[find]> }, familiar(seedId, n, avoid), track(id), heard(find), hidden(find), songKey, artistOf, workOf, rand, now, onReady(), onStatus(status), maxWaitMs (8,000), askEveryMs (30,000) }`.

| Call | What it does |
| --- | --- |
| `take(n)` | Up to `n` ready ids, at once, and fills again. |
| `fill()` | Keeps `ahead` (3) songs ready. |
| `peek(n)` | `[{ id, find, status: 'ready' \| 'finding' \| 'waiting' \| 'failed', why }]`: what the queue panel shows as coming up. |
| `feedback(id, 'play' \| 'skip' \| 'like' \| 'unplayable')` | A quick skip weakens a radio's provider (x0.85), a like strengthens it (x1.2). |
| `status()` | `{ kind, label, href, phase: 'filling' \| 'ready' \| 'starved' \| 'exhausted' \| 'stopped', buffered, pending, ratio, newShare, taken, searched }` |
| `snapshot()`, `restore(snap, deps)`, `stop()` | The store key `feeder` holds the snapshot. |

**A list** plays in order, a few ahead, and skips a song that cannot be found.

**A radio** never ends. Each slot is a new song or a familiar one by `ratio`, decided by `blend(counts, ratio)`, which makes up a shortfall later. A radio never plays:
- the same artist as the last two;
- the same work as the last one;
- a song already played this session.

When the queue is waiting, a new song that is not ready within `maxWaitMs` gives way to a familiar one, and the late song is kept for later. After two unplayable new songs in a row the next song is familiar, so the controller's five-error halt cannot trip.

## engine.js

`TS.engine.create(opts)`: the one object the page calls about songs the library does not have. It joins finds.js, feeder.js and sources.js's cache to the page's queue.

- **What it stores:** `finds:queue` (the registry), `finds:saved`, `finds:hidden`, `finds:heard` (at most 3,000), `feeder` (the running feeder) and `quota:auto` (what it spent by itself today, at most 300 units).
- **The reserve:** it leaves 1,500 units of the day for imports, refreshes and adds.

| Call | What it does |
| --- | --- |
| `start()` | Reads the store. It contacts nothing. |
| `relink()` | A replaced library: the registry reads names the new way. |
| `track(id)`, `find(id)`, `isFound(id)` | The light track and the find behind it. |
| `play(find \| [finds], { mode: 'now' \| 'next' \| 'later' \| 'from', index, label, href })` | Resolves (a press, so a search is allowed) and hands the id to the page's `playNow`, `queueNext` or `queueLater`; `'from'` is `list`. |
| `list(finds, opts)` | A list feeder (up to 10 searches per press). |
| `radio(seedId, { ratio, label, href })` | A radio feeder. |
| `feeder()`, `take(n)`, `peek(n)`, `stopFeeder()`, `starved()` | The running feeder. |
| `listened(id, info)` | Counts a listen. A find finished `keepAfterPlays` (2) times joins the library. |
| `unplayable(id, code)` | The player refused a song: the resolver forgets it and the feeder hears about it. |
| `keep(id)` | Promote a find now (a like, Keep). |
| `save(find)`, `unsave(key)`, `saved()`, `isSaved(key)` | Saved for later. |
| `hide(kind, value)` | Returns `undo()`. `kind` is `artist`, `song`, `work` or `channel`. Also `isHidden(find)` and `hidden()`. |
| `estimate(finds)`, `resolve(find, { allow })` | What playing would take; finding an id. |
| `quota()` | `{ used, daily, reserve, left, auto: { used, cap }, resetsAt }` |
| `on('feeder' \| 'saved' \| 'hidden' \| 'quota' \| 'library', fn)`, `persist()`, `started()` | Events and saving. |

`opts` takes:
- the modules `L, S, M, F, Fd, Src`;
- `lib()`, a getter, because an import replaces the library;
- `store`, `cache`, `client`, `canRead()`, `demo`, `thumb`, `now`, `rand`;
- `quota: { used(), daily() }`, `reserve`, `autoCap`, `pacificDay`;
- `familiar(seedId, n, avoid)`, `index()`, `topicChannels()`, `queueIds()`, `providers`, `keepAfterPlays`;
- `app: { playNow, queueNext, queueLater, startFeeder(feeder, ids, ctx), onLibrary(ids, meta) }`.

## share.js

`TS.share`: a queue as a link anyone can open, and a pasted list as songs. Neither needs a sign-in or a key: the titles come from YouTube's oEmbed, and the songs play as finds.

| Name | What it is |
| --- | --- |
| `link(ids, title, base)` | `base#/share?ids=a.b.c&t=Title`: each valid video id once, at most `MAX` (100), and a title of at most 120 characters. |
| `decode(query)` | `{ ids, title }` from the address's query. Anything that is not a video id is dropped. |
| `videoIdOf(text)` | The id in a YouTube address (watch, youtu.be, shorts, embed, live) or a bare id; otherwise `''`. |
| `parseList(text)` | One song a line: `{ videoId }` for a link, otherwise `{ artist, title }` from "Artist - Title" (any dash), "Title / Artist" or "Title by Artist". Numbering and bullets are dropped. |
| `titles(ids)` | oEmbed for each id, four at a time: `{ id: { title, channel } \| null }`. Null is a video that is gone or cannot be played on other sites (401). |
| `view(view, ctx, parts, query)` | The pages `#/share` and `#/paste`. |
| `configure({ fetch })` | The tests' fetch. |

- **Where it is:** the bar's More has "Share the queue as a link" (the playing song and what comes after it). The palette has that and "Paste a list of songs".
- **What it costs:** a shared song has its id, so it plays free. A pasted line without a link goes through the resolver: a search (100 units) unless the library or an earlier search has it. Play all looks songs up as it goes, at most 10 searches a press.
- **Privacy:** the requests carry no cookies and no referrer.

## transport.js

`TS.transport`: `create({ onPlay, onPause, onNext, onPrev, onSeek, onSeekBy, onLog, mobile, enabled, now })` returns a transport:

| Call | What it does |
| --- | --- |
| `mirror(state)` | The player's state. `playing` starts the anchor; `loading` keeps it going for up to fifteen seconds (a track change); anything else pauses it. The Media Session's playback state follows. |
| `wake()` | From a click, while the browser allows sound: start the anchor. |
| `metadata({ title, artist, album, artwork })` | What the lock screen and the car show; null clears it. |
| `position({ duration, position })` | The Media Session's position, at most once a second. |
| `enable(bool)`, `enabled()` | Settings > Playback's switch. |
| `anchorState()` | `'none'` (not made yet), `'playing'` or `'paused'`. |
| `hidden()` | On a phone: the page is hidden, so only pause is obeyed. |
| `log()` | The last `LOG_MAX` (20) actions, newest first: `{ at, action, handled, hidden }`. |
| `fire(action, details)` | What the system asked for (one of `ACTIONS`); also the tests' way in. |
| `destroy()` | Stops the anchor and lets go of the Media Session. |

`silentWav(seconds, rate)` is the anchor's sound: 8-bit mono PCM, every sample 128. `ANCHOR_SECONDS` (10) keeps it longer than the five seconds under which Chrome treats a sound as a one-shot.

## actions.js

`TS.actions`:

| Name | What it is |
| --- | --- |
| `VOCAB` | Each action's `label`, `short`, `icon`, `key` and `desc`. |
| `item(name, onSelect, { label, hint, desc, disabled, checked })` | A menu item for ui.js `openMenu`. |
| `label(name)` | An action's label. |
| `KEYMAP` | `[{ keys, does }]`: what the shortcuts list (?) and the help show. |
| `SHARED` | The icon families several actions share on purpose. |
| `check(iconNames)` | The problems: a label or a key used twice, an icon ui.js does not draw, an icon with two meanings. The `actions` test section runs it. |

## taxonomy.js

`TS.taxonomy`: `FAMILIES` (twelve families, each `{ key, name, hue, blurb, genres: [[name, blurb]], list: [{ name, blurb, family }] }`), `SCENES`, `MOODS` (with a sentence each), `LANGS`, `KINDS`, `ROLES` as `[key, name]` rows and `SCENE_NAME`, `MOOD_NAME`, `LANG_NAME`, `KIND_NAME`, `ROLE_NAME` as maps. `genre(name)`, `family(key)`, `familyOf(genre)` (`'other'` for a genre the map does not know, such as YouTube's own Rock), `trackFamily(track)` (its first known genre's), `genresOfFamily(key, known)` (for `'other'`, also the unknown genres in `known`), `hueOf(genre or family key)` (`{ h, s }`: one hue per family, shifted a little per genre). The map was written by hand for one listener's library: anime and visual-novel music, J-rock, city pop and Shibuya-kei, net music, western indie and classics, scores, musicals and classical.

## What YouTube's terms ask of the page

The core does what it can; the rest is the page's.

| Rule | Who |
| --- | --- |
| The player is visible, at least 200 by 200 px, with YouTube's own controls. | `player.js` refuses to build in a smaller or hidden box (`error` with code `'too-small'`) and never turns the controls off. The page must not cover the player, shrink it, move it off screen, or keep playing with the player hidden (no "audio only" view, no background tab trick). |
| Nothing covers the player. | ui.js `safe`: dialogs, sheets, toasts and progress chips lay out around the player (CSS reads `--ts-safe-right` on a wide window, `--ts-safe-top` on a phone), menus move off it (`safe.avoid`), and the player's own messages (loading, could not start) sit under it, never over it. The now-playing panel scrolls only the part under the video, so the video never scrolls away. |
| No sound while the player is hidden. | transport.js's media-key anchor plays silence, only while YouTube's player plays, so that media keys and car buttons reach the page; on a phone it pauses the moment the page is hidden and ignores play, next, previous and seeking until the page is visible again. It never plays YouTube's sound and cannot keep it going. |
| A visible link to the YouTube Terms of Service and to Google's Privacy Policy. | The page: `Y.TERMS.youtubeTerms`, `Y.TERMS.googlePrivacy`. Put them in the footer and in the help, and say "This page uses YouTube API Services". |
| A way to delete all stored data and to revoke access. | The page offers both: `store.wipe()` (and `ToyKit.store(key, null)` for anything it kept through the kit), and `auth.signOut()`. Also link `Y.TERMS.googlePermissions`, where Google lets the user remove access himself. |
| Stored API data is refreshed or deleted within 30 days. | sources.js's cache keeps anything from YouTube (keys under `yt:` and `oe:`) 30 days at most, whatever a caller asks. At each sign-in: `if (L.stale(lib, Date.now(), TS.config.refreshDays).length) Y.refreshInto({ client, lib, store })`. `L.stats(lib).staleCount` is for a banner when he has not signed in for a month: offer "sign in to refresh" or "delete". |
| "What this page stores." | A short plain note in the help and the footer. The bench's wording can be reused: the imported lists with titles, channels, lengths and topics as YouTube reports them; his corrections, tags, ratings, play counts, history and queues; all in this browser only (IndexedDB); the sign-in token for the tab's session only (sessionStorage); nothing sent anywhere but to Google. |

When a video plays, YouTube's iframe contacts hosts of its own that are not in `toy.json` (seen on 2026-10-05: `*.googlevideo.com`, `yt3.ggpht.com`, `www.gstatic.com`, `ssl.gstatic.com`, `www.google.com`, `jnn-pa.googleapis.com`, `fonts.gstatic.com`). The smoke gate never plays anything, so it does not see them; a drive script that plays a real video needs them in `extraAllowedHosts`.

**Other sites (since 2026-10-10).** The page may also contact these, only when a page or a press asks, and they are in `toy.json`:

- `api.animethemes.moe` (AnimeThemes)
- `graphql.anilist.co` (AniList), and `s4.anilist.co` for its covers (pictures)
- `itunes.apple.com` (the iTunes Search API), `is1-ssl.mzstatic.com` to `is5-ssl.mzstatic.com` for artwork (okImage allows any `is<n>-ssl`; in practice 1 to 5), `audio-ssl.itunes.apple.com` for 30-second previews
- `ws.audioscrobbler.com` (Last.fm; only with the listener's own key)
- `lrclib.net` (synced lyrics, lyrics.js)
- `www.youtube.com` for oEmbed (already listed for the IFrame API), `i.ytimg.com` (already listed)
- Deezer, already listed: `api.deezer.com` (through the sandboxed frame), `cdn-images.dzcdn.net`, `e-cdns-images.dzcdn.net`, `cdnt-preview.dzcdn.net`, `cdns-preview-d.dzcdn.net`; okPreview also allows other `cdns-preview-<x>.dzcdn.net`, so add `cdns-preview-e.dzcdn.net` (and the others if the smoke gate reports them)
- not yet: `api.vndb.org` (`HOSTS.vndb` exists; nothing calls it)

`music.apple.com` appears only as links the reader opens (iTunes `link`), not as a request. Covers come from AniList, never from AnimeThemes' own image host.

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
| helpers | `normArtist(name)`, `normTitle(title)`, `people(credit)` (the people in a credit: `A & B`, `feat.`, `Character (CV: Voice actor)`; `[{ name, key, as }]` with `as` `cv`, `character` or empty), `artistOf(lib, name)`, `channelKey(track)`, `parseDuration(iso)`, `lengthClass(sec)`, `decadeOf(year)`, `firstAdded(track)`, `lastAdded(track)`, `genresFromTopics(urls)`, `channelName(track)`, `derive(lib, track, known)`, `deriveAll(lib, test, known)` |
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

**The queue.** `queue(state, action)` is a reducer over `{ items, index, history, done, repeat }` (`queueInit()` is the empty state; `current(state)` and `upcoming(state)` read it). It never changes the state it is given. Actions: `load { ids, index }`, `next`, `previous`, `jump { index }`, `playNext { ids }`, `playNow { ids, started }` (play these now and keep what was coming: with `started` they go right after the current track and the first becomes current, the track left joins the history; without, a restored queue that has not started, they go before the current track), `insert { ids, after }` (after the first `after` tracks that follow the current one; how Play next and Add to queue keep songs queued by hand together), `enqueue { ids }`, `remove { index }` or `{ id }`, `move { from, to }`, `clearUpcoming`, `setRepeat { value }`, `reset`. `history` is what was current and then left, oldest first, at most 500. The page rarely calls it directly: the controller does. Also exported: `hash128(text)`, `lengthClass(sec)`.

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
| `exportAll(now)` | One object: `{ format: 'true-shuffle-export', version, exportedAt, tracks, playlists, kv, history }`. `ToyKit.download('true-shuffle.json', JSON.stringify(data), 'application/json')` (the cache and import progress are left out). |
| `importAll(data, { mode })` | `'replace'` (default) or `'merge'`. Rejects with a sentence, changing nothing, if the file is not an export (`checkExport(data)` is the check; `FORMAT`, `FORMAT_VERSION`). Reload the library afterwards. |
| `wipe()` | Deletes everything stored, the cache included; the store stays usable. |
| `destroy()` | `wipe()` and removes the database; the store cannot be used afterwards. |
| `usage()` | `{ tracks, playlists, kv, history, bytes }` (`bytes` null where the browser does not say), and, while the cache holds anything, `cache` (its rows) and `cacheBytes`. |
| `cacheGet(keys, { now, rows })` | `{ key: value }` for the keys that are there; an expired row counts as missing. With `rows`: `{ key: { value, exp, at } }`. `now` defaults to `Date.now()`. |
| `cachePut(rows)` | `rows`: `[{ key, value, exp, at }]`; `at` defaults to now, and `size` (the value's length as JSON, with the key) is stored too. A row without a key or an expiry refuses the lot. |
| `cacheRange(prefix)` | `[{ key, value, exp, at }]`, unexpired, in key order. |
| `cacheDelete(keys)` | |
| `cacheSweep({ now, maxRows, maxBytes })` | Expired rows go first, then the rows nearest to expiry until there are at most `maxRows` (5,000) and `maxBytes` (12 MB). -> `{ expired, evicted, rows, bytes }`. |
| `cacheClear(prefix)` | The rows under `prefix`; all of them without one. |
| `close()` | |

**The cache (database version 2).** `DB_VERSION` is 2: a fifth object store, `cache` (key path `key`, an index on `exp`), holds other sites' answers for sources.js. It is not the listener's data: `exportAll` leaves it out, `importAll` leaves it alone, `wipe()` empties it, `destroy()` drops it with the database. Opening a version 1 database runs the upgrade, which only creates `cache` and its index; the four data stores are not touched. A tab still holding the old version closes its connection when the new one asks (`onversionchange`), so the upgrade is not blocked; that tab's store then answers "The store is closed." Checked in Chrome on 2026-10-10: a version 1 database of 3,000 tracks, 5 playlists, kv records and 20 listens, written by the old store.js and opened by the new one while the old page held it, exported byte for byte the same; the cache calls behaved on IndexedDB as on the in-memory twin.

Keys in use: `library` (the meta), `queue`, `plan`, `quota` (`{ day, units }`), `bag:<signature>`, `import:<playlist id>` (written by `importInto`; left out of exports); since 2026-10-10 also `queue:hand` (songs queued by hand), `rating:beforeLike`, `songprefs` (trim and volume per song), and engine.js's `finds:queue`, `finds:saved`, `finds:hidden`, `finds:heard`, `feeder` and `quota:auto`. Nothing about his music is ever written anywhere else.

## player.js

```js
var p = TS.player.create({ kind: 'youtube', container: box, host: 'https://www.youtube-nocookie.com' });
var p = TS.player.create({ kind: 'mock', container: box, durationOf: fn, errorOf: fn, titleOf: fn, speed: 1, auto: true });

p.on(name, fn) -> off()
p.load(id, { autoplay, startSec }) -> Promise      p.play()  p.pause()  p.stop()  p.seek(sec)
p.volume(0..100)  p.muted(bool)  p.rate(0.25..2)   (each also reads back; the YouTube player keeps the rate across videos)
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
ctl.load(ids, index)  ctl.next()  ctl.previous()  ctl.jump(index)  ctl.playNext(ids)  ctl.playNow(ids)  ctl.insert(ids, after)  ctl.enqueue(ids)
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
auth.handleRedirect()    // -> { status: 'none' | 'signed-in' | 'error', error, writeDenied, asked }
auth.signIn({ prompt, scope })  // from a click; scope: Y.WRITE_SCOPE only to add to a playlist
auth.canWrite()          // may this token add to playlists
auth.token()             // the access token or null       auth.signedIn()   auth.secondsLeft()
auth.onChange(fn)        // fn(signedIn); returns off()
auth.signOut()           // -> Promise<{ revoked: true | false | 'sent' }>
auth.forget()            // drop the token without telling Google
auth.signInUrl()  auth.redirectUri()  auth.clientId()  auth.mode  auth.test
```

The redirect flow: `signIn()` stores a random 128-bit state and the page's query in sessionStorage and sends the browser to `accounts.google.com/o/oauth2/v2/auth` with `response_type=token`, the scope `Y.SCOPE` (`https://www.googleapis.com/auth/youtube.readonly`) and this page's own address as redirect URI (`redirectUriFor(location)`: the address without `index.html`, query or fragment). Google returns to that address with `#access_token=...&state=...`. `handleRedirect()` accepts the answer only if the state is the one stored and less than ten minutes old, removes the fragment from the address with `history.replaceState`, puts the query back, and keeps the token in memory and in sessionStorage (`Y.KEYS`). A token within a minute of its end counts as gone: there is no refresh, the reader signs in again (one click; nothing else is lost, the import resumes). `signOut()` posts the token to `oauth2.googleapis.com/revoke` and forgets it whatever the answer. The pure parts are exported for tests: `buildAuthUrl`, `parseAuthResponse`, `checkAuthResponse`, `randomState`.

**Writing, only when asked.** The page reads with `Y.SCOPE`. Adding a song to one of the account's playlists needs `Y.WRITE_SCOPE` (`https://www.googleapis.com/auth/youtube`; Google has no narrower scope for `playlistItems.insert`). The page asks for it the first time the reader presses Add, with `signIn({ scope: Y.WRITE_SCOPE })`: the pending state remembers the scope asked for, and `handleRedirect()` checks the answer against it. If Google grants only reading (the reader unticked the box), the sign-in still counts for reading and the result says `writeDenied: true`. `auth.canWrite()` and `Y.canWriteScope(granted)` say whether a token may write (`youtube`, `youtube.force-ssl` or `youtubepartner`). The owner adds that scope to the consent screen in Google Cloud next to the read one.

What was found about this flow on 2026-10-05:

- Google's page for it (developers.google.com/identity/protocols/oauth2/javascript-implicit-flow) still documents the endpoint and parameters, and now calls the flow discouraged, "for legacy support and troubleshooting", recommending the authorization-code flow instead. That flow needs a server to exchange the code, which a static site does not have; Google Identity Services' token model, the other browser-only way, is the same implicit grant in a popup run by Google's script. Nothing found says the redirect is switched off for new clients, and it **could not be tried against Google from here** (no credentials). If Google answers the redirect with an error page ("Error 400: invalid_request" or "unsupported_response_type"), set `signIn: 'gis'` in `config.js`: `auth.signIn()` then loads `https://accounts.google.com/gsi/client` when pressed, opens Google's popup and resolves with the token. **The GIS path is written and has never been run.**
- The revoke endpoint is documented as closed to cross-origin reads, but on that day it answered a cross-origin POST with `Access-Control-Allow-Origin`. `signOut()` tries a normal request and, if the browser will not show the answer, sends it again as a request it may send but not read (`{ revoked: 'sent' }`).

**The Data API.**

```js
var client = Y.createClient({ getToken: auth.token, getApiKey, endpoints, onQuota(units, method), onSignedOut, maxRetries });
client.sources()      -> { me, sources: [{ id, title, count, privacy, special }] }   // Liked videos first; private playlists included
client.me()           -> { channelId, title, likes, uploads } | null
client.playlists()    -> [{ id, title, count, privacy, publishedAt }]
client.playlistPage(playlistId, pageToken) -> { items: [{ videoId, addedAt, position, title, channel, channelId, unavailable }], nextPageToken, total }
client.videoBatch(ids)                     -> { videos: [records for L.upsert], missing: [ids] }     // at most 50
client.search(q, { max, category })      -> [{ videoId, title, channel, channelId, publishedAt }]    // 100 units; max 1 to 25 (5)
client.searchPlaylists(q, { max })       -> [{ playlistId, title, channel, channelId, publishedAt }] // 100 units; max 1 to 25 (10)
client.addToPlaylist(playlistId, videoId) -> { itemId, playlistId, videoId, addedAt, position }   // 50 units; needs WRITE_SCOPE
client.removeFromPlaylist(itemId)          -> true                                                  // 50 units (the undo)
client.canRead()      -> can it read public data now (a sign-in, or an API key)
client.quota()        -> { units, requests, byMethod, since }      client.get(resource, params)   client.endpoints
```

`search` finds embeddable videos in Music (category 10) unless `category` says otherwise: another category id, or `null` or `''` for every category. Official anime channels put their creditless openings and endings under Film & Animation (category 1), so a search for those needs `category: null`. `searchPlaylists` finds playlists (`type=playlist`); an album on YouTube Music is one, its id starting `OLAK5uy_`. Both are `search.list`, `Y.UNITS['search.list']` (100 units), counted through `onQuota` like every call. A playlist item's `channel` and `channelId` are its video's owner's (`''` for a deleted or private video).

Every list call costs one quota unit, a failed one included, and each is counted (`onQuota`); `Y.UNITS` lists the dearer ones (a search 100, adding to or removing from a playlist 50). Signed out, `getApiKey()` (a browser API key) lets the public reads go ahead with `key=` in the query and no other credential: a playlist page (a channel's uploads), a search, video details; the account's own lists (`mine=true`) and every write still need the sign-in, and a key Google refuses, or one not allowed on this website, is `bad-key`. Writes are never retried, so a song cannot be added twice by a retry; a write refused for want of the scope is `needs-write`. `Y.tallyQuota(saved, units, now)` keeps a per-day tally `{ day, units }` for the store, starting again when `Y.pacificDay(now)` changes (Google resets at midnight Pacific). The default allowance is 10,000 units a day per Google project (`TS.config.dailyQuota`). The meter counts only what this page spent. 5xx answers, rate limits and network failures are retried up to four times with a doubling wait from half a second. `toVideo(item)` turns a `videos.list` item into a library record (the description is read for a release date and dropped; YouTube's own tags are not kept).

Errors are `YTError` objects (`isYTError(e)`): `e.code` is one of `'signed-out' 'forbidden' 'needs-write' 'bad-key' 'quota' 'rate' 'not-found' 'bad-request' 'server' 'network' 'aborted' 'config' 'denied' 'state' 'scope'`; `e.message` is a sentence for the reader; `e.status`, `e.reason` (Google's own word, such as `quotaExceeded`, `accessNotConfigured`, `playlistItemsNotAccessible`) and `e.detail` are for the curious. `.catch(function (e) { show(e.message); })` is the whole failure path.

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
   - **Data access > Add or remove scopes**: tick `https://www.googleapis.com/auth/youtube.readonly` ("View your YouTube account"), update, save. To add songs to your playlists from the page, tick `https://www.googleapis.com/auth/youtube` ("Manage your YouTube account") as well; the page asks for it only when Add is first pressed. No other scope.
4. **Client.** **APIs & Services > Credentials > Create credentials > OAuth client ID** (or **Clients > Create client**).
   - Application type: **Web application**.
   - Authorised JavaScript origins: `https://nietztein.github.io`
   - Authorised redirect URIs: `https://nietztein.github.io/misc/101-true-shuffle/` (with the final slash, nothing after it).
   - Create. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). Ignore the client secret: a browser app does not use one. Do not paste it anywhere.
5. **Paste the client id** into `misc/101-true-shuffle/config.js`, as the value of `clientId`, and publish the site.
6. **First sign-in.** Press Sign in on the page, choose your account. Google shows **"Google hasn't verified this app"**. That screen means only that the app is in Testing and Google has not reviewed it; it appears for every app in Testing that asks for a scope like this one, and only the test users listed in step 3 can get past it. Press **Continue** (if it is not offered, **Advanced**, then "Go to True Shuffle"). The next screen lists the one permission, "View your YouTube account": allow it. The page then has read-only access for one hour; it cannot change, add or delete anything on YouTube. Anyone not on the test-user list gets "Access blocked" instead.
7. If Google answers the sign-in with an error page instead of the account chooser, see "What was found about this flow" above: set `signIn: 'gis'` in `config.js` and try again.
8. **Optional: browse without signing in.** **Credentials > Create credentials > API key**, restricted to YouTube Data API v3 and, under Website restrictions, to `https://nietztein.github.io/*` (and `http://localhost/*` to try it locally). Paste it into Settings (this browser only) or into `apiKey` in `config.js` (every visitor; a browser key restricted to the site is meant to be public, but its quota is shared). With it, a channel's uploads, Discover's Play and the YouTube search work signed out.

To try the real sign-in from this machine before publishing, add `http://127.0.0.1:8080` to the JavaScript origins and `http://127.0.0.1:8080/misc/101-true-shuffle/` to the redirect URIs, and run `node scripts/serve.mjs --port 8080`.

Changes to a client can take a few minutes to take effect. Access can be removed at any time at https://myaccount.google.com/permissions.

## What was found about YouTube lists in the IFrame player on 2026-10-10

A probe page outside the repo, driven by `scripts/qa/drive.mjs` with visible players on both hosts (`www.youtube-nocookie.com` and `www.youtube.com`), using only documented calls. The probe and its raw results stayed in the session's scratchpad.

- **A Mix (`'RD' + videoId`) can be read without playing anything.**
  - A fresh player built with `videoId: seed` and `playerVars: { listType: 'playlist', list: 'RD' + seed }` on nocookie has the list inside `onReady`: 50 ids, the seed first (6 of 6 seeds), state CUED, one request (`/youtubei/v1/embedded_player`), no media.
  - `cuePlaylist({ listType: 'playlist', list: 'RD' + seed })` on an existing player also fills it (50 ids in 0.6 to 0.9 s). That list is the seed's Mix but not anchored on it: the seed was first in 1 of 6 and missing in 5 of 6. It shares 28 to 43 of its 50 ids with the anchored list.
  - `loadPlaylist` is never needed. The list does not grow after 3 s, 10 s or three quick `nextVideo()` calls.
  - nocookie is steadier: www reuses a cached list for an RD id across players (it even cued that list's first item instead of the `videoId` asked for), and only www contacted `doubleclick.net`.
  - A Mix holds some videos that cannot be embedded, and changes a little from read to read.
- **Uploads (`'UU' + channelId.slice(2)`), playlists (`PL...`) and albums (`OLAK5uy_...`) can be read with `cuePlaylist` in 0.2 to 0.6 s** on both hosts.
  - `getPlaylist()` stops at **200 ids**: a 437-upload channel gave 200, a 447-item playlist 200, a 43-item playlist 43, an album 10.
  - There is no way past 200: a cue at index 199 returns the same 200, and a cue at index 250 starts again from item 0.
  - Every way in fills every kind of list: the constructor's `list`, a cue after a video, and `loadPlaylist` at index 0 or 1.
- **A read can fail silently.** When the item at the cued index cannot be embedded, `getPlaylist()` stays empty and no `onError` fires; the same list cued at the next index reads in full.
- **Reading a list on the only player stops the music** (PLAYING becomes CUED). Read while the player is idle, at a song's boundary, or on a second visible player.
- **Back to single videos.** After a list, `loadVideoById(x)` returns the player to single-video mode: for about 100 ms the getters return `undefined`, then `getPlaylist()` is `null`, `getPlaylistIndex()` is -1, and at the end of `x` comes ENDED and nothing more (no auto-advance).
- **Inside a list given as an array** (`loadPlaylist([a, b, c])`), no ENDED fires between items. The next item's UNSTARTED, BUFFERING and PLAYING follow, and `getPlaylistIndex()` and the `v=` of `getVideoUrl()` already name the new item at the first of them. `nextVideo()` gives PAUSED (already the next item), then the same. ENDED comes only after the last item, and it does not loop.
- **oEmbed answers a browser** (`https://www.youtube.com/oembed?url=...&format=json`; CORS, no key, no quota).
  - Measured over 102 requests: p50 37 ms, p95 57 ms one at a time; p50 35 ms four at a time.
  - A video that cannot be embedded gives 401 and an invalid id 404; `fetch` resolves for both and the body can be read.
  - `author_url` is `/@handle` for most channels and `/channel/UC...` for Topic channels.
- **Pages on an IP address.** On `http://127.0.0.1` most music videos failed with error 150 and most lists read empty; on `http://localhost` the same videos played. Drive scripts that play real YouTube load the page through `localhost`.

## Shipping a change

`index.html` loads the page's own scripts and `app.css` with `?v=<date>`. GitHub Pages lets browsers keep a file for ten minutes, and a page that mixes a new `app.js` with an old `yt.js` can break, so bump that stamp (every script and stylesheet at once) whenever any of them changes. The `lint` test section checks that the stamps are all the same and that every stamped file exists.

## Tests

```
node misc/101-true-shuffle/test.js                  over 1,700 checks, a few seconds
node misc/101-true-shuffle/test.js parse shuffle    only those sections
node misc/101-true-shuffle/test.js sources cache        the network layer, the clients, the cache
node misc/101-true-shuffle/test/fixtures-check.mjs      by hand: are the fixtures still shaped like the real answers?
node misc/101-true-shuffle/test/fake-youtube.mjs --port 8791     the fake, to click against
```

Sections: `parse` (the table, statelessness, 484 odd inputs), `library`, `shuffle` (uniformity by chi-square, the bag across serialise and restore, the spread over 600 random libraries, seeds, limits, 4,000 random queue actions on frozen states), `store` (the in-memory twin), `player` (the mock and the controller), `demo`, `yt` (the sign-in round trip through the fake's real HTTP redirect, typed errors, retries, quota, the 1,230-item import, four kinds of interruption and resume, refresh, MusicBrainz), `lint` (app.js as text: no two top-level functions with one name, one song never replaces the queue, one button component, a line ratchet; index.html's `?v=` stamps), `transport`, `actions` (`A.check`), `match`, `finds`, `feeder`, `engine`, `share`, `sources` (in test/sources.section.js: the lines on a fake clock: gaps, places, Retry-After, backoff, the breaker, offline, shared requests, abort, what is sent; the find and the allowlists; every client against the fixtures; yt.js's `search` categories and `searchPlaylists`, and ytLists, against the fake over HTTP; Deezer as finds) and `cache` (in test/cache.section.js: store.js's cache calls on the in-memory twin; `createCache`'s time limits, the 30-day cap on `yt:` and `oe:`, the in-memory front, `wrap`'s "no", the sweep). The IndexedDB half of the cache and the version 1 to 2 upgrade were checked in a browser (store.js above), `readme` (every exported name is in this file). Since 2026-10-10 a section may live in its own file, `test/<name>.section.js`, which test.js loads.

The fake serves the OAuth redirect, revoke, `channels`, `playlists` (59, two pages), `playlistItems` (PL_BIG has 1,230 items: 1,200 videos, 30 listed twice, 29 deleted, 12 private, 32 not embeddable; PL_PRIVATE; PL_SMALL; PL_EMPTY; LL; PL_FORBIDDEN answers 403), `videos`, MusicBrainz's two calls, all with CORS. Switches (`fake.set({...})` or `POST /__control`): `quotaAfter`, `failNext`, `rateLimitNext`, `expireAfter`, `deny`, `noChannel`, `gone`, `shrink`, `latencyMs`.

The fake also answers `search.list` (`type=video` and `type=playlist`, from `test/fixtures/youtube-search.json`, 100 units each; `videoCategoryId` and `videoEmbeddable=true` are honoured), `videos` and `playlistItems` for those fixture videos and lists, and the free sources of sources.js, from invented data in `test/fixtures/`:

| Route | Answers |
| --- | --- |
| `GET /oembed?url=...&format=json` | The generated videos and the fixture ones; 401 for one that cannot be embedded (`fake0000037`, `fakeS000004`) or is private, 404 for a deleted or unknown id. Topic channels' authors are `/channel/UC...`, others `/@handle`. |
| `GET /animethemes/search`, `/anime/<slug>`, `/anime` (a season, with `links.next`), `/series/<slug>`, `/artist/<slug>` | `animethemes.json`: eight invented anime (a three-entry series, Lumen Tide, with a song used again in its film; this season's four; one opening without a song). Includes it does not know answer 422, as the real API does; the nested include on `/series` is one of them. |
| `POST /anilist` | The season query, from `anilist-season.json` (Fall 2026; other seasons have none). |
| `GET /itunes/search`, `/itunes/lookup` | `itunes.json`: artists, albums (a single, an EP, an album listed twice, a compilation, one without a suffix) and songs, as `text/javascript` with blank lines first, as Apple sends them. |
| `GET /lastfm/?method=` | `lastfm.json`: `track.getsimilar`, `artist.getsimilar`, `artist.gettoptracks`; error 10 without `api_key`, error 6 for what it does not know. |

More switches: `sourceFail: { host: n }` (the next n answer 503), `sourceRate: { host: n }` (429 with `Retry-After: 1`; iTunes 403; Last.fm error 29), `atNestedSeries` (take the nested include), `atPageSize: n` (a smaller page, to see `links.next`). `fake.sources` is the same fake without a server: `createSourceFake().fetch` answers these routes in-process, at any origin, and `loadFixtures()` reads the fixtures.

`test/fixtures-check.mjs` (by hand, not part of test.js) asks the real AnimeThemes (a search, an anime, a series, an artist, this season), AniList (this season), iTunes (an artist search, the artist's albums, an album's songs) and YouTube oEmbed (YouTube's own sample video) through sources.js's own clients, asks the fake the same kind of questions, and compares the shapes. A key sources.js reads that the real answer lacks or types differently fails it (exit 1); other differences are printed as notes. It never calls the YouTube Data API (quota) or Last.fm (a key), sends nothing about the listener, and says "fixtures-check" as its User-Agent. On 2026-10-10 every source matched, and the nested include on `/series` was still refused.

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
