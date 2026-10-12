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
| `channel.js` | A YouTube channel as a place to find music: every upload, the artist read from each title, the ones new to you first; the channels that find music for you (`#/channel/<id>`, `#/channels`). | the pages only |
| `lanes.js` | A lane: one titled section that loads its own data and is never blank (loading, ready, empty, error, unavailable). | yes |
| `media.js` | One song row, card and menu for library tracks and found songs alike: source, why, in library, the cost of Play. | yes |
| `works.js` | Which anime a song is from (AnimeThemes, checked against the library), and the franchise's every opening, ending and insert. | no |
| `artists.js` | An artist on iTunes, Deezer and AnimeThemes (checked against the library): top songs, albums, EPs, singles, anime songs. | no |
| `explore.js` | Explore: any song as a door to more music: its anime, YouTube Mix, artist and albums, songs like it, its channel, the library's own (`#/explore/<id>`, the now-playing panel's Explore tab). | the pages only |
| `credits.js` | Who wrote a song, from MusicBrainz: composer, lyricist, arranger, the players, the work; a composer's or lyricist's other songs as found songs (Explore's "More by <composer>"); the line on the song page; invented ones for the demo. | the lane and the line only |
| `scrobble.js` | Opt-in ListenBrainz scrobbling with the listener's own token. Written and tested, not loaded yet: on 2026-10-11 ListenBrainz's API refused browsers (every path redirected to a 404). | no |
| `recs.js` | The taste profile from your plays, likes and skips; which found songs a lane shows (not yours, not heard lately, not hidden, each once, the stale ones last); the feed's bookkeeping; moving the old Discover keys. | no |
| `foryou.js` | For you (`#/for-you`): Your radio, this season's anime, airing today, the songs missing from your series, new releases, new uploads from your channels, Because you play X, Saved for later and Hidden, each a lane. | the page half |
| `rescue.js` | Songs gone from YouTube (`#/rescue`): the uploads that cannot play, another upload of the same song for each (the library, what YouTube showed before, the artist's Topic channel, a search), and the swap that moves ratings, plays, labels, playlists and history onto it, with Undo. | the page half |
| `fuzzy.js` | Search that forgives: romaji for kana titles, long vowels written or not, typos, a word half typed, a title typed without its spaces; the search page's Close matches and the palette's songs. | the page half |
| `handoff.js` | Continue on your phone: the link that opens this queue at this song and second on another device, a QR code of it drawn in the page, the dialog. | the dialog only |
| `habits.js` | Listening habits: the listening clock on Your numbers (minutes by weekday and hour, the streaks, minutes per week), the home page's Usually at this hour, and Skip the intro, learned (a song you keep seeking into is offered a later start). | the page half |
| `pip.js` | The mini player: the song, its buttons and the time in a small window that stays on top of other windows (Chrome and Edge on a desktop). YouTube's player stays in the page. | the window only |
| `duel.js` | Rank your songs two at a time (`#/duel`): which of two songs you like more, a score per song with how sure it is, the ranking, and stars from it. | the page half |
| `wrapped.js` | Your year: the year in review (`#/wrapped`) and the home page's On this day, Rediscover old favourites and the nudge to like a song. | the page half |
| `lyrics.js` | The words of the song that is on, from LRCLIB: the Lyrics tab, the karaoke page, finding a song by a line of its words. | the views only |
| `quiz.js` | Guess the anime: a few seconds of an opening or an ending from the library (Apple's 30-second previews), four anime to choose from. | the page only |
| `embed.js` | Embeddings of the tracks, nearest neighbours, the 2D layout of the map, its regions. | no |
| `demo.js` | An invented library of 160 tracks for `?demo=1` and `?thumb=1`, labelled. | no |
| `yt.js` | Google sign-in, the YouTube Data API client, the resumable import, the refresh, MusicBrainz. | sign-in redirect only |
| `test.js` | `node misc/101-true-shuffle/test.js`: over 1,700 checks, PASS and FAIL lines, exit 1 on failure. | no |
| `test/fake-youtube.mjs` | A local fake of the Google endpoints, for tests. | no |
| `toy.json` | The manifest (`"status": "wip"` until the page exists). | |
| `ui.js` | The page's small parts: DOM builder, icons, one button component, setting rows (`check`: a box, a title and what it does), router, menus, dialogs, virtual list, cover art, toasts, progress chips, an event bus, the player-safe zone. | yes |
| `actions.js` | The action vocabulary: one label, icon and key for each thing the page lets you do, and the list of keys. | no |
| `transport.js` | What the operating system sees: the Media Session and the media-key anchor. | the anchor only |
| `ds.css` | The design system: tokens, the button, badges, progress chips, the player-safe zone, touch screens. | yes |
| `index.html`, `app.js`, `app.css` | The page. | yes |

Everything is UMD: in the browser each file adds one member to `window.TrueShuffle` (`config`, `parse`, `library`, `shuffle`, `store`, `player`, `demo`, `yt`, and since 2026-10-10 `transport`, `actions`, `match`, `sources`, `finds`, `feeder`, `engine`, `share`, `wrapped`, `lyrics`, `quiz`, `channel`, `lanes`, `media`, `works`, `artists`, `explore`, `car`, `credits`, `recs` and `foryou`); in Node each is a CommonJS module. The sources are plain ASCII (other characters are written as escapes), old-style (`var`, `function`, one IIFE), tabs.

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
<script src="lyrics.js"></script>      <!-- needs match, sources, ui -->
<script src="quiz.js"></script>        <!-- needs library, sources, ui -->
<script src="wrapped.js"></script>
<script src="share.js"></script>
<script src="channel.js"></script>      <!-- needs parse, sources, player, ui -->
<script src="lanes.js"></script>        <!-- needs ui, media -->
<script src="media.js"></script>        <!-- needs ui, actions -->
<script src="works.js"></script>        <!-- needs match, library, sources -->
<script src="artists.js"></script>      <!-- needs match, library, sources -->
<script src="explore.js"></script>      <!-- needs channel, lanes, media, works, artists -->
<script src="car.js"></script>          <!-- needs transport, ui -->
<script src="credits.js"></script>      <!-- needs match, sources -->
<script src="recs.js"></script>         <!-- needs discover (its fold), sources -->
<script src="foryou.js"></script>       <!-- needs recs, lanes, media, works, artists, channel, explore -->
<script src="rescue.js"></script>       <!-- needs library, match, parse (sources, share on the page) -->
<script src="fuzzy.js"></script>        <!-- needs match -->
<script src="handoff.js"></script>      <!-- needs share, ui -->
<script src="habits.js"></script>        <!-- reads car.js when it asks -->
<script src="pip.js"></script>          <!-- draws through pageCtx -->
<script src="duel.js"></script>
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

An app shell: the kit's header is the top bar (brand, back and forward, the search box; the kit adds theme, help and the link back to the site), then the sections, the view, and the now-playing panel (YouTube's player, this track's labels and rating, the queue and what played), with the player bar at the bottom. Under 1180 px the sections keep only their icons; under 760 px the page is a phone app: tabs at the bottom (Home, Search, Discover, Library, Queue), the video docked under the top bar once something plays (it never shrinks below 200 px), the queue as a sheet.

Views, by hash: `#/` home (quick starts, today's mix, moods, families, scenes, artists, works, recently added), `#/search?q=`, `#/songs`, `#/artists`, `#/artist/<key>` (play, shuffle, artist radio, appears in, sounds like), `#/genres`, `#/family/<key>`, `#/genre/<name>`, `#/browse` (moods, scenes, languages, decades), `#/c/<mood|scene|lang|decade|role>/<value>`, `#/works`, `#/work/<name>`, `#/track/<id>`, `#/mix` (the mix builder; saved mixes are stations), `#/stats`, `#/fix` (unsure artists with one-tap readings, unlabelled, duplicates, unplayable, blocked), `#/settings` (YouTube, labels, sync, backup, appearance, playback, car, MusicBrainz, data and privacy; a sticky row of chips jumps to each section and lights the one in view), `#/library` (the phone's hub).

Every collection has Play (in order) and Shuffle (its filters as a plan, in the current order mode); Radio plays songs that share genres, mood, scene, language and family with a seed. Track lists are virtual, select with click, Ctrl or Cmd and Shift, play with a double click or Enter (one tap on a phone), and have a menu per row (the menu key or Shift+F10 too) and a bar for a selection. The editor edits one track or many (fields left alone stay). Cover art is the video's thumbnail from i.ytimg.com when there is a library, never in the demo, and can be switched off in Settings.

**Playlists and focus (#/lists, #/list/<id>).** A playlist is smart (`{ id, name, kind: 'smart', patch, mode }`: a saved filter in the plan's terms, so songs join and leave as their labels change) or hand-picked (`{ kind: 'manual', ids }`). They are kept under the store key `lists` (older `presets` are migrated). Focus (the button left of the search, key `focus`) narrows the whole app to one playlist: every view, search, the index the views count from, the shuffle's selection and bag (its key gains `:<id>`), radio and the map read `scopeTracks()`. Every collection page (genre, family, mood, scene, work, artist, search results) offers Focus and Save as playlist; the playlists page suggests ones built from the library (each scene, openings, endings, mood and scene pairs, the biggest works). Songs are added to a hand-picked playlist from a song's menu, a selection, or by dragging rows onto it in the sidebar; dragging onto the queue panel queues them.

**Shuffle options.** The plan carries `apart` (default on: `S.apart` keeps songs of one work, like one artist, from playing back to back in every order but the true shuffle and the rotations), `oneVersion` (one version of each song, `S.songKey`, per build or per bag round) and `text`. The order modes gain `flow` (`S.flowOrder`, Mood flow): a walk where each song leads to a near one by `S.labelSimilarity` (shared genres, `S.moodDistance` on `S.MOOD_RING`, scene, language), never the same artist or `S.workKey` as the last two.

**Songs like this one.** The queue panel's third tab, Explore (it was Like this until 2026-10-11), beside Up next and Played, shows explore.js's lanes for the song that is on, following it as the queue moves (the chosen tab is remembered). The track page shows its library, anime and similar lanes. `S.similar(seed, tracks, { history, people, limit, perArtist, perWork, min })` scores the library against the song from its labels (shared genres, the first counting most; the same mood; the era within two years; the scene; the language), the people credited (`people(t)`, here `L.people` without the characters, so a character song and the voice actor's solo single meet: "also sung by"), the same work and artist, and how often the two were played next to each other (`S.coPlays(history, id, { gapMs })`, skips left out, 20 minutes apart at most); other uploads of the same song (`S.songKey`) and sets are left out, and no artist or work fills more than two places. It returns `{ close: [{ t, score, why }], work, together }`: `why` lists the reasons, most telling first, and the page shows two of them in words ("also from Oregairu · also bright"). The work's other songs come OP first.

**Journeys.** From any song (its menu, or the map icon in the now playing panel): pick the song to end on (search, Surprise me: one of the furthest 12%, or click it on the map) and how many songs (10 to 50, remembered); `E.journey` on the map's own vectors (`mapState.recipe`, the labels when the language model is not loaded) finds the way, and it plays in order as `Journey: A to B` (the context carries `journey`). On the map, a selected song has Journey from here: the start is ringed, a dashed line follows the pointer, and a click on another dot sets off. While a journey plays the map draws the whole route, Start to End, the steps already played faded.

**Versions and voice actors.** A song's versions share `S.songKey` (the folded title and the original artist): the track page lists them under Versions, the original first (no version and no other original artist), with Play every version and Another version; the now playing panel says how many there are and its menu puts another take on next and skips to it, the rest of the queue staying; the track menu has Other versions. Voice actors come out of the credits with `L.people` (`A (CV: X), B (CV: Y)`, `A & B (CV: X & Y)` paired in order, full-width brackets too): `#/people` lists everyone credited as a voice, `#/person/<key>` shows the characters they sing as (each song says which) and what they sing under their own name, the player and the track page link the voices, an artist page that is also a voice has As a voice actor, and Your numbers has Most versions and Voice actors.

**Channels and artists.** `#/channel/<id>` (channel.js, below) lists every upload of a YouTube channel, the ones new to you first, with the artist read from each title: from the Data API with a sign-in or an API key (2 quota units a hundred, as far back as asked), otherwise read through a visible YouTube player (its newest 200, free) with oEmbed titles. `#/channels` lists the channels your songs came from, the ones that upload other artists' music (curators) first; the home page and the now-playing panel lead to them. Below the uploads, as before: when the channel's songs here are mostly one artist's, their other songs and releases from Deezer (the same as an artist page's), and Sounds like this channel, the library's songs closest to the channel's own (`S.similar` from up to six of them, the channel's own left out), each with its reason.

**The map (#/map).** `embed.js` turns the tracks of the scope into vectors by one of `E.RECIPES`: Sound (the labels), Names (character trigrams of titles, artists and works, hashed), Taste timeline (labels and when each song was added), Blend, and Language model (multilingual MiniLM through transformers.js 4.3.1 from jsDelivr and the model from Hugging Face, about 120 MB, only after the reader asks; the vectors are kept, quantised, under `lm:vectors`). The page finds 15 neighbours each and lays the graph out in slices so it animates, then names k-means regions by their commonest genre or work. Colour by genre family, mood, scene or language (the eight validated categorical hues in a fixed order; the rest fold into Other) or by year and plays (one blue ramp). Drag, scroll or pinch, click a dot (play, play its neighbourhood), Shift-drag a box (shuffle, save as playlist); the legend fades categories; the regions are listed under the map as buttons for the keyboard. The queue's next tracks are drawn as a path.

**Discover (#/discover).** Songs that are not in the library yet. Since 2026-10-11 `#/discover?seed=<track>` goes to Explore and `?artist=<key>` to the artist's page, whose artist and similar lanes replaced Deezer's other songs and releases there. `discover.js` asks Deezer's public API (no key) for the seed artist, its related artists and their top songs. Deezer sends no CORS header, only JSONP, which runs the server's script; so `sandboxTransport()` runs it in a hidden iframe with `sandbox="allow-scripts"` and no same origin: the frame cannot read this page, its storage or the sign-in token, accepts only `https://api.deezer.com/` addresses, and posts plain JSON back, which the page checks (only Deezer's own picture and preview hosts are used) and shows as text. `createDeezer({ transport })` (`searchArtists`, `related`, `top`, cached), `findArtist(dz, names, titles)` (the artist whose top songs include a title the library has; with titles to check and none matching, another artist of the same name is refused), `suggest(dz, { names, titles, known, hidden, perArtist, artists })` (the related artists, the seed and hidden ones left out, those the library lacks first, each with its top songs), `norm`, `youtubeQuery`, `bestVideo(results, track)` (the Topic channel first, covers last), `API`. A preview plays 30 seconds in the page (the YouTube player pauses). Play, when signed in, runs one `client.search(query, { max })` (`SEARCH_UNITS`, 100 quota units; every other call costs one) and one `videoBatch`, adds the video to the local playlist `local:discovered` ("Discovered") with the artist and title as labels, and plays it; signed out, it opens a YouTube search in a new tab. **Add** puts the song at the end of one of the account's own YouTube playlists (`client.addToPlaylist`, 50 quota units, plus the search when the video is not known yet): the first time, a dialog explains and the page signs in again asking for `Y.WRITE_SCOPE` as well, keeping the add in sessionStorage (`toy.101-true-shuffle.pendingAdd`) and finishing it when Google sends the reader back. The song joins the library under that playlist; the toast's Undo takes it out again on YouTube (`removeFromPlaylist`). With several playlists a menu asks which (the last one used comes first; one the song is already in is greyed out). Add is on Discover's rows, the artist page's other songs, a channel's uploads, the YouTube search results, the preview bar, and, for a song in the library but not in a playlist (one played from Discover), the track menu and the track page. "Not interested" keeps an artist out (`discover:hidden`).

**Controls (third pass).** The shuffle order is a labelled pill in the player bar (O), in the queue under "Playing from", next to Shuffle everything on the home page, and every Shuffle button is split: the main part shuffles in the current order, the caret picks another; the order menu describes each order and toggles keeping works apart and one version per song. Under the video: S, M and L sizes, theater mode (T: a wide player, the sections as icons) and full screen (F); the panel's edge still drags. Volume and mute (M, - and =; `p.volume(0..100)` and `p.muted(bool)` on both players, remembered); a heart likes a song (rating 5; L), and #/liked lists what is rated 4 or more (`minRating` in the plan). Ctrl+K opens a palette over pages, actions, playlists, artists, works, genres, moods, scenes, years and songs; ? lists the keys. Blocking, removing from a playlist, clearing the queue and liking can be undone from the toast. Long pages keep a compact header with Play. Song lists can be compact (Settings).

**Playing, queueing and the buttons (2026-10-10).** Play on one song (a menu, the track page, a history row, the palette, the map, a version, a found song) plays it now and keeps the queue: `playNow(ids)` puts it right after the song that was on, which joins Played, and what was coming follows (`ctl.playNow`, the reducer's `playNow`); a song that was queued already moves up instead of playing twice. Play in a list plays the list from there (`playFrom(ids, index, ctx)`, once called `playIds`, a name the test hook keeps). Songs queued by hand (Play next, Add to queue, dragged onto the queue) play before the rest of what is coming, in the order given (`insert`), and survive a new list: they are kept under the store key `queue:hand`. On a wide window Q and the Queue button fold the queue to one line under the player (`body.queue-hidden`, remembered as `queueHidden`); the panel itself stays, since the player must. The bar's title opens the song's page (on a phone, the sheet). The bar's More (`#btn-bar-more`) holds the sleep timer (a dot on it while one runs), theater mode, full screen, Edit details, Repeat and Shuffle again; from 761 to 1100 px wide, Repeat and Shuffle again are only there, so the bar never overflows. The heart likes a song (four stars or more is liked); liking a song rated under four remembers that rating (`rating:beforeLike`), and taking the like back restores it, else leaves three stars. Every button is one component (ui.js `btn`, styled in ds.css): pills, round icon buttons, one blue for every play, at most three actions and More in a page's header, a cost shown as a badge. Labels, icons and keys come from actions.js; the track menu is grouped (Play, Find more, Keep, Go to, Fix) and Rating opens its own small menu. A new page puts the focus on its title; a redraw keeps the focus on the same row; the phone's sheet is a dialog (the rest of the page inert, never the video). The sheet covers the bar, so it carries its own transport under the song (`#st-seek`, `#st-prev`, `#st-toggle` at 72 px, `#st-next`; `renderTransport` and `renderTime` fill both); the mini player's line only shows the time, and a tap anywhere on its picture, title or artist opens the sheet. On a touch screen small controls keep their look but get a hit area of about 44 px (ds.css), and a tap on a song row plays it: the artist under the title is not a link there (the row's menu has Go to). Work in progress shows as a chip above the bar (ui.js `job`), not only to screen readers.

**Media keys and car buttons.** A browser sends the keyboard's media keys, a phone's lock-screen buttons and a car's steering-wheel buttons (Bluetooth AVRCP) only to a frame that plays something itself (Chromium's `MediaSessionImpl::ComputeFrameForRouting`, read on 2026-10-10). The only player was YouTube's cross-origin iframe, so next and previous never reached the page. transport.js adds an anchor: a looping, unmuted `<audio>` of digital silence, built in memory, that plays while YouTube's player plays and pauses with it; the page then owns the Media Session (title, artist, the work or the playlist as album, artwork, position) and its play, pause, next, previous and seek handlers. On a phone it pauses the moment the page is hidden and ignores everything but pause while hidden. Settings > Playback switches it (`mediaKeys`) and lists the last twenty buttons received, for trying it: the PC's media keys or the Windows media overlay, or a car's steering wheel.

**Found songs play like library songs (2026-10-10, Phase 2).** A song from Discover, an artist's other songs, a channel's uploads, the YouTube search or Saved for later is a find (sources.js). It plays now, plays next or goes to the queue like a library song, and what was coming stays. Its row has Preview (when there is one), Save for later, Play and More (Play next, Add to queue, Add to YouTube playlist, Not interested, Open on YouTube).

- **Finding the video.** engine.js finds the song's YouTube video the cheapest way first (finds.js's resolver), and the Play button shows a cost badge when that will take a YouTube search (100 units). Without a key or a sign-in, such a song opens a YouTube search in a new tab, as before.
- **Light tracks.** A find is not added to the library: it plays as a light track (`transient`) that the bar, the queue and the now-playing panel show like any other.
- **Keeping a find.** It joins the library, in the playlist Discovered, when it is liked or kept, or after it has been finished twice.
- **Saved for later** has Play all.
- **Feeders.** A list of finds, or a radio, plays through a feeder (feeder.js), which looks songs up a few ahead. The queue shows the ones still being found ("Finding...", "Coming up"), and the line under the queue says what the radio does.
- **Endless** (on by default; the bar's More switches it, and it is remembered as `endless`). When the queue runs out, a radio from the last song carries on instead of "That was the last track". Start radio is the same endless radio. About half its songs (`newRatio`, 0.5) are new, from free sources only (app.js `radioProviders`, feeder.js providers), never a search: the seed song's YouTube Mix, read on the player between two songs (`mixAtBoundary`: the next song waits up to 6 s for the ids, then their titles come from oEmbed; kept 2 days); the seed's channel's other uploads; and the seed artist's Topic channel, their songs as YouTube Music has them (each list 1 unit for 50 with a sign-in or a key, kept 6 hours, and none once the day's automatic allowance is spent). The demo's radios take their new songs from channel.js's invented uploads.
- **The bar's More** also says how much of today's YouTube allowance is used: a song search costs 100 units, and 1,500 are kept for imports and adds.

**Playback extras (2026-10-10).**
- **Trim and volume.** A song's menu (and the bar's More, for the song that is on) has Trim and volume: start later, end sooner, louder or softer, for that song only. It is kept under the store key `songprefs` as `{ id: { start, end, vol } }`. `load` starts at `start`; the time event moves on at `end`; `vol` (50 to 150%) scales the base volume.
- **Fades** (Settings > Playback, on by default, `fades`). The last three seconds of a song soften and the first one and a half come in gently. This is done with the player's volume, so the volume slider keeps showing the base volume.
- **Speed.** The bar's More sets the playback speed (0.75 to 1.5x; the player's `rate`). A badge by the time says when the speed is not normal; it lasts for the session.
- **Ambient glow** (Settings > Appearance, `ambient`). The song's thumbnail, blurred, glows behind the video, never over it; not on phones.
- **History as CSV.** Settings > Backup saves the listening history as a CSV file.

**When you added them (#/c/added/<year or year-month>).** `S.firstAdded(track)` is when a track first came into the library (its earliest playlist addition) and `S.addedKeys(track)` its year and month as keys (`['2021', '2021-05']`, UTC). `select` takes `added` (those keys) and `addedFrom`, `addedTo` (ISO days, both included); the plan carries them, so smart playlists and Focus can be "added in 2021" or "added between March and June 2025". Browse shows a tile per year and a column per month (each opens that month); a year or month page has Play, Shuffle, Focus and Save as playlist, and chips for its months and the years around it. The mix builder has year and month rows and a date range; the playlists page suggests one per year with 40 songs or more; the home page shows songs added around this time in earlier years; Your numbers has songs added per year.

**For you (#/for-you, 2026-10-11).** It replaced the Discover hub: `#/discover` goes there (foryou.js, below: Your radio, this season's anime, airing today, the songs missing from your series, new releases from your artists, new uploads from your channels, Because you play X, Saved for later and Hidden). The old keys `discover:saved`, `discover:hidden` and `discover:ids` are moved into the engine's (`finds:saved`, `finds:hidden`, `finds:map`) by recs.js `migrateStore` when the engine starts. `#/discover?dz=<id>` is any artist on Deezer: top songs, releases (a release opens its tracks), related artists to follow, an artist mix. The preview radio plays 30-second previews one after another in a bar above the player, with save, play on YouTube and not interested. `createDeezer` also has `artist`, `albums` (newest first, through `albumOf`), `albumTracks`, `radio`, `searchPlaylists` and `playlistTracks`; `trackOf` carries `artistId`; `img` keeps only Deezer's image hosts. Requests leave at least 125 ms apart and a "quota exceeded" answer (Deezer allows 50 requests in 5 seconds) waits and tries again; the Deezer ids of library artists are kept (`discover:ids`), as are recent seeds (`discover:recent`).

**Moods & scenes (#/browse).** A mix-and-match panel combines moods, scenes, languages, genre families, eras and years added (alternatives within a row, rows narrowing each other; every choice shows how many songs it would give with the others), keeps the choice in the address, and offers Play, Shuffle, Focus and Save as playlist with the list below. A grid of moods against scenes, genre families, languages, years added or eras links every cell to that combination. Mood and scene pages show how to split them further.

**History (#/history), the quick labeller (#/label), small things.** History keeps every listen in the store and shows On repeat, plays per month and the days, grouped by the listener's local calendar. The labeller walks the unlabelled songs (or a selection) one at a time with suggestions from the channel, the artist and similar titles; 1 to 6 set the mood, Enter saves, the arrows move. Work pages filter by role (openings, endings...). The player bar has repeat and a sleep timer.

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

## fuzzy.js

`TS.fuzzy`: search that forgives. Library search (`L.search`) finds the words as they are typed, case and accents aside. Most of this library is anime, game and visual-novel music, so a listener types romaji for a kana title, writes long vowels or leaves them out, mistypes a name, or is halfway through a word. fuzzy.js finds those, and the page shows them after the exact results. It reads match.js (`fold`, `romaji`, `loose`) and has no kana table of its own. Nothing leaves the browser and nothing is stored: the index lives in memory and is built again after a library change.

```js
var F = TS.fuzzy;
var ix = F.index(tracks);                         // a list or { id: track }
F.search(ix, 'kalafna hikari', { not, limit })    // -> [{ id, score, how }], best first
F.rankNames(['Aimer', 'Kalafina'], 'aimr')        // -> [{ i: 0, score, how: 'typo' }]
```

**Words.** `index(tracks)` reads `title` and `titleAlt` (the title), `artist` and `artistNative` (the artist), and `work`, `album` and `feat` (the rest). A field is split at everything but letters and digits, and between Japanese and other letters ("himawariGood" is two words). Each word is kept folded, kana read as Hepburn romaji. A kana word, or one that can be read as romaji (`romajiLike(word)`: syllables of a consonant and a vowel, the syllabic n, a doubled consonant, an h after a vowel), is also kept loosely (match.js `loose`: tokyo, toukyou and tohkyoh are one). Only such words are compared loosely, so "four" never meets "for", nor "good" "god". Kanji are never romanised: a kanji title is found through its `titleAlt`, and the kana inside a word with kanji are kept as readings of their own. One kana alone (the particle in "Vtuber no") stays in the title but is not a word to find. `nameIndex(names)` indexes plain names the same way, each a title whose id is its place in the list.

**Matching.** Every term of the query must meet a word of the track. A term scores the best of:

| Kind | Points | When |
| --- | --- | --- |
| exact | 50 | the word, or a kana word's romaji reading |
| start of a word | 40 | the last term only (it is still being typed): 3 letters or more, 2 after another term |
| inside a word | 30 | 3 letters or more, as library search does; 4 inside a kana reading (a kana title is one long word) |
| loose | 20 | both romaji-like: the same loose spelling (3 letters or more), its start (the last term, even half a syllable: "touky"), or inside a kana reading |
| typo | 10; 7 for two | Damerau-Levenshtein, `distance(a, b, max)` (a swap is one edit; max + 1 once it is further). `allowed(n)` typos for n letters: none under 4, 1 for 4 to 7, 2 from 8. The word has 4 letters or more and the same first letter (or the first two swapped). Only for a term that met nothing else: a word that exists was meant. |

A title or an artist adds 5, so a kind always beats the kinds below it, and within a kind the title and the artist beat the rest. A track scores the sum of its terms. The whole query, spaces taken out, also meets whole titles ("kiminoshiranai"; "kimi no shiranai" for a kana title): equal, its start (4 letters or more), loosely, or with typos when some term met nothing. That scores (points + 5) times the number of terms, plus 2, when it is better, so a title equal to the query comes first. Terms of one letter only meet equal words, and two letters neither a start nor a typo on their own, so "a" and "no" find nothing library search does not. Ties go by artist and title. `opts.not` (a list of ids or `{ id: true }`) leaves tracks out; `opts.limit` cuts the list.

`how` is the kind of the weakest term: `exact`, `prefix`, `romaji` (a kana reading), `loose`, `typo`, or `joined` (only the whole title met it). `HOW` has the words the page shows for each: "start of a word", "romaji reading", "another spelling", "close spelling", "spaced differently" (nothing for `exact`).

**Speed (Node 24).** 10,000 invented tracks: the index in about 110 ms the first time and 40 ms after (the word forms are remembered, 50,000 at most), a query in under 10 ms. The 1,855 tracks of labels.json: about 25 ms, then 5 ms.

**The page.** `closeMatches(ctx, query, found)`, found being the search page's `{ songs, artists, works, chips }` (chips: how many genres, moods and scenes matched), indexes `ctx.idx().all` (the focused playlist's songs, or all) the first time it is needed after app.js's index was rebuilt. It returns `{ query, songs, how: { id: how }, artists, works, exact, alone }`: up to 50 songs the exact search did not find, and up to 6 artists, and works, when the exact search found none (the page adds them to its own). `section(view, ctx, close)` draws "Close matches (n)" after the exact songs, with Play these; when the rows come close in different ways, each says how ("close spelling", "romaji reading"). When the close songs are all the page has (`alone`), the section takes the place of "Nothing found" and says "Nothing matches "x" exactly. These come close." `paletteSongs(ctx, query, out)`: when the palette's exact search finds fewer than 3 songs, close ones fill up to 8, after the exact songs and the artists and works the palette found itself, before genres and moods. The CSS is `<style id="ts-fuzzy-css">`.

**Tests.** The `fuzzy` section (test/fuzzy.section.js, 104 checks): distance and allowed, romajiLike, invented tracks shaped like the library's (romaji for kana titles, loose vowels, typos at 3, 4, 7 and 8 letters, the start of a word still being typed, several terms, kanji titles through titleAlt, no hits for "a", "no" and junk, the order of kinds and fields, not and limit, how), rankNames, the page calls on a fake ctx, and the shipped labels.json (read only: every kana title by its reading, every kanji title by its titleAlt and with a typo, artists with a letter missing, real cases such as "koi no sirusi", "toukyou jihen", "uchujin", "konekuto"); then the speed on 10,000 generated tracks.

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
| group | an album's own YouTube list (`resolveGroup`): one playlist search, a YouTube Music album (`OLAK5uy_`) with the album's title first, read 50 at a time, its songs matched through the pool | 101 for the whole album | a press on an album's Play all or Shuffle, from `GROUP_MIN` (4) songs that need finding |
| search | one YouTube search, match.js `bestVideo` with its minimum | 101 | `allow: 'search'` (a press on Play), within today's allowance less the reserve |

- **`deps`**: `{ M (match.js), cache, index(), lists: { uploads(channelId, { max }), playlist(listId, { max }) }, canList(), search(q, { max }), searchPlaylists(q, { max }), canSearch(), budget: { left(), autoLeft(), spend(units, auto) }, topicChannels(), now }`.
- **Calls**:
  - `prepare(finds)` reads the cache once.
  - `estimate(finds)` is synchronous: `{ perFind: { key: { rung, units, status } }, ready, cheap, search, blocked, units }`. The status is `ready`, `cheap`, `search`, `needs-key`, `over-budget` or `not-found`.
  - `resolve(find, { allow })` returns `{ videoId, rung, units, video }`, or `{ none, rung, reason }`, where the reason is `needs-search`, `needs-key`, `over-budget` or `not-found`.
  - `resolveGroup(finds, { query, title })` returns `{ resolved, units, list, reason }`: the group rung above; the reason is `few`, `needs-key`, `over-budget` or `no-list` when it did nothing. Afterwards each matched song resolves free (the cache rung).
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
| `hide(kind, value)` | Returns `undo()`. `kind` is `artist`, `song`, `work` or `channel`. Also `unhide(kind, value)` (For you's Hidden: show it again), `isHidden(find)` and `hidden()`. |
| `estimate(finds)`, `resolve(find, { allow })` | What playing would take; finding an id. |
| `resolveGroup(finds, { query, title })` | An album's own YouTube list looked up once (the resolver's group rung), before its songs are played. |
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
| `link(ids, title, base, start)` | `base#/share?ids=a.b.c&at=b&s=151&t=Title`: each valid video id once, at most `MAX` (100); `start` (`{ id, sec }`, optional) is the song to start at and the second (whole seconds; under one is the beginning), left out when the song is not in the list; a title of at most 120 characters, never cut inside a character. |
| `decode(query)` | `{ ids, title, start }` from the address's query. Anything that is not a video id is dropped. `start` is `{ id, index, sec }`; null for a link without one (every older link), a start song that is not among the songs, or seconds that are not a whole number. Seconds without a song are the first song's. |
| `videoIdOf(text)` | The id in a YouTube address (watch, youtu.be, shorts, embed, live) or a bare id; otherwise `''`. |
| `parseList(text)` | One song a line: `{ videoId }` for a link, otherwise `{ artist, title }` from "Artist - Title" (any dash), "Title / Artist" or "Title by Artist". Numbering and bullets are dropped. |
| `titles(ids)` | oEmbed for each id, four at a time: `{ id: { title, channel } \| null }`. Null is a video that is gone or cannot be played on other sites (401). |
| `startIn(decoded, playableIds)` | Where Play from starts among the songs that can play: `{ k, sec, exact }` (`k` in `playableIds`), the start song; when it is gone the next one that is not, from its beginning (`exact` false); null without a start or with none left. |
| `seekOnPlay(player, id, sec)` | Go to `sec` once `id` plays (the controller has no start offset, so it is a seek on the player's first `playing` for that song); other songs playing first are ignored, and it gives up after a minute. Returns `stop()`. |
| `view(view, ctx, parts, query)` | The pages `#/share` and `#/paste`. |
| `configure({ fetch })` | The tests' fetch. |

- **Where it is:** the bar's More has "Share the queue as a link" (the playing song and what comes after it). The palette has that and "Paste a list of songs".
- **What it costs:** a shared song has its id, so it plays free. A pasted line without a link goes through the resolver: a search (100 units) unless the library or an earlier search has it. Play all looks songs up as it goes, at most 10 searches a press.
- **Continue listening:** a link with a start (handoff.js makes them) opens with the kicker Continue listening, the start song and one big Play from 2:31 in place of Play all, busy until the titles are in. It plays the songs from there through the engine, as Play all does, and seeks to the second once the song plays. When the start song is gone it starts at the next one from its beginning, and says so. Nothing plays before the tap. In the demo the rows and the start song show no thumbnails.
- **Privacy:** the requests carry no cookies and no referrer.

## duel.js

`TS.duel`: rank your songs two at a time (`#/duel`, "Rank your songs" in the sections, the Library hub and the palette). Stars drive Favourites and Liked songs, but rating thousands of songs on a scale of five is tiring and drifts; a duel asks one easy question instead, "Which do you like more?". The model is pure and runs in Node; the drawing uses only `pageCtx`.

**The model: Glicko, one duel at a time.** Each song keeps a score `r` and how unsure it is, `rd` (Glickman's Glicko-1, each duel its own rating period). A pick moves both songs by how surprising it was (more for an unsure song, less against an unsure partner) and makes both surer. It was chosen over Bradley-Terry fitted to all duels because it keeps no list of past duels and needs no refit: a few numbers per song, the same work for 100 songs or 10,000. Its uncertainty is also what the pair choice, the confidence shown and the stars need. The cost: the order of duels matters a little, and a score does not grow unsure again with time (a taste that changed needs new duels). A song starts at `R0` (1500) moved by its stars (one to five: -150, -75, 0, +75, +150), with `rd` at `RD0` (350), never below `RD_MIN` (45). About four duels bring `rd` to `FAIR_RD` (200, "Fairly sure"), about ten to `SURE_RD` (120, "Sure").

| Name | What it is |
| --- | --- |
| `empty()` | A book with no duels, `{ n: 0, s: {}, p: [] }`. A book is `{ n: turns, s: { id: { r, rd, n: duels, w: won, t: the turn it was last shown } }, p: the pairs shown lately, the last one last }`. |
| `update(me, other, score)` | One Glicko step for `me` (`{ r, rd }`) after a duel with `other`: `score` 1 when me was picked, 0 when other was. `-> { r, rd }` |
| `record(book, winner, loser, { starsOf })` | `winner` was liked more. Returns a new book; the one given is never changed, so the book before a pick is its undo. One more turn, both songs updated and shown this turn, the pair remembered (`PAIR_MEMORY`, the last 200 pairs). `starsOf(id)` gives a new song's stars. |
| `skip(book, a, b, { starsOf })` | A pair that cannot be judged: no score moves and nothing counts as a duel, but both songs and the pair rest as after one. |
| `pickPair(book, ids, rand, { starsOf, keyOf, sample })` | The next two songs of `ids` as `[left, right]`, or null with fewer than two. The first is the song with most to learn: the most unsure, not shown in the last three turns. The second is the partner that teaches most about it: a close score (a toss-up says the most), unsure too, not met in the last 200 pairs, never another upload of the same song (`keyOf`, shuffle.js `songKey`) unless nothing else is left. Each choice weighs `sample` (60) songs drawn at random, so a library of 5,000 costs what one of 60 does (300 duels in about 0.2 s in Node). `rand` is shuffle.js `rng` (seeded, in the tests) or `cryptoRng` (the page); it also decides which side each song goes on. |
| `ranking(book, ids)` | The songs of `ids` that had a duel, best first (of equal scores the surer first): `[{ id, r, rd, n, w, sure }]`, `sure` being `'sure'`, `'fair'` or `'unsure'`. |
| `starsPlan(rows, { ratingOf, all })` | What Set stars would do with `ranking` rows. The songs fairly sure or better get stars by their place among themselves (`SHARES`: the top 10% five, the next 20% four, the middle 40% three, the next 20% two, the last 10% one); only unrated songs change unless `all`. `-> { ok (at least MIN_RANKED, 10, such songs), ranked, unsure, changes: [{ id, from, to }], counts (the changes by new stars), kept (rated songs left alone), same (already right) }` |
| `pool(tracks, scope)` | The ids a duel may ask about, from a list or a map of tracks: playable, not blocked, not a clip, not a found song; then the scope: `'all'`, `'liked'` (four stars or more), `'unrated'`, `'work:<name>'` or `'genre:<name>'`. |
| `pack(book)`, `unpack(value)` | The book as the store keeps it, `{ v: 1, n, s: { id: [r, rd, duels, won, turn] }, p }`, scores to a tenth (30 songs take about 1.7 KB), and back. A damaged entry is left out; anything that is not a book gives `empty()`. |
| `view(view, ctx, parts, query)` | `#/duel` and `#/duel/ranking`. |
| `KEY`, `R0`, `RD0`, `RD_MIN`, `SURE_RD`, `FAIR_RD`, `SHARES`, `MIN_RANKED`, `PAIR_MEMORY` | `'duel:scores'`, 1500, 350, 45, 120, 200, the star shares, 10, 200. |

**The page (#/duel).** Two tabs, Duel and Your ranking. A row of chips picks the songs: All songs, Liked, Unrated, Anime or work... and Genre... (a dialog listing library.js `facets` of two songs or more over the songs a duel may ask about, with a filter). The choice is remembered as ToyKit `duelScope`; Focus narrows it as it narrows every view (the page reads `ctx.idx().all`). Two songs side by side, or stacked as rows on a phone: cover art, title, artist, the work and role when known, plays and stars; the whole card is the button.
- **Picking.** A click or a tap, 1 or Left, 2 or Right. S skips; Backspace (or Undo) goes back one step, twenty at most this visit.
- **Hear it** plays that song now and keeps the queue (`ctx.play.now`); the YouTube player stays where it is.
- **Below the pair:** the last pick in words, and "12 duels this session · 340 songs ranked" (with how many of the set are ranked when it is not all songs).
- **Keys** are taken in the capture phase, before app.js's own (elsewhere S shuffles again and the arrows seek). The arrows and Backspace only while the focus is on this page; digits and S anywhere but a text field or a dialog. A held key does not repeat, and a click within 150 ms of a new pair counts as a double click, not a choice.
- **States:** no library (a link to Settings), a set of fewer than two songs, a work or genre that is gone (back to all songs), loading.

**Your ranking (#/duel/ranking).** The set's songs by score, numbered, each with Sure, Fairly sure or Not sure yet, its duels and wins, and its stars; a hundred rows, then Show all. Play from the top plays them in that order. Set stars from the ranking... opens a dialog: the shares; how many songs would get 5, 4, 3, 2 and 1 stars; how many join or leave Liked songs; how many rated songs keep their stars and how many need more duels. A box also changes songs that already have stars. Set stars applies it with `ctx.edit` (one edit per number of stars; `edit` stamps `stateAt`, so the Desk's sync carries the new ratings), and the toast's Undo puts every song back.

**What is kept.** The store's kv `duel:scores` (`pack`), written 0.4 s after the last pick and when the page is left. `exportAll` carries it in the backup file and `importAll` brings it back; the Desk's sync does not, only the stars set from it. A restored backup or Delete everything brings a new library object, and the page reads the book again. ToyKit: `duelScope`. Nothing is sent anywhere, in the demo or out of it.

**Tests.** The `duel` section (test/duel.section.js, 58 checks):
- `update` against Glicko's formula written out again (equals, a sure song losing to an unsure one, an upset, the floor);
- `record` and `skip` on frozen books, the start from stars, the 200 remembered pairs;
- `pickPair` on seeded runs: the same seed gives the same pairs; 150 picks among 30 songs ask no pair twice and bring no song straight back; three songs never give the same pair twice in a row; the sides are drawn; never two uploads of one song unless nothing else is left; unsure songs first; partners at least four times closer than random ones; 300 duels over 5,000 songs;
- convergence on a hidden order, 40 songs: 160 duels with right answers reach a rank correlation of at least 0.95; 240 with Bradley-Terry noise at least 0.85, above random pairs; every song fairly sure after four duels each;
- `ranking`, `starsPlan` (10 and 100 songs, too few, only unrated, `all`, the counts) and `pool`'s scopes;
- `pack` and `unpack` (a round trip, damaged entries, `__proto__`), and the kv through store.js's in-memory twin, its export and its import.

**Checked in a browser** (2026-10-11, `scripts/qa/drive.mjs` on `?demo=1`, the script in the session's scratchpad):
- picks by 1, the right arrow, a click on either card and a tap on a phone, each saved in `duel:scores` with the right winner;
- the arrows picking while a song plays, without seeking it; S skipping without shuffling the queue again;
- Backspace and Undo going back one step at a time, to the pair each pick was made on; a press the moment a pair shows is dropped;
- Hear it playing the song now on the same page, the player visible at 316 by 210;
- the work picker (a filter, Kumori Station Anime, 10 songs), then 34 duels by a hidden taste: the ranking follows it (rank correlation 1.0 and 0.99 in two runs), all ten fairly sure;
- the stars dialog (8 unrated songs by default, 10 with the box), applying 5, 4, 4, 3, 3, 3, 3, 2, 2, 1 by place, and Undo restoring every rating;
- the Library hub's link; both themes at 1280 by 860 and 390 by 844 without sideways scroll, no key hints on a touch screen, no page errors, no request to any other site.

**Not done.** A score does not grow unsure again with time, so an old ranking is trusted as much as a new one. Two tabs on one book: the last write wins.

## habits.js

`TS.habits`: listening habits, from the play history. The listening clock on Your numbers (`#/stats`), the home page's Usually at this hour, and Skip the intro, learned. The counting is pure and runs in Node; the drawing uses only `pageCtx`.

```js
var Hb = TS.habits;
Hb.clock(history, tracks, now, { local, offset, days })   // -> { cells, max, minutes, listens, peak, from, days }
Hb.clockText(clock)                                       // -> 'You listen most on Friday evenings, 9 to 10 pm.'
Hb.streaks(history, tracks, now, { local, offset })       // -> { current, currentFrom, today, longest, longestFrom, longestTo, days }
Hb.weeks(history, tracks, now, { local, offset, n })      // -> [{ from, minutes, current }]
Hb.thisHour(history, tracks, now, { local, offset, days, span, min, least, n })   // -> [{ id, plays, last }]
Hb.momentText(now, { local, offset })                     // -> 'weekday evenings'
Hb.seekDetector(opts)                                     // -> { feed(e), reset() }
Hb.addSeek(list, seek, now)                               // -> the kept seeks, with one more
Hb.introOffer(id, seeks, history, { now, tol })           // -> { start, seeks } | null
Hb.statsSection(view, ctx)    Hb.homeLane(view, ctx)      // the page's parts, called from app.js
Hb.watch(ctx, { demo })                                   // -> { stop }: Skip the intro, for the page's life
```

`history` is the store's listens, as wrapped.js reads them; `tracks` is `{ id: track }` or a list (null counts every listen; `thisHour` needs them, to leave out what cannot play). Times are UTC unless `local: true` (the page passes it) or `offset`: minutes east of UTC, a number, or a function of the moment for a zone whose clocks change.

**clock** adds up the minutes heard (plays and skips, `listenedSec`) by weekday, Monday first, and hour, over the last `days` (365). A listen began `listenedSec` before its `at`, and it is cut at the hour boundaries of the zone it was heard in: on the night the clocks go back, 1 am comes twice and both count as 1 am; going forward, 2 am gets nothing. `cells[day][hour]` are minutes to a tenth, `peak` (`{ day, hour, minutes }`) is the busiest hour (the first of equals), `from` the first listen counted, `listens` how many. A `listenedSec` over 12 hours is cut to 12 hours. **clockText** says it: "You listen most on Friday evenings, 9 to 10 pm." Mornings start at 5 am, afternoons at noon, evenings at 5 pm, nights at 11 pm, and the small hours belong to the night before (1 am on a Saturday is "Friday nights"). Under ten listens it is `''`.

**streaks** counts days with a play (not a skip), as Your year does. `current` ends today, or yesterday when today has no play yet (`today` says which); `longest` is the first of the longest runs; days are `'YYYY-MM-DD'` in the zone. **weeks** gives the minutes of the last `n` (12) weeks, each from its Monday (`from`), the current week last (`current`).

**thisHour** is Usually at this hour: the songs played (not skipped) within `span` (60) minutes of now's time of day, either side and across midnight, on the same kind of day (Monday to Friday, or the weekend), in the last `days` (120). A play counts where it began. Each song needs `min` (2) plays, and with fewer than `least` (3) such songs it returns `[]`. Blocked and unplayable songs and clips are left out; most played first, then the latest; `n` (12) at most. **momentText** names the moment: `'weekday evenings'`, `'weekend mornings'`.

**Skip the intro, learned.** `seekDetector()` is fed the player's time events as `{ id, current, at, rate, playingFrom }`: `at` is the wall clock, `playingFrom` since when the player has played without a stop (0 while it does not). A seek is a jump the clock cannot explain: more than 2.5 s beyond what playing since the last event covers, or any step back. A forward seek from under 15 s that lands between 10 s and 120 s is kept; seeks made in a row (within 3 s) move where it lands, as the arrow keys go 5 s at a time. `feed` returns `{ id, from, to, at }` once playback has gone on for 1.5 s; a new song or `reset()` forgets it. A seek while paused counts, and so does one seen only after playing again (YouTube reads no time while paused). `addSeek` keeps the seeks as `{ id, to, at }`, a year at most, the newest 300. `introOffer` reads the song's last three listens in the history (a skip is a listen here) and the last seek made while each played; two that land within `tol` (8) seconds of each other offer the earlier one, in whole seconds.

**watch** runs from app.js `start` for the page's life. It hears the player's `state`, `time` and `ended` events (`ctx.player()`), and for every seek past the intro of a library song with no start of its own it keeps the seek and asks `introOffer`. The offer is a small prompt where the toasts are, never over the player; it is not a dialog and takes no focus: "You skip to 0:42 in this song. Start it there from now on?", with Start at 0:42 and No. Start at 0:42 sets the song's start in Trim and volume (`songprefs`, through `ctx.songPref(id, value)`; its end and volume are kept), with Undo in a toast. No is remembered. Each song is asked once: unanswered, the prompt goes after 15 s (it waits while the pointer or the focus is on it; Escape closes it). It never asks in car mode (car.js `active()`), for a song that has a start, in the thumbnail, or in the demo, unless `watch(ctx, { demo: true })` (the drive check calls that).

**The page.** Your numbers shows When you listen after its tiles (`statsSection`): the sentence; By day and hour, a 7 by 24 grid of squares in the bar hue, four steps on a square-root scale so a quiet hour still shows, the busiest ringed, a line that reads out the square under the pointer or the finger, `role="img"` with the sentence, and the minutes by day and quarter of the day as a table for screen readers; two tiles, the days in a row now and the longest streak; Minutes per week, twelve columns, this week hatched (so far), the highest labelled, with its own table. Without a listen it says what will fill it. Home shows Usually at this hour before On this day (`homeLane`), with Play all (`ctx.play.from`, as "Usually at this hour") and a line naming the moment it read ("What you play most on weekday evenings around this time, from the last four months"). Both count from the index's tracks, so Focus narrows them. The CSS is one injected `<style id="ts-habits-css">` on the app's tokens.

**What is kept.** The store's kv: `habits:seeks` (`[{ id, to, at }]`) and `habits:asked` (`{ id: { at, answer } }`, the answer `'yes'`, `'no'`, or `''` when the offer went unanswered). Nothing leaves the browser.

**The hooks in app.js.** `pageCtx.songPref(id, value)` reads a song's trim and, given a value, sets it (null clears it; `songprefs` is saved and the volume applied); `viewHome` calls `homeLane` before wrapped.js's lanes; `viewStats` calls `statsSection` after its tiles; `start` calls `watch(pageCtx)`.

**In the demo** there is no history until something is played (the demo keeps none), so When you listen says what will fill it and Usually at this hour stays away. The drive check pushes an invented history into `ctx.history()`, as wrapped.js's does.

**Tests.** The `habits` section (test/habits.section.js, 71 checks): the clock's cells (an hour boundary, Sunday into Monday, skips, unknown songs, after now, a year back), a fixed offset, both 2026 changes of US Central time (1 am twice in November, no 2 am in March), the local clock against Date; clockText's parts of the day and the night before; streaks (today, yesterday, broken, ties, an offset, four plays on three days around the change); weeks (Monday first, over Sunday midnight, an offset, after the change); thisHour (the hour either side, across midnight, weekdays and the weekend, 120 days, min, least, n, where a play began, an offset); momentText; the seek detector fed sequences of time events (a seek, playing along, the rate, arrow keys in a row, from too late, landing too early or too late, a step back, another song, a seek while paused, one seen after a pause, a throttled tab, reset, odd events); addSeek; introOffer (two of three, 8 s and 9 s apart, one, three, the play going on, an older play, the last seek in a play, another song, now, tol); 5,000 listens.

## handoff.js

`TS.handoff`: Continue on your phone. The owner listens on the computer and picks up the phone to leave the house; the computer shows a QR code, and the phone's camera opens this page at the same queue, the same song and the same second. The code is drawn in the page from the link: nothing is sent anywhere, and the link carries only video ids, the queue's name and the second.

| Name | What it is |
| --- | --- |
| `plan({ items, index, sec, title, base, songs, budget })` | The link for the phone, from the queue (`items` and `index`, the controller's state) and the second the song is at: share.js `link` with the song that is on as the start, then up to `MAX_SONGS` (24) of what comes after it, each once; anything that is not a YouTube video is left out. A link longer than `budget` bytes (by default what a version `MAX_VERSION` code holds at level M: 412) drops the title, then songs from the end. Returns `{ url, at, sec, songs, cut }` (`cut`: the songs left out), or null when nothing is on or the song that is on is not a YouTube video (the demo's). |
| `qr(text, { level, maxVersion })` | A QR code of the text (ISO/IEC 18004, byte mode, UTF-8): the smallest version at level M, or at L when M does not fit within `maxVersion` (40); `level: 'M'` or `'L'` asks for one. The mask is the one with the lowest penalty. Returns `{ version, level, mask, size, rows, dark(x, y) }` (`rows[y][x]` is true for a dark module; `dark` is false outside the code), or null when the text is too long. |
| `svg(code, { scale, margin })` | The code as an SVG string: black modules on a white square whatever the theme, a quiet zone of `margin` modules (4), `scale` px a module (4). |
| `pixels(modules, dpr)` | The width to show it at, in CSS pixels: at least 240, with a whole number of screen pixels (at least two) to a module, since even modules read best off a screen and a bigger code reads more easily (303 px for a full link at a device pixel ratio of 1, 252 at 1.25). |
| `open(ctx)` | The dialog, below. `ctx` is app.js's `pageCtx`; it uses `ctl()`, `player()`, `trackOf`, `words`, `queueLabel()`, `say`, `U`, `h` and `demo`. |
| `ecc(data, n)` | The `n` Reed-Solomon codewords of a block (GF(256) on x^8 + x^4 + x^3 + x^2 + 1). |
| `formatBits(level, mask)`, `versionBits(version)` | The 15-bit format information and the 18-bit version information (BCH codes). |
| `capacity(version, level)` | The bytes a code holds in byte mode at level L or M. |
| `penalty(rows)` | The standard's four mask penalties, summed: runs of five or more, 2x2 blocks of one colour, 1:1:3:1:1 runs with four light modules on a side, the dark share in steps of 5%. |
| `MAX_SONGS`, `MAX_VERSION` | 24 and 15 (77 modules a side): a denser code is hard for a phone camera to read off a screen. |

- **Where it is:** the bar's More has Continue on your phone while a song is on, and so does the palette (Ctrl+K). No sign-in, no network.
- **The dialog:** the code (240 to 320 px, on white, with its quiet zone), "Point the phone's camera at the code. It opens this queue at "Song", 2:31.", the link in a read-only box with Copy link, and, when the queue is longer than the code holds, "The code holds this song and the next 40 in the queue; the other 23 are left out." The second is read from the player when the dialog opens, so opening it again gives the new one; the computer keeps playing. The focus starts on Copy link; like every dialog it keeps off the player. In the demo it says that the invented songs cannot move to a phone.
- **On the phone:** the link opens `#/share` as Continue listening, with the start song and a big Play from 2:31 (share.js above). Nothing plays before that tap: browsers refuse sound without one.
- **Checked:** test/handoff.section.js checks the Reed-Solomon codewords against thonky.com's HELLO WORLD (1-M and 1-Q) and ISO/IEC 18004 annex I's 01234567 (1-M), all 32 format and 34 version strings, the byte capacities of versions 1 to 40 at L and M, the patterns at the published alignment centres, the mask chosen against the penalties written out again, and reads 88 codes back with a small reader written in the test from the standard (one byte past each version and its last byte, versions 1 to 20, 23 and 25, at M and L; each block checked as a Reed-Solomon codeword, the padding too). On 2026-10-11, outside the repo: jsQR 1.4.0 read back 166 codes (every version from 1 to 40 at M and L, at both ends, and links as `plan` makes them) once its table's alignment centre for version 23 was put right (it says 74; the standard says 78); node-qrcode 1.5.4 drew 240 codes bit for bit the same with the same mask, and on its own chose another mask for 6 of them, each time only because it counts a dark share between 50 and 55% as a step off. Not yet tried with a phone's camera.

## rescue.js

`TS.rescue`: songs gone from YouTube, brought back. An upload that was deleted, made private or kept off other sites still holds the listener's ratings, plays, labels and history on its dead video id. `#/rescue` lists those songs; `#/rescue/<id>` finds another upload of the same song and moves everything onto it. Nothing changes on YouTube.

**Which songs.** `reason(track)` is `''` for a song that plays (library.js `playable`), else `'gone'` (YouTube no longer returns it), `'private'` (the player said removed or private), `'blocked'` (not embeddable: its owner, or a region, keeps it off other sites) or `'error'` (another player error); `reasonText(track)` says it in words. `unplayable(tracks)` lists them, the highest rated and most played first; the page counts in the scope Focus sets, as `#/fix` does. They are listed on `#/rescue` (each with "Find an upload", and "Copy in your library" or "Sure match found" when one is there for free), in a note at the top of `#/fix`, in a note on the song's page, and the track menu of such a song has "Find a working upload".

**Candidates, free first.** The song page gathers uploads in this order, each judged by match.js:

| Source | What it costs | Where from |
| --- | --- | --- |
| `library` | nothing | `copiesOf(index, track)`: the library's other tracks that play and share a title or artist key with the song (match.js `index`, the page's `libIndex`) |
| `pool` | nothing | `poolOf(rows)`: every video YouTube showed before, read from the sources cache (`yt:q:` searches, `yt:list:` lists, `yt:mix:` Mixes, `yt:v:` video details, `oe:` oEmbed answers; ones known not to play left out), indexed once by title key (`poolIndex`) and looked up per song (`fromPool`). Read again after ten minutes or a search. |
| `topic` | 1 unit per 50 uploads, kept 6 hours | with a sign-in or a key: the artist's Topic channel (from the library's or the pool's "Artist - Topic" channels), sources.js `ytLists.uploads`, 200 at most |
| lengths | 1 unit, kept 30 days | with a sign-in or a key: `ytLists.videos` for the best 12 uploads (their length and whether they still play) |
| `search` | 100 units, kept 30 days | only on a press of Search YouTube (its cost badge shows): `ytLists.searchVideos(queryOf(track), { max: 10, category: null })`, every category; refused when today's allowance for finding songs is spent (engine.js `quota`). Without a sign-in or a key the button is a link that opens the same search on YouTube in a new tab. |
| `paste` | 1 unit, or nothing | a pasted YouTube link (share.js `videoIdOf`), checked with `ytLists.videos` (a sign-in or a key) or oEmbed (free) |
| `demo` | nothing | `demoUploads(track)`: in the demo, three invented uploads (the artist's Topic upload, a lyrics video, a cover); nothing is asked of any service |

The engine's resolver is not called: it gives one answer, and its library rung stops at the dead upload itself (the library's own copy of that recording) before the pool or the Topic channel is read. Its free rungs are walked here instead, keeping every candidate.

`candidates(track, list)` ranks them (`list`: `[{ video, source, track, keep }]`; `keep` shows a search result or a pasted link even when it is unlikely). Each is judged twice: `sameSong(songOf(track), copy or uploadSong(video))` (is it the song: title, artist, version, length) and, for an upload, `scoreVideo` (is it a good upload of it: the artist's Topic channel, no cover, live or lyrics words). `sure` is the same recording at `STRONG` (7) or more (and an upload at `MIN_VIDEO` or more); only a sure one is chosen by itself. The order: sure, then the same song, then copies in the library, then the better upload, then the closer length. `-> [{ video, source, track, record, same, sure, score, fit, why, gap }]`. Each row shows the title, the channel, the length against the old one (`lengthWords(sec, oldSec)`: "3:42, 2 s longer"), where it came from, and why (`whyWords(codes)`: `{ good, bad }`, "same title, same artist; but a lyrics video"), with Play (a copy plays as itself, an upload as a found song, not kept) and Open on YouTube.

**The swap.** "Use this upload" checks the upload first (the video details with a sign-in or a key, else oEmbed, free; a copy in the library or the demo needs nothing), then `swap(lib, oldId, video, { now })`:

- **A new upload** joins through library.js `upsert` (an oEmbed-only record gets no `fetchedAt`, so the next refresh reads it in full) and takes the old track's `rating`, `plays`, `skips`, `lastPlayed`, `blocked`, `tags`, `userEdits`, `labels`, `stateAt`, `playlists` and `addedAt` (`STATE`, `PLACES`), then is derived again.
- **A copy the library has** is merged into instead, never doubled: the higher rating, plays and skips added, the later last play, playlists and tags joined (each playlist's earlier date), its own corrections and labels kept with the old song's filling the gaps, and the old song's block (such a copy was often blocked as a duplicate). A rating or block that changes is stamped (`stateAt`) for the Desk's sync.
- The old id goes into `lib.moved` (`{ to, at }`, saved with the meta) and its track out of `lib.tracks`. `-> { ok, oldId, newId, created, ids, drop, record }`, or `{ ok: false, reason }`: `no-track`, `moved` (done already: a second swap changes nothing), `no-video`, `same`, `replaced` (that upload was itself replaced), `unplayable`.

The page then writes (`saveSwap(store, lib, change)`), in an order that never loses the old track: the record (`rescue:moved:<old id>`: the old track whole, the copy's state before and after, the playlists changed), the new track and the meta, and only then deletes the old track's row. If the record cannot be written, the swap is undone in memory. Hand-picked playlists (`moveInLists(lists, oldId, newId)`: the new id takes the old one's place, or the old one leaves when the new one is there) are saved through `ctx.lists.save`. The queue is left alone: a dead id in it is skipped as before.

**The history is mapped, not moved.** A listen is one store record under an auto-increment key that store.js never changes (`addHistory` strips the key, an import adds copies), so moving listens would mean rewriting the whole history, and a tab closed half way would leave it half moved. Instead every listen keeps the video that really played (the CSV export shows it), and the page reads the history through `lib.moved`: app.js `loadHistory` calls `mapHistory(rows, lib)` (`mapRows`: each row of a moved id gets the id it moved to, following later moves; `-> [{ row, from }]`), so Your year, For you, History and radios count the listens for the new upload. An undo only reads the rows again (`restoreRows`). `seenListens(have)` gives app.js's Desk inbox the old ids of the listens it has, so a pulled copy from before the swap adds no doubles.

**Undo.** The toast after a swap has Undo; the song's page says "Moved here on <date> from an upload that stopped playing" with "Put the old one back", and so does `#/rescue` under "Moved to another upload". Both read the record and call `unswap(lib, record)`: a new upload leaves the library and the song goes back to the old one with everything it has now; a merged copy gets back what it had and keeps what happened to it since (plays added after the swap, a rating, label or playlist changed since). The playlists go back (`unmoveInLists`), the history is read again, and `saveUnswap(store, lib, oldId, change)` writes the tracks and the meta, deletes a new upload's row, then the record. `-> { ok, ids, drop }` or `{ ok: false, reason }`: `back`, `not-moved`, `gone` (the song moved on again: put that move back first). It works after a reload. Listens made on a new upload between the swap and its undo stay under that upload's id (it played), so after a reload they are no longer listed, though the song's play count keeps them.

**An import afterwards.** library.js `upsert` skips an id in `lib.moved`, yt.js `importInto` leaves it out before writing, and `reconcilePlaylist` keeps the upload it moved to in a playlist that still lists the old one. A refresh only asks for the library's own ids.

| Name | What it is |
| --- | --- |
| `KEY` | `'rescue:moved:'`, the store key of a record. |
| `STATE`, `PLACES` | The fields that move: the listener's state, and the playlists with their dates. |
| `songOf(track)` | The song as match.js reads it, without its video. `queryOf(track)` is what a search types (the artist, else the parser's guess, and the base title). |
| `view(view, ctx, parts)` | `#/rescue` and `#/rescue/<id>`. |
| `fixNote(view, ctx)`, `trackNote(view, ctx, track)`, `menuItem(ctx, track)` | The note on `#/fix`, the notes on the song's page, the track menu's item (null for a song that plays). |

**What is kept.** The store: `rescue:moved:<old id>` per move, and `lib.moved` in the library's meta. In memory for the visit: the candidates of each song and the chosen one, the pool for ten minutes. pageCtx gains `lists.all()`, `lists.save()` and `changed(ids, meta)`.

**Tests.** The `rescue` section (test/rescue.section.js, 97 checks): the reasons and the order; a swap and its undo on a library built with library.js (every moving field, playlists with their dates, derived again), a merge into a copy (the higher rating, plays added, playlists joined, the copy's own corrections kept, blocks) and its undo after more plays, a second swap changing nothing, a refused one, a chain of two moves; an import afterwards through `upsert`, `reconcilePlaylist` and yt.js `importInto` with a stub client (the old id stays out, the new upload stays in the playlist); `movedTo` and the meta round trip; candidates (the Topic upload sure, a lyrics video not, a cover left out, a copy in the library first, the dead upload never); the pool from cache rows; the playlists and the history both ways; the store writes on store.js's memory store.

**Checked in a browser** (2026-10-11, `scripts/qa/drive.mjs`, the script outside the repo): on `?demo=1` with four songs made unplayable, `#/fix`'s note, `#/rescue` (sure matches marked), a song's page (the Topic upload chosen, arrows move the choice with a focus ring), a candidate played without joining the library, a swap (plays, rating, labels, playlists and title moved; the record stored), Undo from the toast, Put the old one back from the song's page, the track menu's item, a merge into the library's copy; dark and light at 1280 by 860 and 390 by 844 (no sideways scroll). Not in the demo, with a library in IndexedDB: Search YouTube with its cost badge (a key), the search in a new tab and the link field (no key), a merge, then a reload (the move, the merged counts and the listen read as the copy's are kept), Put the old one back, another reload (both uploads as they were); no request went to the YouTube Data API or oEmbed (only the cover art from i.ytimg.com, as for any library).

## wrapped.js

`TS.wrapped`: Your year, at `#/wrapped` (`#/wrapped?year=2025` for another year), and three small lanes on the home page. The counting is pure and runs in Node; the drawing uses only `pageCtx`.

```js
var Wr = TS.wrapped;
Wr.yearStats(history, tracks, year, { now, local, top })  // the year in numbers (below)
Wr.onThisDay(history, tracks, now, { local })             // -> { added: [{ id, year, ago }], played: [{ id, plays, year, ago }] }
Wr.rediscover(history, tracks, now, { n, local })         // -> [{ id, last, score }]
Wr.nudges(tracks, history, now)                           // -> [ids]
Wr.years(history, tracks, { local })                      // -> [2026, 2025]
Wr.yearText(stats, tracks)                                // the year as a few plain lines
Wr.view(view, ctx, parts, query)                          // #/wrapped, through app.js pageFile
Wr.homeLanes(view, ctx)                                   // the home page, before Recently added
```

`history` is the store's listens (`{ id, at, kind: 'play' | 'skip', listenedSec }`, in any order); `tracks` is `{ id: track }` or a list. Listens of songs that are not in `tracks` are left out; the page passes the index's tracks, so Focus narrows Your year as it narrows every view. Days, months and years are UTC unless `local: true`; the page passes it, so that a day is the reader's own day (an evening play in Texas is not tomorrow's).

**yearStats** counts one year. Tops count plays only; minutes are what was heard (`listenedSec`), skips included. Listens after `now` are left out; `top` (50) cuts the lists, not the counts.

| Field | What it is |
| --- | --- |
| `year`, `listens`, `plays`, `skips`, `seconds`, `minutes` | The year's listens of known songs, and the time heard. |
| `songs`, `artists` | How many songs and artists (by `artistKey`) were played. |
| `days`, `longestStreak`, `streakFrom`, `streakTo` | Days with a play; the most days in a row and its first and last day (`'YYYY-MM-DD'`). |
| `topSongs` | `[{ id, plays, minutes }]`, most played first (then the most heard, then the first heard). |
| `topArtists` | `[{ key, name, plays, ids }]`: the plays of the artist's songs; `name` the commonest spelling; `ids` the songs, most played first. |
| `topWorks`, `topGenres`, `topMoods`, `topScenes` | `[{ key, plays, ids }]`: the work's name, the genre, the mood and scene keys. A play counts once for each genre of its song. |
| `firstSong`, `lastSong` | `{ id, at }`: the year's first and last play. |
| `busiestMonth`, `busiestDay` | `{ month: 'YYYY-MM', plays }`, `{ date: 'YYYY-MM-DD', plays }`; the first of equals. |
| `hours`, `weekdays`, `months` | Plays per hour (24), per day of the week (7, Sunday first) and per month (12). |
| `newSongs`, `discoveries` | Ids of the songs first added that year (the earliest of `addedAt`), oldest first, and those of them in the local playlist `local:discovered` (kept from Discover). |
| `mostSkipped` | `{ id, skips, plays }`: three skips or more, the most; of equals, the one played least. Else null. |
| `onRepeat` | `{ id, date, plays }`: the most plays of one song on one day, five or more. Else null. |

**onThisDay** lists the songs first added on this month and day in earlier years (`added`, oldest first, `ago` in years) and the songs played on it in earlier years (`played`, most played first, `year` the latest such year). On February 28 of a year without a 29th, the 29ths of earlier years count too; in a leap year they wait for their own day.

**rediscover** finds songs loved before (rated 4 or more, or played 5 times or more by the track's count or the history's) that have not been played in the last 180 days (`lastPlayed` and the history both count; a song added in those days is not "before"). Blocked and unplayable songs and clips are left out. Best first: shuffle.js's favourite weight, then the longest unheard. `last` is the last play in ms (0 for never); `n` caps the list (12).

**nudges** returns the songs played to the end 6 times or more in the last 60 days that are not liked (rated under 4), most played first, then the latest. A play is a full one when 90% of the track's length was heard; without a length or a `listenedSec`, the history's `'play'` decides. Blocked songs never.

**years** are the years with at least one play of a known song, newest first. **yearText** is what Copy as text copies: the minutes, plays, songs and artists, the days and the streak, the top five songs, artists and three genres, the busiest month.

**The page (#/wrapped).** A header (Your 2026, the year as its art, the dates counted) with Play your top 50 (`ctx.play.from`, as "Your top songs of 2026"), Save as playlist (the top songs, through `ctx.lists.create`, which asks for a name) and Copy as text (`navigator.clipboard.writeText`; when the browser refuses, the text in a dialog, selected); chips for the other years; five tiles (minutes, songs, artists, days, the longest streak); the top songs as a numbered list (ten, then Show all) with a Play on each row; the top artists and works as shelves (each plays its songs of the year); genres, moods and scenes as chips linking to their pages; three column charts of plain divs (month by month, by the hour, the week: one hue, the highest column labelled, a line above that reads out the column under the pointer or the finger, `role="img"` with a summary and a table for screen readers); highlights (the busiest month and day, the first song, on repeat, skipped the most, and in a past year the last song); You kept N new songs this year (the discoveries, and how many songs joined the playlists, linking to `#/c/added/<year>`). A year without plays says that listens are counted from now on. When the store holds 5,000 listens or more, the footnote says how far back they reach. Its CSS is one injected `<style id="ts-wrapped-css">` on the app's tokens; nothing in it is fixed or sits over the player.

**The home page's lanes** (`homeLanes`, each only when it has something): On this day (up to six songs played on this day in earlier years, then songs added on it: "added 3 years ago"), Rediscover old favourites (`rediscover`, 12 at most, with Play all), and one nudge card, "You play X a lot. Like it?", whose heart rates the song 5 (`ctx.edit`, Undo in the toast) and whose Not now puts it off for 30 days (`ToyKit.store('nudgeDismissed', { id: until })`). Once a nudge is answered no other one comes until the page is loaded again.

Tests: the `wrapped` section (48 checks): every pure function on an invented history (a streak across the end of January, the last second of a year and of a month, February 29 on the 28th of a year without one and on a leap year's 28th, skips left out of the tops, unknown ids, the 180-day and 6-play thresholds and the 90% full play, frozen inputs, 5,000 listens in a few ms).

## lyrics.js

`TS.lyrics`: the words of the song that is on, from [LRCLIB](https://lrclib.net/) (open, no key, CORS for every origin). Lyrics from LRCLIB, with thanks: the page says so in the Lyrics tab, on the karaoke page and under every search for words.

- **The Lyrics tab** (the now-playing panel's fourth tab, `panel`): the song's title and artist, "Lyrics from LRCLIB", and its words. Timed words light the line being sung; the panel keeps that line in view (it scrolls only when the line leaves the middle of the panel) and stops following for 4 seconds after a scroll by hand (wheel, touch, keys, the scroll bar). A click on a line plays the song from there. **Romaji** (shown when the words have kana) adds each line's kana read as Hepburn romaji (match.js `romaji`; kanji stay), remembered as `lyricsRomaji`. The timing stepper moves the words half a second sooner or later (Shift: five seconds; the middle button puts them back), remembered per video id in `lyricsOffset` (`{ videoId: seconds }`, 300 songs at most). Pressing either from the panel's tools leaves the panel where it is. Other states: a skeleton while looking, "No lyrics found for this song." with **Search lyrics** (`#/lyrics?q=<title>`), plain words (shown untimed), an instrumental, a failure with **Try again**. The demo's songs are invented, so the demo shows a note and asks nothing; a thumbnail asks nothing either.
- **The karaoke page (`#/lyrics`, `view`)**: the song that is on, big. The line being sung stays in the centre, the next two dimmer, the rest faint; a sticky bar keeps **Song details** (or Home), the song's name once its title has scrolled away, Romaji and the timing stepper in reach. It follows the player to the next song. With reduced motion it jumps instead of gliding. Nothing playing: a note and a form to find a song by its words.
- **Finding a song by its words (`#/lyrics?q=<words>`)**: up to 20 songs, one row per song, each with its artist, album and length, the line that holds the words (those words marked; small words such as "the" are not, and "lanterns" finds "lantern"), **In your library** when match.js `inLibrary` finds the library's copy, and **Play**. Play hands `{ key: 'lrc:<id>', title, artist, album, durationSec, source: 'lrclib' }` to the engine (`ctx.play.find(find, 'now')`), which finds the YouTube video: the badge says 100 units unless the song is in the library or found before.
- **On the search page (`searchSection`)**: for three words or more (or 12 characters), a small box "Songs with these words (lyrics)" whose **Search lyrics** button lists up to five such songs. The search page never waits for LRCLIB.

**What is sent.** Nothing until the Lyrics tab is open with a song, the karaoke page is open, or words are searched. Then the song's artist, title and length (or the words), to `https://lrclib.net/api/get` and `/api/search`, without cookies (`credentials: 'omit'`) or a referrer (`referrerPolicy: 'no-referrer'`), naming the app in the `Lrclib-Client` header that LRCLIB asks browsers to send (its CORS answer allows it; it costs a preflight). One request at a time, at least 300 ms apart (`GAP_MS`); a 429 waits as long as LRCLIB's `Retry-After` asks. Answers, "none" too, are kept 30 days (`TTL_MS`) in sources.js's cache under `ly:<videoId>` (else `ly:<artist>|<title>`, folded), so a song is looked up once a month at most.

**Finding the record.** `queryFor(track)` gives up to four lookups, best first: the artist (or the guessed artist) with the base title (match.js `baseTitle`), then with the `titleAlt` (often the Japanese title), the artist's native name with the `titleAlt`, then a cover's `origArtist`; each with the length when it is known. The client asks `api/get` with each until one gives timed words within 3 seconds of the track's length, then `api/search` with the lookup that found something (else the first; when that finds nothing, once more with the original artist), and `pick` chooses:

| Evidence | Points |
| --- | --- |
| The same title (match.js `sameSong`: fold keys; kana read as romaji; the `titleAlt` too) | +4; a loose key +3; a title inside the other +1, then only with the same credit |
| Another title | not this song |
| The same artist credit (the native name, a cover's original artist too) | +3; a person in the credit +2 |
| Another known artist | not this song |
| Timed words; plain words; an instrumental with none | +3; +1; +0.5 |
| The length within 3 s; 8 s; 15 s; unknown; further | +4; +2.5; +1; +1; -2 |
| A track with no artist at all | only a record within 3 s of its length |

Ties go to LRCLIB's order. Timed words for a cut more than 45 seconds longer or shorter than the track (a TV size against the full song) are kept as plain words (`otherCut`).

| Name | What it is |
| --- | --- |
| `parseLrc(text)` | LRC text to `{ lines: [{ t, text }], offset, tags }`: `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]` and `[mm:ss:xx]`; several stamps on a line give it at each time; `[offset:+/-ms]` is applied (a positive offset shows the words sooner; no time under 0) and returned in ms; `[ar:]`, `[ti:]` and other tags in `tags`; a stamp without words is a spacer (`text: ''`); untimed lines and word stamps (`<mm:ss.xx>`) are dropped; sorted by time, equal times in the order written. |
| `lineAt(lines, seconds)` | The line being sung: the last one that has started (binary search); -1 before the first. |
| `romajiLine(text)` | A line's kana in romaji, Japanese commas, stops and quotes in Latin form; `''` without kana. |
| `queryFor(track)` | The lookups, `[{ artist_name, track_name, duration }]` (above). |
| `pick(results, track)` | The best LRCLIB record for the track, or null (above). |
| `answerOf(record, track)` | `{ synced: lines \| null, plain: text \| null, instrumental, otherCut, source: { id, artist, title, duration } }`; plain words made from the timed ones when LRCLIB has none. |
| `cacheKey(track)` | `'ly:<videoId>'`, else `'ly:<artist>\|<title>'` folded; `''` for nothing. |
| `snippet(text, words)` | The line that holds most of the words (and the next when it is short), at most 160 characters; `''` when none. |
| `toFind(hit)` | A search row as a find (sources.js `find` shape), key `lrc:<id>`. |
| `createClient({ fetch, cache, now, wait, gapMs, base, client })` | `{ get(track), search(words) }`. `get` resolves the answer, or null for none, and rejects on a failure (`code`: `offline`, `timeout`, `busy` (429), `http`, `bad-answer`), which is not kept; one lookup in flight per song. `search` resolves `[{ id, title, artist, album, duration, snippet, synced, instrumental }]`, one row per song, the timed record kept; the same words within ten minutes are not asked again. `cache` is sources.js `createCache(...)`, else a Map; `fetch` defaults to `configure`'s, else the browser's; `client: ''` sends no header. |
| `configure({ fetch })` | The fetch every client made without one uses (drive scripts; `null` for the browser's again). It also forgets what the page was told. |
| `panel(box, ctx, { id, force })` | The Lyrics tab for video `id` (app.js `renderLyricsTab`). The same song again does nothing; `force` redraws from what is known, asking again only after a failure. |
| `tick(seconds, id)` | The player's time (app.js, on every `time` event): lights the line in each view of that song without a redraw, and lights the next line on time between two events. The karaoke page follows a new `id`. |
| `view(view, ctx, parts, query)` | `#/lyrics` and `#/lyrics?q=`. |
| `searchSection(view, ctx, q)` | The box on the search page. |
| `API`, `GAP_MS`, `TTL_MS` | `https://lrclib.net/api/`, 300, 30 days. |

The CSS is one `<style id="ts-lyrics-css">` the module adds once, in the page's tokens; buttons are ui.js `btn`. Nothing it draws is fixed or covers the player.

The `lyrics` test section (100 checks) has the LRC cases (every stamp form, several stamps, offsets both ways, tags, spacers, order, CRLF, a byte order mark, word stamps), `lineAt` against a plain scan of 300 random lyrics, romaji lines, the lookups, `pick` (timed before plain, the length, another artist, the Japanese title and native name, a katakana title, a cover's original artist, a TV size, a person in the credit, no artist), `answerOf`, `cacheKey`, `snippet`, `toFind`, and the client against a fake LRCLIB: 404s then the search, a hit that needs no search, plain then timed, a cover searched again under its original artist, "none" kept 30 days in sources.js's cache and asked again after, a Map without a cache, one lookup in flight, failures not kept, 429 and `Retry-After`, the fetch options and the header, the search rows, requests 300 ms apart (a fake clock and the real one), and `configure`.

**Checked in a browser** (2026-10-10, `scripts/qa/drive.mjs` on `?demo=1` with a fake LRCLIB through `configure`): the demo note without a fetch; one `api/get` with the right artist, title and length, no cookies, no referrer, the header; the lit line matching `lineAt` at five times and after `tick(4000)` on the mock; a redraw keeping the nodes and asking nothing; a click on a line seeking to it; the stepper (+0.5 s moves the words, `lyricsOffset` written, reset); romaji on and off, the panel staying put and the button keeping the focus; a scroll by hand holding the panel 4 seconds; the karaoke page centring the line (0 px off) with the next two dimmer, following a tick and the next song; `#/lyrics?q=` rows with marked words, In your library and the cost badge, Play on the library's copy playing it; the search page's box asking nothing until pressed; both themes and 390 by 844 without sideways scroll, with no console errors.

**Not done.** LRCLIB itself was only probed by hand (`api/get` and `api/search` shapes, CORS, about 0.2 to 0.4 s an answer); a real lookup in the page needs a signed-in library. Word-by-word timing (`hasWordSync`, `lyricsfile`) is not used. Kanji have no reading. An upload whose video starts long before the song (a music video's intro) needs the stepper, Shift for five-second steps.

## quiz.js

`TS.quiz`: Guess the anime (`#/quiz`, "Guess the anime" in the sections). A few seconds of an opening or an ending from the library, four anime to choose from, `ROUNDS` (10) rounds. There is no video, since YouTube's player would show the anime. The clip is the 30-second preview that Apple's iTunes Search gives for the song, played in an Audio element while YouTube's player is paused.

**The previews are Apple's.** They come from the iTunes Search API (`ITUNES`, `https://itunes.apple.com/search`: no key, CORS, about 20 requests a minute), from Japan's store, and play from `audio-ssl.itunes.apple.com`. After each answer the page credits the clip ("a preview from Apple's iTunes Search") and links the song on Apple Music. Requests leave 3.1 s apart, without cookies or a referrer, and carry only the artist and title of the song asked about. A 403 or 429 holds them all for a minute. Nothing is asked before Start is pressed.

**The pool.** `pool(tracks, { inserts, aliases })` takes a list or `{ id: track }` and keeps the songs a game can ask about:
- the song plays (`L.playable`) and is not blocked;
- it is a song, not a clip or a set;
- it has a sure artist (so its preview can be matched) and a work;
- it is an opening or an ending (`role` OP or ED), or an insert song with `inserts`.

It returns `{ works: [{ name, key, scene, year, ids, aliases }], byWork, byId, ids, songs, ok, need, inserts }`.
- **Works.** Spellings that fold alike (match.js `loose`) are one work, named the commonest way.
- **Scene and year.** A work's `scene` is the commonest scene that names a kind of work (anime, vn, game, film, tv, stage, touhou) among its own recordings: a cover's utaite or vtuber scene says who sings it, not what it is from. Its `year` is the earliest year its own recordings have from a label, an edit, a release date or a title; an upload's year does not count, and 0 means unknown.
- **Aliases.** A typed answer may use any spelling found in the labels, the names passed in `aliases` (`{ work: [names] }`), and the main title of "Main: Subtitle", "Main - Subtitle" or "Main (Season 2)" when it is four letters or more. labels.json has no table of work names; `aliases` is where one would go.
- **Enough.** `ok` needs `MIN_WORKS` (4) works. The page reads the scope the views read (`ctx.idx().all`), so Focus narrows the quiz too. With fewer works it says what is missing and links the quick labeller and Anime, games & stage.

**A round.** `makeRound(pool, rand, { level, avoid })` returns `{ id, work, scene, year, song, title, artist, role, roleLabel, choices, answer, level, clipSec, startSec }`, or null when nothing is left.
- **The song.** A work is drawn evenly among those with a song left, works not asked yet first, then one of its songs.
- **`avoid`** is a list of ids, or `{ ids, songs, works }`; `songs` are `S.songKey`s, so another upload of a song asked already does not come.
- **The clip** starts at `startSec`, somewhere in the preview's first 20 seconds.
- **Seeded.** The same `rand` (`S.rng(seed)`) gives the same round, whatever order the library came in.

`choicesFor(answer, works, rand, level)` returns the four names, the answer once at a random place:

| `LEVELS` | Clip | The other three |
| --- | --- | --- |
| `easy` | 10 s | Any other works. |
| `normal` | 7 s | The answer's scene first, then any. |
| `hard` | 4 s | The answer's scene within three years first, then its scene, then any. The name can be typed. |

Easy and Normal keep works of the same franchise (one name inside the other, five letters or more: "Starfall Odyssey Zero") for last; Hard allows one. `roleLabel(track)` is `'OP'`, `'ED'` or `'Insert song'`. When the upload's title numbers it ("Opening 2", "NCED3") and agrees with the role, the number is added: `'OP2'`. `typed(text, round, pool)` is the choice a typed answer names: match.js `workScore` of 0.8 or more against a choice's names, one choice clearly best. Otherwise it is -1, and the page asks for more of the name.

**Previews.** `searchTerms(track)` gives at most two terms:
- the artist's native name and the Japanese title, when the labels have them (Japan's store lists songs so);
- then the original artist, for a cover;
- else the names as the library has them.

Decoration comes off the title (match.js `baseTitle`). `searchUrl(term, country)` is `ITUNES?term=...&country=JP&media=music&entity=song&limit=5`. `pickPreview(results, track, { ok })` returns the result that is the song as `{ url, title, artist, durationSec, score, link }`, or null:
- the result must be a song;
- its preview must be at Apple's preview host (`ok` replaces that check, for a test serving its own audio);
- match.js `sameSong` must say it is the same song (folded title and artist when match.js is missing);
- the highest score wins, the first of equal ones.

A cover with no preview of its own may take the original recording's, marked `original`, and the page says so.

**The score.** `score(state, correct, ms)` returns a new `{ points, right, wrong, streak, best, last }`; `score(null)` is a new game's. A right answer is 100 points, plus up to 50 for speed: all 50 within 2 s of the clip starting, none after 15 s. A wrong answer ends the streak.

**A game.** `createGame(opts)` is the state machine the page drives and the tests run against a fake iTunes.
- **`opts`**: `{ tracks or pool, level, rand, rounds, inserts, aliases, fetch, gapMs, pauseMs, retryMs, line, cache, memo, previewOk, country, now }`.
- **Phases**: idle, loading, question, answered, then question again, and so on, ending in summary. On the side: empty (fewer than four works) and error.
- **Looking ahead.** The round on screen and the next two are looked up ahead, so a round is usually ready when Next is pressed.
- **Songs without a preview** are left out for the game; their work may still come. After 15 in a row it gives up.
- **Failures.** Three failed lookups in a row are an error with a sentence for the reader.
- **Running out.** When the pool runs out of songs with previews, the summary comes early.
- **The cache.** `cache` is sources.js `createCache` (the page passes `ctx.cache()`). It keeps a found preview under `qz:it:<country>:<artist>:<title>` for 30 days, and "no preview" for 7.

| Call | What it does |
| --- | --- |
| `start()` | Looks the first rounds up. Resolves with the state once the first round is there (or empty, or error). |
| `round()` | The current round, a copy, with its `preview`. |
| `answer(choice, ms)` | An index into the choices, or a work's name, and how long it took. Returns the round with `chosen`, `right`, `points`, `ms`; null when no question is open (one answer a round). |
| `next()` | The next round, or the summary after the last. Resolves once it is there. |
| `skip()` | The clip would not play: another song takes the round, and the preview is forgotten. |
| `retry()` | After an error, look again. |
| `stop()` | No more lookups. |
| `state()` | `{ phase, level, total, index, played, score, error, skipped, tried, asked, waitMs, round }` |
| `ready()` | Resolves with the state once it is not loading. |
| `pool()` | The game's pool. |
| `summary()` | `{ level, rounds, played, right, wrong, points, best, skipped, missed: [round], history: [round] }` |
| `on(fn)` | `fn(state)` after every change. Returns `off()`. |

**The page.** app.js routes `#/quiz` to `view(view, ctx, parts, query)`, which draws with `ctx` (pageCtx) only. `#/quiz?level=hard` picks the level.
- **Setup.** The level, insert songs or not, and Start.
- **A round.** The compact header says the round. A score line shows dots per round, points, the streak and the best streak. The clip box has Play again and Give me 5 more seconds (a playing clip runs on; a stopped one goes on from where it stopped). Then four big choices, two by two and one column on a phone, and on Hard the field to type the name.
- **After the answer.** Right or wrong, with the right choice marked, the song with its role and its work, the clip's credit, Next round, and Play the full song (`ctx.play.now`, which keeps the queue). A playing clip runs on a little.
- **The summary.** The score, the best streak, new bests, Play again, Change difficulty, and the songs missed, each with Play, plus Queue the ones I missed (`ctx.play.later`).
- **Keys.** 1 to 4 choose, Space plays the clip again, Enter goes on. A text field keeps its keys, and a focused button outside the game keeps Space and Enter. The verdict and each round are announced through a polite live region; the focus moves to the question, then to Next round.
- **The clip and the app's player.** YouTube's player is paused when a clip starts (`ctx.player().pause()`). The clip stops when the page is left (hashchange, pagehide), when the app's player starts, or when the bus says another part of the page plays (`ctx.bus` `'audio'`; the quiz sends `{ by: 'quiz' }`).
- **A browser that refuses sound.** When it wants a press first, the page says so and Play the clip starts it.
- **One Audio element.** It serves every round; a clip that will not load gives its round to another song.
- **Stored.** In the kit's localStorage: `quizBest` (`{ streak, points: { easy, normal, hard }, games }`), `quizLevel` and `quizInserts`.
- **The style** is one injected `<style id="ts-quiz-css">` on the app's tokens. Nothing in it is fixed-position.

`configure({ fetch, gapMs, pauseMs, rand, previewOk, forget })` is for tests and drive scripts: a stub for iTunes, no gap, a seeded game, an audio server of their own. `game()` is the running game, or null.

The `quiz` test section (86 checks) covers:
- the pool's rules, spellings, covers' scenes, upload years and aliases;
- the choices on 150 seeds for every work and level (four different works, the answer once, the scene on Normal, the years on Hard, franchises);
- seeded rounds in any library order;
- `pickPreview` against decoys, other hosts, videos, kana titles and native names;
- the score and typed answers;
- whole games against a fake iTunes: ten rounds by index and by name, a song without a preview never asked, one request per song, the same seed playing the same game, a 403's pause, three network failures and `retry`, no previews at all, `skip`, the memo and the cache, a cover taking its original's preview, a pool that runs out.

Checked in a browser on 2026-10-10 with `scripts/qa/drive.mjs` (the script and a 30-second WAV standing in for the previews stayed in the session's scratchpad). The demo, labelled with six more works through `ctx.edit`, iTunes stubbed:
- the empty state with the demo alone;
- the clip starts at its second and stops after 7 s, plus 5 when asked;
- Space replays it, and the app's play button stops it;
- YouTube's player stays paused through ten rounds played by clicks and keys;
- Play the full song, the summary (8 of 10), Queue the ones I missed and `quizBest`;
- a typed answer on Hard;
- leaving the page stops the clip, and the round waits;
- a clip that will not load is replaced;
- a refused autoplay shows its note;
- one column of 64 px choices at 390 by 844, light and dark, with no errors on the page.

## channel.js

`TS.channel`: a YouTube channel as a place to find music, not only a name under a song. A channel that uploads other artists' songs (a niche reupload channel, a label, an archive) brings music the way an artist does, so every upload it has can be read, filtered and played, the ones new to you first.

| Name | What it is |
| --- | --- |
| `rank(tracks)` | The channels the tracks came from: `[{ id, name, songs, artists, names, curator, ids, lastAdded }]`. `curator` is a channel that is not an artist's own (not a Topic or VEVO channel, not named after a singer of its songs: "Neon Abacus Official" is Neon Abacus's) with two songs or more. Curators come first, the most artists first; `artists` counts the artists of its songs other than the channel itself, guessed ones (`track.guess`) too; `names` are the three most frequent. |
| `isMusic(title, durationSec, hasArtist)` | False for an upload that is not a song: a short, a trailer or teaser, a stream, a vlog, anything under 45 seconds, and (with `hasArtist` false) a title of hashtags with no artist in it, the way Shorts and announcements are titled (oEmbed gives no size or length to tell them by). Such uploads are kept apart, shown on request, and never played by Play or Shuffle. |
| `uploadFinds(items, { channelId, channel, rule, have, find })` | Uploads as finds: the artist and title read by parse.js (`sure` when the channel's `rule` vouches for the artist; otherwise the reading is a guess, as on any stranger's channel), `mine` when `have(videoId)`, `music` from `isMusic`, `raw` the title as uploaded. Each video once; unavailable ones are dropped; `find` is sources.js `find`. |
| `artistsOf(finds)` | `[{ key, name, count }]`: grouped across spellings, under the commonest spelling, the most frequent first. |
| `teachRule(tracks)` | `'artist-title'` or `'title-artist'` when the channel's songs have only guessed artists and most of their titles keep that shape (two songs or more, 60%); otherwise null. |
| `demoUploads(channelId, name, rand)` | The demo's eighteen invented uploads by several artists, the newest first, with ids shaped like YouTube's. |
| `readList(box, listId, opts)` | The ids of a YouTube list, read through a player built in `box`: visible, 356 by 200, YouTube's own controls, on youtube-nocookie, cued and never played (a press on its play is undone). An empty read (the cued item cannot be embedded) is cued again from the next item, `retries` (3) times. The player is gone when it settles. `opts`: `{ loadApi, host, width, height, timeoutMs (20 s), pollMs, retryMs, retries, doc }`; it returns `Promise<[ids]>`. |
| `view(view, ctx, parts, query)` | `#/channel/<id>` and `#/channels`. |
| `homeShelf(view, ctx)` | The home page's "Channels that find music for you", when there are any. |
| `nowLink(track, ctx)` | Under the song that is on, when its channel is a curator: "From wound, 7 artists, 12 songs of yours", a link to the channel. |
| `PAGE`, `READ` | Rows drawn at a time (60); uploads read at a time through the Data API (100, 2 units). |

**The channel page (`#/channel/<id>`).**
- **The header:** Play what's new to you (the uploads you do not have, newest first, through engine.js `list`; each has its video, so nothing is searched), Shuffle the channel (its uploads and your songs from it), and Open on YouTube. The meta counts your songs, its uploads and its artists.
- **The rows:** New to you, Yours and All (chips with counts), the artists here (a chip filters by one), and a filter by title or artist. A click on a row plays it now; each row has Play next and a menu (Add to queue, Save for later, Song details for yours, Open on YouTube). Your songs show as the library has them, with a Yours badge; your songs older than the uploads read come after them.
- **Reading the uploads:** with a sign-in or an API key, sources.js `ytLists.uploads` (the Data API: 100 at a time for 2 units, kept 6 hours, read on from where it stopped by Load older uploads). Without either, `readList` reads the uploads list (`UU` and the id after `UC`) through a visible player, at most the newest 200, and sources.js `oEmbed` fills in the titles (free, 20 at a time, kept 30 days); the rows show as soon as the ids are read.
- **Teaching the channel:** when the artists of your songs from it are only guessed and its titles keep one shape, a note offers "Take the artists from the titles" (library.js `setChannelRule`): your songs from it, and its uploads here, then get their artists from the titles.
- **Below:** as before, when the channel's songs are mostly one artist's, their other songs and releases from Deezer, and what sounds like the channel in your library (app.js `channelExtras`).

**`#/channels`** (Channels, under Artists in the sections): the channels that find music for you as cards (each card's play shuffles your songs from it), then the artists' own channels. The home page shows the first ten curators, and the now-playing panel links the song's channel when it is one.

## lanes.js

`TS.lanes`: a lane is one titled section of a page that loads its own data and is never blank: a skeleton while it loads, then its songs (rows, cards, or rows in groups), or words for why there are none. Explore's lanes, the song page's and the artist page's are lanes.

| Name | What it is |
| --- | --- |
| `mount(el, ctx, spec)` | A lane in `el`: `{ node, reload(), state(), data(), destroy() }`. `spec`: `{ id, title, sub, badge (a ui.js badge kind), layout: 'rows' \| 'cards' \| 'groups', load(signal) -> Promise<data>, unavailable() -> null \| { text, fix: { label, icon, run(lane) } }, empty, limit, seeAll: { href, label }, actions(data) -> [nodes], render(body, data), row (media.js options), lazy, key, source, compact, grid, maxAgeMs, isEmpty(data), onFix(kind, lane) }`. `data` is a list of items, or `{ items, groups: [{ title, sub, items }], note, sub, total, more }`; items are library tracks, finds or media.js items. |
| `STATES` | `loading` (a skeleton of the layout, `aria-busy`), `ready`, `empty` (the spec's sentence), `error` (`explain` and its fix), `unavailable` (what the lane needs first: a sign-in, a key, a press; its fix runs, then the lane asks again). The lane's node carries `data-state`. |
| `explain(error, { now, online, source, noAuto, timeZone })` | Any error in words for the listener: `{ code, text, fix: { label, kind: 'retry' \| 'signin' \| 'key' \| 'settings' } \| null, retryMs }`. sources.js `SourceError` codes (offline, rate and down with "asked again in a minute", network, server, not-found, auth), yt.js `YTError` codes (signed-out, quota with its reset at midnight Pacific in the listener's own time, bad-key), aborted. |
| `forget(keyOrPrefix)` | Forget the lanes kept in memory (all without an argument). With a `key`, the same lane again in a session paints at once from memory (`maxAgeMs` bounds it). |
| `MARGIN` | 600: a lazy lane loads when it comes this many pixels near the screen (IntersectionObserver; at once without one). |

A load is aborted (AbortController) when its lane is destroyed or leaves the page, and an answer that comes late is dropped. A fix of `kind` runs the spec's `onFix`, then the page's `ctx.fix`, then `ctx.signIn` (signin), else Settings. The CSS is one `<style id="ts-lanes-css">` on the app's tokens; nothing is fixed or covers the player.

## media.js

`TS.media`: one song row, one song card and one song menu for library tracks and found songs alike. A row says where the song came from (a source badge), why it is here (the why line), whether the library has it (a check) and what playing it takes (a badge on Play). Every title goes in as text, never as markup.

| Name | What it is |
| --- | --- |
| `item(trackOrFind, ctx)` | One shape for a library track, a find, or `{ t, why }`: `{ key, videoId, title, artist, work, role, album, cover, preview, durationSec, source, why, mine (a library id or null), track, find, kind, ... }`. |
| `row(ctx, item, opts)`, `list(ctx, items, opts)` | A `<li>` (art, title, artist, role chip, the why line, the source badge, the check, the length; Play with its cost, Play next, More), and an `<ol>` of them. On touch screens the buttons are always shown and a long press opens the menu. |
| `card(ctx, item, opts)` | A card (art, title, line, a play button over the art). |
| `menu(ctx, item, at, opts)` | Play now, Play next, Add to queue, Save for later or Saved, Preview (with a preview), Not interested (engine.js `hide`, with an Undo), Go to the artist, work or channel when known, Explore, Open on YouTube. |
| `play(ctx, item, mode, opts)`, `playFrom(ctx, items, index, context)` | A library song through `ctx.play.now`/`next`/`later`; a find through `ctx.play.find(find, mode)`; from an index on, as the page's queue. |
| `whyText(item, max, ctx)` | The reasons (`why`: `[[kind, value]]`) as one line, at most `max` (2): "OP2 of Clannad . on Low Tide". |
| `sourceBadge(item)` | `[kind, text]` for its source (AnimeThemes: Anime, AniList: Airing, a Mix, a channel, iTunes, Deezer, Last.fm, Shared ...), or null for the library. |
| `cost(ctx, item, estimate)` | What Play takes: 0 (known), 1 (a cheap lookup), 100 (a YouTube search), or `'tab'` (no key and no sign-in: YouTube's own search opens in a new tab, and the button says YouTube). |

`opts`: `{ context: { label, href } (what the queue says is playing), list (Play from here plays the rest after it), compact (the now-playing panel: three icons at most), index (a number column), onPlay(item, mode), badge, why, sub, preview, menuItems(item), onHide(item, kind, undo), go, href }`. Preview is `ctx.preview(item, button)` (app.js: the 30-second preview); without it there is no preview button.

## works.js

`TS.works`: which anime a song in the library is from, checked against the listener's own songs, and that anime's whole franchise of songs (every opening, ending and insert across its seasons and films), with the ones the library has marked. Explore's anime lane reads it.

```js
var works = TS.works.create({ at, it, M, L, index, tracks, map, now });   // at, it: sources.js animeThemes and iTunes clients
works.workOf(track, { signal })      // -> Promise<null | { kind: 'anime', anime: { slug, name, year, season, format }, series, sure, via: 'label' | 'title' | 'user', candidates }>
works.franchise(found, { signal })   // -> Promise<null | { title, series, entries, songs, have, total, current }>
works.reject(track, slug)            // "Not this one": remembered; workOf offers the next candidate
works.confirm(track, slug)           // the listener says it is this one
works.demo(track, lib)               // -> { found, franchise } | null: invented from the demo library, asks nothing
works.soundtracks(track, { signal }) // -> Promise<null | { work, albums, have, total, sure }>: a game's, a visual novel's or a stage work's albums on iTunes
```

- **A song with a work label** is looked up by its label: AnimeThemes is asked for anime and series of that name (its synonyms count: "Oregairu"), the first `TOP` (3) anime are read, and one is **verified** when one of its themes is a library song of that work (match.js `sameSong`, `SAME` or more, over every way a track can meet a theme: `probes`). When none is, a series the label names (Monogatari) lends its entries, then the song's own title is tried. Unverified, the best candidate comes back with `sure: false`.
- **A song without a label** (`titleLookable`: an anime scene, or no scene and Japanese or no language) is looked up by its title and `titleAlt` (`titleQueries`): an AnimeThemes song counts when match.js says it is the same song and the artist is part of the evidence (`titleMatches`), so an equal title by another artist never does.
- **Kept** in the page's map (`keysOf`: `work:<fold(work)>`, `song:<id>`): `fresh` says an answer is good for `KEEP_MS` (90 days), "found nothing" for `KEEP_NONE_MS` (30 days); the listener's own choice always. Without a map, for the session.
- **The franchise** (`assemble`): the entries in airing order (`orderEntries`; crossovers, `isCrossover`, after the franchise's own), each entry's themes OP, ED, inserts by number (`orderThemes`). Each theme gains `entry`, `mine` (`mineIn`: match.js `inLibrary` over the library, then over `extraIndex`, its covers as the songs they cover and its unsure uploads as the parser read them; `mineHow` is `recording`, `version` or `cover`), `alsoIn` (the later entries that use it again; the song is listed once, in its first entry), `firstIn` and `current` (the song the lane was opened from).
- **Soundtracks** (`albumsFor`): iTunes albums with the work's name in their title, from an artist the library credits for the work, or else of a soundtrack, anime or game genre (iTunes also finds The Beatles' "White Album" for "White Album 2").
- Pure helpers, each tested: `workTracks(tracks, work, M)` (the library's tracks of a work, its spellings read loosely), `workKind(tracks)` (the commonest scene of `WORK_SCENES` among them), `titleLookable`, `titleQueries`, `probes`, `verify(themes, tracks, trackId, o)`, `rankCandidates`, `bestSeries(list, work, M)`, `titleMatches`, `fresh`, `keysOf`, `isCrossover`, `orderEntries`, `orderThemes`, `assemble`, `extraIndex`, `mineIn`, `albumsFor`, `demoFranchise(track, lib, o)` (the demo's invented franchise: its library songs and invented missing themes, shaped like real ones, `videoId` null).

## artists.js

`TS.artists`: an artist or band of the library on iTunes, Deezer and AnimeThemes, checked against the listener's own songs, with their top songs, their releases (albums, EPs, singles and compilations, and how many songs of each the library has) and the anime songs they sang. It feeds Explore's "artist or band" lane and its album dialog. It asks only the clients it is given (sources.js); `demo` asks nothing.

```js
var artists = TS.artists.create({
	it: S.iTunes(http, cache), dz: S.deezerFinds(TS.discover.createDeezer({ transport: TS.discover.sandboxTransport() }), cache), at: S.animeThemes(http, cache),
	M: TS.match, L: TS.library, index: function () { return libIndex(); }, tracks: function () { return L.list(lib); },
	map: { get: function (k) { return store.get(k); }, set: function (k, v) { return store.set(k, v); } }, now: function () { return Date.now(); }
});
artists.find('yorushika', { signal: ctl.signal }).then(function (found) {      // null: no store knows them
	return artists.discography(found, { signal: ctl.signal });                 // { top, albums, eps, singles, compilations, anime, errors }
}).then(function (d) { return artists.albumTracks(d.albums[0]); });            // { tracks, have, total }
```

| Name | What it is |
| --- | --- |
| `create(deps)` | The artists object. `deps`: `it` (sources.js `iTunes(http, cache)`), `dz` (`deezerFinds(dz, cache)` or null), `at` (`animeThemes(http, cache)` or null), `M` (match.js), `L` (library.js), `index()` (match.js `index` of the library, for `mine`), `tracks()` (the library's tracks, a list or a map), `map` (`{ get(key) -> Promise<value or undefined>, set(key, value) -> Promise }`, a lasting kv; null keeps everything for the session), `now()`. A source left out is never asked. |
| `storeFor(name, native, tracks)` | The iTunes store to look in first: `'JP'` for a name or native name in Japanese script, or when most of the tracks (more than half) are Japanese (`lang` `'ja'`, or no `lang` and a title in Japanese script) or from an anime, a game or a visual novel (`scene` `'anime'`, `'game'`, `'vn'`); otherwise `'US'`. |
| `albumType(album)` | `'album'`, `'ep'`, `'single'` or `'compilation'`, for a title (a string) or `{ title, trackCount, type, source }` (`type`: what the source said; `source: 'deezer'`, or `stated: true`, means the source states its types, so its "album" stands whatever the count). The rule is below. |
| `mergeAlbums(lists, M)` | Albums from several lists (iTunes's, then Deezer's) as one list, newest first, each release once. `M` is optional (with it, base titles meet too). Plain albums or the iTunes and Deezer clients' own (given a `source`) are typed on the way. Pure: the lists given are left as they were. |
| `verify(titles, tracks, M)` | Does a store's artist have one of our songs? `titles`: its song or release titles (strings, finds or albums); `tracks`: the library's songs by the artist. `{ sure, score, hits: [{ id, title, as }] }`. A title of seven letters or more counts 1, a shorter one 0.5, a generic one nothing; 1 is sure. In `find`, a store's artist named as ours whose only common title is a short one is sure too when the library has just that one song by them (Kalafina's "Magia"). |
| `namedAlike(name, ours, M)` | Is a store's artist named as ours (any name of `ours`)? An equal fold or loose key: case, spaces, accents, a leading "the" and romanisation do not matter, kana are read as romaji ("Yorushika" meets its katakana); "Aoi Minato Trio" is not "Aoi Minato". |
| `RECHECK_MS`, `MISS_MS` | 90 days (a store's artist is looked for again), 30 days (how long "not there" is believed). |
| `SONGS`, `DZ_TOP`, `TOP`, `ITUNES_MAX` | 100 iTunes songs and 50 Deezer top songs read for an artist (the check and Top songs share each answer), 30 top songs given, 8 iTunes requests at most in one `find`. |

**The calls.**

| Call | What it does |
| --- | --- |
| `find(who, { signal, sources })` | `who`: a library artist key, or `{ key, name, native }` (a name alone is folded into a key). The artist on each source, from what is kept when nothing is due, else by asking the sources that are (at once; each on its own line). `sources` (optional, some of `'itunes'`, `'deezer'`, `'animethemes'`) asks only those now and gives the others as they stand, so a lane that needs only Deezer's artist does not wait for iTunes. `-> Promise<found or null>`: null when no source has them (or `who` names nobody). When nothing is found and a source failed, it rejects with that source's `SourceError`. |
| `discography(found, { signal })` | `-> Promise<{ top: [find], albums, eps, singles, compilations: [album], anime: [find], errors }>`, each list of releases newest first. |
| `albumTracks(album, { signal, from })` | `-> Promise<{ tracks: [find], have, total }>`: the release's songs, each with `seq`, `disc` and `mine`; `have`: how many library songs it holds (each once); `total`: its songs. `from: 'itunes' or 'deezer'` reads that store's copy first. |
| `reject(who, source, id)` | "Not this artist": that source's artist (`source` `'itunes'`, `'deezer'` or `'animethemes'`; `id` its id, or its slug on AnimeThemes) is never chosen for this one again; the source is asked again on the next `find`. `-> Promise<found or null>`, as it now stands, nothing asked. |
| `confirm(who, source, id)` | "Yes, this one": that source's artist is the one, and sure, from now on, and never looked for again. `id` may be a candidate itself. Confirming takes back a rejection of it. `-> Promise<found or null>`. |
| `demo(artistKey, lib)` | For `?demo=1`: the demo library's artist (demo.js) with invented releases, top songs and anime songs, as `{ found, discography }` shaped exactly as the real ones; null when the library has no such artist. No network, and the same answer every time for the same artist. |

A `SourceError` from the sources (or one of this file's own, with `host: 'artists'`: `'aborted'`, `'bad'` for a source that is not one of the three, `'not-found'` for a release no source can read) is what a call rejects with.

**What `find` gives.**

```js
{ key, name, native,
  itunes: { id, name, country, sure, why, link, genre } | null,     // country: the store it was found in
  deezer: { id, name, sure, why, picture, fans } | null,
  animethemes: { slug, name, sure, why } | null,
  sure,                                                              // one of the sources is sure
  candidates: [{ source, id, name, alike, country, genre, link }     // iTunes's; Deezer's carry picture and fans
               ...],                                                 // AnimeThemes's: id is the slug
  at,                                                                // when the sources were last asked (0: never)
  errors: [{ source, code, message }] }                              // sources that failed this time
```

`why` says what made a source's artist sure: `'title'` (one of their songs is ours), `'album'` (one of their releases is named as one of our songs), `'twin'` (their releases are the sure store's), `'confirmed'` (the listener said so); `''` with `sure: false` is an equal name only (probable). `candidates` are the other artists the sources gave that are named alike (`alike: true`, first) or whose name holds ours or is held by it, the chosen ones and the rejected ones left out: for a "Not this artist" choice.

**Finding, in order.**
- **iTunes** is asked in `storeFor`'s store, then in the other; in each, by the name, then by the native name. Of the artists named alike (`namedAlike`), the songs of two at most are read per store and name (`artistSongs`, `SONGS`, kept 7 days), the first whose titles `verify` is sure of is taken. Without one, the releases of the first artist named alike are read once (`albums`, kept 3 days, and the discography's anyway). Without one either, the first artist named alike is probable. At most `ITUNES_MAX` requests in all (sources.js spaces them 3.1 s apart); usually two (a search and the songs). With no library songs to check against (a name alone), the first artist named alike is taken at once, probable.
- **Deezer** the same way, by the name then the native name: of the artists named alike (three at most), the first whose top songs (`DZ_TOP`) or releases hold one of ours; else the one of that name with the most fans, probable.
- **AnimeThemes**: the artists search (`search(q, ['artists'])`), by the name then the native name; the first named alike is taken, and their songs (`artist(slug)`, kept 30 days and wanted for the discography anyway) say whether it is sure.
- **The twin check:** when one of iTunes and Deezer is sure and the other only probable, their release lists are compared (as `verify` counts); a title they share makes the probable one sure too (`why: 'twin'`).
- **`verify`:** each of our songs met (a title key in common: match.js `titleKeys` and `signature`, and the title with every bracket taken out, so "Blue Signal (Starfall Odyssey)" is also "Blue Signal") adds the strength of its best key once; one song uploaded twice counts once. A key of two kanji or Hangul or more, or of seven letters or more (kana counted as romaji), is worth 1; a shorter one 0.5; Intro, Outro, Interlude, Opening, Ending, Theme and the like 0. Sure at 1: one telling title is enough, a short one ("Home") needs another song. This is the guard against the namesake: an artist of the same name with none of our titles is never sure.
- **The library's songs by the artist** are those with the artist's key, and those with the artist among the people of their credit (`L.people`: duets, "feat.", voice actors), so a duet counts as evidence and as `mine`.

**What is kept.** Under `artist:<key>` in `map` (else for the session): `{ key, name, itunes, deezer, animethemes, sure, at, no: ['itunes:<id>', 'deezer:<id>', 'animethemes:<slug>'], yes: { source: { id, name, country, ... } }, checked: { source: ms }, cands }`.
- A source is asked again when it never was, when its artist was found `RECHECK_MS` (90 days) ago or more, or when it had nobody `MISS_MS` (30 days) ago or more. "Not there" is never kept for ever.
- A source that fails (no answer, a rate limit, a server error) is left as it was and asked again on the next `find`; the others' answers are kept. An abort keeps nothing.
- The listener's answers win: a confirmed artist is used as it is and its source is never asked again; a rejected one is never chosen or offered, whatever a later check finds. Answers given while a `find` is on its way still win when it ends.
- Without `map` everything lasts for the session (the object's lifetime). The sources' own cache (sources.js) still keeps their answers.

**Releases.** iTunes's `albums` (when its artist is used) and Deezer's `albums` (likewise), typed and made one list:
- **The type (`albumType`), in order:** a compilation when the source says so (iTunes's collection type, Deezer's "compile") or the title reads like one (Best of, The Best, Greatest Hits, Anthology, Retrospective, The Essentials, The Singles, Singles 1990-2000, B-Sides, Rarities, The Collection, Complete Works; besuto, zenshuu, sakuhinshuu in Japanese); then the title's " - Single" or " - EP"; then "EP" as a word or "mini album" (and mini arubamu); then what the source said (single, EP; album only from a source that states its types, Deezer); then the count: 1 to 3 songs a single, 4 to 6 an EP unless the title says album, more (or unknown) an album. iTunes calls every release a collection of type Album and its client calls up to three songs a single itself, so a plain "Album" from iTunes never stands against the count. Each release says what decided (`typedBy`: `'name'`, `'store'`, `'count'` or `'guess'`).
- **One release (`mergeAlbums`):** two entries are one when a title key meets (the fold of the title, or of its base title) and their dates are at most two days apart (time zones), or they share the year and the type; a release joins the entry of its own type first. So an album and its title song's single stay apart, and a release one store lists twice (clean and explicit) is one. The first list's entry leads (its id, key, link and cover; within one store the one with more songs); the other store's id joins `ids`; a type from a title or a store beats one from a count; a compilation stays one.
- **Which sources:** the sure ones, or all when none is sure; AnimeThemes whenever it has the artist.
- **`guest`:** a release credited to someone else (not our names, not the stores' names for the artist, not the credit most of iTunes's releases carry, which is how a kanji credit is recognised) is a guest appearance, still listed in its group.
- **`have`:** null until `albumTracks` has read the release in this session (`haveFrom: 'tracks'`), unless the library's own `album` field names it (`haveFrom: 'library'`, a lower bound).
- **Top songs:** iTunes's `artistSongs` (Apple ranks them by popularity), then Deezer's `top`, each song once (its base title and version), no instrumental or karaoke, `TOP` at most; each with `mine`.
- **Anime songs:** AnimeThemes's `artist(slug).songs`, newest first, each with its `work`, `workKey`, `role`, `seq` and `season`, and `mine`.
- **`mine`** is match.js `inLibrary`'s track id when it is the same song and not another version of it (a TV size or other cut is ours; an instrumental, a live take or a remix is not), else null.
- **`errors`:** a part that failed (`{ source, code, message }`); the rest is given. When every part fails, the call rejects with the first error.

The album (every release has the same fields):

```js
{ key: 'it:album:<id>' | 'dz:album:<id>', id, title, year, date, type, typedBy, trackCount, cover, link,
  source: 'itunes' | 'deezer', have: n | null, haveFrom: '' | 'tracks' | 'library',
  ids: { itunes, deezer }, country, artist, genre, guest }
```

**An album's songs.** `albumTracks` reads the release's own source (iTunes's `albumTracks` in the store it was found in, kept 90 days; or Deezer's), or `from`; when that fails and the other store has the release too, the other's copy. `seq` is the song's number on its disc (Deezer's songs are numbered in order), `disc` counts the discs, and the count is remembered for the release's `have` in later discographies. A release that carries its songs (`tracks`, the demo's) is answered from them.

**The demo.** `demo(artistKey, lib)` builds, around the demo library's own songs by that artist (most played first): three singles (two of them its most played songs; a Japanese artist's with the instrumental as well), one to three albums of ten songs with three of ours each, two EPs, and a best-of once there are ten songs or more; years across the library's own years. Top songs are twelve from those releases, two of ours (most played first) to one invented; an anime artist (Kumori Station in the demo) gets AnimeThemes songs for their works and two invented anime. Every song is a sources.js find with `videoId` null, an `it:track:<n>` or `at:song:<n>` key, `mine` (the library's id for ours, null for an invented one) and `demo: true`; invented titles use words demo.js never uses, so they never meet a library song. Ids are invented numbers (9,000,000,000 and up on iTunes). `found` has a namesake among its candidates for "Not this artist". `discography` and `albumTracks` answer the demo's artist from memory afterwards, and an object that did not make it gives an empty discography rather than ask a source for invented ids.

**Tests.** The `artists` section (test/artists.section.js, 81 checks): `storeFor`; `albumType` over 29 names; `mergeAlbums` (dates two days apart, an album and its single, a release listed twice, the type that wins, purity); `verify` (a bracket, a short title, generic titles, kana and romaji, one song uploaded twice); `namedAlike`; `find` against the fixtures through the in-process fake (the Japanese store first, two iTunes requests, the namesake trap on Deezer, AnimeThemes, candidates, what is kept, only some sources, a name alone is probable, the twin check) and against a fake of iTunes's stores (two artists of one name, an equal name with none of our titles, the other store, the native name, a release as evidence, nobody); the time limits (30 and 90 days, another session, no map); corrections; failures; abort before and in flight (iTunes, and Deezer, which takes no signal); `discography` (groups, merging, `have`, top songs, anime songs and duets, guest appearances, one more iTunes request after `find`); `albumTracks` (instrumentals, discs, Deezer, `from`, the other store when one fails); the demo (the same answer, the shapes, no network).

### Lines for the rest of README.md

The file table, after `channel.js`:

| `artists.js` | An artist or band on iTunes, Deezer and AnimeThemes, checked against the library's songs: their top songs, albums, EPs, singles and compilations (how many songs of each you have), the anime songs they sang; invented ones for the demo. | no |

The UMD list: add `artists` after `channel`. The script order, after `channel.js` (before `app.js`):

```html
<script src="artists.js"></script>      <!-- needs match, library, sources -->
```

The Tests paragraph's section list: `artists` (in test/artists.section.js: the store, typing and merging releases, the check against the library, the cache's time limits, corrections, abort, the demo).

## credits.js

`TS.credits`: who wrote a song, from MusicBrainz, and the other songs a composer or lyricist wrote.

```js
var C = TS.credits;
var credits = C.forCtx(pageCtx);                 // or C.create({ cache, index, base, fetch, now, sleep, onLine, agent, gapMs })
credits.of(track, { signal })                    // -> Promise<null | result>
credits.byPerson(person, { signal })             // -> Promise<[find]>   person: { id, name } (a result's composer ...)
C.line(result)                                   // -> 'Music: X . Lyrics: Y . Arranged by Z' (middle dots)
C.paint(el, ctx, track)                          // the song page's line into el; hidden when there is none
C.lane(ctx, seed, { compact })                   // a lanes.js spec for Explore: id 'credits', "More by <composer>"
```

The result:

```js
{ recording: { id, title, artist, durationSec }, work: { id, title } | null,
  composers: [{ id, name, native }], lyricists, writers, arrangers,
  performers: [{ id, name, native, roles: ['lead vocals', 'guitar' ...] }],
  sure, score, why }      // sure: match.js score STRONG (7) or more; why: match.js's reasons
```

`name` is in Latin letters: a name in another script is read from MusicBrainz's sort name ("Kajiura, Yuki" is Yuki Kajiura) and the name itself is kept as `native`.

**A song** (`of`): one recording search (`searchQuery`: any of the base title and `titleAlt`, by any of the credit, the native name and each person in the credit, as Lucene phrases), then the best recording with `inc=work-rels+artist-rels`, then its work with `inc=artist-rels` (the composer and the lyricist are on the work). The best recording (`rankRecordings`) is one match.js `sameSong` calls the same song with the artist (or a person of it) as part of the evidence, so an equal title by another artist never passes; then the same recording (lengths within 4 s), the track's own version (no live take or TV size for a studio upload), not a video, on most releases, the best search score, released earliest. When it is linked to no work, the next one is read (`workOf` prefers a whole performance to a part of a medley). Three requests a song, five at most. `relationsOf` puts the work's composer, lyricist and librettist, writer and arranger, and the recording's arranger, instrument and vocal arranger, orchestrator, vocal, instrument, performer, orchestra, conductor and chorus master in their lists, each person once (a performer with every role). Kept under `mb:credits:<artist>|<base title>[|<version>]` (`keyOf`) for `KEEP_MS` (30 days), "nothing" for `KEEP_NONE_MS` (7 days), in the cache it is given (sources.js `createCache`; the page's `ctx.cache()`), so another upload of the same song asks nothing.

**A person's songs** (`byPerson`): one work search (`arid:<id>`, `WORKS` (10); MusicBrainz ranks the most recorded works first), the works they composed, wrote or wrote the words of (`worksOf`; one they only arranged is left out), then recording searches by id (`ridQueries`: `rid:(...)`, 100 a search, two at most, the works taking turns), and for each work the original performer's recording (`findsOf`): the artist whose recordings of it are on most releases (a cover is on one or two), then their recording that is no other version, on most releases, released earliest. Two or three requests, kept under `mb:person:<id>` 30 days. Each is a sources.js find: `key: 'mb:rec:<id>'`, `videoId: null`, `source: 'musicbrainz'`, `ids: { mb, mbWork }`, `album` (the first release), `year`, `durationSec`, `people`, `why: [['credit', 'music by X']]` ('words by', 'written by'), and `mine` (`markMine`: match.js `inLibrary`, the same song and not another version of it; new objects, the cached ones untouched).

**The lane** (`lane`): title "More by <person>" once loaded ("More by its composer" before), MusicBrainz's badge, the credits line as its sub line, cards (three rows in the now-playing panel, with See all), `lazy`. The person (`personFor`) is the first composer, else a writer, else a lyricist, one who is not the song's own artist first (a singer-songwriter's lyricist partner rather than the artist lane again). The song itself is left out. Empty: "MusicBrainz does not know this song yet.", "... knows this song but not who wrote it.", "... has no other songs by X.". Unavailable for an artist page's seed or a song without an artist and title. `o.credits` (a `create()` object) replaces `forCtx(ctx)` (the tests).

**Manners** (`createLine`): requests go through sources.js `createHttp` with one line, `musicbrainz` (`BASE`, `https://musicbrainz.org/ws/2`, or `ctx.endpoints().mb`): one at a time, `GAP_MS` (1.1 s) apart; 2.2 s where the browser sends our User-Agent (`AGENT`, `TrueShuffle/1.0 ( https://nietztein.github.io/misc/101-true-shuffle/ )`), since that costs a CORS preflight each time (Firefox; Chrome and Safari drop the header, and MusicBrainz sees the page's Origin). MusicBrainz's preflight answer allows `User-Agent` (`Access-Control-Allow-Headers: Authorization, Content-Type, User-Agent`, checked 2026-10-11). A 503 (MusicBrainz's "busy", seen twice that day) or 429 waits 4 s and tries again, three tries in all, then rejects with a SourceError `'rate'`, host `'musicbrainz'`. No cookies, no referrer, only the artist and song names (never a video id).

**The demo** (`demoCredits(track)`, `demoPerson(person, lib)`; `credits.demo`, `credits.demoPerson`): invented credits for a demo track (its artist's composer, a lyricist and an arranger from six invented names, the same every time) and an invented person's songs: the demo library's songs they are credited with (`mine`) and three invented ones (`videoId` null), with words demo.js never uses. The lane and `paint` use them under `ctx.demo` and ask nothing.

Pure helpers, each tested: `searchQuery`, `keyOf`, `latinName`, `creditText`, `creditNames`, `candidateOf`, `rankRecordings`, `workOf`, `relationsOf`, `personFor`, `worksOf`, `ridQueries`, `findsOf`, `markMine`, `line`. A credits object also carries its `http` (sources.js `stats()` for the curious).

Checked against the real MusicBrainz on 2026-10-11 (by hand, ten requests): Kalafina's "Magia" gave the studio recording (not the DJ-mix excerpt, the live takes or a namesake's "Magia"), Yuki Kajiura as composer, lyricist and arranger, and seven performers; Yorushika's "Tada Kimi ni Hare" (with its `titleAlt` and native name; the romaji alone finds nothing) gave n-buna; Yuki Kajiura's songs came back by their original performers (Kalafina, FictionJunction YUUKA, Aimer, LiSA, See-Saw, Sayuri), not the covers.

MusicBrainz's data used here (relationships, recordings, works) is its core data, CC0.

## scrobble.js

**Not wired yet.** On 2026-10-11 every `api.listenbrainz.org/1/...` path answered a browser with a redirect to a 404 (a preflight cannot follow a redirect), so index.html does not load this file and Settings has no token field. When a browser check passes again (`validate-token` with a made-up token answers 401 with CORS), the hooks are: create the scrobbler at start (`token` from ToyKit `lbToken`, the store), `scrobbler.listened(trackOf(id), info)` in the controller's `onListened`, `scrobbler.playingNow(trackOf(player.id()))` on `playing`, and `TS.scrobble.field(pageCtx, scrobbler)` in Settings.

`TS.scrobble`: scrobbling to ListenBrainz, only with the listener's own token. Without it nothing is sent, nothing is kept, and ListenBrainz is never asked.

```js
var SC = TS.scrobble;
var scrobbler = SC.create({ token: function () { return ToyKit.load(SC.TOKEN_KEY, ''); }, store: store });   // + fetch, now, onLine, setTimer, clearTimer, base
scrobbler.playingNow(track)        // a song starts            -> Promise<{ sent, reason }>
scrobbler.listened(track, info)    // player.js onListened     -> Promise<{ queued, sent, reason, waiting }>
scrobbler.flush()                  // send what waits          -> Promise<status>
scrobbler.status()                 // { on, sentToday, sent, waiting, dropped, lastError, retryAt, lastSentAt, text }
scrobbler.pending()                // the listens waiting (copies)
scrobbler.clear()                  // forget what waits (the token was taken away)
scrobbler.tokenChanged()           // a new token: forget a refusal, send what waits
scrobbler.destroy()
SC.validate(token)                 // GET /1/validate-token -> Promise<{ ok, user, code, message }>, never rejects
SC.field(ctx, scrobbler)           // Settings' token field (a node)
```

- **The rule** (`counts(info, track)`, `needed(durationSec)`): a listen is half the song or 4 minutes, whichever comes first; the track's length when the player had none; an unknown length counts at 4 minutes, or at 30 s when the song played to its end.
- **The listen** (`listenOf`, `metadata`, `body`): `{ listened_at, track_metadata: { artist_name, track_name, release_name (the track's album, when known), additional_info: { media_player: 'True Shuffle', submission_client: 'True Shuffle', submission_client_version, music_service: 'youtube.com', origin_url: 'https://www.youtube.com/watch?v=<id>', youtube_id, duration_ms } } }`. `listened_at` is when the song started (the time "playing now" saw it, else the end less what was heard). A song without a sure artist (only the channel's name, a guess) is not sent (`skipReason`: `'no-artist'`, also `'no-title'`, `'short'`, `'no-track'`).
- **Playing now**: `listen_type: 'playing_now'`, no `listened_at`, never kept. A resume after a pause is the same play (the song was not left yet) and the same song within 30 s is not sent again, so the page may call it on every "playing" the player reports.
- **The queue**: listens wait in the store under `KEY` (`scrobble`: `{ queue, day, sentToday, sent, dropped, lastError, retryAt, tries, lastSentAt, badToken, single }`; the token itself is never stored there, only a fingerprint of a refused one) when they cannot go: offline, refused, ListenBrainz down. `KEEP` (500) at most, the oldest dropped first. They go `BATCH` (50) a request as `import` (one alone as `single`), when the page is back online (the `online` event), at the next listen, or after a wait that doubles from 30 s to 30 min (5xx, no answer, 404) or that `X-RateLimit-Reset-In` names (429, or a success that leaves no allowance). A 400 sends the batch again one by one and drops the listen ListenBrainz refuses. A 401 stops sending with that token (kept listens wait for a new one; `tokenChanged`).
- **Settings** (`field`, `statusText`): a password field; the token is kept (ToyKit, this browser only, under `TOKEN_KEY`, `lbToken`) only once `validate` says ListenBrainz knows it, which also proves this browser may talk to ListenBrainz; an empty field turns scrobbling off and clears the queue. Below it the status: "12 listens sent today; 2 waiting", "Off: no ListenBrainz token.", with the last problem in words. `looksLikeToken` (a UUID) is checked first. `localDay` is the listener's own day for "today".
- **What is sent**: to `API` (`https://api.listenbrainz.org`) only, `POST /1/submit-listens` with `Authorization: Token <token>` and JSON, no cookies, no referrer. `CLIENT` and `VERSION` name the player.

**What was found about ListenBrainz on 2026-10-11** (13:44 to 14:11 UTC, three checks): every API path on api.listenbrainz.org answered 308 to the same path with a slash, which answered 404 (with `Access-Control-Allow-Origin: *`); `/1/` itself served the website's HTML; a POST to `/1/submit-listens` with a made-up token answered 404. A browser does not follow a redirect in a CORS preflight, so on that day a browser could neither validate a token nor submit a listen. This looked like ListenBrainz's own routing being broken (its documentation still gives `/1/submit-listens`, and its website's banner said statistics were unstable), not a CORS policy; it could not be confirmed that the preflight passes once the API is back. Nothing breaks meanwhile: `field` keeps no token that `validate` cannot check, so nothing is queued or sent; with a token kept earlier, listens wait in the queue and are tried again with the doubling wait.

## recs.js

`TS.recs`: the pure half of For you. What the listener's own songs say they like (the taste profile), which found songs a lane shows, and the small bookkeeping a feed needs (what was shown, what was touched, the last visit, the anime season). Nothing here touches the page, the network or the store, except `migrateStore`, which takes a store.js store.

| Name | What it is |
| --- | --- |
| `profile(tracks, history, now)` | `{ songs: [{ id, w }], artists: [{ key, name, w, ids }], works: [{ key, name, scene, w, ids }], channels: [{ id, name, w, ids }] }`, best first. `tracks`: the library (a list or a map; light tracks, blocked songs and clips are left out); `history`: store.js's listens. A song weighs `songWeight`; a group (an artist by `artistKey`, a work by its label, a channel by its id) the sum of its songs' weights over the square root of their number, so a big group counts, but less than its size. Songs and groups of weight 0 or less are left out; `ids` are the group's songs, best first; `name` is the commonest spelling; a work's `scene` its commonest scene. |
| `songWeight(track, recent)` | 3 if liked (four stars or more) + `min(plays, 20) / 4` + 2 if played in the last 30 days (`lastPlayed`, or a `play` in the history) - `skips / (plays + 1)`. |
| `nextSeed(profile, lastId)` | Your radio's next seed: the song after `lastId` among the `SEED_TOP` (12) top songs, round again; the first when there was none or it dropped out; null without songs. |
| `currentSeason(now)`, `previousSeason(nowOrSeason)` | `{ year, season }`, AniList's seasons (winter is January to March, UTC); the season before a moment or before a season (winter's is last year's fall). `seasonName(s)`: `'Fall 2026'`. |
| `filter(items, { have, heard, hidden, shown, now, limit })` | The items a lane may show, in their order: not what the library has (`have(find)`, by default the item's `mine`), not what was heard in the last 30 days (`heard(find)` gives true or the time it was heard), not what is hidden (`hidden(find)`), each song once (by key, by video, or by artist and title folded, so one song from two sources meets); an item shown `SINK` (3) times without a touch (`shown`: `{ key: n }`, or the book `seen` keeps) goes to the end. An item a check throws on is left out. `limit` cuts the list. |
| `dedupeLanes(lanes)` | Lanes in page order, each a list of items or `{ items }` or `{ groups: [{ items }] }`: each item stays only in the first lane that has it. The same shapes come back, new. |
| `seen(book, keys, now)`, `touch(book, keys)`, `counts(book)` | The shown book `{ key: { n, at } }` (kv `foryou:shown`). `seen` counts each key once more, unless it was counted in the last `SEEN_GAP_MS` (6 hours: a redraw, a quick return); entries older than 60 days are forgotten, 3,000 kept. `touch`: the listener played, previewed, saved or hid it, so it counts from nothing. `counts`: `{ key: n }`. None of them changes the book it is given. |
| `visit(visits, now)` | The kv record `feed:visits` (`{ last, prev }`) after a look at the page now, and `since`: the visit before this one (0 on the first). Looks within `VISIT_GAP_MS` (6 hours) are one visit. |
| `releases(albums, { now, since })` | artists.js releases (`date` `'YYYY-MM-DD'`) in three groups: `coming` (after today, soonest first), `fresh` (since the last visit, or the last `RELEASE_DAYS` (120) days on a first visit) and `earlier` (the rest of the 120 days; when the last visit was longer ago, everything since it, a year at most), newest first; `from` is the first day shown. |
| `byCompletion(franchises)` | Franchises (`{ title, have, total }`) with songs still missing, the closest to complete first: the fewest missing, then the larger share had, then the title. |
| `newSince(finds, mark)` | Uploads (`addedAt`) after a moment, newest first; one with no date is not new. |
| `sinceWords(ms, now)` | `'today'`, `'yesterday'`, a weekday within the last six days (`'Tuesday'`), else `'Oct 3'` (with the year when it is not this year's), by the local calendar. |
| `interleave(items, keyOf)` | One item of each key in turn, each key's own order kept: a preview list one artist at a time. |
| `ratioName(r)`, `RATIOS` | The New songs dial: `[['None', 0], ['Some', 0.5], ['Lots', 0.8]]`, and the nearest name for a ratio. |
| `migrate(kv, now)` | The old Discover hub's records as engine.js and artists.js keep them now: `discover:saved` joins `finds:saved` as finds (a video's `v:<id>`, else Deezer's `dz:track:<id>`, each once, newest first, 500 at most); `discover:hidden` (`{ folded name: true }`) joins `finds:hidden.artist` (`{ folded name: ms }`); `discover:ids` (Deezer artists checked against the library) become artists.js records in `finds:map` (`artist:<key>`, Deezer sure, checked now) for artists it has no record of yet. `-> { set: { key: value }, remove: [old keys] }`. Running it again changes nothing. `discover:recent` is left alone. |
| `migrateStore(store, now)` | `migrate` on a store.js store: reads the keys, writes what changed, removes the old ones. `-> Promise<{ set, remove }>`. Run it before engine.js `start()` (which reads `finds:saved` and `finds:hidden` once) and before anything reads `finds:map`. |
| `SEASONS`, `SINK`, `RECENT_MS`, `SEEN_GAP_MS`, `VISIT_GAP_MS`, `RELEASE_DAYS`, `SEED_TOP` | `['winter', 'spring', 'summer', 'fall']`, 3, 30 days, 6 hours, 6 hours, 120, 12. |

## foryou.js

`TS.foryou`: For you (`#/for-you`), new music from the listener's own listening. Every part of the page is a lanes.js lane that loads on its own (the lower ones when they come near the screen) and says why when it cannot: loading, ready, empty with its own sentence, an error with Try again, or unavailable with its fix. recs.js decides what a lane shows: not what you have (except where a check says so), not what you heard in the last 30 days, not what you hid, each song only in the first lane that has it (Airing today, Missing from your series, New from your channels, Because you play), and what was shown three times without a touch last.

| Lane | What it shows | From |
| --- | --- | --- |
| `radio` | Your radio: Start your radio (engine.js `radio` from one of the profile's top songs, the next press from the next one; the seed is remembered as `forYouSeed`), Preview new songs (Deezer's mixes of four top artists, songs you lack, one artist at a time, through the page's preview bar), the New songs dial (None 0, Some 0.5, Lots 0.8, kept as `newRatio`: it also sets Endless and every Start radio), today's YouTube units (engine.js `quota`), and the sources that are on (YouTube signed in or with a key, Deezer, iTunes, Last.fm with a key, AnimeThemes, AniList; an off one links to Settings) | engine.js, artists.js, sources.js `deezerFinds` |
| `season` | This season's anime and last season's, AniList's most popular first, as shelves of cards: the cover, the name, a chip per opening and ending (a check on yours); a chip or the card opens Explore on that song, the card's play plays its first opening | sources.js `aniList.season`, `animeThemes.season` (each kept a day) |
| `airing` | What airs today, in the listener's own day: a group per show (its episode and time) with its songs; Play them | AniList's `airingSchedule` (this file's own query, kept 3 hours), AnimeThemes's lists of this season and the last |
| `series` | Missing from your series: the profile's six top anime works, each with works.js `franchise` ("Kumori Station Anime 10/13" and a bar), the closest to complete first, the missing songs as rows; Add missing to queue, Preview missing (Apple's previews of six of them, looked up on the press) | works.js (`workOf`, `franchise`), read one at a time, each kept for the session |
| `releases` | New releases from your artists: the profile's eight top artists, one at a time, their releases of the last 120 days or since your last visit, and Coming for future dates, as shelves; a release opens its songs (Play all, Shuffle, Add to queue) | artists.js `find`, `discography`, `albumTracks` |
| `channels` | New from your channels: the curators channel.js `rank` finds (ordered by the profile), their uploads you lack since you last marked them seen (before that, since you last added one of their songs, 30 days at most), a group per channel ("2 new since Tuesday"), Play these, Mark seen, Mark all seen. Needs a sign-in or a key; without one it is unavailable and says how | sources.js `ytLists.uploads` (1 unit a channel, kept 6 hours), channel.js `uploadFinds` |
| `because` | Because you play X, for up to three top artists Deezer knows: the related artists you do not have (and have not hidden), two songs each, as cards; Start radio (from your top song by X, with the dial's new songs), Preview all. A second or third lane with nothing to show leaves the page | artists.js `find` (Deezer only), sources.js `deezerFinds.related`, `top` |
| `saved` | Saved for later (engine.js `saved`): Play all, Shuffle, Add to queue, Remove all (with Undo); a row's menu removes one | engine.js |
| `hidden` | What you hid (engine.js `hidden`): how many of each kind and some of their names, and a dialog to show any of them again (or everything) | engine.js |

| Name | What it is |
| --- | --- |
| `view(view, ctx, parts, query)` | The page: a header with the profile in one line, chips to jump to each lane, the lanes. `?lane=<id>` scrolls to one. Returns `{ lanes, profile }`. |
| `LANES` | The lane ids in page order: `radio`, `season`, `airing`, `series`, `releases`, `channels`, `because`, `saved`, `hidden`. |
| `joinSeason(aniList, animeThemes, season)` | A season's anime: AniList's list (by popularity) joined to AnimeThemes's (its themes as finds) by AniList id, else by the name folded; only anime with songs. `-> { anime: [{ id, slug, title, titleAlt, cover, popularity, format, season, themes }], without }` (`without`: AniList's anime left out). The themes are copies, so the cache's answers stay as they were. |
| `airingOf(schedule)` | One of AniList's `airingSchedules` as `{ id, title: { romaji, english, native }, cover, popularity, format, adult, episode, at (ms), season }`; a cover only from AniList's host; `season` null when AniList has none. |
| `AIRING` | The GraphQL query: a page of `airingSchedules` between two times, with each show's title, popularity, format, season, cover and `isAdult`. Seen on 2026-10-11: 25 shows in a day, most of them this season's, some years old, one adult. |
| `dayRange(now)` | Today in the listener's time zone: `{ from, to }` in seconds (AniList's `airingAt`), `day` `'YYYY-MM-DD'`. |
| `airingToday(D, now, signal)` | What airs today: every page of `AIRING` (three at most) through `D.http.post('anilist', ...)`, kept 3 hours in `D.cache` (`al:airing:<day>:<from>`), adult titles and broken entries left out. `D`: `{ http, cache, Src }`. An answer without a page is a SourceError `'bad'`. |
| `itunesPreview(D, find, signal)` | An anime song's 30-second preview: one iTunes search (`term`: the singer and the base title; the Japanese store for Japanese script), kept 30 days (`it:q:song:...`), the first result match.js `sameSong` calls the same song with a preview on Apple's host. `-> Promise<a copy of the find with preview, or null>`. |
| `demoSeason(lib, season, o)` | The demo's season: `o.n` (10) invented anime, each with an opening and an ending (now and then a second opening), the most popular first; with `o.sequelOf` (a demo track of an anime work) the first is that work's new season, opening with that library song. Two seasons in a row share no anime. Finds shaped as AnimeThemes's, no video, no picture. |
| `demoRelated(name, k, taken)` | The demo's related artists for lane `k`: four invented artists (none of a library artist's name, `taken`: `{ folded name: true }`), two Deezer-shaped songs each. |
| `stream(list, worker, { want })` | A lane that fills in as it goes: `worker(item)` over the list one at a time (each source keeps its own pace); `first` resolves at the first result (or the end), `on(fn)` hears each result and the end (null), it pauses while `want()` is false (the lane left the page) and goes on with `resume()`. `{ results, errors, done, i, count, first, on, resume }`. |

**Explore.** A found song has no page of its own, so explore.js opens one only after `remember(find)`. A theme chip or an anime card remembers its song on the click; for media.js's cards and menus the page remembers every found song it shows (by key) and does it on the click too (`go.explore`, a click listener on the page). Elsewhere media.js's cards still link a found song to Explore without remembering it, which opens "Nothing to explore" (seen 2026-10-11): media.js `card` and its menu's Explore should call explore.js `remember` (or `hrefOf`) on the click.

**What is kept.** The store's kv: `feed:visits` (`{ last, prev }`: the visit before this one dates the new releases), `feed:seen` (`{ channelId: ms }`: Mark seen), `foryou:shown` (the shown book), `foryou:names` (the names of what was hidden from this page, for the Hidden dialog, 400 at most). ToyKit: `newRatio` (the dial, shared with Endless and Start radio) and `forYouSeed` (the last seed of Your radio). It reads engine.js's `finds:heard`.

**Requests.** Nothing is asked until a lane comes near the screen. AniList and AnimeThemes are asked for two seasons (each kept a day) and today's schedule (kept 3 hours); Missing from your series reads at most six works one at a time (AnimeThemes allows 90 requests a minute; works.js keeps what it found for 90 days); New releases reads eight artists one at a time (iTunes allows about 20 a minute; artists.js keeps an artist for 90 days, the sources keep their answers); New from your channels costs 1 unit a curator (kept 6 hours); Preview missing asks iTunes once a song, only on the press.

**In the demo** nothing is asked of any service: the anime are invented around the demo library's own (its anime work gets a new season whose opening is your song), what airs today is four of them, Missing from your series is works.js's demo franchise, the releases are artists.js's demo discographies with a few moved to the last weeks and one coming, the channels' uploads are channel.js's `demoUploads`, the related artists are invented; previews and YouTube searches say they are not in the demo.

**Tests.** In the `recs` section (test/recs.section.js, 72 checks): the profile's weights and groups, the seed, the seasons, the filter (have, heard, hidden, once, the sink), dedupeLanes, the shown book, visits, releases' groups and windows, byCompletion, newSince, sinceWords, interleave, the dial, migrate and migrateStore (on store.js's memory store); and foryou.js: joinSeason over the fixtures through sources.js's own clients (test/fake-youtube.mjs in-process), airingOf, dayRange, airingToday (every page, adult titles out, the cache, a bad answer), itunesPreview (the same song from Apple's host only, the cache), stream (first, a pause, resume, the end), the demo's season and related artists.

## explore.js

`TS.explore`: any song, from the library or found, as a door to more music. `#/explore/<library id>` (or `#/explore/find/<find key>` for a found song) shows its lanes, the most specific first; each is a lanes.js lane that loads on its own and says why when it cannot (never blank).

| Lane | What it shows | From |
| --- | --- | --- |
| `work` | Its anime or series: every opening, ending and insert song of the franchise, a group per season or film, "You have 3 of 11", filters (All, Missing, Yours, Openings, Endings, Inserts), Play yours (free), Add the missing to the queue, and "Not this anime" when the match is only probable | works.js (AnimeThemes) |
| `mix` | YouTube's Mix of the song: read through a visible YouTube player only when asked ("Read the YouTube Mix"), the titles from oEmbed, Play the Mix | channel.js `readList`, sources.js `oEmbed` |
| `artist` | The artist or band: tabs for top songs, albums and EPs, singles, and anime songs they sang; an album card opens its songs (Play all, Shuffle, Add to queue); "Not this artist" when the match is only probable | artists.js (iTunes, Deezer, AnimeThemes) |
| `similar` | Songs like it by other artists: Last.fm's similar tracks with the listener's key (Settings), else Deezer's related artists' top songs; for an artist page, artists like them | sources.js `lastFm`, `deezerFinds` |
| `channel` | The uploads of its YouTube channel the library does not have, with a link to the channel's page; signed out, the channel's own page reads them | channel.js, sources.js `ytLists` |
| `library` | The library's own songs close to it: played together, from the same work, sounding close (shuffle.js `similar`) | the library |

| Name | What it is |
| --- | --- |
| `parseSeed(route)` | `{ kind: 'track', id }` for `#/explore/<id>`, `{ kind: 'find', key }` for `#/explore/find/<key>`, else null. |
| `seedOf(ref, ctx)` | The song behind a route as one shape for a library track and a found song: `{ kind, id, track, find, videoId, title, artist, sure, artistKey, native, titleAlt, work, role, year, channel, channelId, scene, lang, durationSec }`; null when it is not known. |
| `order(seed)` | The lanes it has, in this order: `work` (a work label, an anime scene, or a Japanese song with no scene), `mix` (a video), `artist` (an artist), `similar`, `channel` (not the artist's Topic channel), `library` (a library song). |
| `remember(find)`, `recall(key)` | A found song has no page of its own: exploring it keeps it for the session (sessionStorage). |
| `hrefOf(item)` | Where exploring an item goes: a library song by its id, a found song by its key, an artist seed to the artist's page. |
| `trail()` | The songs explored last (at most five), shown as crumbs at the top of the page. |
| `artistSeed(artist)`, `section(el, ctx, seed, laneIds)` | Some lanes inside another page: the song page shows `library`, `work` and `similar`; an artist page (and a channel page of mostly one artist) `artist` and `similar`. |
| `view(view, ctx, parts, query)` | The page: the trail, the song (Play, Start radio, Like or Save for later, Song details, Open on YouTube), chips to jump to each lane, the lanes. `?lane=<id>` scrolls to one. |
| `panel(box, ctx, { id, force })` | The now-playing panel's Explore tab (it replaced Like this): the same lanes, three rows each with See all, no Mix. It follows the song that is on, or stays pinned to one (the target button); it never rebuilds under the pointer: a song change then shows "Now playing changed, Show X". |
| `LANES` | The lane ids, most specific first. |

**Getting there.** The compass on the now-playing panel, Explore in a song's menu, E (the playing song; in a list, the focused one), the palette ("Explore the playing song"), and `#/discover?seed=<id>`, which now redirects here (`#/discover?artist=<key>` goes to the artist's page, which shows the artist and similar lanes).

**Keys (2026-10-11).** E explores, I edits (it was E), R starts a radio from the playing song, Shift+R repeats (it was R), B saves the playing found song for later. A toast says so once.

**In the demo** nothing is asked of any service: works.js and artists.js invent a franchise and a discography from the demo library, the channel lane uses channel.js's invented uploads, and the Mix and similar lanes say they are not in the demo.

## car.js

`TS.car`: car mode, and installing the page as an app. For a phone in a car: here, Chrome on Android playing over Bluetooth (A2DP and AVRCP) to a 2016 Toyota Camry, which has steering-wheel next and previous buttons but no CarPlay or Android Auto.

**Car mode is a re-layout, not a new player.** `enter(ctx)` adds `body.is-car` and a `#ts-car` box inside `#app`; CSS (injected once as `<style id="ts-car-css">`, on the app's tokens) hides the top bar, the sections, the main view, the player bar and the tabs, makes `#now` `display: contents`, and lays the same `#video` out with the car's controls around it. The iframe never moves in the DOM (moving it reloads it). Car mode is always dark: it sets `<html data-theme="dark">` and puts the reader's theme back on exit, also when the theme changes meanwhile.

| | Portrait | Landscape |
| --- | --- | --- |
| Strip | Exit, Test buttons, More; under them Screen on, Signal ok (and the voice line) | one row: Exit, the indicators, Test buttons, More |
| Player | `min(100%, 400px)` wide, 16:9, never under 210 by 210 | on the left, as wide as the height allows (at most 400) |
| Song | title 32 px, artist and work 22 px, "Next: ..." | on the right |
| Buttons | Previous 96, Play or Pause 120, Next 96; Like 80, Radio 80, New songs 80 | the transport on the right; Like, Radio, New songs under the player |

`layoutFor(w, h)` picks it: landscape when the window is wider than tall and at least 600 px wide; `compact` when short (sideways under 380 px tall: smaller strip buttons, tighter gaps; upright under 640). Toasts and dialogs keep off the player in both (`--car-cover-top`, `--car-cover-left`, `--car-toast-top` on the body). A tall window sideways (520 px or more: a tablet, a desktop) centres the whole block in two columns of at most 520 px. An open menu closes when the phone turns. Nothing covers the player: the drive checks `elementFromPoint` at its centre and corners at 390x844, 844x390 and 800x360.

**Getting there.** The player bar's More (Car mode), on a phone the Library hub (`#/library`), Settings > Car, the app icon's Car mode shortcut, or the address `#/car`.

**Start** is the big play button the first time (also the poster's "Press play"). From that tap: the media-key anchor starts (`transport.wake()`); `startPlan` decides: `keep` (it plays already), `resume` (the queue), `radio` (the queue is empty or over: a radio from the song that was on, else the last one played, else any library song), `nothing` (no music yet); the Screen Wake Lock is held; the page goes full screen (Settings, on by default) and turns sideways if asked (off by default; phones allow the lock only in full screen or in the installed app). After that the button plays and pauses.

**The screen stays on.** YouTube's player stops when the screen locks, so car mode keeps a Screen Wake Lock (`navigator.wakeLock.request('screen')`) from the moment it opens. `wakeKeeper({ nav, doc, onChange, retryMs, now, setTimer, clearTimer })` keeps it: `start()` asks; the browser lets the lock go when the page is hidden, and `visibilitychange` asks again when it is shown; a release while the page shows asks again at once (three releases within a second of being granted wait `retryMs` instead, 15 s); a refusal is tried again after `retryMs`; `stop()` lets go. `state()` is `off`, `asking`, `held`, `lost`, `denied` or `unsupported`; `held()`; `asked()` counts the requests.

**The strip says** (`indicators(s)`, pure): "Screen on" while the lock is held, else "Screen may turn off"; "Signal ok", "No signal · waiting 0:42" while the browser is offline (`navigator.onLine` and the `online` and `offline` events; the time counts up), "Weak signal" when the player has been buffering for more than `WEAK_MS` (8 s). No signal wins over weak signal. With voice commands on, a third line: Listening, Voice starting..., Heard: next (for three seconds), Microphone blocked, Voice: trying again, No voice commands here.

**Test buttons** swaps the next-up line for the transport's log (transport.js `log()`, newest first): "Press the wheel's next button", then lines from `logLine(entry)` such as `12:01:33 nexttrack ok`, `... ignored: the page was hidden` or `... not handled`. It needs `ctx.transport`; without it, or with media keys off, it says so.

**Voice commands** (Settings > Car or car mode's More; off by default, ToyKit key `carVoice`) use the Web Speech API (`SpeechRecognition` or `webkitSpeechRecognition`, `en-US`, continuous). The browser sends what the microphone hears to Google while it listens, and the switch says so. It listens only while car mode is on and the page is showing, and starts again after each pause in speech. `parseVoice(text)` turns what was heard into `next`, `previous`, `pause`, `play`, `like` or `radio`, or null: fillers such as "please", "the" and "song" are dropped, at most two words may remain (so talk and sung lyrics do not count), and with two command words the last wins ("play next" is next). Synonyms: skip and forward (next); back, last, prev (previous); stop, wait (pause); resume, continue, unpause (play); love, heart (like). In a browser without a microphone the line says Microphone blocked. Not tried on the phone yet: on some Android phones the music dips while the recogniser listens.

**New songs** cycles the radios' share of new songs, None 0, Some 0.5, Lots 0.8 (`RATIOS`, `nextRatio(v)`, `ratioName(v)`, the ToyKit key `newRatio` that `startRadio` already reads). While a radio plays (`engine.feeder().kind === 'radio'`) the radio goes on from the song that is on with the new share; otherwise it is kept for the next radio. Like and Radio act on the song that is on (`ctx.like`, `ctx.play.radio`).

**No previews in the car.** `previewsOff()` is true while car mode is on: `preview` and `pvStart` in app.js check it and say "No previews in car mode." Entering car mode also sends `U.bus.emit('audio', { by: 'car' })`, which stops a preview that is playing.

**Leaving.** `exit()` (Exit, More > Leave car mode, or Back from `#/car`) stops listening, lets the wake lock go, leaves full screen and the orientation lock if car mode took them, removes `#ts-car`, the classes and the variables, restores the theme, and, when the address is `#/car`, replaces it with `#/` (so Back does not open car mode again). The music goes on.

| Name | What it is |
| --- | --- |
| `enter(ctx)` | Turn car mode on. `ctx` is app.js's `pageCtx`; it uses `h`, `U`, `L`, `words`, `ctl()`, `player()`, `trackOf(id)`, `history()`, `lib()`, `play.radio(t)`, `like(id)`, `liked(id)`, `engine()`, `say(text)`, and the car's own `transport()`, `toggle()`, `next()`, `prev()` and `endless()` (without those it uses the controller). Returns false outside a browser. |
| `exit(opts)` | Turn it off. `{ nav: false }` leaves the address alone. |
| `active()` | Whether car mode is on. |
| `refresh()` | Draw it again now (the transport's `onLog` calls it, so Test buttons shows a press at once). |
| `previewsOff()` | True while car mode is on: the page plays no 30-second previews. |
| `view(view, ctx)` | The `#/car` page: a title, Open car mode, the help; at `#/car` it turns car mode on, and Back from there turns it off. |
| `settings(box, ctx)` | Settings > Car: Open car mode; Full screen when you press Start (`carFullscreen`, on); Turn the screen sideways (`carLandscape`, off); Voice commands (`carVoice`, off, with the Google sentence); Install app; In the car. |
| `install()` | Show the browser's install offer, kept from `beforeinstallprompt` (the page calls `preventDefault()` and keeps the event). Resolves `'accepted'`, `'dismissed'`, `'installed'` or `'unavailable'`. |
| `installState()` | `'installed'` (running as the app, or just installed), `'ready'` (an offer is kept: show Install app), `'menu'` (no offer: install from the browser's menu). |
| `HELP`, `HELP_STEPS`, `HELP_NOTES` | "In the car" as one text, as its five steps, and as its three notes. |
| `indicators(s)` | The strip's words: `{ screen, signal, voice }`, each `{ text, tone: 'ok' 'warn' 'bad' }` or null. |
| `parseVoice(text)` | A voice command or null. |
| `layoutFor(w, h)` | `{ name: 'portrait' or 'landscape', compact }`. |
| `wakeKeeper(opts)` | The wake lock, kept (above). |
| `logLine(entry)` | One line of the media-key log. |
| `startPlan(s)` | What Start does: `keep`, `resume`, `radio`, `nothing`, from `{ playerState, items, done, hasSeed }`. |
| `nextRatio(v)`, `ratioName(v)`, `RATIOS` | The New songs dial. |
| `KEYS` | The ToyKit keys: `carFullscreen`, `carLandscape`, `carVoice`, and `newRatio`. |
| `WEAK_MS` | 8000: buffering longer than this is a weak signal. |

**In the car** (`HELP`, shown in the help and in Settings > Car):

1. Pair the phone with the car once: turn on the phone's Bluetooth and add the phone in the car's Bluetooth setup.
2. In the car, choose BT Audio as the source (press AUDIO, then BT Audio).
3. Open True Shuffle on the phone: the installed app, or this page in Chrome.
4. Open Car mode: the player bar's More, or press and hold the app's icon and choose Car mode.
5. Press Start. The music plays, the screen stays on, and the steering wheel's buttons skip songs.

A page cannot choose where its sound goes: Android sends all media sound to the car while the phone is connected over Bluetooth. YouTube's player stops when the screen locks, so the screen has to stay on; car mode keeps it on while it is showing (a charger helps). If the wheel's buttons do nothing, press Test buttons in car mode and press next on the wheel: every press is listed. Media keys must be on (Settings, Playback).

**Installing the app.** `manifest.webmanifest`: `name` and `short_name` True Shuffle, `id`, `start_url` and `scope` `./`, `display: standalone`, `theme_color` and `background_color` `#0b0d10` (the dark `--ts-chrome`: ds.css has no background token), the icons `icons/192.png`, `icons/512.png` (purpose any: the logo's conic gradient on a dark rounded tile) and `icons/maskable-512.png` (full bleed, the mark inside the safe circle), and two shortcuts: Car mode (`./#/car`) and For you (`./#/for-you`; until For you exists that address shows the home page). index.html links it (`<link rel="manifest">`), with `theme-color` for light and dark and an `apple-touch-icon`. The icons were drawn on a canvas in the headless browser from app.css's `.ts-logo`.

**No service worker.** Chrome on Android has not needed one to install a page since Chrome 108 (112 on desktop): the requirement for a service worker with a `fetch` handler was dropped from installation from the menu ("Revisiting Chrome's installability criteria", developer.chrome.com, updated 2023-12-05), MDN lists none for Chromium (Making PWAs installable, modified 2026-10-06), and Chromium's own `InstallableParams` and `AppBannerManager` (main, read 2026-10-11) check no service worker at all, for the menu or for `beforeinstallprompt`. So there is no `sw.js`; offline, the installed app shows Chrome's own offline page. The Google sign-in's redirect returns to `./`, inside the scope, so it comes back into the installed app; this is still to be tried on the phone.

## pip.js

`TS.pip`: the mini player. On a desktop, Chrome and Edge (116 and later) can open a small window that stays on top of every other window: the Document Picture-in-Picture API (`documentPictureInPicture.requestWindow`). The listener can work in another program and still see the song and press the buttons.

**Only the controls go into the window.** YouTube's player never moves there: moving an iframe to another document reloads it, and YouTube's terms want the player visible in the page. It stays in the now-playing panel, at its size, and plays from there as before; the window holds the page's own controls. So it is not an audio-only view. The window shows the cover, the title, the artist and the anime or game (when there is one), Previous, Play or Pause, Next, Like, the seek bar with both times, and Back to the tab (the page's own `window.focus()`, called from that click, which is how Chrome documents it).

**Getting there.** The player bar's More (Mini player; Close the mini player while it is open), the palette (Ctrl+K), or W. Where the API is missing (Firefox, Safari, phones) none of them shows and W does nothing. The browser opens the window only from a click or a key, and the page asks for 360 by 150 (`SIZE`); Chrome may keep the size the listener gave it last time instead. If the browser refuses, the page says "The browser did not open the mini player."

**Keys in the window.** Space plays or pauses, N next, P previous, L like, the left and right arrows go `SEEK_SEC` (5) seconds back or on, W closes it. A focused button keeps Space and Enter, the seek bar its arrows.

**It follows the page.** app.js's `renderTransport` sends `U.bus.emit('bar', state)` each time it draws the bar's buttons (the song, a like, the queue or the play state changed), and the window draws itself again from pageCtx: `ctl()`, `trackOf(id)`, `player()`, `liked(id)`, `words`, `art(t)`, `prefs()`, and two entries added for it, `bar()` (whether the bar's Previous, Next and Play are enabled now) and `likeNow()` (the bar's heart, which also keeps a found song). The time comes from `player().on('time')`. The window copies the page's tokens and parts (`pickCss`) and adds its own `CSS`; it follows `<html data-theme>` through a `MutationObserver` on the page (so the kit's switch, another tab's and car mode all count), and lays itself out again when the listener resizes it (`layoutFor`).

**Closing.** Its own close button (or Chrome's back-to-tab button), W in it or in the page, More, the palette, or the page going away (`pagehide`). Every listener goes with it: the bus, the player's time, the theme observer, the page's `pagehide`. Nothing is kept and nothing is sent anywhere.

| Name | What it is |
| --- | --- |
| `supported()` | Whether `documentPictureInPicture.requestWindow` exists here. |
| `open(ctx)` | Opens the window (from a click or a key). A promise of true; false when it is not supported or the browser refused. `ctx` is app.js's `pageCtx`. |
| `close()`, `toggle(ctx)`, `isOpen()` | Close it (false when it was not open); open or close it; whether it is open. |
| `model(s)` | Pure. `s` is `{ song: { title, artist, work, durationSec } or null, hasMusic, state, bar: { prev, next, play }, liked, time: { current, duration } }`; returns `{ empty, title, sub, docTitle, play: { icon, label, disabled }, prev, next, like: { pressed, label, disabled }, seek: { max, value, pct, disabled, cur, dur, text } }`. "Nothing playing" or "No music yet" without a song; Pause while playing or loading; the song's own length while the player does not know it yet; the time never past the end. |
| `layoutFor(w, h)` | Pure. `'tiny'` under 300 wide or 130 tall (the title, the bar, the buttons), `'wide'` from 520 wide (the cover on the left, as tall as the window), `'tall'` from 300 tall (the cover on top), else `'compact'` (the cover beside the title: the 360 by 150 the page asks for). |
| `keyAction(key, { tag, ctrl, meta, alt })` | Pure. `'toggle'`, `'next'`, `'prev'`, `'like'`, `'back'`, `'forward'`, `'close'` or null. |
| `pickCss(ruleLists)` | Pure. From the page's rules (one list per style sheet), the text of those the window needs: `:root` and `:root[data-theme="dark"]` (both themes' tokens, from kit.css, app.css and ds.css) and the `ts-btn`, `ts-i`, `ts-art` and `ts-range` parts. |
| `CSS` | The window's own rules: the four layouts. |
| `SIZE`, `SEEK_SEC` | `{ width: 360, height: 150 }`; 5. |

**Tested.** The pure parts in the `pip` section of test.js; `pickCss` also runs there on the real kit.css, app.css and ds.css (every token the window uses is set, and its colours in both themes). Headless Chrome 155 opens a real window, and on 2026-10-11 a drive script (outside the repo) worked inside it as a window of its own: it opened from More with a real click, from W and from the palette; Play, Next and Like clicked in it, and Space, N, P, L, the arrows and W pressed in it, did what they say; the song, the work, the time and the heart followed the page (a like in the page reached the window); its seek bar moved the player; it followed a theme switch; at 360 by 150 (compact), 540 by 160 (wide), 300 by 100 (tiny) and 310 by 300 (tall) it was looked at in both themes, without sideways scroll; Tab reached its six controls, each with a ring; closed by W, More, its own close or a reload, it left none of its listeners on the page. An empty library shows No music yet with Play disabled; with the API taken away (as in Firefox and Safari) More, the palette and W offer nothing. The longer More menu still keeps off the player. Not tested: a desktop Chrome or Edge with a screen (whether Back to the tab brings the tab forward cannot be seen headless: the click runs and the window stays open), and the size Chrome gives the window the first time (headless opened 666 by 459, not the 360 by 150 asked for, and caps its area near 96,000 px).

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
| The player stays in the page. | pip.js's mini player window holds only the page's own controls. YouTube's player never moves into it (moving an iframe reloads it); it plays where it was, at its size. |
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

Since rescue.js, `moved: { oldId: { to, at } }` lists the uploads another upload took over from (see `movedTo`).

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
| `movedTo(lib, id)` | The upload a replaced video moved to (`lib.moved`, rescue.js `swap`), following later moves; `''` when it never moved. `upsert` never adds a moved id again, `reconcilePlaylist` keeps the upload it moved to in a playlist that still lists it, and yt.js `importInto` leaves it out. |
| `upsert(lib, videos, { playlistId, addedAt, now })` | Add or refresh from `yt.js` records. Never touches rating, counts, tags, corrections. `-> { added, updated }` |
| `markMissing(lib, ids, now)` | YouTube no longer returns these: `removed = true`. `-> ids` |
| `markUnplayable(lib, id, code, now)` | The player's verdict: 100 sets `removed`, 101 and 150 clear `embeddable`. `-> track` |
| `clearPlayerErrors(lib, ids)` | "Try the unplayable ones again." `-> ids` |
| `setPlaylist(lib, record)` | Add or update a playlist record. |
| `reconcilePlaylist(lib, playlistId, keepIds)` | Tracks not in `keepIds` leave the playlist. `-> { changed, orphans }` |
| `removePlaylist(lib, playlistId, { dropOrphans, keep })` | Takes a playlist out; deletes only untouched tracks that are in no other playlist, and only when asked. The optional `keep(id)` protects hand-picked songs and trim settings. `-> { changed, deleted }` (delete those ids from the store too) |
| `orphansOf(lib, playlistId, keep)` | Pure preview of the song ids that removal with `dropOrphans` would delete; uses the same protection rule as removal. |
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

Keys in use (for For you also `feed:visits`, `feed:seen`, `foryou:shown`, `foryou:names`): `library` (the meta), `queue`, `plan`, `quota` (`{ day, units }`), `bag:<signature>`, `import:<playlist id>` (written by `importInto`; left out of exports); since 2026-10-10 also `queue:hand` (songs queued by hand), `rating:beforeLike`, `songprefs` (trim and volume per song), and engine.js's `finds:queue`, `finds:saved`, `finds:hidden`, `finds:heard`, `feeder` and `quota:auto`. rescue.js keeps `rescue:moved:<old id>`: the old track whole, until it is put back. Nothing about his music is ever written anywhere else.

## player.js

```js
var p = TS.player.create({ kind: 'youtube', container: box, host: 'https://www.youtube-nocookie.com' });
var p = TS.player.create({ kind: 'mock', container: box, durationOf: fn, errorOf: fn, titleOf: fn, speed: 1, auto: true });

p.on(name, fn) -> off()
p.load(id, { autoplay, startSec }) -> Promise      p.play()  p.pause()  p.stop()  p.seek(sec)
p.volume(0..100)  p.muted(bool)  p.rate(0.25..2)   (each also reads back; the YouTube player keeps the rate across videos)
p.time() -> { current, duration }   p.listened() -> seconds really heard   p.state()   p.id()   p.destroy()
p.readList(listId, { index, retries, retryMs }) -> Promise<[ids]>   (cues a list on this player and reads its ids; between songs only)
```

`readList` is how a radio reads a YouTube Mix (`'RD' + videoId`) for free: the list is cued on the player that is already on the page (a cue stops what plays, so the controller calls it only between two songs, through `onBoundary`), `getPlaylist()` is polled, and an empty read is cued again from the next item (README, "What was found about YouTube lists"). While it reads, the cue's state changes are not passed on, so the page does not see a pause; the next `load()` returns the player to single videos. The mock answers from `opts.lists` (`{ listId: [ids] }`).

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
	onBoundary(id, state) -> promise,  // a song ended: a promise holds the next one until it settles (a Mix read), at most boundaryMs (6 s); a press meanwhile wins
	maxErrors, boundaryMs, now
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


### Backup restore (backup.js)

`TS.backup.confirm(data, name, ctx)` validates a backup before displaying its saved date and song, listen and playlist counts alongside the current library. Both Settings and file drop use it. Cancel has initial focus; Replace everything takes a temporary snapshot held only in memory. The confirmation also offers Save what is here first. A successful restore offers Undo for 15 seconds, restoring the entire snapshot; no merge is offered. Labels files keep their separate apply flow.

UX audit regression: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-audit.drive.mjs` checks trim Save, volume keys, restore cancellation and full snapshot undo, Mix builder focus, suggested-artist row bounds and local History dates in both themes at desktop and phone sizes.

The Mix builder retains keyboard focus when chips or order cards redraw; numeric, date and checkbox limits update its summary without rebuilding the controls. Needs attention gives unsure-artist readings a separate line with taller rows at both normal and compact density.


### Correction Undo and bulk values (edits.js)

`TS.edits.keep(ctx, ids)` captures distinct ratings and user corrections and returns an Undo callback. It derives restored labels and stamps rating changes afresh for Desk sync. Rating menus, stars and editor saves offer Undo; a second click of a star double-click is ignored. `remove(ctx, ids, close)` confirms removing corrections across multiple songs, shows the correction/song counts, preserves ratings and blocks, and offers Undo. `shared(lib, ids, key)` returns `{ mixed, count, value }` for bulk editor fields. Shared values appear in the form; Mixed values stay unchanged unless set. Saving an unchanged form adds no corrections, and clearing a shared field clears it across the selection.

Editor actions stay visible while scrolling. Dirty edits survive backdrop clicks; Cancel, Close and Escape still close explicitly. Escape in a nonempty genre search clears the search first. On touch, the editor initially focuses its heading unless a field was explicitly requested.

Song selection persists through ratings, likes, edits, sorting and filtering on the same page; songs hidden by a filter leave the selection. Escape or Clear selection clears it. On touch, a song menu offers Select, taps then toggle songs, and Done ends selection. Dragging, holding a row, dismissing an overlay, or stopping a recent scroll does not play it. Menus fit below a wide protected player and hide keyboard-only hints on touch.

The quick labeller and Not labelled counts use the same rule: no mood, kind, work or role yet. Naming an artist or fixing a title does not count as labelling. Automatically built queues prune songs labelled elsewhere when returning; deliberately selected queues retain their songs.

Browser regression for this batch: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-edits.drive.mjs`.

### Playlist safeguards and History (2026-10-12)

`playlist-actions.js` previews YouTube playlist removal with the exact deletion count and focuses Keep it. Songs held in hand-picked playlists or with trim/volume settings survive removal. Nothing changes on YouTube. Deleting a hand-picked playlist with songs asks first; every playlist delete has Undo, restoring its position, Focus and page. Playlist and song headers open their full action menu directly from the visible More actions button.

`history.js` draws History from fresh application state on each render, retaining local calendar grouping and the existing playback actions. Both browser modules load before app.js.

### Mix filters, sorting and Recently liked (2026-10-12)

`mix.js` draws the Mix builder, supplied fresh state and playback/save/reset callbacks. Rating shows and clears inherited `minRating`; Words shows and edits `text`. The summary explains songs excluded because they are blocked or cannot play. Smart-playlist previews count the whole library and distinguish playable songs; Home counts agree with Songs.

Song filters retain the chosen sort. Song, collection and playlist rows show the relevant plays, stars, year or date added. Reverse the order works from the accessible button; Title, From and Time headings also sort, and a second press reverses the order. The header stays below the compact player bar and keyboard reveal accounts for both.

Liked songs defaults to Recently liked: `likedAt` stamps the first transition to four stars or more. Four-to-five stars and blocking keep that date; unliking clears it, and a new like gets a new date. Undo, backup, Desk sync and Rescue preserve the date. Songs liked before dates were recorded fall back to Recently added after newer likes.

R starts radio from the playing song and says how many upcoming songs it replaced. Undo stops radio and restores the prior order and context, including the true-shuffle bag; starting a radio while already in radio or car mode reports status only. Shift+R repeats, and its button/menu hints follow the shared action vocabulary.
