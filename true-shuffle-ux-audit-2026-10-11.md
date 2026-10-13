# True Shuffle UX audit (2026-10-11)

A UX audit of True Shuffle (`misc/101-true-shuffle`), written down for picking up in a later chat. Fourteen auditor agents each took one lens and drove the app in headless Chrome: demo mode, plus a real-mode library with Google API hosts blocked, at desktop and phone sizes, in both themes. They read the code and reported evidenced findings with proposed fixes.

## Status

- **Audits:** all 14 lenses finished; 251 findings in all.
- **Verification:** 23 findings were reproduced independently by a skeptic agent. All of them were confirmed and none rejected. The rest are **not verified**: the run hit the weekly usage limit before checking reached them. The coverage critic and the planning step never ran.
- **Code base at the time:** main at `108f1e9`. app.js was 5,941 lines against the lint cap of 5,950 in test.js, so any app.js work needs room first. Either move a self-contained view (Settings, Your numbers, Needs attention, the preview bar, the palette) into a page module with no behaviour change, or raise the cap with a reason.
- **Screenshots and probe scripts** cited as evidence are in the session scratchpad: `C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/<lens>/` (and `.../ux/verify/<id>/`). That is a temp folder and may be cleaned up; the findings below stand on their own.

## Implementation progress (2026-10-12)

The audit is not fully implemented. The first batch fixes these reproduced findings:

- listening-desktop-1: button submit types now reach the DOM; Trim Save and Enter work; the modal volume slider shows its fill and thumb.
- listening-desktop-5: volume keys and wheel adjust the saved base volume during fades, per-song volume scaling and mute.
- library-1: file pick and drop share a validated backup preview with saved date and counts, Cancel focus, export-first action, danger replacement, and a 15-second Undo from an in-memory snapshot.
- library-7: unsure-artist readings have their own line and taller virtual rows; narrow desktop columns and phone touch targets keep them within the row.
- library-8: Mix builder cards/chips keep focus after redraw; limits update the summary in place; Clear, expanded choices and Reset restore focus; quick-labeller chip/select focus is retained appropriately.
- library-14: History uses local calendar days/months and friendly date labels. Queue playlist names also use the local day.

The second batch (2026-10-12) fixes five more originally verified findings:

- library-4: rating menus, stars and editor saves have Undo; each song's distinct rating/corrections are restored, with fresh sync timestamps. Double-clicking a star ignores the second click. Removing corrections across songs asks first with correction/song counts and offers Undo; channel-rule edits can be undone too.
- library-5: the page keeps selection by song id through redraws, edits, sorting and filtering, including multiple lists; hidden songs leave the selection. Undo toasts sit above the selection bar.
- library-6: touch row menus offer Select, row taps toggle selections, and Done/Escape ends selection. Menus shrink below a wide protected player and keyboard-only hints disappear on touch. Row-menu anchors survive selection redraws.
- library-15: Not labelled counts and the labeller use mood/kind/work/role, so an artist/title correction no longer excludes a song. Automatic queues prune songs labelled elsewhere when returning; selection-built queues remain deliberate.
- library-17: sticky editor actions, protection against accidental backdrop presses while dirty, genre-search Escape, visible shared/mixed bulk values, clearing shared fields, and Undo after Save. An unchanged bulk form adds no corrections. Touch initially focuses the heading unless a field was requested.

The third batch (2026-10-12) fixes three more originally verified findings:

- library-2: removing an imported YouTube playlist previews its exact deletion count and focuses Keep it. The library preview and removal share the same predicate; songs in hand-picked playlists or with trim/volume settings survive. Settings removal buttons identify their playlist.
- library-3: deleting a nonempty hand-picked playlist asks first; every playlist deletion offers Undo, restoring the original position, Focus and route. Smart and empty lists use Undo without a confirmation.
- library-10: playlist and song headers expose their full menu directly from the visible More actions button; Rename, Edit every song, Copy, Delete and song actions no longer open a nested menu from a detached button. Delete is separated and styled as destructive.

History moved into `history.js` without changing behavior, and confirmations live in `playlist-actions.js`; app.js remains under its 5,950-line cap. Regression: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-playlists.drive.mjs`, covering desktop/phone and both themes, direct menu placement, cancellation and focus, deletion/Undo including empty lists, hand-picked/trim/rating protection, exact counts and persistence after reload. Screenshots: `scripts/qa/out/shuffle-playlist-*.png`.

The fourth batch (2026-10-12) fixes four more originally verified findings:

- listening-desktop-6 / keyboard-power-15: Repeat title follows the shortcut vocabulary, the seven-character Shift+R hint appears in menus, and starting radio reports replacement and offers Undo. Undo stops the feeder and restores context, exact upcoming order and true-shuffle bag state without triggering an intervening automatic refill. Car mode and replacement of an existing radio remain status-only.
- library-9: filtering preserves the selected sort. Plays, stars, year, date added and like date appear in row text and accessible names. Songs, collections and playlists have an accessible reverse control; Title, From and Time headings sort and reverse on desktop. Headers stay below the compact bar, and keyboard reveal accounts for both.
- library-13: Liked songs defaults to Recently liked, using a separate join date. Changing four/five stars or blocking does not move it. Unlike/re-like, bulk ratings, rating/heart Undo, backup, Desk sync and Rescue preserve the intended date; older likes fall back to Recently added.
- library-20: Mix exposes inherited Rating and Words filters, preserves focus while changing them, and explains blocked/unplayable exclusions. Saved smart-list previews distinguish the whole-library count from playable songs; generated names include rating/text filters. Home counts match the library views.

The Mix builder moved into `mix.js`; app.js remains below its 5,950-line cap. Collection action order also now puts Focus beside Play and Shuffle, with Save and Open in mix builder in More (the optional library-10 refinement). New regression: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-filters.drive.mjs`, in both themes at desktop/phone sizes. It checks like order/Undo, inherited filters, live text edits/reset, chosen sort/filter/reverse, desktop headings and sticky/keyboard reveal, exact saved-playlist preview counts and real-mode incoming/outgoing sync. Screenshots: `scripts/qa/out/shuffle-mix-filters-*.png` and `shuffle-sort-*.png`.

Also reproduced and fixed while checking touch selection: phone-1 (drag/hold/menu dismissal/recent-scroll touches no longer play songs; Chromium's synthesized touch double-click is ignored). The keyboard context-menu rectangle in keyboard-power-16 is read from the connected row after selection redraw.

Fourth-batch validation: all 2,969 True Shuffle checks passed; smoke passed; all five browser regressions passed in light/dark at 1280x860 and 390x844. `ux-edits.drive.mjs` exercises bulk Undo, reset confirmation, shared values/no-op Save, selection through sorting/filtering, touch selection, drag/hold/recent-scroll suppression, ordinary taps, and artist-only corrections remaining in Not labelled. Screenshots: `scripts/qa/out/shuffle-editor-*.png` and `shuffle-selection-*.png`. An initial browser timeout and search timing assertion passed on rerun; timeout diagnostics now include filter/route/focus state.

Fourth-batch repo-wide run: **37 suites passed, 0 failed, 0 skipped** (`node scripts/test-all.mjs`). The blog index builder now includes only Git-tracked posts, matching the public server and Desk checks; untracked notes/posts stay on disk. A temporary Git fixture regression checks exclusion of untracked/nested files, inclusion after staging and missing tracked files. The blog/Desk failures from the previous batch are resolved.

The fifth batch (2026-10-12) fixes library-11: automatic smart lists are Recent focuses, capped at five plus an older active focus. They stay out of Yours, the sidebar, playlist counts, palette results and Desk sync. Focus reuses the same filter id; Save, Rename and Mix Update promote it without restarting its shuffle bag. Legacy automatic entries are pruned on load; incoming automatic entries are ignored, while a saved entry arriving with a local recent focus's id promotes it.

Regression: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-focus.drive.mjs`, checking suggestion navigation, focus reuse, unsaved collection actions, palette exclusion, cancellation/promotion, recency/pruning, reload and real-mode outgoing/incoming sync in both themes at desktop/phone sizes. Screenshots: `scripts/qa/out/shuffle-focus-*.png`.

Fifth-batch validation: the clean checkout passed all 2,969 shuffle checks on a standalone rerun, browser smoke, and the full focus regression in both themes at desktop/phone sizes (including a saved playlist arriving with a local recent focus's id). The repo-wide clean run passed 35 suites and failed the existing fuzzy re-index timing assertion (161 ms against 150 ms); a working-tree run hit the same assertion at 174 ms. Fuzzy code/tests are unchanged in this batch, and the pushed baseline's isolated fuzzy suite passed all 105 checks (124 ms re-index).

The sixth batch (2026-10-12) fixes library-16: quick-labeller readings fill Artist and the paired Title, switching to a plain suggestion restores the upload title, and a title typed by the listener survives subsequent picks. A matching artist typed by hand gets the same paired title. Saving settles the channel's related guesses through the helper shared with the existing one-tap guess action. Remaining guesses get an inline teaching offer that does not take focus; Enter continues labelling without accepting it. Reading chips take priority over other artist suggestions. The labeller moved into `labeller.js`, leaving app.js below its 5,950-line cap.

Regression: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-labeller.drive.mjs`, covering both readings, typed Artist/Title, switching readings/plain suggestions, related settlement, teaching Yes/No, rapid keyboard saves and mood/navigation keys, the existing guess action, and real-mode persistence/outgoing labels sync. Demo passes exercise both themes at desktop/phone sizes; screenshots: `scripts/qa/out/shuffle-labeller-*.png`.

Sixth-batch validation: all 2,969 shuffle checks passed; the clean checkout passed all 36 repo suites, smoke, the labeller regression (including rapid keyboard saves and real-mode persistence/sync), and the existing editing regression.

Twenty of the audit's original 23 verified findings have now been addressed. The audit remains incomplete. The first three batches were pushed in `65f5d9a`, followed by `94aea86` to preserve vendored file bytes on Windows. The fourth batch was pushed in `013e4cb` and the recent-focus batch in `e8003a5`. Radio regression: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-radio.drive.mjs`, checking R replacement/Undo in ordered and true-shuffle queues, context and feeder state, and Shift+R preserving the queue.

Remaining originally verified findings: library-12 (playlist reordering/additions), library-18 (duplicates) and library-19 (artist aliases).

Validation: True Shuffle unit suite, browser smoke, and the repo test suite. Reusable browser regression: `node scripts/qa/drive.mjs misc/101-true-shuffle/test/ux-audit.drive.mjs`. It checks desktop/phone in both themes, zero external demo hosts, Trim Save, base-volume keys, backup cancellation/replacement/Undo, Mix chip focus, naming-row bounds and local date grouping across a UTC day/month boundary. Screenshots land in `scripts/qa/out/shuffle-*.png`.

Findings not listed in the implementation batches remain open; unverified findings must still be reproduced before implementation. The first three batches and blog index fix have been pushed. Subsequent batches record their own validation and commit.

## How to continue

1. **Verify** the unverified findings before fixing them. Reproduce each one by driving the app or reading the cited code. Drop any that is not real, already fixed, decided on purpose (see below), or breaks a constraint.
2. **Plan.** Merge duplicates across lenses (same root cause), prioritise by severity and how often people meet it, and group the work into batches that own separate files. app.js, app.css, ds.css, index.html, ui.js and actions.js are shared hubs: keep their work in few batches, done in order.
3. **Fix and check each batch:** `node misc/101-true-shuffle/test.js`, `node scripts/qa/smoke.mjs 101-true-shuffle`, drive scripts (`node scripts/qa/drive.mjs <script>`; see `scripts/qa/README.md`), and screenshots in both themes at 1280x860 and 390x844. Then bump the shared `?v=` stamp in index.html, commit, verify in a clean worktree, and push.

**Constraints every fix must respect:**
- The YouTube player stays visible, at least 200x200, never covered or hidden; no audio-only mode.
- YouTube data is cached for 30 days at most.
- Nothing about the listener leaves the browser except artist, song and work names sent to the listed music services; the demo contacts no network.
- A YouTube search costs 100 quota units and runs only on a press; cost badges show it.
- House style: ES5, tabs, ASCII with `\u` escapes, ui.js components, ds.css tokens.

**Decided on purpose (not bugs):**
- On touch screens, the artist link under a song row's title is not tappable: a tap on the row plays it, and Go to artist is in the row's menu.
- On phones, the mini player's progress line is display-only, and a tap on the mini player opens the sheet, which has its own seek and transport.
- The demo has no listening history.
- Car mode hides the rest of the app.

## Counts

| Lens | Findings | Critical | High | Medium | Low | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| first-run | 15 | 0 | 2 | 7 | 6 | 0 |
| listening-desktop | 20 | 0 | 6 | 11 | 3 | 3 |
| phone | 18 | 1 | 8 | 7 | 2 | 0 |
| discovery | 20 | 0 | 7 | 10 | 3 | 0 |
| search-ia | 19 | 0 | 6 | 8 | 5 | 0 |
| library | 20 | 0 | 4 | 16 | 0 | 20 |
| feature-consistency | 17 | 0 | 3 | 9 | 5 | 0 |
| feedback | 18 | 1 | 8 | 7 | 2 | 0 |
| accessibility | 20 | 0 | 9 | 8 | 3 | 0 |
| visual-system | 15 | 0 | 2 | 9 | 4 | 0 |
| microcopy | 20 | 0 | 3 | 10 | 7 | 0 |
| responsive-perf | 16 | 1 | 5 | 9 | 1 | 0 |
| interaction | 14 | 0 | 7 | 6 | 1 | 0 |
| keyboard-power | 19 | 0 | 8 | 7 | 4 | 0 |
| **All** | **251** | **3** | **78** | **124** | **46** | **23** |

Severity levels:
- **Critical:** blocks a core task or loses data.
- **High:** makes a frequent task confusing, slow or error-prone, or is an accessibility barrier.
- **Medium:** friction, or an inconsistency people notice.
- **Low:** polish.

For verified findings, the severity shown is the verifier's, which may differ from the auditor's.

## Verified findings

### listening-desktop-1 · high · verified · Trim and volume: Save does nothing, so every trim or per-song volume is lost

- **Where:** Playback extras / Trim and volume dialog
- **Observed:** From the bar's More > Trim and volume..., I typed End at 2:00, set the song's volume to 50% and clicked Save with a real mouse click. The dialog stayed open, no toast appeared, and the store key 'songprefs' stayed null. Pressing Enter in either time field also did nothing. Nothing typed in this dialog is ever saved, so the feature cannot be used at all. Its volume slider also starts with no handle and no fill (100% sits midway on 50-150), so it looks like an empty, disabled bar.
- **Why it matters:** A primary action must do what it says and confirm it (Nielsen: visibility of system status, error prevention).
- **How it was verified:** I reproduced it on my own with real mouse clicks and real keystrokes in demo mode, then read the code at every cited line.

CODE
- ui.js:165-175: btn() builds its h() options from class, href, target, rel, title, disabled, data and on. It never passes o.type.
- ui.js:33: h() gives every <button> type="button" unless a type is passed. So U.btn({ type: 'submit' }) at app.js:1420 renders as type="button", and the form's submit handler at app.js:1425 can never run.
- The form has two text inputs and no submit button, so the HTML rules for implicit submission also stop Enter from submitting.
- openDialog (ui.js:332-366) handles only Escape and Tab.
- I wrote a script that walks every btn(/split(/iconBtn( call across lines: 154 calls in 41 files. Only app.js:1420 passes a type.
- Four modules already work around the dropped type by setting .type = 'submit' after U.btn(): lyrics.js:996, quiz.js:1187, quiz.js:1278 and rescue.js:710.
- git log -S trimDialog shows the dialog arrived in 0d5ba46 (2026-10-10). git log -S "o.type" on ui.js finds nothing, so btn() has never passed a type and this Save has never worked.

DRIVE: v1-trim.mjs, demo, 1280x860, dark
- Played a song, clicked #btn-bar-more, then "Trim and volume…".
- The dialog's buttons are Close, Now, Now, Save and "Back to the whole song", all type=button. The form has 2 text inputs and 0 submit buttons.
- I clicked into End, typed 2:00, clicked the slider's left end (value 50), then clicked Save. Result: {dialogOpen: true, toast: '', status: '', pageCtx.songPref(id): null, store songprefs: null}.
- Enter in Start, Enter in End, and Enter then Space on a focused Save gave the same result each time.
- After Escape and reopening, the fields were start '', end '', vol 100, and the menu item had no "(set)". What I typed was gone.
- From a song row's "More for …" menu in #/songs (v3-rowmore.mjs) it is the same dialog and the same dead Save: after typing Start 0:30 and clicking Save, open:true, no toast, stored null.

POSITIVE CONTROL (fix emulated in the page only: Save.type = 'submit')
- Enter in End saved. The dialog closed and the toast said "Saved for this song: it ends at 0:20, 50% volume."
- The store held {start: 0, end: 20, vol: 50} and the player volume dropped to 50 at once.
- After a seek to 0:17 the queue moved on at the 0:20 end point.
- Reopening showed end 0:20 and vol 50. "Back to the whole song" cleared it, and that button works as shipped.
- This proves two things: the harness's Enter and click can submit, so the failures above are real, and the one attribute is the whole fix.

SLIDER
- --p is never set (styleP '(unset)'). The value is 100 on a 50-150 range and the track is 389 px wide.
- At rest it is an empty grey bar with "100%" and no handle or fill: a2-slider-initial-dark.png, c2-slider-initial-light.png.
- After a mouse click (50%) and a mouse drag (130%), :focus-visible stays false. Still no handle or fill; only the number changes (a3, a4).
- Only keyboard focus shows the handle (b1).
- Emulating a scoped thumb rule plus --p gives half fill with the handle in the middle at 100%, and they follow a drag to 130% in both themes (e1, e2).
- The finding's suggestion, narrowing app.css:186 to .ts-seek, also puts a permanent handle on the bar's volume slider: compare e3-barvol-option2-dark.png with e0-barvol-asis-dark.png. That is a design change this finding doesn't need.

Pages logged no errors and contacted no outside hosts. Screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/listening-desktop-1/shots/ (a1-a6, b1-b2, c1-c2, d3-d4, e0-e3), and the scripts are in the folder above it.

SEVERITY: I rated it high, not critical. Playing, queueing and shuffling are untouched, and no stored data is lost, only what was typed into the dialog. But a documented feature (README:185), offered in every song's menu and in the bar's More, cannot be used at all, and its main button fails without any feedback.
- **Fix (verified):** 1) ui.js btn(), the h() options at lines 170-175: add `type: o.type`, for example after `rel: o.rel`. Add `type` to the option list in the comment at ui.js:160-161. h() skips undefined options and still defaults to type="button" (ui.js:33), so every other button stays as it is. Only app.js:1420 passes a type today. Optionally, the four workarounds (lyrics.js:996, quiz.js:1187 and 1278, rescue.js:710) can then pass `type: 'submit'` instead; that is not required.

Don't build the Save button by hand in app.js. app.js has 5,941 lines against the lint cap of 5,950, and doing so keeps the workaround alive.

2) The slider (Chromium only; Firefox already shows its thumb and progress), with no new lines in app.js:
- app.js:1414: add `style: { '--p': ((sp.vol || 100) - 50) + '%' }` to volIn's options. On this 50-150 range the fill percentage is the value minus 50.
- app.js:1416: extend the input listener with `volIn.style.setProperty('--p', (volIn.value - 50) + '%');`.
- app.css: after line 188, add `.ts-modal .ts-range::-webkit-slider-thumb { opacity: 1; }`. This is scoped like the existing ds.css:158 `.ts-sheet-seek .ts-range::-webkit-slider-thumb { opacity: 1; }`. Don't narrow the global rule at app.css:186: that would also give the bar's volume slider (#vol) a permanent handle.

3) index.html: bump the shared ?v= stamp on all 42 uses (now 2026101115), as README:1877 requires.

4) A guard. test.js never loads ui.js under Node; it only reads it as text. So add a text lint to its 'lint' section, for example `ok(/function btn\(o\)[\s\S]{0,700}type: o\.type/.test(fs.readFileSync(path.join(HERE, 'ui.js'), 'utf8')), 'ui.js btn(): a type given to the button component (submit) reaches the button')`. Also keep a drive check like v1-trim.mjs: open Trim from the bar's More, type an End, click Save, then assert the dialog closed and songprefs holds the entry.

Optional and separate: the bar's More item (app.js:4171) doesn't show "(set)" the way the row menu does (app.js:1391).
- **Auditor's original fix:** In ui.js btn() add `type: o.type` to the h() options (h() already honours opts.type), and add a test.js check that U.btn({ type: 'submit' }) yields a submit button. Alternatively build Save at app.js:1420 with h('button', { type: 'submit', class: 'ts-btn ts-btn--primary ts-btn--md', text: 'Save' }). In trimDialog, set volIn.style --p on input, and narrow the opacity:0 thumb rule at app.css:186 to `.ts-seek .ts-range` so other sliders show their handle.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/test.js` · **Effort:** S
- **Risks:** - Passing type through btn() changes nothing for today's callers: 154 calls were scanned and only app.js:1420 passes a type, and an undefined type is skipped. The type option must stay the HTML attribute only, though: a stray non-button value on a <button> such as 'chip' counts as submit inside a form.
- Once Save is a submit button, Enter in Start or End saves. That is intended and was checked with the emulated fix. The two "Now" buttons stay type=button and won't submit.
- The rule that End must be at least five seconds after Start (app.js:1428) now actually runs. It shows a toast and keeps the dialog open.
- The --p formula (value - 50) depends on min 50 / max 150. If the range changes, compute it from min and max instead.
- app.js is at 5,941 lines with a lint cap of 5,950, so keep the slider edits inline.
- Forgetting the ?v= bump fails the stamp lint and can serve an old ui.js with a new app.js.
- Re-run:
  - node misc/101-true-shuffle/test.js (the lint section: stamps, line cap, the new guard)
  - node scripts/test-all.mjs
  - node scripts/qa/smoke.mjs 101-true-shuffle
  - a drive like v1-trim.mjs (bar More and row More paths, a Save click, Enter in a field, reopening shows the saved values)
  - a look at the lyrics find form, quiz Start/Guess and the rescue paste form (they set type themselves and should behave the same), the bar's volume and seek sliders (they should look the same with the scoped CSS), and the trim dialog in both themes
- **Evidence:**
  - s04-trim-space.mjs: the dialog's buttons report 'Save:button' (not submit). After the Save click {open:true, toast:''}; after Enter in a field {open:true}; stored songprefs: null
  - ui.js:165-175: btn() never passes o.type to h(), and ui.js:33 makes every <button> type="button". app.js:1420 builds Save with U.btn({ ..., type: 'submit' }), so the form's submit handler at app.js:1425 never runs. With two text inputs and no submit button, Enter cannot submit the form either.
  - The forms that do work build their submit buttons with h('button', { type: 'submit' }) directly: app.js:1687, 3314, 3472
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/trim-dialog.png, trim-slider.png (no thumb, no fill at 100%), trim-slider-70.png (the thumb appears only once the slider has keyboard focus)
  - app.css:183 (the fill needs --p, which trimDialog never sets) and app.css:186 (thumb opacity 0 everywhere except .ts-seek:hover and :focus-visible)

### library-1 · high · verified · Restore from a file replaces the whole library at once, with no confirmation and no way back

- **Where:** Settings > Backup (import/restore)
- **Observed:** In real mode with 3,200 songs and 3,000 listens, I chose a 10-song backup (a real export from this store, cut down) in Settings > Backup > Restore from a file. The library was replaced at once: 3,200 songs became 10 and the history went from 3,000 listens to 0. The only message was the toast 'Restored the file: 10 tracks.' There was no dialog, no Undo, and nothing showing what the file held (its date or counts) before everything was overwritten. Dropping the same file on the page does ask 'Restore this backup?' first; the button skips that question.
- **Why it matters:** A destructive, irreversible action needs a confirmation that states what will be lost, or an undo. One action should behave the same from every entry point.
- **How it was verified:** CODE. app.js:2952: the Settings file input's change handler calls importFile(f) directly. app.js:3201-3208: importFile calls store.importAll(data, {mode:'replace'}), then reloadFromStore, then the toast 'Restored the file: N tracks.' store.js:322-332: 'replace' first clears tracks, playlists, kv and history. app.js:4913-4920: dropping a file opens 'Restore this backup?' first. app.js:2999-3006: Delete everything has a danger button with 'Keep it' focused. So the claim matches the code.

DRIVEN (scratchpad/ux/verify/library-1/restore.mjs). Real mode, with every Google and music host blocked (0 external hosts contacted, 0 page errors). IndexedDB was filled with 3,200 songs in 2 YouTube lists, 3,000 listens and one hand-picked playlist, then the page was reloaded. The auditor set inp.files and fired a synthetic change event. I did it the way a person would: a real mouse click on the 184x40 'Restore from a file' label, Chrome's file chooser intercepted (Page.setInterceptFileChooserDialog, then fileChooserOpened in mode selectSingle), and a real file on disk picked with DOM.setFileInputFiles. A MutationObserver watched for any .ts-modal, and the harness counted native dialogs.

Run 1, the auditor's case (a real export cut to 10 tracks, no listens):
- The store went from 3,200 tracks and 3,000 listens to 10 and 0, 64 ms after the pick.
- 0 in-page dialogs and 0 native dialogs.
- The toast 'Restored the file: 10 tracks.' had no action and was gone within 4 s.
- No Undo control anywhere on the page, and no snapshot in kv (keys after: bag, context, library, lists, plan, queue).
- Playback stopped and the queue emptied. The usage line went from 'about 4824 KB' to 'about 92 KB'.
- Screenshots: shots/tiny-1-before.png, tiny-2-after-toast.png.

Run 2, a realistic older backup (a full export as of 20 days ago: all 3,200 songs, the 1,080 listens older than that, no hand-picked playlist yet):
- Replaced in 238 ms with no dialog.
- The toast said 'Restored the file: 3,200 tracks.', so nothing seemed to change, but 1,920 of 3,000 listens (64%) and the 'Hand picks' playlist were gone. The only trace is the usage line now saying 1,080 listens.
- Screenshot: shots/older-2-after-toast.png.

Run 3, a phone at 390x844 with touch: the same result. The tap opened the chooser, the store was replaced in 63 ms, and there was no dialog and no Undo (tiny-phone-2-after-toast.png). A phone has no drag-and-drop, so this unguarded button is the only way to restore there.

DROP PATH (Input.dispatchDragEvent with the same file): it does open 'Restore this backup?' (older-3-drop-dialog.png), and Cancel left the store untouched. So the two entry points do behave differently. That dialog is weak too:
- Restore is styled primary, not danger.
- Focus stays on <body>.
- It shows no date and no counts.
- It doesn't mention listening history ('library, labels, ratings, plays, playlists').
The warning line under the Settings buttons (app.js:2956) also leaves out history and playlists.

PROPOSED FIX CHECKED (merge.cjs, run in Node against store.js memory()):
- Merging an older backup of the same store turned 5 history rows into 8. The 3 shared listens were doubled, because checkExport deletes n (store.js:423-424) and history is autoIncrement.
- The merge also dropped a hand-picked playlist made after the backup, because kv 'lists' is one record and the file wins.
- So the Merge button as proposed would corrupt the numbers and lose playlists.
- A kv 'backup:beforeRestore' snapshot would be carried inside every later backup, since exportAll keeps every kv key except 'import:' ones (store.js:309).

RECOVERY TODAY: none in the app. The Desk sync carries ratings, plays, labels and history but no tracks, so getting back means re-importing from YouTube and then a Pull. That only works if a push happened before.

SEVERITY: high, not critical. The loss needs a deliberate Restore plus a file pick, under a written warning, in a rarely used flow. But one slip loses data that exists nowhere else, without warning and for good. A slip is easy: exports are named true-shuffle-<date>.json next to true-shuffle-labels-<date>.json, and this same button also accepts labels files. Meanwhile the app offers Undo for much smaller actions (like, block, clear queue), and puts a dialog in front of the same restore when dropped and in front of Delete everything.
- **Fix (verified):** Send every backup through one confirmation that shows what will be lost, and add an Undo for the session. Do not offer Merge yet. All changes are in app.js unless noted.

1. New function openDataFile(f), next to importFile (around 3201). It calls readJson(f), then:
   - labels format: applyLabelsFile(f), as now;
   - data.format === 'true-shuffle-export': confirmRestore(f, data);
   - otherwise: say('That file is not a labels file or a True Shuffle backup.').
   Point both entry points at it: the Settings input handler at 2952 becomes `if (f) openDataFile(f);`, and lines 4913-4922 of wireFileDrop's drop handler become `openDataFile(f);`. importFile is then removed.

2. confirmRestore(f, data):
   - First run Promise.all([store.usage(), data.exportedAt ? store.getHistory({ since: Date.parse(data.exportedAt) + 1 }) : []]).
   - Then U.openDialog({ title: 'Replace everything with this backup?' }) with:
     - p: q(f.name) + ', saved ' + exportedAt.slice(0,10) + ': ' + plural(tracks,'song') + ', ' + plural(history,'listen') + ', ' + plural(kv.lists.length,'playlist') + '.'
     - p: 'Here now: ' + plural(u.tracks,'song') + ', ' + plural(u.history,'listen') + ', ' + plural(lists.length,'playlist') + '.'
     - When newer listens exist, p.ts-notice: plural(since.length,'listen') + ' made here since <date> are not in the file and would be lost.'
     - p.ts-muted: 'Everything stored here is replaced: library, labels, corrections, ratings, plays, listening history, playlists and queue.'
     - A .ts-row-btns row with three buttons:
       - button.ts-btn.ts-btn--danger.ts-btn--md 'Replace everything': d.close(); restoreData(data);
       - secondary [icon('download'), ' Save what is here first']: exportAll;
       - secondary 'Cancel': d.close.
   - Then cancel.focus(), as the Delete-everything dialog does at 3005.

3. restoreData(data):
   - First take a snapshot with store.exportAll(Date.now()). This took 47-54 ms for 3,200 songs and 3,000 listens.
   - Then store.importAll(data, { mode: 'replace' }).then(reloadFromStore).
   - Then setStatus(msg) and U.toast(msg, { action: 'Undo', ms: 15000, onAction: store.importAll(snapshot, { mode: 'replace' }).then(reloadFromStore).then(say('Put back what was here before the restore.')).catch(fail) }).
   - msg reads 'Restored the backup from <date>: N songs, N listens.' (counts from store.usage(), not tracks only).
   - Keep the snapshot only in that closure, never in kv.

4. Line 2956 text: 'Restoring shows what the file holds and asks first, then replaces everything stored here: library, labels, ratings, plays, listening history, playlists and queue.'

5. README.md: update the Settings/Backup description and the importAll row. Note that the UI does not offer merge.

Merge stays out. Before any button offers it, store.importAll in 'merge' mode must skip listens it already has (key id + '@' + at, as checkInbox does at app.js:4119-4121) and merge kv 'lists' by id. That is a separate store.js change with tests.
- **Auditor's original fix:** In viewSettings, read the chosen file first and open a confirmation built from the wireFileDrop dialog. It should show the backup's exportedAt and its songs, listens and playlists next to what is stored now, with three buttons: Replace (danger style), Merge (store.importAll mode 'merge') and Cancel. Before replacing, take a snapshot (store.exportAll into kv 'backup:beforeRestore', or download it automatically), and offer 'Undo restore' in the toast and in Settings for the rest of the session.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** S
- **Risks:** - reloadFromStore stops the player and rebuilds the controller. Undo does it a second time, the same as today's restore.
- Labels files must still apply directly with no dialog, since applying them is not destructive. The demo is unaffected: the input is disabled and wireFileDrop returns early.
- The snapshot holds the whole store in memory until the toast's button is replaced. That is about 4-5 MB of JSON for 3,200 songs, fine on desktop and Android.
- A hand-made backup without exportedAt must still open the dialog, without 'saved' and without the 'since' line.
- importAll still checks the file (checkExport) after the confirm, so a damaged file fails with its sentence and changes nothing.
- On a 390 px phone the three dialog buttons must wrap without sideways scroll.

Re-run:
- node misc/101-true-shuffle/test.js (the store export/import checks around test.js:1458-1479, cache.section, duel.section).
- scratchpad/ux/verify/library-1/restore.mjs, adapted to expect:
  - a dialog after the pick, with focus on Cancel and Escape closing it;
  - Cancel keeps 3,200 songs and 3,000 listens;
  - Replace replaces, and the toast offers Undo;
  - Undo brings back 3,200 songs, 3,000 listens and 'Hand picks';
  - the same dialog for a dropped file;
  - phone 390x844 in both themes.
- The smoke check (scripts/qa/smoke.mjs) for the Settings route.
- **Evidence:**
  - real.mjs (step restore): 'B1 picked a 10-track backup in Restore from a file: confirm dialogs 0 modal false library 3200 -> 10 toast {text: Restored the file: 10 tracks., action: null}'
  - Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/library/shots/real-settings-backup.png (after the restore: 'Stored in this browser: 10 tracks, 1 playlist, 0 listens')
  - app.js:2951-2954: the file input's change handler calls importFile(f) directly
  - app.js:3201-3208: importFile calls store.importAll(data, { mode: 'replace' }), then reloadFromStore
  - app.js:4915-4919: the drag-and-drop path does open the 'Restore this backup?' dialog
  - store.js supports importAll mode 'merge', but no button offers it

### library-4 · high · verified · Bulk edits and ratings can't be undone, and 'Undo my corrections' wipes every correction without asking

- **Where:** Songs table bulk actions, Edit details (I), ratings
- **Observed:** I rated 5 selected songs 2 stars. The toast said '5 tracks rated 2 of 5.' with no Undo, and their earlier ratings (1, 1, 0, 0, 3) were lost. A bulk edit setting Artist to 'Wrong Artist' on 4 songs by 3 different artists (the fourth had none) saved as 'Saved on 4 tracks.', again with no Undo. The only way back is the editor's 'Undo my corrections'. It ran on one click with no confirmation and reset every correction on those songs, not just the last edit. On 3,200 songs a bulk Save took 197 ms, so one Enter can relabel the whole library. Pressing the star a song already has removes its rating ('Rating removed.', no Undo), while the heart does offer Undo.
- **Why it matters:** Prefer undo to confirmation for frequent edits. Make bulk operations as reversible as single ones, and apply the same rule to every rating control.
- **How it was verified:** I read the cited code and reproduced every claim with my own drive scripts. Scripts, logs and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-4/: demo.mjs, real.mjs, stars.mjs, proto.mjs, the *.txt logs, and shots/.

CODE
- app.js:1467-1471 `rateIds` and app.js:1012-1017 `stars()` show a toast with no action.
- The editor's submit (app.js:1729-1743) ends in `say()`, so it has no Undo either.
- "Undo my corrections" (app.js:1690-1697) calls `L.editMany(reset)` on one click. It clears every `userEdits` key: title, artist, version, year, genres and `LABEL_FIELDS`.
- The quick labeller also saves into `userEdits` (app.js:3641-3648, `L.edit`). So the reset wipes labeller work too.
- `blockIds` (1477), `toggleLike` (4719) and the duel's Set stars (duel.js:716-726) do offer Undo.
- README.md:168 lists what can be undone ("Blocking, removing from a playlist, clearing the queue and liking"). Ratings and edits are left out without saying why. This is not on the "decided on purpose" list.

DEMO, 1280x860, dark
1. Bulk rating
   - I gave rows 0-4 ratings of [5,4,0,1,3] through the row menu. Then I clicked row 0, shift-clicked row 4 and chose More > Rating… > 2.
   - Result: [2,2,2,2,2]. The toast said "5 tracks rated 2 of 5." with no action. No Undo button was visible anywhere, and Ctrl+Z did nothing.
   - The Songs table has no rating column, so the old values were never on screen. The redraw also cleared the selection (0 rows), so the same songs can't even be re-rated without selecting them again.
   - Shot: shots/1-after-bulk-rate.png
2. Bulk edit
   - Earlier corrections first: row 6 got "From: Earlier Work" and mood Tender in the one-song editor. Row 7 got mood "driving" in the quick labeller (keys 2, then Enter).
   - Then I selected rows 6-9, pressed I, typed "Wrong Artist" and pressed Enter. It took 20 ms. All four became "Wrong Artist" and the toast said "Saved on 4 tracks." with no action.
   - The bulk editor can't take a value back: Artist shows "Leave as it is", and saving it empty says "Nothing changed."
   - The only way back is "Undo my corrections". One click: 0 native dialogs, the modal closed, and the toast said "Back to the labels for 4 tracks." with no Undo.
   - That click also deleted the earlier corrections. Row 6 lost its work and its Tender mood (the mood fell back to the label's "dark"). Row 7 lost the labeller's mood and kind.
   - Shots: shots/2-bulk-editor.png, 3-after-bulk-save.png, 4-after-undo-my-corrections.png
3. Stars
   - Star 4 on an unrated song showed "Rated 4 of 5." Clicking star 4 again gave rating 0 and "Rating removed.", with no Undo.
   - A double click on star 3 of a 4-star song ended at rating 0, so the 4 was lost. Two quick taps on a 390 px phone did the same. The second click arrives with `e.detail` 2.
   - The heart on a row gives "Added to Liked songs." with Undo.
   - Shots: 5-star-removed.png, 8-desk-star-doubleclick.png, 8-phone-star-doubleclick.png

REAL MODE (IndexedDB, all outside hosts blocked)
- 3,200 synthetic songs, 300 of them hand-labelled earlier (mood, work and kind).
- Ctrl+A, I, Bright, Save took 120 ms (the auditor measured 197; the conclusion is the same). The toast said "Saved on 3,200 tracks." with no Undo. All 300 hand moods were overwritten, and they were still overwritten after a reload.
- Ctrl+A, I, "Undo my corrections" took 129 ms, with no confirmation and no Undo. Corrections went from 300 songs to 0, and all 300 "Hand Work" values were gone. This also survived a reload.
- In the button row, Save, Cancel and "Undo my corrections" sit 8 px apart. Cancel and the reset look the same (secondary style), so the reset reads like "revert this dialog" (shots/6-bulk-editor-buttons-3200.png).
- Changes reach the Desk's `sync:outbox` 4 s later.
- I deleted the test database at the end.

PROTOTYPE OF THE FIX (in the page, repo untouched)
I tested the restore below on 40 songs: copy `userEdits` back, then `L.deriveIds`, then `L.resolveArtists`, then the ratings through `editMany`. It put back every derived field exactly (title, artist, artistKey, genres, year, labels, rating) after a bulk edit, a bulk rating and "Undo my corrections", in 3-14 ms.

VERDICT
Real. The "Undo my corrections" part is a one-click loss of the owner's hand-labelling work, with no way back. The rest is missing Undo on frequent edits.
- **Fix (verified):** All edits are in misc/101-true-shuffle/app.js unless noted. ES5, tabs, the same pattern blockIds and duel.js applyStars already use.

1. Add one helper next to rateIds (about line 1460):

```
// What a rating or an edit is about to change, for the toast's Undo. The undo is a new change:
// edit stamps stateAt now, so the Desk's sync carries it.
function keepEdits(ids) {
	var was = {};
	ids.forEach(function (id) { var t = lib.tracks[id]; if (t) was[id] = { rating: t.rating || 0, edits: JSON.parse(JSON.stringify(t.userEdits || {})) }; });
	return function () {
		var back = Object.keys(was).filter(function (id) { return lib.tracks[id]; }), byR = {}, redo = [];
		back.forEach(function (id) {
			var t = lib.tracks[id], w = was[id];
			if ((t.rating || 0) !== w.rating) (byR[w.rating] = byR[w.rating] || []).push(id);
			if (JSON.stringify(t.userEdits) !== JSON.stringify(w.edits)) { t.userEdits = w.edits; redo.push(id); }
		});
		if (redo.length) { L.deriveIds(lib, redo); back = back.concat(L.resolveArtists(lib)); }
		Object.keys(byR).forEach(function (k) { L.editMany(lib, byR[k], { rating: +k }); });
		changed(back);
		say('Back as they were.');
	};
}
```

Do not restore the old `stateAt` as the finding suggests. The inbox merge (app.js:4115) keeps whichever change is newer by `stateAt`, so an old stamp would let the bulk change win on other devices and come back.

2. `rateIds`: call `var undo = keepEdits(ids);` before `L.editMany`, and pass `{ action: 'Undo', onAction: undo }` to `U.toast`.

3. `stars()` (app.js:1012):
   - Change the handler to `function (e) { if (e.detail > 1) return; var was = t.rating || 0; ... }`. This drops the second click of a double click or double tap. Keyboard presses have detail 0, so they are unaffected.
   - Add `{ action: 'Undo', onAction: function () { L.edit(lib, t.id, { rating: was }); changed([t.id]); } }` to the toast.

4. The editor's submit (app.js:1700-1743):
   - At the top, before any change: `var undo = keepEdits(ids), ck = chSel && chSel.value ? L.channelKey(t) : null, ruleWas = ck ? lib.channelRules[ck] : null;`
   - At the end, when something changed, replace the `say` with: `setStatus(text); U.toast(text, { action: 'Undo', onAction: function () { undo(); if (ck) changed(L.setChannelRule(lib, ck, ruleWas || null), true); } });`
   - Keep `say('Nothing changed.')` for the case where nothing changed.

5. The "Undo my corrections" button (app.js:1689-1697):
   - Rename it to 'Remove my corrections' + ELL and use `ts-btn--danger` plus a new class `ts-edit-reset`.
   - Add `.ts-edit-reset { margin-left: auto; }` in app.css, so it no longer sits beside Cancel.
   - On click, count `nE` corrections over `nS` songs. When `nS > 1`, confirm with the house dialog from app.js:3000-3006: title 'Remove your corrections?', text 'Remove ' + plural(nE,'correction') + ' on ' + plural(nS,'song') + '? Their labels and what YouTube says come back. Ratings, plays and blocks stay.', a danger button 'Remove them' and a focused 'Keep them'.
   - On yes: `var undo = keepEdits(ids); L.editMany(lib, ids, reset);`, close both dialogs, call `changed(ids)`, then `setStatus(m); U.toast(m, { action: 'Undo', onAction: undo })` with m = 'Removed N corrections on M songs.'

6. README.md:168: add rating and editing to the list of actions that can be undone from the toast.
- **Auditor's original fix:** Before L.editMany in rateIds and in openEditor's submit, snapshot each id's affected state: rating and stateAt, plus a copy of userEdits and the label fields. Then show U.toast(msg, { action: 'Undo', onAction: restore each snapshot with L.edit and call changed(ids) }), the same pattern blockIds uses. Rename 'Undo my corrections' to 'Reset to labels…' and confirm it with the count ('Reset 12 corrections on 4 songs?'). Add the same Undo to the stars (stars() at app.js:1012) and to the Rating submenu.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** Sync
- The undo must go through `changed()`, so the 4 s `queueSync` rewrites `sync:outbox`.
- It must stamp a new `stateAt`; restoring the old stamp would let the bulk change win on other devices and come back through `sync:inbox`.

Restore order and correctness
- Restoring `userEdits` by assignment needs `L.deriveIds` followed by `L.resolveArtists`. Without it, artist toss-ups stay stale.
- For a channel-rule edit, restore the rule with `L.setChannelRule(..., ruleWas || null)` and `meta=true`. The edited song must be re-derived after both restores.

Toast limits
- The toast has one slot. Any later `say()` replaces the Undo, and the 7 s window is the same as the existing undos.
- The Undo button sits at the end of the tab order, a limit every current undo toast already has. A confirmation for mass resets avoids relying on it.

Performance
- The snapshot is a JSON clone (a few ms at 3,200 songs).
- The restore re-derives only the songs that changed: 3-14 ms for 40 in my prototype; the Save itself took 120 ms for 3,200.

The double-click guard
- `e.detail > 1` drops a deliberate second click inside the system's double-click time. Keyboard presses (detail 0) are unaffected.

The new confirmation
- The confirmation stacks a dialog on top of the editor. Close both, and check that focus returns to the row (`openDialog` returnTo).
- With `margin-left: auto`, the button row wraps differently on phones.

Re-run
- `node misc/101-true-shuffle/test.js` and `node scripts/test-all.mjs`
- `node scripts/qa/smoke.mjs 101-true-shuffle`
- demo.mjs, real.mjs, stars.mjs and proto.mjs from my folder, extended to press Undo and assert:
  - ratings [5,4,0,1,3] come back
  - rows 6-9's `userEdits` come back
  - the 300 hand corrections at 3,200 songs survive a reload
- The existing undo flows, to check for regressions: block, like, the duel's Set stars, Wrapped's like, Rescue.
- **Evidence:**
  - songs.mjs: '5c after rating 5 songs 2 stars: ratings before [1,1,0,0,3] selection now {sel:0} toast {text: 5 tracks rated 2 of 5., action: null}'
  - songs.mjs: '7b after Save: before [{a: Las Polillas Eléctricas}, {a: ''}, {a: Saffron Circuit}, {a: Paper Lanterns}] after [Wrong Artist x4] toast {text: Saved on 4 tracks., action: null}'
  - songs.mjs: '7f after Undo my corrections (no confirm?) dialogs: 0 modal open: false ... toast Back to the labels for 4 tracks.'
  - real.mjs: 'S3 bulk mood on all: toast after 197 ms {text: Saved on 3,200 tracks., action: null}'
  - misc.mjs: 'E2 the song had 1 stars; pressing star 1 again -> 0 {text: Rating removed., action: null}'
  - Screenshots: .../library/shots/songs-after-bulk-rate.png, .../library/shots/songs-bulk-edit-dialog.png
  - app.js:1467-1471 (rateIds), 1700-1744 (the editor's submit), 1690-1697 (Undo my corrections), 1008-1020 (stars); blockIds at 1472-1479 and toggleLike at 4710-4724 already offer Undo

### library-7 · high · verified · Needs attention > No sure artist: the one-tap readings are hidden at 1280 px and overlap the next row on a phone

- **Where:** Needs attention (#/fix, No sure artist)
- **Observed:** The tab's help says 'One tap on a reading names it', but at 1280x860 none of the 33 'By X?' buttons can be seen. They sit inside the 151 px artist line, which is clipped with an ellipsis ('cassette drawer…'). Titles are cut too ('Hollow Compass - La…'), so six rows look the same. At 1440x900, 20 of 35 can be seen; only at 1920 can all of them. On a 390 px phone they wrap, but each virtual row is fixed at 60 px, so all 33 spill over the next row's title.
- **Why it matters:** The primary action of a view must be visible at the default size, and content must not overlap.
- **How it was verified:** Reproduced, and it is worse than the audit says. I read the code and drove the app at 4 phone and 11 desktop setups (sizes, player sizes, compact density, light theme), in demo and real mode. Scripts and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-7/ (shots/ holds the screenshots).

CODE (all cited lines are correct):
- app.js:1236: every list gets one fixed rowHeight, 60 (48 compact).
- app.js:1257-1258: opts.extra is appended inside .ts-r-sub, and viewFix passes the readings that way (app.js:2806-2809).
- app.css:406: .ts-r-sub is overflow hidden + ellipsis + nowrap. app.css:418: .ts-guesspicks is one inline-flex box.
- app.css:972: the phone rule (wrap) came from commit 728116e on 2026-10-09, which tried to fix picks "clipped off-screen on narrow screens". It wraps them but leaves the row at 60 px.
- ui.js:372-417: virtualList positions rows absolutely at i*rowH. Nothing re-renders when the 760 px breakpoint flips.

1. DESKTOP, DEMO (groups.mjs, all 22 unsure rows, 38 readings). The ellipsis hides the whole inline-flex group as soon as any part of it overflows. So counting single buttons (the audit's method, and my first pass) overstates what people see. Rows 1-6 at 1440 and 1536 show no reading at all, although the first button fits (1440-dark.png, 1536-dark.png). Readings actually visible:
- 1280: 0 of 38
- 1366, 1440, 1536: 6 of 38 each (only the 6 rows with one reading; none of the 16 rows with two readings)
- 1920: 38 of 38; with player M 36; with player L 6.
At 1280 the title column is 151 px, and rows 1 and 5 both read "Hollow Compass - La…".

2. REAL MODE (real.mjs). Google hosts blocked; 14 seeded uploads with realistic titles such as "Kenshi Yonezu - KICK BACK (Chainsaw Man OP)" from compilation channels; database deleted afterwards.
- Readings visible: 1280 0 of 28, 1440 5 of 28, 1920 26 of 28.
- The From and Genre columns are empty in every row (real-1280.png), while the now-playing guess box shows the same readings without trouble.

3. INVISIBLE BUT CLICKABLE (interact.mjs). At 1280 I clicked the empty-looking space right of "cassette drawer…" (x 515, y 140; A-1280-before-zoom.png shows nothing there). That click hit the hidden "By Hollow Compass?" button:
- it saved the artist,
- it opened "Read the rest of this channel the same way?",
- the unsure count fell from 22 to 11 (A-1280-after-click.png).
A plain click on a row is how you select it, so this can happen by accident, and that path has no Undo.

4. KEYBOARD (keys.mjs). Tab from row 0 focuses "By Hollow Compass?" and then "By Late Static?". The browser reports a 2px solid outline, but neither the button nor the ring is visible. The second Tab also scrolls .ts-r-sub by 179 px and blanks the channel name (keys-1280-tab1/tab2.png; same at 1440). This fails WCAG 2.4.7 (focus visible).

5. PHONE, 390 and 412, dark and light. Each row's content is 96 px tall in a 60 px row. All 22 on-screen readings print over the next row's title (390-phone.png, C-390-before-zoom.png, phone-light.png, real-390.png).
- Only 10 of the 20 buttons hit-tested on screen are tappable: at the other 10 the tap lands on whatever covers them (6 times the next row, 4 times the mini player or tab bar).
- Tapping the visible "By Late Static?" played the next song, "Hollow Compass - Distant Kindling", replacing what was playing. The first song stayed unsure (C-390-after-tap.png).
- The buttons are 21 px tall and missing from the touch hit-area rules in ds.css:196-210.

HOW PROMINENT. This is the default tab of #/fix. The app sends people here from a sidebar badge (app.js:695), a home-page note "Name them in one tap each." (app.js:1971-1973), a note on Artists (2164) and the phone Library hub (2553). Nothing in the README or the "decided on purpose" list covers this, and the fix touches no YouTube, privacy or quota rule.

CORRECTIONS TO THE AUDIT:
- The tab has 22 songs and 38 readings; 33 was the count of rendered buttons, including off-screen buffer rows.
- 1440 is worse than "20 of 35": only 6 are visible.
- "Six rows look the same" is overstated: two are identical on screen, the rest differ by 1-3 letters.

FIX CHECKED IN THE PAGE ONLY (proto.mjs; nothing in the repo changed). Readings on their own line in .ts-c-main, 82 px rows (70 compact), From and Genre dropped for this list at 761 px and up, buttons that never wrap and shorten with an ellipsis. Results:
- 1280: title column 151 to 340 px; 15 of 15 readings visible; nothing overlaps the next row; titles whole; 2 Tabs focus a visible "By Late Static?".
- 1280 compact 16 of 16; 1024 13 of 13; 1440 15 of 15; 1920 with player L 18 of 18.
- 390: 14 of 14 visible, no overlap; 12 are shortened with an ellipsis, which is acceptable because the full title sits right above. The same tap now names the artist instead of playing the next song (proto-1280.png, proto-390.png).
- **Fix (verified):** Move the readings out of the clipped artist line onto their own line, give this one list taller rows and the width of the From and Genre columns, and remove the phone wrap rule.

1. app.js trackList (1225-1262). Add three optional options; lists that don't pass them stay exactly as today.
- opts.cls: add it to the wrap class at 1228: ' ts-tracks' + ... + (opts.cls ? ' ' + opts.cls : '').
- opts.rowHeight at 1236: rowHeight: opts.rowHeight || (opts.compact || prefs.density === 'compact' ? 48 : 60).
- opts.below: after main.appendChild(sub) at 1259, add: if (opts.below) { var bl = opts.below(t); if (bl) main.appendChild(bl); }

2. app.js viewFix (2803-2810). For the unsure tab, stop passing the readings through extra. Pass instead:
- cls: 'is-naming'
- rowHeight: prefs.density === 'compact' ? 70 : 82
- below: function (t) { var g = h('span', { class: 'ts-guesspicks' }); guessPicks(t).forEach(function (p) { var label = 'By ' + p[0] + '?'; g.appendChild(h('button', { class: 'ts-pick', title: label, on: { click: function (e) { e.stopPropagation(); acceptGuess(t.id, p[0], p[1]); } } }, h('span', { text: label }))); }); return g; }
The dups and gone tabs keep their plain-text extra.

3. app.css 418-419. Replace with:
- .ts-guesspicks { display: flex; gap: 6px; min-width: 0; margin-top: 2px; }
- .ts-pick: keep its current look and add flex: 0 1 auto; min-width: 0.
- .ts-pick > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
The ellipsis goes on the inner span so the button itself can keep a touch hit area that isn't clipped.

4. app.css, desktop only, so it cannot beat the phone grid at 621:
- @media (min-width: 761px) { .ts-tracks.is-naming { --cols: 36px 44px minmax(0, 1fr) 52px 80px; } .ts-tracks.is-naming .ts-c-work, .ts-tracks.is-naming .ts-c-genre { display: none; } }
- @media (max-width: 1180px) and (min-width: 761px) { .ts-tracks.is-naming { --cols: 32px 44px minmax(0, 1fr) 52px 80px; } }
The header row uses the same classes, so its From and Genre labels go too.

5. app.css 972. Delete the phone rules .ts-r-sub:has(.ts-guesspicks), .ts-guesspicks and .ts-pick. Keep .ts-sticky.

6. ds.css touch block (196-210). Add: .ts-pick { position: relative; } .ts-pick::after { content: ''; position: absolute; inset: -10px -3px; }
This gives about a 41 px touch target that stays inside the 82 px row (content is about 62 px tall).

The readings never wrap, so one row height works at every width and no breakpoint listener is needed. Two-line titles are not needed either: the title column grows from 151 to 340 px at 1280. Optional: add a "Someone else…" button (openEditor([t.id], 'artist')) to match guessBox at app.js:1505-1515.
- **Auditor's original fix:** Let trackList take opts.rowHeight and opts.extraLine. For the unsure tab, put the readings on their own third line of .ts-c-main (wrapping), with rowHeight about 84 on desktop and 96 on phones, or in the From and Genre columns, which say nothing useful for unsure tracks. For this tab, show the raw YouTube title on up to two lines instead of one truncated line.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css` · **Effort:** M
- **Risks:** What could break:
- Other lists. trackList is shared by about 15 lists and by page modules (pageCtx.ui.trackList at app.js:4438, used by fuzzy.js). Without the new options they must render exactly as today: rows 60/48 px, same columns, the plain-text extra for versions, roles, dups and gone.
- The phone grid. The .ts-tracks.is-naming --cols override must stay inside min-width: 761px. Unscoped, it outranks the phone rule '.ts-tracks, .ts-tracks.no-work' (app.css:621) and breaks the phone grid.
- The touch hit area. The ellipsis must sit on the inner span, not on .ts-pick. Otherwise the ::after hit area is clipped.
- List behaviour at 82/70 px rows. Check keyboard paging (Home/End/PageUp/PageDown), vl.reveal, scroll restore on renderView(true), the selection bar, the sticky header, and dragging rows to playlists.
- Shortened readings on phones. At 390 px they get an ellipsis. If that proves ambiguous, a later step can let them wrap, with a taller phone row chosen by isPhone() and a matchMedia('(max-width: 760px)') change listener that re-renders #/fix. The list's row height is fixed when it is built, and a phone rotation flips the breakpoint.

Re-run afterwards:
- node scripts/test-all.mjs
- node scripts/qa/smoke.mjs 101-true-shuffle
- The scripts in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-7/: measure.mjs, groups.mjs, interact.mjs, keys.mjs, real.mjs. Expect no hidden readings, nothing over the next row, every hit test on the button, the phone tap naming the artist, and focus visible.
- The audit's fixpicks.mjs.
- The earlier ui/targets.mjs, focus.mjs and contrast.mjs, at 1280 and 390, in both themes and both densities.
- A look at the other #/fix tabs and at #/songs at 1180 and 960.
- **Evidence:**
  - fixpicks.mjs: '1280x860 {picks:33, fullyShown:0, clippedOrHidden:33, subWidth:151}', '1440x900 {fullyShown:20, clippedOrHidden:15}', '1920x1080 {fullyShown:38}', '390x844 {spillIntoNextRow:33}'
  - Screenshots: .../library/shots/fix-unsure-1280.png, .../library/shots/fix-unsure-390.png, .../library/shots/desk-dark-fix.png
  - app.js:2806-2809: the readings are appended inside .ts-r-sub; app.css:406: .ts-r-sub has overflow hidden, an ellipsis and nowrap; app.css:972: phones get white-space normal only
  - app.js:1236: every list uses rowHeight 60 (48 compact)

### library-8 · high · verified · Mix builder: every chip or order toggle sends keyboard focus to the page body

- **Where:** Mix builder (#/mix)
- **Observed:** After Space on the 'Bright' mood chip, document.activeElement is BODY, and the next Tab lands on 'Play this mix'. Getting back to the Moods row took 44 Tab presses, and to the Artists row 89, in the 160-song demo. Enter on an order card does the same. Building a mix by keyboard means a long walk after every choice.
- **Why it matters:** WCAG 2.4.3 Focus Order and 3.2.1/3.2.2: operating a control must not move focus elsewhere.
- **How it was verified:** Code: in viewMix every control's handler calls renderView(true): Start over app.js:2584, order card 2593, Clear 2604, chip 2613, "and N more" 2616, the number, date and checkbox limits 2645/2656/2665. renderView (759-787) empties #view and gives focus back only to an element found by closest('[data-id]') (761-762, 783-786). None of these controls has a data-id. README line 170 promises "a redraw keeps the focus on the same row", so this is a bug, not a design choice.

Harness, unmodified app (real key presses sent through Chrome DevTools, demo, 1280x860 dark). Scripts are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-8/.
- mixkeys.mjs:
  - Space on the "Driving" mood chip sets aria-pressed=true and moves focus to BODY. No focus ring is left on screen (mix-1-before-space.png vs mix-2-after-space.png).
  - The next Tab lands on "Play this mix" (mix-4-after-tab.png). Getting back to Moods takes 43 more Tabs, 44 in all, and Artists takes 89. Both match the audit.
  - Shift+Tab from that state goes to "Leave the demo" at the top of the page (scrollTop 803 to 0).
  - A second Space meant to undo the chip leaves it pressed, and the global Space shortcut (app.js:5702) starts playback (player idle to playing).
  - Also lost to BODY: Enter or Space on an order card; typing 20 in "Stop after (tracks)" then Tab (the Tab never reaches the next field); Space on a limits checkbox; Enter on Clear, on "and 18 more" and on Start over.
- labelkeys.mjs (four demo songs made unlabelled in page memory):
  - Space on a Scene chip moves focus to BODY. Then 3, Enter and Space do nothing for the label (still "1 of 4"), and Space starts playback.
  - A mouse click on a Role chip also moves focus to BODY. Then 4, Enter and ArrowRight are ignored, because labelKeys skips keys aimed outside #view (app.js:3660). So the page's printed key help stops working for mouse users too.
- labelsave.mjs (same root cause, not in the audit):
  - No chip touched. Key 2 and Enter save song 1, and song 2 opens with focus on the title.
  - 120 ms later the delayed redraw (redrawView, app.js:657, called from changed()) runs renderView(true). The title has no data-id, so focus falls to BODY. After that, 3 and Enter do nothing: the key flow works for one song per visit.
- browse.mjs: the #/browse chips also drop focus to BODY, but the next Tab returns to the chip. Milder, and outside this finding.

Prototype: patch3.mjs applied the fix to a copy at proto2/ (config.js replaced by a stub, never copied), served with --mount.
- Mix builder:
  - Every control keeps focus with its ring showing (p2/proto-1-after-space.png).
  - A second Space un-toggles the chip and the player stays idle. Tab goes to the next chip and Shift+Tab comes back.
  - Typing 20 then Tab lands on the next field, and the summary reads "Stops after 20 tracks".
  - Clear moves focus to the row's first chip, "and 18 more" to "September 2025", and Start over keeps focus.
- proto-keys.mjs: 24 chips in 12 rows keep focus, at 1280 px and at 390 px, with no sideways scroll.
- Labeller:
  - Space keeps focus on the chip. A click puts it on the title, and 4 then Enter saved {mood tender, scene anime, role OP}.
  - Keys keep working on songs 2 and 3.
- `node test.js lint` passes at 5,942 lines. No console errors, no external hosts.
- The repo is unchanged and no headless browser is left running.
- Aside, not part of this finding: the order cards are role=radio, but the arrow keys do nothing and each card is its own Tab stop.
- **Fix (verified):** All in misc/101-true-shuffle/app.js, written inline so the file does not grow (patch3.mjs in my folder has the exact replacements).

1) renderView, app.js:761-785: also put focus back on the page title when the title had it.
- Change ae.closest('[data-id]') to ae.closest('[data-id], h1').
- Set focusKey = focusKey ? (focusKey.tagName === 'H1' ? 'h1' : focusKey.dataset.id) : null.
- Set back2 = view.querySelector(focusKey === 'h1' ? 'h1' : '[data-id="' + (CSS.escape guard as now) + '"]').
- Inside if (back2) { ... }, first add: if (focusKey === 'h1') back2.setAttribute('tabindex', '-1').
- This also fixes the labeller losing focus after each save.

2) viewMix:
- Chip h('button') at 2611: add data: { id: 'mix-' + key + '-' + e.key }. Use the house prefix-hyphen style (duel-scope-, qz-level-, rs-pick-).
- Order card at 2592: add data: { id: 'mix-mode-' + o.key }.
- Start over at 2584: var reset = actionBtn(...); reset.setAttribute('data-id', 'mix-reset'); row.appendChild(reset).
- Limits at 2645, 2656 and 2665: call refresh() instead of renderView(true). They only change the summary, so nothing is rebuilt and Tab moves on normally. In the number handler, add if (!(v > 0)) inp.value = ''.
- Clear at 2604: after renderView(true), var c = view.querySelector('.ts-chip[data-id^="mix-' + key + '-"]'); if (c) c.focus({ preventScroll: true }).
- "and N more" at 2616: before redrawing, var first = entries.filter(function (x) { return shown.indexOf(x) < 0; })[0]. After renderView(true), focus [data-id="mix-<key>-<first.key>"] with CSS.escape, so focus lands on the first chip it reveals.

3) viewLabel chipsRow, 3606-3611:
- Add data: { id: 'lab-' + key + '-' + r[0] } and change the handler to function (ev).
- After redraw(): var back = ev.detail ? view.querySelector('h1') : dyn.querySelector('[data-id="' + CSS.escape('lab-' + key + '-' + r[0]) + '"]'); if (back) { if (ev.detail) back.setAttribute('tabindex', '-1'); back.focus({ preventScroll: true }); }
- A key press (detail 0) stays on the chip. A click or tap goes to the title, so 1-6, Enter, the arrows and P keep working. Putting a clicked chip back in focus would be wrong here: labelKeys leaves keys to buttons, so Enter would toggle the chip off instead of saving.
- "Another genre" select at 3628: after redraw(), focus dyn.querySelector('.ts-more-genre').

Skip the audit's "toggle in place" option: it is more code, the year chips rebuild the month row anyway, and there is almost no room left under the line limit.
- **Auditor's original fix:** Give each chip data-id="mix:<key>:<value>" and each order card data-id="mix:mode:<key>", so renderView's focusKey puts focus back. Better still, toggle in place: flip aria-pressed and .is-on, then call refresh() and update the counts, without re-rendering the page. Do the same in viewLabel's chipsRow.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Risks:** - **Line limit:** test.js:2416 limits app.js to 5,950 lines and it is at 5,942. Keep every edit inline. My first prototype, written over several lines, added 12 lines and would fail the check; patch3.mjs adds none.
- **data-id collisions:** track rows also use data-id. markPlaying only searches .ts-row[data-id] (app.js:1216), so ids starting mix- or lab- cannot collide. Keys with spaces, "&" or quotes need CSS.escape, as app.js:784 already does; "Indie rock" and "Starfall Odyssey" were checked.
- **Title restore applies to every page:** a background redraw while a page title has focus now keeps focus there instead of dropping it to BODY. Route changes already focus the title the same way, with preventScroll.
- **Remaining edge case:** a chip that disappears when turned off still sends focus to BODY. That happens to a selected genre, work or artist past its row's limit, or a month outside the picked years.
- **ev.detail:** it is 0 for keyboard and most screen-reader activations. If an assistive tool reports 1 or more, the labeller puts focus on the title instead of the chip. That is worse but not broken.
- **Space after a mouse click:** after clicking a mix chip, Space toggles that chip again instead of play/pause. Every other button already behaves this way (app.js:5702 leaves Space to buttons).
- **Re-run:**
  - `node misc/101-true-shuffle/test.js` (lint) and scripts/qa/smoke.mjs.
  - My drive scripts: mixkeys.mjs, labelkeys.mjs and labelsave.mjs; also proto-check.mjs and proto-keys.mjs, with their base changed to misc/101-true-shuffle/ (proto-check takes it as its second argument; proto-keys has misc/97-tsproto/ hardcoded).
  - The earlier ui/focus.mjs for focus rings.
  - Look at #/mix and #/label in both themes at 390 px.
- **Evidence:**
  - mix.mjs: 'M2 after Space on the chip: active BODY chip pressed? true', 'M3 then Tab lands on BUTTON.ts-btn ... "Play this mix"', 'M4 after Enter on an order card: active BODY'
  - mixtabs.mjs: 'Moods: ... Tab presses to reach a chip of the same row again: 44', 'Artists: ... 89'
  - app.js:2593, 2604, 2613, 2616: every handler calls renderView(true)
  - app.js:761-786: renderView restores focus only to an element carrying data-id
  - The quick labeller's chip rows rebuild the same way (redraw() at app.js:3611-3619)

### listening-desktop-5 · medium · verified · Volume keys and the wheel start from the faded or muted level: '=' lowers the volume, '-' halves it

- **Where:** Volume and mute
- **Observed:** player.volume() returns the volume heard right now (the base level x the song's own volume x the fade), because applyVolume writes that effective value into the real player. The - and = keys and the slider's mouse wheel add +-10 or +-5 to it and store the result as the new base. In the last 3 s of a song (the fade-out), one press of '-' took the slider from 100 to 47. In the first 1.5 s, one press of '=' (volume up) took it from 47 down to 19. Wheel up during a fade-out went from 19 to 14. While muted, '=' unmutes at 10% and overwrites the remembered level. Once Trim's per-song volume works (see the Trim finding), every key press on a song set to 50% would also halve the base.
- **Why it matters:** Controls must be predictable and monotonic: 'up' never lowers. Keys should act on the level the slider shows.
- **How it was verified:** I read the code and drove the demo myself: headless Chrome at 1280x860, dark theme, fades on (the default). The script is v1-volume.mjs. It reads the slider, the stored base (ToyKit 'volume'/'muted') and the real player's level. All files are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/listening-desktop-5/, and the full results are in run-cur.txt and run-fix.txt.

Code, confirming the cause:
- app.js:310: lazyPlayer.volume() returns real.volume().
- app.js:314: effective() writes the faded level into the real player.
- app.js:4684-4689: applyVolume sets that level to base x the song's own volume x the fade.
- app.js:5716-5717 (the keys) and app.js:5768 (the wheel) step from player.volume(), so they start from the faded level.
- app.js:5088 (Discover preview volume) reads the same value.
- README.md:186 says the slider keeps showing the base volume, so the keys go against the documented design.
- The YouTube player has the same path: player.js:346 returns yt.getVolume(), which is the last level applyVolume set. I did not run YouTube itself (no network allowed).

Measured on the current build (every case below except the first is a bug):
- **Control, mid-song:** '-' 100 to 90, '=' 90 to 100. Correct.
- **Paused 1.5 s before the end:** the player was at 50. One '-' set the base from 100 to 40, and the rest of the song plays at 40. At base 80 in the same spot, one '=' (up) set it to 50.
- **Playing, 1.5 s before the end:** the player was at 56. One '-' set the base to 46, and the next song stayed at 46.
- **Base 60, new song 0.3 s in:** three presses of '=' gave 22, 18, then 19, and the song settled at 19.
- **Base 100, new song:** three wheel-up notches on #vol gave 9.
- **Fades switched off:** the same press gave 100 to 90, so the fade is the cause.
- **Muted at 70:** '=' unmuted at 10 and the 70 was lost. A wheel notch up gave 5.
- **Muted at 70, then '-':** the stored base became 0 and muted was stored as false while the player stayed muted. Pressing M then showed "Sound on." with volume 0 and the crossed speaker (cur-g4-after-minus-muted-then-M.png).
- **Paused 0.6 s before the end:** one '-' gave 100 to 10, and it was still 10 after a reload.
- Screenshots: cur-b0 shows the slider full, cur-b1 shows it at about 40% after one '-'.

Per-song volume: today it cannot be set from the menu, because Trim's Save button is type=button and does nothing. v2-trim-save.mjs confirmed it: saveType "button", the dialog stays open, the preference is null. Set through pageCtx.songPref instead:
- Song at 50%, base 80: '=' gave a base of 50.
- Song at 150%, base 60: '-' gave a base of 80, and what played went from 90 to 100. Down made it louder.

Fix tried on a copy:
- I copied the app to my folder without config.js, used a stub config with the README defaults, and mounted it at misc/101-ts-fix. In the copy I added stepVolume() based on baseVolume().
- Results: 100 to 90, 80 to 90, 100 to 90, 60 to 70 to 80 to 90, 100 to 100, muted '=' brings back 70, muted '-' keeps 70 muted, 80 to 90, 60 to 50, 100 to 90 and still 90 after a reload.
- smoke.mjs PASS, and no page errors.

Severity: medium, not high. When it fires it is deterministic, jarring and saved. But it happens only in 4.5 s per song (about 2% of a 4-minute song), and only with '-', '=' and the slider's wheel. Dragging the slider, the slider's own arrow keys and the OS volume keys work correctly.
- **Fix (verified):** In misc/101-true-shuffle/app.js, make every volume step start from the base level that the slider shows.

1. After baseVolume() (app.js:4681), add:
	// The - and = keys and the slider's wheel step the level the slider shows (the base), never what
	// plays now (a fade, the song's own volume). Muted: up brings the sound back at that level, down waits.
	function stepVolume(d) {
		var v = baseVolume();
		if (player.muted()) { if (d > 0 && v > 0) toggleMute(); else if (d > 0) setVolume(d); return; }
		setVolume(v + d);
	}
2. In wireKeys (app.js:5716-5717):
	else if (k === '-' || k === '_') stepVolume(-10);
	else if (k === '=' || k === '+') stepVolume(10);
3. In wireShell (app.js:5768), the #vol wheel listener:
	function (e) { e.preventDefault(); stepVolume(e.deltaY < 0 ? 5 : -5); }
4. In pvPlay (app.js:5088), use baseVolume() instead of player.volume(), so Discover previews also play at the base level rather than a faded or per-song level.
5. In README.md:186 (Fades), add: "the - and = keys and the slider's wheel step that base volume too; while muted, = (or wheel up) brings the sound back at it and - leaves it muted."

Leave setVolume, applyVolume and the slider's input handler as they are. Optional hardening: make lazyPlayer.volume() (app.js:310) return wantVol, so no future caller reads the faded level. It is not needed once nothing reads player.volume() for the base.
- **Auditor's original fix:** Use baseVolume() (app.js:4681) instead of player.volume() in the key handler and the wheel handler. When muted, '=' and wheel-up should first unmute at the stored base (player.muted(false); renderVolume()) rather than compute from 0. Consider making lazyPlayer.volume() return wantVol, so no future caller reads the faded value.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** S
- **Risks:** - **Muted behaviour changes on purpose.** '=' or wheel-up while muted used to unmute at 10%. It now unmutes at the remembered level (as M does, and as Windows, macOS and YouTube do), so it can be louder than someone expecting a small step from 0. If the owner prefers 0 to 10, keep that branch (setVolume(d)), but still never let '-' while muted store a base of 0 or muted=false.
- **'-' while muted gives no feedback.** It now does nothing. Optionally add say('Muted.').
- **Nothing else changes.** Mid-song steps, dragging the slider and the slider's own arrow keys behave as before; I measured them on the patched copy.
- **Land it with or before the Trim fix.** Trim's Save does nothing today: U.btn drops type:'submit' (ui.js:170-175) and h() defaults buttons to type=button (ui.js:33). Once Save works, without this fix every song with its own volume would get wrong key steps for the whole song.
- **Re-run:**
  - node scripts/test-all.mjs (app.js has no unit tests, but it is cheap)
  - node scripts/qa/smoke.mjs 101-true-shuffle
  - my drive script v1-volume.mjs. Expected: fade-out '-' 100 to 90, fade-in '=' 60 to 70/80/90, wheel-up 100 to 100, muted '=' brings back the stored level, muted '-' keeps it, then M brings it back.
  - the auditor's s06-vol-prev-seek.mjs and s18-laptop.mjs
- **Check by hand:** play a Discover preview and check its volume follows the slider.
- **Evidence:**
  - s06-vol-prev-seek.mjs: fade-out, before '-' {slider:100, real:57}, after {slider:47}. Fade-in, before '=' {slider:47, real:9}, after {slider:19}. Wheel up {slider:19} -> {slider:14}
  - s18-laptop.mjs: volume 100 -> M -> '=' gives {slider:10, muted:false}
  - app.js:5716-5717 and app.js:5768 use player.volume(). app.js:310 volume() reads real.volume(); app.js:314 effective() writes real.volume(v); app.js:4684-4689 applyVolume

### listening-desktop-6 · medium · verified · Stale key hint: the Repeat button says '(r)', and r silently replaces the queue with a radio

- **Where:** Keyboard shortcuts / Repeat / radio
- **Observed:** Since the 2026-10-11 key change, R starts a radio and Shift+R repeats, but the bar's Repeat tooltip still reads 'Repeat the queue (r)'. More's 'Repeat: off' shows no key at all, because actions.js shows hints of up to 6 characters and 'Shift+R' has 7. I followed the tooltip while an artist's 24 songs played in order: all 24 were replaced by a 3-song radio, with no toast, no status message and no Undo, and repeat stayed off. The help (the header's ? button) also still says 'Edit one track with e', but E now leaves the page for Explore.
- **Why it matters:** Labels must match behaviour; destructive actions need feedback and an undo (Nielsen 1 and 3).
- **How it was verified:** I read the code first, then drove the demo myself. All scripts and PNGs are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/listening-desktop-6/. The repo is untouched: git status is the same as at the start.

CODE
- Commit 340a1a4 (2026-10-11 08:35) moved the keys. R had been Repeat since 11539c6 (2026-10-08). After the move, R starts a radio and Shift+R repeats (actions.js:36, :69; app.js:5708-5709). E explores and I edits.
- index.html:112 still sets btn-repeat's title to "Repeat the queue (r)", and no code rewrites it. The only bar title set at runtime is btn-queue's (app.js:1172).
- index.html:144: the help still says "Edit one track with <kbd>e</kbd>".
- actions.js:101 shows a menu hint only when the key has 6 characters or fewer. "Shift+R" has 7.
- The R path: startRadio (app.js:620-628) calls engine.radio, which calls app.js startFeeder (4305-4322). Its `ctx.radio && started` branch runs ctl.clearUpcoming() and then enqueues only the songs queued by hand plus 3 radio songs. There is no say(), no toast and no Undo. Clear queue does have an Undo (app.js:1160).
- keyTip (app.js:5682) is what README:1267 means by "A toast says so once". Only the E branch calls it.

DRIVE (demo, 1280x800, dark; v1-rkey.mjs, v2-tip.mjs)
- I opened #/artist/paperlanterns and clicked the page's Play. Before r:
  - playing "Small Current", with 24 songs coming
  - queueMode 'list'
  - queue header "Playing from Paper Lanterns · in order"
- I pressed r with the body focused. Within 186 ms:
  - 3 songs coming, queueMode 'feeder'
  - header "Playing from Radio: Small Current · some new songs · endless"
  - repeat still false (aria-pressed false)
  - no .ts-toast, #status empty, key tip not stored
  - 2 s later nothing had changed.
- Shift+R then switched repeat on, with a toast and a status message.
- At 1366x768 with the queue folded (Q), the only visible changes after r are:
  - the bar's mode pill: "In list order" → "Radio"
  - the fold line: "Up next: Morning Lighthouse · 23 more" → "…Paper Comets - Echo Ferry · 2 more"
  - The song keeps playing, so nothing changes audibly, and both live regions stay empty (folded-before-r.png, folded-after-r.png).
- The now panel's "Radio from this song" button does the same, also with no message.
- The More menu: "Repeat: off" shows no key hint. Its neighbours show theirs: T, F, W, I, S and ? (more-menu.png).
- The help dialog contradicts itself: Labels says "Edit one track with e", while its own Keys list (built from KEYMAP) says "E explore… I edit" (help-labels.png).
- e moved to #/explore/demo-005 and showed the one-time tip, and Back returned (e-tip.png). That part is a harmless detour. Pressing r first never shows the tip.
- I previewed a 7-character hint cap in the page (v3-fix-preview.mjs): "Shift+R" shows at 45 px in a 377 px menu, with no overflow (fix-more-menu.png).

VERDICT
The finding is real. Severity is medium, not high:
- Repeating by key is an occasional action, not a frequent task.
- Nothing durable is lost: the library and playlists are untouched, and the order can be rebuilt by playing the artist from the right row.
- The mode pill does change, and Shift+R and the Repeat button both work.

It is still worth fixing:
- The bar's own tooltip teaches a key that now throws away what was coming, with no announcement and no Undo, in the days right after the key moved.
- The help contradicts itself.
- The fix is small.

INCIDENTAL (separate issues, not part of this verdict)
1. The Keyboard shortcuts dialog opened with ? leaves focus on the body. Escape does not close it, even after Tab (v4-esc.mjs: still 1 dialog open). ui.js openDialog never moves focus inside and listens for Escape only on the dialog box, and wireKeys returns early while a dialog is open.
2. On a 390 px phone, toasts wrap at 195 px (half the screen) into 5 lines. .ts-toast is centred with left:50% plus translate and has no width:max-content (app.css:886, ds.css:193).
- **Fix (verified):** 1. index.html:112: set the title to "Repeat the queue (Shift+R)" (optionally add aria-keyshortcuts="Shift+R"). In app.js wireShell, beside U.setIcon($('btn-repeat'), 'repeat'), add $('btn-repeat').title = A.VOCAB.repeat.desc + ' (' + A.VOCAB.repeat.key + ')'; so the title follows actions.js from now on.

2. index.html:144: change it to "Edit one track with <kbd>i</kbd> or the pencil".

3. actions.js:101 item(): change `v.key.length <= 6` to `<= 7`. "Shift+R" is the only 7-character key, and I measured that it fits.

4. app.js startRadio (620-628), engine branch:
- After the optional playNow, capture `var was = S.upcoming(ctl.state()), ctx0 = context, mode0 = queueMode;`.
- Chain onto engine.radio(...): `.then(function (ids) { if (!ids || !ids.length) return; var gone = was.filter(function (id) { return !hand[id]; }), msg = 'Radio from ' + q(trackTitle(t)) + (gone.length ? ': it replaced ' + plural(gone.length, 'song') + ' that were coming.' : '.'); setStatus(msg); if (!gone.length || mode0 === 'feeder' || (TS.car && TS.car.active())) return; U.toast(msg, { action: 'Undo', onAction: function () { setQueueMode(mode0); context = ctx0; if (!thumb) store.set('context', context); if (mode0 === 'true' && bag) bagRedraw(was); ctl.clearUpcoming(); ctl.enqueue(was); renderQueue(); renderModePill(); } }); })`.
- setQueueMode stops the feeder.
- bagRedraw(was) is the bag block that sits inline in clearUpcoming's Undo today (app.js:1161). Move it into a function that both Undos use.
- Optionally, add " Repeat is Shift+R." to the toast when the radio came from the R key.

5. test.js, next to the index.html checks (~2417), assert three things:
- html contains 'title="Repeat the queue (' + A.VOCAB.repeat.key + ')"'
- html has no 'with <kbd>e</kbd>'
- A.item('repeat', null).hint === 'Shift+R'

6. README:1267: add that R's radio says what it replaced and offers Undo.
- **Auditor's original fix:** index.html:112: change the title to 'Repeat the queue (Shift+R)'. index.html:144: change the key to <kbd>i</kbd>. In actions.js item(), allow 7-character hints. Better still, set the bar's titles in wireShell from A.VOCAB[...].key so they cannot drift again. In startRadio (app.js:620), save { upcoming: S.upcoming(ctl.state()), context, queueMode } and toast 'Radio from "X": it replaces what was coming.' with an Undo that stops the feeder, clears what is coming and enqueues the saved songs.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/test.js`, `misc/101-true-shuffle/README.md` · **Effort:** S
- **Risks:** - **app.js line cap.** test.js:2416 caps app.js at 5,950 lines and it has 5,941 now. The Undo must add 9 lines or fewer net; moving clearUpcoming's bag block into bagRedraw makes it fit. Otherwise the cap test fails.
- **Cache stamp.** Changing app.js or actions.js means bumping the shared ?v=2026101115 stamp on every script and stylesheet in index.html. test.js:2420 requires one stamp, and without the bump browsers keep the old actions.js.
- **Toasts replace each other.** U.toast has one element, so a later toast wipes the Undo:
  - car.js radio() and cycleRatio() show their own line right after play.radio. That is why the fix skips car mode and the radio-to-radio case (mode0 === 'feeder').
  - For you's "Start your radio" and explore.js's "Start radio" call en.radio directly, so they keep today's behaviour with no Undo. That is consistent with now, though not ideal.
- **True-shuffle Undo.** startFeeder has already put the dropped songs back in the bag (returnToBag). The Undo must mark them drawn again (bagRedraw), or a song could play twice in one cycle. Test this: shuffle the library, press R, press Undo, then check that S.bagPlayed and S.bagRemaining hold no duplicates of `was`. Songs queued by hand must keep their place, which they do because they are in `was`.
- **Phone toast width.** On phones toasts wrap at 195 px today, so keep the text short.

Re-run:
- node misc/101-true-shuffle/test.js
- node scripts/qa/smoke.mjs 101-true-shuffle
- node scripts/test-all.mjs
- v1-rkey.mjs and v2-tip.mjs from my folder. Expect a toast with Undo; after Undo, 24 songs coming, mode 'list' and the header "Paper Lanterns · in order".
- A true-shuffle version of the same check.
- #/car's radio button: no Undo toast.
- For you's "Start your radio": message unchanged.
- The phone sheet's radio button.
- **Evidence:**
  - s03-titles.mjs: btn-repeat title "Repeat the queue (r)"; s09 shows the same title after toggling repeat
  - s15-r-key.mjs: before r {ctx:'Playing from Paper Lanterns · in order', upCount:24}; after r {repeat:false, ctx:'Playing from Radio: Small Current · some new songs', upCount:3, toast:'(no toast)', status:'(no status)'}
  - s02-keys.mjs, row r: queue items 15 -> 5, no toast. C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/r-after.png; shots/k-help.png (the shortcuts list itself says Shift+R)
  - index.html:112 (the title), index.html:144 (help: 'Edit one track with <kbd>e</kbd>'), app.js:5708-5709, app.js:620-629 (startRadio has no say() and no Undo), actions.js:101 (6-character hint cap)

### library-2 · medium · verified · Remove (a YouTube playlist) in Settings deletes songs at one click and empties hand-picked playlists

- **Where:** Settings > YouTube > In the library
- **Observed:** I clicked Remove once next to 'Everything I like' (3,000 tracks). There was no confirmation. 136 songs were deleted from the library, and the hand-picked playlist 'Hand picks' went from '5 songs' to '0 songs', because its 5 ids now point at nothing. The toast says 'tracks you played, rated, labelled or that are in another playlist stay', but only YouTube playlists count as 'another playlist'. There is no Undo; getting the songs back needs a re-import, which costs quota.
- **Why it matters:** Confirm destructive actions and state their consequences truthfully. Never let one feature silently break the user's data in another.
- **How it was verified:** I read the code and reproduced the finding in real mode with my own script, ux/verify/library-2/remove.mjs. Screenshots are in ux/verify/library-2/shots/.

CODE
- app.js:2920: each "In the library" row has a Remove button. It is 75x32 px, styled `ts-btn--secondary ts-btn--sm`, has no aria-label, and calls `removePlaylist(p)` directly.
- app.js:3105-3111: that function runs `L.removePlaylist(lib, p.id, { dropOrphans: true })`, then `store.deleteTracks`, then `say()`. It shows a plain toast with no action, which hides after 3.5 s (ui.js:515).
- library.js:646: a track is kept only for plays, skips, rating, blocked, tags or userEdits.
- Two things are never consulted:
  - the hand-picked lists (app.js:3254, `kind: 'manual'`, `ids`)
  - `songPrefs` (app.js:320)
- `dropOrphans` came in b4c899a (2026-10-06). Hand-picked lists and the Remove button came in 8f036b1 (2026-10-08). The keep rule is older than hand-picked lists, so this is an oversight, not a decision. README:1534 only promises "deletes only untouched tracks that are in no other playlist".
- The same page treats other destructive actions differently: "Delete everything stored here" is `ts-btn--danger` and asks first (app.js:3001). Removing songs from a hand-picked list offers Undo (app.js:3356).

DRIVE (real mode, Google API hosts and the other services blocked, externalHosts [], 0 page errors)
- Seeded IndexedDB with 700 tracks:
  - "Everything I like": 620 tracks
  - "Car songs": 110 tracks, 30 of them shared with the first list
- Of the 590 tracks only in "Everything I like":
  - 8 hand-picked only, plus 2 hand-picked and played, in "Hand picks"
  - 20 in "Wedding"
  - 1 with Trim and volume set
  - 40 carrying labels from an applied labels file
  - controls: 10 corrected, 20 rated, 5 tagged, 200 played
- One real mouse click on Remove:
  - 0 native dialogs and no `.ts-modal`.
  - The library went from 700 to 347 at once (353 deleted). It is persisted: still 347 after a reload.
  - The toast read 'Removed "Everything I like": 353 tracks deleted; tracks you played, rated, labelled or that are in another playlist stay.' It had no Undo.
- What was deleted:
  - hand-picked only: 0 of 8 left
  - Wedding: 0 of 20 left
  - trimmed song: 0 of 1 left (its songprefs entry is left orphaned)
  - labels-file songs: 0 of 40 left. The Labels panel went from "40 of 700 tracks carry labels" to "0 of 347", so "labelled ... stay" is untrue too.
- Every control survived: played 200, rated 20, tagged 5, corrected 10, shared 30, hand-picked and played 2.
- What the lists show afterwards:
  - "Hand picks" went from "10 songs · 45 min" to "2 songs · 8 min".
  - "Wedding" went from 20 songs to "0 songs" with the empty state "Empty. Add songs from any song's menu" (shots/06-wedding-after.png).
  - The Playlists page says "Hand-picked · 0 songs" (07), and the Focus menu shows "Wedding 0".

RECOVERABILITY (why medium, not high or critical)
- The list records keep their ids (10 and 20 after the reload).
- A simulated re-import (`L.upsert` of the same videos, which is what yt.js `importInto` does) brought both lists back to 10 and 20 songs.
- So recovery works if the user signs in and re-imports. That costs little quota: README says 1,230 items cost 49 units.
- The loss is permanent only when the playlist is gone from YouTube, which is a plausible reason to remove it.
- Removing a source playlist is a rare task.
- Still, it is a one-click bulk delete with untruthful feedback that silently empties the user's own playlists. That makes it real and worth fixing.

WHERE I DISAGREE WITH THE AUDITOR
- History needs no check: `L.recordPlay` always increments plays or skips (library.js:961-968).
- Keeping tracks that carry labels would make Remove delete almost nothing in the owner's library, because labels.json covers it and re-applies after any import. The fix for labels is the wording, not the rule.
- The proposed "unlink only by default" checkbox would make Remove leave every song in the library and the shuffles. That defeats the action and adds a decision people can't make well.
- **Fix (verified):** 1. library.js
   - Turn the test at line 646 into `function untouched(t)`.
   - Let `removePlaylist(lib, playlistId, opts)` take an `opts.keep(id)` predicate and skip deleting any id for which it returns true.
   - Add and export a pure `orphansOf(lib, playlistId, keep)`. It returns the ids that `removePlaylist` would delete: tracks whose only playlist is `playlistId`, that are `untouched`, and for which `keep` is not true. Use it inside `removePlaylist` so the count shown and the count deleted come from the same code.
   - Update the README.md:1534 row.
   - In test.js after line 738, add two cases: an id passed through `keep` survives, and `orphansOf` equals `rec.deleted`.

2. app.js `removePlaylist(p)` (line 3105): build the keep rule, then ask before deleting.
   - Build `held` from the ids of every `lists` entry with `kind === 'manual'` and from `Object.keys(songPrefs)`. Set `keep = function (id) { return !!held[id]; }`.
   - Compute:
     - `total`: the tracks whose `playlists` include `p.id`
     - `goes`: `L.orphansOf(lib, p.id, keep)`
   - Open `U.openDialog({ title: 'Remove ' + q(p.title) + ' from the library?' })`, modelled on "Delete everything?" (app.js:3001-3005).
   - Text: "N of its T songs will be deleted from this browser: the ones in no other YouTube playlist that you never played, rated, tagged, corrected or put in one of your playlists. M stay. Nothing changes on YouTube; importing the list again brings them back."
   - Buttons:
     - `ts-btn ts-btn--danger ts-btn--md`, labelled "Remove and delete N songs" (just "Remove" when N is 0)
     - `ts-btn--secondary` "Keep it", which gets the focus
   - On confirm, run the existing code with `{ dropOrphans: true, keep: keep }`.
   - New toast: 'Removed "X": N songs deleted, M kept.' This drops "labelled", which is false for labels-file labels.

3. app.js:2920: give each Remove button `aria: { label: 'Remove ' + (p.title || p.id) + ' from the library' }`. Today two buttons are both just "Remove".

Optional: Undo in the toast, like app.js:3356.
- Snapshot the deleted tracks whole and the `lib.playlists[p.id]` record.
- On Undo:
  - put the deleted tracks and the playlist record back
  - for kept tracks, re-add only `p.id` and `addedAt[p.id]`
  - then `store.putTracks` / `putPlaylists`, `saveMeta()` and `afterLibraryChange()`

The confirmation alone is enough.
- **Auditor's original fix:** Open a confirmation before removing: "Remove 'Everything I like' from the library? 136 songs that are only in this list will be deleted; 2,864 stay." Add a box 'Also delete songs that are only in this list' and leave it off by default, so a removal only unlinks the songs. Give L.removePlaylist a keep(id) predicate from app.js that keeps every id in a manual list, in songprefs and in the history. Keep the removed tracks and the playlist record in memory so the toast can offer Undo.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/library.js`, `misc/101-true-shuffle/test.js`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** What could break:
- The keep rule must cover only hand-picked lists. Smart lists are filters, and one built on that YouTube playlist should empty. Guard against a missing `li.ids`.
- The dialog's numbers and the deletion must come from the same `orphansOf` and `keep`, or they will drift apart.
- Kept songs end up with `playlists: []`. Check that the "In the library" counts, the track menu's "Add to YouTube playlist" (shown for songs outside any playlist) and the #/fix views handle such loose songs.
- Labels-file tracks are still deleted after this fix (by design). Their labels come back by applying the file again; site labels come back after a re-import.
- If Undo is added, it must not overwrite plays or ratings recorded on kept tracks during the 7-second toast.
- The new dialog uses `U.openDialog`, which already handles the YouTube player's safe area, the same way "Delete everything?" and "Restore this backup?" do.

Re-run:
- `node misc/101-true-shuffle/test.js` (or `node scripts/test-all.mjs`)
- `node scripts/qa/smoke.mjs 101-true-shuffle`
- `node scripts/qa/drive.mjs <scratchpad>/ux/verify/library-2/remove.mjs <outdir>`. Expected:
  - a `.ts-modal` appears
  - Keep it or Escape leaves 700 tracks
  - confirming keeps "Hand picks" at 10, "Wedding" at 20 and the trimmed song
  - confirming deletes 324 (284 untouched plus 40 with file labels), and the dialog said 324
  - focus starts on Keep it
- A 390x844 phone run of #/settings to check the dialog and the Remove row.
- **Evidence:**
  - real.mjs (step remove): 'R1 hand-picked list before {meta: 5 songs, rows: 5}'; 'R2 after one click on Remove: confirm dialogs 0 modal false library 3200 -> 3064 toast Removed “Everything I like”: 136 tracks deleted; tracks you played, rated, labelled or that are in another playlist stay. action null'; 'R3 hand-picked list after {meta: 0 songs, rows: 0, ids: 5}'
  - Screenshots: .../library/shots/real-settings-in-library.png (Remove buttons beside each playlist), .../library/shots/real-handpicked-after-remove.png ('Hand picks', 0 songs, 'Empty.')
  - app.js:2920: Remove calls removePlaylist(p) directly; app.js:3105-3111: L.removePlaylist with { dropOrphans: true }
  - library.js:646: a track is kept only for plays, skips, rating, blocked, tags or userEdits. Membership in a hand-picked playlist (lists[].ids), songprefs, site labels and history are not checked.

### library-3 · medium · verified · Delete playlist: no confirmation and no undo

- **Where:** Playlists (#/list/<id>)
- **Observed:** In the playlist's More actions > More > Delete playlist, one click deleted the 5-song hand-picked playlist 'Road trip'. The toast 'Deleted “Road trip”.' has no Undo, and the old address now says 'This playlist is gone.' Removing one song from a playlist offers Undo; deleting the whole hand-made list does not.
- **Why it matters:** An action that loses data the user made needs an undo, or at least a confirmation.
- **How it was verified:** I reproduced it independently in code and with the harness, then tested the fix on a patched copy of app.js served from memory. The repo was not changed. Folder: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-3/ (scripts verify.mjs, tabundo.mjs, tabafter.mjs, proto.mjs, proto2.mjs; PNGs in shots/ and shots2/).

CODE
- app.js:3455 (viewList, More menu, "Delete playlist") does four things in one step: it filters the list out of `lists`, clears Focus if this list was focused, calls saveLists() and goes to #/lists. saveLists() writes the IndexedDB key 'lists', queues the Desk sync outbox (4 s debounce) and redraws the nav.
- It then calls say(), which shows a plain toast for 3.5 s (ui.js:506-516; a toast with an action lasts 7 s). There is no dialog and no Undo.
- removeFromList (app.js:3350-3357) has an Undo toast at 3356. So do liking, Saved for later, Clear upcoming and Block.
- The house confirm pattern exists at app.js:2999-3006: "Delete everything?" with a danger button and "Keep it" focused.
- Nothing in the README says this is intended.

DESKTOP (demo, 1280x860, dark)
- Made a 5-song hand-picked "Road trip" through the UI: selected 5 rows, Add to playlist > New playlist…
- For comparison, removing 1 song showed "1 song removed from “Road trip”." with Undo, and Undo brought it back to 5 songs.
- Header: Play, Shuffle, Focus, ⋯. The ⋯ (40x40) opens a menu with one item, "More". That opens the real menu: Rename…, Edit every song…, Delete playlist. Delete has no separator, no danger style and an × icon.
- One click on Delete: 0 native dialogs, no .ts-modal, lists 1→0, route #/lists. The toast "Deleted “Road trip”." has no action and stays about 3.5 s.
- Browser Back shows "This playlist is gone."

KEYBOARD AND PHONE
- From the More actions button, 4 keys (Enter, Enter, End, Enter) delete the list with no prompt.
- Phone (390x844, mobile, taps): same result; the toast stays 3.6 s.

REAL MODE (Google API hosts blocked, 30 synthetic songs in IndexedDB)
- store.get('lists') was ["Road trip:5"]. After Delete and a reload it was [], and the old address said "This playlist is gone."
- No external hosts were contacted. The database was deleted afterwards.
- The only way back is restoring a whole backup, which replaces everything.

WHY UNDO ALONE IS NOT ENOUGH
- After a delete the app moves focus to the "Playlists" h1 on #/lists. I added an Undo toast with the app's own U.toast: it was 82 Tabs (or 35 Shift+Tabs) away, so a keyboard or screen-reader user cannot reach it in 7 s.
- Removing a song is different: focus falls to BODY and 1 Tab reaches Undo, which is why that flow works.

PROTOTYPE OF THE FIX (CDP Fetch served a patched app.js)
- 5-song hand-picked list: a dialog "Delete “Road trip”?" with "5 hand-picked songs. The songs stay in your library; only the playlist goes." and buttons [Delete playlist (danger)] [Keep it], with "Keep it" focused.
- Enter or Escape keeps the list. With the opener line, focus returns to the More actions button; without it, focus goes to BODY.
- Confirming removes the list, shows "Deleted “Road trip”. Undo" and switches Focus to Everything.
- Undo puts it back at its old index, restores Focus to "Road trip", returns to #/list/<id> and shows it in the sidebar.
- Smart and empty hand-picked lists get no dialog, only Undo, which works.
- The 4-key keyboard path now stops at the dialog.
- Phone: the dialog is a bottom sheet (0,629, 390x215) with no horizontal overflow. On desktop the YouTube panel stays undimmed. 0 page errors.

SEVERITY: medium, not high. Deleting a playlist is infrequent, two menus deep and clearly labelled, so it is not a frequent-task problem or a barrier. But a slip permanently loses the most hand-made data in the app, and it breaks the app's own Undo convention.

SCREENSHOTS (in shots/)
- Before the fix: desk-0b-remove-song-toast.png, desk-1-first-menu.png, desk-2-second-menu.png, desk-3-after-delete.png, desk-4-back-to-old-address.png, phone-2-second-menu.png, phone-3-after-delete.png, kbd-after-delete.png.
- Prototype: proto-1-confirm.png, proto-2-deleted-toast.png, proto-3-after-undo.png, proto-4-kbd-confirm.png, proto-5-phone-confirm.png.

SEPARATE ISSUE (not this finding): the second menu jumps to the window's top-left corner at (8,4).
- Desktop: "More" was clicked at (726,427). Phone: tapped at (126,516); the menu lands over the top bar.
- Cause: viewList's More iconBtn is never added to the DOM, because headerBlock folds the 4th action into moreActions (app.js:1770-1771, 1778-1786). Its handler then anchors U.openMenu to e.currentTarget (app.js:3450-3451), which has a zero-size rect.
- **Fix (verified):** In misc/101-true-shuffle/app.js, viewList (line 3455): change the Delete item to `{ label: 'Delete playlist', icon: 'close', onSelect: function () { deleteList(li); } }`. Add these two functions just above renameList (line 3466), in ES5 with tabs. This is the code I prototyped and checked:

	// Delete a playlist. A hand-picked one with songs asks first; every delete can be undone.
	function deleteList(li) {
		var k = li.kind === 'manual' ? (li.ids || []).length : 0;
		if (!k) { dropList(li); return; }
		var opener = $('view').querySelector('.ts-actions [data-label="More actions"]'); if (opener) opener.focus();
		var d = U.openDialog({ title: 'Delete ' + q(li.name) + '?' });
		d.body.appendChild(h('p', { text: plural(k, 'hand-picked song') + '. The songs stay in your library; only the playlist goes.' }));
		var no = h('button', { class: 'ts-btn ts-btn--secondary ts-btn--md', text: 'Keep it', on: { click: d.close } });
		d.body.appendChild(h('div', { class: 'ts-row-btns' }, [h('button', { class: 'ts-btn ts-btn--danger ts-btn--md', text: 'Delete playlist', on: { click: function () { d.close(); dropList(li); } } }), no]));
		no.focus();
	}
	function dropList(li) {
		var at = lists.indexOf(li), wasFocus = focus === li.id;
		lists = lists.filter(function (x) { return x !== li; });
		if (wasFocus) setFocus(null, true);
		saveLists();
		location.hash = '#/lists';
		setStatus('Deleted ' + q(li.name) + '.');
		U.toast('Deleted ' + q(li.name) + '.', { action: 'Undo', onAction: function () {
			if (!listById(li.id)) { lists.splice(Math.min(at, lists.length), 0, li); saveLists(); }
			if (wasFocus) setFocus(li.id, true);
			location.hash = link('list', li.id);
			setStatus('Restored ' + q(li.name) + '.');
		} });
	}

What this does:
- A hand-picked playlist with songs gets a confirm dialog, using the house pattern of the "Delete everything?" dialog (danger button, "Keep it" focused). This is the part that protects keyboard users, who cannot reach a 7 s toast from the Playlists h1.
- Every delete gets an Undo toast. It puts the list back at its old position, restores Focus if the list was focused, and returns to the list's page.
- Smart playlists (saved filters, often made by one click on a suggestion or Focus) and empty hand-picked lists get Undo only, no dialog.
- The opener line makes "Keep it" and Escape return keyboard focus to the More actions button instead of BODY.

Optionally, add one sentence to README.md's "Playlists and focus" paragraph (line 152): "Delete playlist asks first for a hand-picked playlist that holds songs; every delete has Undo."
- **Auditor's original fix:** In viewList's Delete item, remember { li, index, wasFocused } before removing it, then call U.toast('Deleted “X”.', { action: 'Undo', onAction: put li back at index, saveLists(), restore the focus and route }). For a hand-picked playlist that holds songs, also confirm with its song count: 'Delete “Road trip” (5 songs)?'.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** S
- **Risks:** What could go wrong with the fix:
- **Single toast:** the app has one toast element (ui.js:506-516). Any later toast within 7 s replaces the Undo. setFocus(null, true) is quiet, so the delete itself does not do this.
- **Keyboard users:** they still cannot reach a toast's Undo from the Playlists h1 (82 Tabs). That is why hand-picked lists with songs also get the dialog. For smart and empty lists only the toast protects, which is acceptable because they are cheap to recreate.
- **Queue re-dealt:** Undo on a list that was focused calls setFocus, which calls applyPlan and re-deals the upcoming true-shuffle queue. The delete already re-dealt it.
- **Desk sync:** checkInbox (app.js:4122-4124) adds back any station id missing locally, so a delivered inbox can resurrect a deleted list. The listById guard stops Undo from creating a duplicate. Deletes not propagating through sync is a separate, pre-existing issue.
- **Focus return:** the opener lookup depends on headerBlock folding More into its "More actions" button. If the header ever changes and the lookup returns null, focus falls to BODY as it does today, which is harmless.
- **Undo navigates:** Undo goes to the list's page even if the user has moved elsewhere within the 7 s.

Re-run after the fix:
- `node scripts/qa/smoke.mjs 101-true-shuffle`
- `node scripts/test-all.mjs` (app.js has no unit test for viewList)
- My drive scripts in the verify folder: verify.mjs (parts desk, kbd, phone, real; real mode with Google hosts blocked) and proto.mjs. Expect a dialog only for "Road trip:5", none for smart or empty lists, Undo restoring the order, Focus and route, and 0 errors.
- The auditor's scratchpad/ux/audit/library/lists.mjs. Its step 8 will now meet the modal and has to press "Delete playlist" in it.

Separate issue to route elsewhere, not fixed here: the second "More" menu opens at the window's top-left corner (8,4), far from the pointer, on desktop and phone. Cause: the anchor is a button that is never in the DOM (app.js:1770-1771, 1778-1786, 3450-3451).
- **Evidence:**
  - lists.mjs: '8 delete: confirm dialogs 0 modal false lists before 5 after 4 route #/lists toast {text: Deleted “Road trip”., action: null}'; '8b the old address This playlist is gone.'
  - app.js:3455: Delete filters the list out and calls saveLists(), with no dialog and no toast action
  - app.js:3350-3357: removeFromList already offers an Undo toast

### library-5 · medium · verified · Every action throws the selection away

- **Where:** Songs table: selection (click, Shift, Ctrl)
- **Observed:** After Shift-selecting 5 rows and rating them, 0 rows were selected. After Ctrl-selecting 3 rows and pressing a heart on one, 0 were selected. After selecting 4, pressing Edit and saving, 0 were selected. Typing in the filter or changing the sort also rebuilds the list from scratch. A multi-step bulk job (rate these, add them to a playlist, block one) means selecting the same songs again before each step.
- **Why it matters:** Keep the user's working set across operations, so bulk workflows don't need the same input twice.
- **How it was verified:** Code read: app.js:1235 creates `sel = { ids: {}, anchor: -1, focus: 0 }` inside trackList. Every redraw rebuilds the list with an empty selection. changed() (658-668) calls redrawView (657, 120 ms debounce), then renderView(true) (759) runs clear(view) (767) and calls the view function again. setQuery (2118-2129) calls renderView(true) synchronously. These all go through changed(): rateIds (1467), blockIds (1472), toggleLike (4710; used by the row heart, the bar heart and L), the now-playing stars (1015) and the editor's submit (1742). queueNext, queueLater (581/589) and addToList (3333) do not.

Demo, 1280x860 dark (verify/library-5/sel.mjs, log sel.txt). I made selections with real CDP mouse events (Shift modifier 8, Ctrl 2), then sampled `.ts-row.is-sel` every 15 ms for 800 ms after each action. Selection before → after, and when it vanished:
- Rating 3 via the bar's More: 5→0 at 142 ms. The ratings were applied (3,3,3,3,3) and the bar is gone.
- Bar heart on the playing song, which was not in the selection: 3→0 at 143 ms.
- L key: 3→0 at 146 ms.
- Heart on a selected row: 3→0 at 141 ms.
- Bar Edit, Year 1999, Enter: 4→0 at 144 ms.
- Keyboard Shift+Down x3, I, Enter: 4→0.
- Block: 3→0 at 136 ms.
- Now-playing stars: 3→0.
- Sort change: 3→0 at once. Filter: 3→0.
- Kept: Play next 3→3, and Add to playlist (opened, then Escape) 3→3. So behaviour is inconsistent.
Screenshots: shots/A1-five-selected.png, shots/A2-after-bulk-rate.png (highlights and bar gone, only the toast), shots/B-after-bar-heart.png.

Keyboard, same root cause: after every redraw the focus lands on <body>. renderView's focusKey restore (783-785) runs before the virtual rows exist: vl.set (1348) runs before the wrap is attached, place() returns while not connected, and the rows only appear in the rAF (1351). In deep.mjs (rows 104-108 selected, scrollTop 6291, then a keyboard bulk rating), no row has tabindex=0 in the DOM, and 40 Tabs later the focus lands on row 0 at the top. The accessibility audit's focuskeep.txt reports the focus side separately.

Prototype: I copied the app without config.js (stub with no keys) to verify/library-5/proto and mounted it as misc/98-tsproto. The patch is about 35 lines in app.js plus one CSS rule.
- All 10 actions keep the selection and the bar.
- The focus goes back to the row in 6 cases.
- Escape and Clear still clear, and stay cleared after a redraw. Leaving the page and coming back clears.
- On a work page with Openings and Endings lists, each list keeps its own selection (2 and 1) after a heart (multi.mjs; shots-proto/multi-after-heart-proto.png).
- In the deep list, row 108 keeps the tab stop.
- smoke.mjs --path misc/98-tsproto: PASS.

Collision found: the fixed toast already sits on the sticky bar after Play next (toastbar.mjs). Overlap is 5,663 px² at 1024, 1280 and 1440 wide; at 800 wide the toast covers 'Clear the selection' (shots/toast-playnext-orig-800.png). Keeping the bar after rate, edit or like makes this happen more often (shots-proto/toast-rate-proto-1024.png). With body.has-selbar lifting the toast: 0 px² at all 4 widths.

Severity is medium, not high. No data is lost, single-step bulk actions work, and touch screens have no selection. The cost is re-selecting before each later step: 2 clicks for a contiguous range that hasn't moved, N Ctrl-clicks for a scattered pick. There is also the surprise of liking or rating the playing song and losing a selection. Multi-step bulk curation is occasional in this app.
- **Fix (verified):** Keep one selection per page, by track id, shared by that page's lists. Tested as a prototype; changes to app.js unless noted.

1. Next to `var listSel` (1224), add a module variable for the page's selection: `var selMemo = { path: null, ids: {}, anchor: null, focus: null }, selShown = {}, selRefocus = false;`

2. renderView (759):
   - Before clear(view), add: `if (!keep || selMemo.path !== route.path) selMemo = { path: route.path, ids: {}, anchor: null, focus: null }; if (focusKey) selMemo.focus = focusKey; selRefocus = !!(keep && ae && ae !== document.body && view.contains(ae)); selShown = {};`
   - After clear(view), add `document.body.classList.remove('has-selbar');`
   - After the `fn(view, ...)` try/catch, add `Object.keys(selMemo.ids).forEach(function (id) { if (!selShown[id]) delete selMemo.ids[id]; });`. Songs that a filter or a removal hides then leave the selection, so there are no hidden targets.

3. trackList (1235): fill `sel` from the memo. For each `ids[i]`:
   - set `selShown[id] = true`;
   - if `selMemo.ids[id]`, set `sel.ids[id] = true` and `seeded = true`;
   - if id is `selMemo.anchor`, set `sel.anchor = i`; if id is `selMemo.focus`, set `sel.focus = i`.
   Add `remember()`. It rewrites only this list's ids (`if (sel.ids[id]) selMemo.ids[id] = true; else delete selMemo.ids[id]`) and stores anchor and focus as ids, not indexes, because indexes move after a re-sort. Call it at the top of `selBar(redraw)` when `!redraw`; select, Ctrl+A, Escape and Clear already call selBar. Also call it in the plain-arrow branch (1328): `else { sel.focus = to; remember(); }`.

4. Replace `requestAnimationFrame(function () { vl.place(); })` (1351) with a callback that:
   - returns if `!wrap.isConnected`, then calls `vl.place()`;
   - calls `selBar(true)` if this list has 2 or more selected and holds `selMemo.focus` (or no `.ts-selbar` exists yet), so a list with 0 or 1 selected never removes another list's bar;
   - calls `focusRow(sel.focus)` if `selRefocus` is set, the focus is on <body>, `ids[sel.focus] === selMemo.focus` and `!U.dialogOpen()`.

5. Lift the toast above the bar.
   - In selBar, when the bar is shown, add `document.body.classList.add('has-selbar')` and `document.body.style.setProperty('--ts-selbar-h', bar.offsetHeight + 'px')`. Remove the class where the bar is removed.
   - In app.css, next to `body.has-pvbar .ts-toast` (948), add `body.has-selbar .ts-toast { bottom: calc(var(--ts-bar) + var(--ts-selbar-h, 96px) + 24px); }`.

6. README line 150: add that the selection stays through ratings, likes, edits, sorting and filtering on the same page, and that Escape or the bar's close button clears it. Bump the ?v= stamps in index.html (README 1877).

Do not key the memo by route.path alone with one list writing every id, and do not key it by list ordinal. Work pages (2477-2482) and person pages (5627-5628) have two lists: with the first design, one list erases the other's selection; with ordinals, keys shift when a role edit moves songs between sections.
- **Auditor's original fix:** Keep the selection outside trackList, in a module-level selMemo keyed by route.path: { ids, anchor, focus }. trackList reads it when it builds, dropping ids no longer in `tracks`, and writes it on every select(). Clear it only on Escape, the bar's Clear button, or a move to another route. After that, a redraw following a rating, like or edit keeps both the rows and the selection bar.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/README.md`, `misc/101-true-shuffle/index.html` · **Effort:** M
- **Risks:** - **Edit key after a kept selection.** I on a focused row edits `current() || [row]` (1322), so after a kept selection, I on another row edits the whole selection. The editor's title says 'Edit N tracks', so it is visible. Consider making I edit only the focused row when that row is outside the selection.
- **Shared bar on multi-list pages.** These pages share one .ts-selbar, which is already the case today. The order of the rAF callbacks must not let a list with 0 or 1 selected remove another list's bar; the 2-or-more plus owner check handles this.
- **Focus restore guards.** The restore must not take focus from a dialog (the U.dialogOpen guard; offerTeach opens one right after changed()) or from anything outside #view (the selRefocus guard).
- **Toast class on other pages.** The has-selbar class must be cleared in renderView. Otherwise toasts float about 120 px too high on other pages.
- **Rating menu focus (adjacent, not fixed by this).** ratingMenu (1465) opens without returnTo, and ui.js:297 sets menuReturn to null, so after Rating… > n stars the focus drops to <body> before any redraw. Pass the opener as returnTo.
- **Filter narrowing.** The filter now narrows the selection: clearing the filter does not bring back songs that were dropped.
- **Re-run:**
  - `node misc/101-true-shuffle/test.js`, `node scripts/qa/smoke.mjs 101-true-shuffle`, `node scripts/test-all.mjs`.
  - The drive scripts in scratchpad/ux/verify/library-5 (sel.mjs, multi.mjs, deep.mjs, toastbar.mjs; pass the app path as the second argument), plus audit/library/songs.mjs and audit/accessibility/focuskeep.mjs.
  - Check every view with a track list by hand: songs, liked, artist, genre, work sections, person page, playlist (Remove from…), search, mix builder, versions, Needs attention, and fuzzy close matches.
- **Evidence:**
  - songs.mjs: '5a after click + shift-click {sel:5, bar: 5 tracks selected}' then '5c ... selection now {sel:0, bar:null}'
  - songs.mjs: '6a ctrl-selected {sel:3}' then '6b after a heart on one selected row {sel:0, bar:null}'; '7b ... selection {sel:0}'
  - real.mjs: 'S3b selection after save {sel: 0, bar: false}' (after a 3,200-song bulk edit)
  - app.js:1235: sel = { ids: {} } is created inside trackList on every render
  - app.js:657-668: changed() calls redrawView, i.e. renderView(true); app.js:759-770: renderView clears the view; app.js:2118-2130: setQuery calls renderView(true)

### library-6 · medium · verified · On a phone songs can't be multi-selected, so bulk tasks are impossible

- **Where:** Touch: Songs table and every track list
- **Observed:** At 390x844 with touch, a long press selects one row and opens the one-song menu. A long press on another row replaces it, so the selection is always 1 and the selection bar never appears. Needs attention tells you to 'Select several and press Edit to label them together', which can't be done on the phone. Adding 10 songs to a playlist takes about 30 taps (long press, Add to playlist…, the playlist, 10 times). Even one-song management is cramped: the long-press menu is capped at 70vh, so 'Block (never shuffle)' sits below the fold (scroll height 663 px in a 589 px box) with no cue, and the menu shows the key hints R, E and I on a touch screen.
- **Why it matters:** Core library tasks should be possible on every supported device. Keep the decided 'a tap plays' behaviour by making selection an explicit mode.
- **How it was verified:** I read the cited code and drove the demo at 390x844 with touch emulation (pointer: coarse and hover: none both matched). Scripts and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-6/ (verify.mjs, order.mjs, playing.mjs, taps.mjs, longpress*.mjs, shots/).

CODE. app.js:1272: a row's click handler returns early for a touch. app.js:1279: contextmenu calls select(i, e, true) with no Ctrl or Shift, so it replaces the selection. app.js:1280: a touch pointerup plays the song. app.js:1336: the bar appears only for 2 or more songs. Space, Shift and Ctrl+A (1320-1326) work only from a keyboard. README:150 says lists select "with click, Ctrl or Cmd and Shift ... (one tap on a phone)". Nothing says phones are left out on purpose, and this is not in the decided list. The phone's Library hub (viewLibrary, app.js:2544) links to Needs attention, Playlists and the labeller, so library work on the phone is meant to be possible.

DRIVEN.
1. More on row 0, then More on row 3: only row 3 is selected and there is no .ts-selbar. A long press in Android's event order (a CDP touchStart, contextmenu at 520 ms, then touchEnd) selects only row 1. No touch path selects two songs.
2. The menu, from More on rows 0, 2 and 6 and from a long press at y=685: 220x591 px (the 70vh cap), scrollHeight 663 against clientHeight 589. 12 of 14 items are fully shown. "Trim and volume..." sits exactly at the bottom edge and "Block (never shuffle)" is entirely below it. The edge falls between items, so the menu looks complete (shots/M-more-row2-dark.png). The scrollbar is 2 px wide. At 360x740 only 10 of 14 items show. The key hints R, E and I are shown on touch, while duel.js:310 hides its own key hints on touch.
3. #/fix?tab=unlabelled at 390 px reads "Select several and press Edit to label them together." (shots/F1-fix-unlabelled-dark.png).
4. With real taps, putting 5 songs in a new hand-picked playlist one at a time took 16 taps. The first song takes 4 (More, Add to playlist..., New playlist..., Create), and Create also jumps to the new playlist's page. Each later song takes 3. That is about 3 taps per song, as the finding says.
5. The existing bar, made from the keyboard, works at 390 px: 358x140 px, three wrapped lines above the mini player (shots/S1-selbar-phone-dark.png). It can be reused.

Found while checking, and they affect the fix:
(a) In Android's order, the finger's release reaches the row's pointerup handler (app.js:1280) whenever the menu did not open over the finger. Row 4 started playing "Hidden Current" with its menu still open (shots/O-row4-after-release.png). This is emulated: headless Chrome on Windows runs no long-press detection, and touches held 900-1000 ms through dispatchTouchEvent or synthesizeTapGesture fired no contextmenu.
(b) While a song plays on a phone, the menu covers the YouTube player docked at the top of the screen. The menu box is (8,4)-(228,595) and the player (0,52)-(390,271): 219 px of overlap at 390x844, and 210 px at 360x740 (shots/P-playing-menu-row0-*.png). ui.js safe.avoid (lines 482-496) falls back to the original box when no spot fits, since 591 > 844-271-16. This breaks the YouTube-terms rule and should be filed as its own finding.

SEVERITY: medium, not high. On the phone, every action is still possible one song at a time through the row's More (⋮) button, and the common bulk cases have other routes: Save as playlist, a playlist's "Edit every song...", and the quick labeller. What is missing is choosing any set of several songs by touch, and Needs attention tells phone users to do it anyway.

The finding's fix needs two changes. Hiding every .ts-menu-hint on touch would also hide the song counts in Add to playlist (app.js:3337) and Focus (3296) and the lengths in Versions (5561). A bottom sheet would change every menu in the app, and it would still have to scroll under the docked player (a 663 px menu against 557 px of room).
- **Fix (verified):** A touch selection mode in app.js trackList, plus three small fixes.

1. Selection mode (app.js 1235-1346).
- Line 1235: make `sel` `{ ids: {}, anchor: -1, focus: 0, mode: false }` and add a per-list `held` flag.
- In row(): add a pointerdown that sets `held = false`.
- Contextmenu (1279): set `held = true`. If `sel.mode`, call `select(i, { ctrlKey: true })` and return. Otherwise behave as now, and pass `pick(i)` as a new 4th argument to trackMenu.
- Pointerup (1280): when the pointer is touch, `!held` and the target is not inside `a,button`, then `if (sel.mode) select(i, { ctrlKey: true }); else play(i);`. This also stops a long press from playing the song when the finger lifts.
- The row's More click (1269) also passes `pick(i)`.
- `pick(i)` returns `A.item('select', fn)` only when `matchMedia('(pointer: coarse)').matches`, else null. `fn` sets `sel.mode = true`, adds `is-selecting` to `wrap`, sets `sel.ids = {}`, then calls `select(i, { ctrlKey: true })`.
- trackMenu (1359): new signature `(t, at, many, first)`. Line 1363 becomes `var items = first && !many ? [first, { sep: true }, { heading: 'Play' }] : [{ heading: 'Play' }]`.
- selBar (1336): keep the bar while `sel.mode`. With nothing selected it reads 'Tap songs to select'. In the mode, the close button at 1346 becomes `U.btn({ label: 'Done' })`, which turns the mode off, removes `is-selecting`, clears `sel.ids`, refreshes and redraws the bar.
- Escape (1325): also ends the mode.
- No Select button is needed in page headers: the More (⋮) button already sits on every row on touch and opens the same menu.

2. actions.js VOCAB: add `'select': { label: 'Select', icon: 'check-circle', desc: 'Choose several songs' }`. The icon is in ui.js PATHS and no other action uses it.

3. app.css: give the selected art a check.
- `.ts-tracks.is-selecting .ts-c-art { position: relative }`
- `.ts-tracks.is-selecting .ts-c-art::after { content: ''; position: absolute; inset: 0; border-radius: 6px; box-shadow: inset 0 0 0 2px var(--border-strong) }`
- `.ts-tracks.is-selecting .ts-row.is-sel .ts-c-art::after { box-shadow: inset 0 0 0 3px var(--accent); background: color-mix(in srgb, var(--accent) 35%, transparent) }`
- Optional: below 760 px, put the bar's Play, Play next and Add to queue under its More, so the bar fits on one line.

4. Help text (app.js:2796): change it to 'Select several (on a touch screen: hold a song, then Select) and press Edit to label them together, or label them one at a time.' On the unlabelled tab, add a `U.btn({ label: 'Label them one by one' })` that calls `startLabelling(cur[2].map(function (t) { return t.id; }))`.

5. Key hints:
- actions.js:101: mark a hint that comes from `v.key` with `keyHint: true`.
- ui.js:295: give it the class `ts-menu-hint is-key`.
- ds.css touch block (196): add `.ts-menu-hint.is-key { display: none; }`. Count and length hints stay.

6. Menu reach on phones (ui.js openMenu, about 314-321):
- Before placing the menu, if a protected rect from safe.rects() spans the window's width (the player docked on a phone), set `m.style.maxHeight = (vh - rect.bottom - 16) + 'px'` and measure the height again. safe.avoid then puts the menu under the player instead of over it.
- app.css .ts-menu (436): add a bottom scroll shadow (layered gradients, `background-attachment: local, scroll`, colours from --surface-2) so a list cut at its edge shows that it goes on.
- Document the touch selection in README lines 150 and 965.
- **Auditor's original fix:** Add a selection mode for coarse pointers. Put a 'Select' item at the top of the long-press menu, and a Select button in list headers; either puts the list in .is-selecting. In that mode the art cell shows a checkbox and a tap toggles the row instead of playing it. A sticky bar shows 'n selected' with Add to playlist, Edit, Rating, Block, Play next and Done; Back or Escape leaves the mode. Outside the mode a tap still plays. While there: hide .ts-menu-hint under (pointer: coarse), and on phones make the menu a bottom sheet so every item can be reached.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** - **Line cap.** The lint in test.js caps app.js at 5,950 lines and it has 5,941. The mode has to go into the existing one-line statements (1235, 1269, 1279, 1280, 1325, 1336, 1346, 1363), with only 2-4 new lines (pick, Done, the labeller button), or the bar has to move out to a module.
- **Action vocabulary.** A.check in the actions test (one meaning per icon, every icon drawn in ui.js) must still pass with 'select'.
- **Desktop must not change:** click, Ctrl and Shift selection, Space, Ctrl+A, the bar for 2 or more, double click or Enter to play, dragging rows onto playlists and the queue. Show Select only on (pointer: coarse); a touch laptop driven with a mouse keeps the desktop path.
- **Long-press flag.** `held` must reset on every pointerdown, or later taps stop playing.
- **Draggable rows.** Some Chrome versions for Android may start a drag on a long press (pointercancel, then contextmenu when the finger lifts). Check on the owner's phone that a long press opens the menu without playing, and that Select, then taps, then Add to playlist works.
- **Edits end the mode.** Every edit (rate, block, like, edit) runs changed() then redrawView(), which rebuilds the list and ends the mode. That is fine after a bar action, but a heart tap inside the mode clears the selection.
- **YouTube terms.** The menu height cap must keep going through safe.avoid, so no menu ever covers the YouTube player. The separate finding (the 70vh menu over the docked player) should be fixed with it or right after.
- **Tests to re-run:**
  - `node misc/101-true-shuffle/test.js`
  - `node scripts/qa/smoke.mjs 101-true-shuffle`
  - In this folder: verify.mjs, order.mjs, playing.mjs, taps.mjs (dark and light)
  - scratchpad/ui: targets.mjs (44 px targets on the bar and the Select item), focus.mjs, contrast.mjs (the bar and the check overlay), sheet-phone.mjs
  - scratchpad/ux/audit/library: phone.mjs, misc.mjs, and songs.mjs for desktop selection
- **Evidence:**
  - phone.mjs: 'P2 long-press row 1 {sel:1, bar:false}', 'P2 long-press row 2 {sel:1, bar:false}', 'P3 tap on row 3: now playing changed? true'
  - misc.mjs: 'E5 phone track menu {h:591, scrollH:663, clientH:589, hiddenBelow:[Block (never shuffle)], keyHints:[R,E,I]}'
  - Screenshots: .../library/shots/phone-songs.png, .../library/shots/phone-songs-longpress-menu.png, .../library/shots/phone-track-menu.png
  - app.js:1270-1274: a touch click is ignored for selection; 1279: contextmenu selects only that row; 1280: a tap plays; 1333-1336: the bar appears only for 2 or more
  - app.js:2796: the help text 'Select several and press Edit'; app.css:437: .ts-menu max-height 70vh

### library-9 · medium · verified · Songs table: the column header neither sorts nor stays visible, and a filter quietly drops the chosen sort

- **Where:** Songs table (#/songs): columns, sorting, sticky header, filter
- **Observed:** The header labels do nothing (aria-hidden spans, an ordinary cursor); clicking 'Time' left the order unchanged. With the sort set to Title, typing 'glass' returned the matches in search relevance (Glass Satellite, Amber Atlas, Amber Window, Copper Atlas…) while the select still said 'Title'. Sorting by Most played, Rating, Year or Recently added shows no plays, stars, year or date in any column; for example, the top row 'Midnight Mosaic' has 30 plays, and nothing in its row says so. There is no reverse order (oldest added, least played, shortest). After scrolling, the compact 'Songs' bar (58-118 px, z-index 6) covers the column header (58-107 px), and the filter and sort have scrolled out of view.
- **Why it matters:** Visibility of system status, and standard table conventions: sortable headers that show their direction (aria-sort), and a sort that is honoured or replaced visibly.
- **How it was verified:** I reproduced every claim with my own drive script (check.mjs in my folder). Demo mode, desktop 1280x800 dark and phone 390x844. I also read the code at each cited line.

1) Header does nothing. `.ts-thead` is `aria-hidden="true"` with 7 plain spans, all `cursor: auto`, and there are 0 `[aria-sort]` elements on the page. Real mouse clicks (`page.clickAt`) on "Time" (770,396) and on "Title" left the first 10 row ids and the hash (`#/songs`) unchanged.

2) A filter quietly drops the chosen sort.
- Sort Title + filter "glass": the hash is `?sort=title&f=glass` and the select shows "Title". The order is Glass Satellite/DJ Tessellate, Amber Atlas/Glass Orchard, Amber Window, Copper Atlas… That is relevance, then artist+title (library.js:1076).
- Stronger case: Most played + filter "paper lanterns". The select shows "Most played", but the rows come in title order: Blue Garden (0 plays), Blue Letters (6), Blue Weather (26), Bright Crossing (0), Copper Telegram (5), Distant Almanac (27)…
- Pressing Play queued exactly that order, so the select names an order the list and the queue do not follow (app.js:2098).
- The Artists page keeps its sort under its own filter (`?sort=name&f=a` gives A-Z; app.js:2155-2156), so Songs is the inconsistent one.

3) The sorted value is not shown.
- Most played: the top row has 30 plays, and its text is "1 | M | Midnight Mosaic | Live | The Velvet Algorithms | Funk, soul & R&B | 2:37".
- Rating: only a heart for 4 or more stars. Year (1963) and date added (2026-10-09) appear nowhere. Only Length shows, in the Time column.
- Phone: rows show just title and artist (p1-phone-sort-plays.png). The Genre column the auditor proposed is hidden at 760 px or less (app.css:621-625), so that fix would miss phones.

4) No reverse order. There are 8 options, each in one direction (app.js:1801-1811).

5) Header hidden after scrolling.
- At scrollTop 360 the compact bar covers 58-118 and the header 72-121.
- At scrollTop 3560 the header is at 58-107, fully under the bar (z-index 6 vs 2). The element under the header's centre is `.ts-sticky.is-on`. The filter bar is at -3174 px (phone: -1692).
- So the header's `position: sticky; top: 0` (app.css:376) never shows.

Nothing here is in the README, the decided-on-purpose list, or the YouTube terms, privacy and quota constraints.

Prototype: I copied the app outside the repo (config.js replaced by a stub of my own), mounted it at misc/97-ts-proto, and ran it in demo mode only.
- Most played + "paper lanterns" gives 30, 28, 27, 26, 26, 19, 18, 16 plays, Play queues the same order, and focus stays in the filter.
- A click on Time gives `?sort=length`; a second click gives `&dir=rev` (2:05, 2:15, 2:30).
- The sub line shows "· 30 plays", "· ★★★★★", "· 1963", "· added October 2026". Contrast is 8.42:1 dark and 5.39:1 light, with no clipping on the phone.
- With the header stuck under the bar (118-167) and a reveal inset, 8 ArrowUp presses kept the focused row below the header. #/family/anime also worked.
- No page errors.

Screenshots are in the shots folder of C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-9/: d3-sort-plays-filter-artist.png, d4-sort-title-filter-glass.png, d5-sort-plays.png, d7b-scroll-far.png, p1-phone-sort-plays.png, proto-A-plays-filter.png, proto-B-time-reversed.png, proto-D-scrolled.png, proto-F-phone.png.
- **Fix (verified):** In priority order. Parts 1 and 2 are the real fix; parts 3 and 4 are polish.

1) The filter keeps the sort (one line). In viewSongs, app.js:2098, replace the line with `var list = sorted(filt ? L.search(lib, filt, base) : base, sort);`.
- The filter narrows and the chosen sort orders, as on #/artists.
- The sort is stable, so equal keys keep best-match order.
- If the owner would rather keep relevance while typing, add a 'Best match' option that is selected while `f` is set. Either way, the select must name the order on screen.

2) Show the sort key on each row. After SORTS (~app.js:1814), add two helpers.
- `sortWords(t, key)`:
  - plays: `t.plays ? plural(t.plays, 'play') : 'never played'`
  - rating: `t.rating ? new Array(t.rating + 1).join('★') : 'not rated'`
  - year: `t.year ? String(t.year) : 'no year'`
  - added: `'added ' + addedName(new Date(L.lastAdded(t)).toISOString().slice(0, 7))`, or relative words by moving channel.js's relDate (channel.js:295-305) into ui.js.
- `sortExtra(key)`: for plays, rating, year and added only, returns `function (t) { return h('span', { class: 'ts-like-why', text: ' ' + DOT + ' ' + sortWords(t, key) }); }`. This uses the existing `opts.extra` hook (app.js:1258), as at app.js:5572, 5627 and 5676.
- Pass `extra: sortExtra(sort)` in the three sorted lists: app.js:2114 (Songs), 2312 (collection) and 3463 (playlist).
- Also append the words to the row's aria-label (app.js:1241).
- Use the sub line, not the Genre column: phones hide that column.

3) Reverse order and clickable headers.
- Make `sorted(tracks, key, rev)` reverse its result when `rev` is set. Read a `dir=rev` query in the three views; changing the select clears it.
- After the select, add `U.btn({ iconOnly: true, variant: 'secondary', label: 'Reverse the order', pressed: rev })`. Give it a new up/down arrow path in ui.js PATHS: the existing `down` chevron looks like a dropdown caret.
- In trackList (app.js:1229-1232), accept `opts.sort = { key, rev, set(key, rev) }`. Render Title, From and Time as `<button class="ts-th" type="button" tabindex="-1">`: a click sorts by title, work or length, and a second click on the active one reverses it. The active button gets `.is-on` and an arrow, rotated when reversed.
- Keep the header aria-hidden, like the compact bar's Play (app.js:4892-4894). The select and the reverse button stay the accessible controls. Do not put aria-sort on cells of a role=list; it is only valid in a grid or table.
- Add CSS for `.ts-th` next to app.css:376, using ds.css tokens.

4) Header below the compact bar.
- After app.css:377, add `.ts-sticky.is-on ~ .ts-tracks > .ts-thead { top: 60px; }`.
- In virtualList reveal (ui.js:411-412), use `var inset = opts.inset ? opts.inset() : 60;` in place of the fixed 60.
- trackList passes `inset: function () { return 60 + (view.querySelector('.ts-sticky.is-on') && head.isConnected ? head.offsetHeight : 0); }`.
- Do not move the filter and sort into the compact bar: it is shared by every page and aria-hidden.

5) Add one line in README.md under "The page": the filter keeps the sort; rows show plays, stars, year or date added when sorted by them; Title, From and Time sort the list, and a second click reverses it.
- **Auditor's original fix:** Make the header cells buttons with aria-sort that set ?sort=&dir= (a second click reverses), and add dir to SORTS. While a filter is typed, either sort the matches by the chosen key or switch the select to an explicit 'Best match' option. When sorted by plays, rating, year or date added, show that value in place of the Genre column ('30 plays', ★★★, 1971, '3 days ago'). While the compact bar is on (stickyHeader's observer can add a class), give .ts-thead top: 60px, and put the filter and sort into the compact bar.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.css`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** - **Filtered order changes.** Part 1 gives filtered results a new order. Someone who types an exact title while sorted by "Recently added" may not see it first; ties still keep best-match order, and a 'Best match' option is the fallback. The global search (/) still ranks by relevance.
- **Remembered sort.** `songsSort` is stored with ToyKit.store. Decide whether `dir` is remembered too; the prototype does not remember it.
- **`sorted()` signature.** Its six other callers pass two arguments, so they are unaffected.
- **Header rule reaches other pages.** The sticky-header CSS applies wherever `.ts-tracks` is a sibling of `.ts-sticky`: genre, family, work, playlist and #/c pages. That is intended, and I checked #/family/anime.
- **Keyboard focus under the header.** Without the reveal inset, ArrowUp and PageUp would park the focused row under the stuck header. Where a list is nested and its header does not stick, the inset only scrolls 49 px more than needed, which is harmless. On phones the header is display:none, so `offsetHeight` is 0 and the inset stays 60.
- **Header buttons.** The `.ts-th` buttons sit inside an aria-hidden header with tabindex -1, the same pattern as `.ts-sticky-play`. Check that they never become tabbable.
- **Touch target.** The new reverse button must get the coarse-pointer 44 px hit area.
- **Long sub lines.** Rows with long artist names clip the sort words with an ellipsis.
- **No unit tests cover this.** test.js and test/*.section.js have no tests for #/songs, virtualList, reveal or sorting.

Re-run:
- `node misc/101-true-shuffle/test.js`
- `node scripts/qa/smoke.mjs 101-true-shuffle`
- My check.mjs and proto-check.mjs, pointed at the real path
- The audit's focus.mjs, targets.mjs and contrast.mjs in both themes
- sheet-phone.mjs
- A keyboard pass on a long list: Home, End, PageUp and ArrowUp after scrolling, on #/songs and a genre page
- **Evidence:**
  - songs.mjs: '2b filtered "glass": select still says title alphabetical? false [Glass Satellite, Amber Atlas, Amber Window, Copper Atlas, ...]'
  - songs.mjs: '3 header click changed order? false {ariaHidden:true, buttons:0, cursor:auto}'
  - songs.mjs: '4 sort plays [{title: Midnight Mosaic, plays:30, rowText: 1 | M | Midnight Mosaic | Live | The Velvet Algorithms | Funk, soul & R&B | 2:37}, ...]'
  - songs.mjs: '8 sticky after scroll {stickyOn:true, sticky:[58,118], thead:[58,107], zSticky:6, zThead:2, topElAtThead: ts-sticky is-on}'
  - Screenshots: .../library/shots/songs-sort-title-filter-glass.png, .../library/shots/songs-sort-plays.png, .../library/shots/songs-scrolled-sticky.png
  - app.js:1229-1232 (the header), 2096-2098 (with a filter the list is L.search and the sort is ignored), 1801-1811 (SORT_OPTS, one direction only); app.css:376 (.ts-thead sticky, top 0, z 2), app.css:862-863 (.ts-sticky z 6, 60 px)

### library-10 · medium · verified · Playlist and collection actions are buried, and the playlist menu opens in the window's top-left corner

- **Where:** Playlist page header; genre, mood, scene and artist pages
- **Observed:** A playlist page's header shows Play, Shuffle, Focus and '…'. The '…' (More actions) menu holds one item, 'More', and choosing it opens Rename / Edit every song… / Delete playlist at (8, 4), over the logo and nav, far from the click. On genre, mood and scene pages, 'Save as playlist' and 'Focus' are hidden in More actions while 'Open in mix builder' gets its own button. On artist pages 'Edit all' is hidden as well.
- **Why it matters:** Recognition over recall, and spatial continuity: management actions should take one step, and a menu should open where it was asked for.
- **How it was verified:** Read the cited code and reproduced it in the harness (demo, dark, 1280x860 desktop and 390x844 mobile). Scripts and logs are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-10/. menus.mjs gives desk.txt and phone.txt.

CODE: headerBlock (app.js:1768-1774) adds only acts.slice(0,3) to the page; it wraps the rest in moreActions (1778-1788). The menu items there call main.click() on buttons that were never attached to the page. viewList pushes its own '…' as the 4th action (3450-3457). viewTrack does the same (2517): its actions are Play, Start radio, Edit details, then Add on YouTube (real mode only), then More. So the page's More ends up inside More actions. Its handler calls U.openMenu(e.currentTarget, ...) with a detached button. getBoundingClientRect() is all zeros (ui.js:314), and the x clamp (318) puts the menu at (8,4). menuReturn is also that detached button, so closing the menu loses focus.

This is a regression from yesterday. In 3a1a9e9's parent, headerBlock still showed every action (o.actions.forEach). 3a1a9e9 added the cap of three actions plus More, and that wrapped the page's own More inside More actions. README:170 states the intent: "at most three actions and More in a page's header".

MEASURED, desktop:
- Hand-picked playlist: the header is Play, Shuffle, Focus, More actions. More actions holds one item, "More". Choosing it opens Rename…, Edit every song…, Delete playlist at (8,4), 724 px from the button, over the logo and nav. While it is open, More actions has aria-expanded=false. After Escape, focus is on <body> and the next Tab lands on the brand link. By keyboard, Delete takes 4 keys (Enter, Enter, End, Enter).
- Smart playlist: More actions holds Edit filter and More. The nested menu opens at (8,4), 822 px away.
- Song page (#/track/id): auditor missed this one. More actions holds only "More". It opens the whole 19-entry song menu (602 px tall) at (8,4), 774 px away. Its Add to playlist submenu also opens at (8,4). Escape drops focus to <body>; songesc.mjs confirms this.
- Genre, mood and scene pages show Play, Shuffle, Open in mix builder, with Focus and Save as playlist hidden in More actions. Work pages show Edit all and hide Focus and Save. Artist pages hide Edit all, Focus and Save. That collection order is from the first build, made before the cap existed.

MEASURED, phone: the same nested menus open at (8,4), 483 to 546 px from the button.

Shots (in shots/): desk-list-2-second-menu.png, desk-smart-2-second-menu.png, desk-song-2-song-menu.png, desk-song-3-add-to-playlist.png, phone-list-2-second-menu.png, phone-song-2-song-menu.png, desk-genre-more-actions.png.

FIX CHECKED on a copy served at misc/99-probe with a stub config (the repo is untouched; fixed.mjs, fixed-desk.txt, fixed-phone.txt):
- Playlist menus open 4 px under the button, one level deep: desk (616,402), phone (16,491).
- Escape returns focus to More actions, with aria-expanded=false. Delete takes 3 keys, and Rename opens its dialog.
- Song page: the menu opens in the button's own column at (674,8). It flips up because it is 602 px tall, which is normal for any tall menu. Add to playlist opens at (674,402) instead of (8,4).
- No page errors.
- Shots: desk-fixed-smart-more.png, desk-fixed-song-more.png, phone-fixed-hand-picked-more.png.

Unrelated, same symptom: a song row's '…' also opens at (8,4) because select() calls vl.refresh(), which detaches the button (app.js:1269). That happens before and after this fix. The accessibility lens already recorded it (audit/accessibility/rowmenu.txt), so it is not counted here.
- **Fix (verified):** Required (app.js):

1. headerBlock (1771): `if (acts.length > 3 || o.more) row.appendChild(moreActions(acts.slice(3), o.more));`

2. moreActions(extra, own) (1778): inside the click handler, build `items` from extra as today. Then:
`var mine = own ? own(b).filter(Boolean) : []; if (items.length && mine.length) items.push({ sep: true }); U.openMenu(b, items.concat(mine), { label: 'More actions' });`
Update the comment to say one More menu holds the overflow and the page's own items, and that a menu never opens another menu.

3. viewList (3450-3458): delete `actions.push(U.iconBtn('more', 'More', ...))`. Pass the same four items (Rename…, Edit every song…, Copy as hand-picked for smart lists, Delete playlist) to headerBlock as `more: function () { return [...]; }`. A smart list's 'Edit filter' stays the 4th action, so its menu reads: Edit filter, separator, Rename…, Edit every song…, Copy as hand-picked, Delete playlist.

4. trackMenu (1359-1398): split it.
- `trackItems(t, at, many)` holds today's body (ids, one, menuAt from at, the items) and ends with `return items;`.
- `trackMenu(t, at, many) { var ids = many && many.length > 1 ? many : [t.id], one = ids.length === 1 ? lib.tracks[ids[0]] : null; U.openMenu(at, trackItems(t, at, many), { label: ..., returnTo: ... }); }`
- Every existing caller stays unchanged.

5. viewTrack (2512-2518): the actions become Play, Start radio, Edit details. Add `more: function (at) { return trackItems(t, at, null); }`. Drop the separate 'Add … on YouTube' action and the iconBtn('more'). The song menu already has Add on YouTube under the same condition (1377), so nothing is lost or duplicated.

Optional, low priority (collection order): in collection() (2291-2295), order the actions as `[Play, shuffleSplit].concat(scopeButtons(o.ctx.patch, o.title), [actionBtn('mix', 'Open in mix builder', ...)])`. Genre, mood, scene and added pages then show Play, Shuffle, Focus, like playlist pages, with Save as playlist and Open in mix builder under More. This matches README:152/191/195. Do the same in viewWork so Edit all comes last. Leave the artist page alone: Artist radio is a good third button, and Edit all belongs in overflow.

Optional hardening (ui.js openMenu): keep `lastAt`, the last connected element used as an anchor. If `at.nodeType && !at.isConnected && lastAt && lastAt.isConnected`, set `at = lastAt` before placing the menu and setting returnTo. This is a safety net only: it does not fix the row-menu bug at app.js:1269, which needs its own fix.
- **Auditor's original fix:** Let headerBlock take menu items as well as buttons. On viewList, pass Rename, Edit every song, Copy as hand-picked and Delete as items of the single '…' menu, and never put a menu button inside More actions. In moreActions, when the chosen node opens a menu, anchor that menu to the More actions button (b); also, in U.openMenu, fall back to the previous anchor when the rect is 0x0. On collection pages, show 'Save as playlist' among the first three instead of 'Open in mix builder'.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js` · **Effort:** S
- **Risks:** - headerBlock is shared. explore, channel, rescue, wrapped, quiz, duel, share and foryou call it through ctx.ui.headerBlock. None of them passes `more`, so they are unchanged.
- The trackMenu split keeps every current caller (rows, selection bar, context menu, now playing, queue) on the same path. Only viewTrack calls trackItems directly. On the song page the menu's aria-label becomes 'More actions' instead of 'Actions for <title>'; this is minor.
- Real mode: Add on YouTube moves from the first overflow item into the song menu's Keep group. Its playlist picker now opens by the More button instead of at (8,4).
- Delete playlist becomes 2 clicks instead of 3. It still has no confirm and no Undo; Remove from playlist does have an Undo toast. Consider adding the same U.toast Undo here.
- The optional ui.js fallback could anchor a menu to a stale element if a future caller detaches its anchor.
- Re-run: node scripts/qa/smoke.mjs 101-true-shuffle; node scripts/test-all.mjs (lanes.section.js tests only lanes.js's own More); the drive scripts in my folder (menus.mjs, plus fixed.mjs, songesc.mjs and rowmenu.mjs with misc/101-true-shuffle/ as the app arg); the audit's library/lists.mjs step 7, which already accepts Delete in the first menu.
- **Evidence:**
  - lists.mjs: '7a first menu [More]'; '7b second menu [Rename…, Edit every song…, Delete playlist] menu anchored at [8,4]'
  - Screenshots: .../library/shots/list-more-actions-menu.png, .../library/shots/list-more-menu.png
  - app.js:1768-1773: headerBlock shows the first three actions and puts the rest in moreActions; app.js:1778-1788: moreActions calls main.click() on a button that is no longer in the DOM
  - app.js:3450-3457: the list's own More is a fourth action, so it lands inside More actions; app.js:2291-2296: the collection actions
  - ui.js:314: the menu is placed from at.getBoundingClientRect(), which is all zeros for a detached anchor

### library-11 · medium · verified · Just browsing creates playlists the user never saved

- **Where:** Playlists, Focus, Home suggestions
- **Observed:** Clicking a suggestion tile on #/lists, a 'Work with part of your library' chip on Home, or Focus on a genre page each adds a smart playlist (auto: true) to Yours and to the sidebar, and it stays after focus is left. After four such clicks the sidebar held Anime, Openings, Alt J-rock and Jazz arrangement, though none had been saved. Nothing ever removes them.
- **Why it matters:** Don't create persistent objects as a side effect of navigation. What 'Yours' contains should be what the user made.
- **How it was verified:** I reproduced it in both modes with real mouse clicks (page.clickAt) and read the code. Scripts and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-11/ (demo.mjs, real.mjs, shots/).

DEMO (1280x860, dark):
- At the start: 0 lists, an empty sidebar and 9 Suggested tiles. The hint under them says "One click focuses on it; the plus keeps it as a playlist."
- (1) Clicking the "Anime" tile opens #/list/<id> and adds lists = [Anime {kind: smart, auto: true}]; the sidebar shows Anime. Pressing that page's own Leave focus sets the focus button back to "Everything", but the list stays and the header kicker still reads "Smart playlist" (shots/1b-list-page-after-leave-focus.png).
- (2) Clicking the home chip "Openings" adds a second list. "Show everything" in the focus bar leaves focus, and the list stays.
- (3) On the genre page Anison pop, More actions starts as [Focus, Save as playlist]. After Focus it reads [Leave focus, Saved]. After Leave focus it reads [Focus, Saved]: the page says Saved although nothing was saved, and that item only links to the list (shots/3g-genre-more-after-leave-says-saved.png).
- (4) #/lists: Yours = Anime, Openings, Anison pop, each "Smart · N songs". Suggested went from 9 to 7 tiles, because the clicked suggestions moved to Yours and their plus can no longer be reached. The "only the plus keeps it" hint sits right under them (shots/4-lists-after-browsing.png).
- (5) The Focus menu lists all three (shots/5-focus-menu.png).
- (6) In the Ctrl+K palette, the top result for "Anime" is "Anime · smart · PLAYLIST", ranked above the real "Anime · SCENE" page (shots/6-palette.png).
- (7) The #/library hub says "3 playlists".
- (8) Focusing the same genre again reuses the list (3 lists before and after), so the clutter grows by one per distinct collection, not per click.
- No errors and no external hosts.

REAL MODE (IndexedDB seeded with the 160 labelled demo tracks; googleapis, accounts, i.ytimg and youtube blocked; 0 external hosts; database deleted afterwards):
- I clicked the Anime tile, then Leave focus.
- kv 'lists' = [Anime (auto)] and kv 'focus' = null.
- kv 'sync:outbox'.stations = [Anime (auto)]. So the accidental list goes into the bundle the Desk pushes to the private repository. checkInbox (app.js:4124) only adds lists by id and never removes any, so it spreads to other devices, and deleting it on one device does not carry over.
- After a reload the sidebar still shows Anime under PLAYLISTS and Yours still shows it (shots/real-after-reload-lists.png).

CODE:
- auto: true is set at app.js:1923 (home chip), 3364-3365 (scopeButtons Focus) and 3422 (suggestion tile).
- A grep across all *.js files finds no reader. The flag is only deleted, at 2582 (mix Update) and 3473 (Rename). It came in with 8f036b1 and was never wired up.
- scopeButtons' `existing` check (3361/3367) treats an auto list as saved.
- The README (line 152) presents Focus and Save as playlist as two separate actions and does not say focusing keeps a playlist. The page's own hint promises the opposite, and the case is not on the decided-on-purpose list.

Corrections to the audit:
- Lists can be removed, but only by hand and one at a time: open the list page, then More, then Delete playlist (3455).
- No duplicates are made.

Severity is medium: Focus is a central, frequent flow (home chips, every collection page). The cost is clutter and false labels on six surfaces, plus syncing, with no data loss and nothing blocked.
- **Fix (verified):** Keep the auto list as what Focus points at, because its stable id keeps the per-focus true-shuffle bag 'bag:<sig>:<focusId>' (app.js:416 ensureBag). But treat auto lists as "recent focuses", not playlists. All changes are in misc/101-true-shuffle/app.js, ES5:

1. Next to saveLists (3257), add two functions:
   - `function savedLists() { return lists.filter(function (li) { return !li.auto; }); }`
   - `function focusOn(name, patch)`: reuse any smart list whose S.signature(li.patch) matches (saved or auto). Otherwise push { id: newId(), name, kind: 'smart', patch, created, auto: true }. Set li.used = Date.now(). Drop auto lists beyond the 5 most recently used, never the focused one. Then saveLists() and setFocus(li.id).
   - Replace the three inline creators with focusOn: the home chip at 1923, scopeButtons' Focus at 3363-3366, and the suggestion tile at 3422 (the tile keeps its `location.hash = link('list', li.id)`).

2. Use savedLists() instead of lists in these places:
   - renderStations (736-737): the sidebar and its empty state.
   - viewLists Yours (3406-3408).
   - viewLibrary's "N playlists" (2551).
   - paletteEntries (4785).
   - The suggestions() filter (3396), so a focused suggestion stays offered with its plus.
   - queueSync: `stations: savedLists()` (4101).
   - checkInbox (4124): skip any incoming li.auto.

3. focusMenu (3296): keep the saved lists as now, then add { heading: 'Recent' } followed by the auto lists, newest first by `used`, checked when focused.

4. scopeButtons (3361-3371):
   - Let match = any same-signature smart list. Focus and Leave focus act on match.
   - Label the second button 'Saved' only when match && !match.auto; otherwise 'Save as playlist'.
   - When match is auto, the dialog promotes it instead of making a duplicate: createList takes data.promote, and on submit sets li.name = name, deletes li.auto and calls saveLists() rather than pushing a new list.
   - In viewList, for li.auto: put 'Save as playlist…' (the same promote) first in More (3450-3456), and change the kicker at 3458 from 'Smart playlist' to 'Smart filter · not saved'.

5. loadSettings (5820): after reading lists, prune auto lists to the 5 most recent plus the focused one. This clears what has already piled up and synced.

The hint at 3418 then becomes true as written. Add one sentence to README.md "Playlists and focus" (line 152): focusing on a collection that is not a playlist keeps it under Recent in the Focus menu (the last five), not under Yours; Save as playlist keeps it.

Do not use the simpler "delete the auto list when focus leaves it" (see risks).
- **Auditor's original fix:** Make focus transient: hold focus as { name, patch } in memory and in kv 'focus', without pushing it into `lists`. Only Save as playlist (or a rename) creates a list. Show recent focuses in the Focus menu instead of under Yours and in the sidebar. If keeping the current model, drop an auto list from `lists` when focus leaves it. Change the hint 'One click focuses on it' to match.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** Why not "remove the auto list on leave":
- Each new focus would get a new id, so the true-shuffle bag keyed by focus id (app.js:416) would restart every session and repeat songs.
- Leaving focus on the auto list's own page, which is where the suggestion tile lands, would redraw as "This playlist is gone."
- Quick re-focus from the Focus menu would be lost.

Risks of the recommended fix:
- Once an auto list is pruned past the cap of 5, its #/list/<id> address and any queue "Playing from" link to it show "This playlist is gone." Its 'bag:...:<id>' kv row is orphaned, as already happens with deleted lists.
- Promote must not create a second list with the same signature. Otherwise scopeButtons' match becomes ambiguous.
- Rename (3473) and mix Update (2582) still promote by deleting auto. Keep that.
- Every place that iterates `lists` must be checked. addToList (manual only) and rescue.js (ctx.lists.all, manual ids) are unaffected. hook.lists still returns everything.
- The Desk sync: auto lists that were already pushed come back through an inbox unless checkInbox skips li.auto. Other devices prune their own on load.

Re-run afterwards:
- node misc/101-true-shuffle/test.js
- node scripts/qa/smoke.mjs 101-true-shuffle
- verify/library-11/demo.mjs and real.mjs. After focus then leave, expect: Yours and the sidebar empty; More actions reading [Focus, Save as playlist], not Saved; Suggested still 9 tiles; the Focus menu's Recent showing Anime, Openings, Anison pop; the palette's top "Anime" result the Scene; sync:outbox stations []; the same list id when re-focusing.
- ux/audit/library/lists.mjs
- ux/audit/keyboard-power/j3-menus.mjs and ux/audit/accessibility/menus.mjs, since the Focus menu gains a Recent heading.
- A phone pass of #/lists and #/library.
- **Evidence:**
  - lists.mjs: '1 after clicking the suggestion "Anime": ... lists [{name: Anime, kind: smart, auto: true}]'; '2b after a home chip: lists [..., {name: Openings, auto: true}]'; '3 after Focus on two genre pages and leaving focus: lists [Anime, Openings, Alt J-rock, Jazz arrangement (all auto)] sidebar [... Anime ... Openings ... Alt J-rock ... Jazz arrangement]'
  - Screenshots: .../library/shots/lists-after-suggestion-click.png, .../library/shots/lists-yours-after-browsing.png
  - app.js:1923 (Home chips), 3363-3366 (Focus), 3422 (a suggestion tile): each pushes { auto: true } into lists and calls saveLists()
  - The auto flag is only ever cleared, on rename or update (app.js:3473, 2582); no code removes auto lists

### library-12 · medium · verified · Hand-picked playlists can't be reordered or filled from their own page

- **Where:** Playlists (#/list/<id>, hand-picked)
- **Observed:** 'Your order' is the default sort for a hand-picked playlist, but there is no way to change that order. Dragging row 4 onto row 1 left the order as it was. The row menu has no Move up, Move down or Move to top, and no key moves a row. The page also has no 'Add songs': the empty state sends you to other pages' menus.
- **Why it matters:** User control: an order the app calls 'yours' should be editable where it is shown.
- **How it was verified:** I read the code and drove the demo with my own scripts, all in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-12/. The scripts are verify.mjs, focus-empty.mjs, phone.mjs and proto.mjs. Screenshots are in shots/.

CODE
- viewList (app.js:3436-3465) passes `list: li` to trackList. trackList (1225-1352) never reads it: the only `opts.list` in app.js is line 1575, the editor's datalist.
- Row dragstart (1277) sets effectAllowed 'copy'. Only dropTarget() nodes accept a drop: the sidebar's hand-picked lists (739) and the queue panel (5759).
- trackMenu (1359-1397) offers only "Remove from <list>" (1379) for a list.
- The row keydown (1306-1328) ignores altKey.
- The README's "Playlists and focus" section documents only adding songs. Nothing says the order is fixed on purpose, and it is not in the decided list.
- The queue already has a grip with drag and arrow-key reorder (1042, 1085-1131). The auditor's screenshot shows grips in Up next beside a "Your order" list that has none.
- rescue.js moveInLists keeps each song's position, so the code treats list order as data elsewhere.

REPRODUCED (desktop 1280x860, dark, demo)
- Made a list from #/lists > New hand-picked playlist, then added 6 songs through a selection.
- I got the auditor's exact order and sort options: "Your order (selected)", then Recently added, Title and the rest.
- Header actions are Play, Shuffle, Focus and More. Rows have no grip (05-list-handpicked.png).

Real HTML5 drag (Chrome's own drag, caught with Input.setInterceptDrags and replayed with dispatchDragEvent; data application/x-ts-ids=["demo-023"]):
- Dropped on row 1: the shown order and the stored li.ids did not change.
- Control: the same drag onto the sidebar entry "Control" took that list from 1 song to 2. So the drag works; the list simply refuses the drop.

Menu and keys:
- The row menu (06-list-row-menu.png) has no Move item.
- Alt+Up, Ctrl+Up, Alt+Shift+Up and Ctrl+Shift+Up on a focused row left the stored order unchanged. Alt+Up only moved focus up, like a plain Up.

Extra defect: Remove from list, then Undo. "Paper Parade" went in at #2 and came back at #6 (07-after-remove-undo.png), because removeFromList (3350-3357) pushes the ids back at the end.

Filling a new list:
- The New hand-picked playlist button (3403) is the only createList('manual') call without {focus:false}. The dialog's "Focus on it now" is ticked by default (01-new-handpicked-dialog.png).
- The empty page (02-list-empty.png) has no add button. It says to add songs from other songs' menus.
- Following that advice while focused: #/songs and #/search show 0 rows and "Nothing in 'Empty test' yet. Show everything" (03-songs-while-focused-empty.png).
- Ctrl+K returns nothing for a library title (04-palette-while-focused-empty.png). The palette and fuzzy search use scopeTracks() and idx().all.
- Side effect: with a true shuffle playing, creating the empty list with these defaults cut the queue from 8 items to 1. With a song only loaded, the queue emptied ("Nothing playing").

Phone (390x844, touch): the same gaps. "Your order" is selected, there is no add button, and the row menu has no move item (09-phone-list.png, 10-phone-row-menu.png).

PROTOTYPE OF THE FIX
I patched a copy of the app (no config.js, a stub instead) served at misc/98-proto. The diffs are proto-app.diff and proto-app-css.diff. The repo is untouched: git status matches the start. proto.mjs passed every check with 0 errors:
- The empty list is no longer focused on creation.
- Add songs finds 23 songs, also while focused.
- Alt+Up moves a row, keeps focus on it and announces "Moved to 3 of 6."; Alt+Down puts it back.
- Move to top works, keeps focus on the row, and Undo restores the order.
- A real drag shows an insertion line and reorders (p4-drag-marker.png).
- Dragging onto the queue still queues (8 to 9 items).
- Remove + Undo keeps the order.
- A sorted view offers no moves.
- Move to top works on the phone.

Not checked: real mode. It runs the same code path, and the demo is enough to show the problem.

SEVERITY: medium. This is not a frequent task in a shuffle-first app, and no data is lost. But the order is presented as "Your order" with Play in order as the primary button, and it cannot be edited. Hand-picked lists come from Save the queue (whose order the queue lets you edit), Your year's top songs, Map region and Copy as hand-picked. Creating an empty list leads to empty pages, and Undo quietly reorders.
- **Fix (verified):** Everything below is gated so that only a hand-picked list shown in "Your order" changes.

1. app.js trackList (1225): add `opts.reorder`, a function `(newIds, oldIds, words)`. When it is set:
   - Add a local `moveTo(moving, beforeId, quiet)`:
     - rebuild the closure's `ids` and `tracks`;
     - set sel.focus and sel.anchor to the moved row;
     - call `vl.refresh(); vl.reveal(to); focusRow(to); selBar();`;
     - call opts.reorder with words such as `q(title) + ' moved to 3 of 6.'`.
     - For a keyboard step (quiet), call `setStatus('Moved to 3 of 6.')` instead (#status is a polite live region).
   - In the row keydown, before the plain arrows: Alt+ArrowUp or Alt+ArrowDown moves the focused row, or the selection that contains it, one place.
   - dragstart (1277): remember `dragging = chosenIds` and set `effectAllowed = reorder ? 'copyMove' : 'copy'`. This keeps the sidebar and queue drops working.
   - On vl.node:
     - dragover, only while `dragging`: preventDefault, `dropEffect = 'move'`, insert index = clamp(round((clientY - vl.node.getBoundingClientRect().top) / rowH), 0, n), then add `drop-before` to `vl.row(i)` or `drop-after` to `vl.row(i-1)`.
     - drop: `moveTo(dragging, the first id at or after that index that is not being moved)`.
     - dragend and dragleave clear the marks.
   - Change the end of trackList to: `listSel = { ids: ..., order: function () { return ids.slice(); }, move: reorder ? moveBy : null }`, where `moveBy(ids, 'top'|'up'|'down'|'bottom', quiet)`.
   - Update in place. Do not call renderView(true): rows draw on the next frame, so it cannot put focus back on a row.

2. app.css 249-251: add `.ts-row.drop-before::before` and `.ts-row.drop-after::after` to the queue's insertion-line rules.

3. viewList (3463): pass `reorder: li.kind === 'manual' && sort === 'list' ? function (order, prev, words) { setListOrder(li, order, words); } : null`. Add setListOrder next to removeFromList:
   - fill the visible slots in turn, so ids whose track is gone keep their places: `li.ids = li.ids.map(function (id) { return vis[id] ? order[k++] : id; })`;
   - set `li.updated`, call `saveLists()`, and if `focus === li.id` do `scopeMemo = null; dirty()`;
   - when there are words, show `U.toast(words, { action: 'Undo', ... })`, which restores the old ids and calls renderView(true).

4. trackMenu (after 1379): when `pl.kind === 'manual' && listSel && listSel.move`, add one item, `A.item('move', function () { moveMenu(ids, menuAt); })`.
   - actions.js VOCAB gets `'move': { label: 'Move' + ELL, icon: 'grip' }`. No action uses grip yet.
   - moveMenu works like ratingMenu: To the top, Up one (Alt+Up), Down one (Alt+Down), To the bottom. Leave out the ones that would do nothing, and write the arrows with String.fromCharCode(0x2191) and (0x2193).
   - One "Move..." item keeps the 20-item menu from getting longer.

5. removeFromList (3350): take `var was = li.ids.slice()` before filtering. Undo sets `li.ids = was.concat(li.ids.filter(function (id) { return was.indexOf(id) < 0; }))`.

6. viewLists (3403): call `createList('manual', { ids: [] }, '', { focus: false })`, like every other hand-picked createList call.

7. viewList, the Songs head (`hd`, before sortSelect): for manual lists add `U.btn({ icon: 'plus', label: 'Add songs', size: 'sm', variant: 'secondary' })`.
   - Do not put it in the hero: headerBlock shows 3 actions and would push Focus into More actions (seen in the prototype).
   - It opens addSongsDialog(li), a U.openDialog with a search box. Results come from `L.search(lib, text, L.list(lib)).slice(0, 30)`, the whole library, not scopeTracks(), the palette or fuzzy, all of which Focus narrows.
   - Each result has an Add button that pushes to li.ids, calls saveLists(), resets the scope if focused, and becomes a disabled "Added".
   - The dialog's onClose calls renderView(true) when something was added.
   - Change the empty text to "Empty. Press Add songs, or add from any song's menu."

8. actions.js KEYMAP "In a list": add "Alt+Up/Down reorder a hand-picked playlist". README "Playlists and focus": mention Add songs, Move..., the Alt keys and dragging within Your order.
- **Auditor's original fix:** In trackList, when opts.list is a manual list and the sort is 'list', accept drops between rows: dragover computes the insert index from clientY and the row height, then li.ids is reordered and saveLists() runs. Add Move to top, Move up, Move down and Move to bottom to trackMenu, plus Alt+Up/Down on a focused row, each with Undo. Add an 'Add songs' button that opens the palette's song search in an 'add to this list' mode.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** **Where it can break**
- **trackList is shared by every list view** (Songs, Liked, search, artist and genre pages). Gate all new behaviour on opts.reorder, and keep effectAllowed 'copy' when it is off.
- **Dropping onto the sidebar or the queue must still copy.** That was checked in the prototype: the queue went from 8 to 9 items and the list was unchanged.
- **li.ids can hold ids whose track is gone** (listTracks filters them out). Writing the visible order straight back would drop those songs or shift positions; filling the visible slots in turn avoids it.
- **Focus can be lost.**
  - renderView(true) cannot put focus back on a row, because rows draw on the next frame. Moves must update in place.
  - The menu sends focus back to the More button before onSelect runs, so the move code must focus the redrawn row itself.
- **The list may be the focused one.** If so, reset scopeMemo and call dirty(), or the other pages keep the old order.
- **Desk sync.** Lists sync whole through saveLists and queueSync, and the inbox adds only lists a device doesn't have. There is no merge conflict, but a reorder on one device won't replace another device's copy. Adding songs works the same way today.
- **The drop line now shows while dragging over the list** on the way to the sidebar. That is expected, and Undo covers an accidental drop.
- **actions.js check() in test.js** needs unique labels, keys and icons, so 'move' with the grip icon must stay unique.
- **The hints must be ASCII escapes.** The sources are plain ASCII.

**Re-run afterwards**
- `node misc/101-true-shuffle/test.js`
- `node scripts/qa/smoke.mjs 101-true-shuffle`
- My verify.mjs and proto.mjs (folder above; mount the real toy instead of 98-proto)
- The audit's library/lists.mjs
- The ui/ scripts:
  - focus.mjs (focus ring on the Add songs button and the Move menu)
  - targets.mjs (44 px targets for the new button and items on coarse pointers)
  - settings.mjs
  - sheet-phone.mjs (phone menu height)

**Test by hand**
- Dragging in a real desktop browser.
- A long list (auto-scroll while dragging).
- A list that contains a removed or moved upload.
- **Evidence:**
  - lists.mjs: '5a order [String Quartet…, Paper Parade, Electric Kindling, Blue Weather, Hidden Current, Small Current] sort options [Your order (selected), …]'; '5b order after drag [same] changed? false row menu [… Add to playlist…, Remove from Road trip, …]' (no move items)
  - Screenshot: .../library/shots/list-handpicked.png
  - app.js:3440-3463: viewList passes opts.list, which trackList never reads; app.js:1276-1278: rows can be dragged only to the sidebar and the queue; app.js:3463: the empty-state text

### library-13 · medium · verified · Liked songs: a song liked just now lands at the bottom

- **Where:** Liked songs (#/liked), ratings and likes
- **Observed:** Liked songs is sorted by 'Recently added', which is the date the video joined a YouTube playlist. A song added long ago and liked a moment before appeared as row 38 of 38. There is no 'Recently liked' order, so the most recent likes are the hardest to find.
- **Why it matters:** Match the user's mental model: in a likes list, the newest like comes first.
- **How it was verified:** I read the code and drove the app in the harness. All scripts and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-13/ (scripts: repro.mjs, fixcheck.mjs, realmode.mjs; screenshots in shots/).

CODE
- app.js:4742-4745: viewLiked passes sort:'added'.
- app.js:1801: SORT_OPTS has no liked order.
- app.js:1808: SORTS.added sorts by L.lastAdded. That is the latest YouTube-playlist addedAt (library.js:222-226), not the time of the like.
- app.js:4719: toggleLike's toast says "Added to Liked songs." while the sort select on the page says "Recently added", so the app's own words contradict the order.
- README only says "#/liked lists what is rated 4 or more" (line 168). No intended order is documented, it is not on the decided-on-purpose list, and it touches no YouTube-terms, privacy or quota rule.

DEMO (repro.mjs)
- Flow: Home > Shuffle everything > press L on the first song > open Liked songs from the sidebar.
- Desktop 1280x860: "Painted Rooftops" landed at row 19 of 38, two screens of scrolling (shots/cur-desktop-3-liked-top-after-like.png, shots/cur-desktop-4-liked-found.png).
- Phone 390x844: "Copper Harbor" landed at row 25 of 38, five screens (shots/cur-phone-4-liked-found.png).
- The auditor's worst case also reproduces: liking the oldest-added song puts it at row 38 of 38 (fixcheck.mjs).
- Over all 122 songs not yet liked, a like would land at median row 18 (rows 8 to 25 for the middle half). Only 15 of 122 (12%) would land in the top three.

REAL MODE (realmode.mjs)
- Setup: no demo, Google API and OAuth hosts blocked, a synthetic library of 1,500 songs added over about 3 years with 167 liked; the database was deleted afterwards.
- Likes of songs from a quarter, a half and three quarters back landed at rows 43, 86 and 128 of about 170. That is 3.6, 7.3 and 10.9 screens of scrolling (60 px rows, 698 px list).
- A like arriving from the phone through the Desk sync inbox landed at row 103 of 171.

TWO FIXES TRIED (on copies outside the repo; config.js not copied, a stub used)
- Variant A, sort by stateAt: new likes go to row 0. But re-starring five old likes from 5 to 4 (the path the duel's Set stars uses, pageCtx.edit) moved them to rows 0-4 and pushed the real newest like to row 6. Blocking an old like moved it from row 170 to row 1. So stateAt is the wrong clock.
- Variant B2, a likedAt stamped in library.js setFields only when a rating rises to 4 or more, and also in the sync merge:
  - every new like, and the synced like from the phone, lands at row 1;
  - re-starring and blocking move nothing;
  - the order survives a reload;
  - the demo's first order is identical to today's (37 of 37 rows the same);
  - screenshot: shots/fixB-desktop-4-liked-found.png;
  - unit tests on the B2 copy: all 357 library, rescue, duel and car checks pass. The only two failures come from running a copy outside the repo (README path, toy.json thumbnail). The repo baseline is 2944 of 2944.

SIDE NOTE (not part of this finding): on arrival, #/liked shows zero song rows on the first screen at both sizes, because the header and the "Artists here" shelf fill it. Even after the fix the newest like is one screen down on desktop.

COVERED: #/liked, Home > Shuffle everything, the L key and the bar heart, track-page stars, the toast's Undo, the sort select, the Play button, the duel's Set stars path, blocking, the Desk sync inbox merge, reload; desktop and phone; demo and real mode.

SEVERITY: medium. Liking is frequent (heart, L, car mode) and the list contradicts its own toast. The song is still findable through search or History, so it is not a barrier.
- **Fix (verified):** Stamp the moment a song joins Liked songs once, in library.js, and add a "Recently liked" order that is the default on #/liked. Do not reuse stateAt: it re-orders liked songs when their stars move between 4 and 5 (the duel's Set stars) or when they are blocked.

1. library.js setFields (line 681): replace the one-line rating assignment with:
	if ('rating' in fields) {
		var r = Math.max(0, Math.min(5, Math.round(+fields.rating || 0)));
		// When the song joined Liked songs (four stars or more): #/liked's Recently liked.
		if (r >= 4 && (t.rating || 0) < 4) t.likedAt = t.stateAt; else if (r < 4) t.likedAt = null;
		t.rating = r;
	}
   Every like path goes through this: the heart, L, stars, the rating menu (rateIds), the duel's applyStars and car mode's like.
   Also add likedAt: null to blank() at library.js:291.

2. app.js checkInbox, line 4116. The sync merge sets ratings directly, so stamp there too:
	if (newer) { var r = +s.rating || 0; if (r >= 4 && (t.rating || 0) < 4) t.likedAt = s.stateAt; else if (r < 4) t.likedAt = null; t.rating = r; t.blocked = !!s.blocked; t.stateAt = s.stateAt; }

3. rescue.js:31: add 'likedAt' to STATE so a replaced upload keeps its place.

4. app.js SORTS, after line 1808:
	liked: function (a, b) { var x = a.likedAt || '', y = b.likedAt || ''; return x < y ? 1 : x > y ? -1 : SORTS.added(a, b); },
   Songs liked before this change keep today's "Recently added" order below the new likes.

5. app.js collection(), line 2310: hd.appendChild(sortSelect(sort, function (v) { setQuery({ sort: v }); }, o.sorts));

6. app.js viewLiked, line 4744: change sort: 'added' to:
	sort: 'liked', sorts: [['liked', 'Recently liked']].concat(SORT_OPTS)

7. test.js, library section:
   - L.edit from 0 to 5 sets likedAt equal to stateAt;
   - 5 to 4 and a block leave it unchanged;
   - dropping to 3 sets it to null;
   - editMany behaves the same.

8. README:
   - line 168: #/liked lists the newest like first ("Recently liked");
   - line 1536: the edit row mentions likedAt;
   - bump ?v= on every script in index.html (README line 1877).

All six code steps were prototyped together and measured: see how.
- **Auditor's original fix:** Record likedAt when a rating reaches 4 or more (in toggleLike, rateIds and stars), or reuse stateAt. Add a 'liked' sort ('Recently liked') to the #/liked sort options and make it the default there.
- **Files:** `misc/101-true-shuffle/library.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/rescue.js`, `misc/101-true-shuffle/test.js`, `misc/101-true-shuffle/README.md`, `misc/101-true-shuffle/index.html` · **Effort:** S
- **Risks:** - Old likes have no likedAt. They keep today's "Recently added" order below the new ones; there is nothing to migrate, because the time of the like was never recorded.
- Unlike followed by the toast's Undo, and the duel's Set stars Undo, re-stamp likedAt, so those songs move to the top. Optional fix: in toggleLike, save t.likedAt before the edit and put it back in the Undo handler.
- rescue.js merge() does not work out likedAt. When only the old copy was liked, the merged song falls into the unstamped section. This is rare.
- A sort=liked query on another page (for example #/songs?sort=liked) leaves the select blank. It is harmless, but collection() could fall back to o.sort when the key is not in its options.
- The sync outbox format is unchanged: likedAt stays on each device and comes from stateAt when ratings merge.

Re-run after the change:
- node misc/101-true-shuffle/test.js (library, rescue, duel and car sections);
- node scripts/qa/smoke.mjs 101-true-shuffle;
- node scripts/test-all.mjs;
- the drive scripts repro.mjs, fixcheck.mjs and realmode.mjs in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-13/. Each takes args: outDir, appPath, tag. Run realmode.mjs with Google hosts blocked; it deletes its database at the end.
- the auditor's audit/library/lists.mjs step 9, which should now report row index 0 instead of 37.
- **Evidence:**
  - lists.mjs: '9 liked a song added long ago: Liked sort added {liked: 38, sort: added, opts: [Recently added, Title, Artist, Most played, Rating, Year, Length, Anime / work]} its row index after scrolling to the end 37'
  - Screenshot: .../library/shots/liked-after-like-end.png
  - app.js:4742-4745: viewLiked uses sort 'added'; app.js:1808: SORTS.added sorts by lastAdded
  - library.js:680: edit already stamps stateAt when the rating changes

### library-14 · medium · verified · History files evening listens under the wrong day

- **Where:** History (#/history)
- **Observed:** At 20:28 CDT on 11 October (America/Chicago), 'Today' held only the listens from 19:04 to 20:34. The next heading, '2026-10-11', is also today, and its list started at 18:49 and ran back past 00:12 into 23:57…19:12 on the evening of 10 October. Every listen after 7 pm CDT (6 pm CST) is grouped with the next day, while its time is shown in local time. Plays per month also uses UTC months.
- **Why it matters:** Consistency and accuracy: dates and times must use the same clock, the user's own.
- **How it was verified:** CODE. In app.js `viewHistory` (lines 3492-3525), the cited lines are exact. 3501 keys months by `new Date(e.at).toISOString().slice(0, 7)`, which is UTC. 3506 keys days by `toISOString().slice(0, 10)`, also UTC. 3511 tests for "Today" against the UTC date of `now()`. 3516 prints the time with `toTimeString()`, which is local.

This is not intended. wrapped.js (518, 519, 788) and habits.js (395, 508) pass `{ local: true }`, and their tests assert local days. README line 725 says local days are used "so that a day is the reader's own day (an evening play in Texas is not tomorrow's)". README line 197 says nothing about UTC for History.

BROWSER. I wrote a drive script, C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-14/hist-tz.mjs.
- Setup: real mode with the four Google hosts blocked, in a fresh context. The time zone is forced with Emulation.setTimezoneOverride and the clock is pinned with an init script.
- Seed data: 40 tracks plus listens at known local times, inserted oldest first, because store.getHistory orders by insertion number.
- It reads the headings, times and month bars from #view, and deletes the database at the end.

Results with the current code:
- Sunday 11 Oct, 21:00 CDT: "Today" has 2 listens (20:30, 19:15). "2026-10-11", which is also today, has 8: 18:45 13:30 12:00 07:30 00:15 23:45 21:00 19:30. So the times jump from 00:15 back to 23:45 inside one day. "2026-10-10" ends 08:00 and then 20:00 (a 9 Oct listen). A "2026-10-01" heading holds the 22:30 and 20:00 listens from 30 Sep. By local days, Today should have 7 and Yesterday 6.
- 14:00 CDT the same day: "Today" has 7 listens, including last night's 23:45, 21:00 and 19:30.
- Plays per month shows 2026-09 = 1 and 2026-10 = 16. Local months give 3 and 14.
- Monday 2 Nov, 10:00 CST, after the clock change: "Today" lists 08:00 and then last night's 22:00. A 30 Oct listen sits under "2026-10-31", and a 30 Dec 2025 listen at 21:00 under "2025-12-31". In winter the cut-off moves to 18:00.
- Tokyo, 08:00 JST: "Today" has 6 listens, including yesterday's 23:00, 12:00 and 09:30. Every zone other than UTC is affected.

Screenshots of the current code are in .../library-14/shots/: now-chicago-evening-days.png, now-chicago-afternoon-days.png, now-chicago-dst-days.png and now-chicago-evening-top.png. They show the wrapped times and the duplicate "Today" plus "2026-10-11" headings.

FIX CHECKED. I copied the app into my folder without config.js (an empty stub stood in for it), applied the fix below, and served the copy as misc/101-ts-fix. All four scenarios then match the local grouping exactly. The headings read Today, Yesterday, Saturday, Friday, Sep 30 and Dec 30, 2025, and the bars read "September 2026 = 3, October 2026 = 14". Screenshots: shots/fix-*.png. There were no page errors and no outside hosts were contacted.

The repo is untouched (git status matches the start of the session), and no browser processes are left. I could not check the auditor's exact times, which came from their own data, but the mechanism and the line references are correct.

Severity is medium, not high: History is a secondary view and no data is lost, because the stored times and the CSV export are exact. But for the owner in Texas, every listen after 19:00 CDT (18:00 CST) is filed under the next day, every day. "Today" shows last night's songs, and times run backwards under one heading, which anyone looking at the page would notice.
- **Fix (verified):** misc/101-true-shuffle/app.js, four line changes (tested on a copy):

1. After `addedName` (line 58), add the helper:
	// A moment's day on the listener's own calendar, 'YYYY-MM-DD' (its first seven letters are the month)
	function localDay(ms) { var d = new Date(ms), m = d.getMonth() + 1, dd = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; }

2. In `viewHistory`:
- Line 3501: `var m = localDay(e.at).slice(0, 7);`
- Line 3502: map to `{ name: addedName(m), value: months[m] }`. The bars then read "October 2026", the same wording the home page's "added" months use.
- Line 3506: `var d = localDay(e.at);`
- Line 3511: `sectionHead(view, TS.recs ? capital(TS.recs.sinceWords(byDay[d][0].at, now())) : d === localDay(now()) ? 'Today' : d);`

This reuses recs.js `sinceWords`, which works on the local calendar, handles the clock change and is already tested (test/recs.section.js:92). It gives "Today", "Yesterday", a weekday for the last six days, then "Oct 3", or "Dec 30, 2025" in another year. Leave line 3516 (the local time) as it is. The "On repeat" 30-day window and the CSV export's ISO UTC timestamps need no change.

3. In README.md line 197, add that History groups listens by the listener's own calendar days and months, as Your year does.
- **Auditor's original fix:** In viewHistory, group by the local date (getFullYear, getMonth and getDate of new Date(e.at)) for the day key, the 'Today' test and the month key. Use friendly headings: 'Today', 'Yesterday', 'Saturday 10 October'.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** S
- **Risks:** Low risk. Only the grouping and labels in `viewHistory` change. The stored history, the CSV export, Desk sync, Your year and habits are untouched.

Things that change or could be affected:
- Month labels change from "2026-10" to "October 2026". I found no test or QA script that asserts History text (searched misc/101-true-shuffle/test, test.js and scripts/qa), but any screenshot comparison of #/history will differ.
- Headings come from `sinceWords` on each group's first listen. Groups are still keyed by the full local date, so two days can never merge.
- If recs.js failed to load, the fallback still groups by local day and shows "Today".
- The hour that happens twice on 1 Nov groups correctly; I checked that.

Re-run:
- `node misc/101-true-shuffle/test.js`
- `node scripts/qa/smoke.mjs 101-true-shuffle`
- The drive script at C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-14/hist-tz.mjs, with arguments `all misc/101-true-shuffle now`. The SHOWN lines must equal the EXPECTED lines in all four scenarios (Chicago evening, afternoon and clock change, and Tokyo).
- Look at #/history at 390x844 in both themes.

Separate, not part of this fix: foryou.js:934 `dateWords` compares a release date with the UTC date, so "Out today" can show an evening early in Texas.
- **Evidence:**
  - real.mjs (history inserted in time order): 'H1 history {now: Sun Oct 11 2026 20:28 CDT, localDate: 2026-10-11, utcDate: 2026-10-12, groups: [{head: Today, first: 20:27, last: 19:12}, {head: 2026-10-11, n: 96, first: 18:57, last: 19:12, aroundWrap: [00:27, 00:12, 23:57, 23:42]}, …]}'
  - Screenshots: .../library/shots/real-history-today.png (Today ends at 19:04; '2026-10-11' starts at 18:49), .../library/shots/real-history-wrap.png (00:12 is followed by 23:57 under the same heading)
  - app.js:3506: the day is new Date(e.at).toISOString().slice(0, 10) (UTC); 3511: Today is compared in UTC; 3516: the time is toTimeString() (local); 3501: months in UTC
  - habits.js already counts in local time for Your numbers

### library-15 · medium · verified · 'Not labelled' really means 'never touched', so one small fix hides a song from labelling

- **Where:** Needs attention > Not labelled, Quick labeller (#/label)
- **Observed:** Needs attention > Not labelled and the Quick labeller treat a song as labelled once it has any correction at all. Accepting one artist reading took the count from 3,200 to 3,199. Setting only the mood of every song in one bulk edit took it to 'Not labelled 0', although all 3,200 songs still had no scene and no work. The labeller builds its queue once per visit, so it still said '1 of 3,200' afterwards.
- **Why it matters:** A status list should reflect the real state of the data, or users stop trusting it and miss work.
- **How it was verified:** I read the code and drove the app in real mode with the Google hosts and i.ytimg.com blocked, using 3,200 and then 800 synthetic songs in IndexedDB and no labels file. Scripts and PNGs are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-15/: check.mjs, check2.mjs, check3.mjs.

CODE: The test `!t.labels && !Object.keys(t.userEdits).length` appears three times: app.js:160, app.js:2784 (Fix tab) and app.js:3533 (needsLabel, used by the hub at 2551 and Settings at 2940). acceptGuess (app.js:1516-1518) writes a correction `{artist, title}`. Three places offer it:
- the now-playing panel for every unsure song (app.js:1006, guessBox);
- the home nudge "N tracks still have no sure artist. Name them in one tap each." (app.js:1971);
- the default Fix tab "No sure artist".

The Fix tab's own help (app.js:2796) gives the reason as "their genres are YouTube's coarse topics", and that is still true after an artist-only fix. The labeller's empty state (app.js:3564) says "Every song here has labels".

REPRODUCED (check.mjs, 3,200 songs):
- Start: Not labelled 3,200, hub "3,200 songs to label", Settings "3,200 songs without labels", labeller "1 of 3,200", No sure artist 530.
- One click on "By Hollow Compass?" in Needs attention, then No in the "Read the rest of this channel" dialog: the song's userEdits became {title, artist}, while mood, scene and work stayed '' and genreSource stayed 'youtube'. All three counts dropped to 3,199.
- Playing an unsure song and tapping "By pixel archive?" in the now-playing guess box: 3,198 (now-playing-guessbox.png).
- Teaching a channel with "Yes, those 79 tracks" took No sure artist from 293 to 210 but removed no song from Not labelled. Only direct taps do.
- Setting only the mood on every song: Not labelled 0 (fix-unlabelled-after-bulk-mood.png), as the auditor said.

LABELLER QUEUE: It is built once per page session, not once per visit: on the first visit, and again only after a reload or "Start over" (app.js:3559). Line 3561 skips only deleted songs. I opened #/label, gave the song it showed a mood elsewhere, and came back: it still said "1 of 3,200" and showed the same song with Bright already chosen (labeller-stale.png). After the bulk mood the hub said "0 songs to label" while the labeller said "1 of 3,200".

WHERE THE AUDITOR'S FIX GOES WRONG:
- Scene and work are often empty on purpose. The owner's hand-researched labels.json has 1,855 songs: mood, kind, lang and genres are set on all 1,855, but 487 of the 1,831 non-clip songs have no scene and 705 have no work. In-page, 689 of them lack a scene or a work. "No scene/No work" chips, or a needsLabel based on them, would flag hundreds of finished songs and never let the queue empty.
- genreSource is not reliable either (check3.mjs). An artist-only fix goes out through exportLabels as {artist, title, genres:['Rock']}. After a Desk sync applies it (app.js:4110), the song has t.labels and genreSource 'label' with mood ''. Tests built on `!t.labels` or on genreSource would treat it as labelled.
- Fully rebuilding the queue would put skipped songs back in front and lose Back.
- The bulk-mood case is consistent: mood is the one field every hand-labelled song has, and the tab's help text recommends bulk Edit.

The owner's 2026-10-09 backup (counted only, no titles read) has 1,855 songs with 2 corrections, both artist and title only. That is exactly this pattern. labels.json now covers that whole library, so the problem hits new imports.

FIX TESTED: I patched a copy of the app outside the repo (no config.js; a stub config instead), mounted it, and ran check2.mjs on both versions with 800 songs:
- One artist tap leaves Not labelled at 800 in the patch (799 in the original).
- Save and next, Back, and Save and next still work.
- Labelling the next song elsewhere and coming back: the patch shows "2 of 799" and the following song; the original shows "2 of 799" with the song that was already labelled.
- The owner's labels.json gives 0 unlabelled under both the old and the new test, and the demo gives every song a mood and a kind (demo.js:203), so neither changes.
- No page errors. patched-fix-unlabelled.png shows the new help text.
- **Fix (verified):** Count a song as labelled by the hand-made fields that only a labels file or a correction can set. Do not add scene, work or genre checks.

1. misc/101-true-shuffle/app.js, at app.js:3532-3534 (above suggestFor):
   var labelQueue = null, labelAt = 0, labelPicked = false;
   // Labelled: a mood, a kind (the labeller always saves one, app.js:3647), a work or a role. These come only from a labels file or a correction, never from YouTube or an artist's profile (library.js:459-461), so naming the artist, fixing a title, or a Desk round trip of such a fix does not count.
   function needsLabel(t) { return !t.mood && !t.kind && !t.work && !t.role; }
   function startLabelling(ids) { labelQueue = ids.slice(); labelAt = 0; labelPicked = true; location.hash = '#/label'; }
   function pruneLabelQueue() { if (!labelQueue || labelPicked) return; labelQueue = labelQueue.slice(0, labelAt).concat(labelQueue.slice(labelAt).filter(function (id) { return lib.tracks[id] && needsLabel(lib.tracks[id]); })); }

2. In viewLabel (app.js:3559), where the queue is built automatically, also set labelPicked = false.

3. In onRoute (app.js:746-749):
   - extend the first line to `var prevKey = ..., wasLabel = route.parts[0] === 'label';`
   - after `route = U.parseHash(location.hash);` add `if (route.parts[0] === 'label' && !wasLabel) pruneLabelQueue();`
   This drops only the songs ahead of the current one that were labelled elsewhere. Back, skipped songs, and a queue picked from a selection stay as they are.

4. Use the one definition everywhere:
   - app.js:160: `if (needsLabel(t)) m.needs.unlabelled++;`
   - app.js:2784: `['unlabelled', 'Not labelled', ix.all.filter(needsLabel)]`
   The hub (2551) and Settings (2940) already call needsLabel.

5. Help text at app.js:2796: 'None of these has a mood, kind, work or role yet; naming the artist or fixing the title is not labelling. Their genres are YouTube\'s coarse topics. Select several and press Edit to label them together.'

6. README.md:197, the quick labeller paragraph: say that the labeller walks the songs with no mood, kind, work or role yet (naming the artist is not labelling), or a selection.

Optional but cheap: put the predicate in library.js as L.needsLabel, next to fixedArtist at library.js:424, and add test.js cases:
- an artist-only L.edit leaves it true;
- a mood or kind edit makes it false;
- a labels file with mood makes it false;
- exportLabels then applyLabels of an artist-only edit keeps it true.

Do not add "No scene/No work" chips or genreSource checks: 487 and 705 of the owner's hand-labelled songs leave scene and work empty on purpose, and a sync turns YouTube's topics into 'label' genres.
- **Auditor's original fix:** Define needsLabel by what is missing: no mood, no scene, or genres only from YouTube topics (genreSource 'youtube' or ''). Show what each song lacks ('needs mood, scene'), and split the tab into chips: No mood n, No scene n, No work n. Rebuild labelQueue on entering #/label unless it came from a selection.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md`, `misc/101-true-shuffle/library.js (optional, if the predicate moves there)`, `misc/101-true-shuffle/test.js (optional regression cases)` · **Effort:** S
- **Risks:** Behaviour changes:
- Libraries whose songs only have naming fixes will see Not labelled, the hub's "N songs to label" and Settings' count go up. That is the intent; the 2026-10-09 backup has 2 such songs.
- A third-party labels file whose entries have no mood, kind, work or role now leaves those songs under Not labelled. The owner's labels.json gives 0 under both the old and new test, and the demo gives 0 because every demo label has mood and kind.
- A bulk edit that sets only scene, language or genres now leaves songs in the list until they get a mood.
- suggestFor (app.js:3539 and 3550) skips needsLabel songs, so artist-only songs stop voting. Genre suggestions then come only from labelled songs, and the artist field gets fewer votes; guessPicks still offers the parsed readings.

Code risk:
- pruneLabelQueue must run only when entering #/label from another route, never on the labeller's own renderView(false) after Save or Back. Otherwise Back would skip the song just saved. In the patched copy, Back still works.
- needsLabel is a hoisted function declaration in the same closure as idx() and onRoute, so calling it from line 160 is safe.

Re-run:
- node misc/101-true-shuffle/test.js and node scripts/test-all.mjs;
- node scripts/qa/smoke.mjs 101-true-shuffle;
- check2.mjs from my folder against the original and the mounted patch. Expected: an artist tap leaves Not labelled unchanged; returning to the labeller skips songs labelled elsewhere; Back works; owner labels give 0.
- the demo at #/fix?tab=unlabelled, which should still show 0;
- the auditor's ux/audit/library/real.mjs: U2 should stay at 3,200, and U3 (mood on every song) stays at 0 on purpose.
- **Evidence:**
  - real.mjs: 'U1 before {fixTabs: [No sure artist 530, Not labelled 3,200, …], lib: {noMood: 3200, noScene: 3200, noWork: 3200}}'
  - real.mjs: 'U2 after accepting one artist reading {… Not labelled 3,199 …}'; 'U3 after setting only the mood of every song {fixTabs: [… Not labelled 0 …], labeller: 1 of 3,200 …, lib: {noMood: 0, noScene: 3200, noWork: 3200}}'
  - app.js:3533: needsLabel = no labels file and no userEdits; app.js:2784: the Fix tab uses the same test; app.js:3559: labelQueue is built only once

### library-16 · medium · verified · Quick labeller: choosing the suggested artist leaves the artist inside the title

- **Where:** Quick labeller (#/label)
- **Observed:** For the upload 'Hollow Compass - Glass Orchard (1978)', the labeller offers the artist chips 'Hollow Compass' and 'Glass Orchard'. Choosing 'Glass Orchard' and saving stored the title 'Hollow Compass - Glass Orchard' by the artist 'Glass Orchard'. The same reading in Needs attention ('By Glass Orchard?') stores the title as 'Hollow Compass' and then offers to read the rest of the channel the same way; the labeller does neither.
- **Why it matters:** Consistency: the same suggestion should give the same result wherever it is offered.
- **How it was verified:** Code read: in viewLabel the artist chips are built from p[0] of each guessPicks pair (app.js:3597-3598), and a chip sets only its own field (app.js:3591). save() sends only fields that changed (app.js:3641-3648), so the title is not sent. In derive, a reading nothing vouches for keeps the whole upload title (p.whole), and an artist correction does not split it (library.js:441-446). The song's own correction does not count as "sure" during that derive, because its artistKey is still empty (library.js:377-383). Elsewhere, acceptGuess sets both artist and title, re-reads the channel's other toss-ups and calls offerTeach (app.js:1516-1525), and the Edit details dialog runs L.resolveArtists after an artist change (app.js:1741).

Browser run: verify.mjs in my folder, demo mode, 1280x860 dark, a fresh page for each path. Song: demo-043 "Hollow Compass - Distant Kindling (1976)" on "cassette drawer", which has 12 guessed uploads, all "Hollow Compass - X". The auditor's demo-041 "Glass Orchard" is not listed under No sure artist in the demo, so I used its twin. I opened the labeller through the real UI: select rows, More > "Label them one by one". The card showed Artist empty, chips [Hollow Compass, Distant Kindling], Title "Hollow Compass - Distant Kindling". Results:
- Labeller, chip "Hollow Compass" (the correct artist), Save and next: saved title "Hollow Compass - Distant Kindling" by Hollow Compass, userEdits {artist, kind}. No dialog. The 11 other uploads on the channel were untouched, and the next card ("Hollow Compass - Paper Weather") arrived with an empty Artist again. The player bar and navigator.mediaSession.metadata (the car's display) read title "Hollow Compass - Distant Kindling", artist "Hollow Compass".
- Labeller, chip "Distant Kindling": title "Hollow Compass - Distant Kindling" by Distant Kindling.
- Needs attention, "By Hollow Compass?": title "Distant Kindling". It settled 10 of the other 11 at once, and the dialog offered the last one.
- Needs attention, "By Distant Kindling?": title "Hollow Compass", and the dialog offered 11 tracks.
- Edit details (I on the row), artist typed "Hollow Compass": title "Distant Kindling".
So the labeller is the only one of the three paths that keeps the artist in the title, even for the correct pick.

How long it lasts: loading does not re-derive (fromParts/load/fill). The title is fixed only by resolveArtists after an import (yt.js:760) or after a sign-in refresh of stale songs (app.js:5908-5909, yt.js:828). Running resolveArtists by hand fixed the "Hollow Compass" pick but not the "Distant Kindling" pick: parse.js:342 needs the other side to be seen as an artist at most once, and "Hollow Compass" heads 11 guesses. That case stays wrong indefinitely.

How often: counts only, from the owner's export true-shuffle-2026-10-09.json (no labels applied). 1,332 of 1,855 songs (72%) have a guessed artist. 775 (41.8%) are guesses whose shown title contains the guessed artist. 498 (27%) are two-reading guesses spread over 359 channels; 29 of those channels hold 3 or more (140 songs). labels.json now names 497 of the 498, so today's queue is mostly clear, but new imports arrive unlabelled and the labeller is their path. Labelling one such channel of 12 songs costs 12 chip clicks plus 12 hand edits of the title (17 characters each) in the labeller, against 1 tap in Needs attention.

Screenshots (in shots/): L-1-card.png, L-2-chip-0.png (Title still "Hollow Compass - Distant Kindling" after the chip), L-4-playing.png (the song playing with the doubled name; next card blank), G-1-teach.png, E-1-editor.png. No page errors.

One caution on the auditor's fix: offerTeach focuses Yes (app.js:1547), and labelKeys is off while a dialog is open (app.js:5696). So in the labeller, the next Enter (its "save and go on" key) would accept a re-read of the whole channel.
- **Fix (verified):** All changes are in misc/101-true-shuffle/app.js, viewLabel (about lines 3558-3670); ES5, tabs.

1. Keep the readings. Replace line 3597 with:
`var pairs = guessPicks(t), picks = pairs.map(function (p) { return p[0]; }), autoTitle = t.title, inputs = {};`
and add:
`function readingOf(name) { var f = Parse.fold(name); return pairs.filter(function (p) { return Parse.fold(p[0]) === f; })[0] || null; }`

2. A chip fills the title. In text() store `inputs[key] = inp;`. In the chip's click handler, after `fields[key] = v`, add:
`if (key === 'artist' && inputs.title && fields.title === autoTitle) { var rp = readingOf(v); autoTitle = fields.title = inputs.title.value = rp && rp[1] ? rp[1] : t.title; }`
A reading chip then shows the other side in Title before saving. A chip that is not a reading puts the upload's title back. A title the user typed is never overwritten.

3. Save. Before L.edit:
`var wasGuess = !t.artist && !!t.artistGuess;`
and, for a name typed by hand:
`if (out.artist && wasGuess && !('title' in out)) { var rp2 = readingOf(out.artist); if (rp2 && rp2[1]) out.title = rp2[1]; }`
After L.edit, re-read the channel's other toss-ups the way acceptGuess does. Factor app.js:1517-1521 into `function settleChannel(id) -> settled ids`, use it in acceptGuess too, and call `changed([t.id].concat(settled))`. The next cards from the same channel then arrive already read. Then set:
`labelTeach = out.artist && wasGuess ? L.teachPlan(lib, t.id, out.artist) : null;`
using a new `var labelTeach = null;` next to labelQueue.

4. Offer the teaching inline, not through offerTeach's dialog. At the top of the next card, when labelTeach.ids.length > 0, add a `.ts-guessbox`:
- offerTeach's sentence: "N other unsure tracks on 'channel' could be read as Artist - Title", plus its "Careful:" line when there are conflicts.
- Button "Yes, those N tracks": L.teachChannel, changed(res.touched, true), say(...), clear labelTeach, renderView(false).
- Button "No": clear labelTeach and re-render.
Nothing in the box takes focus, so Enter and 1 to 6 keep working on the card.

5. README.md, the "History (#/history), the quick labeller" paragraph: add that picking one of the readings fills the Title too, settles the channel's other guesses, and offers to read the rest of the channel the same way.
- **Auditor's original fix:** Build the labeller's artist chips from the guessPicks pairs. When a reading chip is chosen, set the artist to p[0] and the title to p[1] (and update the Title input). After Save, if L.teachPlan(lib, id, artist).ids.length is above 0, offer offerTeach's 'Read the rest of this channel the same way?'.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** S
- **Risks:** What could break:
- **A typed title:** it must survive a chip click (the autoTitle guard). Check: type a title, click a chip, and the title stays.
- **Switching chips:** a reading chip followed by a plain chip must put the upload's title back.
- **Keys on a pre-read card:** the settle step makes the next same-channel card arrive with Artist already filled. first.focus() is skipped in that case (app.js:3669), so check that 1 to 6, Enter and the arrows still work on such a card.
- **Accidental teaching:** the teach offer must stay non-modal. Pressing Enter twice quickly must only save and must not change lib.channelRules.
- **Shared helper:** acceptGuess's behaviour must not change when settleChannel is factored out of it.
- **Sync:** the labeller now writes userEdits.title, which travels in the Desk sync and labels export the same way acceptGuess's edits already do.
- **Queue:** teaching or settling must not drop songs from labelQueue; needsLabel is unchanged, so they should stay.

Re-run:
- `node scripts/test-all.mjs`, or at least `misc/101-true-shuffle/test.js`.
- `node scripts/qa/smoke.mjs 101-true-shuffle`.
- My `verify.mjs`. Expected: chip "Hollow Compass" saves "Distant Kindling" by Hollow Compass; chip "Distant Kindling" saves "Hollow Compass" by Distant Kindling; the next card arrives pre-read; no `.ts-modal` opens; the Needs-attention and editor results are unchanged.
- The auditor's `audit/library/real.mjs` with the steps labelpick and label.
- `audit/accessibility/keyboard.mjs` on #/label.
- **Evidence:**
  - real.mjs (labelpick): 'LP the song {raw: Hollow Compass - Glass Orchard (1978), title: Hollow Compass - Glass Orchard, artist: "", picks: [By Hollow Compass?, By Glass Orchard?]} … artist chips [Hollow Compass, Glass Orchard] fields after the chip [Glass Orchard, Hollow Compass - Glass Orchard, ""] saved as {title: Hollow Compass - Glass Orchard, artist: Glass Orchard}'
  - Screenshot: .../library/shots/real-labeller-start.png
  - app.js:3597-3598: the chips use only p[0] of each guessPicks pair; app.js:3591: a chip sets only its own field; app.js:1516-1525: acceptGuess sets the artist and the title, then calls offerTeach

### library-17 · medium · verified · Edit details: Save is out of view, a click outside loses the edits, and the many-songs form hides current values

- **Where:** Edit details (I), one song and many
- **Observed:** At 1280x860 the 4-song editor is 828 px tall with 878 px of content, and Save and Cancel sit below the genre picker, out of view. On a phone Save is at y=1571 on an 844 px screen, and the Title field takes focus on opening, so the keyboard covers the sheet. I typed a new title and chose a mood; one click beside the dialog closed it and lost both, with no warning. In the many-songs editor every field says 'Leave as it is', whether the songs share a value or not, and a text field such as From can't be cleared for many songs.
- **Why it matters:** Keep the primary action in view. Protect unsaved input from accidental dismissal. Show the current state before asking for a change.
- **How it was verified:** I reproduced every claim with my own drive scripts (demo mode, own folder .../scratchpad/ux/verify/library-17/: desk.mjs, loss.mjs, phone.mjs, sticky*.mjs, guard.mjs, with .txt outputs and shots/). I also read app.js:1554-1747, ui.js:330-366 and library.js setFields/editMany.

1) Save is out of view. For one song (opened with I on a row), Save sits below the visible part of the dialog at every desktop size I tried:
- 1280x860: dialog 828 px, 762 px visible of 1033 px of content. Save's top is at 1044 and the visible area ends at 843.
- 1366x768: 363 px of overflow. 1440x900: 231 px. 1536x864: 267 px.
- Even 1920x1080: 51 px of overflow, so only the top of the Save and Cancel buttons shows (shots/desk-1920x1080-one.png).

For many songs ("Edit all" on a work page, 10 songs, and on an artist page, 26 songs), there is 878 px of content. Save is hidden at every size except 1920x1080. With the mouse wheel:
- From the middle of the dialog, it takes 3 notches to reach Save.
- From low in the dialog it takes 9. The first 6 only scroll the genre picker's own 516 px list.

Enter in a text field does save, but after a click on a mood or genre chip the focus is on a button, so mouse users must scroll.

On a phone (390x844, touch, opened from the row menu by tapping):
- The sheet starts at y=68 and is 776 px tall, with 1508 px of content.
- Save's top is at 1571, which means 768 px of scrolling. For many songs, Save is at 1374.
- The Title field has the focus after the tap (Artist in many mode). I could not show the Android keyboard headless. That it opens is inferred: the focus happens during a tap.

2) Unsaved edits are lost.
- I typed "A better title" and chose Dark, then pressed once at (130,400) beside the dialog. The backdrop is 42.8% of a 1280x860 window. The dialog closed with no warning; the title stayed "Paper Parade" and the mood stayed "bright". Reopening showed the old values.
- New finding: I typed a title, chose Dark, typed "rock" in "Find a genre" (a search field) and pressed Escape to clear it. The whole dialog closed and both edits were lost: ui.js:354 closes on any Escape.

3) The many-songs form hides what the songs share. On "Edit all" for "Kumori Station Anime", all 10 songs have the same work, artist, language (ja) and scene (anime), yet every field reads "Leave as it is". The same happens for the 26 "Paper Lanterns" songs (one artist, all en, all songs). See shots/desk-1280-work-editall.png and phone-many-open.png.

4) A bulk text edit can't be cleared or undone.
- I typed "live" in Version for all 10 songs (3 were live before) and pressed Enter. All 10 became "live", and the toast "Saved on 10 tracks." has no Undo.
- I reopened the editor: Version still said "Leave as it is". Saving with it empty gave "Nothing changed." (app.js:1707: empty means keep).
- The only ways back are editing 7 songs one by one, or "Undo my corrections", which wipes every correction on all 10 songs (app.js:1691-1693).

The README only says "fields left alone stay"; nothing marks any of this as deliberate.

Fix prototypes, injected at runtime (no repo change):
- Sticky footer: Save was in view on opening at 1280x860 in dark and light themes and on the phone. The footer is flush with the bottom edge (row bottom 843 = body bottom 843), the last content scrolls clear of it, and Save still submits.
- With bottom:0 instead, genre chips showed through a 20 px gap under Save (shots/sticky-desk-dark-open.png): Chrome applies the 20 px bottom padding of .ts-modal-body to the sticky offset. Hence bottom:-20px.
- The footer is 73 px tall; Save, Cancel and "Undo my corrections" fit on one line at 390 px (shots/sticky3-phone-three-buttons.png).
- Backdrop guard: cancelling the backdrop's pointerdown kept the dialog open with "Kept title" typed and focus still in Title, and Tab stayed inside the dialog (guard.txt).
- **Fix (verified):** 1. Keep Save in view. In app.css:476, replace `.ts-edit-btns { margin-top: 18px; }` with:
`.ts-edit-btns { position: sticky; bottom: -20px; z-index: 2; background: var(--bg); margin: 18px -22px -20px; padding: 12px 22px max(20px, env(safe-area-inset-bottom)); border-top: 1px solid var(--border); }`
The -20px values cancel the 20 px bottom padding of .ts-modal-body (app.css:457); say so in a comment. The class is only used by the editor.

2. Don't lose edits to a stray press.
- ui.js openDialog: add an opt-in option and document it at ui.js:330. Line 352 becomes:
`back.addEventListener('pointerdown', function (e) { if (e.target !== back) return; if (opts.keepOpen && opts.keepOpen()) { e.preventDefault(); return; } close(); });`
- X, Cancel and Escape still close.
- In openEditor, declare `var dirty = false;` before U.openDialog and pass `keepOpen: function () { return dirty; }`.
- Set dirty from the form's 'input' and 'change' events, except when the target is gFind.
- Also set `dirty = true` in the mood click (1615) and in both genre chip clicks (1639, 1657).

3. Escape in "Find a genre". At app.js:1670, gFind's keydown: `if (e.key === 'Escape' && gFind.value) { e.preventDefault(); e.stopPropagation(); gFind.value = ''; drawPick(); return; }` Escape in an empty search still closes the dialog.

4. Many songs: show what they share (text(), select(), mood and genres at 1572-1633, and the submit handler at 1703-1725).
- Add a helper `now(get)` that returns the shared value, or how many different values there are.
- When the songs share a value, prefill it (input value, select value, checked mood chip, chosen genres) and remember it in `was[key]`.
- When they differ, show "Mixed (N different)" as the placeholder, as the KEEP option's text and on the Leave chip.
- On submit, write a field for many songs only when it differs from `was[key]` (mixed fields only when typed). This matters because library.js setFields records any written value as a user correction.
- Emptying a shared field then clears it on all songs. Title and artist go to null, as at 1727-1728.
- For Year, ignore songs whose yearSource is 'upload'.
- Reword the intro at 1562 to: 'Fields show what all N share; Mixed ones stay as each track has them unless you set them.'

5. Undo after Save, following the house pattern at app.js:1477.
- Before L.editMany at 1730, snapshot `prev[i][k] = k in userEdits ? userEdits[k] : null` for each key in `out`.
- Replace say() at 1743 with setStatus(msg) and:
`U.toast(msg, { action: 'Undo', onAction: function () { var known = L.knownArtists(lib); ids.forEach(function (id, i) { L.edit(lib, id, prev[i], known); }); L.resolveArtists(lib); changed(ids); say('Undone.'); } })`
- Skip the Undo when a channel rule (chSel) was set.

6. Polish for touch (1745-1746). When no focusField is given and `matchMedia('(pointer: coarse)')` matches, set tabIndex=-1 on the dialog's h2 and focus it, the way new pages focus their title. Keep focusField, e.g. 'artist' from "Someone else..." at 1512.

Steps 1-3 are small and fix the worst problems; steps 4-5 are the bulk of the work. Update the README line about the editor (around line 150) to match.
- **Auditor's original fix:** Make .ts-edit-btns a sticky footer in .ts-modal-body (position: sticky; bottom: 0; with the panel background). Track a dirty flag in openEditor, and while it is set ignore backdrop presses or ask 'Discard changes?'. In many-songs mode, set each placeholder to the shared value or 'Mixed: 3 artists', and give text fields a 'Clear on all' option. On coarse pointers, focus the dialog heading instead of the Title input.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** - **Sticky footer:** the -20px values depend on the 20 px bottom padding of .ts-modal-body (app.css:457); if that padding changes, change them too. The footer takes 73 px, so on a 1366x768 window the visible form shrinks from 670 px to about 597 px. On Android the keyboard still covers the footer while typing (Chrome resizes only the visual viewport), as now.
- **Backdrop guard:** opt-in, only the editor uses it. Escape, X and Cancel still discard without asking (deliberate). If the backdrop's pointerdown is cancelled, focus stays in the field (checked in Chrome).
- **Prefilled values:** writing an unchanged value would mark every selected song as user-corrected (library.js setFields). That would change what "Undo my corrections" resets and what the Fix page counts, so the submit handler must compare with `was[key]`. Also mind uploaded years, artist '' going to null, and resolveArtists still running after an artist change.
- **Undo:** restore only the keys that were saved, leave channel-rule saves out, and compute `known` once so "Edit all" on a big artist stays linear.

Re-run afterwards:
- node misc/101-true-shuffle/test.js, or scripts/test-all.mjs, and the toy's smoke run.
- My scripts in .../scratchpad/ux/verify/library-17/:
  - desk.mjs: expect Save visible at every size.
  - loss.mjs: expect L1 and L2 to keep the edits, the L5 toast to offer Undo, and L5b to show "live" and be able to clear it.
  - phone.mjs, sticky2.mjs, sticky3.mjs, guard.mjs.
- The auditor's ux/audit/library/songs.mjs, misc.mjs and phone.mjs.
- ux/audit/accessibility/dialogs.mjs, focuskeep.mjs and keyboard.mjs (focus trap, focus return).
- The earlier ui/focus.mjs and ui/targets.mjs (focus ring, 44 px targets on coarse pointers).
- **Evidence:**
  - songs.mjs: '7a bulk edit dialog {title: Edit 4 tracks, buttons: [Save, Cancel], placeholder: Leave as it is, h: 828, scrollH: 878}'
  - phone.mjs: 'P4 editor on a phone {modal: [68, 776], body: 1508, saveTop: 1571, innerH: 844}'
  - misc.mjs: 'E1 typed a title and chose a mood, then pressed beside the dialog: open? false title now Paper Parade dialogs 0'
  - Screenshots: .../library/shots/songs-bulk-edit-dialog.png, .../library/shots/phone-editor.png
  - app.js:1686-1698: the buttons come at the end of the form; 1575-1576: the 'Leave as it is' placeholder; 1707: an empty field means keep for many songs; 1745-1746: autofocus; ui.js:352: a pointerdown on the backdrop closes; app.css:457: .ts-modal-body scrolls

### library-18 · medium · verified · Duplicates: a flat list that hides what you need to choose, and no way to keep one copy

- **Where:** Needs attention > Duplicates
- **Observed:** The Duplicates tab lists copies one after another, each showing only the artist and the channel. Of the two 'Copper Atlas' copies, one has 17 plays and the other was never played, and the rows look the same. The dead 'Midnight Almanac' copy is the one holding the 5-star rating. The row menu has no Keep this one, Block the others or Merge; the help just says 'block the copies you do not want to hear'. In the 3,200-song synthetic library the tab held 875 rows.
- **Why it matters:** Support the decision the user is asked to make: show the distinguishing facts side by side and offer the obvious resolution in one action.
- **How it was verified:** Read the code first. app.js:2780-2811 (viewFix) draws Duplicates as one flat trackList sorted by group key. The help text is at 2798, and the only extra on a row is ' · ' + channel (2810). trackList (1225-1354) shows the title, the version, Unplayable and Blocked tags, artist, work, genre, length, a heart and More. It shows no plays, no star rating and no date added. trackMenu (1359-1398) has Block but nothing like Keep or Merge. library.js:973-990 says duplicates are 'Reported, never removed'. I also read rescue.js swap/merge (257-311) and the rescue page.

Scripts and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/verify/library-18/ (shots/).

1) Demo at 1280x860, dark (dups-demo.mjs, shots/v1-desk-dark-dups.png):
- The tab has 4 rows and no grouping element.
- The two Copper Atlas copies render as 'Copper Atlas | Glass Orchard · GlassOrchardVEVO | … | 4:43' and '… · lyric lantern | … | 4:45'. Underneath, one has 17 plays and the other 0. They were added 2024-09 and 2025-08, and sit in 2 playlists and 1. None of this is shown.
- The channel is cut to 'GlassOrc…' and 'lyric lant…'.
- The dead Midnight Almanac copy shows Unplayable and a filled heart (rating 5).
- Every row menu has 15 items and no Keep or Merge.
- Blocking the lyric copy takes 2 clicks (More, Block). The toast says '"Copper Atlas" is blocked', which does not say which copy.
- Duplicates still reads 4 afterwards, and the row stays with only a Blocked tag (shots/v3-desk-dark-dups-after-block.png).
- From the keyboard it takes Shift+F10 and 14 ArrowDown presses to reach Block. After Enter, the focus falls to BODY.
- The song page's Versions list shows the copies only as 'Original (this one)' and 'Original', with no channel and no plays (v5).

2) Owner scale (dups-real.mjs). Real mode, with the Google hosts and i.ytimg.com blocked. No outside host was contacted, and the database was deleted at the end.
- The library was built from the 1,855 songs in the shipped labels.json, with invented channels and plays.
- Duplicates shows 227 rows in 108 groups (97 pairs, 11 triples). That is 12% of the library and about 20 screens at 1280x860 (14,011 px). labels-dups.cjs gives the same count in Node.
- The artist · channel line is cut on 207 of 227 rows at 1280 px, 101 at 1440, 14 at 1920 and 140 on a 390 px phone (shots r2, c-*-1440/1920, r5). The channel names are invented, so these counts are only indicative.
- Blocking a copy at row 99: the count stays 227, the row stays, the scroll position is kept and the focus goes to BODY.

3) The auditor's 875 rows is an artifact of the synthetic library. I rebuilt big.mjs's library (synthetic-dups.cjs): 640 of those 875 rows are its own '(Live)' suffix repeated at k=1,5,9,13. The realistic figure is 227 rows in 108 groups.

4) The Merge part is partly done already and partly a bad idea:
- For a dead copy, Rescue already merges. Its menu has 'Find a working upload'. #/rescue/demo-031 puts the library copy first, marked 'In your library · Sure match'. 'Use this copy' moved the 5-star rating and the playlist over, and Duplicates went from 4 to 2.
- For copies that still play, swap() deletes the old track into lib.moved, and later imports skip that id. That breaks the 'Nothing is removed' promise, so the proposed Merge would make things worse. I leave it out of the fix.

5) One version per song is off by default (plan.oneVersion is false), so both copies of an unsorted song play in one true-shuffle round.

Nothing here is in the decided-on-purpose list, and the README documents only 'never removed', which Keep (blocking) respects.
- **Fix (verified):** This is the smallest fix that works. It drops the proposed 'Merge into this one' for copies that still play, and leaves the dead-copy case to Rescue.

app.js is at 5,941 lines, and test.js:2416 allows at most 5,950. So the new logic goes in a module, and the app.js edits stay on existing lines except one.

(1) library.js duplicates(lib, opts):
- Give each group `live`: its ids that are L.playable and not blocked.
- With opts.open, return only groups with live.length >= 2.
- Tests in the library section: a pair with one copy blocked is not open; a triple with one dead copy is open with 2 live; unblocking reopens it.

(2) New dups.js (TS.dups, ES5 UMD, tabs, built like rescue.js):
- facts(ctx, t, group) builds the row's second line on this tab and replaces the artist line. The artist is the same for every copy and stays in the row's aria-label.
  - First comes a ts-pick button, 'Keep this one'.
  - For a copy that cannot play, show a link to '#/rescue/<id>' named 'Find a working upload' instead of the button.
  - Then the facts, most decisive first: '17 plays' or 'never played', 'rated 5', the channel, 'added Sep 2024' (S.firstAdded). That way an ellipsis cuts the channel, not the numbers.
- keep(ctx, id):
  - Blocks the group's other copies through ctx.edit and unblocks this one if it was blocked.
  - Gives this copy the group's highest rating when its own is lower.
  - Shows one toast with Undo that restores each copy's earlier blocked state and rating: 'Kept the copy from <channel>; 1 other copy blocked.'
  - Calls ctx.next() if the song that is playing got blocked.
  - After the redraw, puts the focus on the first row of the next group.
- menuItem(ctx, t) returns { label: 'Keep only this copy', icon: 'check', desc: 'Blocks the other N copies; nothing is removed', onSelect } for a track in an open group, else null, the same shape as TS.rescue.menuItem.
- Load it after rescue.js in index.html and bump every ?v= stamp.
- Add a README section naming all its exports, which the readme test requires.

(3) app.js:
- viewFix 2780: `L.duplicates(lib, { open: query.get('all') !== '1' })`. The chip then counts only the songs still to sort, and 'Nothing here. Good.' shows when they are all done.
- Help text at 2798: 'The same song more than once. Keep one copy of each: the others are blocked, never removed.' Add a 'Show the N you sorted' link to #/fix?tab=dups&all=1.
- At 2810, the dups tab passes sub: TS.dups.facts and a rowClass that gives each group's first row 'is-dup-start'.
- trackList, on the same lines: at 1241 add `(opts.rowClass ? ' ' + opts.rowClass(t, i) : '')`; at 1257 use `var sub = opts.sub ? opts.sub(t) : artistLinks(t, 'ts-r-sub');`.
- trackMenu, next to 1395 (one new line): `if (one && TS.dups) items.push(TS.dups.menuItem(pageCtx, one));`.

(4) app.css: `.ts-row.is-dup-start { box-shadow: inset 0 1px 0 var(--border-strong); }`. This separates groups without changing the virtual list's fixed row height.
- **Auditor's original fix:** Show the tab in groups: a heading per song, then its copies, each with channel, plays, rating, date added and whether it plays. Give each copy 'Keep this one', which blocks the others in the group with one Undo, and 'Merge into this one', which reuses TS.rescue.swap's merge so ratings, plays, playlists and labels move over, then blocks or removes the other.
- **Files:** `misc/101-true-shuffle/library.js`, `misc/101-true-shuffle/dups.js (new)`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/README.md`, `misc/101-true-shuffle/test.js (or test/dups.section.js)` · **Effort:** M
- **Risks:** - **app.js line limit:** test.js:2416 allows 5,950 lines and app.js has 5,941. Anything beyond the one new line has to live in dups.js.
- **Other test checks:**
  - The readme test fails unless every dups.js export is documented.
  - The lint test fails unless every ?v= stamp in index.html changes together.
- **trackList is shared by every song list:** opts.sub and opts.rowClass must leave today's output unchanged when they are absent.
- **Focus:** blocking from the menu already drops the focus to BODY (measured). Keep must put it on a row, so check it with the keyboard and a screen reader.
- **Desk sync:** L.editMany stamps stateAt, so check that a Keep and its Undo sync both ways.
- **Rescue interplay:** rescue's merge sets target.blocked = !!old.blocked. A copy blocked by Keep therefore plays again if the kept copy later dies and is rescued onto it. That is intended, but test it.
- **The count changes meaning:** the Duplicates chip will show only the songs still to sort (227 drops as you go).
- **Phone width:** the line is 206 px wide on a 390 px phone, so keep the numbers before the channel.
- **What to re-run:**
  - `node misc/101-true-shuffle/test.js` (the library, lint and readme sections)
  - `node scripts/qa/smoke.mjs 101-true-shuffle`
  - This folder's dups-demo.mjs, dups-real.mjs and dups-more.mjs
  - The auditor's library/misc.mjs (E3/E4) and fixpicks.mjs
  - The rescue checks in README.md (a merge into the library's copy, then Undo after a reload)
  - Dark and light themes at 1280, 1440 and 390 px
- **Evidence:**
  - misc.mjs: 'E3 a duplicate row menu [Play, …, Rating…, Trim and volume…, Block (never shuffle)]'
  - misc.mjs: 'E4 duplicate rows [{Copper Atlas, GlassOrchardVEVO, plays 17, shown: Glass Orchard · GlassOrchardVEVO}, {Copper Atlas, lyric lantern, plays 0}, {Midnight Almanac, lyric lantern, plays 0}, {Midnight Almanac, GlassOrchardVEVO, plays 0, rating 5, playable false}]'
  - real.mjs: 'U1 … Duplicates 875'
  - Screenshot: .../library/shots/desk-dark-fix-tab-dups.png
  - app.js:2786: one flat list sorted by key; 2798: the help text; 2810: the extra line shows only the channel; rescue.js swap() already merges ratings, plays, playlists and labels into a copy

### library-19 · medium · verified · No way to say that two spellings are the same artist

- **Where:** Artists and artist pages
- **Observed:** library.js has declareAlias, declareAliases, planAliases and removeAlias, and the owner's labels.json carries 351 hand-made aliases (東京ブラススタイル → Tokyo Brass Style, シド → SID…). So imports in kana or romaji keep splitting one artist in two, yet app.js calls none of these. The artist page offers Play, Shuffle, Artist radio, Edit all, Focus and Save as playlist, but no 'Same artist as…'. The workaround (Edit all, then type the other name) stores per-song corrections that don't apply to later imports.
- **Why it matters:** Expose the model's capabilities where the problem shows up. Merging duplicate entities belongs on the entity's page.
- **How it was verified:** CODE. grep finds the string "alias" nowhere in app.js, so the page never calls declareAlias, declareAliases, planAliases or removeAlias and never reads lib.aliases. The functions are at library.js:741-783, exported at :1146 and tested at test.js:632-641, 789-796 and 1450. derive() applies artistOf() after labels and corrections (library.js:443-449), so an alias is the only merge that works for every channel and every later import. The artist page actions (app.js:2181-2186) are Play, Shuffle, Artist radio, Edit all, Focus and Save as playlist; headerBlock/moreActions (app.js:1769-1770) put the last three in "More actions". Edit all runs openEditor, then L.editMany, which saves a per-track userEdits.artist (app.js:1730). Settings > Labels (app.js:2928-2940) never mentions or lists aliases. labels.json has 351 aliases (350 survive loading), 995 artist profiles and 1,855 tracks, so the auditor's numbers are right. Nothing in the README or the decided-on-purpose list says aliases stay out of the page; the README even says planAliases exists "for the page to derive in slices".

REAL DATA (Node, library.js + match.js over the owner's untracked export true-shuffle-2026-10-09.json + labels.json; aggregate counts only):
- The labelled library has 996 artists and still contains two same-person splits: Tokyo Jihen / Tokyo Incidents (both profiles have native 東京事変) and Hotaru Shizaki / Hotaru Murasaki (both 紫咲ほたる), 1+1 songs each.
- I simulated importing the same uploads fresh (aliases and profiles kept, per-track labels dropped). Without the alias table, 52 tracks across 37 artist pairs come out under a different spelling of their labelled artist; with the 351 aliases, 14 tracks across 8 pairs still do. Example: 5 of Nanawoakari's 12 songs come from "NANAOAKARI - Topic" (read "NANAOAKARI", confidence 0.95) and 2 from "ナナヲアカリ OFFICIAL" (read "ナナヲアカリ", 0.9); labels.json has no alias for either spelling.
- 84 of the 435 profiles that have a native name have no alias for that name.

BROWSER (drive.mjs, real mode, 1280x860 dark and 390x844 phone, all Google and music hosts blocked, 0 external requests, 0 errors, IndexedDB deleted afterwards):
- I loaded the owner's tracks (no history) and the app applied labels.json (1,855 tracks, 996 artists, 350 aliases). #/artists?f=東京事変 shows two 1-song cards, "Tokyo Incidents" and "Tokyo Jihen" (08-desk-tokyo-jihen.png, 08-desk-hotaru.png, 08-phone-*.png).
- I simulated the next import from "NANAOAKARI - Topic" with L.upsert. It became a new artist "NANAOAKARI · 1 song" next to "Nanawoakari · 10 songs" (02-artists-nana-split.png).
- Its artist page menu holds Edit all, Focus and Save as playlist, with no merge, on desktop and phone (04-more-menu.png, 09-phone-artist-menu.png).
- Workaround: More actions > Edit all opens a 13-field "Edit details" dialog with Artist prefilled; I selected it and typed "Nanawoakari" (11 keys), then Save. That is 3 clicks, 11 keys and Save. The songs merged, but only userEdits {artist:'Nanawoakari'} was stored and no alias (05-edit-all.png).
- The next import from the same channel split again (06-split-again.png).
- I then ran L.planAliases(['NANAOAKARI'],'Nanawoakari') + deriveIds (2 ms + 146 ms; 541 ids planned, 1 changed). A third import was read as "Nanawoakari" (13 songs, no split; 07-alias-holds.png).
- The single-track editor's collapsed "The whole channel > Every track there is by the artist above" does keep that one channel merged (checked in Node). But an upload on her official channel still reads ナナヲアカリ. That rule works per channel only, is offered only when editing one track (if (!many)), and is hidden.

TIMING (owner's library, phone viewport): declareAliases(Tokyo Incidents → Tokyo Jihen) takes 109 ms at 1x CPU and 567 ms at 4x throttle. The editor's existing Save (editMany + resolveArtists) takes 142 ms and 573 ms, so the cost is the same. Once settled, a merge changes only the merged artist's tracks (1 each for the Tokyo and Hotaru pairs), and removeAlias reverts it.

CORRECTIONS TO THE AUDIT:
- The editor does not derive in slices: openEditor's submit runs editMany and resolveArtists synchronously, and app.js never uses knownCollector.
- #/artists has no selection mode, so "a selection on #/artists" would be new scope.
- library.js needs no change.

SEVERITY: medium. Duplicate artist cards, split counts and an artist radio that misses songs are noticeable, and the only in-app fix has to be redone after every import. It is not high: it happens a few times per import, loses no data and a workaround exists.
- **Fix (verified):** 1. app.js viewArtist (actions at 2181-2186): after 'Edit all', add actionBtn('artist', 'Same artist as' + ELL, function () { sameArtistAs(key, a); }). headerBlock puts it in "More actions" automatically (acts.slice(3)).

2. Add sameArtistAs(key, a) beside openEditor (~app.js:1550):
- Open the dialog with U.openDialog({ title: 'Same artist as' + ELL }).
- Text: q(a.name) + ' will be listed under the name you pick, now and for songs imported later.'
- Show up to 5 one-tap suggestions (ts-btn ts-btn--secondary ts-btn--sm, "Tokyo Jihen · 1 song"). First come other idx().artists entries whose lib.profiles[k].native equals a.native, then TS.fuzzy.rankNames(names, a.name, { limit: 5 }) when TS.fuzzy exists. Leave out multi-person credits (L.people(name).length > 1) unless typed.
- Add an input with list 'ts-dl-artists' (build the datalist as the editor's lists() does) and a primary "Merge" button.
- Same normalized name: toast 'That is already this artist.'
- On Merge:
  - Copy lib.aliases into `before`.
  - Run var ids = L.declareAliases(lib, [a.name], target), then changed(ids, true) and d.close().
  - Go to location.hash = link('artist', L.artistOf(lib, target).key), because the old route now shows "No artist here".
  - Show U.toast(q(a.name) + ' is now listed as ' + target + ': ' + plural(a.tracks.length, 'song') + ' moved.', { action: 'Undo', onAction: ... }). Undo restores `before` into lib.aliases in place, then runs L.deriveIds(lib, ids), changed(ids, true) and goes back to link('artist', key).
  - Undo must restore the snapshot rather than call removeAlias, because planAliases re-points earlier aliases (library.js:761-764).
  - The toast counts a.tracks.length, not ids.length: the first merge in a session also re-reads about 159 toss-up tracks.
- Running it synchronously is fine (it costs the same as the editor's Save). If wanted, planAliases + deriveIds in slices of about 100 avoids the 0.5 s task on phones.

3. Settings > Labels (app.js:2928-2940): add "N spellings are listed under another artist" with a <details> list of each lib.aliases entry as 'key → Name' plus a Remove button. Remove runs ids = L.removeAlias(lib, k), then changed(ids, true) and say(...). Extend the panel's sentence: a labels file also carries other spellings of an artist.

4. README.md: document the menu item, the dialog, the Settings list, and that aliases travel in exportLabels (labels file and Desk sync).

Optional: when another artist shares a.native, the artist page shows "Also in your library as Tokyo Jihen. Same artist?", which opens the same dialog.
- **Auditor's original fix:** Add 'Same artist as…' to the artist page's More menu (and to a selection on #/artists). It opens a picker over idx().artists ranked with fuzzy.rankNames, then runs L.planAliases and derives the affected ids in slices as the editor does, then saveMeta, with Undo through removeAlias. List aliases in Settings > Labels with remove buttons.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Risks:** - Wrong merges: ranking can put a collaboration credit ("Nanawoakari & Sou") first. Show song counts and leave out multi-person credits from the suggestions.
- Undo: undo through removeAlias would lose earlier aliases that planAliases re-pointed or overwrote (library.js:761-764). Restore the alias snapshot instead.
- Unrelated changes on the first merge: the first merge after site labels re-settles about 159 toss-up tracks, the same pass the editor's Save already runs via resolveArtists. Write all returned ids but report only the merged artist's songs.
- Profile-derived fields: merged tracks take the target artist's profile (scene, lang, native) and artist-level genres wherever their own labels don't set them. The two Tokyo Jihen profiles disagree, tv versus vn.
- Site labels: a new labels.json version re-applies its aliases. A removed site alias comes back, and a user alias for a spelling the file also maps gets overwritten.
- Desk sync: aliases travel in exportLabels via sync:outbox. Check that the other device applies them.
- Old route: the old artist route empties, hence the redirect to the target artist.

Re-run:
- node misc/101-true-shuffle/test.js (alias checks at test.js:632-641, 789-796, 1450).
- node scripts/qa/smoke.mjs 101-true-shuffle.
- My scratchpad/ux/verify/library-19/split.mjs, adapted to use the menu item: merge NANAOAKARI into Nanawoakari, import again and expect no split; check Undo; check that the Settings list shows the alias and Remove splits it again.
- The focus.mjs and targets.mjs audits on the new dialog: focus ring and 44 px targets on phones.
- **Evidence:**
  - grep: app.js has no call to declareAlias, declareAliases, planAliases, removeAlias or aliases
  - library.js:741-776: the alias functions; labels.json: 351 aliases, 995 artist profiles
  - app.js:2181-2186: the artist page's actions

### library-20 · medium · verified · The mix builder can't show or clear the Liked filter it inherits, and song counts disagree between pages

- **Where:** Mix builder and smart playlists; library counts
- **Observed:** Liked songs > Open in mix builder shows 'Liked or rated 4+.', but there is no rating row, chip or Clear link; only Start over removes it, and the filter can't be chosen when starting a mix from scratch. The Save dialog then says '37 songs now' under a summary of '35 songs', and suggests the name 'My mix'. The library's size also changes from page to page: Home says 157, Songs 160, the Library hub 160, the Mix builder 157, and Your numbers '160 songs, 157 playable'. Only that last one explains the difference.
- **Why it matters:** Every condition a filter applies should be visible and reversible where it is applied. The same set should have the same count everywhere, or the difference should be explained.
- **How it was verified:** I read the code and drove the demo myself. I wrote my own scripts (v1.mjs, v2.mjs in .../verify/library-20/) and used real mouse clicks at 1280x860 dark, plus one tap test at 390x844 mobile. No page errors.

Code (misc/101-true-shuffle/app.js):
- viewMix 2563-2676 has 13 pick rows (Families … Playlists) and 9 limit controls. None of them is bound to draft.minRating or draft.text.
- mixWords 2689 only puts the filter in a sentence. suggestName 2700-2709 ignores minRating and text.
- The summary counts with chosenTracks (129, 2573): the focused scope, without blocked or unplayable songs. createList 3310 counts with S.select(L.list(lib), scopeSelect(...)): the whole library, blocked and unplayable songs included.
- Home 1887/1890 counts playable(ix.music). Songs 2097, the hub 2548 and Your numbers 2746 count ix.music.
- When draft is null, viewMix starts from the current plan (2566). The plan is saved (502) and restored at start-up (5822). Liked > Shuffle (2293 -> shuffleThese) puts minRating:4 into the plan, and Search > Shuffle these (2035) puts text into it.

What I measured:
- Ground truth: 160 songs (no clips), 2 blocked, 1 unplayable, 157 playable. Liked: 37, of which 35 are playable.
- Counts per page: Home '157 songs · 12 artists · 11 h 45 min of music'; Songs '160 songs · 11 h 57 min'; Library hub '160 songs'; Your numbers '160 songs, 157 playable'; Mix builder with no filter '157 songs'; Liked '37 songs'. This matches the audit exactly.
- Liked > Open in mix builder: '35 songs · 2 h 43 min · True shuffle' and 'Liked or rated 4+.'. Of 22 controls, none is about rating; there are 0 Clear links (shots/b-mix-from-liked.png).
- Save as playlist from there: the name is 'My mix' and the dialog says '37 songs now.' while '35 songs' shows behind it (c-save-dialog.png).
- Adding Bright gives 8 songs, and the suggested name becomes 'Bright', which hides the liked condition (Bright alone has 29 songs). Start over is the only way out, and it also drops Bright (back to 157, no chip on).

Paths the audit missed:
- Shuffle Liked songs, then open Mix builder from the sidebar: it opens already filtered to 35 songs with 'Liked or rated 4+.' and no control (e-mix-after-liked-shuffle.png). Because the plan is saved, this also happens on the first visit after a reload.
- Search 'Paper' > Shuffle these > Mix builder: 'Matching "Paper".' with no text field and 0 Clear links (f-mix-after-search-shuffle.png).
- Liked > Save as playlist > Edit filter: the playlist page says 37 songs, the editor says 35. 'Update Liked songs' is there, but the rating condition cannot be changed (g-edit-filter-liked-list.png).
- With Focus on a 29-song 'Bright' playlist, picking Japanese retro shows '2 songs'. The dialog says '10 songs now', and the saved playlist really holds 10: it ignores Focus and the dialog does not say so (h-focus-save-dialog.png).
- On the phone the same sentence shows with no control (i-phone-mix-from-liked.png).

Why medium and not low: the filter is applied silently after a common action (shuffling Liked songs or a search). The only way to remove it also throws away the other picks, and conflicting counts appear on the same screen. Not high: the sentence does name the filter, Start over is one click, and the Mix builder is a secondary page.

I reject part of the audit's fix ('count playable songs everywhere'). The Songs, Liked and playlist pages show the blocked and unplayable rows, tagged, for Rescue and Needs attention, so their headers must count the rows they show. Explain the difference instead.
- **Fix (verified):** All changes are in misc/101-true-shuffle/app.js and use existing classes, so no CSS is needed.

1) viewMix, 'What goes in', after the Roles pickRow (line 2627): add a Rating row bound to draft.minRating. pickRow cannot be reused because it needs an array key, so build a small sibling with the same markup:
- .ts-pickrow > .ts-pick-h with h3 'Rating', plus a .ts-link-btn 'Clear' when draft.minRating > 0 (it sets 0, then renderView(true)).
- .ts-chips with two .ts-chip buttons: 'Liked (4 stars or more)' = 4 and '3 stars or more' = 3. Each gets a .ts-count of ix.all where (t.rating||0) >= v, and aria-pressed.
- On click: draft.minRating = on ? 0 : v (keep it a number), then renderView(true).

2) viewMix Limits, after day('Added on or before') (line 2661): add a field 'Words in the title, artist or anime': h('input', {class:'kit-input', type:'search', placeholder:'any'}), value draft.text, and on 'change' set draft.text = inp.value.trim(); renderView(true). This lets the filter from Search > Shuffle these be seen, edited and cleared.

3) viewMix refresh() (2573-2576): after chosen, add
  var s = selectOf(draft); s.includeBlocked = true; s.includeUnplayable = true; var out = S.select(scopeTracks(), s, now()).length - chosen.length;
and append to the words line: out ? ' ' + plural(out, 'song') + ' left out: blocked or cannot play.' : ''.

4) createList (3310-3311), smart lists:
  var all = S.select(L.list(lib), scopeSelect(data.patch), now()), ok = playable(all).length;
Text: plural(all.length,'song') + ' now' + (ok < all.length ? ', ' + n(ok) + ' of them playable' : '') + (focus && listById(focus) ? ', from your whole library, not only ' + q(listById(focus).name) : '') + '. A smart playlist follows its filter: ...'

5) suggestName (2700-2709):
  var name = bits.filter(Boolean).join(' '); if (p.minRating >= 4) name = name ? name + ' (liked)' : 'Liked mix'; else if (p.minRating > 0) name = (name || 'My mix') + ' (' + p.minRating + '+ stars)'; if (!name && p.text) name = capital(p.text); return name || 'My mix';

6) viewHome hero (1890): count the library the way Songs, the hub and Your numbers do: plural(ix.music.length,'song') ... longTime(secs(ix.music)). Keep var music = playable(ix.music) for dailyMix. Leave the list pages' counts alone.

Add one README line under #/mix: a Rating row (minRating) and a Words field (text).
- **Auditor's original fix:** Add a 'Rating' pick row to viewMix (Liked, 3 stars or more, Unrated) bound to draft.minRating, with Clear. Count playable, unblocked songs everywhere, or say when a count differs ('160 songs, 3 can't play'). Have suggestName add 'Liked' when minRating is 4.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/README.md` · **Effort:** S
- **Risks:** Risk is low: everything is view code in app.js.

Things to watch:
- minRating must stay a number. scopeButtons matches the Liked page's Focus/'Saved' state by S.signature({minRating: 4}), and a string '4' would break that.
- patchOf drops 0 and '', so Clear followed by 'Update <list>' really removes the condition from the saved smart playlist. Check that on purpose.
- The Words field should update on 'change', not 'input', so the page does not re-render on every keystroke.
- refresh() gains one more linear S.select. Re-time #/mix with thousands of songs using the scratchpad perf/big.mjs approach.
- The new row and field must fit at 390 px; the smoke test's mobile pass checks horizontal overflow.
- renderView(true) after a chip loses keyboard focus, as the existing rows already do. Don't make the separate chip-focus problem worse.
- The dialog's whole-library wording must only appear when Focus is on.

No test or repo script asserts the changed strings.

Re-run:
- node misc/101-true-shuffle/test.js
- node scripts/qa/smoke.mjs 101-true-shuffle
- my drive scripts .../verify/library-20/v1.mjs and v2.mjs. Expect:
  - after Liked > Open in mix builder, the Rating chip is pressed
  - Clear keeps Bright
  - the dialog says '37 songs now, 35 of them playable'
  - names are 'Liked mix' and 'Bright (liked)'
  - the Words field shows 'Paper' after Search > Shuffle these
  - the Focus case says 'from your whole library'
- **Evidence:**
  - mix.mjs: 'M7 Liked -> mix builder {summary: 35 songs · 2 h 43 min · True shuffle | Liked or rated 4+., anyRatingControl: false, clears: 0}'; 'M8 save dialog {name: My mix, text: 37 songs now. …}'
  - counts.mjs: {home: '157 songs …', songs: '160 songs …', hub: '160 songs', mix: '157 songs …', stats: '160 songs, 157 playable', liked: '37 songs …', truth: {blocked: 2, unplayable: 1, liked: 37, likedPlayable: 35}}
  - Screenshot: .../library/shots/mix-from-liked.png
  - app.js:2620-2637: no row for minRating; 2689: mixWords describes it; 3310: the dialog counts with scopeSelect, which includes blocked and unplayable songs, while the summary uses chosenTracks (129, 2573); 1890 vs 2099: Home vs Songs; 2700-2709: suggestName ignores minRating

## Unverified findings, by lens

Each of these was reported with evidence by an auditor but has not been reproduced independently yet.

## Lens: first-run

<details><summary>What this auditor covered</summary>

- Lens: first run and onboarding. All runs used the scripts/qa/drive.mjs harness with headless Chrome. In real mode the four Google hosts were always blocked, nothing spent quota, nothing was played on real YouTube, and every real-mode run deleted the true-shuffle IndexedDB at the end. No run logged a page error.
- REAL MODE, empty library, signed out. Desktop 1280x860 (dark, plus light for the welcome and help) and phone 390x844 mobile (dark, plus light). Covered: the welcome; the header help (?); the Keyboard shortcuts dialog (? key); the Ctrl+K palette (default list, then 'sign', 'import', 'demo'); and Settings, scrolled section by section. Settings was checked with the site's own client id and with no client id (simulated in-page with auth.setClientId('')).
- Every main route, empty, on both devices: #/ #/songs #/artists #/channels #/genres #/browse #/works #/map #/for-you (lanes left to settle: 8.1 s on desktop, 7.3 s on phone) #/lists #/liked #/mix #/history #/wrapped #/quiz #/duel #/stats #/label #/fix #/rescue #/settings #/explore/abcdefghijk #/explore/anything #/library #/search?q=love #/people #/discover #/car #/lyrics #/paste #/share. Contact sheet: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/sheets/empty-d.png. Logs: tour-desktop.txt and tour-phone.txt.
- Pressing play with nothing to play. Recorded the enabled/disabled state of every player-bar control. Tried the poster; the keys Space, N, P, S, R, L, E, Shift+R and M; the reshuffle, repeat and bar More buttons; the palette's actions; Play on Liked songs; and New smart playlist. Feedback was captured with a toast observer plus the status line. Also covered: car mode's Start/Next/Previous/New songs, and the phone's mini player and Queue sheet.
- The welcome's 'Sign in or import a file' path. Measured where things are and how many tab stops away. Fed a foreign JSON, a CSV and a TXT to Restore from a file and to Apply a labels file. Read a YouTube link and an 'Artist - Title' line on #/paste (oEmbed only).
- The size buttons overlapping the now-playing hint, at 1100, 1280 and 1440 px wide (2x crops).
- DEMO (?demo=1). Covered: first impression on desktop (dark and light) and phone; the banner's position after scrolling; Leave the demo (desktop click, and its hit area on the phone); and time to first sound. Measured: app ready in 596-674 ms; the mock clock starts moving 271-283 ms after Play. Also: the full route tour inside the demo; For you lanes in the demo (offline, settled in about 1.6 s); pressing a 'Find on YouTube' found song and 'Play them'; the quiz; and focus in the Map language-model dialog.
- Network in real mode: For you contacted api.animethemes.moe, graphql.anilist.co and s4.anilist.co; Paste contacted www.youtube.com (oEmbed) and i.ytimg.com. The demo contacted nothing.
- Not exercised: the real Google sign-in and import (blocked by the rules), real YouTube playback, actual screen-reader speech (focus and ARIA were checked in the DOM only), Android hardware and a car.
- All scripts, logs and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/ (screenshots in shots/ and demo-shots/).

</details>

### first-run-1 · high · 'Sign in with Google' is a dead end for every visitor except the owner, and the page never says so

- **Where:** Onboarding: sign-in (welcome, Settings > YouTube, help)
- **Observed:** Real mode, empty library, signed out, desktop and phone. Three things send every newcomer to Settings > YouTube: the welcome's second button ('Sign in or import a file'), the now-panel hint and the help ('Sign in under Settings, import your lists'). There the primary action is an enabled 'Sign in with Google': auth.configured() is true because config.js carries the owner's client id.

That client only admits the owner's listed test users. README.md:1843 says anyone else gets 'Access blocked', and toy.json's card note says 'Signing in works for the owner's Google account; anyone else brings a Google client id of their own'. The page itself says none of this. With a client id configured, no text about test users, the owner or bringing your own id is shown. The six steps for setting up your own client id render only when no client id is configured (app.js:2831). So a visitor sees a bare 'Client id (this browser only)' field with a placeholder and no explanation, presses Sign in, and per the README lands on Google's refusal with no way back but the browser's Back button. That last step was not exercised: accounts.google.com is blocked by the audit rules.

When the steps do show (no client id, simulated), they are hard to act on:
- 297 words, 1,013 px tall on desktop and 1,655 px on the phone.
- No links: console.cloud.google.com is plain text.
- No copy buttons for the origin and redirect URI, which must match 'exactly, with the final slash'.
- The disabled Sign in button sits 1,018 px down (1,589 px on the phone) with no reason beside it.
- **Why it matters:** Prevent errors before an irreversible step (Nielsen heuristic 5), and set expectations. Never send someone into an outside flow that is documented to fail for them.
- **Proposed fix:** In app.js viewSettings (2830-2890), handle the case where the client id in use is the site's own (TS.config.clientId is set and ToyKit has no 'clientId'):
- Above the button, add one sentence: 'Signing in on this site works for its owner's Google account. To read your own playlists, use a free Google client id of your own (about 5 minutes).'
- Below it, add a <details> 'Use your own client id' that holds the six steps. Render the steps in both states, and open the details by default when !configured.
- Make console.cloud.google.com a link. Step 2 can deep-link to console.cloud.google.com/apis/library/youtube.googleapis.com.
- Add Copy buttons beside the origin and the redirect URI (auth.redirectUri()).
- Move the Client id field directly under step 5.
- When Sign in is disabled, show the reason next to it ('Paste a client id above first').

Say the same thing in one line on the welcome (noMusic, app.js:1868-1873) and in the help template (index.html:138).
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/empty-play.txt: config {configured:true, signedIn:false}
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/settings-path.txt: setupNote false. The YouTube card text has no word about the owner or test users.
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/d-settings.png and shots/p-settings.png: the card a visitor sees
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/noclient.txt, shots/nc-d-0.png, shots/nc-d-1.png: no-client-id state with cardWords 297, links [], copyButtons 0, signInDisabled true, signInTop 1018 (desktop) and 1589 (phone)
  - README.md:1825 ('The owner's own client only admits the test users he listed') and README.md:1843 ('Anyone not on the test-user list gets "Access blocked" instead'); toy.json 'note'
  - app.js:2830-2838: the steps render only when !configured. app.js:2842: the Client id label has no explanation. app.js:2887: the Sign in button. index.html:138: the help text.

### first-run-2 · high · The ? shortcuts dialog (and 7 other dialogs) never takes focus: Escape does nothing and Tab moves through the page behind it

- **Where:** Accessibility: modal dialogs (ui.js openDialog)
- **Observed:** Pressed ? on the welcome; the help and the shortcuts table both advertise this key. 'Keyboard shortcuts' opens as an aria-modal dialog, but focus stays on the page's H1 behind it. Two presses of Escape leave it open. Tab moves to 'Try the demo' behind the modal (to the 'Shuffle everything' quick start in the demo). Only the mouse X closes it. The demo's 'Map with a language model?' dialog behaves the same: focus stays on BODY and Escape is ignored.

Cause: ui.js openDialog (332-366) attaches the Escape handler and the Tab trap to the dialog box's own keydown, but never moves focus into the box and never makes the rest of the page inert. showShortcuts (app.js:4856-4862) focuses nothing.

A code scan of the 20 openDialog callers found 8 that set no initial focus:
- app.js:1402 Trim and volume
- app.js:4042 Map with a language model
- app.js:4857 Keyboard shortcuts
- app.js:4916 'Restore this backup?', a destructive confirm opened by dropping a file
- app.js:5019, explore.js:333 and foryou.js:954, album dialogs
- foryou.js:1220 Hidden from suggestions
- **Why it matters:** Follow the WAI-ARIA modal dialog pattern and WCAG 2.1.1 (Keyboard) and 2.4.3 (Focus Order): focus moves into the modal when it opens, Escape closes it, the background is inert, and focus returns to where it was on close.
- **Proposed fix:** Fix it once, in ui.js openDialog:
- After appending, focus opts.initialFocus if given; else the first field or primary button in the body; else the box itself (give the box tabindex=-1).
- While dialogs.length > 0, set inert on the kit header and on #app except the YouTube player box, which must stay visible and usable. Clear it in close().
- Also listen for Escape on document while a dialog is open, so it works even if focus has left the box.

showShortcuts and the other seven callers then behave correctly with no changes of their own.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/keysdlg.txt: 'after ?' open with active H1; 'after Escape' and 'after 2nd Escape' still open; 'after Tab' active = 'Try the demo' (real) or the Shuffle everything quick button (demo); only 'after X' is it closed
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/lmdlg.txt: 'Map with a language model?' still open after Escape, active BODY
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/e-keys.png
  - ui.js:332-366 (no initial focus, no inert); app.js:4856-4862 (showShortcuts)

### first-run-3 · medium · Nine pages show the home welcome word for word when the library is empty, so navigating seems to do nothing

- **Where:** Empty states: library routes and search
- **Observed:** Real mode, empty library. These routes all render noMusic() (app.js:1864): #/songs, #/artists, #/genres, #/browse, #/works, #/mix, #/stats, #/fix and #/search?q=aimer. On every one, its h1 'Your playlists, as a music app' becomes the document title ('Your playlists, as a music app · True Shuffle'). Three effects:
- On desktop the sidebar lights 'Songs' or 'Search' while the content is Home's. On the phone the Library tab lights over Home's hero.
- A search for 'aimer' keeps the query in the box, but the page never mentions it.
- renderView moves focus to that h1 (app.js:779-782), so a screen reader announces an identical page on all nine routes.
- **Why it matters:** Visibility of system status: every destination should confirm where the person is, with its own title.
- **Proposed fix:** Give noMusic a page identity: noMusic(view, { title: 'Songs', line: 'No songs yet: your playlists appear here once they are imported.' }). It renders that h1, so document.title follows, then the line and the same buttons. Pass the options from each of the nine callers. For search, render h1 'Results for "aimer"' and 'Your library is empty, so there is nothing to search yet', with Paste a list and Try the demo as the actions.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/tour-desktop.txt and tour-phone.txt: same h1 and title on all nine routes
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/d-songs.png: Songs is lit in the sidebar under Home's hero
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/phone-bits.txt: lit tab is 'Library' or 'Search', h1 is the welcome's
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/search-val.txt: the box keeps 'aimer', the h1 stays the welcome (the demo shows 'Results for "aimer"')
  - Call sites: app.js:2008 viewSearch, 2084 viewBrowse, 2095 viewSongs, 2136 viewArtists, 2214 viewGenres, 2352 viewWorks, 2565 viewMix, 2741 viewStats, 2776 viewFix

### first-run-4 · medium · The other empty pages are dead ends, inconsistent, and some say the wrong thing

- **Where:** Empty states: remaining routes
- **Observed:** Real mode, empty library, the remaining routes on both devices.

Dead ends:
- History, Your year, Channels, Songs gone from YouTube, Voice actors, Explore/<id>, Map and Share have no action at all.
- Rank your songs and For you's radio lane offer 'Open Settings'.
- Guess the anime offers Quick labeller and 'Anime, games & stage'. Both are dead ends here: the labeller claims every song is labelled, and works shows the welcome.
- No page except the nine welcome copies offers the demo.

Inconsistent look: Channels, Duel, Explore, For you, Liked, Quiz, Share and Wrapped have coloured hero headers. History, Label, Lists, People and Rescue have a plain h1. Map has no heading at all, so the tab title stays 'True Shuffle' and focus is not moved.

Wrong copy:
- Quick labeller says 'Every song here has labels' with zero songs, and offers 'Start over with what is left' (app.js:3564-3565).
- The Library hub says 'Needs attention: All good' (app.js:2553).
- Explore says 'This song is not known here any more' for an id that was never known (explore.js:533).
- Liked songs draws an empty table header under live Play and Shuffle buttons that toast 'Nothing playable here.'
- Playlists' 'New smart playlist' jumps to #/mix, which shows the welcome (app.js:3402, then 2565).
- **Why it matters:** Consistency and standards. An empty state should say why it is empty and offer the next step.
- **Proposed fix:** Add one helper, emptyLibrary(view, { title, line }), in app.js and expose it on pageCtx. It renders the same h1 style, one sentence saying why the page is empty, and two buttons: [Try the demo] and [Get your music], which opens Settings at the account panel. Use it from channel.js:557, rescue.js:511, wrapped.js:544, explore.js:533, quiz.js drawEmpty (1196), duel.js, and the History, People and Map views whenever L.list(lib) is empty.

Copy fixes:
- viewLabel: 'No songs to label yet' when the library is empty, without the Start over button.
- viewLibrary: hide 'Needs attention' when there are no songs.
- Explore: 'This link points to a song that is not in your library', plus an 'Open For you' button.
- viewMap: add an h1 'Map'.
- viewLists: hide 'New smart playlist' until there are songs.
- viewLiked: drop the empty table header when there are 0 songs.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/explore.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/channel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/rescue.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/wrapped.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/tour-desktop.txt: ACTIONS(0) on #/channels, #/map, #/history, #/wrapped, #/rescue, #/people, #/explore/*, #/share
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/sheets/empty-d.png: contact sheet of 21 empty routes
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/d-label.png, d-map.png, d-liked.png, d-quiz.png, p-library.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/empty-play2.txt: 'lists New smart' ends on hash #/mix (the welcome); 'liked Play' toasts 'Nothing playable here.'
  - app.js:3564-3565, 2553, 3402, 3714 (map: a <p> only, no h1); explore.js:533; channel.js:557; rescue.js:511; wrapped.js:544; app.js:3494 (history); app.js:5634 (people)

### first-run-5 · medium · With nothing to play, the big Play on the player and Space do nothing, while Shuffle again announces 'Shuffled again.'

- **Where:** Player: the first press with an empty library
- **Observed:** Real mode, empty library. The poster is the white 64 px Play circle on the player, labelled 'Nothing to play yet', and the most prominent control in the right panel. It is an enabled button wired to togglePlay (app.js:5754), which returns silently when the library is empty (app.js:866).

No toast and no status line for any of these: the poster; the keys Space, N, P, R (radio), L and E; and the palette's 'Shuffle everything', 'Like the playing song' and 'Start radio' (shuffleThese returns at app.js:533). Misleading or false feedback:
- S and the Shuffle again button toast 'Shuffled again.' when there is nothing to shuffle: reshuffle calls applyPlan({ say: 'Shuffled again.' }), app.js:882-893.
- Shift+R toggles 'Repeat on: the queue starts again when it ends.'

The bar's Play is disabled (app.js:822), but the poster, Shuffle again and Repeat stay enabled. Car mode handles the same press well: 'Nothing to play yet: import your playlists in Settings first.'
- **Why it matters:** Feedback, and no false success messages. Controls that cannot act should look and behave alike.
- **Proposed fix:** Add noMusicHint(), which calls U.toast('No music yet.', { action: 'Try the demo', onAction: function () { location.href = '?demo=1'; } }), with wording like car mode's. Call it from togglePlay, shuffleThese and reshuffle when !L.list(lib).length; the key handlers go through these, so they get it too. In renderTransport also disable btn-reshuffle and btn-repeat, as btn-toggle already is. In renderPoster's empty branch, set the poster to aria-disabled, hide .ts-poster-play, and show 'No music yet' with a real 'Try the demo' link, instead of a play glyph that does nothing.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/empty-play2.txt: poster, Space, n, p, l, e, palette Shuffle everything and Like all have status ''; s and reshuffle give 'Shuffled again.'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/empty-play.txt BAR line: poster enabled, btn-toggle DISABLED, btn-reshuffle and btn-repeat enabled
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/car-start.txt: car mode's Start explains itself
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/d-home.png: the poster's Play
  - app.js:861-875 togglePlay, 532-538 shuffleThese, 882-893 reshuffle, 813-828 renderTransport, 846-852 renderPoster, 5754 poster wiring

### first-run-6 · medium · The first-run hint under the video is covered by the player-size buttons at every desktop width, and it is not clickable

- **Where:** Now-playing panel: empty state
- **Observed:** At 1100, 1280 and 1440 px wide, the S/M/L/theater/full-screen row sits on top of 'No music yet. Try the demo, or sign in under Settings.', and 'the demo, or sign in under' is unreadable.

Cause: on wide windows, .ts-vbar has margin-bottom: -40px and z-index: 2 (app.css:1062), which pulls the row over the first line of #nowinfo. With a song, that first line is the short 'Now playing' kicker, so the row shares it by design. In the empty state it is the full-width .ts-now-empty paragraph (app.css:212, app.js:974).

The same sentence is plain text, not links, both here and in the phone's Queue sheet. That sheet is one of the five phone tabs, and on first run it otherwise shows only a disabled transport and 'The queue is empty.'
- **Why it matters:** Text must never sit under controls. A hint that names an action should be that action.
- **Proposed fix:** In renderNowInfo's empty branch (app.js:972-975), first append a kicker <p class="ts-kicker">Not playing</p>, so the size row shares that line exactly as it does for a track. Alternatively, in app.css add @media (min-width: 761px) { .ts-now-empty { margin-top: 34px; } }. Render 'Try the demo' as <a href="?demo=1"> and 'Settings' as <a href="#/settings"> in that sentence.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/overlap.txt: overlapsVbar true at 1100, 1280 and 1440 (vbar 944,280,316x38 against text 948,306,308x42 at 1280)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/ov-real.png (2x crop of the overlap)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/pe-queue.png (phone sheet, plain text)
  - app.css:1062, app.css:212, app.js:972-975

### first-run-7 · medium · 'Sign in or import a file' lands on a card that leads with three developer fields, and the file import only takes the app's own backups

- **Where:** Onboarding: Settings > YouTube hierarchy and the 'import a file' promise
- **Observed:** The welcome's second button opens Settings at the top. Before 'Sign in with Google', the YouTube card shows:
- three inputs, each with its own Use button: Client id, YouTube API key, Last.fm API key;
- a 75-word paragraph about Google Cloud credentials that ends 'A key is in use (config.js)'.

That puts Sign in 15 tab stops into the view. On the phone it is at y=818, in a 670 px visible area. 'YouTube quota used today: 0 of 10,000 units' follows it, and 'Apply a labels file' is a second primary-blue button one screen lower, even with 0 songs (shots/set-p-1.png shows both blue buttons together).

The 'import a file' half of the button means Backup > 'Restore from a file', 1,516 px down on desktop and 2,106 px on the phone. It refuses anything but a True Shuffle export:
- playlist.json: 'This file is not a True Shuffle export.'
- .csv and .txt: 'That file is not JSON, so nothing was changed.'

None of these messages points to Paste a list, which would accept such lines and links.
- **Why it matters:** Progressive disclosure, one primary action per screen, and labels that match what they lead to.
- **Proposed fix:** In viewSettings, reorder the YouTube card: a status line plus Sign in (or Disconnect) first. Move Client id, API key, Last.fm key and the quota line into a <details> 'Advanced: your own Google project and keys'. Open it when !configured or when a value is stored in this browser; it can hold the own-client-id steps from the first finding. Drop '(config.js)' from visible copy, and make 'Apply a labels file' secondary while the library is empty.

On the welcome (app.js:1871), make the button 'Sign in with YouTube' (to #/settings, focusing the account panel), and add a quieter 'Restore a backup' link that scrolls to set-backup.

In importFile's refusal (and readJson's for non-JSON), add a toast action 'Paste a list instead' that goes to #/paste.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/settings-path.txt: tabsInViewToSignIn 15; phone signIn top 818 with mainVisibleH 670; restore top 1516 (desktop) and 2106 (phone)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/import-file.txt: the three refusals
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/set-p-0.png, set-p-1.png, set-d-0.png, set-d-1.png
  - app.js:2839-2890 (card order), 2885 ('(config.js)'), 2937 (labels button is primary), 2954 (Restore), 1871 (welcome button label)

### first-run-8 · medium · Paste a list, the one free way to play your own links without an account, opens only with Ctrl+K and can't be reached on a phone

- **Where:** Onboarding: listening without signing in
- **Observed:** Real mode, signed out. #/paste reads a YouTube link through oEmbed (no key, no quota) and offers Play, Play all and Add all to the queue: tested, it read the link in under 4 s. 'Artist - Title' lines show Play with a cost badge of 100 (aria 'Play, uses 100 YouTube units').

Its only entry point is the palette action 'Paste a list of songs' (app.js:4813). The palette opens only on Ctrl/Cmd+K (app.js:5694), so there is no button, menu item or link to it anywhere, and no way at all on a touch screen. The welcome offers only the demo and sign-in, and the file-import refusals don't mention it.

Copy slip on that page: '2 songs: 1 of them are looked up on YouTube' (share.js:272).
- **Why it matters:** Offer a low-commitment first step, and keep features discoverable without a keyboard (recognition rather than recall).
- **Proposed fix:** In noMusic (app.js:1864), add a third, quieter line: 'Have YouTube links? Paste them and play them now, no account needed', linking to #/paste. Add 'Paste a list' to the Library hub (viewLibrary, app.js:2544) and to the queue's More menu (#btn-queue-more), so phones can reach it. Fix share.js:272 to read '1 of them is'.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/share.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/paste.txt: link read, buttons Play all, Add all to the queue and Play; hosts www.youtube.com and i.ytimg.com only
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/paste-read.png
  - grep: '#/paste' is set only at app.js:4813 (palette ACTIONS); openPalette is called only from the Ctrl+K handler at app.js:5694
  - share.js:272 ('1 of them are looked up')

### first-run-9 · medium · In the demo, Guess the anime can't be played, and 13 'Find on YouTube' buttons only refuse after the press

- **Where:** Demo: what a newcomer tries first
- **Observed:** Demo, Guess the anime (#/quiz), a sidebar and Library hub item: it shows 'Not enough to play yet. Here: 10 such songs, all from Kumori Station Anime.' Its two buttons are dead ends in the demo: the primary 'Quick labeller' answers 'Every song here has labels', and imports are switched off. demo.js:206 gives OP/ED roles to only one work. Even with four works the quiz could not run, because its clips come from iTunes and the invented songs have none (quiz.js:1193).

Demo, For you: 13 found songs (10 in Airing today, 3 in Missing from your series) carry a 'YouTube' button. Its aria label is 'Find Prism Horizon on YouTube' and its title 'Search YouTube in a new tab (finding songs here needs a sign-in or an API key)'. Pressing one opens nothing and toasts 'The demo cannot search YouTube.' 'Play them' toasts 'The demo cannot search YouTube, so its invented songs do not play.' Cause: media.js cost() returns 'tab' because the demo cannot read YouTube, so the button promises a new tab that the demo then refuses (app.js:4362, 4483; foryou.js:362, 679).
- **Why it matters:** A demo should only show what it can do, or say plainly up front what it can't. Don't offer actions that are known to be refused.
- **Proposed fix:** In quiz.js, when cx.demo, replace drawEmpty with a short note: 'The quiz plays 30-second clips from Apple's iTunes. The demo's songs are invented, so try it with your own library.' Drop the labeller button there; optionally show one silent sample round so the flow is visible.

In media.js cost(), return a 'demo' state when ctx.demo and the item has no video. Render it as a disabled Play with the title 'Invented song: not playable in the demo', not as a 'YouTube' button that promises a new tab.

In foryou.js, give the Airing today and Missing from your series lanes a sub line in the demo: 'Invented songs: they show what this lane looks like.'
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/media.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/foryou.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/demo.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/demo-shots/demo-d-quiz.png and tour-demo.txt (quiz and label text)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/demo-find.txt: per lane airing 10, series 3; after the press, nothing opened and the status says 'The demo cannot search YouTube.'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/empty-play2.txt (demo part): the toasts for the press and for Play them
  - quiz.js:1193 and 1196-1211 (drawEmpty); demo.js:206; media.js:264-274 (cost) and 540-546 (button); app.js:4362, 4483; foryou.js:362, 679

### first-run-10 · low · The demo banner scrolls away, its wording is muddled, and 'Leave the demo' is a 17 px target on a phone

- **Where:** Demo: banner and exit
- **Observed:** #demo-banner is position: static at the top of #main: 36 px tall on desktop, 55 px on the phone. After 600 px of scrolling it is at y=-542, and on the phone nothing visible says 'demo' until something plays and the video tag appears.

The text reads 'Demo. Demo library: every artist, track and playlist here is invented, and nothing is played.' Problems:
- 'Demo' appears twice.
- 'nothing is played' while the mock clock runs and the poster says 'Press play (demo, no sound)'.
- It doesn't say that nothing is kept; Settings does ('nothing you do is kept').

'Leave the demo' measures 92x17 px. On a coarse pointer, elementFromPoint finds the link only within ±6 px of its centre, outside the app's ~44 px touch-target rule in ds.css.

On a first visit, Home's quick starts include 'Continue Winter Satellite', and the bar holds a pre-queued, liked, five-star song, although nothing has played (app.js:1903-1907).
- **Why it matters:** Mode indicators should stay visible, and exits should be easy to hit.
- **Proposed fix:** In app.css (535), make .ts-demo position: sticky; top: 0 inside #main, or add a small 'Demo' chip beside the brand in the header that links to './'. Reword the banner (demo.js LABEL or index.html:47): 'Demo: invented songs that play silently (only the clock moves); nothing you do here is kept. Leave the demo'. Give the link a ≥44 px hit area on coarse pointers (padding: 12px 4px; margin: -12px -4px, or the ds.css hit-area rule). In viewHome, show 'Continue' only after a play this session.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.css`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/demo.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/demo.txt: bannerSticky static; 'banner after scrolling 600: y,h=-542,36' (desktop) and '-548,55' (phone); the view text includes 'Continue'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/phone-bits.txt: Leave the demo box 203,81,92x17, hits only at -6..+6 px
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/demo-p-scrolled.png, pb-demo-banner.png, demo-d-first.png
  - index.html:47; app.css:535 (.ts-demo); app.js:1903-1907 (Continue)

### first-run-11 · low · The Ctrl+K palette can't take a newcomer anywhere useful, and its list starts with actions that do nothing

- **Where:** Navigation: command palette on first run
- **Observed:** Real mode, empty library. Ctrl+K 'Go to or do anything' opens with 14 entries: Shuffle everything, Change the shuffle order, Play or pause, Next song, Theater mode, Full screen, Mini player, Like the playing song, Mute or unmute, Start radio from the playing song, Explore the playing song, 'Leave focus' (marked 'not focused'), Save the queue as a playlist, Share the queue as a link. With an empty library these are all no-ops, and Shuffle everything, Like and Start radio don't even answer.

Typing 'sign' finds only 'Start radio from the playing song' and 'Lyrics of the playing song'. 'import' and 'demo' find 'Nothing matches.'
- **Why it matters:** Match the system to the user's current state, and offer the next step where people look for it.
- **Proposed fix:** In ACTIONS() (app.js:4796), add 'Sign in with Google' (signIn), 'Import my playlists' and 'Restore a backup' (to the Settings sections), 'Try the demo' and, in the demo, 'Leave the demo'. When !L.list(lib).length, filter out the playback and queue actions, or sort them last, and drop 'Leave focus' when not focused.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/keysdlg.txt: real palette text, and the 'sign', 'import' and 'demo' results
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/empty-play2.txt: palette actions with status ''
  - app.js:4796-4819 (ACTIONS), 4781-4784 (entries)

### first-run-12 · low · The welcome's privacy line is wrong: For you contacts three outside hosts as soon as it opens

- **Where:** Onboarding copy: privacy promise
- **Observed:** The welcome says 'Nothing is contacted until you press Sign in or Play.' (app.js:1873). Opening For you, a sidebar item and a phone tab, without pressing anything contacted api.animethemes.moe, graphql.anilist.co and s4.anilist.co. Settings' own privacy text is accurate ('asks other services only for what you open (Explore, For you, ...)', app.js:2997), as is README.md:97.
- **Why it matters:** Trust: privacy statements must be exactly true.
- **Proposed fix:** Change app.js:1873 to: 'Nothing leaves this browser until you sign in, press Play, or open a page that looks music up (For you, Explore). Then only artist, song and anime names go to those services.'
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/foryou.txt: HOSTS ['api.animethemes.moe','graphql.anilist.co','s4.anilist.co'] with no press
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/tour-desktop.txt last lines (HOSTS)
  - app.js:1873 (welcome) against app.js:2997 (Settings)

### first-run-13 · low · For you on an empty library ends in six stacked 'nothing yet' lanes

- **Where:** For you: first run
- **Observed:** Real mode, empty library. This season's anime and Airing today fill in, but the radio lane above them is unavailable ('import a playlist first'), and below them six lanes are empty in a row: Missing from your series, New releases from your artists, New from your channels, Because you play your favourites, Saved for later, Hidden. They take 120-150 px each, about 770 px of headings, source badges and 'not yet' sentences. The jump chips at the top still offer Your series, New releases, Your channels, Because you play and Saved.
- **Why it matters:** Avoid stacks of empty containers: summarise what will appear and when.
- **Proposed fix:** In foryou.js, when L.list(lib) is empty (or on first run), fold the series, releases, channels and because lanes into one line: 'These fill in as you listen: the songs missing from your series, new releases, your channels, artists like your favourites.' Hide their jump chips. Show Saved for later and Hidden only once they hold something.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/foryou.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/foryou.txt: lane states and heights
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/fy-d-6.png, fy-p-*.png

### first-run-14 · low · The help is a 732-word reference with one sentence on getting started, and '?' means two different things

- **Where:** Help and shortcuts
- **Observed:** The header ? opens the help: 732 words, 2.2 screens on desktop and 3.3 on the phone (scrollHeight 2192 over 661). Getting started is a single sentence: 'Sign in under Settings, import your lists, then browse and listen like in any music app.' It says nothing about who can sign in, Paste a list, or For you working without an account. The Keys section repeats the shortcut table as one paragraph. Pressing the ? key opens a different dialog, Keyboard shortcuts.
- **Why it matters:** Help should lead with the task a newcomer has, and stay short.
- **Proposed fix:** In index.html's help-template, open with 'Getting started' as three numbered lines: try the demo; sign in (this site's owner) or use your own client id (link to Settings); paste YouTube links (link to #/paste). Replace the Keys paragraph with a button 'All keyboard shortcuts (?)' that calls showShortcuts. Put 'In the car' and 'What this page stores' in <details>.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/light-help.txt: words 732; screens 2.2 (desktop) and 3.3 (phone)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/e-help.png, lh-pl-help.png
  - index.html:137-154 (help template)

### first-run-15 · low · Settings shows every visitor the owner's private Desk sync

- **Where:** Settings: owner-only sections
- **Observed:** Settings' second section, 'Sync between devices', is also the second jump chip. It speaks of 'the Desk', 'your private repository' and pushing and pulling, and links 'Open the Desk' to ../../desk/#/music, the site owner's own tool. A newcomer with an empty library sees it on their first visit to Settings, between Labels and Backup.
- **Why it matters:** Show only what applies to this person (aesthetic and minimalist design).
- **Proposed fix:** In viewSettings (app.js:2941), render the Sync section and its chip only when sync has been used: a sync:inbox was ever merged (remember a flag in checkInbox) or the Desk is known to this browser. Otherwise leave it out, or fold it into a closed <details> 'For the site's owner'.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/first-run/shots/set-d-1.png
  - app.js:2941-2943

## Lens: listening-desktop

<details><summary>What this auditor covered</summary>

- Lens: the core listening experience on a desktop, demo mode (?demo=1, with &speed=50 and at normal speed), headless Chrome via scripts/qa/drive.mjs. Repo left untouched (git status same as at start).
- Window sizes: 1280x860, 1000x700, 1920x1080 (all asked), plus 1366x768, 1440x900, 1536x864 for Up next visibility. Dark theme throughout; light theme for the bar's toggle states.
- Routes: #/ (home), #/songs, #/artists, #/artist/paperlanterns, #/track/<id>, #/explore/<id> (via E); For you's New songs dial (foryou.js) and car.js read in code only.
- Bar: Play/Pause, Previous, Next, the order pill and its menu (all 10 orders, both options, Mix builder), Shuffle again, Repeat, Like, Mute and volume (slider, wheel, keys), the More menu (every item, at 1280 and 1000 wide), the Queue toggle, the speed badge, tooltips and accessible names checked against actions.js KEYMAP.
- Every KEYMAP key pressed with the focus on the page: Ctrl+K, Space, N, P (fast and normal speed), S, O, E, R, Shift+R, L, B, M, -, =, Left, Right, T, F, W (the mini player is not supported in this headless run, so W did nothing; not judged), Q, I, /, ?. The same keys again after mouse clicks on bar buttons, the seek bar and the volume slider.
- Seek bar: hover time tip, drag from 20% to 75%, click, keyboard (Left/Right, PageUp, End).
- Now-playing panel: S/M/L, theater, full screen, Q fold; title, artist, chips, stars, the five action icons; the tabs Up next, Played, Explore, Lyrics; how far down Up next starts at each size.
- Queue editing: click a later row, then P; drag a grip; grip Up/Down and Delete; the X; Played > Play next; Clear and Undo; Save as playlist; the queue's More; where keyboard focus goes after each.
- Songs queued by hand (Play next / Add to queue from a row's right-click menu) against S, a new order, the Keep-apart option, and S in list order.
- Radio: R, the panel's radio icon, Endless at the end of a list (button vs N), S during a radio, the order menu during a radio, a found song playing (its stars, B, I, the pencil).
- Playback extras: sleep timer (15 minutes; the menu, the dot), speed 1.25x, Trim and volume (Save, Enter, the slider's look), fades vs the volume keys, mute and then '='.
- Not covered: real YouTube playback and real mode with a signed-in library (no quota spent), the mini player window, phone layouts (another lens).
- Scripts: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/s01-first.mjs to s19-focus-loss.mjs. Screenshots (53): the shots folder next to them.

</details>

### listening-desktop-2 · high · Space repeats the last bar button clicked instead of playing or pausing

- **Where:** Keyboard shortcuts / player bar
- **Observed:** After a mouse click on a bar button the focus stays on it, and wireKeys lets Space through to any focused BUTTON. Clicking Next and then pressing Space to pause skipped another song. Clicking the heart and then Space un-liked the song and reset its rating from 5 to 0. Clicking Shuffle again and then Space reshuffled a second time, and playback stayed paused. Left and Right (10 s seek) do nothing at all while a button has focus.
- **Why it matters:** Space is the universal play/pause key in media players. A shortcut must not depend on where the last mouse click left the focus (consistency, error prevention).
- **Proposed fix:** Keep native button behaviour for keyboard users, but drop the focus after mouse clicks. In wireShell add `$('bar').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && e.detail > 0) b.blur(); })` (e.detail is 0 when a button is activated from the keyboard), and do the same for #vbar, .ts-now-actions and .ts-stars. Let Left/Right seek unless the focused element uses arrows itself (tabs, grips, menus and rows already call preventDefault).
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s04-trim-space.mjs 'click Next, then Space': demo-113 -> demo-146 (index 1 -> 2), still playing
  - 'click Like, then Space': rating 5 -> 0, focus still on btn-like
  - 'click Shuffle again, then Space': up next demo-107,... -> demo-038,..., state stayed 'paused'
  - 'focus on Play, ArrowRight': time 1 -> 1 (no seek)
  - app.js:5702 `if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return;` and app.js:5722 `tag !== 'BUTTON'`

### listening-desktop-3 · high · After one click on the seek bar or volume slider, Space and every letter shortcut stop working

- **Where:** Keyboard shortcuts / seek bar / volume
- **Observed:** A click on the seek bar or the volume slider leaves the focus on the range input. wireKeys treats any INPUT as a text field and returns early, so Space, N, M, Q, L and the other shortcuts do nothing until the listener clicks somewhere else. With the focus on the seek bar, Right moves 1 s (the page-wide Right moves 10 s), PageUp jumps about 40 s, and End jumps to the end of the song.
- **Why it matters:** Shortcuts should work everywhere except in text entry, and the same key should move the same amount everywhere.
- **Proposed fix:** At app.js:5698, return only for text entry: `var typing = tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable || (tag === 'INPUT' && !/^(range|checkbox|radio|button)$/i.test(e.target.type));`. Give #seek and #st-seek a keydown handler: Left/Right +-10 s (matching the page-wide keys), PageUp/PageDown +-30 s, Home to 0, and swallow End; call preventDefault. Optionally blur the range on pointerup.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html` · **Effort:** S
- **Evidence:**
  - s14-range-focus.mjs: focus on #seek: Space, n, m, q, l -> 'nothing happened'; ArrowRight t 190 -> 191. Focus on #vol: the same five keys do nothing; ArrowRight vol 62 -> 63
  - s04-trim-space.mjs, seek bar focused: ArrowRight 1 -> 2, PageUp -> 41, End -> 391 (the end of the song)
  - app.js:5698 `/^(INPUT|TEXTAREA|SELECT)$/.test(tag)` also returns for type=range; index.html:117 #seek has step=1

### listening-desktop-4 · high · Shuffle again and changing the order silently drop songs queued with Play next / Add to queue

- **Where:** Queue / shuffle modes
- **Observed:** I queued two songs from a row's right-click menu (Play next, Add to queue), and both showed first in Up next. Pressing S (Shuffle again) in a true shuffle removed both. So did picking Spread artists in the order menu, toggling 'Keep songs of one anime or game apart' (the One version option takes the same path), and S in Spread. In a list played in order, S moved the Play next song from first to third and pushed the other out of the first five. There was no warning and no Undo. The README promises that hand-queued songs 'survive a new list', and playFrom and startFeeder do keep them, but the paths that rebuild the plan do not.
- **Why it matters:** Never discard the user's explicit work without consent; user control and freedom.
- **Proposed fix:** In replaceUpcoming and the reshuffle branch of applyPlan, read `var mine = handUpcoming()` first, filter those ids out of the new order, and enqueue mine.concat(ids), as playFrom does. In reshuffle()'s list branch, shuffle only the songs not in `hand` and keep the hand run (handRun()) at the front. Add a test.js case: 'Play next survives Shuffle again and a new order'.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/test.js` · **Effort:** S
- **Evidence:**
  - s05-hand.mjs: queued demo-064,demo-015. Hand songs kept after S (true shuffle) [false,false]; after Spread artists [false,false]; after Keep apart [false,false]; after S in spread [false,false]. List mode before S: demo-064,demo-015,...; after S: demo-011,demo-016,demo-064,...
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/hand-1-queued.png and hand-2-after-S.png
  - app.js:396-409 replaceUpcoming and app.js:505-519 (the reshuffle branch) call ctl.clearUpcoming() without handUpcoming(). app.js:884-891 shuffles them into the list. app.js:4593-4594 (the two options) go through applyPlan.
  - Compare app.js:563-568 (playFrom keeps `mine`) and app.js:308-317 (startFeeder keeps `mine`)

### listening-desktop-7 · high · The next songs are out of view on common desktop windows

- **Where:** Now-playing panel / Up next
- **Observed:** The panel stacks the video, then 'Now playing' (title, artist, chips, stars, five icons, and sometimes the 'artist is not sure' box), then the queue, so Up next starts below the fold. Upcoming rows fully visible without scrolling: 0 of 7 at 1366x768 (one row cut off), 1440x900, 1536x864 and 1000x700; 2 at 1280x860; 3 at 1920x1080. In theater mode: 1 at 1280 and 0 at 1920. Size L at 1280 shows 0 and squeezes the main view to 252 px. A one-line summary 'Up next: <title> · 6 more' already exists, but it appears only when the queue is folded with Q, so hiding the queue shows the next song better than showing it. When the panel is scrolled down to the queue, the tabs scroll away and the S/M/L buttons float over the 'Playing from' line.
- **Why it matters:** Visibility of system status: while listening, the next song should always be visible (Spotify and YouTube Music pin it).
- **Proposed fix:** Show the existing fold line whenever the first queue row is off screen: make .ts-queue-fold a sticky footer of #now-rest (position: sticky; bottom: 0), toggled by an IntersectionObserver on the first #queue row; a click scrolls the panel to the queue. Add 'Next: <title>' under the artist in renderBar. Shrink the now-info: chips on one line with '+N', and move guessBox below the queue or into the panel's More. Make .ts-tabs sticky inside #now-rest, and cap the L preset so the main view keeps at least 480 px.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css` · **Effort:** M
- **Evidence:**
  - s07-sizes.mjs, queueRowsVisible: 1280 at S '2/7', M '2/7', L '0/7' (main view 252 px wide), theater '1/7'; 1000x700 '0/7'; 1920 '3/7', theater '0/7'
  - s18-laptop.mjs: 1366x768 0/7 (first row top 613, panel bottom 664); 1440x900 0/7 (now-info 408 px tall); 1536x864 0/7
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/laptop-1366.png, a-1000-playing.png, size-1920-theater.png, size-1000-folded.png (folded: 'Up next: Glass Telegram · 6 more'), panel-scrolled.png (tabs gone, size buttons over the text)
  - app.css:1000-1004 (.ts-queue-fold shows only under body.queue-hidden), app.js:1176-1182 renderQueueFold, app.js:967-1007 renderNowInfo

### listening-desktop-8 · high · Found songs look like library songs, and rating one says 'Rated' but saves nothing

- **Where:** Now-playing panel / radio / found songs
- **Observed:** About half of every radio and of Endless is found songs (newRatio 0.5), which are not in the library. While one plays, the bar, the panel and the queue show it exactly like a library song: no 'new' or source mark, five stars, an Edit pencil. Clicking star 4 on a found song showed the toast 'Rated 4 of 5.', but the rating stayed 0 and the stars stayed empty. The pencil and I did nothing. The heart does keep the song (toggleLike calls engine.keep first); the stars do not. B (Save for later) works only on found songs, but nothing tells the listener which songs those are.
- **Why it matters:** Truthful feedback; recognition over recall (show which songs are new and what can be done with them).
- **Proposed fix:** In stars(), keep the find first (`if (t.transient && engine) { engine.keep(t.id); t = lib.tracks[t.id] || t; if (t.transient) return; }`) and show the toast only when L.edit returns a track. In renderNowInfo and renderBar, give t.transient a 'New to you' badge (media.js already draws source badges) with Keep and Save for later buttons, and hide the pencil. In renderQueue, add a small 'new' badge to rows whose id is not in lib.tracks.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - s12-found.mjs: found song dmu00tqg7ot, inLib:false. After star 4: {rating:0, pressed:'false,false,false,false,false', toast:'Rated 4 of 5.'}. I -> no dialog; pencil -> no dialog
  - s11-tabs-radio.mjs: the found row 'Signal Quiet / Marrow & Pine' renders the same as library rows. C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/radio-found-now.png, radio-queue.png
  - app.js:1008-1021: stars() calls L.edit on an id not in lib.tracks and shows the toast anyway. app.js:4712: toggleLike keeps a transient song first. app.js:1555: openEditor silently drops ids not in the library. app.js:967-1007 and 1038-1050: no transient branch.

### listening-desktop-9 · medium · The order pill, its menu and 'Playing from' misreport the state after Shuffle again; S ends a radio

- **Where:** Shuffle modes / state visibility
- **Observed:** When a list plays in order, S shuffles what comes next, but the pill keeps 'In list order' and the queue line keeps '· in order'. During a radio the order menu shows 'True shuffle' checked while the pill says 'Radio'. Pressing S during a radio silently ends the radio and starts a true shuffle of the whole library; the toast says 'Shuffled again.' and the queue line becomes 'Playing from Radio: Open Engine · true shuffle'. The queue's own Shuffle-again icon is hidden during a radio, but the bar button and the S key stay live.
- **Why it matters:** The interface must show its true state: one mode indicator, one truth.
- **Proposed fix:** In reshuffle(), when feederNow() is set, say 'A radio picks its own order. Choose an order to leave the radio.' and return; disable #btn-reshuffle in renderTransport while a feeder plays. In the list branch, set a 'shuffled' flag so modeLabel() returns 'Shuffled' and queueWord() returns 'shuffled'. In modeMenu, uncheck every order while feederNow() is set and add a checked 'Radio (now)' row.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s09-end-sleep-speed.mjs: list order, then S: pill 'In list order' -> 'In list order'; context 'Playing from An album · in order'; toast 'Shuffled what comes next.'
  - s17-radio-s.mjs: radio on {mode:'feeder', pill:'Radio'}; order menu checked: 'True shuffle'; after S {mode:'true', pill:'True shuffle', ctx:'Playing from Radio: Open Engine · true shuffle'}
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/radio-order-menu.png
  - app.js:882-894 reshuffle (no feeder case), app.js:4574 modeLabel, app.js:4590 checked, app.js:1023-1027 queueWord, app.js:4626 (hides only the queue's icon during a feeder)

### listening-desktop-10 · medium · Clicking a later song in Up next drops the songs before it, and Previous then plays one that never played

- **Where:** Queue editing / Previous
- **Observed:** In a 20-song list I clicked the 5th song in Up next. Songs 1-4 vanished from Up next: they stay behind the index and are not in Played either. Pressing P within 5 s went to demo-076, the 4th of those skipped songs, not to demo-064, the song that had been playing. The Played tab's top row shows demo-064. The row's tooltip says 'Play now', which elsewhere in the app means 'what was coming stays after it'.
- **Why it matters:** 'Play now' should mean the same thing everywhere; Previous should return to what was actually heard, matching the Played list.
- **Proposed fix:** Either make the row click play the song now and keep the rest (ctl.playNow([id]) moves it up and leaves songs 1-4 in Up next), or keep jump but remove the skipped songs (or move them to history) so Previous returns to the song that was playing; if the row still skips, retitle it 'Play from here'. In goPrev(), prefer the last history entry when the previous item was never current.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/shuffle.js` · **Effort:** M
- **Evidence:**
  - s08-queue.mjs: start {idx:0, cur:demo-064}; click the 5th row -> {idx:5, cur:demo-078}; then P -> {idx:4, cur:demo-076}; Played tab top: 'Electric Kindling' (demo-064)
  - app.js:1044: the row click calls ctl.jump(at). shuffle.js:1014: jump only moves the index. shuffle.js:1011: previous steps back through items. actions.js:25: 'Play it now; what was coming stays after it'

### listening-desktop-11 · medium · Queue rows: one-click removal with no Undo, and no menu on a row

- **Where:** Queue editing
- **Observed:** Every Up next row has a 40x40 X, shown on hover, that removes the song at once; Delete on a grip does the same. Neither shows a message or offers Undo, although clearing the whole queue does. Queue and Played rows have no menu: right-click falls through to the browser's own, and there is no ... button. So Like, Go to artist, Add to playlist and Move to top cannot be reached from the queue.
- **Why it matters:** User control and freedom: destructive actions that are easy to hit need an Undo; every song row should offer the same menu.
- **Proposed fix:** For the X and for Delete on a grip, toast 'Removed "X" from the queue.' with an Undo that re-inserts the song at the same index (ctl.insert, or a reducer 'insertAt'). Give .ts-q rows contextmenu, Shift+F10 and a ... button that open trackMenu for library songs and findMenu for found ones, plus 'Move to top' (ctl.move) and 'Remove from queue'.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - s08-queue.mjs: Delete on a grip -> toast '(none)'; X on the first row -> toast '(none)'; Clear -> toast 'Cleared what was coming next. Undo'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/queue-hover.png, queue-cleared.png
  - app.js:1048: the X calls ctl.remove(at). app.js:1093: Delete. app.js:1279: a contextmenu handler exists only for track lists

### listening-desktop-12 · medium · Keyboard focus falls back to the page after rating, removing or choosing in the panel

- **Where:** Now-playing panel / queue (keyboard)
- **Observed:** renderNowInfo and renderQueue rebuild their nodes on every change. Enter on a star, on a queue row's X, on a queue row, or on Played's 'Play next' therefore leaves the focus on <body>, and the next Tab starts again from the top of the page. Only the bar's heart keeps the focus.
- **Why it matters:** WCAG 2.4.3 Focus Order: keep the focus where the user acted.
- **Proposed fix:** Before clear() in renderNowInfo and renderQueue, record a key for document.activeElement when it is inside them (data-fk='star:4', 'qx:<id>', 'qmain:<id>', 'hnext:<id>'). After rebuilding, focus the same key, or the next row's equivalent when the row is gone, as focusGrip already does.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s19-focus-loss.mjs: Enter on 'Rate 4 of 5' -> BODY; on 'Remove Second Almanac from the queue' -> BODY; on a queue row -> BODY; on Played 'Play Hollow Compass next' -> BODY; on the bar heart -> 'Remove from Liked songs'
  - app.js:971-972 and app.js:1037 clear() before rebuilding; the grip's Delete already restores the focus (app.js:1100-1103 focusGrip)

### listening-desktop-13 · medium · Previous and Next are greyed out while their keys still work

- **Where:** Player bar transport
- **Observed:** On the last song of a list with Endless on, Next is greyed out, although the queue line says 'Then a radio from this song carries on (Endless)', and pressing N there starts the radio. On the first song of a queue, Previous is greyed out even at 1:15, although P (and goPrev, the button's own handler) restarts the song.
- **Why it matters:** Mouse and keyboard should agree; don't disable a control whose action is available.
- **Proposed fix:** In renderTransport, enable btn-next at the last item when endlessOn() && engine && queueMode !== 'true' (title: 'Next: start a radio'). Enable btn-prev whenever a song is loaded: goPrev restarts it after 5 s and steps back only when there is a previous item.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s09-end-sleep-speed.mjs: last of 3 songs {nextDisabled:true, more:'Then a radio from this song carries on (Endless).'}; after N {pill:'Radio', toast:'The queue ended: a radio from "Slow Harbor" carries on.'}; C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/end-last-song.png
  - s03-titles.mjs: btn-prev disabled:true while playing; shots/a-1280-playing.png (1:15, Previous greyed); s06: 'P at 1:00 of the first song' -> t 0 (the restart works)
  - app.js:820-821 renderTransport; app.js:877-881 goPrev; app.js:4337-4344 carryOn

### listening-desktop-14 · medium · The order menu and the bar's More hide items below a scroll edge that isn't marked

- **Where:** Shuffle-order menu / More menu
- **Observed:** Each order in the order menu has a two-line description, so the menu's content is 803 px tall. At 1280x860, 5 of its 13 items sit below the scroll edge, including both options ('Keep songs of one anime or game apart', 'One version of each song'). At 1000x700, 7 of 13 do. There is no scrollbar, shadow or fade. At 1000x700 the bar's More (599 px) also hides 'Shuffle again', 'Endless' and 'Keyboard shortcuts' below its edge, and at that width Shuffle again exists only in that menu.
- **Why it matters:** Recognition over recall: don't hide controls behind scrolling the user can't see.
- **Proposed fix:** In modeMenu, show the description only for the checked order (or as each item's title) so the ten orders fit in about 400 px, and put the two options in a short Options group at the top. In ui.js openMenu, add a bottom fade or shadow class when scrollHeight > clientHeight, and scrollIntoView the focused item. In barMoreMenu, put playback items first (Shuffle again, Repeat, Endless, Speed, Sleep), then views (Theater, Full screen, Mini player, Car mode), then the rest.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.css` · **Effort:** M
- **Evidence:**
  - s03-titles.mjs: order menu {h:602, scrollHeight:803, clientHeight:600, overflow:'auto'}
  - s13-menus-small.mjs: 1280x860 below the edge: Mood flow, In order, Keep songs..., One version..., Mix builder; 1000x700: 7 items; More at 1000 below the edge: Shuffle again, Endless: on, Keyboard shortcuts
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/k-o-menu.png, menu-order-1000.png, menu-more-1000.png
  - app.js:4586-4597 modeMenu, app.js:4159-4178 barMoreMenu, ui.js:282-326 openMenu

### listening-desktop-15 · medium · Repeat and Endless in More read as states, and do nothing in a true shuffle

- **Where:** More menu / Repeat / Endless
- **Observed:** More lists 'Repeat: off' and 'Endless: on' as plain items with no check mark, unlike the order menu's options, so it is unclear whether choosing 'Endless: on' turns it on or off. Endless has no explanation in the menu, although actions.js has one. In a true shuffle the bag refills the queue whenever two songs are left, so the queue never ends. Toggling Endless there shows the toast 'Endless off: playback stops when the queue ends.' while the queue line keeps saying 'The true shuffle draws more as it goes.', and Repeat has no effect there either.
- **Why it matters:** A toggle should look like a toggle (a checked state) and be offered only where it has an effect.
- **Proposed fix:** In barMoreMenu use A.item('repeat', ..., { label: 'Repeat the queue', checked: !!ctl.state().repeat }) and A.item('endless', ..., { checked: endlessOn(), desc: A.VOCAB.endless.desc }). When queueMode === 'true', disable both with the description 'A true shuffle never ends', and give #btn-repeat the same disabled state and title.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s03-titles.mjs: More items 'Repeat: off' and 'Endless: on', no description; C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/more-menu-1280.png
  - s09-end-sleep-speed.mjs: true shuffle with Endless toggled: queue line unchanged; toast 'Endless off: playback stops when the queue ends.'
  - app.js:4169 and 4174 (labels written as states); app.js:4338 carryOn returns false when queueMode === 'true'; app.js:361-364 onNeedMore draws from the bag; actions.js:47 has the description, but item() uses only opts.desc

### listening-desktop-16 · medium · The New songs dial can't be reached from where the radio plays

- **Where:** Endless / radio / New songs dial
- **Observed:** How much of a radio is new (None, Some or Lots: the newRatio preference) governs every Start radio, R and Endless, but it can only be changed on For you and in car mode. While a radio plays, the queue says 'about 50% of it new to you' as plain text, and the bar's More offers only Endless on or off.
- **Why it matters:** Put a control next to its effect: listeners adjust a radio while they hear it.
- **Proposed fix:** End the queue's radio line (app.js:1065) with a small None/Some/Lots segmented control, reusing foryou.js's dial and recs.js RATIOS. It sets newRatio and, as car.js:430 does, carries the radio on from the current song. Also add 'New songs: Some' as a submenu under Endless in barMoreMenu.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/foryou.js` · **Effort:** M
- **Evidence:**
  - app.js:625 and app.js:4342 only read newRatio. foryou.js:533-549 draws the dial ('Also for Endless and every Start radio'); car.js:577 is the car button
  - app.js:1065: queue line 'The radio finds more as it goes, about 50% of it new to you.' (s11-tabs-radio.mjs output); C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/radio-queue.png

### listening-desktop-17 · medium · The bar's on-states are hard to see: Repeat differs only by hue, and the sleep timer is an 8 px dot

- **Where:** Player bar state
- **Observed:** Repeat on and off, and the Queue toggle, differ only by hue: grey against the accent blue, with a luminance ratio of 1.18:1 in the dark theme and 1.01:1 in light. There is no dot, fill or change of shape, so a colour-blind listener, or anyone glancing at the bar, cannot tell them apart. A running sleep timer shows only an 8x8 px blue dot on More. The time left appears nowhere, and More's accessible name stays 'More player controls: sleep timer, ...'.
- **Why it matters:** WCAG 1.4.1 Use of Color; visibility of system status.
- **Proposed fix:** Give pressed icon toggles a mark that isn't colour, in ds.css: `.ts-icon-btn[aria-pressed="true"]::after { content:''; position:absolute; bottom:4px; left:50%; width:4px; height:4px; margin-left:-2px; border-radius:50%; background:currentColor; }`, with position:relative on the button, for #btn-repeat and #btn-queue. For the sleep timer, add a chip next to the time, like #rate-badge in renderRate, reading '14 min left' or 'after this song', which opens sleepMenu; put the time left in More's aria-label too.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s10-toggles.mjs: dark btn-repeat off rgb(154,163,175), on rgb(124,179,255); light off rgb(95,104,115), on rgb(31,95,214); background transparent in both. The ratios are computed from those colours.
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/toggles-off-light.png vs toggles-on-light.png; repeat-on.png
  - s09-end-sleep-speed.mjs: the dot is {w:'8px', h:'8px'}, More's aria-label unchanged; shots/sleep-on-bar.png
  - app.css:136 and ds.css:112 (pressed state by colour only); app.js:4157 renderSleep

### listening-desktop-18 · low · One icon for two things, two icons for one

- **Where:** Icons in the bar and panel
- **Observed:** In the bar, the Shuffle again button draws the same crossed-arrows glyph as the order pill ('True shuffle'), so two identical icons sit side by side meaning 'the mode' and 'reshuffle'. More draws Shuffle again with the vocabulary's die. The panel's journey button uses the Map section's map glyph, while actions.js gives journey the 'route' icon.
- **Why it matters:** One icon, one meaning: the vocabulary's own rule, enforced by actions.js check().
- **Proposed fix:** Use 'reshuffle' for #btn-reshuffle (app.js:5746) and for the queue's button (app.js:4626), and 'route' at app.js:1001. Have a test compare the bar's static icons with A.VOCAB.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s03-titles.mjs icons: the bar's Shuffle again path 'M3 7h3.6c2.1...' equals the pill's and PATHS.shuffle; More's Shuffle again uses 'M5 3h14a2 2...', which is PATHS.reshuffle. C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/more-menu-1280.png, a-1280-playing.png
  - app.js:5746 ['btn-reshuffle', 'shuffle']; app.js:4626 the queue's icon 'shuffle'; app.js:1001 iconBtn('map', 'A journey...'); actions.js:32 reshuffle -> 'reshuffle'; actions.js:38 journey -> 'route'

### listening-desktop-19 · low · The browser tab never says what is playing

- **Where:** What is playing
- **Observed:** While 'Distant Atlas' played, the tab title was 'Songs · True Shuffle', the heading of the page being viewed. From another tab or the taskbar, nothing names the song.
- **Why it matters:** Visibility of system status outside the page; a common pattern in music web apps.
- **Proposed fix:** While the player is playing, set document.title to the song's title and artist with a play mark (in renderTransport/renderBar), and fall back to the view's heading when paused or idle. Route app.js:780 through the same helper.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s16-small.mjs: document.title while playing: "Songs · True Shuffle"; playing: Distant Atlas
  - app.js:780 sets document.title from the view's heading only

### listening-desktop-20 · low · Save as playlist names the queue with tomorrow's date in the evening

- **Where:** Queue / Save as playlist
- **Observed:** At about 20:31 on 2026-10-11 (local time, Texas), Save as playlist proposed the name 'Queue 2026-10-12', because the name uses the UTC date.
- **Why it matters:** Use the user's local time.
- **Proposed fix:** Build the date from local parts, for example new Date().toLocaleDateString('en-CA'), or use a readable 'Queue, 11 Oct'.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s08-queue.mjs: dialog 'New playlist', fields ['Queue 2026-10-12', ...]; the sleep timer in s09 showed local 20:46 the same evening; C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/listening-desktop/shots/queue-save.png
  - app.js:4886: 'Queue ' + new Date().toISOString().slice(0, 10)

## Lens: phone

<details><summary>What this auditor covered</summary>

- Viewports, all with mobile and touch emulation: 390x844 and 360x740 portrait in dark and light; 844x390, 740x360 and 915x412 sideways. Also emulated safe-area insets (Emulation.setSafeAreaInsetsOverride) and an on-screen keyboard (viewport made 300 px shorter).
- Demo route sweep with a song playing, at 390x844 dark and 360x740 light: #/, #/search, #/search?q=lantern and ?q=glas, #/for-you, #/library, #/songs, #/artists, #/artist/paperlanterns, #/genres, #/genre/Indie rock, #/browse, #/works, #/work/Kumori Station Anime, #/track/demo-012, #/mix, #/stats, #/fix, #/settings, #/lists, #/liked, #/channels, #/channel/demo-ch-cassette-drawer, #/explore/demo-126, #/people, #/history, #/label, #/map, #/lyrics, #/quiz, #/wrapped, #/rescue, #/duel, #/c/mood/bright. For each: horizontal overflow (none found), text under 12 px, and a screenshot. Tall whole-page shots of Home, For you, Library, Search and Explore.
- Real mode with the Google hosts blocked: first run (#/, #/search, #/for-you, #/library, #/settings, and the Queue tab with no music). Then a synthetic library of 3,000 songs and 3,000 history entries in IndexedDB: Home, Songs, and a tap to play. The database was deleted afterwards.
- Header: the box, name and hit area of each control (logo, focus pill, search, theme, help, back arrow); a tap on the back arrow while a song plays; how much of the search placeholder fits at 390 and 360 px.
- Tab bar: all five tabs; how the current tab is marked (colours, aria-current) on #/library, #/liked, #/explore and #/people; contrast of phone-only text in both themes (all passed).
- Library hub: its items, their order, and what it leaves out compared with the sidebar and the palette.
- Mini player: tap to open the sheet, target sizes. Now-playing sheet: opened from the mini player and from the Queue tab; how many queue rows show; touch-scrolling inside it; the Up next, Played, Explore and Lyrics tabs; a swipe down on the grip; the close button; Back; where focus goes after closing.
- Menus: song-row menu, media-row menu, focus menu, Shuffle caret, the sheet's More, queue More and order pill. For each: where it opens, whether it fits, whether it covers the player, item heights, a tap outside, and Back.
- Dialogs: Edit details, Trim and volume, Journey and Help. For each: size, whether it covers the player, whether the last lines can be reached, Back, and the keyboard emulation.
- Toasts and progress chips: where they sit over the mini player, the sheet's transport and the player; their width; elementFromPoint checks on the sheet's Play, Previous and Next.
- Touch on rows and cards: tap, a 900 ms long press, a 500 ms press with a small wiggle, a tap that stops a fling (3 runs), a drag that starts on a row, a tap outside an open menu; library rows compared with media.js rows; Home cards; a horizontal swipe on a shelf (works).
- Search flow: the Search tab, typing, the keyboard's Enter, the order of results, Back, how many Backs leave search.
- Sticky headers after scrolling: how much of the screen the list gets.
- Car mode at 390x844, 844x390, 360x740 and 740x360: sizes, gaps, contrast, text sizes, nothing covering the player (elementFromPoint), the More menu, what a stray tap on Radio or New songs does to the queue, Back.
- Turning the phone while the now-playing sheet is open.
- Scripts and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/ (screenshots in shots/).

</details>

### phone-1 · critical · Touches that are not taps play the song under them in library song lists, replacing the queue: stopping a scroll, a long press, or dismissing a menu

- **Where:** Touch on song rows (#/songs, artist, genre, work, search, liked, playlists)
- **Observed:** In trackList rows, play is bound to every touch pointerup (app.js:1280); the row's click handler ignores touch (1270-1274). The long press relies only on the browser's contextmenu (1279). Rows are draggable (1276). At 390x844 with a song playing, each of these started the song under the finger and rebuilt the queue (playFrom, no Undo):
(a) Tapping to stop a moving list (a fling). Chrome withheld the click as it should (only pointerup fired), but a song started. This happened in 3 of 3 runs; scrollTop was 750→791 at the tap, then stopped.
(b) A 900 ms press. It played the song and changed the queue, and no menu opened. In the same test, media.js rows opened their menu at 500 ms and played nothing.
(c) A 500 ms press with a 6 px wiggle.
(d) Tapping another row to dismiss an open song menu: the menu closed and that row played.
In the same flow on Explore's media rows, nothing played.
There is also no way to select several songs on touch: selection needs Ctrl, Shift or Space (1288-1306). So the selection bar (Play next, Add to queue, Edit, Add to playlist for many) and the labeller's 'select songs anywhere' are desktop-only.
- **Why it matters:** Act on click, which is the platform's tap, not on pointerup. The browser withholds click for taps that stop a fling, for long presses and for moved touches. A touch menu needs a long press whose lift does nothing. Anything that replaces what plays needs an Undo.
- **Proposed fix:** In app.js trackList row(): remove the pointerup listener (line 1280). In the click listener, replace `if (e.pointerType === 'touch') return;` with `if (e.pointerType === 'touch') { if (selecting) select(i, { ctrlKey: true }); else if (!e.target.closest('a,button')) play(i); return; }`. Export media.js pressMenu as TS.media.pressMenu and attach it to each row (`pressMenu(r, function (at) { select(i, null, true); trackMenu(t, at, current()); })`); it already swallows the click after a long press. Set `r.draggable` only for fine pointers, so Android does not start a drag on a long press. Add 'Select' to trackMenu on coarse pointers: it enters a selection mode with a checkbox column, taps toggle songs, and selBar shows from one song with a Cancel. When playFrom from a row replaces a queue with a different context, show a toast with Undo that restores the previous ctl state.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Evidence:**
  - fling.mjs, 3 runs: '#/songs scrollTop before 300, after the fling 750, at the tap 791 | events at the tap: pointerup | a song started: true'; on #/explore/demo-126 the same gesture started nothing
  - touch.mjs: 'songs: long press (900 ms) on a row menu=false playingChanged=true queueChanged=true'; 'songs: 500 ms press with a 6 px wiggle playingChanged=true'; 'explore: long press on a media row menu=true [Play, Play next, Add to queue, Go to Kumori Station] playingChanged=false'
  - outside.mjs: '#/songs menu at [8,4,228,595]; tap outside at 86,617 -> menu closed: true, a song started: true'; on Explore: 'a song started: false'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/touch-longpress-songrow.png
  - app.js:1270-1280 (click returns early for touch; pointerup calls play(i)); media.js:461-482 pressMenu (a timer plus click suppression) is not used by trackList

### phone-2 · high · Long menus open over the docked YouTube player on phones (and in car mode sideways), and do not fit the screen

- **Where:** Menus (ui.js openMenu) on a phone with a song playing
- **Observed:** openMenu places a menu next to its anchor and asks safe.avoid to move it off the player. When no position clears the player, avoid() returns the overlapping box unchanged (ui.js:482-496). .ts-menu has max-height 70vh (app.css:437): 591 px at 844 px tall, 518 px at 740. The room under the docked player is only 557 px and 462 px, so every long menu covers the player:
- The song menu from a #/songs row (14 items) runs from y 4 to 595 over the player (52–271). It holds 663 px of content in 589 px, so 'Trim and volume…' and 'Block' are hidden until you scroll.
- The sheet's More (the same 14 items) starts at y 8.
- The Shuffle caret's order menu and the sheet's order pill (13 items, 803 px of content) start at y 8 and open scrolled to the checked item.
- The same happens at 360x740 (menus at y 4–8, player down to 262).
- In car mode at 740x360, More (534x252 at x 194) covers the player (x 12–363).
Menu items are 37 px tall on touch, desktop key hints (R, E, I) show, and there is no scrim.
- **Why it matters:** Under YouTube's terms as the app applies them, nothing covers the player. On phones, menus should be bottom action sheets with 48 px rows and a scrim, sized to the space they have.
- **Proposed fix:** In ui.js openMenu, on (max-width: 760px) or (pointer: coarse), add class is-sheet and a scrim. CSS: `.ts-menu.is-sheet { left: 0; right: 0; bottom: 0; top: auto; max-width: none; max-height: calc(100dvh - var(--ts-safe-top, 0px) - 8px); border-radius: 16px 16px 0 0; padding-bottom: max(8px, env(safe-area-inset-bottom)) }` and `.ts-menu.is-sheet .ts-menu-item { min-height: 48px }`. Hide .ts-menu-hint on coarse pointers. Add a .ts-menu-scrim from var(--ts-safe-top) down whose pointerdown closes the menu and swallows the tap. In safe.avoid, never return an overlapping box: when no try fits, return the largest free band and let openMenu set m.style.maxHeight to it. In car mode, give .ts-menu-desc `white-space: normal` and cap the menu width to the room right of the player (100vw − var(--car-cover-left) − 16px). Add the existing elementFromPoint player check to a drive script with each long menu open at 390x844, 360x740 and 740x360.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/car.js` · **Effort:** M
- **Evidence:**
  - menus.mjs 390x844: songrow {top 4, bottom 595, h 591, scrollH 663, clientH 589, items 14, itemH 37, coversPlayer true, playerBottom 271}; shuffle-caret and sheet-order {top 8, scrollH 803, coversPlayer true}; sheet-nowmore {top 8, coversPlayer true}
  - menus.mjs 360x740: songrow top 4, sheet-nowmore top 8, sheet-order top 8, all coversPlayer true (playerBottom 262)
  - car.mjs 740x360: more menu box [194,52,534,252], covers true; player [12,55,351,210]
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/menu-390x844-dark-songrow.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/menu-360x740-light-sheet-nowmore.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/menu-360x740-light-sheet-order.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/car-740x360-more.png

### phone-3 · high · Dialogs on a phone cover the player, and while a song plays the help dialog's last lines (the YouTube terms links) cannot be reached

- **Where:** Dialogs (ui.js openDialog, the kit's help dialog) with the video docked
- **Observed:** The backdrops start under the player (ds.css:191-192, `top: var(--ts-safe-top)`), but the dialogs' maximum heights ignore that: .ts-modal uses 92dvh (app.css:642) and .kit-dialog uses min(86dvh, 720px) (kit.css:444-452).
- Edit details at 390x844 while playing is 776 px tall, from y 68 to 844, and covers the whole player (52–271). Its body holds 1489 px in 710 px, and Save and Cancel sit at the very end, about 780 px below the Title field.
- Help (?) while playing spans 198→918 at 390x844 and 183→819 at 360x740. It covers the bottom 73–79 px of the player and runs 74–79 px off the screen. Scrolled to the end, the 'YouTube Terms of Service', 'Google Privacy Policy' and 'remove access at Google' links sit at y 833–855 (screen 844) and 757–778 (screen 740), so they are never visible.
- With nothing playing, the same help dialog fits (62→782).
- Trim and volume (474 px) and Journey (410 px) fit.
- **Why it matters:** Nothing covers the player. A dialog must fit the space it is given and keep its main action reachable.
- **Proposed fix:** In the phone block of app.css: `.ts-modal { max-height: calc(100dvh - var(--ts-safe-top, 0px) - 8px); }`, `.ts .kit-backdrop { align-items: flex-end; padding: 0 }` and `.ts .kit-dialog { max-height: calc(100dvh - var(--ts-safe-top, 0px) - 8px); border-radius: 16px 16px 0 0 }`. Give openDialog a sticky footer slot (`.ts-modal-foot { position: sticky; bottom: 0; background: var(--bg); padding: 10px 22px max(10px, env(safe-area-inset-bottom)) }`) and move the editor's Save and Cancel there (openEditor, app.js:1554). Extend the player-cover drive check to every dialog at 390x844 and 360x740.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/_kit/kit.css` · **Effort:** S
- **Evidence:**
  - dialogs.mjs 390x844: 'Edit details {top 68, bottom 844, h 776, bodyScroll 1489/710, coversPlayer true, playerBottom 271, smallest button h 23}'
  - help.mjs 390x844 playing: dialog [198,918], last links top 833/855/855, onScreen false; idle: dialog [62,782], links on screen
  - help.mjs 360x740 playing: dialog [183,819], links top 757/757/778, onScreen false
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/dlg-390x844-dark-Editdetails.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/help-390x844-dark-play-end.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/dlg-390x844-dark-editor-end.png

### phone-4 · high · Android's Back gesture does not close the sheet, a menu or a dialog: it changes the page instead

- **Where:** Back navigation with overlays open
- **Observed:** The sheet, menus and dialogs push no history entry. Back only fires hashchange, and onRoute (app.js:746-756) closes the sheet and menus as a side effect of changing the page. Tested at #/songs, opened from #/:
- With the sheet open, Back closed the sheet and went back to #/.
- With the sheet's More menu open, Back closed the menu and the sheet and went back a page.
- With Edit details, Trim and volume or Journey open, Back left the dialog open while the page behind it changed from #/songs to #/.
- **Why it matters:** On Android, Back first dismisses the topmost temporary surface (sheet, menu, dialog) and only then navigates.
- **Proposed fix:** Add a small overlay stack in ui.js. U.overlay.open(closeFn) calls `history.pushState({ tsOverlay: depth }, '')`; the URL is unchanged, so no hashchange fires. One popstate listener closes the top overlay. Closing by other means calls history.back() only when its own entry is current, behind a flag so onRoute ignores it. Use it in openSheet/closeSheet (app.js:1195-1209), openMenu/closeMenu (ui.js:270-325), openDialog/close (ui.js:332+) and car mode's More. Keep onRoute's closeSheet as a fallback.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/car.js` · **Effort:** M
- **Evidence:**
  - sheet.mjs: 'after Back with the sheet open: {open:false, hash:#/}' (it was on #/songs)
  - menus.mjs: 'after Back with the menu open: menu= false sheet= false hash= #/songs' (it was on #/)
  - dialogs.mjs: 'Edit details … Back: from #/songs -> {hash:#/, dlg:true}'; the same for Trim and volume and Journey from here

### phone-5 · high · Turning the phone sideways with the now-playing sheet open leaves the app frozen

- **Where:** Now-playing sheet and screen rotation
- **Observed:** On a phone, openSheet makes #main, #bar, #tabbar and the header inert (app.js:1186-1198), and nothing undoes this when the window grows past 760 px. With the sheet open at 390x844, then turned to 844x390: body.sheet-open stays and all four stay inert, while the wide layout looks normal (the sheet shrinks to a 270x5 px strip in the side panel). A tap on the bar's Next did nothing. Only the sidebar still responds (a tap on Artists navigated, and onRoute then closed the sheet). Otherwise the user must turn the phone back.
- **Why it matters:** State must follow layout changes. Never leave a page inert without a visible modal.
- **Proposed fix:** In app.js wireShell: `var mq = matchMedia('(max-width: 760px)'); mq.addEventListener('change', function () { if (document.body.classList.contains('sheet-open')) { if (mq.matches) sheetInert(true); else closeSheet(); } U.closeMenu(); });`. This also closes a menu that was placed for the other orientation, as car.js already does.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - rotate.mjs: 'turned sideways: {w:844, sheet:true, inert:[main,bar,tabbar,header], restBox:[566,281,270,5]}'; 'tap on the bar's Next sideways: song changed = false'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/rotate-sheet-land.png

### phone-6 · high · A phone held sideways gets no usable layout: no page at all at 740x360, a 225 px desktop view at 844x390, no safe-area insets

- **Where:** Landscape phone layouts
- **Observed:** The phone layout is chosen by width alone (max-width 760px).
- At 740x360 (a 360-wide Android held sideways) with a song playing: header 52 + video 210 + mini player 61 + tab bar 62 = 385 px, more than the 360 px screen. #main is 0 px tall, so no page shows at all, and the tab bar runs 25 px off the bottom, cutting its labels. Toasts and the progress chip there also cover the player (toast 161–210, chip 210–252, player 52–262).
- At 844x390 and 915x412 the desktop layout applies. #main is 474x225 or 545x247 px between a 61 px header and a 96 px bar. On Songs the Play button is cut off and the first song is at y 497 (none visible). The queue panel under the video is 5 px or 27 px tall.
- index.html:5 sets viewport-fit=cover, but only the tab bar uses env(safe-area-inset-*). With emulated insets (left 44, bottom 21) at 844x390, the logo (x 12), the first sidebar icon (x 16) and the bar's cover art (x 16) sit inside the cutout, and the bar ignores the bottom inset.
- **Why it matters:** Support both orientations (WCAG 1.3.4). Respect safe areas when opting into viewport-fit=cover.
- **Proposed fix:** Add a phone-landscape layout in app.css: `@media (orientation: landscape) and (max-height: 500px) and (pointer: coarse)`. Use two columns, `grid-template-columns: minmax(200px, 42vw) minmax(0, 1fr)`: the video on the left at 200 px or more tall (for example 356x200), the mini player and a compact tab row under it, and the main view filling the right column. Drop the 96 px desktop bar and .ts-brand-name, and open the sheet as a right-hand panel. Make isPhone() match this query too, and teach U.safe a left zone so toasts, chips and menus avoid the player there. Pad .kit-header.ts-top, .ts-app and .ts-bar with max(…, env(safe-area-inset-left|right|bottom)).
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js` · **Effort:** L
- **Evidence:**
  - land.mjs 740x360 playing: main [0,262,740,0], tabbar [0,323,740,62], player [0,52,740,210], songRowsVisible 0
  - land.mjs 844x390 playing: main [84,61,474,225], rest [566,281,270,5], bar [8,294,828,96], firstRowTop 497, songRowsVisible 0; 915x412: main 545x247, rest 27 px
  - insets.mjs 844x390 with insets '0px 0px 21px 44px': brand [12,16,…], firstNav [16,71,…], barArt [16,310,…]
  - toasts.mjs 740x360: toastOverPlayer true, jobOverPlayer true
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/land-740x360-songs.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/land-844x390-songs.png

### phone-7 · high · On a phone there is no one-tap Like for the song that is on, and no sleep timer, Repeat, speed or Endless switch

- **Where:** Mini player and now-playing sheet
- **Observed:** The heart (#btn-like) and the bar's More (#btn-bar-more) live in .ts-bar-right, which app.css:604 hides under 761 px, and nothing replaces them. With a song playing at 390x844, no visible control named Like, heart, sleep, repeat, speed or endless exists on the mini player or anywhere in the open sheet, top or bottom.
- The sheet's More is the song menu (Play … Rating…, Trim and volume…, Block), with no Like.
- The queue's More holds only Save as playlist and Clear queue.
- The bar's More, opened by script, holds Sleep timer, Repeat, Playback speed, Endless, Shuffle again and Car mode. On a phone, Car mode is reachable only from the Library hub or Settings.
To like the song that is on, you must know that the 4th or 5th of five 26x38 px stars in the sheet counts as liked.
- **Why it matters:** The most frequent player actions must be one tap away on the main device, and every layout should offer the same capabilities.
- **Proposed fix:** Add a 44 px heart to the mini player between the title and Play, and a heart beside Next in the sheet's transport (#st-like), both driven by toggleLike/renderHeart. Add a '⋯' (#st-more) at the right of the sheet's transport row that calls barMoreMenu(anchor) (app.js:4159). When isPhone(), leave out the desktop-only items (Theater, Full screen, Mini player, Continue on your phone, Keyboard shortcuts). Show the sleep timer's dot (#btn-bar-more.has-dot) on the new button.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - like.mjs: 'mini player screen, matching controls: [Shuffle everything…]' (a page tile, not a player control); 'sheet open, top: [What goes with the song that is on…]' (the Explore tab only); 'sheet open, bottom: []'
  - like.mjs: bar More (hidden on phones): display inline-flex / parent none; items: Sleep timer…, Theater mode, Full screen, Continue on your phone, Mini player, Car mode, Edit details…, Repeat: off, Playback speed… (normal), Trim and volume…, Share the queue as a link, Shuffle again, Endless: on, Keyboard shortcuts
  - app.css:604 `.ts-bar-right { display: none; }`; app.js:999-1004 (the sheet's action row: stars, radio, map, explore, edit, more)

### phone-8 · high · The ← at the top right of the phone header leaves True Shuffle and stops the music

- **Where:** Header
- **Observed:** Under 761 px, the kit's 'Jack V. Le' link is restyled into a bare ← (app.css:665-666). It is the only back-looking arrow in the app, because the in-app Back and Forward buttons are hidden on phones (app.css:573). Its accessible name is 'Back to the site'. With a song playing, a tap on it went to /#/misc and unloaded the app (window.__ts gone), which stops playback. Its hit area is 28x27 px, 35 px with its ::after, below the 44 px used elsewhere.
- **Why it matters:** An icon should mean what the platform means (← is back within the app). An ambiguous control must never end playback.
- **Proposed fix:** Under 761 px, hide `.kit-header.ts-top .kit-back` (app.css phone block, near lines 662-668). Add a plain row, 'Back to Jack V. Le's site', at the end of the Library hub (viewLibrary) and in Settings > Data and privacy. Anywhere the link stays while music plays, confirm first with a dialog: 'Leave True Shuffle? The music stops.'
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - header.mjs: 'a.kit-back [352,13,28,27] hit=35 name="Back to the site" shows=(font 0: "←") href=/#/misc'
  - header.mjs: 'tap on the header arrow: /misc/101-true-shuffle/?demo=1#/ -> /#/misc title=Miscellaneous · Jack V. Le app still loaded=false'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/390x844-dark-play-home.png

### phone-9 · high · While a song plays, collection pages show no songs on the first screen: the phone header block alone is 264–308 px tall

- **Where:** Page headers (hero) and vertical space with the video docked
- **Observed:** With the video docked, #main is 450 px tall at 390x844 and 356 px at 360x740. On phones the header block (the 'hero') stacks a 104 px picture, a kicker, the title, meta, chips and two rows of buttons, 264–308 px in all. Distance from the top of #main to the first song (demo banner hidden, to match a real library):
- artist +464, genre +470, search results +504, work +534, Explore +732, Liked songs +769, song page +831, mood Bright +909.
- On all of these, 0 songs are fully visible on the first screen. Songs shows 2 at 390x844 and 0 at 360x740.
After scrolling, the compact sticky header (60 px) leaves the list 391 px (46% of the screen) at 390x844 and 296 px (40%) at 360x740. Duel's two song cards do not fit on one screen.
- **Why it matters:** Content comes first on small screens. The player that must stay on screen already takes 40% of the height, so page chrome has to shrink.
- **Proposed fix:** Phone hero (app.css phone block, the .ts-hero rules at 613-614 and 1067): a row layout with a 64 px picture left of the title, no kicker, a 22 px title, meta on one line, chips in one horizontally scrolling nowrap row, and the actions in one row (Play, Shuffle with its caret, and ⋯ holding Radio, Focus and Save as playlist). Padding 12px 16px. Target: the first song within 200 px of #main's top. Fold the Songs page's filter and sort behind a filter icon. On scroll down, slide .kit-header.ts-top away and let the page's compact sticky header take its place (52 px back); restore on scroll up. Optionally size the player at the terms' 200 px minimum instead of max(210px, 56.25vw) (app.css:587).
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ds.css` · **Effort:** M
- **Evidence:**
  - fold.mjs 390x844: '#/artist/paperlanterns main 450 px tall; first song at +464 px; songs fully visible: 0; hero 273 px', '#/track/demo-012 +831; hero 308', '#/c/mood/bright +909', '#/songs +308, 2 visible'
  - fold.mjs 360x740: main 356 px; #/songs first song +355, 0 visible; #/liked +816; #/explore +753
  - sticky.mjs: '#/songs … sticky ts-sticky h 60 … scrollingPx 391, share 46%' (390x844); 296 px, 40% (360x740)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/390x844-dark-play-artist_paperlanterns.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/390x844-dark-play-track_demo_012.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/360x740-light-play-duel.png

### phone-10 · medium · The tab bar does not show which tab you are on (a CSS specificity bug), and it never announces it

- **Where:** Tab bar
- **Observed:** `.ts a { color: inherit; }` (app.css:44, specificity 0,1,1) beats `.ts-tab-a { color: var(--text-2); }` (app.css:609, specificity 0,1,0), so the other tabs take the body text colour. The current tab (.ts-tab-a.is-on, var(--heading)) then differs from them by 1.14:1 in light (rgb 27,31,36 against 13,17,23) and 1.29:1 in dark (213,218,226 against 243,245,248). The weight is the same (650), and there is no background, pill or bar. At 2x zoom the light bar shows no visible difference. The tab links have no aria-current (app.js:724), unlike the sidebar's. #/liked lights no tab, because 'liked' is missing from the Library list at app.js:723.
- **Why it matters:** Where you are must be visible (a state indicator at 3:1 or better, WCAG 1.4.11) and announced (aria-current).
- **Proposed fix:** In the app.css phone block: `.ts .ts-tab-a { color: var(--text-2); }` and `.ts .ts-tab-a.is-on { color: var(--accent); }`, plus a pill behind the current icon (`.ts-tab-a.is-on .ts-i { background: var(--accent-soft); border-radius: 999px; padding: 4px 16px; box-sizing: content-box; }`). In renderNav (app.js:720-729): give each tab `aria: { current: on ? 'page' : null }`, make the Queue tab a button with aria-expanded, and add 'liked', 'people', 'rescue' and 'paste' to the Library list on line 723.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - tabbar.mjs light #/library: 'Home rgb(27, 31, 36) … [ON] Library rgb(13, 17, 23)'; dark: 'Home rgb(213, 218, 226) … [ON] Library rgb(243, 245, 248)'; #/liked: no [ON]
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/tabbar-light.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/tabbar-dark.png

### phone-11 · medium · The Queue tab opens a sheet with 0–1 queue rows in view; the sheet is hard to close, and its tabs scroll away

- **Where:** Now-playing sheet
- **Observed:** The Queue tab and the mini player open the same sheet, at its top. Grip 40 + song 215 + transport 116 + tabs 49 + context and order row 57 puts the tabs at y 646 with 1 queue row visible at 390x844, and at y 616 with 0 rows at 360x740. Scrolling the queue scrolls the tabs off (y −830); only the grip stays.
Closing:
- The only control is a 36x36 chevron (#sheet-close).
- A 400 px swipe down on the grip does nothing.
- The header above stays fully drawn but is inert, so a tap on Search does nothing.
- Back navigates (see the Back finding).
The 44 px touch pass did not reach the sheet: its tabs are 60–68x33, #btn-queue-more 36x36, queue grips 20x28, stars 26x38. After opening from the Queue tab and closing, focus drops to <body>, because renderNav replaced the tab link that had focus. A queue row's ×, always shown on touch (app.js:1048), removes the song at once with no Undo.
- **Why it matters:** A control should deliver what its label says (Queue shows the queue). Bottom sheets close by swiping down or tapping outside. Section tabs should stay in reach, targets should be 44 px or larger, and removals need an Undo.
- **Proposed fix:** Give openSheet a 'from' argument. Opened from the Queue tab, scroll #now-rest so the tabs sit under the grip and select Up next. In the phone block, make `.ts-queue .ts-tabs` sticky (top 40px, background var(--bg), z-index 1). Add drag-to-dismiss on .ts-sheet-grip: pointer events with touch-action none, the sheet follows with translateY, and it closes past 96 px or on a fast flick. Dim the inert header (`body.sheet-open .kit-header { opacity: .45 }`) or make a tap on it close the sheet. On phones set `.ts-tab { min-height: 44px }`, `#sheet-close, #btn-queue-more { width: 44px; height: 44px }` and `.ts-grip { padding: 12px 8px }`. Give the tab bar links ids and return focus by id after renderNav. Make removing from the queue show a toast with Undo (insert back at the old index).
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css` · **Effort:** M
- **Evidence:**
  - sheet.mjs 390x844: tabs at y 646, '#queue' at y 766, 'queue rows fully visible in the open sheet: 1'; 360x740: tabs at y 616, 'rows fully visible: 0'
  - sheet.mjs: 'after a 350 px drag… tabs y -830'; 'after a 400 px swipe down from the grip: open:true'; 'after the grip button: active = body (ts has-ambient…)'
  - targets.mjs sheet: 68x33 #tab-next, 60x33 #tab-history, 66x33 #tab-like, 53x33 #tab-lyrics, 36x36 #sheet-close, 36x36 #btn-queue-more, 20x28 .ts-grip, 26x38 .ts-star
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/sheet-360x740-light-open.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/sheet-390x844-dark-scrolled.png

### phone-12 · medium · Toasts and the progress chip are placed for the desktop bar: they sit on the mini player and on the sheet's Play, and a toast is at most half the screen wide

- **Where:** Toasts and job chips on a phone
- **Observed:** --ts-bar stays 96 px on phones (app.css:10), but the mini player plus tab bar are 122 px tall. .ts-jobs sits at `bottom: calc(var(--ts-bar) + 12px)` (ds.css:184) and .ts-toast at `bottom: 150px` (app.css:898).
- At 390x844, a 'Searching YouTube…' chip with Cancel (y 694–736, pointer-events auto) overlaps the mini player (722–783), including the top of its Play button.
- At 360x740 with the sheet open, a tap at the centre of the sheet's Play/Pause hits the toast, and taps on the lower part of Play, Previous and Next hit the chip.
The toast is positioned with left 50% and translate(-50%) (ds.css:193), so its shrink-to-fit width is at most half the screen: 195 px at 390. 'Removed Glass Engine from the queue.' wraps to 3 lines and is 83 px tall.
- **Why it matters:** Temporary messages must not cover main controls. Position them from the layout that is actually on screen.
- **Proposed fix:** In the phone block, set `:root { --ts-bar: 122px; }` and use `bottom: calc(var(--ts-bar) + env(safe-area-inset-bottom) + 8px)` for both .ts-jobs and .ts-toast, replacing the fixed 150px. With body.sheet-open, place both at `top: calc(var(--ts-safe-top, 0px) + 48px); bottom: auto`, under the grip and clear of the transport. For width, replace the -50% translate with `left: 16px; right: 16px; margin-inline: auto; width: fit-content; max-width: 560px; transform: translateY(20px)` (is-on: none) for .ts-toast and .ts-jobs.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css` · **Effort:** S
- **Evidence:**
  - toasts.mjs 390x844: job [16,694,374,736], bar [0,722,390,783], jobOverPlayBtn true, jobOverTitle true; toast [98,611,293,694]
  - chip.mjs 360x740 sheet open: st-toggle hits ['ts-toast','ts-job-text','SPAN'], st-prev hits [self,'ts-job-text',self], st-next hits [self,'ts-job',self]
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/toast-390x844.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/toast-360x740-sheet.png

### phone-13 · medium · Search on a phone: the Search tab does not focus the field, the placeholder is cut mid-word, Enter keeps the keyboard up, and songs come last

- **Where:** Search field and results
- **Observed:** The Search tab routes to #/search and puts focus on the page title (renderView, app.js:782), not on #search. The field in the header is 196 px wide at 390 and 166 px at 360. Its placeholder needs 250 px but gets 112 or 82 px, so it reads 'Search songs,' or 'Search so'. The keyboard's Enter keeps focus in the field (the submit handler at app.js:5745 does not blur), so the keyboard stays over the results; there is no enterkeyhint. Results lead with a 230 px artist card. For 'glas', the Songs heading is at +417 and the first song at +559 in a 450 px #main, of which about 273 px shows above a 300 px keyboard.
- **Why it matters:** The Search tab should leave you ready to type. Order results by likely intent. Dismiss the keyboard on submit.
- **Proposed fix:** In renderNav, give the Search tab a click handler that focuses #search after routing (it runs in the tap's gesture, so the keyboard opens), and skip the h1 focus in that case. In index.html, add `enterkeyhint="search"`, and in wireShell set the placeholder to 'Search' when isPhone(). Blur the field on submit (app.js:5745). In viewSearch (app.js:2003), on phones show the top 5 songs first with 'All N songs', then artists and works as a horizontal row of 56 px chips; keep the big cards on wide windows.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html` · **Effort:** S
- **Evidence:**
  - search.mjs: 'after the Search tab: hash #/search focus H1.ts-h1'; 'after the keyboard's Enter: focus search'; 'enterkeyhint: null'; 'results: {sections:[Artists@140, Songs (23)@417], firstRow:559, mainH:450}'
  - header.mjs: 'placeholder needs 250 px, has 112 px' (390) / 'has 82 px' (360)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/search-glas.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/360x740-light-play-quiz.png

### phone-14 · medium · Song rows that look alike behave differently on a tap: Explore and For you rows ignore a tap on the row

- **Where:** media.js rows (Explore, For you, the sheet's Explore tab)
- **Observed:** In library lists, a tap anywhere on a row plays it, as designed. media.js rows have the same art, title and artist layout, and a ✓ for library songs, but do nothing on a tap of the row itself. A tap on the title of 'Winter Arcade', a library song in Explore's 'From your library' lane, started nothing and opened nothing. Only the 32 px Play button acts (row() has no body handler, media.js:486-580). Found songs behave the same.
- **Why it matters:** Consistency: elements that look the same must do the same thing.
- **Proposed fix:** In media.js row(), on coarse pointers, add a click handler on the li that ignores a and button targets (pressMenu already swallows the click after a long press). If cost(ctx, it) === 0, call pb.click(); otherwise open the row menu, so a body tap never runs a 100-unit search.
- **Files:** `misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - misc1.mjs: 'tap on the title of a library song in Explore (Winter Arcade): playing before demo-016 after {cur: demo-016, menu: false}'
  - touch.mjs: 'explore: tap on a media row text menu=false playingChanged=false'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/lane-dark-_explore_demo_126-2.png

### phone-15 · medium · Phone navigation cannot reach Liked songs or 'Paste a list', and the Library hub is a flat list of 18 with Playlists 9th

- **Where:** Library hub (#/library) and the phone's routes
- **Observed:** #/liked is linked only from the desktop sidebar (NAV, app.js:687) and the Ctrl+K palette (app.js:4783). 'Paste a list of songs' (#/paste) is linked only from the palette (app.js:4813). The palette opens only with Ctrl+K, so neither page is reachable on a phone. The hub (viewLibrary, app.js:2544-2558) lists 18 items with no groups. Playlists is 9th; with a song playing only Songs, Artists, Channels and Genres fit on screen. For you repeats a tab. Mix builder and Voice actors are missing. For you and Your year share the sparkle icon, and 'Anime, games & stage' and 'Guess the anime' share a screen-like icon. The hub says 160 songs while Home says 157 (Home counts playable songs only).
- **Why it matters:** Every page must be reachable in every layout. Group navigation and put the most-used items first.
- **Proposed fix:** Rebuild viewLibrary with groups:
- 'Your music': Liked songs (heart icon, count of rating 4+), Playlists, Songs, Artists, Anime/games/stage, Genres, Moods & scenes, Channels.
- 'Listen': History, Mix builder, Your year, Map, Voice actors.
- 'Play': Guess the anime, Rank your songs, Car mode.
- 'Tidy up': Needs attention, Songs gone from YouTube, Quick labeller, Paste a list of songs, Settings.
Drop For you, since it is a tab. Give the look-alike items distinct icons, and count with playable(ix.music) as Home does.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/tall-dark-library.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/390x844-dark-play-library.png
  - grep: '#/liked' appears only at app.js:4783 (the palette) and in NAV; '#/paste' only at app.js:4813 (the palette); openPalette is bound only to Ctrl/Cmd+K (app.js:5694)

### phone-16 · medium · Car mode: Radio sits 12 px under Pause and replaces the queue with no Undo; 'Test buttons', a setup tool, sits in the driving strip

- **Where:** Car mode (#/car)
- **Observed:** At 390x844, Pause is 120x120 at y 620–740 and Radio 115x80 at y 752–832, 12 px apart (the grid gap in car.js .ts-app). With a 30-song 'Some songs' queue, a tap on Radio replaced it with a 4-song 'Radio: Distant Almanac' queue. The toast 'A radio from Distant Almanac.' has no Undo (car.js radio(), lines 416-422). New songs rebuilds the radio on every tap: three taps gave three rebuilt queues. The song playing keeps playing. 'Test buttons', a one-time setup tool, is a 159x48 button beside More on every drive. Sizes and contrast are otherwise good (buttons 96–120 px, title 32 px, text contrast 7.6–17.8:1, player never covered in portrait).
- **Why it matters:** At arm's length, actions that replace what plays need distance from the main buttons and an Undo. Keep setup tools off the driving screen and minimise glances.
- **Proposed fix:** In car.js radio() and cycleRatio(), keep a copy of ctl.state() and the context, then show U.toast(text, { action: 'Undo', onAction: restore, ms: 10000 }). Increase the space between .car-pad and .car-row2 to 24 px or more (a row-gap, or margin-top on .car-row2). Apply New songs 2 s after the last tap instead of on every tap. Move Test buttons into More, showing it in the strip only while S.testing is on.
- **Files:** `misc/101-true-shuffle/car.js` · **Effort:** S
- **Evidence:**
  - car.mjs 390x844: 'btn Pause 120x120 at 135,620'; 'btn Radio 115x80 at 137,752'; 'btn Test buttons 159x48 at 161,12'
  - misc1.mjs: 'car Radio: before {n:30, ctx:"Some songs"} after {n:4, ctx:"Radio: Distant Almanac", toast:"A radio from Distant Almanac.", toastButtons:0}'
  - car2.mjs: three taps on New songs re-seeded the radio three times; the same song kept playing
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/car-390x844-playing.png

### phone-17 · low · Targets the 44 px touch pass missed outside the sheet and menus

- **Where:** Touch targets on coarse pointers
- **Observed:** The ds.css coarse-pointer block (lines 196-210) enlarges .ts-sec-more, chips and a few header controls. These were missed:
- lanes.js 'See all' (.ts-lane-all), 63x28 on every Explore and For you lane;
- For you's OP/ED chips (.ts-fy-theme), 37–53x22;
- Browse's grid mood links, 38x17;
- the mini player's Next (#btn-next), 42x42;
- the sticky header's Play (.ts-sticky-play) and the tiles' .ts-bigplay, 40x40;
- segmented buttons (.ts-seg-b), 58x32 and 100x32;
- the order pill (.ts-modepill), 145x38.
- **Why it matters:** Touch targets of about 44 px, as the app already applies elsewhere.
- **Proposed fix:** Add the missed selectors to the coarse-pointer block in ds.css: `.ts-lane-all, .ts-fy-theme, .ts-seg-b, .ts-sticky-play, .ts-bigplay, .ts-modepill, .ts-matrix th a { position: relative; }` with `::after { content: ''; position: absolute; inset: -8px -4px; }`. Make the phone bar's #btn-next 44x44. Put .ts-lane-all in the lanes.js CSS string with padding 12px 4px.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - targets.mjs: '#/explore … 63x28 a.ts-lane-all "See all"', '#/for-you … 37x22 a.ts-fy-theme "ED1: Gravity Satellite"', '58x32 button.ts-seg-b "None"', '#/browse 38x17 a. "Bright"', 'mini player 42x42 button#btn-next', '40x40 button.ts-sticky-play', '40x40 button.ts-bigplay', '145x38 button.ts-modepill'

### phone-18 · low · Desktop wording and key hints shown on a phone

- **Where:** Copy on touch screens
- **Observed:** Phone users see text written for a mouse and keyboard:
- Menus show key hints: Start radio R, Explore E, Edit details… I.
- The help dialog's close button reads 'Close Esc' (kit.js:810), and its Keys section lists keyboard shortcuts.
- Map: 'Drag to pan, scroll or pinch to zoom, click a dot, Shift-drag a box to pick a region'.
- Playlists: 'One click focuses on it' (app.js:3418).
- Duel: 'Click or tap … Keys: 1 or ← …' (duel.js:557).
- Settings: 'your browser's zoom (Ctrl and + or -)' and 'To try it on a PC…'.
- **Why it matters:** Use words that match the device in hand.
- **Proposed fix:** Add `@media (pointer: coarse) { .ts-menu-hint, .kit-dialog-head kbd, #help-keys { display: none; } }`. Use a `touch` flag (matchMedia('(pointer: coarse)')) to swap the text of the map blurb in viewMap ('Drag to move, pinch to zoom, tap a dot'), the Playlists line ('A tap focuses on it'), duel.js's hint ('Tap the song you like more') and the Settings zoom sentence.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/duel.js` · **Effort:** S
- **Evidence:**
  - words.mjs output for #/settings, #/lists, #/map and #/duel
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/menu-390x844-dark-songrow.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/phone/shots/dlg-390x844-dark-help.png

## Lens: discovery

<details><summary>What this auditor covered</summary>

- Explore #/explore/<id> in the demo at 1440x900 (dark and light) and 390x844 touch: an anime song (demo-126), a plain song (demo-002) and a song with a guessed artist (demo-042). Covered the trail, hero (Play, Start radio, Like), Jump to chips, every lane (anime with its filters, Play yours and Add the N missing; YouTube Mix; artist tabs with the album and single dialogs; composer; similar; channel; your library), page length, and what is visible in the first screen
- Explore of a found song (#/explore/find/<key>): the hero's Play and Save for later, and its lanes
- Explore in real mode (no demo) with 1,200 synthetic songs and 3,000 history entries filled into IndexedDB, then wiped. Google APIs, every music service (AnimeThemes, AniList, iTunes, Deezer, MusicBrainz, Last.fm, LRCLIB) and YouTube were blocked, so lanes showed their error states. Also ran with Chrome's offline emulation. Read the YouTube Mix was pressed with YouTube blocked
- Cost badges in real mode with the configured key (canRead true; no quota spent because Google was blocked and the engine's play/list/resolveGroup were stubbed). works.js and artists.js answered with their demo data. Checked rows, cards, album and single dialogs (Play all, Shuffle, Add to queue), Saved for later, the found-song hero, the preview bar, and accessible names
- For you #/for-you in the demo (desktop dark and light, phone), in real mode with everything blocked, and offline. Covered Your radio (Start your radio, Preview new songs, New songs dial, quota text, Sources row), This season, Airing today, Missing from your series, New releases, New from your channels, Because you play x3, Saved for later and Hidden, plus page length and the Jump to chips
- Preview bar at 1440x900, 1280x720, 1024x700, 800x600, 390x844 (touch) and 844x390 (touch, landscape); with player sizes M and L and theater mode at 1366x657, 1280x600, 1536x730 and 1920x960. Checked overlap with the player box, closing the bar and whether the song comes back, the phone's buttons, and Not interested with its toast
- Queue effects: Explore's Add the N missing to the queue while a list was playing, Start your radio (For you) and Start radio (Explore) while a list was playing, and Add to queue in the album dialog (how many lookups go out at once, their order, the toasts)
- Artist page #/artist/paperlanterns (demo) and #/artist/kumoristation (real mode, blocked); song page #/track/demo-126; #/channels; #/channel/demo-ch-cassette-drawer including Play what's new to you, and how the found song then appeared in the bar, queue and now-playing panel; #/works and #/work/Kumori Station Anime
- Now-playing panel's Explore tab (real mode, blocked)
- Keyboard: Enter on a Jump to chip then Tab, on Explore and For you, counting Tab presses to reach the lane
- Touch targets on a 390 px phone: For you theme chips, source chips and jump chips; Explore jump chips, filters and artist tabs
- Code read: explore.js, lanes.js, media.js, foryou.js, the preview bar, playFind, startFeeder, artist and work views in app.js, channel.js rows and toFind, engine.js list/radio/keep, player.js loadIframeApi, app.css and ds.css (preview bar, safe zone, touch hit areas)

</details>

### discovery-1 · high · Explore's 'Add the N missing to the queue' replaces the queue and interrupts the song that is playing

- **Where:** Explore > anime lane / queue
- **Observed:** Demo: 'My evening list' was playing (Blue Letters, 11 songs coming up). On Explore's anime lane I pressed 'Add the 3 missing to the queue'. Kazemachi Ticket started at once. The queue header became 'Kumori Station Anime: the ones you lack' with 2 songs coming, and the list's 11 upcoming songs were gone. There was no toast and no Undo. The button calls explore.js play() without a mode, which runs engine.list(); app.js startFeeder then calls setQueue. Only songs queued by hand survive. In real mode the same press starts a list feeder that may run up to 10 YouTube searches (about 1,000 units), with no cost badge on the button. For you's 'Add missing to queue', with the same wording, appends instead (sequential queueFinds, capped at 10). So the same words do two different things.
- **Why it matters:** A label must match its outcome. An 'add' must never throw away or interrupt what is playing, and anything that discards state needs an Undo.
- **Proposed fix:** In explore.js workLane actions (line 184), pass 'later': play(ctx, missing, label, href, 'later'). Replace the 'later'/'next' branch of explore.js play() (line 152) with For you's sequential, capped queueFinds; move that helper into media.js so both pages share it. Give the button a cost (worst case: 100 x the songs that still need finding, capped at 10) and toast '3 songs added to the queue' once they resolve.
- **Files:** `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - d15-add-missing.mjs: before {playing 'Blue Letters', from 'My evening list', upcoming 11} -> after {playing 'Kazemachi Ticket', from 'Kumori Station Anime: the ones you lack', upcoming 2}; toasts: []
  - Screenshot: .../discovery/shots/add-missing-after.png ('Playing from Kumori Station Anime: the ones you lack · 2 songs')
  - d05-costs.mjs: pressing it recorded engine.list {n:3, searchCap:10, unresolved:3}; the button has no data-cost
  - explore.js:184 calls play(ctx, missing, label, href) with no mode; explore.js:146-154 runs en.list() for anything that is not 'later' or 'next'; app.js:4305-4321 startFeeder ends in setQueue(...)
  - foryou.js:825 runs the series lane's 'Add missing to queue' through playItems(..., 'later') and then queueFinds (foryou.js:366-383)

### discovery-2 · high · 'Start radio' and 'Start your radio' do nothing you can hear while a song plays, and the queue then names the wrong source

- **Where:** For you > Your radio; Explore hero
- **Observed:** For you: 'Crooked Arcade' was playing from 'My evening list'. I pressed the page's main button, 'Start your radio'. Crooked Arcade kept playing, now labelled 'Playing from Your radio'. The toast said 'Your radio, from “Silver Avenue”…', but the next three songs were Static Satellite, Electric Current and Symphony No. 3; Silver Avenue was not played first. Explore (Amber Atlas): the hero's 'Start radio' behaved the same way. Crooked Arcade continued, relabelled 'Radio: Amber Atlas', followed by Paper Ferry, Velvet Avenue and Static Night, and there was no toast at all. The cause: app.js startFeeder treats every radio as 'a radio from the song that is on' (when ctx.radio and something has started, it only clears the upcoming songs and enqueues), even when the seed is a different song.
- **Why it matters:** Visibility of system status and feedback: a primary 'Start' action needs an immediate, audible result, and the 'Playing from' label must describe the song that is actually playing.
- **Proposed fix:** In app.js startFeeder, keep the current song only when the feeder's seed equals ctl.current(). Otherwise play the seed now and let the radio follow (setQueue([seed].concat(ids)) or playNow(seed)). If keeping the song is preferred, say so: label it 'Up next: your radio', keep the current song's context and toast 'after this song'. Add a toast with Undo to Explore's Start radio that restores the previous upcoming list.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js` · **Effort:** S
- **Evidence:**
  - d22-start-radio.mjs For you: before {playing 'Crooked Arcade', from 'My evening list'} -> after {playing 'Crooked Arcade', from 'Your radio', next3 [Static Satellite, Electric Current, Symphony No. 3…]}
  - d22-start-radio.mjs Explore demo-040: after {playing 'Crooked Arcade', from 'Radio: Amber Atlas', next3 [Paper Ferry, Velvet Avenue, Static Night]}, toasts: []
  - app.js:4314-4317 (if ctx.radio && started then clearUpcoming + enqueue); foryou.js:522; explore.js:546

### discovery-3 · high · Many buttons that spend YouTube searches show no cost badge, and rows that do show one leave it out of the accessible name

- **Where:** Cost badges (Explore, For you, preview bar)
- **Observed:** Real mode with the configured key (canRead true). Single-song rows and cards show 'Play ·100', but these buttons spend searches with no badge:
- the hero 'Play' on Explore for a found song (the stub recorded engine.play with videoId null, i.e. one search);
- the play overlay on album, EP and single cards, which opens the dialog and plays at once (101 units or more); none of the 5 album or 3 single cards had a badge;
- For you's 'Play them' on Airing today (engine.list, up to 10 searches) and the play button on each season anime card;
- the series lane's 'Add missing to queue' (cost in a hover tooltip only);
- Saved for later's 'Play all', 'Shuffle' and 'Add to queue' (2 of my 3 saved songs needed a search);
- the preview bar's 'Play on YouTube', a raw button that cannot carry a badge and that reads as if it leaves the app.
On rows that do show the badge, media.js overwrites the accessible name: the Play for 'Paper Comet' shows 100 but its aria-label is 'Play Paper Comet', so screen readers never hear the cost.
- **Why it matters:** Cost transparency, and consistency with the app's own rule: every action that may spend quota shows its cost as a badge (ds.css/ui.js btn), and the badge is part of the accessible name.
- **Proposed fix:** Have every action that can search compute its worst case with engine.estimate(finds) and pass it to U.btn: for one song, 100; for bulk actions, the number of songs that need finding capped by searchCap (show '≤3 searches' or the units). Rebuild the preview bar's button (app.js:5111) with U.btn, the label 'Play' and a cost. Add the cost tag to card overlays (explore.js albumCard, foryou.js releaseCard and animeCard). In media.js setCost (line 546), build the aria-label as 'Play ' + name + (c is 1 or 100 ? ', uses ' + c + ' YouTube units' : '').
- **Files:** `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js` · **Effort:** M
- **Evidence:**
  - d06-found-hero.mjs: hero buttons ['Play aria=null', 'Save for later'…]; pressing Play -> engine.play {title 'Lanterns Over Water', videoId null}; screenshot .../shots/explore-found-hero.png
  - d05-costs.mjs: album cards costBadge:false (5/5), single cards costBadge:false (3/3); Saved lane actions ['Play all','Shuffle','Add to queue'] with no data-cost while rows show cost=100; screenshot .../shots/cost-saved.png
  - d05-costs.mjs: row 'Paper Comet -> Play100 cost=100 aria="Play Paper Comet"'
  - explore.js:544 (hero Play), explore.js:325 and foryou.js:944 (card play opens the dialog and plays), foryou.js:675-681 (anime card), foryou.js:758 (Play them -> en.list searchCap 10), foryou.js:1167-1169 (Saved), app.js:5111 (preview bar raw button), media.js:546 (aria-label overwritten without the cost)

### discovery-4 · high · Explore's album dialog promises 'one search, about 101 units' for small releases, and its Add to queue sends out every lookup at once

- **Where:** Explore > artist lane > album/EP/single dialog
- **Observed:** Single 'Patient Kites' (0 of 3 songs in the library). The note says 'The others are found on YouTube when you play: the album's own list first (one search, about 101 units for all of them).' 'Play all' has no badge, and pressing it starts a list feeder that searches each of the 3 songs (up to 300 units). The note ignores `group`, which is false below 4 songs to find; For you's copy of this dialog says it correctly. On a 10-song album, 'Add to queue' started 10 lookups within 1 ms (no cap, library songs included). It said '10 songs added to the queue.' 1 ms after the press, before any song was found, then showed 10 separate failure toasts. The lookups finished in a different order from the album (Sleepless Embers first, Northern Rooftops last), and songs are queued as their lookups finish, so the queue order would not match the album. The album's 'Shuffle' also runs the 101-unit list lookup without a badge. Without a key or sign-in, each unknown song goes through playFind, which opens a YouTube search tab per song (app.js:4361-4363).
- **Why it matters:** Promises must match behaviour. Bulk actions should give one honest summary after the work is done and keep the order the person sees.
- **Proposed fix:** In explore.js albumDialog, write the note from `group` the way foryou.js:967 does ('a search each, 100 units' when fewer than 4 songs need finding), and show the cost on Play all and Shuffle in both cases. Route 'later' and 'next' through a shared sequential, capped helper (foryou.js queueFinds) that keeps album order and shows one summary toast at the end ('7 of 10 added; 3 not found on YouTube'). When canRead() is false, disable those actions or open one YouTube search for the album, not one per song.
- **Files:** `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - d05-costs.mjs Singles dialog: note '…one search, about 101 units for all of them', btns ['Play all','Shuffle','Add to queue'], rows each 'Play 100'; Play all -> engine.list {n:3, unresolved:3}; screenshot .../shots/cost-dialog-Singles.png
  - d05-costs.mjs Albums dialog: btns ['Play all101 (cost 101)','Shuffle','Add to queue']
  - d21-album-addqueue.mjs: '10 lookups started within 1 ms'; asked order [Gentle Bridges … Sleepless Embers] vs done order [Sleepless Embers, Crimson Lanes … Northern Rooftops]; toasts: '10 songs added to the queue. @+1ms' then 10 'YouTube found nothing that is surely …'
  - explore.js:347 (note), 349 (group = unresolved >= 4), 360-362 (buttons; the say() fires at once), 152 (finds.forEach(ctx.play.find)); compare foryou.js:967

### discovery-5 · high · A preview pauses the song you were listening to, and nothing brings it back

- **Where:** Preview bar
- **Observed:** With a song playing, starting a list of previews (pageCtx.previewList) paused the player. Closing the preview bar with its × left the player paused at every size I tried (1440x900, 1280x720, 1024x700, 800x600, 390x844, 844x390). When a list of previews runs out, the bar closes with 'That was the last preview.' and the song also stays paused. Each preview session ends in silence until the person finds the main Play.
- **Why it matters:** An interruption should be temporary: return people to where they were (user control and freedom).
- **Proposed fix:** In app.js pvStart, record pv.resumeId = ctl.current() when player.state() is 'playing'. In pvClose, and at the end of the list (pvPlay with no item), call ctl.toggle() if the player is still paused on that same song and nothing else was started. If auto-resume feels too pushy, show a toast 'Resume “<song>”' with an action instead.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - d07-pvbar.mjs, every size: 'before preview: playing' -> bar open: player 'paused' -> 'after closing the bar: player paused bar false'
  - app.js:5085 (pvPlay pauses the player with ctl.toggle()); app.js:5095 (pvClose only stops the preview); app.js:5084 (end of the list: pvClose and a message, no resume)

### discovery-6 · high · The preview bar can cover YouTube's player: it ignores the player-safe zone

- **Where:** Preview bar / YouTube terms
- **Observed:** `.ts-pvbar` is fixed and centred on the whole window (left: 50%, width min(980px, 100vw - 24px)), so on every wide window it lies across the player's column. On a phone in landscape (844x390, touch) it covers the bottom 84 of the player's 210 px (bar at 12,198 820x84; player at 578,73 246x210; 246x84 px overlap). At 1280x600 with the L player it covers a 606x10 px strip of the player and the S/M/L controls. At 1440x900 it spans x 230-1210 while the now-playing panel starts at x 1092, so only the vertical distance keeps it off the video. Toasts, job chips and dialogs already respect --ts-safe-right and --ts-safe-top.
- **Why it matters:** The app's own YouTube rule: the player stays visible and nothing covers it.
- **Proposed fix:** In app.css:940, position the bar the way .ts-toast and .ts-jobs are positioned: left: calc((100vw - var(--ts-safe-right, 0px)) / 2); width: min(980px, calc(100vw - var(--ts-safe-right, 0px) - 24px)). On short windows, where the bar's rectangle would meet the player's, dock it at the bottom of #main (sticky) instead of fixed. Register the bar with ui.js safe, and add a QA check that #pvbar never intersects #player.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/ui.js` · **Effort:** S
- **Evidence:**
  - d07-pvbar.mjs 844x390 mobile: overlapPx 20603 (246x84); screenshot .../shots/pvbar-844x390.png
  - d08-pvbar-sizes.mjs 1280x600 L: pv [150,408,980,84], yt [524,70,736,348], overlap 606x10; screenshot .../shots/pvbar-cover-1280x600-L.png
  - app.css:940 (.ts-pvbar positioning), app.css:949 (phone rule); ds.css:184,191-193 (.ts-jobs, .ts-modal-back, .kit-backdrop and .ts-toast use --ts-safe-right/--ts-safe-top)

### discovery-7 · high · 'Jump to' chips scroll the page but leave keyboard focus behind, and the next Tab scrolls back to the top

- **Where:** Explore and For you > Jump to chips (keyboard)
- **Observed:** Explore (demo-126): I focused the 'Your library' chip and pressed Enter. The view scrolled to 3,355 px but focus stayed on the chip. The next Tab landed on 'Play yours (10)' in the first lane and the page jumped back up. Reaching the 'From your library' lane from its chip takes 139 Tab presses. For you: Enter on 'New releases' then Tab focuses the 'Your channels' chip at the top again; reaching the lane takes 126 Tab presses.
- **Why it matters:** WCAG 2.4.3 Focus Order: in-page navigation must move focus to its target.
- **Proposed fix:** In both chip handlers, after scrollIntoView, focus the target lane's heading: lanes.js gives titleEl an id, so set tabindex=-1 and call .focus({ preventScroll: true }). Use smooth scrolling only when reduced motion is off (ToyKit.reducedMotion), as app.js viewWork does.
- **Files:** `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/lanes.js` · **Effort:** S
- **Evidence:**
  - d12-jump-keys.mjs: '#/explore/demo-126 Enter on "Your library": {active:"Your library", scrollTop:3355} -> Tab lands on {"Play yours (10)", y:411}'; 'Tab presses from the chip into the lane: 139'
  - d12-jump-keys.mjs For you: Tab after 'New releases' -> 'Your channels' chip; 126 presses
  - explore.js:569 and foryou.js:1379 (scrollIntoView only, no focus)

### discovery-8 · medium · On phones the preview bar has no Play, and its icon-only 'Not interested' hides the whole artist with no Undo

- **Where:** Preview bar (phone and desktop)
- **Observed:** At 390x844 the bar offers previous, pause, next, 'Save for later', an unlabelled ⃠ icon and ×. 'Open YouTube' / 'Play on YouTube' and 'Add' are display:none, because app.css:949 hides every .ts-btn--sm in the bar. A person who likes a preview on a phone therefore cannot play it from the bar. The ⃠ icon is 'Not interested in <artist>'. One tap hid Moth Radio from every suggestion: the toast said 'Moth Radio will not be suggested again.' with no Undo, and engine.hidden().artist.mothradio was set. Getting it back takes For you > Hidden > See them and show again. The same action in a row's menu does offer Undo (media.js:730).
- **Why it matters:** Keep the main next action available on every form factor. Destructive one-tap actions need a clear label and an Undo.
- **Proposed fix:** On phones, keep Play as a 40 px icon button with its cost badge and move Save and Not interested into a ⋯ menu (app.css:949 and app.js:5104-5116). Make hideArtist return engine.hide's undo and show U.toast(text, { action: 'Undo', onAction: undo }), as media.js hide() does. Offer 'this song' versus 'this artist' rather than hiding the artist by default.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - d07-pvbar.mjs 390x844: buttons [... 'Save for later 150x40', 'Open YouTube [HIDDEN]', 'Not interested in Moth Radio 40x40', ...]; screenshot .../shots/pvbar-390x844.png
  - d15-add-missing.mjs: toast {text:'Moth Radio will not be suggested again.', buttons: []}, hidden.artist {mothradio: …}
  - app.css:949; app.js:5114 -> hideArtist (app.js:4510-4513, say() without an action)

### discovery-9 · medium · Network failures are shown as 'nothing found', with a wrong reason and no Try again

- **Where:** For you > Because you play, Preview new songs, Preview missing
- **Observed:** With Deezer unreachable (hosts blocked, and again with Chrome offline), 'Because you play Paper Lanterns' settled as EMPTY: 'Deezer does not know your favourite artists, or you have not played enough yet.' It has no Try again, and the title right above says you play Paper Lanterns. 'Preview new songs' answered 'Deezer had nothing new for your taste just now.' 0.5 s after the press. 'Preview missing' would say 'iTunes has no previews of these songs.' for any iTunes failure. In each case the errors are swallowed and the empty message is shown.
- **Why it matters:** Tell an error apart from an empty result, and give the person the next step (retry or wait for the connection).
- **Proposed fix:** In becausePicks, keep the first SourceError and reject when no artist was found and at least one find failed, so lane 0 shows lanes.js's error state with Try again and its automatic retry. In previewNew and previewMissing, count failures and, when every request failed, say lanes.explain(err).text (for example 'Deezer did not answer. Check the connection, then try again.') instead of 'nothing new'.
- **Files:** `misc/101-true-shuffle/foryou.js` · **Effort:** S
- **Evidence:**
  - d04-real-blocked.mjs foryou: 'because-0 empty … Deezer does not know your favourite artists, or you have not played enough yet.' while the other lanes show errors; screenshot .../shots/real-foryou-full.png
  - d20-offline.mjs: the same empty text with navigator.onLine false
  - d16-preview-fail.mjs: ['Finding new songs to preview…', 'Deezer had nothing new for your taste just now.'] after 525 ms
  - foryou.js:1074-1076 (becausePicks drops errors), 1103 (empty text); 594 and 601 (previewNew); 841 and 844 (previewMissing)

### discovery-10 · medium · Lane errors name the wrong or a raw source, repeat in every lane, and the Sources row stays green while everything fails

- **Where:** Lane error states (Explore, For you)
- **Observed:** Explore's YouTube Mix lane, after 'Read the YouTube Mix' with YouTube unreachable, says only 'network'. player.js rejects with new Error('network') and lanes.explain falls back to the message. The player itself explains the same failure well (a blocker such as uBlock Origin, what to allow). 'From artists like Kumori Station — from Deezer' says 'iTunes did not answer…' (offline: 'iTunes cannot be asked'). This happens because similarLane calls artists.find for every store (explore.js:392), which also makes it wait for iTunes's 3.1 s request gap. Offline, Explore shows 4 and For you shows 4 nearly identical boxes ('This device is offline, so X cannot be asked…'), and the Mix lane still offers 'Read the YouTube Mix'. With five lanes failing, For you's Sources row still shows green checks on Deezer, iTunes, AnimeThemes and AniList.
- **Why it matters:** Error messages in plain language that name the real cause. Status indicators must reflect real state, and a page-wide failure should not become a wall of repeated warnings.
- **Proposed fix:** In player.js loadIframeApi, reject with a typed error {code:'network'|'timeout', host:'youtube'}, or map those messages in lanes.explain, and reuse the player's blocker wording. At explore.js:392, pass { sources: ['deezer'] } and spec.source 'Deezer'. When two or more lanes on a page fail for the same reason (offline, the same host down), show one page-level line ('Offline: new music loads again when you are back; your library lane still works') and shrink each lane to a one-line state. Hide 'Read the YouTube Mix' while offline. Feed http.stats() (down, failed) into foryou.js sourcesOf so the row shows 'not answering'.
- **Files:** `misc/101-true-shuffle/player.js`, `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/sources.js` · **Effort:** M
- **Evidence:**
  - d13-mix-panel.mjs: Mix lane after the press -> 'error: network'; screenshot .../shots/real-mix-after-press.png (the player's detailed message is visible beside it)
  - d04-real-blocked.mjs: similar 'From artists like Paper Lanterns | iTunes did not answer…' (lane sub 'from Deezer')
  - d20-offline.mjs: 'error boxes on the page: 5' on Explore and on For you
  - Screenshot .../shots/real-foryou-full.png: Sources row all ✓ above 5 error boxes
  - player.js:172 and 186; lanes.js:155; explore.js:392; foryou.js:469-483 and 565-573

### discovery-11 · medium · The green 'In your library' check also appears when you only have another version (live, cover), yet Play costs a search

- **Where:** Found songs vs your own (rows, anime lane)
- **Observed:** In Explore's anime lane, Paper Harbor ED3, Late Ferry OP1 and Northern Rooftops ED1 carry the green 'In your library' check, but the library only has their Live versions. Their Play reads 'YouTube' when signed out and 'Play ·100' in real mode. 'You have 10 of 13 songs' counts them, and the 'Missing 3' filter leaves them out. The cause: media.js sets `mine` for any same-song match, but Play is free only for the same recording.
- **Why it matters:** Consistency between what a mark says and what the button does; recognition rather than recall.
- **Proposed fix:** In media.js, when it.mine && !it.sameRecording, show a distinct mark (a hollow check titled 'Live version in your library', or a 'Your: Live' tag) and add a free 'Play your version' item to the row menu. In explore.js shapeWork (and works.mineIn), count only same recordings as 'have', or say '10 of 13 (3 as other versions)', and include other-version songs under 'Missing'.
- **Files:** `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/works.js` · **Effort:** M
- **Evidence:**
  - d03-rows.mjs: 'Paper Harbor [mine] play: YouTube, tip: Search YouTube in a new tab…'; the same for Late Ferry and Northern Rooftops
  - d05-costs.mjs real mode: 'Paper Harbor [mine] -> Play100 (cost 100)', 'Late Ferry [mine] -> Play100'; screenshot .../shots/cost-work-lane.png
  - The library lane shows them as 'Late Ferry OP Live', 'Paper Harbor ED Live', 'Northern Rooftops ED Live' (.../shots/explore-anime-dark-full.png)
  - media.js:133 and 139 (mine), 142 (sameRecording), 266 (cost free only with sameRecording), 505 (mineMark); explore.js:222 (have counts any mine)

### discovery-12 · medium · Found songs change their name once they play, and nothing marks them as found or explains how to keep them

- **Where:** Found songs while playing (channel page, bar, queue, now-playing)
- **Observed:** On the channel page a row reads 'Silver Static — Moth Radio · 3 weeks ago'. After 'Play what's new to you', the bar and now-playing panel show 'Moth Radio - Silver Static' by 'cassette drawer' (the channel, in italics as a guess), and the queue rows look the same way. The panel then asks 'The artist is not sure. Who is it? By Moth Radio? / By Silver Static? / Someone else…' about a song that is not in the library. Nothing in the bar, panel or queue says the song is a find rather than yours. engine.listened also silently adds a find to the library (playlist Discovered) once it has been finished twice, with no toast.
- **Why it matters:** Consistency (a song keeps its identity everywhere) and visibility of status (what is mine versus what was found, and what will happen to it).
- **Proposed fix:** In channel.js toFind, pass the parsed title and artist as structured fields (the registry lets them win) and keep the upload title as `raw`. For transient tracks, add a 'Found · not in your library' line with Keep (engine.keep) and Save (B) to the now-playing panel, plus a small marker on queue rows, and hide the artist fixer. When engine.keep runs on its own, toast 'Added to your library (Discovered): you finished it twice.' with Undo.
- **Files:** `misc/101-true-shuffle/channel.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/engine.js` · **Effort:** M
- **Evidence:**
  - d11-found-playing.mjs: barText 'Moth Radio - Silver Static / cassette drawer', nowInfo [title 'Moth Radio - Silver Static', artist 'cassette drawer'], queue 'Velvet Kites - Night Blue / cassette drawer'
  - Screenshot .../shots/found-playing-desk.png (the row reads 'Silver Static / Moth Radio'; the panel shows the raw title and the artist fixer)
  - channel.js:314-317 (toFind passes f.raw as the title); engine.js:231 (keep() after keepAfterPlays, no notice)

### discovery-13 · medium · Discovery pages are long and open with chrome: For you shows no recommendation in its first screen

- **Where:** For you and Explore page structure
- **Observed:** For you at 1440x900: the first screen holds the header blurb (3 lines), 8 jump chips and the radio panel (dial, a two-line quota sentence, the Sources row). The first recommendation ('This season's anime') starts at 769 px in the scroll area, just below the fold. The page is 5,085 px (6.9 screens; about 5,360 px, 8 screens, on a phone) with 11 lanes. Explore for an anime song is 4,033 px (5.5 screens; 6.4 on a phone, where no song row is visible in the first screen). Unavailable or empty lanes still take about 120 px each (demo: Mix and Similar; For you: Saved and Hidden), and the jump chips link to them without saying they are empty. Explore's anime lane opens on 'All 13', where 10 songs are ones you already have.
- **Why it matters:** Prioritise content over chrome on discovery surfaces, and progressive disclosure for status and configuration.
- **Proposed fix:** Collapse unavailable and empty lanes into one footer line ('Also: Read the YouTube Mix · add a Last.fm key for similar songs') and drop their jump chips. Feed lane state into the chips with counts ('New releases 16'). Put the Sources row and the quota sentence behind an 'About these sources' disclosure in the radio lane, and cut the For you blurb to one line so a shelf shows in the first screen. On Explore, default the anime filter to 'Missing' when anything is missing.
- **Files:** `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/lanes.js` · **Effort:** M
- **Evidence:**
  - d09-foryou-demo.mjs desk-dark: scrollH 5085, clientH 738, season lane top 769; screenshots .../shots/fy-desk-dark-top.png and fy-desk-dark-full.png
  - d02-explore-demo.mjs: anime-dark scrollH 4033 (7 lanes); anime-phone scrollH 4264, first lane top 575; mix and similar unavailable at h 120 (148 on the phone); screenshot .../shots/explore-anime-phone-top.png
  - d09: saved and hidden empty at h 120 each; jump chips include 'Saved'

### discovery-14 · medium · Saved for later can only be reached at the bottom of For you

- **Where:** Saved for later (information architecture)
- **Observed:** The bookmark on found songs, the preview bar's 'Save for later' and the B key all put songs in Saved for later. The list exists only as the 10th of For you's 11 lanes (top at 4,732 of 5,085 px). It has no sidebar entry (Liked songs has one), no entry in the phone Library hub, no palette entry, and the save toast does not link to it.
- **Why it matters:** Findability: a 'come back to it' list needs a stable home that is one step away.
- **Proposed fix:** Add 'Saved for later' with a count to the sidebar under Listen, to viewLibrary and to the palette. Make the save toasts' action 'Open' (to #/for-you?lane=saved). Move the Saved lane up to just after Your radio whenever it has items.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/foryou.js` · **Effort:** S
- **Evidence:**
  - d09-foryou-demo.mjs: saved lane top 4732, page scrollH 5085
  - grep: 'Saved for later' appears in app.js only in toasts (4978, 4986, 5690); the viewLibrary items (app.js:2547-2552) and the sidebar sections (app.js:684-700) have no entry for it

### discovery-15 · medium · The artist page buries its discovery lane, and the work page has none

- **Where:** Artist page #/artist/<key>, work page #/work/<name>
- **Observed:** Artist page (Paper Lanterns, 26 songs): 'More by Paper Lanterns' (their releases and the songs you lack) starts at 2,427 px, 2.7 screens down, after the full song list (about 64 px per song) and Sounds like. Nothing in the header points to it, and its default 'Top songs' tab lists 12 songs of which 8 are yours and are already listed above. Work page (Kumori Station Anime): only the library's 10 songs and 'Artists here'. It has no route to the openings and endings you are missing, though Explore's anime lane and For you's series lane already compute them.
- **Why it matters:** Put discovery where the intent is: someone on an artist or anime page asking 'what else is there?' should not have to scroll past everything they already have.
- **Proposed fix:** In viewArtist, add a header action 'New to you' that scrolls to and focuses the artist lane, cap Songs at 10 with 'Show all 26', and default the artist lane to songs not in the library (or show yours after the rest, dimmed). In viewWork, mount explore.section(view, pageCtx, seedOf(the work's first track), ['work']), or add a 'Songs you don't have' button linking to #/explore/<first id>?lane=work.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/explore.js` · **Effort:** M
- **Evidence:**
  - d10-pages-demo.mjs artist: headings at '436: H2 Songs', '2122: H2 Sounds like', '2427: H2 More by Paper Lanterns'; screenshot .../shots/pg-artist-full.png
  - d10-pages-demo.mjs work: lanes [], exploreLinks []; screenshot .../shots/pg-work-full.png
  - app.js:2188-2207 (viewArtist: song list, then artistMore); app.js:2449-2499 (viewWork: no explore section)

### discovery-16 · medium · The YouTube quota is explained in 'units', in five different wordings, and never in terms of songs

- **Where:** Cost badges and quota comprehension
- **Observed:** The cost badge is a meter icon and '100'. Its explanation lives only in a hover title ('uses 100 of today's YouTube units'), which touch screens never show, and Explore never explains units at all. The same budget is described in five ways:
- Settings: 'YouTube quota used today: N of 10,000 units'
- the bar's More menu: 'A search for a song uses 100; 8,500 left for finding songs (1,500 kept for imports and adds)'
- For you: '0 of 10,000 units used, 8,500 left … The radio spends 0 of its own 300'
- the album note: 'about 101 units'
- the Add button: '151 quota units'; errors say 'allowance'.
With 8,500 units left a person has about 84 song searches; that figure never appears.
- **Why it matters:** Speak the user's language: express cost in the thing being spent (song searches), with one consistent term.
- **Proposed fix:** Add one shared wording helper (pageCtx.words.quota, based on engine.quota()) such as 'About 84 song searches left today (each search uses 100 of 10,000 units)'. Show it as one line under Explore's hero and For you's radio, and in a popover that opens when the cost badge is tapped (touch). Use 'searches' and 'units' consistently in Settings, the bar's More menu and the dialogs.
- **Files:** `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js` · **Effort:** M
- **Evidence:**
  - d05-costs.mjs quota words: 'YouTube today: 0 of 10,000 units used, 8,500 left for finding songs (1,500 kept for imports). The radio spends 0 of its own 300. It starts again at midnight Pacific time.'
  - media.js:275-279 and 540 (title only); app.js:3021, 4176, 5302; foryou.js:488; explore.js:347; app.js:4374 ('allowance')
  - d18-phone-costs.mjs: on 390 px the only cue is the '100' badge (title tooltips are not available on touch)

### discovery-17 · medium · On a phone, the 'Play ·100' pill squeezes found-song titles to about 9 characters

- **Where:** Found-song rows at 390 px
- **Observed:** Real mode, Explore's anime lane with the Missing filter, 390x844. The Play pill with its cost badge is 86x32 px. Together with the 'Insert' tag, Play next and More, it leaves room for about 9 characters of title: 'Kazemachi…', 'Shiosai Me…', 'Komorebi …'. These are the songs a person is trying to recognise.
- **Why it matters:** Content first on small screens: the title is the primary information in a song row.
- **Proposed fix:** In media.js's narrow rules (max-width 560 px or 760 px), show the cost as a compact badge on the artwork corner (as cards do with .ts-m-ctags), keep Play icon-only at 32 px, move 'Play next' into the row menu for found rows, and let the role tag wrap to the sub line.
- **Files:** `misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - d18-phone-costs.mjs: 'Kazemachi Ticket | play visible text: "Play 100" 86x32'; screenshot .../shots/phone-cost-work.png
  - media.js:396-413 (narrow rows hide the label but keep the badge inside the pill)

### discovery-18 · low · 'From your library' lists the same song in more than one group

- **Where:** Explore > From your library
- **Observed:** Real mode with listening history. For demo-126 the lane shows 12 rows for 10 songs: x3-demo-127 and x5-demo-045 appear in both 'You often play with it' and 'Sounds close'. For demo-002 it shows 7 rows for 5 songs. Only the 'Also from <work>' group is removed from 'Sounds close'.
- **Why it matters:** Avoid redundancy: each song once per lane.
- **Proposed fix:** In explore.js libraryLane, remove ids already in `tog` from `work`, and ids in `tog` or `work` from `close`, keeping each song in its first group.
- **Files:** `misc/101-true-shuffle/explore.js` · **Effort:** S
- **Evidence:**
  - d14-library-lane.mjs: {id:'demo-126', rows:12, unique:10, dups:['x3-demo-127','x5-demo-045']}, {id:'demo-002', rows:7, unique:5}
  - Screenshot .../shots/real-explore-full.png ('Late Ferry' and 'Hollow Compass - Narrow Avenue' repeated)
  - explore.js:446-452 (close filters only against work)

### discovery-19 · low · Every row of a single-source lane repeats the lane's source badge

- **Where:** Lane rows (visual noise)
- **Observed:** Explore (demo-126): all 12 rows of 'More by Kumori Station' carry 'iTunes', and all 6 rows of the channel lane carry 'Channel', under lane titles that already have their own badge. For you: all 10 Airing today rows and all 3 series rows carry 'Anime'. The repeated pills add weight to every row and pull the eye away from the one difference that matters: yours or found, and its cost.
- **Why it matters:** Minimalist design: show information where it distinguishes something.
- **Proposed fix:** In lanes.js rowOpts, pass badge:false when every item's media.sourceBadge equals the lane's badge kind, or more generally show a row badge only when it differs from spec.badge.
- **Files:** `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - d03-rows.mjs: badge 'iTunes' on 12/12 artist-lane rows
  - Screenshots .../shots/explore-anime-dark-full.png (channel lane: 'Channel' x6) and .../shots/fy-desk-dark-full.png (Airing today: 'Anime' x10)
  - media.js:451-455 and 522-526 (a badge on every row); lanes.js:653-658 (rowOpts never turns it off)

### discovery-20 · low · For you's OP/ED chips on season cards are 22 px tall touch targets that the touch hit-area rule does not cover

- **Where:** For you > This season (phone)
- **Observed:** On a 390 px touch screen, the 41 theme chips (OP1, ED1 …) on the season cards measure 53x22 px with 4 px gaps, and a tap 12 px above or below the centre misses. These chips are the only way to open a particular opening or ending. .ts-fy-theme is not in ds.css's coarse-pointer hit-area list, which covers .ts-chip, .ts-btn--sm/md and others.
- **Why it matters:** Touch targets of about 44 px, which the app already applies to its other small controls.
- **Proposed fix:** Add .ts-fy-theme to ds.css's coarse-pointer block (position: relative; ::after { inset: -8px 0 }) and raise its gap to 8 px, or render the chips with U.btn({ variant: 'chip' }) so they get the shared rule.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/foryou.js` · **Effort:** S
- **Evidence:**
  - d17-phone-targets.mjs: '.ts-fy-theme {n:41, w:53, h:22, tapUp12:false, tapDown12:false, gapToNext:4}'
  - ds.css:196-205 (the list of controls given hit areas); foryou.js:1304 (.ts-fy-theme line-height 20px)

## Lens: search-ia

<details><summary>What this auditor covered</summary>

- Read README (file table, The page, views, terms table, fuzzy.js, Addresses) and the app.js parts for NAV/TABS/SECTION_OF, renderNav, onRoute/renderView (scroll memo, title, h1 focus), viewSearch, wireShell search box, wireKeys, paletteEntries/openPalette/ACTIONS, scopeTracks/setFocus/renderFocusBtn/focusMenu/createList/scopeButtons, viewLibrary, entity views' empty states, lyrics.searchSection, fuzzy section, actions.js VOCAB/KEYMAP, ui.js icon/router, app.css sidebar and phone rules
- Route table (demo, 1280x860): 39 routes plus 11 unknown or missing ones (#/nonsense, #/c/bogus/x, #/artist/x, #/track/x, #/work/x, #/genre/x, #/c/mood/x, #/list/x, #/person/x, #/family/x, #/explore/x). For each: document.title, h1, lit section, lit phone tab and where focus lands (out/routes.json)
- Real mode with all outside hosts blocked (Google, YouTube, AnimeThemes, AniList, iTunes, LRCLIB, Deezer, MusicBrainz, jsDelivr and others), library built in IndexedDB from the shipped labels.json (1,855 songs, 995 artists, 421 works, 3,000 history rows). The database was dropped after each run, nothing was played and no quota was spent
- Header search: typed key by key (URL, history entries, title, h1, focus); Escape, Enter, ArrowDown, the Tab path to the first result, live-region announcements, time per keystroke (1-5 letters). The results page measured for 31 queries: section order, first-song y, duplicate cards, the lyrics section, facet words, romaji, kana, kanji, typos. Close matches checked with oregiru, kalafna, kiminoshiranai and aimer
- Command palette (Ctrl+K): the empty state, about 40 queries for ranking, duplicates, missing places and actions, junk matches. Also tested: arrow keys, Home, Tab, Enter on a song (it plays at once) and the accessibility tree (no combobox role, no activedescendant)
- Sidebar: names, groups and order of the 21 sections. How much is visible, and the scroll needed to reach the first playlist, at 1366x768, 1440x900, 1536x864, 1920x1080 and 2560x1440. Icon-only rail at 1100 px and in theater mode: accessible names from the AX tree, plus hover tooltips
- Phone 390x844 with touch: Search tab, width of the header field and its placeholder, results for oregairu and yanagi nagi, the Library hub (18 entries, its links), which tab is lit on 7 routes, whether Liked songs and the Mix builder can be reached, aria-current on the tab bar, and the Focus pill
- Back and forward: scroll restore on Songs (virtual list), Artists, Works, Search results, Home and Genres. Also For you and Explore in the demo, keyboard Enter then Alt+Left, Tab after Back, and the header's own Back and Forward on the first page of a visit
- Focus: the home 'Work with part of your library' chips (each click saves a playlist), the pill menu, and 'New hand-picked playlist' (Focus is ticked by default). Also the effect on Up next, 18 pages while focused, search, the palette and 'Shuffle these' while focused, links from the player bar and the now-playing chips, 'Shuffle everything' while focused, and the phone pill
- First run in real mode (empty library): what each of the 21 sections shows, and search on an empty library
- Themes dark and light. Desktop widths 1100-2560, phone 390. Screenshots in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots and scripts s1-s19 in the same folder; the repo was not modified

</details>

### search-ia-1 · high · Creating a playlist turns on Focus by default, so a new empty playlist empties every page of the app

- **Where:** Focus / playlists
- **Observed:** Playlists > 'New hand-picked playlist' opens a dialog with 'Focus on it now (the whole app works inside it)' ticked, and the note '0 songs to start with. Add more from any song's menu.' After Create ('Road trip'), #/songs, #/artists, #/ and #/search?q=glass all show only 'Inside Road trip · 0 songs' and 'Nothing in “Road trip” yet.' So there is no song anywhere to add from, which is the next step of the task. In the default true-shuffle mode, setFocus also rebuilds Up next from the focused list: 9 upcoming songs dropped to 0. The current song kept playing, and leaving focus brought 8 back.
- **Why it matters:** Error prevention and user control: a mode with app-wide effects should never be the silent default of a creation step. Never leave people in a state where the material for their next step is hidden.
- **Proposed fix:** app.js createList: tick the box only on request (checked: opts.focus === true) and hide the checkbox when the playlist would have 0 songs. Pass { focus: false } from the 'New hand-picked playlist' button (app.js:3403). Give the empty hand-picked list page (viewList empty text, app.js:3463) a 'Find songs to add' button to #/songs. In setFocus, keep the current Up next when the new scope is empty or much smaller instead of rebuilding it.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s14-newlist.mjs: dialog {checkbox:true,label:'Focus on it now (the whole app works inside it)',note:'0 songs to start with…'}; after Create every route shows 'Nothing in “Road trip” yet. Show everything'
  - s15-focusqueue.mjs (true shuffle): before upcoming 9, after 0, after leaving focus 8
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/newlist-dialog.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/newlist-songs.png
  - app.js:3403 createList('manual', { ids: [] }, '') passes no opts; app.js:3312 checked: opts.focus !== false; app.js:3272-3282 setFocus -> applyPlan({})

### search-ia-2 · high · While focused, links to the playing song's artist or genre say it doesn't exist, and search contradicts itself

- **Where:** Focus / navigation
- **Observed:** Demo, focused on the smart playlist 'Anime' (10 songs) while a Paper Lanterns song plays. The player bar's artist link opens #/artist/paperlanterns: 'No artist here. It may have been renamed or merged.' with no heading and the tab title 'True Shuffle'. The now-playing chip opens #/genre/Alt J-rock: 'No songs in “Alt J-rock” yet.', though 26 such songs exist. #/c/mood/bright says 'Nothing here yet.'. Searching 'paper lanterns' lists 'Songs (26)', because songs are searched over the whole library, but shows no Artists shelf, because shelves use the focused index. Its own 'Shuffle these' then answers 'Nothing playable here.', and the palette finds nothing for the same words. Focus is saved and restored on the next visit (app.js:5821), so bookmarks and links opened days later hit the same false messages.
- **Why it matters:** Messages must state the real cause and offer a way out. The same query should give the same answer on every surface.
- **Proposed fix:** Add outOfFocus(kind, key) for viewArtist, viewGenre, viewFamily, viewFacet, viewWork and viewPerson. When the focused idx() misses but the whole library has the item, draw the page from the whole library under a banner: '<name> is outside “Anime” (0 of its 26 songs are in it) · Show everything'. If that is too much, at least show that true sentence with Show everything and Open anyway. In viewSearch call L.search(lib, qtext, scopeTracks()) so songs, shelves, close matches, the palette and Shuffle these agree. When focused, add a line under the h1: 'Searching inside “Anime” · Search everything', which leaves focus and keeps q.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - s9-focus2.mjs: bar artist link -> 'Inside Anime · 10 songs Show everything No artist here. It may have been renamed or merged.'; now-playing chip -> 'No songs in “Alt J-rock” yet.'; Shuffle these -> status 'Nothing playable here.'; palette 'paper lanterns' -> []
  - s8-focus.mjs: '#/artist/paperlanterns | h1: null | empty: No artist here…', '#/genre/Indie%20rock | empty: No songs in “Indie rock” yet.', search 'paper lanterns' while focused: Songs (26), scope 6, inScope 0
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/focus-bar-artist.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/focus-search-shuffle.png
  - app.js:2011 L.search(lib, qtext) without scope vs app.js:2012-2016 idx() (scoped) vs app.js:4792 palette L.search(lib, qtext, scopeTracks()); messages at app.js:2168, 2248, 2264

### search-ia-3 · high · On a phone, Liked songs, Mix builder and Paste a list can't be reached; the Library hub is a flat 18-row list

- **Where:** Phone Library hub / IA
- **Observed:** At 390x844, #/library lists 18 links of about 75 px each (1,517 px of scroll): Songs, Artists, Channels, Genres, Moods & scenes, Anime..., Your numbers, For you, Playlists, Map, History, Quick labeller, Your year, Guess the anime, Rank your songs, Car mode, Needs attention, Settings. None goes to #/liked or #/mix, and neither Home nor the Playlists page links to #/liked. The only ways in are the desktop sidebar (app.js:687) and Ctrl+K (app.js:4783), so the heart and the 'Added to Liked songs.' toast lead nowhere on a phone. 'Paste a list of songs' (#/paste) exists only as a palette action (app.js:4813), and a phone has no palette. On #/liked no bottom tab is lit. In the hub, Playlists is row 9, behind the mini player. For you repeats its own bottom tab, and Your numbers comes before Playlists.
- **Why it matters:** Findability: every main collection needs a way in on every device. A Library tab should lead with the listener's own collections.
- **Proposed fix:** Rebuild viewLibrary as titled groups, own music first. 'Your music': Liked songs (count), Playlists, the playlists themselves as rows (swatch and name, like #stations), Songs, Artists, Anime, games & stage. 'Browse': Genres, Moods & scenes, Channels, Map. 'Your listening': History, Your numbers, Your year. 'Make & tidy': Mix builder, Paste a list, Quick labeller, Rank your songs, Guess the anime, Car mode, Needs attention, Settings. Drop For you from the hub, since it is a tab. Add a 'View' action to the like toast (to #/liked). Work out which routes light the Library tab from the hub's own keys plus SECTION_OF, so #/liked, #/rescue and #/paste count.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - s11-phone.mjs: 'hub links: #/songs #/artists #/channels #/genres #/browse #/works #/stats #/for-you #/lists #/map #/history #/label #/wrapped #/quiz #/duel #/car #/fix #/settings'; '#/lists links to liked/mix? none'; 'home links to liked/mix? none'; 'tab lit on #/liked -> (none)'
  - grep: links to #/liked exist only at app.js:687 (NAV) and app.js:4783 (palette); #/paste only at app.js:4813
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/phone-library.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/phone-library-full.png
  - app.js:2544-2556 viewLibrary items; app.js:723 hand-kept list of routes that light the Library tab

### search-ia-4 · high · Search results push songs below the fold behind a repeated top card (10 of 13 queries; on a phone, every time)

- **Where:** Header search / results page
- **Observed:** Library from labels.json at 1280x860; the results area is about 698 px tall. First song row, in px from the top: oregairu 830, bocchi 873, yanagi nagi 813, sakura 857, supercell 813, evangelion 830, les mis 848, yoasobi 813, rock 957, op 1010. Only hikari (551), anime (600) and piano (592) show a song without scrolling. In 5 of 19 queries (oregairu, evangelion, yoasobi, yanagi nagi, supercell) the 'top' card is repeated as the first or only card of the shelf just below it. On a 390x844 phone, 'oregairu' fills the screen with two identical Oregairu cards and the first song starts at y=783 of 670 px. The cards' play button shows only on hover on desktop and is hidden on phones (app.css:637). In real mode, any query of 3+ words or 12+ characters puts 'Songs with these words (lyrics)', a press-to-search on LRCLIB, above the library's own results. Close matches use the button 'Play these', exact results 'Shuffle these'.
- **Why it matters:** Put the most likely target, songs, on the first screen. Don't show the same item twice in adjacent groups.
- **Proposed fix:** viewSearch: start with one 'Top result' row: the best match (artist, work or facet) with visible Play and Shuffle, beside the first 4-5 songs as compact rows. Then 'Songs (n)' with the full list, then the Artists and Anime shelves. Leave out of those shelves the item already shown as Top result (filter by key), and skip a shelf that would be left empty. Move TS.lyrics.searchSection below the songs. Use one label ('Play these' or 'Shuffle these') for both exact and close songs.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/fuzzy.js` · **Effort:** M
- **Evidence:**
  - s3-search.mjs output, C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/out/search-anatomy.json
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/search-oregairu.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/phone-search-oregairu.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/phone-search-yanagi.png
  - s11-phone.mjs: phone 'oregairu' {firstSongY:783, mainH:670}
  - app.js:2018 lyrics section first; 2023-2024 top card; 2031-2032 shelves include the same entity; 2033-2036 songs last; fuzzy.js:424 'Play these'

### search-ia-5 · high · Icon-only sidebar (761-1180 px and theater mode): 21 links with no accessible name and no tooltip

- **Where:** Sidebar accessibility
- **Observed:** At 1100 px, all 21 links in the 'Sections' nav have an empty accessible name in the AX tree. The same holds at 1280 px in theater mode (T); at a plain 1280 px all 21 are named. The links have no title attribute and show no tooltip on hover. The labels are display:none (app.css:551 and 839) and the icons are aria-hidden (ui.js:149). Some icons look alike: Channels, Anime, games & stage and Guess the anime are all screen glyphs. At these widths the Needs attention count and the whole Playlists list are hidden too, so playlists can't be opened from the sidebar.
- **Why it matters:** WCAG 2.2 4.1.2 Name, Role, Value and 2.4.4 Link Purpose. Icon-only navigation needs a label on hover and focus.
- **Proposed fix:** renderNav (app.js:708-720): give each a.ts-nav-a aria-label=it.label and title=it.label, and put the count in the label ('Needs attention, 22 unsure'). In app.css, at <=1180 px and in body.is-theater, hide .ts-nav-label with a visually-hidden clip instead of display:none, and add a small tooltip on :hover and :focus-visible. Give Channels, Anime and Guess the anime distinct icons. In the rail, show playlists as 32 px swatches with their names as titles instead of hiding #stations.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - s10-nava11y.mjs: '1280px | nav links: 24 with a name: 24'; '1100px | nav links: 21 with a name: 0 | titles: 0'; '1280px theater | nav links: 21 with a name: 0'; hover tooltip: none
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/nav-1280-theater.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/home-1100-dark.png
  - app.css:551 and 839 hide .ts-nav-label, .ts-nav-sep, .ts-side-sec, .ts-nav-count; app.js:713 links built without aria-label/title

### search-ia-6 · high · Search and the palette give screen readers no feedback, and the keyboard can't jump from the search box to the results

- **Where:** Header search / palette accessibility
- **Observed:** Typing 'glass' (Artists plus 23 songs) and then 'glasszzq' (Nothing found) in the header box changed the #status live region 0 times. Enter and ArrowDown leave focus in the box. Getting from the box to the first song row takes 34 Tab presses (3 header controls, 24 sidebar links, 7 in the results); 35 on the 1,855-song library. The palette input is a plain searchbox with aria-controls. Its listbox has no name, the options have no ids and there is no aria-activedescendant. ArrowDown therefore moves the highlight without any announcement (#status stays '').
- **Why it matters:** WCAG 4.1.3 Status Messages and 2.4.1 Bypass Blocks; the ARIA APG combobox pattern.
- **Proposed fix:** Header search: after drawing results, say('n songs, n artists, n anime' or 'Nothing found for …'), debounced about 500 ms. On Enter or ArrowDown in #search (a submit or keydown handler in wireShell), move focus to the Top result or the first .ts-row. Palette: give the input role=combobox, aria-expanded=true, aria-autocomplete=list and aria-activedescendant pointing at the active li. Give the ul aria-label='Results' and each li id='ts-pal-'+i, and announce say(items.length + ' results') after draw().
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s13-searchfeedback.mjs: 'typing "glass": live-region updates: []', 'typing "glasszzq": live-region updates: []'
  - s18-tabpath.mjs: 'Tabs to the first song row: 34 {header:3, side:24, main:7}'; s5-searchkeys.mjs: 'ArrowDown from box: focus INPUT#search', 35 Tabs on the real library
  - s4-palette.mjs AX: 'searchbox "Search everything" controls', 'listbox ""', options without activedescendant; 'status after ArrowDown: ""'
  - app.js:5736-5745 (search wiring), app.js:4821-4856 (openPalette)

### search-ia-7 · medium · Sidebar: 21 sections in two mislabelled groups; your playlists start below the fold on every screen up to 1920x1080

- **Where:** Sidebar IA
- **Observed:** NAV (app.js:673-696) has 21 links under 2 headings. LIBRARY includes For you (new songs you don't have yet) and Map. LISTEN includes Your year, Guess the anime, Rank your songs, Your numbers, Quick labeller, Needs attention and Settings, so 7 of its 11 entries aren't about listening. Everyday places, Playlists (11th) and Liked songs (12th), sit below Channels and Map. The playlists list always starts at y=1014. Sections visible, and scroll needed to reach the first playlist: 1366x768: 13 of 21, 394 px; 1440x900: 16 of 21, 262 px; 1536x864: 15 of 21, 298 px; 1920x1080: 21 of 21, 82 px. Only 2560x1440 shows them without scrolling. Dragging songs onto a sidebar playlist therefore usually starts with scrolling the sidebar.
- **Why it matters:** Group by goal and how often each place is used, and keep the listener's own content above the fold (progressive disclosure, Hick's law).
- **Proposed fix:** Regroup NAV. Top: Home, Search, For you. 'Your music': Liked songs, Playlists, Songs, Artists, Anime, games & stage, Genres, Moods & scenes, Channels. 'More', collapsible with its state saved via ToyKit.store: Map, Mix builder, History, Your numbers, Your year, Guess the anime, Rank your songs, Quick labeller. Pin Needs attention (with its badge) and Settings to the bottom of .ts-side (sticky). That leaves about 12 rows (~470 px) above the playlists, so they show at 1366x768.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css` · **Effort:** M
- **Evidence:**
  - s12-sidebar.mjs output (three playlists created)
  - s2-shots.mjs: sidebar scrollHeight 1068 vs clientHeight 698 at 1280x860; stationsTop 1014
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/sidebar-1366x768.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/home-1280-dark.png

### search-ia-8 · medium · Search ignores the labels the library is organised by: moods, scenes, roles, languages and years return a chip or nothing

- **Where:** Header search
- **Observed:** The labels.json library has 620 Wistful, 424 OP, 306 ED, 115 insert, 270 visual novel and 122 VTuber songs. 'wistful' gives one 26 px 'Wistful' chip and an otherwise empty page. 'insert' gives nothing at all. 'opening' finds 9 title matches and 'ending' 3. 'op' gives 'Songs (1,230)', 17 genre chips (every '...pop') and artists such as Mori Calliope. 'vtuber' gives a chip and 1 song, 'visual novel' a chip only, and 'vn' no Visual novels chip at all. 'japanese' finds 11 title matches and no language. '2019' finds 1 song. L.search matches genres and tags but not mood, scene, role, language or year (library.js:1062-1064). The page's chips match genres, moods and scenes only, by display name and substring (app.js:2012-2016). Yet the 'Nothing found' text promises 'genres and moods'.
- **Why it matters:** Match between the system and the real world: search should know the app's own vocabulary. A facet that matches deserves a real result, not a footnote.
- **Proposed fix:** In viewSearch, add facetHits(qtext). Fold and singularise the query and map synonyms: op/opening(s) to role OP, ed/ending(s) to ED, insert, ost, vn/visual novel to scene vn, vtuber, inst/instrumental to language inst, language names, and 4-digit years to decade or year added. Match against MOODS, SCENES (name and key), ROLES, LANGS, FAMILIES, decades and addedY. When the whole query names a facet, make it the Top result card (name, count, Play, Shuffle, Open) and list its songs; partial matches stay chips. For 1-2 letter queries, match chips and artists only at word starts.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/library.js` · **Effort:** M
- **Evidence:**
  - s3-search.mjs runs (two query sets) with first-row positions and section lists
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/search-wistful.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/search-op.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/search-insert.png
  - labels.json counts: roles {ED:306, OP:424, insert:115…}, moods {wistful:620…}, scenes {vn:270, vtuber:122…}

### search-ia-9 · medium · Command palette: no places when empty, letter-by-letter junk matches, repeated entries, and songs ranked last

- **Where:** Command palette
- **Observed:** Opened empty, Ctrl+K shows 14 actions and no pages or recent items, including 'Leave focus (not focused)'. 'rescue' gives 9 results, all long voice-actor credits that contain those letters in order, and no 'Songs gone from YouTube' page. 'help' gives 8 such results. 'stats' gives 'Start radio from the playing song', 'Paste a list of songs' and 12 junk artists, but not Your numbers. 'car', 'sleep', 'import', 'sign in', 'voice' and 'people' find no Car mode, Sleep timer, Settings section or Voice actors. 'liked' lists 'Page: Liked songs' twice. 'anime' and 'year' list Guess the anime and Your year both as an Action and as a Page. For 'hikari', the artist 'Karen Aijo (CV…) & Hikari Kagura (CV…) (1 song)' ranks above 8 songs titled ひかり/光, because every song gets a flat score of 15. 'yanagi' shows 春擬き (yanaginagi) four times, identical. 'kalafina' gives 'Nothing matches.' with no way on to the full search. The palette opens only with Ctrl+K and has no button, so phones can't open it.
- **Why it matters:** Recognition over recall. Quick-switchers need precision before recall, no repeated entries, and a way through to full search.
- **Proposed fix:** In paletteEntries, drop the letters-in-order fallback (or allow it only for names of 20 characters or fewer and queries of 4+) and use TS.fuzzy.rankNames for typos. Score songs with score(title) plus score(artist) instead of a flat 15. Remove the extra 'Liked songs' add and the Action twins of NAV pages. Merge songs with the same title and artist into one row '(4 uploads)'. Make the empty state Recent (the last 5 places opened) plus Pages. Show context actions only when they apply: Leave focus only when focused, Like only when a song is loaded. Add Songs gone from YouTube, Voice actors, Car mode, Sleep timer, Openings/Endings and the Settings sections. Always end the list with 'Search for "q"' (to #/search?q=). Group rows under kind headings, and add a 'Ctrl K' button beside the '/' hint in the header.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/out/palette2.txt and the s4-palette.mjs run (about 40 queries)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/palette-empty.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/palette-hikari.png
  - app.js:4776-4778 subsequence fallback; 4783 second 'Liked songs'; 4792 songs s:15; 4809 'Leave focus' always listed; 5694 Ctrl+K is the only opener

### search-ia-10 · medium · Focus is easy to switch on by accident and hard to read: an unlabelled pill beside search, chips that save playlists, and many names for one idea

- **Where:** Focus pill
- **Observed:** The pill left of the search box reads only 'Everything ▾'; on a phone it is a 38x38 music-note icon with no text. 'Working in:' exists only in its aria-label. Sitting next to the search box, it looks like a search filter, yet search's song results ignore it (see the Focus/search finding). One click on a home chip under 'Work with part of your library' (e.g. 'Anime 10') saves a new playlist 'Anime' (auto: true, synced to the Desk) and narrows the whole app; two chip clicks made 2 playlists. While focused on 5 songs, Home still offers 'Shuffle everything', and the queue then says 'Playing from Everything'; 'Show everything' means leave focus. Wording in use: Everything, Working in, Work inside a playlist, Work inside, Inside X · N songs, Show everything, Back to everything, Focus, Leave focus, 'Focused on X: the whole app works inside it', Work with part of your library. actions.js defines 'Focus on this' and 'Stop focusing' (target icon), but app.js uses neither.
- **Why it matters:** Visibility of system status and consistency: name a mode the same way everywhere and keep its controls visible. No hidden, lasting side effects.
- **Proposed fix:** renderFocusBtn: show a visible prefix ('In: Everything' / 'In: Anime'). On phones put the name in the focus bar and a dot on the icon. Consider moving the pill away from the search field, e.g. to the top of the sidebar or the focus bar. Home chips: focus on the filter without saving it (focus = { patch, name } instead of pushing to lists), and offer 'Save as playlist' in the focus bar. While focused, rename 'Shuffle everything' to 'Shuffle <focus name>' on the home button, in the palette and in the context label. Use one vocabulary from actions.js everywhere: 'Focus on …' and 'Stop focusing' with the target icon.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/app.css` · **Effort:** M
- **Evidence:**
  - s8-focus.mjs: after one chip click lists ['Anime(auto)'], pill 'Anime', sidebar station 'Anime'; after a second chip ['Anime(auto)','Games(auto)']; phone pill {w:38,h:38,labelShown:false}
  - s17-everything.mjs: focused on 'Openings' (5 songs), 'Shuffle everything' -> 'Playing from Everything · true shuffle', 0 songs outside the focus
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/focus-menu.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/focus-phone.png
  - app.js:1923 (chips push auto lists), 3283-3301 (pill, menu), 3359-3366 (Focus button creates a list), 773 (focus bar), 1899 and 4798 ('Shuffle everything'); actions.js:67-68 unused

### search-ia-11 · medium · The Search section and the phone's Search tab don't put the cursor in the search box

- **Where:** Navigation / phone search
- **Observed:** Clicking Search in the sidebar, choosing 'Page: Search' in the palette, or tapping the phone's Search tab opens 'Browse all' with focus on its h1. The box stays empty and unfocused, so a second click or tap is needed, and on a phone the keyboard doesn't open. At 390 px the header field is 196 px wide, and the placeholder needs 250 px of text in 112 px, so it reads 'Search songs,'. 'Browse all' (#/search with no query) repeats the tiles at the bottom of Moods & scenes: browseTiles is called by both (app.js:2009 and 2088).
- **Why it matters:** A Search destination's first job is to take typing (efficiency).
- **Proposed fix:** renderView: when name === 'search' and there is no q, focus $('search') instead of the h1, except when the page was reached with Back. On phones, put a full-width 44 px field at the top of #/search (or widen the header field there) with a shorter placeholder ('Songs, artists, anime'). Turn the empty Search page into recent searches plus a 'Browse by' row (Genres, Moods & scenes, Anime) instead of a copy of #/browse.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/index.html` · **Effort:** S
- **Evidence:**
  - s13-searchfeedback.mjs: 'click Search section -> {hash:#/search, focus:H1#.ts-h1}', palette 'Page: Search' Enter -> focus H1
  - s11-phone.mjs: 'tap Search tab: focus H1 … box [84,7,196,38]'; 'placeholder width 250 px in a box of 112 px'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/phone-search.png

### search-ia-12 · medium · Back restores the scroll position, but focus jumps to the page title, so the next Tab sends you back to the top

- **Where:** Back / forward
- **Observed:** Scroll restore works: going Back to Songs, Artists, Works, Search results, Home and Genres returned within 0-120 px of the earlier position (e.g. Songs 4,000 to 4,120). But every Back puts focus on the h1 (with preventScroll). On Songs (demo), scrolled to about 2,000 px, Enter on an artist link then Alt+Left left the view at 2,120 px with focus on 'H1 Songs'. One Tab then went to the 'Play' button and scrolled the page to 0.
- **Why it matters:** WCAG 2.4.3 Focus Order: after going back, return focus to the control that started the navigation.
- **Proposed fix:** In onRoute, before leaving, save the href or data-id of document.activeElement under the same key as scrollMemo. On a Back render (flag it from a popstate listener, or keep a step counter in history.state), focus that element with preventScroll instead of the h1. Keep focusing the h1 on new navigations.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s6-backscroll.mjs: 6 pages, e.g. 'artists grid scrolled to 3000 … BACK: top 3000 … focus H1.ts-h1 "Artists"'
  - s7-backdemo.mjs: 'Alt+Left: top 2120 focus H1.ts-hero-title "Songs" | then Tab: top 0 focus BUTTON.ts-btn "Play"'
  - app.js:746-753 onRoute (scrollMemo) and 777-783 renderView (h1.focus on every new render)

### search-ia-13 · medium · Unknown routes and missing items are dead ends: Home under the wrong URL, or one grey sentence with no heading or way on

- **Where:** Deep links / unknown routes
- **Observed:** #/nonsense shows Home ('Good evening') under that URL, with no section lit. #/c/bogus/x shows Home with Moods & scenes lit. Missing items show a single grey paragraph: 'No artist here. It may have been renamed or merged.', 'This track is not in the library.' (even for a valid YouTube id), 'No songs from “No Such Work” here.', 'No songs in “Nogenre” yet.', 'This playlist is gone.', 'No voice actor by that name here.', 'Nothing in this family yet.', 'Nothing here yet.'. These pages have no h1, so the tab title is 'True Shuffle' and focus stays on <body>. They offer no link to search or to the section. #/explore/<unknown> already does this better, with the heading 'Nothing to explore' and guidance.
- **Why it matters:** Help people recover: say what happened and offer the next step, and never quietly show a different page.
- **Proposed fix:** Add notFound(view, { kind, name, up }). It draws an h1 ('Artist not found') and one sentence with the reason (renamed or merged, outside your focus, or not in this library). It offers buttons: Search for “name” (#/search?q=name) and the section index (Artists, Songs, Playlists…). For #/track/<YouTube id> it also offers 'Explore this song' (#/explore/id) and 'Open on YouTube'. Replace the `VIEWS[name] || viewHome` fallback and the unknown-facet fallback with a 'Page not found' view that keeps the URL and lights no section.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s1-routes.mjs output and C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/out/routes.json
  - app.js:775 VIEWS[name] || viewHome; 2262 unknown facet -> viewHome; messages at 2168, 2237, 2248, 2264, 2451, 2505, 3438, 5606

### search-ia-14 · medium · The tab title doesn't update while you type a search, and it is generic or the same on several routes

- **Where:** document.title
- **Observed:** Typing 'oregairu' from Artists: the h1 follows every key, but document.title stays 'Results for “o” · True Shuffle' for all eight keys. Typing 'yoasobi' on the bocchi results leaves 'Results for “bocchi”'. The cause: typing on the search route redraws with renderView(true), which skips the title (app.js:5740 and 779-780). #/map has no h1, so its title is just 'True Shuffle', as are all the 'not found' pages. Home is titled with the greeting ('Good evening · True Shuffle'), and so is #/nonsense. #/track/demo-002 and #/explore/demo-002 are both 'Blue Letters · True Shuffle'.
- **Why it matters:** WCAG 2.4.2 Page Titled; browser history entries should be distinguishable.
- **Proposed fix:** Move the title into a setTitle() called on every render (including keep=true) and from wireShell's go(). Add an h1 'Map' to viewMap (visually hidden if space is short). Title Home 'Home · True Shuffle' and Explore 'Explore: <song>'. 'Not found' pages get their h1 (see the unknown-routes finding).
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s3-search.mjs typing log: '+250ms: … title=Results for “o” · True Shuffle h1=Results for “oregairu”'
  - s5-searchkeys.mjs: 'Enter after yoasobi: … h1 Results for “yoasobi” … title Results for “bocchi” · True Shuffle'
  - s1-routes.mjs: #/map 'True Shuffle'; #/ and #/nonsense 'Good evening · True Shuffle'; track and explore both 'Blue Letters · True Shuffle'

### search-ia-15 · low · Some routes light no section, and the phone tab bar doesn't tell screen readers which tab is current

- **Where:** Section highlighting
- **Observed:** The sidebar lights nothing on #/rescue (opened from Needs attention), #/lyrics, #/paste, #/share and #/library. The phone tab bar lights nothing on #/liked, #/rescue and #/lyrics; the list of routes that light the Library tab is kept by hand at app.js:723. The active phone tab has the class is-on but no aria-current, while the sidebar does set aria-current='page'.
- **Why it matters:** Show people where they are, visually and to assistive technology (WCAG 1.3.1).
- **Proposed fix:** Add rescue: 'fix' and suitable sections for paste/share to SECTION_OF (app.js:702). Work out which routes light the Library tab from the NAV keys plus SECTION_OF instead of the hand-kept array. Set aria-current='page' on the lit tab in renderNav's TABS loop.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s1-routes.mjs: '#/rescue | lit: - | tab: -', '#/lyrics | lit: - | tab: -', '#/paste … lit: -'
  - s11-phone.mjs: 'tab lit on #/liked -> (none)', '#/rescue -> (none)', '#/lyrics -> (none)'
  - s16-misc.mjs: 'tab attrs: ts-tab-a | … | ts-tab-a is-on | ts-tab-a' (no aria-current); AX link names without a current state

### search-ia-16 · low · The header's Back and Forward are always enabled; on the first page, Back leaves the app

- **Where:** Back / forward
- **Observed:** Arriving from the site's #/misc, the app's Back arrow next to the brand is enabled and takes you to index.html#/misc. Forward is never disabled.
- **Why it matters:** Controls inside the app should act inside the app, and show when they can't.
- **Proposed fix:** Keep an in-app step count in history.state: replaceState({ts:0}) on load, and step+1 on each in-app push (read it on hashchange). Disable #nav-back at step 0, and disable #nav-fwd unless the user has gone Back since the last push.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s16-misc.mjs: 'first page of the visit: Back disabled? false Forward disabled? false history.length 3'; after pressing Back -> http://127.0.0.1:…/index.html#/misc
  - app.js:5733-5734 history.back()/forward() without a check

### search-ia-17 · low · Escape in the search box clears the text but leaves the old results on screen

- **Where:** Header search
- **Observed:** On 'Results for “bocchi”', pressing Escape empties the box (the browser's native behaviour for type=search) and blurs it, but the page and the URL still show bocchi. A second Escape does nothing. The box and the page now disagree.
- **Why it matters:** Keep what the controls show and what the page shows in step.
- **Proposed fix:** In wireKeys (app.js:5698): on Escape in #search, call preventDefault so the text stays, then blur. Alternatively let the clear stand and call go(), so the page follows the box.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s5-searchkeys.mjs: 'Escape +550ms: {hash:#/search?q=bocchi, box:"", h1:Results for “bocchi”, focus:BODY}'
  - app.js:5698 Escape only blurs #search

### search-ia-18 · low · Help names the wrong key for Edit and uses an old name for playlists

- **Where:** Help / naming
- **Observed:** Help says 'Edit one track with e or the pencil', but E opens Explore and navigates away; Edit is I (actions.js:36 and 52). It also says the Mix builder 'saves them as stations', while the app calls them playlists everywhere else.
- **Why it matters:** Consistency: one name per thing, and help that matches the controls.
- **Proposed fix:** index.html help template: 'Edit one track with I or the pencil' and 'saves them as playlists'. Better, write those sentences from A.VOCAB at start-up, the way fillHelpKeys already does.
- **Files:** `misc/101-true-shuffle/index.html` · **Effort:** S
- **Evidence:**
  - index.html:142 ('saves them as stations') and 144 ('Edit one track with <kbd>e</kbd>')
  - actions.js VOCAB: explore key 'E', edit key 'I'

### search-ia-19 · low · With an empty library, 10 of 21 sections show the same welcome screen, and some empty states are wrong

- **Where:** First run IA
- **Observed:** Real mode, first run: Home, Search, Songs, Artists, Genres, Moods & scenes, Anime, Mix builder, Your numbers and Needs attention all show the same 'Your playlists, as a music app' welcome. Quick labeller says 'Every song here has labels.', and Map says it 'needs at least eight songs here' (with no h1). Typing in search shows the welcome again. The full 21-section sidebar and the Everything pill appear before there is anything to browse.
- **Why it matters:** Progressive disclosure and honest empty states.
- **Proposed fix:** While L.list(lib).length === 0, renderNav shows Home, For you and Settings (Import) plus 'Try the demo'. The other sections are greyed under a note 'after your first import'. Hide the focus pill. Change viewLabel's empty text to 'Nothing to label yet: import a playlist first'.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s19-firstrun.mjs: '10 sections show: Your playlists, as a music app' (#/ #/search #/songs #/artists #/genres #/browse #/works #/mix #/stats #/fix); Quick labeller 'Every song here has labels.'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/search-ia/shots/firstrun-home.png
  - app.js:3564 (labeller empty text)

## Lens: feature-consistency

<details><summary>What this auditor covered</summary>

- Lens: consistency of the newest pages (Rank your songs, Your numbers > When you listen, Your year, Guess the anime, Lyrics tab and karaoke, Continue on your phone, Mini player, Rescue, Car mode, Share and Paste) with the core (Home, Songs, Liked, Artist, Explore, For you, History, Needs attention, Settings, Library hub).
- Demo at 1280x860 dark and 390x844 light (mobile emulation): #/, #/songs, #/liked, #/artist/<key>, #/explore/demo-126, #/for-you, #/works, #/settings, #/library, #/fix, #/history, #/stats (empty and with a 300-day invented history), #/wrapped (empty, with history, ?year=2025), #/duel and #/duel/ranking (empty, after 12, 40 and 70 picks, a work scope), #/quiz (empty; setup with 6 labelled works; rounds and answers with iTunes stubbed and a local WAV), #/lyrics (nothing playing, playing, demo note), #/lyrics?q=lantern, #/rescue and #/rescue/demo-021 (3 songs made unplayable), #/share (empty, 3 ids, with a start = Continue listening), #/paste (a 3-line list read and played), #/car on desktop and phone (car mode opened while music plays).
- Real mode, empty IndexedDB, Google hosts blocked, 1280 and 390: first-run empty states of 17 routes; #/share and Continue listening with YouTube oEmbed blocked; lyrics search with lrclib.net blocked (demo). Databases deleted afterwards; repo untouched (git status unchanged).
- Dialogs and windows: Continue on your phone (desktop and phone), the mini player as a real Document Picture-in-Picture window (dark and light, buttons, arrow-key step), the bar's More menu, the Ctrl+K palette (19 queries), the ? shortcuts list.
- Interaction measurements: right-click, Shift+F10 and Enter on rows of 9 lists; one phone tap on rows of 6 lists; S, arrows, 1 and Backspace on #/songs vs #/duel with the focus in the page and in the now-playing panel; sticky compact header after scrolling 4 long pages; Needs attention counters with 0 unsure artists and 3 dead songs; nav and tab highlight on 16 routes; network hosts contacted by the demo.
- Code read for headers, buttons, rows, empty and error states: app.js (headerBlock, trackList, noMusic, NAV, SECTION_OF, palette, bar More, pageCtx), ui.js, ds.css, app.css, actions.js, duel.js, habits.js, wrapped.js, quiz.js, lyrics.js, rescue.js, share.js, handoff.js, pip.js, car.js, media.js, lanes.js, fuzzy.js.
- Scripts, JSON results and 131 screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/ (tour.mjs, deep1.mjs, deep2.mjs, rows.mjs, errors.mjs, charts.mjs, needs.mjs, keys.mjs, pip.mjs, car-state.mjs, paste.mjs, real-empty.mjs, demo-net.mjs and shots/).

</details>

### feature-consistency-1 · high · Song lists on the new pages drop the shared song row: no menu, no right-click or Shift+F10, and Enter or a tap opens the song page instead of playing

- **Where:** Your year top songs, Your ranking, Songs gone from YouTube, Guess the anime missed songs vs Songs, Liked, Artist
- **Observed:** On Songs and Liked (app.js trackList), a right-click or Shift+F10 opens the 14-item song menu: Play, Play next, Add to queue, Start radio, Explore, Journey, Add to playlist, Go to artist, Go to channel, Song details, Edit, Rating, Trim and volume, Block. Enter plays from that row, one tap plays on a phone, and rows carry a heart and drag onto the queue. The new pages build their lists by hand, and those rows behave differently. On Your year's top songs, Your ranking and Songs gone from YouTube, a right-click shows the browser's own menu, Shift+F10 does nothing, and Enter on the focused title goes to #/track/<id>. At 390x844, a tap on the title opens the song page, where Songs and Liked play. None of these rows can Play next, Add to queue, Add to playlist, Like or Go to artist. Your ranking's rows have no Play control at all, only the title link. fuzzy.js, another new module, already draws its list with ctx.ui.trackList, so the shared row is open to page modules.
- **Why it matters:** One song row and one set of gestures everywhere. The README says track lists 'play with a double click or Enter (one tap on a phone), and have a menu per row (the menu key or Shift+F10 too)'. What a song can do should not depend on which page lists it.
- **Proposed fix:** Draw these library-song lists with ctx.ui.trackList(el, tracks, { context, noHead: true, extra }) and put each page's own line in extra(t). For duel.js drawRanking: the place plus 'Sure · 16 duels, won 11'. For wrapped.js topSongsSection: plays and minutes. For rescue.js listPage: the reason plus a 'Find a working upload' button (rescue.menuItem already adds it to the track menu). For quiz.js drawSummary: the missed songs. Where a custom layout must stay, add trackMenu to pageCtx.ui (one line at app.js:4438). Then give each row a contextmenu handler, Shift+F10 and the ContextMenu key, and a U.iconBtn('more'), all calling trackMenu. Make Enter or a tap on the row play, as trackList's pointerup does. Give media.js rows the same tap-to-play.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/wrapped.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/duel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/rescue.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/media.js` · **Effort:** M
- **Evidence:**
  - rows.mjs -> rows.json. Songs: right-click 14 items, Shift+F10 14 items, Enter 'played demo-148'. Your year top songs: right-click null, Shift+F10 null, Enter 'navigated to #/track/demo-047'. Your ranking: null, null, 'navigated to #/track/demo-042', and its only control is the title link. Songs gone from YouTube: null, null, 'navigated to #/track/demo-031'.
  - phone-tap.mjs at 390x844: Songs 'played demo-148', Liked 'played demo-052', Your year 'opened #/track/demo-011', Rank your songs 'opened #/track/demo-026', Songs gone from YouTube 'opened #/track/demo-031'. Explore's media.js row: 'nothing'.
  - app.js:1275-1280: trackList's dblclick, contextmenu -> trackMenu, and touch pointerup that plays. Compare wrapped.js:612-624 songRow, duel.js:652-668 rowOf (no play button), rescue.js:513-522 and quiz.js:1345-1356. pageCtx at app.js:4438 exposes ui.trackList but not trackMenu (app.js:1359). fuzzy.js:432 uses ctx.ui.trackList.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-duel-ranking.png, .../shots/d-wrapped.png, .../shots/p-rescue.png, .../shots/d-songs.png

### feature-consistency-2 · high · A shared link or Continue listening says every song is gone from YouTube when the title lookup fails, and drops the 'Play from 2:31' card

- **Where:** #/share, the landing page of Continue on your phone
- **Observed:** I blocked www.youtube.com, which serves YouTube's oEmbed titles; a flaky phone connection when leaving the house does the same. A handoff link (#/share?ids=dQw4w9WgXcQ.9bZkp7q19f0.kJQP7kiw5Fk&at=9bZkp7q19f0&s=151&t=Evening queue) opened at 390x844 shows the kicker 'Continue listening' and '3 songs'. Below that there is no start card, no rows, and the line '3 songs are no longer on YouTube or cannot be played on other sites.' Play all answers 'Nothing could be found to play.' A plain shared link at 1280x860 does the same, under Play all and Add all to the queue buttons for zero songs. The video ids are in the link and would play through YouTube's player; only their titles failed. Any 429 or 5xx answer from oEmbed ends the same way.
- **Why it matters:** An error state says what happened and keeps the user's songs and task. 'Gone' is only for what YouTube reports as gone. The core's lanes already tell offline, rate-limited and not-found apart.
- **Proposed fix:** In share.js titles(), return null only for 401, 403 and 404 (deleted or not embeddable). Mark rejected fetches, 429 and 5xx as failed instead. In viewShare and viewPaste, keep failed ids as finds with their videoId and the title 'Title not loaded', and keep fillStart's 'Play from 2:31' card. Show TS.lanes.explain({ code: 'offline' | 'rate' | 'down' }, { source: 'YouTube' }).text with a Try again button that runs known() again. Count only real 'gone' ids in the gone line.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/share.js` · **Effort:** S
- **Evidence:**
  - charts.mjs: the view reads 'CONTINUE LISTENING | Evening queue | 3 songs | ... | Play all | Add all to the queue | 3 songs are no longer on YouTube or cannot be played on other sites.' After Play all: toast 'Nothing could be found to play.', 0 items in the queue.
  - errors.mjs: the same on #/share?ids=...&t=Three songs at 1280x860.
  - share.js:115 titles() sets out[id] = null on a rejected fetch, and also when r.ok is false. share.js:235 keeps only ids whose meta is not null, and share.js:247 writes the 'no longer on YouTube' line. startIn() then returns null, so the start card is removed.
  - The core words the same failure differently, in lanes.js:128-131 explain(): 'This device is offline, so X cannot be asked. Try again when the connection is back.', with a Try again fix.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/err-continue-offline.png, .../shots/err-share-offline.png; the working case: .../shots/p-share-start.png

### feature-consistency-3 · high · In the demo, the lyrics search sends what you type to lrclib.net

- **Where:** #/lyrics?q= and the search page's 'Songs with these words (lyrics)' box, in the demo
- **Observed:** ?demo=1 contacts no other site on load: externalHosts is []. The Lyrics tab and the karaoke page say 'The demo's songs are invented, so there are no lyrics to show' and make no request. But #/lyrics?q=lantern in the demo made two requests to https://lrclib.net/api/search?q=lantern (the preflight and the GET). It then listed real LRCLIB songs (Toby Fox 'Lantern', The White Birch ...), each with 'Play, uses 100 YouTube units'. Pressing one says 'The demo cannot search YouTube.' The search page's 'Search lyrics' button runs the same code (runSearch).
- **Why it matters:** The demo behaves the same on every page: invented data, nothing contacted. The README's Addresses table and the audit brief both say the demo contacts no network.
- **Proposed fix:** In lyrics.js searchPage and searchSection, test quiet(ctx) instead of ctx.thumb. Show the panel's demo note there, for example 'The demo's songs are invented, so lyrics are not looked up here', and keep the form on screen without sending anything. Add a drive assertion that every ?demo=1 route leaves page.externalHosts empty.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/lyrics.js` · **Effort:** S
- **Evidence:**
  - demo-net.mjs: hosts after load [], after #/lyrics?q=lantern ['lrclib.net']; the request 'https://lrclib.net/api/search?q=lantern 200' appears twice.
  - lyrics.js:496 quiet(ctx) keeps the panel and the karaoke page quiet in the demo. lyrics.js:1015 searchPage checks only ctx.thumb, and lyrics.js:1106-1117 searchSection has no demo check. Both go to runSearch at lyrics.js:1018.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-lyrics-search.png and .../shots/p-lyrics-search.png, vs the demo note at .../shots/d-lyrics-playing.png

### feature-consistency-4 · medium · Found-song rows on Share, Paste and the lyrics search ignore media.js: a blue Play pill on every row, a cost badge on songs the library has, no Save or More

- **Where:** #/share, #/paste, #/lyrics?q= vs found-song rows on Explore and For you (media.js)
- **Observed:** media.js draws found songs on Explore and For you with a quiet round Play (secondary, size sm); its own comment says 'A list of rows then reads as songs, not buttons'. Next to it are a small Play next icon and a More menu (Play from here, Add to queue, Preview, Save for later, Not interested). It drops the cost badge when the library has the song. share.js and lyrics.js build their own rows with a primary Play pill on every row. #/lyrics?q=lantern shows 14 blue pills at 1280, and at 390 each row gets a pill under it. Share's Play next is the medium icon size (40 px against media's 32). No row has More, Save for later or Add to queue. Paste marks 'Paper Lanterns - Small Current', a song in the library, as 'Play, uses 100 YouTube units'; pressing it plays the library copy, demo-005, for free.
- **Why it matters:** Found songs use one row, and its cost badge tells the truth. The README calls media.js 'one song row, card and menu for library tracks and found songs alike' that says 'what playing it takes (a badge on Play)'.
- **Proposed fix:** Build share.js rowFor and lyrics.js hitRow with TS.media.row(ctx, TS.media.item(find, ctx), { context, list, index, sub }), with the lyrics snippet as the why line. The row then brings the 'In your library' tick, the free Play, the engine's cost estimate and the menu. Keep 'Play all' or 'Play from 2:31' as the page's only primary button.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/share.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/lyrics.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - found-rows.mjs: a media.js row for a shared video has 'secondary/sm Play', 'icon/sm Play A found song next' and 'icon/sm More for A found song'.
  - tour.json, d:lyrics-search: 14 primaries, each 'sm Play, uses 100 YouTube units'. deep2.json, d:share-start: 'primary/sm Play' and 'icon/md Play next' on every row.
  - paste.mjs: Small Current's button reads 'primary/sm Play, uses 100 YouTube units'. Pressing it shows the toast 'Playing “Small Current” by Paper Lanterns.' and the current song becomes demo-005.
  - Code: share.js:160-171 rowFor sets cost: f.videoId ? null : 100 and never checks the library. lyrics.js:1057-1075 hitRow. media.js:536-545.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-paste-read.png, .../shots/d-share-start.png, .../shots/d-lyrics-search.png, .../shots/p-lyrics-search.png vs .../shots/d-explore.png

### feature-consistency-5 · medium · With no library, each new page has its own empty state, and two of them are dead ends

- **Where:** First run (real mode, empty library): Rank your songs, Guess the anime, Your year, Songs gone from YouTube vs Home, Songs, Your numbers
- **Observed:** Ten core views (Home, Songs, Artists, Genres, Works, Mix builder, Your numbers, Needs attention and others) show the same welcome: 'Your playlists, as a music app', with Try the demo and Sign in or import a file. Each new page says something else. Rank your songs: 'No songs yet. Import your playlists in Settings, then come back to rank them.', with a secondary 'Open Settings'. Guess the anime: 'Not enough to play yet ... There are none of those here yet.', with a primary 'Quick labeller' whose page then says 'Every song here has labels'. Your year: 'Nothing counted yet this year. Listens are counted from now on...', with no action. Songs gone from YouTube: 'Nothing in the library yet.', with no action.
- **Why it matters:** There is one 'no music yet' state, and it offers the two ways in. A primary action must lead to a page that can help.
- **Proposed fix:** Expose noMusic on pageCtx.ui. Call it first in duel.view, quiz drawSetup, wrapped.view and rescue listPage when ctx.idx().all is empty. Keep each page's own empty states for the cases only it has: fewer than 4 works, no duels yet, no plays this year, every song plays.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/duel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/wrapped.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/rescue.js` · **Effort:** S
- **Evidence:**
  - real-empty.mjs -> real-empty.json, at 1280x860 and 390x844 with Google hosts blocked.
  - app.js:1864-1878 noMusic(), called by 10 core views. Compare duel.js:466-470, quiz.js:1196-1210, wrapped.js:543-548, rescue.js:511, and the labeller's empty text at app.js:3563-3566.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/rd-_songs.png, .../shots/rd-_quiz.png, .../shots/rd-_wrapped.png, .../shots/rp-_duel.png, .../shots/rd-_rescue.png

### feature-consistency-6 · medium · Errors on the new pages use their own wording and show the browser's raw 'Failed to fetch'

- **Where:** Lyrics search and Lyrics tab, Guess the anime, Rescue vs the Explore and For you lanes
- **Observed:** With lrclib.net unreachable, #/lyrics?q=lantern says 'The search could not be done. LRCLIB could not be reached (Failed to fetch).', with Try again. The core's shared explainer, lanes.js explain(), which every Explore and For you lane uses, words the same failure 'LRCLIB did not answer. Check the connection, then try again.' It also has offline, rate-limited ('It is asked again in a minute') and server variants. quiz.js has a third wording ('iTunes Search could not be reached. Check the connection, then try again.'). rescue.js shows err.message as it comes. share.js shows no error at all; see the shared-link finding.
- **Why it matters:** One error vocabulary across the app, and never exception text in front of the listener.
- **Proposed fix:** Route these through TS.lanes.explain(err, { source }): lyrics.js runSearch and panel failures, quiz.js messageOf and rescue.js errText. Map the lyricsError codes (offline, timeout, busy, http, bad-answer) to explain()'s codes. Render the text and the fix button the way lanes.js does, and drop the '(' + e.message + ')' suffix at lyrics.js:377.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/lyrics.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/rescue.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/lanes.js` · **Effort:** S
- **Evidence:**
  - errors.mjs: the lyrics search shows 'The search could not be done. LRCLIB could not be reached (Failed to fetch).'; explain() gives the offline, network, timeout, rate and server wordings.
  - lyrics.js:357, 377 (appends e.message) and 1038. quiz.js:442-448 messageOf. rescue.js:602 errText. lanes.js:116-160.
  - Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/err-lyrics-search.png

### feature-consistency-7 · medium · Songs gone from YouTube is invisible from Needs attention, lights no section, and goes by six names

- **Where:** Rescue (#/rescue), Needs attention (#/fix), the sidebar, the phone Library hub, Home
- **Observed:** I made every artist sure and 3 songs unplayable (idx().needs = { unsure: 0, gone: 3 }). The phone Library hub then says 'Needs attention · All good', the sidebar shows no badge and Home shows no note. Only the note at the top of #/fix leads to #/rescue. On #/rescue and #/rescue/<id>, no sidebar item and no phone tab is lit; on #/fix, 'Needs attention' and the Library tab are. The one problem has six names. The #/fix chip says 'Cannot play' and the row tag 'Unplayable'. The h1 says 'Songs gone from YouTube'. The #/fix note says 'Find working uploads', the row button 'Find an upload', and the song page and track menu 'Find a working upload'.
- **Why it matters:** A sub-page lights its parent, and the app's attention counters count every problem the app can fix. One problem has one name.
- **Proposed fix:** Add rescue: 'fix' to SECTION_OF and 'rescue' to the Library tab's list at app.js:723. Count needs.gone in the sidebar badge, in the hub line ('3 songs can't play') and in a Home note like the unsure one. Pick one noun and one verb, for example 'Songs that can't play' and 'Find another upload'. Use them in the chip, the row tag, the h1, the #/fix note, the row button, the song page and the track menu.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/rescue.js` · **Effort:** S
- **Evidence:**
  - needs.mjs, desktop and phone: hub 'Needs attention | All good', nav badge '(no badge)', home note '(no note on Home)', #/fix note '3 songs cannot play any more...'.
  - deep1.json nav: '#/rescue': '(none) | tab: (none)', '#/rescue/demo-021': '(none) | tab: (none)', '#/fix': 'Needs attention22 | tab: Library'.
  - app.js:161 counts needs.gone, but the badge (app.js:709), the Home note (1971) and the hub line (2553) read only needs.unsure. SECTION_OF (app.js:702) has no rescue, and neither does the Library tab's list (app.js:723).
  - The names: app.js:2787, app.js:1254, rescue.js:509, rescue.js:847, rescue.js:521, rescue.js:581 and :866.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-rescue.png, .../shots/d-fix.png, .../shots/p-hub-needs.png

### feature-consistency-8 · medium · Pages of the same kind get different headers: copied 'compact hero' CSS, a third header for lyrics, and a list and its detail page in different shapes

- **Where:** Page headers: Rank your songs, Guess the anime, Lyrics, Rescue vs Songs, Artist, Explore, Your numbers
- **Observed:** The core has two header shapes. Collections use headerBlock: a kicker naming the kind of page, a 46.8 px title, a meta line and actions. Tools use a plain 30 px h1 and a lede. Rank your songs and the quiz rounds shrink the hero to 27.5 px by overriding .ts-hero in their own CSS; duel.js:272-273 and quiz.js:893-894 are the same two rules, copied. Between the quiz's setup, rounds and summary, its title jumps from 46.8 to 27.5 and back to 46.8 px, and its art appears, disappears and returns. The karaoke page builds a third shape (72 px art, kicker, 30 px h1) under an in-page '← Song details' link that goes to the song page, not back to where you came from. The rescue list uses a plain h1, while its per-song page is a full hero with 192 px art. Kickers change role too. On core pages they name the page ('Library', 'Artist', 'Explore'). On the new pages they are taglines ('Two songs at a time', 'Songs from anywhere', 'A game') or status ('Round 1 of 10 · Normal', 'Game over · Normal').
- **Why it matters:** Pages of the same kind get the same header, and the kicker always means one thing: what kind of page this is.
- **Proposed fix:** Add a compact option to headerBlock (an app.css .ts-hero.is-compact rule with the duel and quiz values) and delete both copies. Keep one header size across the quiz's setup, rounds and summary, and put the round status in the meta line. Draw the karaoke header with headerBlock({ compact: true, artNode }). Drop '← Song details': the top bar's Back already goes back. Give #/rescue/<id> the same plain h1 as #/rescue and #/fix, or make both heroes. Use page kinds as kickers ('Game', 'Your music', 'Shared link', 'Needs attention') and move the taglines into the blurb.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.css`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/duel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/lyrics.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/rescue.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/share.js` · **Effort:** M
- **Evidence:**
  - tour.json h1 sizes: d:songs ts-hero-title 46.8px; d:duel 27.456px; d:lyrics-playing ts-h1 30px with kicker 'Lyrics'; d:rescue ts-h1 30px vs d:rescue-song ts-hero-title 46.8px with art. deep2.json: d:quiz-setup 46.8px, d:quiz-round 27.456px.
  - duel.js:272-273 and 422-423. quiz.js:893-894, 1159, 1213-1214 and 1325. lyrics.js:709-724 (ts-lyv-head; the back link at 713, 72 px art at 554). rescue.js:509 vs 580-583. app.css:285 and 299-311.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-duel.png, .../shots/d-quiz-setup.png, .../shots/d-quiz-answered.png, .../shots/d-lyrics-playing.png, .../shots/d-rescue.png, .../shots/d-rescue-song.png

### feature-consistency-9 · medium · Play on the new list pages sits outside the header: no sticky Play when scrolling, and main buttons range from 40 to 56 px

- **Where:** Your ranking, Share, Rescue's song page, Paste, Guess the anime vs Songs, Artist, Your year
- **Observed:** Core list pages put Play (primary, large, 48 px) in the header's action row. After scrolling 900 px, a compact bar with Play stays at the top; it shows on Songs and on Your year. Your ranking puts 'Play from the top' (primary, medium, 40 px) under a paragraph, and Share puts 'Play all' under a note. After scrolling the 100-row ranking or the rescue list, no compact bar appears. The main buttons' sizes on the new pages vary. Medium: 'Play from the top', 'Read the list', 'Use this upload', 'Quick labeller'. Large: the core headers, Your year, Share and the quiz's 'Next round'. Extra large (56 px): the quiz's Start.
- **Why it matters:** A page's main action lives in one place at one size, and long pages keep it in reach. The README allows 'at most three actions and More in a page's header' and 'one blue for every play'.
- **Proposed fix:** Pass each page's main actions through ctx.ui.headerBlock({ actions: [...] }). For Your ranking: Play from the top and Set stars from the ranking. For Share: Play all (or Play from 2:31) and Add all to the queue. For Paste: Play all, once the list is read. They then get actionBtn's large primary and the sticky bar. Keep the medium size for actions inside the content, and make the quiz's Start large like every other page's main action.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/duel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/share.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/rescue.js` · **Effort:** S
- **Evidence:**
  - deep1.json: sticky:songs {on: true, 'Songs'}, sticky:wrapped {on: true, 'Your 2026'}, sticky:duel-ranking null, sticky:rescue null.
  - tour.json primaries: d:songs 'lg Play', d:wrapped 'lg Play your top 50', d:duel-ranking 'md Play from the top', d:rescue-song 'md Use this upload', d:paste 'md Read the list'. deep2.json: d:quiz-setup 'xl Start'.
  - app.js:1767-1773 (headerBlock's actions feed stickyHeader). duel.js:635-638. share.js:173-185 and 243.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-scrolled-songs.png, .../shots/d-scrolled-duel-ranking.png, .../shots/d-duel-ranking.png

### feature-consistency-10 · medium · Page keys override app keys without appearing in the shortcuts list, the mini player seeks 5 s where the page seeks 10 s, and key hints show on touch screens

- **Where:** Keyboard on Rank your songs, Guess the anime, the mini player and Lyrics vs the ? shortcuts list
- **Observed:** The shortcuts list (?) has 24 rows, including 'In a list', 'In the queue' and 'Quick labeller'. It has nothing for Rank your songs (1 or ←, 2 or →, S to skip, Backspace to undo), Guess the anime (1–4, Space replays the clip, Enter goes on), the lyrics lines (↑ ↓) or the mini player window. These pages take over app keys. On #/duel, S never reshuffles: the queue's next songs stayed the same even with the focus on a now-playing panel button, while on #/songs S reshuffled them. There, ← and → pick a song instead of seeking 10 s. On the quiz, Space replays the clip instead of playing or pausing. In the mini player, ← and → seek 5 s (measured 5.2 s), while the page seeks 10 s (10.5 s). On a 390 px touch screen, the duel footer still reads 'Keys: 1 or ← for the left one, 2 or → for the right one...', above cards stacked top and bottom. The quiz shows 1–4 key badges on its choices there, while the duel hides its number badges on touch screens.
- **Why it matters:** Every key appears where the app lists keys, a key means the same thing in every window, and key hints stay hidden where there is no keyboard.
- **Proposed fix:** Add KEYMAP rows in actions.js for Rank your songs, Guess the anime, Lyrics and the mini player window, each saying which app keys it replaces there (S, ← and →, Space). Set pip.js SEEK_SEC to 10, or derive both seeks from one constant. Put the duel's and quiz's 'Keys:' paragraphs and .ts-quiz-key under the (hover: none), (pointer: coarse) rule that duel.js:310 already uses. Word the duel hint by layout: left and right on a wide screen, first and second when the cards stack.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/actions.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/pip.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/duel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js` · **Effort:** S
- **Evidence:**
  - deep1.json shortcuts: 24 rows, none for the duel, quiz, mini player or lyrics. keys.mjs: '#/songs s => queue reshuffled', '#/duel s => nothing' (also with the focus on a #now button), '#/duel ArrowRight => duel: 1 duel this session'.
  - pip.json arrow: { inWindow: 5.2, inPage: 10.5 }. pip.js:30 SEEK_SEC = 5 vs app.js:5725 seeking 10 s.
  - actions.js:88-94 (KEY_ORDER and KEYMAP). duel.js:310 (hides .ts-duel-key on coarse pointers), 393-410 onKey, 557 footer. quiz.js:1009-1020 onKey, 1193, 1261, 1318.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-shortcuts.png, .../shots/p-duel.png, .../shots/p-quiz-round.png

### feature-consistency-11 · medium · Car mode's big button shows Play ('Start') while music is playing, and the first press does not pause

- **Where:** Car mode (#/car) vs the player bar, the phone sheet and the mini player
- **Observed:** With a song playing (the bar's button says 'Pause'), car mode at 390x844 opens with its 120 px button showing a play triangle labelled 'Start'. The first press keeps the music playing and only then turns the button into Pause; the second press pauses. The bar, the phone sheet (#st-toggle) and the mini player all show Pause while music plays.
- **Why it matters:** A play and pause button shows what the player is doing, everywhere. A driver glancing at the screen must be able to trust it.
- **Proposed fix:** In car.js's paint (line 685), show ['pause', 'Pause'] whenever the player plays. Keep 'Start' only when nothing plays (startPlan resume, radio or nothing). Run start()'s side effects (transport.wake, the wake lock, full screen) on the first press of any car control, so a first Pause both pauses and finishes starting car mode.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/car.js` · **Effort:** S
- **Evidence:**
  - car-state.mjs. Before car mode: {player: 'playing', bar: 'Pause'}. Car mode open: {player: 'playing', carBtn: 'Start', carIcon: 'play'}. After the first press: {player: 'playing', carBtn: 'Pause'}. After the second: {player: 'paused', carBtn: 'Play'}.
  - car.js:568 (the Start button), 685 (want = !S.started ? ['play', 'Start'] : ...), 436 (the first press always calls start()).
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/p-car.png, .../shots/d-car.png

### feature-consistency-12 · medium · Your year and Your numbers chart the same listening with different week starts, units and hour names

- **Where:** Your year's 'When you listened' vs Your numbers' 'When you listen', and History
- **Observed:** Your year's 'Your week' runs Sunday to Saturday and counts plays ('Most plays on Sundays: 341'). Your numbers' 'By day and hour' runs Monday to Sunday and counts minutes, and its 'Minutes per week' starts weeks on Monday. Your year names hours '12 am ... 12 pm'. Your numbers' axis reads '12 am, 6 am, noon, 6 pm', and its sentences say 'noon' and 'midnight'. The sections are titled 'When you listened' and 'When you listen'. The core's History writes months as '2026-01' and days as '2026-10-11', where Your year writes 'Mar' and 'Sunday, January 18'.
- **Why it matters:** The same quantity looks the same on every page: one week start, one way to name hours, and the unit always stated.
- **Proposed fix:** Share one week start between wrapped.js and habits.js: a constant, or Intl.Locale(navigator.language).weekInfo.firstDay. Use habits' hourWord in wrapped.js, and say the unit in each chart title ('plays by weekday', 'minutes by day and hour'). Use one section title on both pages. Format History's month and day headings with wrapped.js's month names.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/wrapped.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/habits.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/l-wrapped-when.png (Sun to Sat, plays, '12 pm'), .../shots/l-stats-when.png (Mon to Sun, minutes, 'noon'), .../shots/l-history-months.png ('2026-01').
  - wrapped.js:38 WEEKDAYS (Sunday first), 454 hourName, 569, 583-585. habits.js:45 DAYS (Monday first), 138 hourWord, 395, 438. app.js:3500-3511.

### feature-consistency-13 · low · Guess the anime shares its icon with Anime, games & stage, and Your year shares For you's sparkle on the phone and in the palette

- **Where:** Icons in the sidebar, the phone Library hub, the palette and page art
- **Observed:** ui.js draws 'tv' and 'works' with the same path. So 'Anime, games & stage' and 'Guess the anime' show the same monitor icon in the sidebar, the phone hub and the palette, and the quiz's hero art is that icon too. Your year is a medal in the sidebar. In the phone Library hub, the palette and its own hero badge it is a sparkle, which is For you's icon in the sidebar and the tab bar.
- **Why it matters:** One icon has one meaning, and one destination has one icon.
- **Proposed fix:** Give the quiz its own icon in ui.js PATHS (a question bubble or a buzzer) and use it in NAV, the hub, the palette and quizArt. Use 'medal' for Your year in the hub, the palette and the hero badge. Extend actions.js check() to the NAV and hub icons so an icon with two meanings is caught.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/wrapped.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/actions.js` · **Effort:** S
- **Evidence:**
  - ui.js:56 'works' and ui.js:122 'tv' are both 'M4 4h16v12.5H4zm2 2v8.5h12V6zM8 18.5h8V20H8z'.
  - deep2.json p:hub: 'Anime, games & stage' and 'Guess the anime' both draw 'M4 4h16v12.5H4zm2 2v8'; 'For you' and 'Your year' both draw 'M11 2l1.9 5.6 5.6 1.9'.
  - app.js:684 and 700 (For you's sparkle), 690 (Your year's medal), 2552 (the hub's sparkle), 4815 (the palette's sparkle). wrapped.js:525 (the hero's sparkle). quiz.js:1091-1093 (the hero's tv).
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-quiz-empty.png (sidebar), .../shots/p-library-bottom.png

### feature-consistency-14 · low · Labels drift: 'track' in the bar but 'song' in the vocabulary and the newest surfaces, one quiz button name for two actions, and the app's only exclamation mark

- **Where:** Wording across the bar, the mini player, car mode, the quiz and the duel
- **Observed:** The bar and the phone sheet say 'Previous track' and 'Next track', with tooltips 'Previous (p)' and 'Next (n)', and 'Add to Liked songs'. actions.js and the newest surfaces (the mini player, car mode) say 'Previous song' and 'Next song', with (P) and (N), and 'Like'. The quiz uses 'Play again', with the retry icon, for replaying the clip and, on the summary, for starting a new game. Its verdict 'Right! +150 points' is the only exclamation mark in the app. Playing a song now is called 'Hear it' on the duel, 'Play the full song' on the quiz and 'Play' everywhere else. Lists end in 'Show all 50' on Your year and Your ranking, but in 'See all' in lanes.
- **Why it matters:** The action vocabulary in actions.js is the one source of labels: one label, one action.
- **Proposed fix:** Take the bar's and the sheet's labels and tooltips from A.label('previous') and A.label('next') plus the key ('Previous song (P)'). Label the like button from A.label('like') with aria-pressed. Rename the clip button 'Replay the clip', and write 'Right. +150 points'. Use 'Play' for playing now on the duel and the quiz, and VOCAB's 'see-all' ('See all') for both list footers.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/quiz.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/duel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/wrapped.js` · **Effort:** S
- **Evidence:**
  - pip.json: the bar's '#btn-prev ... “Previous track”' and '#btn-like ... “Add to Liked songs”' vs the window's 'Previous song' and 'Like'.
  - index.html:71, 108 and 110. app.js:4740. actions.js VOCAB next, previous and like. pip.js:229 and 231. car.js:567 and 569.
  - quiz.js:1140 and 1337 ('Play again'), 1084 and 1297 ('Right!'). duel.js:575 ('Hear it'). wrapped.js:632 and duel.js:644 ('Show all').

### feature-consistency-15 · low · The palette lists some new pages twice and others not at all

- **Where:** The Ctrl+K palette and the bar's More menu
- **Observed:** Typing 'guess' shows 'Guess the anime' twice, as an Action and as a Page. Typing 'year' shows 'Your year' twice, as an Action with the sparkle and as a Page with the medal. 'Rank your songs' is only a Page, and 'duel' finds nothing. 'car' does not find Car mode, which lives only in the bar's More and the phone hub. 'gone' and 'rescue' find nothing. 'karaoke' finds nothing, though the Lyrics tab's button is labelled 'Karaoke' and opens a page titled 'Lyrics'. In the bar's More, 'Continue on your phone' and 'Car mode' are built by hand instead of from actions.js. The mini player is described three different ways: in VOCAB, in the bar's More and in the palette's hint.
- **Why it matters:** One entry per destination, every page reachable from the palette, and every menu item taken from the action vocabulary.
- **Proposed fix:** Build the palette's Page entries from NAV plus the hub's extra pages (Car mode, and Songs that can't play when there are any). Drop the quiz and Your year Actions, and add 'duel', 'karaoke' and 'lyrics' as aliases. Add 'handoff' and 'car' to actions.js VOCAB and use A.item for them in barMoreMenu. Give the karaoke button and its page the same name.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/actions.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/lyrics.js` · **Effort:** S
- **Evidence:**
  - deep1.json palette: guess -> ['Guess the anime ... Action', 'Guess the anime Page']; year -> ['Your year ... Action', 'Your year Page']; duel, karaoke, rescue and gone -> []; car -> no Car mode.
  - app.js:4781-4782 (NAV pages), 4805-4817 (ACTIONS, with the quiz and Your year duplicated), 4165-4167 (the hand-built Continue on your phone and Car mode items). lyrics.js:755 'Karaoke'.

### feature-consistency-16 · low · Your ranking's confidence badges reuse the 'In your library' and 'New' badges

- **Where:** Rank your songs > Your ranking
- **Observed:** 'Sure' uses the green 'ok' badge with the check-circle icon. That same badge means 'In your library' on Explore and the lyrics search, and 'Copy in your library' on Rescue. 'Fairly sure' uses the blue 'new' badge, which elsewhere marks a new best score and new songs. 'Not sure yet' uses the 'library' source badge.
- **Why it matters:** Each badge kind in the design system keeps one meaning.
- **Proposed fix:** Add a neutral 'level' badge kind in ds.css (outlined, no icon) for Sure, Fairly sure and Not sure yet. Or show the confidence as text with a small three-step meter.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/duel.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ds.css`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js` · **Effort:** S
- **Evidence:**
  - duel-badges.mjs: 'ts-badge--ok “Sure” icon:true' and 'ts-badge--new “Fairly sure” icon:false'.
  - duel.js:620 SURE_WORDS = { sure: ['ok', 'Sure'], fair: ['new', 'Fairly sure'], unsure: ['library', 'Not sure yet'] }. ui.js's badge() comment: the kind is 'cost', 'ok' (in your library), 'new', or a source.
  - Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/l-duel-badges.png

### feature-consistency-17 · low · Share the queue copies silently and falls back to a native prompt, while Continue on your phone opens a dialog for nearly the same link

- **Where:** The bar's More: Share the queue as a link vs Continue on your phone
- **Observed:** Share the queue as a link copies a link from the current song on and shows a toast. If the clipboard is refused, it falls back to window.prompt('Copy this link:'), the only native browser dialog in the app. Continue on your phone makes the same kind of link, plus a start second. It opens an in-app dialog with the link, Copy link and a QR code, and when copying fails it selects the link in the field. Your year's Copy as text also falls back to an in-app dialog.
- **Why it matters:** One way to share a queue, and the app's own dialogs instead of the browser's.
- **Proposed fix:** Make 'Share the queue as a link' open handoff.js's dialog (the link field, Copy link and the QR code) with a 'Start at 2:31' checkbox, titled 'Share this queue'. Remove window.prompt.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/handoff.js` · **Effort:** M
- **Evidence:**
  - app.js:1439-1448 shareQueue, with window.prompt at 1446-1447.
  - handoff.js:378-410 open(). wrapped.js:505 (the in-app fallback for Copy as text).
  - Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feature-consistency/shots/d-handoff.png

## Lens: feedback

<details><summary>What this auditor covered</summary>

- Audit folder (scripts s01–s21, helper h.mjs): C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/ ; screenshots in its shots/ subfolder. Nothing in the repo was changed, config.js was never read, and every browser and fake server was closed.
- Devices: desktop 1280x800 and 1024x800 (dark); phone 390x844 with mobile emulation (dark and light); phone with 4x CPU throttling; car mode in portrait on the phone.
- Modes: the demo (mock player, mockErrors 150/101/100/5/2, speed); real mode on IndexedDB with 80–6,000 synthetic songs and ?player=mock, with the Google, i.ytimg and music-service hosts blocked; the real YouTube-player path with the network offline; the repo's own local fake of Google (test/fake-youtube.mjs through ?api=) for sign-in, listing, import, quota running out (quotaAfter), the token expiring (expireAfter), 503s (failNext), searches and latency.
- Routes and surfaces: #/ (first run and library), #/songs (rows, Ctrl+A selection bar, row menus), #/list/<id> (overflow menu, Delete playlist), #/lists, #/settings (YouTube panel: sign-in, list, import, Remove, quota meter), #/for-you (every lane offline, online again, Saved for later > Add to queue), #/explore/<id> (Not interested), #/paste, the bar's More (allowance line), the phone's now-playing sheet and mini player, car mode.
- Toasts: Undo coverage (block, Not interested, clear queue, like, remove from queue, delete or remove a playlist, bulk rating, bulk edit; rescue swap and duel stars checked in the code); two Undos in a row; how long a toast stays, with and without hover; Tab presses to reach Undo after a keyboard menu action; a faded toast's Undo still being focusable; duplicate live regions; placement on desktop, phone, the open sheet and car mode; contrast in both themes (Undo 5.24:1 dark and 8.79:1 light, both fine, so not reported).
- Job chips: placement against the toast and the mini player; four at once (the oldest is dropped); Cancel (no caller passes one); a 10-song Add to queue run against the fake (units spent, chip text over time, the toast storm, no summary at the end).
- Player errors: one 150, a code 5, five in a row (mixed codes), pressing Play again, the stop in car mode; offline Play on the real-player path (the message, the diagnosis line, Try again reloading into Chrome's offline page); the size buttons over the message text.
- System status: offline and back online on For you and Explore (most lanes explain themselves and retry, which is good; the Because lane does neither); quota spent (paste rows, Play, Play all, the meter); import progress away from Settings; reload in the middle of a song (queue kept, position lost); two tabs on one library (likes, playlists and the queue overwritten, both tabs playing); IndexedDB refused (warning shown for 3.5 s only); start-up with 6,000 songs (blank view).
- Done well, so not reported: Delete everything and Restore backup both ask first; Rescue keeps 'Put the old one back' and Duel has Undo on Backspace (good models for a lasting undo); lanes have loading skeletons and explain offline and quota in plain words, with the reset time in local time; lyrics tell 'offline' apart from 'not found'; an import picks up where it stopped.

</details>

### feedback-1 · critical · Two tabs on one library silently erase each other's likes, playlists and queue

- **Where:** Data integrity / two tabs
- **Observed:** Real mode (IndexedDB, mock player), the same profile, two tabs. In tab A I liked 'Quiet Staircase' (rating 5) and made the playlist 'Made in tab A'. Tab B had loaded the library earlier; it played that song to the end and made 'Made in tab B'. After reloading tab A, the song's rating was 0 again: the like was gone. The playlists were ['Road trip picks', 'Made in tab B']: 'Made in tab A' was lost. Tab A's queue had been replaced by tab B's ('Playing from Radio: Quiet Staircase'). Both tabs reported player state 'playing' at the same moment. Neither tab said anything about the other. With the installed app and a browser tab open at once, this happens without anyone noticing.
- **Why it matters:** Never lose people's data silently. Show when another session is active (visibility of system status).
- **Proposed fix:** 1. In app.js start(), use navigator.locks.request('true-shuffle-writer', {ifAvailable:true}) or a BroadcastChannel('true-shuffle') handshake. When a second tab opens, pause the first tab and show a full-width .ts-notice there: 'True Shuffle is open in another tab' with a 'Use it here' button. Only the active tab writes; the other turns read-only through a flag in the store wrapper. 2. Make writes merge instead of overwrite. Add store.update(id, fn) in one readwrite transaction (store.js) and have onListened bump only plays, skips and lastPlayed on the stored record. saveLists should merge by list id with what is stored. 3. Broadcast the changed ids so the other tab reloads those tracks and lists.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/store.js` · **Effort:** M
- **Evidence:**
  - Script C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/s07-twotabs.mjs output: 'A like: rating 5'; 'playing at once: A playing B playing'; 'B sees X rating 0'; 'A after reload: {rating:0, lists:[Road trip picks, Made in tab B], queueLabel: Playing from Radio: Quiet Staircase}'
  - app.js:337-340 onListened runs L.recordPlay on tab B's in-memory track (rating 0), then store.putTracks([t]), so the whole record is overwritten
  - app.js:3257 saveLists() writes the whole 'lists' array; app.js:331 writes the whole queue on every change
  - Searched the code: nothing uses BroadcastChannel, the 'storage' event or navigator.locks; README 'Not done': 'Two tabs on one library: last write wins.'
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/07-tabA-after-reload-lists.png

### feedback-2 · high · A second toast replaces a pending Undo, so earlier actions can't be undone

- **Where:** Toasts / Undo
- **Observed:** ui.js keeps a single toast element, and every toast() or say() clears it. I blocked two songs 2 s apart from row menus on #/songs. Only the second Undo was left: pressing it unblocked 'Paper Parade', while 'String Quartet No. 2…' stayed blocked. The same happened with 'Not interested' on two Explore suggestions 1.8 s apart: after Undo, 'Gentle Tin Cans' stayed hidden. Automatic messages overwrite pending ones too. During an import, 'Imported "Liked videos": 180 videos, 173 new…' stayed on screen for 119 ms (quota run) and 88 ms (expired sign-in run) before the error replaced it. Four 'Skipped …' toasts and the stop message arrived within 10 ms, so only the last was seen. One Add to queue press gave ten toasts 1.2 s apart. Every Undo in the app is exposed to this: block, Not interested, clear queue, like, remove from playlist, Saved for later, rescue swap, duel stars, trim start.
- **Why it matters:** User control and freedom: Undo must be dependable. Don't destroy feedback before it can be read.
- **Proposed fix:** Rework ui.js toast(). Keep a small stack (at most 3, newest on top) instead of one node. A toast with an action is never replaced by one without: plain messages stack above it or wait. Merge repeated undoable actions of the same kind ('2 songs blocked · Undo' restores both). Add an undo history of the last ~10 actions (label plus function) that outlives the toast. Expose it as 'Undo <last action>' in the bar's More and on Z and Ctrl+Z; duel.js:552 (Backspace) and rescue.js:571 ('Put the old one back') already use this pattern. Batch work (foryou.js queueFinds, app.js importTicked) should end with one summary toast instead of one per step.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/foryou.js` · **Effort:** M
- **Evidence:**
  - s02-toasts.mjs: 'blocked after Undo: demo-148 true, demo-083 false'
  - s13-hide.mjs: 'rows still hidden on the page: [Gentle Tin Cans]' after one Undo
  - s12-import.mjs toast logs: success at 94 ms replaced at 213 ms (quota run); 107 ms replaced at 195 ms (expire run)
  - s03-errors.mjs toast log: at 5326, 5331, 5334, 5336 ms
  - ui.js:505-516 (one toastEl; clearTimeout plus clear on every call); app.js:45 say()
  - Screenshots .../feedback/shots/02-block2.png and .../feedback/shots/13-hide-two.png (base C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit)

### feedback-3 · high · Toasts vanish on a fixed timer, can't be reached by keyboard in time, and a faded Undo still acts

- **Where:** Toasts / accessibility
- **Observed:** Plain toasts last 3.5 s whatever their length. Examples: the quota message (138 characters, 26 words), the five-in-a-row stop (up to about 123), the storage warning (about 130), 'Everything stored here was deleted…' (about 150). Undo toasts last 7 s and keep counting under the pointer (one hid at 7,053 ms while hovered) or under focus. After choosing Block from a row menu with the keyboard, focus fell to BODY, and 80 Tab presses didn't reach Undo. After 'Not interested' it went to another row's Play button. Undo was the 187th and last focusable element, 114 Tab presses away, and no key undoes. Once the toast fades (opacity 0, pointer-events none), its Undo stays in the Tab order (tabIndex 0, not hidden or inert). Focusing it and pressing Enter 8 s later silently unblocked the song with nothing on screen. Every say() puts the same text into two polite status regions (#status and .ts-toast), so screen readers may say it twice.
- **Why it matters:** WCAG 2.2.1 Timing Adjustable, 2.1.1 Keyboard, 2.4.3 Focus Order and 2.4.7 Focus Visible, 4.1.3 Status Messages. Also user control and freedom.
- **Proposed fix:** In ui.js toast(): set the duration to clamp(2500 + 60 ms per character, 5 s, 15 s), with at least 10 s when there is an action. Pause on mouseenter and focusin and while document.hidden. Give error toasts a close button and no timeout. On hide, set toastEl.hidden = true (or inert) after the transition so the button leaves the Tab order and can't fire unseen. Add Z and Ctrl+Z for undoing the last action, and label the button 'Undo (Z)'. In blockIds and the media.js hide path, put focus back on the row after the re-render. In app.js:45 say(), fill only one live region: skip setStatus when a toast is shown, or give the toast aria-live='off'.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js` · **Effort:** M
- **Evidence:**
  - s02-toasts.mjs: 'toast with Undo hidden after 7053 ms while hovered'; 'focus after block: BODY'; 'not reached in 80 presses'
  - s13-hide.mjs: 'Tabs to Undo: 114'; 'focusable before the toast: {total:187, index:186}'
  - s21-ghost.mjs: faded toast {opacity:0, visibility:visible, btnTabIndex:0, inert:false}; 'blocked before Enter: true' then 'blocked after Enter on the invisible Undo: false'
  - s19-live.mjs: two role=status aria-live=polite regions holding identical text
  - ui.js:506-516 (timeout 7000 or 3500, no pause, hide only removes .is-on); app.js:45; yt.js:389; app.js:378-384; app.js:3246; app.js:5888

### feedback-4 · high · Deleting a playlist or removing an imported one happens at once, with no confirmation and no Undo

- **Where:** Destructive actions
- **Observed:** On the playlist page, More actions > More > Delete playlist deleted 'Road trip picks' (25 hand-picked songs) at once. No dialog opened (page.dialogs 0, no modal). The toast read 'Deleted "Road trip picks".' without Undo, and the playlist was gone after reload. The inner menu holding Delete opened at the window's top-left corner (8, 8), far from the button, because the overflow menu clicks a detached button (main.click()). In Settings > YouTube > In the library, each playlist has a 75×32 px 'Remove' pill beside its name. One press removed 'Anime mix' at once: no dialog, a 3.5 s toast, no Undo. Here 8 tracks were deleted because the synthetic songs had plays; in a real library every unplayed, unrated, unlabelled song goes. Getting them back means signing in and importing again, which costs quota. By contrast, 'Delete everything' and 'Restore this backup' do ask first.
- **Why it matters:** Error prevention and user control: destructive actions need a confirmation or an Undo. Consistency: wipe and restore already ask, these don't.
- **Proposed fix:** app.js:3455: keep the deleted list object and its index, then show 'Deleted "X" (25 songs) · Undo', which splices it back and calls saveLists() (and uses the undo history from the single-toast fix). app.js:2920 and 3105: open a U.openDialog like the wipe dialog: 'Remove "Anime mix" from the library? 92 songs you never played, rated or labelled will leave; importing it again costs about N units.' Use a danger 'Remove' button and give focus to 'Keep it'. In moreActions, show the inner menu's items directly in the overflow menu (Rename, Edit every song, Delete playlist), or anchor them to the visible 'More actions' button.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s08-destructive.mjs: 'inner menu: Rename… | Edit every song… | Delete playlist'; 'after delete: dialogs 0 modal open false'; 'tracks 200 -> 192 dialog open? false'
  - app.js:3455 (Delete playlist: filter, saveLists, say); app.js:2920 (Remove calls removePlaylist directly); app.js:3105-3111
  - app.js:1779-1786 moreActions: onSelect runs main.click() on a node not in the DOM, so the menu is anchored at 0,0
  - app.js:3001 and app.js:4916: the wipe and restore paths already use U.openDialog confirmations
  - Screenshots .../feedback/shots/08-list-inner-menu.png, 08-settings-remove.png, 08-after-delete-list.png

### feedback-5 · high · Bulk rating and bulk edits overwrite every selected song with no way back

- **Where:** Destructive actions / ratings
- **Observed:** On #/songs I pressed Ctrl+A (192 songs), then More > Rating… > 3 stars. Every selected song became 3 stars: the counts went from {unrated 132, 1★ 12, 2★ 12, 3★ 12, 4★ 12, 5★ 12} to {3★ 192}, so the 12 liked songs (5★) left Liked songs. The toast '192 tracks rated 3 of 5.' had no Undo, and nothing asked first. Saving the editor for many songs ('Saved on N tracks.') has no Undo either, and neither does updating a smart playlist's filter.
- **Why it matters:** User control and freedom; error prevention for bulk operations.
- **Proposed fix:** In rateIds, save {id: rating} (and rating:beforeLike) before L.editMany. Show the toast with an Undo that restores each value. Above about 10 songs, confirm first and state the consequence ('12 liked songs lose their like'). In the editor's save handler, save the old values of the touched fields for each id before editMany, and offer Undo that puts them back with editMany per id.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s08-destructive.mjs: 'ratings before {"0":132,"1":12,"2":12,"3":12,"4":12,"5":12} after {"3":192}'; toast '192 tracks rated 3 of 5.' with btn null
  - app.js:1467-1471 rateIds (editMany, plain toast)
  - app.js:1730-1743 editor save (editMany, say, no snapshot)
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/08-bulk-rating.png

### feedback-6 · high · Offline, Play blames ad blockers, and its only button reloads into Chrome's offline page

- **Where:** Errors / offline
- **Observed:** Real mode, network offline (navigator.onLine false), press Play. After 1.5 s the panel said: 'The YouTube player could not be loaded. Something in this browser may be blocking YouTube: an ad or tracker blocker (uBlock Origin, AdGuard, Brave Shields), strict tracking protection (Firefox, Edge), or a filtering DNS. Allow youtube.com…'. Only the small monospace Details line hints 'blocked or offline'. The toast said 'The YouTube player could not be started here.' The message's one button, 'Try again', runs location.reload(). Offline, that replaced the whole app with Chrome's ERR_INTERNET_DISCONNECTED dinosaur page (chrome-error://chromewebdata/). The app has no offline indicator outside car mode, which already shows 'No signal · waiting 0:42'. The bar treats buffering as playing, so a stalled stream looks like it is playing.
- **Why it matters:** Help people recognise, diagnose and recover from errors: name the right cause and make recovery safe. Visibility of system status.
- **Proposed fix:** In blockedHelp: when navigator.onLine === false, or the diagnosis fetch fails while offline, say 'You are offline. Playback starts again when the connection is back.' On window 'online', retry in place: let lazyPlayer drop `real` after an 'api' error, rebuild it and call ctl.resume(). Keep the ad-blocker text for the online-but-blocked case only. 'Try again' should retry in place, and reload only when online. Add a small 'Offline' chip next to the bar's title (reuse car.js indicators()), and show 'Buffering…' when the player has been 'loading' for more than 8 s.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/player.js`, `misc/101-true-shuffle/car.js` · **Effort:** M
- **Evidence:**
  - s09-offline.mjs A: '+1.5s' playerMsg text as quoted; 'after Try again offline: {url: chrome-error://chromewebdata/, text: … ERR_INTERNET}'
  - app.js:225-231 blockedHelp: 'Try again' runs location.reload(); the ad-blocker text appears whether or not the device is offline
  - player.js:165-190 loadIframeApi sets apiPromise = null on failure, so retrying in place is possible
  - app.js has no online/offline listeners; car.js:743 does; app.js:814 renderTransport counts 'loading' as playing
  - Screenshots .../feedback/shots/09a-offline-play-10s.png and .../feedback/shots/09a-offline-try-again.png (base C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit)

### feedback-7 · high · Some failed songs are skipped silently; the five-in-a-row stop names the wrong cause and leaves no trace

- **Where:** Player errors
- **Observed:** Demo with mock errors. A song failing with code 5 (or 2) was skipped with nothing visible: only the screen-reader status changed ('The video cannot be played in this browser.') and the next song started. A 150 on the very song the person picked showed 'Skipped "Blue Letters": The owner does not allow…' for 3.5 s, with no action. Five failures in a row (codes 101, 150, 100, 5, 2) stopped playback with 'Five tracks in a row could not be played, so playback stopped. Is the network down?'. The network was fine, and three of the five were refusals. The four 'Skipped' toasts and the stop message arrived within 10 ms, so only the last was seen. 3.5 s later nothing explained the stop: the panel still read 'NOW PLAYING Open Orchard' and the bar showed Play. In car mode the screen then read 'Press play to start. The screen will stay on.', as if nothing had happened.
- **Why it matters:** Visibility of system status; accurate error diagnosis; give a way to recover.
- **Proposed fix:** app.js onError: show the same visible toast as onUnplayable ('Skipped "X": …'). haltReason(): describe the codes actually seen ('3 were blocked or removed by their owners, 2 could not play in this browser'). Mention the network only when navigator.onLine is false or every code points to the network. On a stop, also call playerMessage('error', …) under the video with 'Play on from the next song' and 'See these songs' (#/fix or #/rescue). In car.js, show 'Stopped: 5 songs could not play' instead of 'Press play to start'. Give skip toasts for 100, 101 and 150 an action, 'Find another upload' (rescue.js).
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/car.js`, `misc/101-true-shuffle/rescue.js` · **Effort:** M
- **Evidence:**
  - s03-errors.mjs: 'b code 5: … toast on:false … status: The video cannot be played in this browser. now: demo-006 want demo-005'; 'c halt: … Is the network down?'; state {index 4, player error, toggle Play}
  - s20-car.mjs: the halt toast covers the title; afterwards the car text reads 'Press play to start. The screen will stay on.'
  - app.js:359 onError only calls setStatus; app.js:357 the skip toast has no action; app.js:377-385 haltReason falls back to 'Is the network down?' for any mix of codes
  - Screenshots .../feedback/shots/03d-c-halt-later.png, 20-car-halt.png, 20-car-halt-later.png

### feedback-8 · high · Long jobs can't be stopped, don't count progress, and one unbadged press spent 1,000 units

- **Where:** Job chips / quota cost
- **Observed:** Local fake API with each answer 600 ms late; For you > Saved for later > Add to queue with 10 saved songs. The button carries no cost badge and no title. The press still ran 10 YouTube searches, 1,000 units, in 12.3 s. The chip 'Adding 10 songs to the queue…' never changed (no '3 of 10'). A second chip 'Finding "X" on YouTube…' changed with each song. Neither chip ever had a Cancel. Ten toasts ('YouTube found nothing that is surely "X".') replaced each other every ~1.2 s. Nothing was added, so the job ended with no summary at all (job.done('')). No caller of ui.job passes onCancel. 'Add missing to queue' puts its 100-units-a-song cost only in a tooltip. If a Cancel is added as things stand, it sits inside aria-hidden="true": I found it focusable but missing from the accessibility tree.
- **Why it matters:** User control: people must be able to stop long or costly work. Visibility of progress. The app's own rule that a search's cost shows on the button that spends it.
- **Proposed fix:** In foryou.js queueFinds and playItems: put the worst case on the button (a badge 'up to 1,000' when n songs need finding), or ask first above 300 units. Create the job with an onCancel that sets a stop flag, checked inside the reduce. Update the chip with job.set('Adding songs to the queue: 3 of 10…'). Call play.find in a quiet mode and end with one toast: 'Queued 7 of 10; 3 were not found on YouTube · Show them'. In ui.js job(): remove aria-hidden from .ts-jobs (if the duplicate announcement is the worry, keep the chip text out of the live regions instead) so Cancel can be reached. Pass onCancel from the other multi-step jobs too: foryou.js:840 (iTunes previews) and foryou.js:588 (preview radio).
- **Files:** `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - s17-queuefinds.mjs: 'Add to queue button {title:"", badge:false}'; chip text unchanged from 3 ms to 11,061 ms; 'cancel: false' throughout; 'units spent by one press: 1000 search calls: 10'
  - s19-live.mjs: Cancel tabIndex 0 'inside aria-hidden=true', 0 nodes in the accessibility tree
  - foryou.js:366-384 queueFinds (the job has no onCancel and no set(); done('') when nothing was added); foryou.js:1169 (no cost); foryou.js:825 (cost only in the title)
  - ui.js:521-540 job(): aria-hidden on .ts-jobs; the Cancel button only when opts.onCancel
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/17-queuefinds-job.png

### feedback-9 · high · When the browser won't store data, the only warning is a 3.5 s toast at start-up

- **Where:** System status / storage
- **Observed:** I made IndexedDB refuse to open, as happens when a browser blocks site data; store.kind became 'memory'. The warning 'This browser will not let the page keep data (IndexedDB could not be opened.), so nothing will be remembered after this tab closes.' was on screen from 117 ms to 3,621 ms after load, while the page was still settling. After that there was no notice anywhere, and the first-run page still promised 'Your library stays in this browser.' A person could sign in, import thousands of videos (spending quota), label and rate them, and lose everything when the tab closes. The only lasting trace is one line deep in Settings > Data and privacy.
- **Why it matters:** Error prevention. A lasting condition needs a lasting indicator, not a toast that disappears.
- **Proposed fix:** When store.fallback is true, show a persistent role=alert notice at the top of #main, reusing the .ts-notice markup of #stale: 'This window is not keeping anything: your library, labels and ratings go when it closes.' Add an 'Export everything' button. Also replace the first-run copy, warn before Import, and show a small 'Not saved' badge in the bar.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - s16-nostore.mjs: 'store kind memory fallback=true'; toast log on at 117 ms, off at 3,621 ms; 'visible notice? []'
  - app.js:5888 (say() before the first render); app.js:2959 (Settings line only)
  - index.html: the #stale .ts-notice pattern already exists for the 30-day refresh
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/16-nostore-4s.png

### feedback-10 · medium · Job chips and toasts overlap each other, and on phones the chip covers the mini player

- **Where:** Toast and job placement
- **Observed:** Toasts sit 24 px above the bar and chips 12 px above it, at the same z-index, so they collide. On desktop, a toast and a chip shown together overlapped by 4,732 px² and the chip's text became unreadable ('Fin… g … Tube…'). In the For you run, a toast was squeezed between two chips and couldn't be read. On a 390×844 phone, --ts-bar is still 96 px but the mini player and tab bar are 123 px tall. The chip (y 698–736) therefore lies over the top of the mini player (y 722–783), covering its progress line and title: 3,948 px².
- **Why it matters:** Feedback must be legible and must not hide other status; consistent layering.
- **Proposed fix:** Use one status container in ds.css: a fixed flex column (gap 6 px) that holds the chips and then the toasts, anchored at bottom: var(--ts-status-bottom). In app.js, set --ts-status-bottom from the real top of #bar (and #tabbar on phones) on resize, the way U.safe sets the player variables. Chips and toasts then stack and never cover the mini player.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s04-place.mjs: 'desktop job+toast … overlap 4732'; 'phone job+toast … job vs bar 3948'
  - ds.css:184 (.ts-jobs bottom: calc(var(--ts-bar) + 12px)); app.css:886 (.ts-toast bottom: calc(var(--ts-bar) + 24px)); app.css:898 (phone toast bottom: 150px)
  - Screenshots .../feedback/shots/04-desk-job-toast.png, 04-phone-job-toast-dark.png, 17-queuefinds-job.png

### feedback-11 · medium · On phones and in car mode the toast is half the screen wide and sits on the controls

- **Where:** Toast placement (phone, car)
- **Observed:** On a 390 px phone the toast is only 195 px wide. It uses left: 50% plus a translate and has no right edge, so it only gets half the screen. 'Skipped "Blue Letters": The owner does not allow…' wraps to 4 lines (104 px tall). In car mode the stop message wraps to 6 lines (125 px) and covers the 32 px song title. With the now-playing sheet open, the toast (z-index 950, above the sheet's 800) covers the bottom 21 px of the 72 px Play/Pause button (1,512 px²) and part of Next (390 px²) for 3.5–7 s.
- **Why it matters:** Don't cover primary controls. Keep feedback readable on small screens and glanceable while driving.
- **Proposed fix:** In app.css for widths up to 760 px: .ts-toast { left: 12px; right: 12px; margin: 0 auto; width: auto; max-width: 480px; transform: translateY(20px) }, with .is-on at translateY(0). When body.sheet-open, put the toast above .ts-sheet-tp or just under the docked video (top: calc(var(--ts-safe-top) + 8px)). In car mode, send say() to a large status line in #ts-car (about 22 px, under the title) instead of the generic toast.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/car.js` · **Effort:** S
- **Evidence:**
  - s04-place.mjs: phone toast rect {x:98, w:195, h:83 to 104}
  - s05-sheet.mjs: 'overlap toggle 1512 next 390'
  - s20-car.mjs: car toast {w:195, h:125}, 14px font
  - ds.css:193 (left: calc((100vw - safe-right)/2)); app.css:886-887 (translate(-50%)); app.css:898
  - Screenshots .../feedback/shots/03p-a-150.png, 05-sheet-toast.png, 20-car-halt.png

### feedback-12 · medium · The player-size buttons cover the player's error message and the empty-state line

- **Where:** Error message legibility
- **Observed:** On wide windows the S, M, L, theater and full-screen buttons (.ts-vbar) get margin-bottom: -40px so they can share the 'Now playing' line. When the player's message or the empty-state text comes first, the buttons sit on top of it. At 1280 px they hide 'could not be loaded.' and 'browser may be blocking' in the offline error; at 1024 px, 'be loaded.' and 'be blocking'. The first-run line 'No music yet. Try the demo, or sign in under Settings.' is covered too (3,696 px²).
- **Why it matters:** Error messages must be readable; clear visual hierarchy.
- **Proposed fix:** In app.css add: .ts-video:has(> .ts-player-msg) .ts-vbar, body:not(.has-player) .ts-vbar { margin-bottom: 0 }. Alternatively, give .ts-player-msg a margin-top of 44px at 761 px and wider, and add top padding to the empty-state paragraph in #nowinfo.
- **Files:** `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - s14-vbar.mjs: '1280 words under the size buttons: [could, not, be, loaded., browser, may, be, blocking]'; '1024 … [be, loaded., be, blocking]'; '1280 empty … overlap 3696'
  - app.css:1062 (.ts-vbar margin-bottom: -40px); app.css:776 (.ts-player-msg); app.js:215-224 (the message is appended after the vbar)
  - Screenshots .../feedback/shots/14-error-1280.png, 09a-offline-play-10s.png, 16-nostore-4s.png

### feedback-13 · medium · Import progress shows only in Settings; Home says 'Sign in' while an import runs; errors offer no next step

- **Where:** Import status and errors
- **Observed:** Tested against the local fake. After pressing Import and going to Home, nothing showed that an import was running: no chip, no busy state. Home showed the first-run invite 'Your playlists, as a music app … Sign in or import a file' for the whole 8 s the import kept retrying. Results and failures are 3.5 s toasts. 'The sign-in has ended. Sign in again to go on.' has no Sign in button. The 138-character quota message gives no local reset time. Right after 'Today's YouTube API quota … is used up', Settings showed 'YouTube quota used today: 24 of 10,000 units.', because the meter counts only this browser while the quota belongs to the Google project. The interrupted playlist isn't marked 'interrupted' until the lists are fetched again.
- **Why it matters:** Show the status of long background work; make error messages actionable; messages and meters must agree.
- **Proposed fix:** In importTicked(), also open a U.job with progress ('Importing "Liked videos": 1,200 of 5,000') and an onCancel that calls importing.ctrl.abort(), so the import shows on every page. While `importing` is set, the first-run home should say 'Importing your playlists…' with the same progress. Toast actions: 'signed-out' gets a Sign in button; 'quota' gives the reset in local time (lanes.js resetWords) and sets today's quota.units to the daily limit, so the meter, the badges and the engine's budget agree. Set s.pending = true on the failing source right away.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/yt.js`, `misc/101-true-shuffle/lanes.js` · **Effort:** M
- **Evidence:**
  - s12-import.mjs (fail run): 'home while importing … busy marks: 0'; error toast at 8,111 ms
  - s12-import.mjs (expire run): 'The sign-in has ended. Sign in again to go on.' with btn null
  - s12-import.mjs (quota run): settings after {quota: 'YouTube quota used today: 24 of 10,000 units.'}
  - app.js:3056-3091 (progress() writes only into #import-box on Settings); app.js:3052-3055; app.js:3020-3021; yt.js:389
  - Screenshots .../feedback/shots/12-fail-home-while-importing.png, 12-expire-home-while-importing.png

### feedback-14 · medium · With today's allowance used up, buttons still promise a 100-unit search

- **Where:** Quota messaging
- **Observed:** Real mode with an API key and 9,200 of 10,000 units used; engine.quota().left was 0. The pasted list still said '3 of them are looked up on YouTube when they play (a search each, 100 units…)', and every row showed 'Play 100'. Only after pressing Play did it say 'Today's YouTube allowance for finding songs is used up; it starts again at midnight Pacific time.', with no local time. 'Play all' answered 'Nothing could be found to play.', which gives the wrong reason. The allowance appears only inside the bar's More menu ('YouTube today: 9,200 of 10,000 units … 0 left for finding songs').
- **Why it matters:** Error prevention: say so before the press. Messages must give the real reason.
- **Proposed fix:** playCost() should return 'spent' when engine.quota().left < 100. findButtons and media.js should then show the badge as 'Used up' (title: "Today's allowance is used up until 2:00 AM your time"), keeping Play working only for songs already known. Change share.js's note to match. When engine.list or the feeder ends 'over-budget', show the allowance sentence instead of 'Nothing could be found to play.'. Use lanes.js resetWords() for the local reset time.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/share.js` · **Effort:** S
- **Evidence:**
  - s11-quota.mjs: engine quota {left:0}; rows ['Play100' …]; '+250ms' allowance toast; 'play all … Nothing could be found to play.'; the bar's More line
  - app.js:4380-4385 playCost ignores the remaining budget; app.js:4374; app.js:4306; app.js:4176; share.js:270
  - Screenshots .../feedback/shots/11-paste-play-250ms.png, 11-paste-play-all.png, 11-bar-more.png

### feedback-15 · medium · A reload, or Android discarding the tab, restarts the song from 0:00

- **Where:** Reload mid-action
- **Observed:** Real mode, a 5:18 song at 2:00, then reload. The queue, the song and 'Playing from Car songs' came back, but the bar read 0:00 / 5:18 and Play started from the beginning (7.8 s into the song after 0.4 s at 30× speed, so it started at 0:00). The stored queue holds items, index, history, done and repeat, but no position. Nothing offers 'Resume at 2:00'. Android throws background tabs away often, so on the phone and in the car this happens without the person reloading anything.
- **Why it matters:** Keep people's context across interruptions.
- **Proposed fix:** Store { id, sec } (for example under 'queue:pos') every ~5 s while playing and on pagehide and visibilitychange. startQueue() restores it, and the lazy player's first load passes startSec (lazyPlayer.load already honours opt.startSec). Show 'Resume from 2:00' on the poster and the Continue card.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s06-reload.mjs: 'before reload … current 120.36'; 'after reload … time 0, seek [0:00, 5:18]'; 'after Play … current 7.83'; stored queue keys [items, index, history, done, repeat]
  - app.js:331; app.js:5830-5842 startQueue; share.js seekOnPlay and handoff.js already restore a song at a given second
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/06-after-reload.png

### feedback-16 · medium · 'Because you play X' says 'Deezer does not know your artists' when Deezer can't be reached, and never retries

- **Where:** Loading and error states (For you)
- **Observed:** For you while offline: the AniList, iTunes and channel lanes said 'This device is offline… This loads again when the connection is back.' 'Because you play Paper Lanterns' instead said 'Deezer does not know your favourite artists, or you have not played enough yet.', with state 'empty'. When the connection came back, the error lanes reloaded within 53 ms; the Because lane stayed empty. The same happens when Deezer can't be reached while online.
- **Why it matters:** Don't blame the person's listening for a network fault; recover automatically.
- **Proposed fix:** In becausePicks, collect the lookup errors. If no artist was found and at least one lookup failed with a SourceError (offline, network, down, rate or server), reject with that error and reset P.picks. The lane then goes to 'error', shows lanes.explain's text, and lanes.js reloads it on 'online'.
- **Files:** `misc/101-true-shuffle/foryou.js` · **Effort:** S
- **Evidence:**
  - s10-stuck.mjs: 'Because you play Paper Lanterns -> empty | … Deezer does not know your favourite artists…'
  - s18-because.mjs transitions: error lanes go to 'loading' at 53 ms after 'online'; the Because lane has no transition
  - foryou.js:1063-1081 becausePicks swallows every non-abort lookup error and caches the [] result in P.picks; foryou.js:1101-1103 the empty text; lanes.js:274-276 online() reloads only lanes in state 'error'
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/18-foryou-offline-bottom.png

### feedback-17 · low · Removing a song from the queue gives no feedback and can't be undone

- **Where:** Undo coverage (queue)
- **Observed:** In the phone sheet I tapped a row's X (drawn at 60% opacity at the row's right edge). It removed 'Late Meadow' (29 → 28 rows) with no toast, no status text for screen readers and no Undo. The Delete key on a focused queue row does the same. Clear queue, by contrast, has Undo.
- **Why it matters:** Consistent Undo; visibility of system status.
- **Proposed fix:** After ctl.remove(at), show U.toast('Removed "X" from the queue.', { action: 'Undo' }), where Undo puts it back with ctl.insert([id], …) at its old place (and marks it hand-queued again if it was). Also call setStatus for screen readers.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s05-sheet.mjs: 'remove button {label: Remove Late Meadow from the queue, op: 0.6}'; 'queue rows 29 -> 28 … status: '''
  - app.js:1048 and app.js:1093 (ctl.remove(at), nothing else); app.js:1160 (clear queue has Undo)
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/05-sheet-after-remove.png

### feedback-18 · low · Start-up with a large library shows a blank screen with no loading state

- **Where:** Loading states
- **Observed:** 6,000 songs, phone at 390×844 with 4× CPU throttling. From 152 ms to about 1,900 ms after reload, the main view was empty dark grey. There was no tab bar, the mini player was empty apart from a lone Play button, and nothing said 'Opening your library…'. Lanes have skeletons; the app's frame around them doesn't.
- **Why it matters:** Visibility of system status while loading.
- **Proposed fix:** Put a static skeleton in #view in index.html (a heading bar and six grey rows) with aria-busy and an 'Opening your library…' line, and keep the bar's Play disabled until the library is in. renderAll() replaces it.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - s15-boot.mjs: '229 ms {lib:-1, view:(no #view text)}', '661 ms {lib:6000, view:(no #view text)}', '2278 ms … Good evening'
  - app.js:5880-5895 (the first render waits for loadLibrary, loadSettings, history and the engine)
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/feedback/shots/15-boot-p-00630.png

## Lens: accessibility

<details><summary>What this auditor covered</summary>

- Audit only: nothing in the repository was changed. git status is the same as at the start (config.js was already modified before this run, and it was never opened). No files were written to scripts/qa/out. Every script, log and screenshot is in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/ (*.mjs scripts, *.txt outputs, shots/*.png).
- Structure on 34 routes, at 1280x860 desktop and at 390x844 with phone emulation. Checked landmarks, heading order, h1 count, unnamed and repeated control names (Chrome AX tree), focusable elements inside aria-hidden, and lang on CJK text. Routes: #/, #/search?q=paper, #/songs, #/artists, #/artist/paperlanterns, #/genres, #/genre/Alt J-rock, #/browse, #/c/mood/bright, #/works, #/work/Kumori Station Anime, #/track/demo-018, #/mix, #/stats, #/fix, #/settings, #/library, #/lists, #/liked, #/history, #/label, #/map, #/for-you, #/explore/demo-018, #/channels, #/channel/demo-ch-cassette-drawer, #/people, #/duel, #/rescue, #/wrapped, #/lyrics, #/quiz, #/car, #/paste.
- What a screen reader hears: a MutationObserver recorded every live region while playing from a row, n, Next, a song ending on its own, L, M, the - key, Shift+R, a star, the bar heart, a row heart, S, Clear queue with Undo, Block from a row menu, and Ctrl+K typing and arrowing.
- Focus kept or lost after 15 in-page actions (selects, hearts, stars, density radios, queue remove and grip, Fix one-tap, Shuffle everything). Tab order and Tab counts from the page title to Play/Pause on 5 routes. Skip links.
- Dialogs: Keyboard shortcuts, Edit details, Trim and volume, Journey, the kit's Help and the phone sheet. Checked initial focus, Tab trap, Escape, focus return and inert background. Source check of every openDialog caller.
- Menus: the row menu by mouse and keyboard (where it opens, focus return), the order menu, the bar's More, the Focus menu and the split Shuffle caret. Checked AX child roles, arrows, Home/End, type-ahead and Escape. Tabs: the queue tabs and the #/fix tabs. Radio groups: Settings density and the editor's mood.
- Sliders: seek (key steps, how often aria-valuetext changes while focused) and volume. Toggle names and aria-pressed: like, mute, queue, repeat.
- Virtual song list in the AX tree: item count, setsize/posinset, selection, the playing row, and row labels compared with the text shown.
- Reduced motion: running animations on 10 routes, and the jump chips on For you, Settings and Works (scroll frames and where focus goes).
- Zoom and reflow: 640x430 (200% of 1280x860), 320x568, and 320x256 (400% of 1280x1024), idle and playing, on Songs, Settings, For you and Track.
- Forced colours (emulated): Songs, bar, now playing, home and settings screenshots; computed focus rings on 18 controls; the focused menu item; the palette's picked result.
- Colour as the only signal: stars, heart, repeat, selected row and the phone tab bar, with the contrast between states measured in both themes.
- Desktop target size (WCAG 2.5.8) on 10 routes.
- Japanese text: counts from labels.json (1,855 tracks, 963 CJK titles, 1,339 lang 'ja'), and one demo song given a Japanese title, traced through the 7 places it is drawn.
- Search, filter and empty-name validation messages. Car mode: live regions, focus over time, exit.
- Real mode with Google and YouTube hosts blocked: first-run Settings (focus on the file input), and a 1,855-song IndexedDB library (Tab count to Play/Pause). No external hosts were contacted and the database was deleted afterwards.
- Devices and themes: desktop 1280x860 dark and light; phone 390x844 dark and light; 320 px; 640x430; 900x600 (car).

</details>

### accessibility-1 · high · Keyboard focus falls to <body> after everyday actions

- **Where:** Keyboard / focus management (views, now-playing panel, queue)
- **Observed:** 8 of the 12 actions tested lost the focus to <body>, and so did S (shuffle again) and Block from a row menu. The next Tab then starts at the top of the page, hundreds of stops from where the user was. Actions that lost focus: Sort by and Show (selects on Songs), the heart on a song row, a star in Now playing or on the track page, Compact/Comfortable in Settings, removing a song from the queue (x), and Home's Shuffle everything. Actions that kept it: Settings checkboxes, the queue grip, Fix's one-tap reading.

The README promises 'a redraw keeps the focus on the same row', but it doesn't. renderView(true) only looks for a [data-id] element, and it runs before the virtual list has drawn any row. vl.set() runs while the list is detached, place() returns early, and rows only appear on the next animation frame. renderNowInfo and renderQueue rebuild their boxes and never restore focus.
- **Why it matters:** WCAG 2.4.3 Focus Order (A) and 2.1.1 Keyboard: a redraw must never move or drop the user's focus.
- **Proposed fix:** Add one keepFocus(container, redraw) helper in app.js:
1. Before clear(), record a stable key for document.activeElement. Use data-fk keys such as 'sort', 'show', 'star-3', 'like:'+id, 'qx:'+id, 'density-compact', or the element's id.
2. Redraw.
3. In requestAnimationFrame, after vl.place(), focus the element with that key. If it is gone, focus the nearest row or the section heading (tabindex -1), never body.

Use it in renderView(true) (replacing the [data-id] lookup at 761-786), renderNowInfo (967), renderQueue (1028) and renderVbar (4633). In trackList select() (app.js:1288-1307), update is-sel and aria on the rows already drawn instead of calling vl.refresh().
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/focuskeep.txt: Sort by -> BODY (lost); Show -> BODY; Row heart -> BODY; Now-playing star 4 -> BODY; Track page star -> BODY; density Compact -> BODY; Queue remove -> BODY; Home Shuffle everything -> BODY
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/live.txt: 'Enter on star 3' -> BODY; 'Enter on a row heart' -> BODY; 's' -> BODY; 'Block (row menu)' -> BODY
  - app.js:759-786 renderView keeps focus only via ae.closest('[data-id]') (761-762, 783-786)
  - app.js:1348-1351 vl.set() runs before view.appendChild(wrap); rows are drawn in requestAnimationFrame; ui.js:378 place() returns while the box is detached
  - app.js:972 clear(#nowinfo) (stars at 1008-1021); app.js:1037 clear(#queue); app.js:1304 select() -> vl.refresh() (ui.js:404-408) recreates every drawn row

### accessibility-2 · high · Dialogs don't take the focus; Escape can't close them; the page stays live behind them

- **Where:** Dialogs (ui.js openDialog)
- **Observed:** U.openDialog never moves the focus and never makes the page inert. Escape and the Tab trap only work once the focus is already inside the dialog.

Pressing ? on Songs opens Keyboard shortcuts while the focus stays on the page title behind the backdrop. Escape does nothing and the dialog stays open. Tab walks the hidden page: it takes 702 Tabs before the focus first enters the dialog. The library-size test needed 7,177 Tabs just to reach the bar's Play/Pause, which comes before the dialog in Tab order. Trim and volume behaves the same.

In all six dialogs tested, main.inert is false. Edit details, Journey, rename/new playlist, Delete everything, For you's dialogs (they use their own focusIn helper) and the kit's Help work only because each caller focuses something itself. These callers do not: Trim and volume, the language-model question, Keyboard shortcuts, Restore this backup (a destructive confirm), and the album dialogs on the track page and in Explore.
- **Why it matters:** WCAG 2.4.3 Focus Order and 2.1.1 Keyboard; 2.4.11 Focus Not Obscured (the focus sits behind the backdrop); APG modal dialog pattern.
- **Proposed fix:** Fix it once in ui.js openDialog:
- After appending, focus opts.initial, else the first enabled control in the body, else the box (tabindex -1, so the title is read). foryou.js already does this through focusIn().
- While any dialog is open, set inert on #app and .kit-header (and the toast), as sheetInert does at app.js:1185-1192; restore them on close.
- Register the Escape/Tab handler on document in the capture phase while dialogs.length > 0, instead of on the box.

Then drop the per-caller focusIn and focus calls, or turn them into opts.initial.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/dialogs.txt: Keyboard shortcuts: 'focus on open: BODY'; 4 Tabs land on [page] Play, Shuffle, ...; 'after Escape: dialogs ["Keyboard shortcuts"]'. Trim and volume: focus stays on the row and Escape leaves it open. Background mainInert=false in every case
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shortcutsdlg.txt: focus before '?' H1 Songs, after H1 Songs; open after Escape: true; 702 Tabs until the focus enters the dialog
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/dlg-keyboard-shortcuts-.png and dlg-trim-and-volume-row-menu-.png
  - ui.js:332-366 (no initial focus; the keydown for Escape/Tab is on the box only at 353; nothing is made inert)
  - Callers with no focus call: app.js:1402 (trim), 4042 (language model), 4857 (shortcuts), 4916 (restore backup), 5019 (album); explore.js:333 (album). foryou.js:950 already has the focusIn(d) workaround

### accessibility-3 · high · Song lists have ~4 Tab stops per row: 7,177 Tabs to reach the player with an owner-sized library

- **Where:** Keyboard navigation (#/songs and every track list; page shell)
- **Observed:** Rows use a roving tabindex for the arrow keys, but every drawn row still keeps four controls in the Tab order: the artist link, the genre chip, the heart and the ⋯ button. As Tab moves down, the list scrolls and draws more rows.

- Demo (160 songs), from the Songs title: first row after 7 Tabs, 635 stops inside the list, Play/Pause in the bar after 750 Tabs.
- Real mode with 1,855 songs (the size of the owner's labelled library): 7,177 Tabs to Play/Pause, 7,145 of them inside the list.
- Other routes, Tabs from the title to Play/Pause: Home 336, For you 362, Artist 263, Settings 137.

There is no skip link, and the queue and bar come after main in the DOM. Keyboard users without a screen reader cannot jump by landmark.
- **Why it matters:** WCAG 2.4.1 Bypass Blocks (A) and 2.1.1; APG composite widgets have one Tab stop.
- **Proposed fix:** Make each list a single Tab stop. In trackList row(), set tabindex=-1 on every control inside a row, as the row's Play already has. Let ArrowRight/ArrowLeft move between the focused row's controls, or rely on Shift+F10, whose menu already has Go to artist and Go to work.

Add focus-visible skip links as the first children of <body> in index.html: 'Skip to the player' (#bar) and 'Skip to the queue' (#now), with tabindex -1 on those targets. Optionally add a 'Skip past the list' link before each virtual list.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.css` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/keyboard.txt (A): 'first row reached after 7 Tabs; stops inside the song list: 635 across 160 rows; left the list after 642 Tabs'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/taborder.txt: #/ 336, #/songs 750, #/artist 263, #/for-you 362, #/settings 137; skip links: []
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/real.txt: 'songs 1855: Tab presses from the Songs title to the bar's Play/Pause = 7177 (7145 of them inside the song list)'; external hosts []
  - app.js:1244: the row's Play is already tabIndex -1, but the artist link (artistLinks app.js:855), work link (1262), genre chip (1266), heart and More (1269) keep 0
  - index.html:17-20: nothing before the header

### accessibility-4 · high · Toast Undo hides after 7 s even while focused, then stays invisible in the Tab order and still acts

- **Where:** Toasts / Undo (ui.js toast)
- **Observed:** Liking a song (rating 0→5) shows a toast with Undo. It fades after 7 s even though the pointer is on it and Undo has the focus. The focus stays on the now-invisible button, and nothing on screen shows it. Pressing Enter on it still undoes the like (5→0).

10 s later the faded Undo is still in the Tab order (opacity 0) at the end of the document, waiting to undo an old action for anyone who Tabs past the bar. Reaching it takes 5 Tabs from the bar's heart, 17 from the queue's ⋯, and hundreds from the page.

The same toast serves Clear queue, Block, Remove from playlist and Like.
- **Why it matters:** WCAG 2.2.1 Timing Adjustable (A) and 2.4.7 Focus Visible (AA). An action must not fire from a control the user cannot see.
- **Proposed fix:** In ui.js toast():
- Pause the timer on pointerenter/focusin and restart it on pointerleave/focusout. habits.js:596 already does this for its prompt.
- Show it for at least 10 s when it has an action.
- hide() should set toastEl.hidden = true (or remove the button), so nothing invisible stays focusable. If the focus was inside, return it to the element focused before.
- Give Undo a key (e.g. Ctrl+Z, listed in the shortcuts) that runs the last toast's onAction while it is fresh.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/actions.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/toast.txt: '7.5 s later, hovered and focused: {on:false, opacity:0, undoFocusable:true, focus: ts-toast-btn}'; 'Enter on the invisible Undo: rating 5 -> 0'; '10 s later: {Undo, inTabOrder:true, opacity:0}'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/live.txt: 'Tab presses from the menu button to the toast Undo: 17'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/toast-faded-focus.png (focus is on the Undo, nothing visible)
  - ui.js:506-516: setTimeout(hide, 7000) with no pause; hide() only removes .is-on
  - app.css:886-887: the hidden toast is opacity 0 with pointer-events none, but its button stays focusable

### accessibility-5 · high · Screen readers hear nothing when the song changes, and most messages twice

- **Where:** Live regions (#status and the toast)
- **Observed:** These produce no live-region text at all; the bar title changes silently:
- starting a song from a row
- n
- the bar's Next
- a song ending and the next starting by itself

Every say() message is written to two polite live regions at once: #status and the toast (role=status, aria-live=polite). So 'Muted.', 'Sound on.', 'Repeat on…', 'Shuffled what comes next.' and '“Hidden Current” is blocked…' are all queued twice.

Messages that go only to U.toast ('Added to Liked songs.', 'Rated 3 of 5.', plays next, added to queue) depend on a region that is created together with its first message. Screen readers often skip that first one.

Volume changes with - and = say nothing.
- **Why it matters:** WCAG 4.1.3 Status Messages (AA).
- **Proposed fix:** Keep a single live region, #status:
- In ui.js, make the toast purely visual (no role or aria-live) and send each toast's text once through status() (U.toast calls status(text)).
- In afterQueueChange (app.js:643), when ctl.current() differs from the last announced id, setStatus('Playing ' + title + ' by ' + artist) after a 300 ms debounce. Skip it on page load and while typing.
- In setVolume, debounce setStatus('Volume ' + v + '%').
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/live.txt: Enter on a row, 'n (next track)', 'click Next in the bar', '- (volume down)' -> '(nothing announced)'; 'm (mute)' -> p#status.kit-sr: Muted. AND div.ts-toast: Muted.; same for Shift+R, s, Block
  - app.js:44-45 say() = setStatus + U.toast; app.js:643-650 afterQueueChange announces nothing; app.js:1476-1477 blockIds writes both
  - ui.js:508: the toast region is created lazily (role=status + aria-live) in the same tick as its first message

### accessibility-6 · high · A row's ⋯ menu opens at the window's top-left corner and drops the focus when closed

- **Where:** Song lists (every trackList), menus
- **Observed:** Clicking a song row's ⋯ button, or pressing Enter on it, on a row that is not already selected opens the menu at x=8, y=4. That is over the sidebar, about 860 px from the button (button centre 868,637). Closing it with Escape, or choosing an item, leaves the focus on <body>. On a row that was already selected, the menu opens by the button and the focus returns.

Cause: the click handler calls select(i, e, true), whose vl.refresh() destroys and redraws every row. trackMenu therefore gets a detached button: its getBoundingClientRect() is all zeros, and closeMenu skips the focus return because the anchor is no longer in the document. The button also lacks aria-haspopup and aria-expanded.
- **Why it matters:** WCAG 2.4.3 Focus Order; menus open at their trigger; 4.1.2 (aria-haspopup).
- **Proposed fix:** In the More click handler (app.js:1269), find the button again after select(): var r2 = vl.row(i), anchor = (r2 && r2.querySelector('.ts-c-more .ts-btn:last-child')) || e.currentTarget. Then call trackMenu(t, anchor, current()) with returnTo: anchor.

Better, and it also fixes the focus-loss finding: make select() update the drawn rows in place instead of calling vl.refresh().

Build the button with U.btn({ icon: 'more', label: 'More for …', iconOnly: true, menu: true }) so it carries aria-haspopup="menu" and aria-expanded.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/rowmenu.txt: 'mouse: More button centre at 868,637 (row selected before: false); menu at {left:8, top:4, w:220, h:602}'; keyboard the same; 'after Escape focus: BODY'; already-selected row: menu at 848,8 and focus returns
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/rowmenu-mouse.png (Blue Weather's menu drawn over the sidebar)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/menus.txt: anchor 'More for Paper Parade' haspopup=null; Escape -> BODY
  - app.js:1269 select(i, e, true) then trackMenu(t, e.currentTarget, ...); app.js:1304 vl.refresh(); ui.js:314 at.getBoundingClientRect(); ui.js:278 focus return skipped

### accessibility-7 · high · At 200% zoom the page gets 46 px of height while a song plays

- **Where:** Zoom / reflow (the ≤760 px layout)
- **Observed:** 1280x860 at 200% zoom is a 640x430 CSS-px window, which gets the phone layout. While playing, fixed elements take 385 px:
- header: 52 px
- docked video: 210 px
- mini player: 61 px
- tab bar: 62 px

That leaves main 46 px tall on every route tested; idle it gets 256 px. The screenshot shows nothing but the demo banner.

At 400% of 1280x1024 (320x256), main gets 0 px and the mini player and tab bar are pushed below the window.

Width reflows fine: no horizontal page scroll at 320 px.
- **Why it matters:** WCAG 1.4.10 Reflow and 1.4.4 Resize Text (AA). The YouTube player must stay visible and at least 200x200.
- **Proposed fix:** Add a short-landscape layout in app.css: @media (max-width: 760px) and (max-height: 520px) and (orientation: landscape).
- Put the video in a left column (356x200: still ≥200x200 and never covered) with main beside it.
- Move the five tabs into the header as icon buttons, or hide the mini player while the docked video is on screen (both show the same song).
- Keep the header at about 44 px.

Target: at least 250 px of content height at 640x430.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/reflow.txt: '640x430 playing #/songs: header 52, main 640x46@262, bar 640x61@0,308, tabbar 640x62@0,369, video 640x210@0,52'; '320x256 playing: main 320x0, bar @262, tabbar @323, pageScrollY true'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/reflow-640x430-play-_songs.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/reflow-320x568-play-_settings.png
  - app.css:570-611 (587: .ts-player height max(210px, min(56.25vw, 34vh)); 605-610 the tab bar)

### accessibility-8 · high · In forced colours the sliders, the focused menu item and every on/off state disappear

- **Where:** Forced colours (Windows High Contrast)
- **Observed:** With forced-colors: active (emulated):
- The seek and volume sliders are not drawn at all: the track is a gradient and the thumb has opacity 0.
- The focused song row and the focused menu item show neither outline nor box-shadow (both rely on box-shadow alone), so arrowing through a menu shows nothing.
- The palette's picked result looks like the others.
- A 3-star rating shows 5 identical stars.
- The selected row, the current sidebar section, the S/M/L player size and the selected queue tab lose their state.
- The toast loses its box: 'Rated 3 of 5.' floats over a song row.

There is no forced-colors rule in ds.css or app.css.
- **Why it matters:** WCAG 1.4.11 Non-text Contrast and 2.4.7 Focus Visible, under the user's forced colours.
- **Proposed fix:** Add one @media (forced-colors: active) block to ds.css:
- .ts-range::-webkit-slider-runnable-track { background: CanvasText }
- .ts-range::-webkit-slider-thumb { opacity: 1; background: Highlight }
- .ts-row:focus-visible, .ts-menu-item:focus-visible, .ts-pal-item.is-on, .ts-map:focus-visible { outline: 2px solid Highlight; outline-offset: -2px }
- .ts-row.is-sel, .ts-nav-a[aria-current], .ts-tab-a.is-on, .ts-vbtn[aria-pressed=true], .ts-tab[aria-selected=true], .ts-chip.is-on { outline: 2px solid SelectedItem }
- .ts-star[aria-pressed=true], .ts-icon-btn[aria-pressed=true] { color: Highlight }
- .ts-toast { border: 1px solid CanvasText }

Better still, draw focus with outlines everywhere (see the focus-ring finding).
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/forced.txt: '.ts-row: outline=none | box-shadow=none' under forced colours
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/forcedmenu.txt: focused 'Full screen' menu item outline none, box-shadow none; shots/forced-menu.png and shots/forced-palette.png show no focused or picked item
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/forced-on-bar.png (nothing between 0:02 and 4:23, no volume track) vs forced-off-bar.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/forced-on-songs.png vs forced-off-songs.png (5 white stars for a 3-star rating; selected row and current nav item unmarked; toast text over the list)
  - app.css:183 (gradient track), 186 (thumb opacity 0), 228-230 (stars), 385 and 442 (box-shadow focus), 872 (palette pick), 886 (toast)

### accessibility-9 · high · Japanese titles carry no lang: screen readers read them with the English voice

- **Where:** Language of parts (titles, artists, works)
- **Observed:** The page is lang="en" and no element in the app ever gets a lang attribute. The shipped labels.json covers 1,855 songs: 963 titles contain kana or kanji, 1,339 songs are labelled lang 'ja', and 434 artists have a Japanese native name.

One demo song was given the title 君の知らない物語 (lang 'ja'). It is drawn in 7 places, and every one inherits lang=en:
- the hero h1
- the now-playing h2
- the bar title
- the sticky header
- the player card
- two cover-art initials

A screen reader's English voice skips or garbles such text. Each song row's aria-label also flattens the title into a string that cannot carry a lang.
- **Why it matters:** WCAG 3.1.2 Language of Parts (AA).
- **Proposed fix:** Add U.langOf(text, hint) in ui.js: kana → 'ja'; Han only → the hint ('ja' or 'zh'); Hangul → 'ko'; otherwise null.

Set lang on each element that holds track text:
- row title spans (app.js:1249)
- queue rows (1046, 1076)
- the hero h1 (1761)
- the now-playing h2 and titleAlt (978-979)
- the bar title (798)
- media.js rows and cards, lane titles, lyrics
- artistNative

In rows, drop the aria-label (see the virtual-list finding) so the lang-tagged title becomes the name.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/lanes.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/names.txt: 'Japanese title drawn in 7 places' each 'lang=en' (h1.ts-hero-title, h2.ts-now-title, button.ts-bar-title, ...)
  - misc/101-true-shuffle/labels.json (counted with node): tracks 1855, cjk titles 963, lang ja 1339, artists with cjk native 434
  - index.html:2 <html lang="en">; grep finds no lang attribute set anywhere in app.js, media.js, lanes.js, explore.js, foryou.js, lyrics.js or ui.js
  - Places that draw track text: app.js:798 (bar), 978 (now playing), 1046 and 1076 (queue), 1249 (row title), 1761 (hero h1); app.js:1241 row aria-label

### accessibility-10 · medium · The Ctrl+K palette's highlighted result is never exposed

- **Where:** Command palette
- **Observed:** The palette input has aria-controls, but no role=combobox, aria-expanded or aria-activedescendant, and the options have no ids. After typing 'pap' and pressing ArrowDown, one of the 11 options is aria-selected, but aria-activedescendant stays null. A screen reader says nothing about the highlighted result, Enter runs an unannounced choice, and the result count is never announced.
- **Why it matters:** WCAG 4.1.2 Name, Role, Value and 4.1.3; APG combobox with a listbox popup.
- **Proposed fix:** In openPalette:
- Give the input role="combobox", aria-expanded="true" and aria-autocomplete="list".
- Give each li an id ('ts-pal-o' + i).
- In mark() and after draw(), set inp aria-activedescendant to items[at]'s id.
- After each draw, debounce setStatus(n + ' results').
- Move 'Nothing matches.' out of the listbox, as a status line.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/live.txt: 'INPUT role=null aria-expanded=null aria-controls=ts-pal-list aria-activedescendant=null'; after typing + ArrowDown: options 11, activedescendant null, the selected option has no id; 'palette typing (nothing announced)'
  - app.js:4825-4852 (input, listbox, mark())

### accessibility-11 · medium · Focus rings that can't be seen: song rows at 1.7:1, and the hidden file inputs

- **Where:** Focus indicators
- **Observed:** The song row is the main keyboard target of every list. It shows focus with an inset 2 px box-shadow at 35-40% alpha: 1.69:1 against the panel in the light theme, 2.38:1 in dark. Other controls use an opaque 2 px outline (rgb 124,179,255 in dark). Menu items use the same faint ring.

In Settings, Tab lands on #labels-file, a 1x1 px visually hidden file input. The visible 'Apply a labels file' label shows no outline, so the focus is invisible. 'Restore from a file' and the works page's labels file use the same pattern.
- **Why it matters:** WCAG 1.4.11 Non-text Contrast (3:1) and 2.4.7 Focus Visible (AA).
- **Proposed fix:** At app.css:385 and 442, use .ts-row:focus-visible, .ts-menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; box-shadow: none }. This is the kit's opaque focus colour, at least 3:1 in both themes.

For the file pickers, add .kit-sr[type=file]:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 2px }, or replace the label-as-button with a real <button> that calls input.click().
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/rowring.txt: 'dark: ... contrast vs the panel 2.38:1'; 'light: ... 1.69:1'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/rowring-light.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/filein.txt: 'after Tab: focused labels-file, rect [296,406,1,1], labelOutline none, labelShadow none'; shots/filein-focus.png
  - app.css:385 .ts-row:focus-visible and 442 .ts-menu-item:focus-visible (box-shadow with var(--accent-ring)); kit.css:34 --accent-ring rgba(31,95,214,0.35)
  - app.js:2934-2937 (labels-file), 2951-2954 (import-file), 2344 (works-labels-file)

### accessibility-12 · medium · Sticky bars hide the focused control (Settings jump bar, Songs header)

- **Where:** Focus not obscured (Settings, Songs)
- **Observed:** Settings: Shift+Tab upward puts the focus fully under the sticky jump bar, which wraps to two rows of chips (about 92 px) at 1280 wide. 6 of 28 stops are at least 50% covered; 'Compact' and 'Comfortable' are 99% covered and a checkbox 100%. The screenshot shows no focused control at all.

Songs: Shift+Tab back through row controls puts the 'Alt J-rock' chip 98% under the sticky title bar and table head, 'Like Open Orchard' 83%, and 'More for Open Orchard' 80%.

Arrow keys on rows are fine: vl.reveal keeps 60 px clear.
- **Why it matters:** WCAG 2.4.11 Focus Not Obscured (Minimum) (AA, new in 2.2).
- **Proposed fix:** Give the scroller a scroll padding: .ts-main { scroll-padding-top: var(--ts-sticky-h, 72px) } at app.css:99. Set --ts-sticky-h from JS with a ResizeObserver to the height of whichever sticky bars the view has (.ts-set-jump; .ts-sticky.is-on plus .ts-thead; .ts-mixsum). The browser's focus scroll-into-view then stops below them.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/keyboard.txt (C): 'Settings, Shift+Tab upward (28 steps): focus >=50% under a sticky bar: 6', e.g. {frac:100}, Compact {frac:99}
  - keyboard.txt (B2): 'Alt J-rock' ts-sticky 98%, 'Like Open Orchard' 83%, 'More for Open Orchard' 80%
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/kb-settings-covered.png
  - ds.css:178 .ts-set-jump sticky; app.css:862-863 .ts-sticky (60 px); app.css:376 .ts-thead sticky top 0; app.css:99 .ts-main has no scroll-padding

### accessibility-13 · medium · States shown by colour alone: stars, heart, Repeat, selected rows, the phone's current tab

- **Where:** Use of colour
- **Observed:** - Rating: 3 gold and 2 grey stars of the same filled shape.
- Liked or not: the same filled heart, pink vs grey.
- Repeat on or off: only the accent colour differs.
- Selected row: only its background.
- An artist who is only a guess: only italic grey text.
- Phone tab bar: the current tab ('For you') differs from the others only by text colour, 1.29:1 between the two states in dark and 1.14:1 in light, with the same weight (650). It also has no aria-current (the sidebar has one).

On a desktop the stars are 22x26 px with no gap, so 2.5.8 target spacing fails.
- **Why it matters:** WCAG 1.4.1 Use of Color (A), 1.3.1, 2.5.8 Target Size (AA).
- **Proposed fix:** Show state by shape as well as colour:
- Add outline 'star-o' and 'heart-o' paths to ui.js PATHS, and swap icons in stars() (app.js:1008), renderHeart (4732) and the row likeButton.
- Give pressed icon toggles a dot or underline in ds.css:112.
- Phone tabs: aria-current="page" in renderNav (app.js:724), plus a filled icon or a 3 px bar for .ts-tab-a.is-on (app.css:610).
- Selected rows: a 3 px left border.
- Stars: at least 24 px wide hit areas (padding 4px 5px).
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/phone.txt: 'current colour [243,245,248] vs other [213,218,226]: contrast between the two 1.29:1'; light 1.14:1; aria-current=null on all five
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/phone-tabbar-dark.png
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/shots/forced-off-songs.png (stars, heart)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/targets24.txt: 'CLASH 22x26 button.ts-star'
  - app.css:228-230 (stars), 850 and ds.css:113 (heart), app.css:136 and ds.css:112 (pressed toggles), app.css:384 (selected row), app.css:610 (tab), app.js:724 (tab bar has no aria-current)

### accessibility-14 · medium · The virtual song list hides its size, position, selection and row tags from screen readers

- **Where:** Virtual list (#/songs and every trackList)
- **Observed:** The AX tree shows the list 'Tracks' with 14 listitems for 160 songs and no aria-setsize/aria-posinset. A screen reader says 'list, 14 items', never 'song 37 of 160'.

Each row's aria-label ('Title, Artist') replaces what the row shows:
- 'Paper Lighthouse, Neon Abacus' while the row shows 'Blocked'
- 'Electric Kindling, Neon Abacus' hides 'Remix'
- 'Hollow Compass - Painted Harbor, cassette drawer' hides that the artist is a guess
- the work, genre and time are dropped from every row

Selection is only the text ', selected' appended to the label (no aria-selected). The playing row is marked by a class alone.
- **Why it matters:** WCAG 1.3.1 Info and Relationships (A), 4.1.2.
- **Proposed fix:** - In ui.js virtualList place(): row.setAttribute('aria-posinset', i + 1) and row.setAttribute('aria-setsize', count).
- Name the list for what it is ('Songs').
- At app.js:1241, drop the row aria-label so the row reads its own content (title, tags, artist, from, genre, time), or build the label from all of those.
- markPlaying: add aria-current="true" to the playing row.
- When the selection changes, setStatus('3 songs selected').
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/vlist.txt: 'song list "Tracks": 14 listitems exposed; list props {}'; row props {focusable, level} only; label vs shown pairs; 'selected row: {label: "Paper Parade, Quiet Ferrymen, selected", ariaSelected: null, role: listitem}'
  - ui.js:372-394 virtualList place() sets top/height/dataset.index only
  - app.js:1241 the row aria-label; app.js:1211-1218 markPlaying toggles a class only

### accessibility-15 · medium · Single-key shortcuts can't be turned off

- **Where:** Keyboard shortcuts
- **Observed:** n, p, s, q, o, r, Shift+R, l, m, t, f, w, e, i, b, ?, -, = and / act anywhere outside a text field, and nothing in Settings turns them off or remaps them. A stray keystroke or a speech-input command can:
- reshuffle what comes next (s; there is no Undo)
- like the song (l)
- open the editor (i)
- leave the page for Explore (e)
- **Why it matters:** WCAG 2.1.4 Character Key Shortcuts (A).
- **Proposed fix:** Add a 'Single-key shortcuts' checkbox in Settings > Playback (on by default, ToyKit.store('singleKeys')). When it is off, wireKeys returns early for unmodified character keys, and Alt+key still works. Say so in the shortcuts dialog. Give s (shuffle again) an Undo toast, as Clear queue has.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/actions.js` · **Effort:** S
- **Evidence:**
  - app.js:5692-5727 wireKeys: unmodified character keys handled globally
  - actions.js KEYMAP; grep of app.js for any 'shortcut' setting finds only the shortcuts dialog (4177, 4817, 4857)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/live.txt: 's (shuffle again)' -> 'Shuffled what comes next.' with no Undo

### accessibility-16 · medium · ARIA roles that promise keys the widgets don't support (Fix tabs, radio groups, menus)

- **Where:** Widget patterns
- **Observed:** #/fix tabs: six <a role=tab> in a tablist, all in the Tab order, with no tabpanel. ArrowRight does nothing.

Radio groups: Settings 'Song list density' (2 radios) and the editor's 'Mood' (7) are role=radio buttons, each its own Tab stop. ArrowRight neither moves nor checks.

Menus:
- The group headings (PLAY, FIND MORE, KEEP, GO TO, FIX) are bare divs inside role=menu, so screen readers drop them in focus mode.
- Key hints are part of the names ('Start radio R', 'Theater mode T').
- The order menu's on/off toggles ('Keep songs of one anime or game apart', 'One version of each song') are menuitemradio, the same role as the exclusive orders.
- There is no type-ahead: g and r do nothing.
- **Why it matters:** WCAG 4.1.2 Name, Role, Value; APG tabs, radio group and menu patterns.
- **Proposed fix:** - Fix tabs: they navigate, so drop role=tablist/tab and put aria-current="page" on the active link.
- Radio groups: add a small roving-tabindex helper in ui.js: one Tab stop, and the arrow keys move and check.
- openMenu: wrap each heading and its items in role="group" with aria-labelledby pointing at the heading. Put hints in an aria-hidden span and set aria-keyshortcuts. Add an item kind 'check' that renders role=menuitemcheckbox. Add first-letter type-ahead to the menu keydown.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/vlist.txt: '#/fix tabs: n 6, tag A, parentRole tablist, tabindex [0,0,0,0,0,0], panel false'; ArrowRight leaves the focus on the first tab
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/radios.txt: density 2 radios 2 tabbable, ArrowRight unchanged; editor mood 7 radios 7 tabbable, ArrowRight unchanged
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/menus.txt: generic 'PLAY' children of menu; 'Start radio R'; menuitemradio for the order and its toggles; type-ahead g and r do nothing
  - app.js:2791 (Fix tabs), 2966 (density), 1610-1617 (mood); ui.js:289-296 (headings, hints, roles), 301-308 (keydown)

### accessibility-17 · medium · Search results, filter counts and a nameless playlist are never announced

- **Where:** Status messages and errors
- **Observed:** Typing 'glass' in the header search draws 'Results for “glass”' with 10 songs while the focus stays in the box; nothing reaches any live region. 'glasszzzq' shows 'Nothing found…', also silently. On Songs, filtering 'paper' changes the count to '35 songs · 2 h 34 min' without a word. In New hand-picked playlist, pressing Create with an empty name does nothing at all: no message, no aria-invalid, no announcement.
- **Why it matters:** WCAG 4.1.3 Status Messages (AA) and 3.3.1 Error Identification (A).
- **Proposed fix:** - After a search or filter redraw, debounce (~600 ms) setStatus('10 songs, 2 artists, 1 anime'), to #status only, not a toast.
- In createList (app.js:3318), set aria-invalid="true", show 'Give the playlist a name.' in an element linked by aria-describedby, and setStatus it.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/search.txt: 'typed "glass": {live:[], h1: Results for “glass”, songs:10, focus: search}'; 'glasszzzq': live [] with 'Nothing found…'; 'filter "paper" on Songs: live [] ... count 35 songs'; 'Create with an empty name: {open:true, invalid:null, describedby:null, errorText:[], live:[]}'
  - app.js:2003-2039 viewSearch; 2103-2115 the Songs filter; 3318 'if (!name) { inp.focus(); return; }'

### accessibility-18 · low · The seek slider re-reads the time every second; toggles state their state twice

- **Where:** Player bar controls
- **Observed:** With the seek slider focused, its aria-valuetext was rewritten 20 times in 5 s (5 distinct values), so a screen reader keeps re-reading '0:02 of 5:03', '0:03 of 5:03'… while the user listens. ArrowRight moves 1 s; PageUp moves 30 s. Volume has no valuetext.

Three toggles change their label and also set aria-pressed:
- the heart: 'Remove from Liked songs' + aria-pressed=true
- mute: 'Unmute' + pressed
- the queue button: 'Hide the queue' + pressed

They read as 'Remove from Liked songs, toggle button, pressed'.
- **Why it matters:** WCAG 4.1.2; APG slider and toggle-button patterns.
- **Proposed fix:** - renderTime: while document.activeElement === r and the user is not seeking, update aria-valuetext only every 10 s (or on focus).
- Step the seek slider 5 s (step="5").
- Volume: aria-valuetext = v + '%', or 'Muted'.
- Toggles: keep fixed labels ('Like', 'Mute', 'Queue') with aria-pressed, or drop aria-pressed and keep the changing label. Not both.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/vlist.txt: 'focused seek slider: aria-valuetext changed 20 times in 5 s (distinct: 5)'; 'ArrowRight ... moved 1.0 s; PageUp then moved 30.2 s'; volume valuetext null; like {label: Add to Liked songs, pressed false}; queue {label: Hide the queue, pressed true}; mute {Unmute, true}
  - app.js:830-844 renderTime (valuetext on every tick), 4662-4671 renderVolume, 4732-4741 renderHeart, 1169-1175 setQueueHidden

### accessibility-19 · low · Headings: two h1 on every page, an empty h1 and nameless home link on phones, no h1 on the map

- **Where:** Headings / landmarks / page titles
- **Observed:** Every route except Map and Car has two h1: 'True Shuffle' in the header and the page's own. The sidebar's h2 'Playlists' comes before the page h1.

At 760 px and below, the header h1 is empty in the AX tree and its home link has no name, on every route except Car. .ts-brand-name is display:none and the logo is aria-hidden.

#/map has no h1, so document.title stays 'True Shuffle' and the focus falls to <body> on arrival.

Landmarks are otherwise sound: banner, search, nav 'Sections', main, complementary, contentinfo 'Player', and a named region per lane.
- **Why it matters:** WCAG 1.3.1, 2.4.2 Page Titled, 2.4.6, 4.1.2 (link name).
- **Proposed fix:** - Let the kit accept a non-heading title (kit.js:893: n.tagName === 'H1' || n.classList.contains('kit-title')), and make index.html:20 a <p class="ts-brand kit-title">.
- Give the brand link aria-label='True Shuffle, home', and hide the name with the kit-sr technique instead of display:none (app.css:573).
- viewMap (app.js:3710): add an h1 'Map', visible or kit-sr.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js`, `misc/_kit/kit.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/structure-1280.txt: h1s ['True Shuffle [header]', '<page> [main]'] on each route; '#/map title="True Shuffle" focus=BODY h1s: [True Shuffle]'
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/structure-390.txt: 'unnamed: 1 link a.ts-brand-link' on 33 routes; axnames.txt 390: 'headings (AX): 1:(EMPTY)'
  - index.html:20; app.css:573; app.js:3710 viewMap (no h1); app.js:779-782; kit.js:893-900 (the kit takes the header h1 as the title, or makes one)

### accessibility-20 · low · For you's jump chips ignore reduced motion and leave the focus behind

- **Where:** Reduced motion / in-page navigation
- **Observed:** Reduced motion is honoured on the whole: with prefers-reduced-motion: reduce, html.is-reduced is set and no CSS animations run on the 10 routes checked. But For you's 'New releases' chip still smooth-scrolls 2,110 px over 89 animation frames, because behavior: 'smooth' is hard-coded in JS, which the kit's scroll-behavior rule cannot override. The focus stays on the chip, so the next Tab goes to the next chip, not into the lane. Settings' jump does both right: one jump, and focus on the section heading.
- **Why it matters:** prefers-reduced-motion (WCAG 2.3.3, AAA) and WCAG 2.4.3 Focus Order.
- **Proposed fix:** At foryou.js:1379 and explore.js:569, use behavior: ToyKit.reducedMotion ? 'auto' : 'smooth', then focus the lane's h2 (tabindex -1, preventScroll), as app.js:3010 does.
- **Files:** `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/explore.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/accessibility/motion.txt: '#/for-you: jump "New releases" -> scrollTop went through 89 values (0,1,2 ... 2110); focus after: button "New releases"'; '#/settings: ... 2 values; focus after: h2 "Appearance"'; 0 running animations on 10 routes
  - foryou.js:1379 and explore.js:569 (behavior: 'smooth'); app.js:3010 is the right pattern

## Lens: visual-system

<details><summary>What this auditor covered</summary>

- All screenshots, data and scripts are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/ (shots/, sheets/, data/, scripts/). Nothing in the repo was changed and no git commands were run. Every browser was closed by the harness.
- Measured 35 demo routes for computed styles and took a screenshot of each: Home, Search, Songs, Artists, Artist, Genres, Family, Genre, Moods & scenes, Mood, Works, Work, Track, Explore, For you, Channels, Channel, Voice actors, Playlists, Liked songs, Mix builder, History, Your year, Guess the anime, Rank your songs, Your numbers, Quick labeller, Needs attention, Settings, Map, Lyrics, Rescue, Paste, Library and Car. Sizes: 1280x800 dark and light, 390x844 phone dark and light, 1000x760 dark, 1920x1080 dark (data/census-*.json, shots/<theme>-<width>/).
- Contact sheets: dark and light side by side at 1280 (sheets/pair-dark-1280-light-1280-01..06.png), phone grids for both themes (sheets/grid-dark-390m.png, sheets/grid-light-390m.png), 1920 (sheets/grid-dark-1920.png), and one song row per page (sheets/grid-rows-dark-1280.png).
- Static count of every value in app.css, ds.css and the CSS that 16 page modules inject from JS: font-size, weight, radius, line-height, letter-spacing, gap, box-shadow, hex colours, and how often each ds.css token is used (data/static-css.json).
- A component inventory built from the page's own classes after every module had injected its CSS: pills, small labels, selected states, icon buttons, text actions, overlines, h2 and h3 styles, each labelled with its measured size, in both themes (shots/specimen-dark.png, shots/specimen-light.png).
- Which font actually renders: CDP CSS.getPlatformFontsForNode at every weight the CSS asks for, Chrome 155 on this Windows desktop (data/fonts.json, shots/font-weights.png).
- Text contrast measured from real pixels, not just CSS background colours, so gradients count: hero kicker, meta, blurb and trail on 19 routes in both themes, and 78 coloured tiles in both themes (data/grad-contrast-1280.json, data/tiles.json, data/tilemath.json).
- Interaction states: hovering selected chips on Artists, Works, Needs attention (Fix), Explore, For you, Settings and Mix builder; liked-heart colours in a song row versus the player bar (data/hover-on.json, shots/hover-*.png).
- Floating surfaces in both themes: row context menu, order menu, Ctrl+K palette, Edit details dialog, keyboard-shortcuts dialog, the kit's help dialog, and a toast with Undo (shots/overlays/, data/overlays.json). Close-ups of the top bar, player bar and filter bar (shots/chrome-*.png, data/chrome.json).
- Song rows measured and cropped on 8 pages (data/rows-dark-1280.json). Vertical gaps above section headings on 22 routes (data/rhythm.json). Left edges at 1280 and 1920 (data/align.json). Link colours versus their intended tokens (data/link-colors.json).
- Real cover art in real mode: a 60-track library with YouTube-shaped ids, with every i.ytimg.com request answered locally (CDP Fetch) by a 320x180 test card, at DPR 2. Google, YouTube and music-service hosts were blocked, no quota was spent, and the database was deleted afterwards (shots/thumbs/, data/thumbs.json).
- Not covered: real YouTube thumbnails with burned-in text, AniList posters, a real Android device, Inter-installed machines, and states the demo cannot reach (listening history, duel ranking rows, Your year with data).

</details>

### visual-system-1 · high · Hovering a selected chip makes its label disappear (about 1.2:1 contrast)

- **Where:** interaction states
- **Observed:** When the pointer is over a selected .ts-chip, the chip loses its solid background (it shows the 5% hover tint) but keeps the inverted text colour, so the label vanishes. In dark theme it becomes near-black text on a near-black panel; in light theme, white text on near-white. This hits the filter and tab chips most used for navigation: Artists 'All 12', Works 'All 2', the Needs attention tabs, and the pressed chips in Mix builder, the Moods & scenes mixer and the quick labeller.
- **Why it matters:** A selected control must keep its look and its contrast in every other state, including hover and focus (WCAG 1.4.3).
- **Proposed fix:** In app.css:273, scope the hover rule to unselected chips: 'a.ts-chip:not(.is-on):hover, button.ts-chip:not(.is-on):hover { ... }'. Add 'a.ts-chip.is-on:hover, button.ts-chip.is-on:hover { background: var(--heading); border-color: var(--heading); color: var(--bg); filter: brightness(0.92) }' if hover feedback is still wanted. Then delete the duel.js:276 patch.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/duel.js` · **Effort:** S
- **Evidence:**
  - Measured with scripts/hover-on.mjs and verify2.mjs. Dark: before hover rgb(15,17,21) on rgb(243,245,248); under the pointer rgb(15,17,21) on rgba(255,255,255,0.05) over #13161b, about 1.2:1. Light: rgb(255,255,255) on rgba(16,24,40,0.05) over #f7f8fa, about 1.2:1. Same result for a.ts-chip.is-on on #/artists, #/works and #/fix, and for button.ts-chip.is-on in #/mix ('Anime & idol 10').
  - Control group: a selected .ts-btn--chip (Explore 'Top songs 12') and .ts-seg-b (For you 'Some', Settings 'Comfortable') keep their fill under the pointer.
  - Before and after: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/hover-dark-fix-0.png and hover-dark-fix-1.png. Also hover-light-artists-1.png and hover-dark-mix-1.png in the same folder; data in data/hover-on.json.
  - Cause: app.css:273 'a.ts-chip:hover, button.ts-chip:hover' (specificity 0,2,1) beats app.css:276 '.ts-chip.is-on' (0,2,0). duel.js:276 already patches this for its own tabs only ('.ts-duel-tabs a.ts-chip.is-on:hover').

### visual-system-2 · high · Light theme: text on hero bands and coloured tiles falls below 4.5:1, while the same text passes in dark

- **Where:** light/dark parity, colour
- **Observed:** In light theme, the hero band and the tiles use a mid-tone saturated colour (--ts-tileL 40%). The grey kicker and meta text on the hero, and the white text on the tiles, did not change with it. In light, every hero kicker ('DISCOVER', 'ARTIST', 'PLAYLIST', 'SONG'...) is hard to read, as are most hero meta lines (song count and length). About a third of mood, genre and playlist tiles carry white text under 4.5:1. Dark theme mostly passes.
- **Why it matters:** Theme parity: every text and background pair must clear 4.5:1 in each theme. When a surface changes per theme, the text on it must change too.
- **Proposed fix:** Light theme only. (a) For text on the hero band, use 'html:not([data-theme=dark]) .ts-hero .ts-kicker, .ts-hero-meta, .ts-hero-alt, .ts-x-trail { color: var(--text) }'. Alternatively, lighten the light band: drop alpha from 0.75 to about 0.35, or use an hsl(h s 88%) tint. (b) Set the light-theme --ts-tileL to 30–32% and cap the mood gradient's light stop at about 36%, or use dark text (#111) on hues from about 40 to 180. (c) Make ui/contrast.mjs sample real pixels, as grad-contrast.mjs does, so gradients are checked from now on.
- **Files:** `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - Method (scripts/grad-contrast.mjs): each text is made transparent, its box is screenshotted, and the real pixels behind it are averaged. The earlier ui/contrast.mjs read only background-color, so it could not see gradients.
  - Hero kicker (.ts-kicker, 11px/700 uppercase, --text-2): in light, all 15 hero routes are below 4.5:1. For you 1.61, family 1.65, Songs 1.83, work 1.86, quiz 1.90, Channels 1.90, Liked 2.08, artist 2.47, paste 2.63, duel 2.64, Your year 2.78, track 3.05, channel 3.07, Explore 3.14, mood 3.19. In dark: 3.84 to 6.34, with 3 of 15 below 4.5.
  - Hero meta (.ts-hero-meta, 13.5px/600): in light, 7 of 12 are below 4.5 (artist 3.78, Songs 3.99, track 4.14, For you 4.43, family 4.44, Channels 4.44, Liked 4.46). In dark: 5.81 to 6.93, none below. The Explore trail (.ts-x-trail, 13px) measures 2.75 in light and 5.43 in dark.
  - Tiles (scripts/tilemath.mjs: white text against each tile's CSS colour or both gradient stops, on #/, #/genres, #/browse and #/lists). Light: 23 of 78 tiles below 4.5:1 and 4 below 3:1 (Tender 2.40, Bright 2.68, Technopop & new wave 3.15, Lo-fi & jazz hop 3.27). Dark: 4 of 78 below 4.5, worst 3.80. Tile titles are 18px/800, just under the 18.66px bold size that counts as large text.
  - Screenshots in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/: shots/light-1280/15-foryou.png (DISCOVER), shots/light-1280/20-liked.png, shots/light-1280/24-quiz.png, shots/tiles-moods-light.png against shots/tiles-home-dark.png. Side by side: sheets/pair-dark-1280-light-1280-04.png.
  - Cause: --ts-tileL is 40% in light (app.css:15) and 30% in dark (app.css:26). It colours the hero band at 0.75 opacity (app.css:301) and the tiles (app.css:360; the mood gradient adds +6%, app.css:367). The text keeps --text-2 (app.css:213, app.css:310) or #fff in both themes (data/census: tile text is identical in both themes).

### visual-system-3 · medium · Type has no scale: 23 rendered sizes in half-pixel steps, 8 weights that render as 4 faces on Windows, and near-duplicate heading and overline styles

- **Where:** typography
- **Observed:** Text sizes run from 10.5px to 15px in 0.5px steps, and similar roles get neighbouring values. The CSS asks for 8 weights, but Inter is neither loaded nor installed, so on the owner's Windows desktop the page renders in Segoe UI, which has only 4 matching faces. 550, 650 and 750 never render as such: 650 is drawn the same as 700, and 800 jumps to Segoe UI Black. Section headings come in five sizes between 17px and 21px, and there are nine different uppercase label styles.
- **Why it matters:** A type system is a short scale of sizes, using only the weights the rendering font actually has. Near-duplicates read as mistakes.
- **Proposed fix:** Add type tokens to ds.css, for example --ts-fs-1 11px, -2 12.5px, -3 14px, -4 16px, -5 20px, -6 28px, plus a display clamp. Allow only weights 400, 600 and 700. Replace the half-pixel values in app.css and the 16 modules. Add one .ts-overline class (11px/700, 0.08em) and use it for all nine label styles. Set h2 to 20px and h3 to 16px everywhere, phones included. If 550, 650 or 750 are wanted, self-host Inter Variable as a woff2 in the repo and declare it with @font-face; do not load it from Google Fonts, because of the privacy rule.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css`, `misc/_kit/kit.css`, `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/wrapped.js`, `misc/101-true-shuffle/quiz.js`, `misc/101-true-shuffle/duel.js` · **Effort:** M
- **Evidence:**
  - The census found 23 distinct text sizes across 35 routes at 1280, not counting art letters: 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 19, 20, 21, 22, 27.5, 28, 30, 32, 46.8 and 51.8px. Home alone shows 14 at once, 10 of them between 10.5 and 15px. The stylesheets declare 37 font-size values and 16 line-heights, from 1 to 1.6 (data/static-css.json, data/agg-type-dark-1280.txt).
  - Fonts: kit.css:17 says 'No fonts are loaded here' and kit.css:37 starts the stack with Inter. CDP CSS.getPlatformFontsForNode reports 500, 550 and 600 as Segoe UI Semibold; 650, 700 and 750 as Segoe UI Bold; 800 as Segoe UI Black. Visible proof: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/font-weights.png; data in data/fonts.json. Consequences: .ts-chip (600, Semibold) next to .ts-btn--chip (650, Bold) differ by a whole face; buttons (650) look the same as headings (700); tile titles, stat numbers and art letters (800) render in Black.
  - Heading near-duplicates (shots/specimen-dark.png, last group). h2 comes in 17px (.ts-rs-more), 18px (.ts-panel h2, .ts-rs-h2, .ts-sticky b), 19px (.ts-mixer, .ts-modal-head), 20px (.ts-duel-q, .ts-quiz-q, .ts-quiz-empty) and 21px (.ts-sec-head, .ts-lane-title). On phones, lane titles are 19px but other section titles stay 21px. h3 comes in 14, 15, 15.5 and 16px. Page titles: 26px (plain) and 26.85px (hero) on phones.
  - Nine uppercase overline styles: .ts-kicker, .ts-nav-sep, .ts-side-h, .ts-menu-h, .ts-gfam-h, .ts-pal-kind, .ts-like-h, .ts-fy-dial-h and .ts-wr-moment-k. They use 11px or 12px, weight 650 or 700, and letter-spacing of 0.88, 0.77, 0.66, 0.55 or 0.48px (app.css:107, 118, 213, 451, 472, 878, 978; foryou.js:1274; wrapped.js:409).

### visual-system-4 · medium · The player bar and top bar sit outside the button component: icon buttons come in 6 sizes and pills in 9 versions

- **Where:** components: buttons and chips
- **Observed:** The controls people use most (the player bar, back and forward, the sheet's transport) are still the old .ts-icon-btn markup in index.html. ui.js adds .ts-icon-btn to every ts-btn icon button, so each context sets its own size. Icon buttons end up at 28, 32, 34, 36, 40 and 42px; four of those sizes sit together in the now-playing panel. Two chip components that look almost the same are used side by side. The .ts-vbtn controls (S/M/L, theater, full screen), shown on every page, break the stated rule that buttons are pills and icon buttons are round.
- **Why it matters:** Use one button component with a small size scale. The most-used controls, the player bar, should be its reference implementation.
- **Proposed fix:** Rewrite the chrome buttons in index.html as ts-btn markup: 'ts-btn ts-btn--icon ts-btn--md is-icon', with ts-btn--lg for the transport; keep .ts-play for the 56px play button. Remove 'ts-icon-btn' from ui.js:243 and the .ts-icon-btn size rules from app.css, keeping the ds.css hit-area rules. Size icon buttons only with --ts-h-sm, -md and -lg (32, 40 and 48px). Merge .ts-chip into .ts-btn--chip with one 30px height and weight 600, plus an is-hued modifier. Render .ts-vbtn as ts-btn--chip sm.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - index.html:23-24, 66, 71, 81, 108-112 and 122-128: 14 chrome buttons are bare .ts-icon-btn (app.css:128), not the ts-btn component. They are back, forward, sheet close, sheet previous and next, queue More, previous, next, shuffle again, repeat, like, mute, the bar's More, and queue. ui.js:243 (iconBtn) adds 'ts-icon-btn' to about 30 more buttons, and app.js:4728 builds row hearts by hand.
  - Measured icon-button sizes (data/chrome.json and the census): 28px (.ts-vbtn), 32px (.ts-qmode), 34px (.ts-now-actions; the kit's theme and help buttons), 36px (.ts-icon-btn), 40px (.ts-btn md) and 42px (.ts-transport). The 28, 32, 34 and 36px sizes all appear inside the now-playing panel.
  - How much of the page uses the component: on Home at 1280, 9 of the 63 visible button-like controls are .ts-btn. Eleven other systems share the screen: ts-icon-btn 11, ts-chip 14, ts-sec-more 8, ts-vbtn 5, ts-star 5, ts-tab 4, ts-modepill 3, plus ts-focus, kit-theme, kit-help and ts-play. On For you it is 18 of 98.
  - Pills (C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/specimen-dark.png, first row; data/specimen.json): .ts-pick 21px, .ts-fy-theme 22px, .ts-chip.is-small 23px, .ts-fy-src 25px, .ts-chip 29px (12.5px/600), .ts-btn--chip 30px (12.5px/650), .ts-seg-b 32px (13px/600) and .ts-modepill.is-small 32px (700). .ts-chip (37 call sites in app.js) and .ts-btn--chip (12 sites in modules) appear on the same pages, for example Explore's jump chips next to the now-playing label chips.
  - The ds.css header (lines 6-8) says every button is a pill and every icon button round. .ts-vbtn (app.css:834) renders as 28–30px squares with 8px corners, and .ts-tab, .ts-link-btn and .ts-toast-btn have 6px corners.

### visual-system-5 · medium · Seven page-header patterns: sibling pages get different title treatments, Map has no title, Explore labels itself twice

- **Where:** page structure
- **Observed:** Pages in the same sidebar group use different headers. Songs and Channels open with a 46.8px gradient hero and a kicker; Artists and Genres, in the same group, open with a plain 30px title. Liked songs gets a hero, Playlists a plain title. Guess the anime has a 46.8px hero, Rank your songs a 27.5px compact one. Lyrics uses a back link with small art. Map has no heading at all. Explore stacks a breadcrumb, a kicker and the title, all saying Explore.
- **Why it matters:** Pages of the same kind share one header: one template for sections, one for entities.
- **Proposed fix:** Use two templates in app.js. Add sectionHeader(view, { title, lede, actions }) for every sidebar destination: h1 at 30px (26px on phones), an optional one-line lede, and one actions row. Keep headerBlock(), the hero, only for entities with art: artist, work, track, genre, family, mood, channel, playlists including Liked, and Explore. Move Songs, Channels, For you, Paste, Your year, Guess the anime and Rank your songs to sectionHeader. Give Map an h1 (visible, or .kit-sr). On Explore, leave out the kicker when the trail is shown.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/quiz.js`, `misc/101-true-shuffle/duel.js`, `misc/101-true-shuffle/lyrics.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/channel.js`, `misc/101-true-shuffle/share.js`, `misc/101-true-shuffle/wrapped.js` · **Effort:** M
- **Evidence:**
  - Page heads at 1280 (data/agg-heads-dark-1280.txt): 15 routes open with a plain h1.ts-h1 at 30px. Home uses h1.ts-greet at 32px. 11 routes use a hero with art and a 46.8px title (artist, family, genre, mood, work, track, explore, channel, liked, your year, quiz). 4 use a hero without art at 46.8px (songs, for-you, channels, paste). Rank your songs uses a compact 27.5px hero; Lyrics a back link, 72px art and a 30px h1; Map has no h1.
  - Rank your songs and Guess the anime both try to shrink the hero to clamp(24px, 4.4cqi, 40px) (duel.js:272-273, quiz.js:893-894). The demo's quiz still renders at 46.8px because its empty state is not .ts-quiz-head.
  - Explore shows the trail 'Explore > Electric Current', then the kicker 'EXPLORE', then the title (shots/dark-1280/14-explore.png, explore.js:538).
  - Phones: 26px plain, 26.85px hero and 24px for Rank your songs (sheets/grid-dark-390m.png).
  - Screenshots in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/: sheets/pair-dark-1280-light-1280-01.png (Songs hero against Artists plain), shots/dark-1280/30-map.png, 31-lyrics.png and 25-duel.png.

### visual-system-6 · medium · The same song row is built 8+ ways, with different heights, art sizes, corner radii and type

- **Where:** lists and rows
- **Observed:** A song (art, title, artist) looks different on almost every page. Rows are 52 to 79px tall; art is 36 to 48px with 5 or 6px corners; titles are 13.5 to 15px at weight 600, 650 or 700, some in the heading colour and some in the body colour; artist lines are 12 to 13px. The play control is also different on each page: the index turns into play on hover in Songs, a blue triangle in lanes, a white triangle in the Works table, nothing in the queue.
- **Why it matters:** One row component per kind of item. Density variants change the size, not the anatomy.
- **Proposed fix:** Define one .ts-song-row in ds.css: 56px tall, 44px art with 6px corners, title 14px/600 in --heading, artist line 12.5px/400 in --text-2, 10px row radius, and one trailing play/more slot. Add a compact variant (48px row, 40px art). Use it for the queue, lanes (media.js), rescue, duel, Your year, share, Discover and palette rows. The Songs table can keep its columns but should use the same art and text styles.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/rescue.js`, `misc/101-true-shuffle/duel.js`, `misc/101-true-shuffle/wrapped.js`, `misc/101-true-shuffle/share.js`, `misc/101-true-shuffle/channel.js` · **Effort:** L
- **Evidence:**
  - Measured with scripts/rows.mjs at 1280 dark (data/rows-dark-1280.json). Songs and Search .ts-row: 60px, art 44 r5, title 14.5px/600, sub 13px. Lane .ts-m-row: 56px (61 with a reason line), art 44 r6, 14px/600, 12.5px. Queue .ts-q: 52px, art 40 r5, 13.5px/600, 12px. Channel .ts-ch-row: 54px, art 64x36 r5. Rescue .ts-rs-row: 79px, art 48 r6, title 15px/650 in --text, not --heading. Palette .ts-pal-item: 55px, art 36 r6, 14px/700. Works table: 53px, art 40 r6, 13.5px/650. Row corner radius is 0, 6, 8 or 10px.
  - From the CSS only, since the demo cannot show these: duel ranking (duel.js:315-320; 44 r6, 650), Your year top list (wrapped.js:378-384; 48 r6, 650, rank 17px/800), share and paste (share.js:137-139; 44 r5), Discover .ts-drow (app.css:767-770; 44 r5).
  - Side by side: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/sheets/grid-rows-dark-1280.png; crops in shots/rows-dark-1280/.
  - Sources: app.css:379-406 (.ts-row), media.js:355-367 (.ts-m-row), app.css:246-259 (.ts-q), channel.js:263, rescue.js:403-406 and app.css:871-877 (palette).

### visual-system-7 · medium · Space between sections jumps from 28px to 54px wherever a lanes.js section follows another section

- **Where:** spacing and rhythm
- **Observed:** The gap above a section heading depends on which module drew the section, not on the content. On the artist page the gaps run 28, 28, 28, 54, 28px. On For you and Explore every gap is 54px. Genres uses 34, Settings 33, and Home 21 to 29.
- **Why it matters:** Use one vertical rhythm: the same gap between sections whichever module draws them, taken from the spacing scale.
- **Proposed fix:** Add --ts-section-gap (for example 40px, or --ts-s6 at 32px) to ds.css and use it as the only top margin on .ts-sec-head, .ts-lane-head and .ts-panel. Set margin-bottom to 0 on .ts-x-lane, .ts-fy-lane, .ts-lane and .ts-hb, or use 'section + section { margin-top: var(--ts-section-gap) }'. Then switch module gaps and paddings to --ts-s* values.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/habits.js` · **Effort:** S
- **Evidence:**
  - Gap above each h2, measured from the bottom of the nearest block above, on 22 routes (scripts/rhythm.mjs, data/rhythm.json): 9, 18, 20, 21, 27, 28 (30 times), 29, 31, 33 (8 times), 34 (9 times), 42, 46, 53 and 54px (15 times).
  - #/artist/paperlanterns: Songs 28, Sounds like 28, More by Paper Lanterns 28, Artists like Paper Lanterns 54, From their YouTube channel 28. #/for-you: 46, then 54 eight times. #/track: 28, 54, 54.
  - Cause: the lane wrappers have a 26px bottom margin (explore.js:500 .ts-x-lane, foryou.js:1266 .ts-fy-lane), stacked on .ts-sec-head's 28px top margin (app.css:287).
  - The ds.css spacing tokens --ts-s1 to --ts-s7 (ds.css:26) are used 0 times. Rendered paddings use 22 values, 13 of them off a 4px step (1, 2, 3, 5, 6, 7, 9, 10, 11, 14, 18, 22, 42). Rendered gaps use 16 values, 9 of them off a 4px step. The CSS declares 40 gap values.

### visual-system-8 · medium · A catch-all rule '.ts a { color: inherit }' overrides the link colours: 'Show all' and back links render as loud as the headings

- **Where:** colour and cascade
- **Observed:** app.css gives every link in the page its parent's colour, using a selector that out-ranks every single-class link rule. The section-head links meant to be muted (Playlists, Browse, All genres, Show all), the lyrics back link and the now-playing channel link all render in full text colour at weight 650, competing with the h2 beside them.
- **Why it matters:** Base element rules should have the lowest specificity, so component rules win without patches.
- **Proposed fix:** Change app.css:44 to ':where(.ts) a { color: inherit; }' (specificity 0,0,1). Then delete the patches at ds.css:218, quiz.js:892 and duel.js:276, and check that .ts-sec-more, .ts-lane-all, .ts-back, .ts-now-ch and .ts-fy-theme come out muted.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/quiz.js`, `misc/101-true-shuffle/duel.js` · **Effort:** S
- **Evidence:**
  - Measured with scripts/link-colors.mjs (data/link-colors.json). .ts-sec-more should be --text-2, rgb(154,163,175), but renders rgb(213,218,226) in dark; in light it should be rgb(95,104,115) but renders rgb(27,31,36). .ts-back ('← Song details') and .ts-now-ch ('From pixel archive') lose their colour the same way.
  - The same specificity arithmetic overrides .ts-lane-all (lanes.js:187) and .ts-fy-theme (foryou.js:1304): app.css:44 '.ts a' (0,1,1) beats a single class (0,1,0).
  - Three patches already work around this trap: ds.css:218 and quiz.js:892 restore the ink on link-type primary buttons, and duel.js:276 fixes hovered chip-tabs.
  - Visible on Home ('Playlists' and 'Browse' next to the h2s): C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/dark-1280/01-home.png. Also in the specimen sheet, 'Text actions' row: shots/specimen-dark.png.

### visual-system-9 · medium · Cover art always loads the 320x180 thumbnail: large art is blurry on 2x screens, square crops lose 44% of the frame, and the poster caption sits on the thumbnail's own text

- **Where:** imagery
- **Observed:** Every cover, from a 40px queue thumbnail to the 192px hero and the poster, uses YouTube's mqdefault.jpg (320x180) cropped with object-fit: cover. Small art looks fine. The hero, artist cards and poster are upscaled about 2x on a 2x display (the Android phone, any HiDPI laptop). Square crops cut the left and right 22% of every frame. The 'Press play' caption is white text with only a shadow, placed exactly where music thumbnails put their own white title.
- **Why it matters:** Serve images at the rendered density, crop on purpose, and put a scrim behind text placed over pictures.
- **Proposed fix:** Give U.art a size hint (ui.js:434). Keep mqdefault for art up to 80px. For larger art, use sddefault.jpg (640x480) or hqdefault.jpg (480x360) and hide their letterbox bars with transform: scale(1.334) on the img inside the overflow-hidden .ts-art. Or use maxresdefault.jpg, falling back when naturalWidth is 120 (YouTube's grey placeholder). Add a scrim to the poster: '.ts-poster::after { background: linear-gradient(transparent 55%, rgba(0,0,0,.65)) }', layered under .ts-poster-text. The thumbnails stay on i.ytimg.com, so this adds no new host and touches no YouTube terms.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - Test (scripts/thumbs.mjs): real mode with 60 tracks that have YouTube-shaped ids. Every i.ytimg.com request was answered locally through CDP Fetch with a 320x180 test card, at DPR 2. Google and music hosts were blocked and the database was deleted afterwards (data/thumbs.json).
  - ui.js:437 always requests '/mqdefault.jpg'. Source pixels per device pixel at DPR 2: hero art 192px 0.47, artist cards 180px 0.50, home artist shelf 148px 0.61, now-playing poster 316x210 0.43. Fine at small sizes: rows 44px 2.05, queue 40px 2.25, bar 64px 1.41.
  - object-fit: cover into squares (app.css:147) drops 43.75% of the frame's width. The test card's 'LEFT EDGE' and 'RIGHT EDGE' labels are cut off on the hero, the rows and the round artist art: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/thumbs/track.png and shots/thumbs/artists.png.
  - The poster has min-height 210px (app.css:194). In panels narrower than 373px that is taller than 16:9, so the sides are cropped too. Its caption (app.css:202: 13px white, text-shadow only) overlaps the thumbnail's burned-in bottom title (top right of shots/thumbs/track.png).

### visual-system-10 · medium · 'Selected' is drawn 8 different ways, and the order pill (a menu button) looks selected

- **Where:** states and colour roles
- **Observed:** Choosing one of several things is styled in many ways: an inverted pill, a hue fill, an outline ring, an accent underline, an accent outline with a blue tint, a blue row tint, accent-coloured text, or an inset ring. Switching between views of a page uses four different components. The order pill in the player bar is a menu button, but it wears the accent outline and tint that mean 'chosen' on Mix builder's mode cards and on Focus. In the bar it is the loudest control after Play.
- **Why it matters:** Use one visual language per state. A menu button must not look like a selected option.
- **Proposed fix:** Add tokens --ts-on-bg and --ts-on-ink (the inverted pill) and use them for every single choice. Build one .ts-segmented component (in ds.css) to replace the chip-tabs and .ts-seg-b, keeping underline tabs only for panel tabs. Keep the accent outline for focus rings, and keep the jump bar's ring as a location marker. Restyle .ts-modepill as a secondary pill (--border-strong border, no tint) with only its icon in accent. Mode cards and quiz levels then use the same inverted or ringed 'on' style.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/duel.js`, `misc/101-true-shuffle/quiz.js`, `misc/101-true-shuffle/foryou.js` · **Effort:** M
- **Evidence:**
  - The 8 treatments: (1) inverted pill: .ts-chip.is-on (app.css:276), .ts-btn--chip[aria-pressed] (ds.css:109), .ts-seg-b (app.css:467), .ts-vbtn.is-on (app.css:837). (2) hue fill: .ts-seg-b.is-hued (app.css:468). (3) outline ring: .ts-set-jump [aria-current] (ds.css:181). (4) accent underline: .ts-tab (app.css:240). (5) accent outline with accent-soft fill: .ts-modecard.is-on (app.css:487), .ts-focus.is-on (app.css:691), .ts-quiz-level.is-on, .ts-rs-cand.is-sel. (6) --ts-sel tint: nav, rows, palette, stations. (7) accent text only: ghost and icon buttons when pressed (ds.css:112), menu .is-checked (app.css:447). (8) inset accent ring: .ts-card.is-focused (app.css:702).
  - Switching between views uses four components: underline tabs (the queue panel), chips with role tab (Rank your songs' 'Duel / Your ranking' and Needs attention's tabs, both .ts-chip), segmented .ts-seg-b (Works Grid/List, For you None/Some/Lots, Settings density), and pressed chips (Explore Top songs / Albums & EPs / Singles, .ts-btn--chip).
  - The order pill .ts-modepill (app.css:813-819) has a 1px accent border, accent-soft fill and an accent icon, at 38px. Its neighbours in the player bar are plain 42px icons and the 56px play button (data/chrome.json).
  - All treatments side by side: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/specimen-dark.png and specimen-light.png, 'Selected / on' row.

### visual-system-11 · medium · The design tokens go unused: 165 hard-coded radii, 32 box-shadows, and 44% of the CSS injected by modules that rebuild shared parts

- **Where:** tokens and CSS architecture
- **Observed:** ds.css defines radius, spacing and elevation tokens, but almost nothing uses them. Instead the CSS hard-codes 18 radius values and 32 shadows. Nearly half the page's CSS is injected as strings by 16 page modules, each of which re-creates cards, stat tiles, charts, progress bars, skeletons and option cards with its own numbers. This is the root cause behind most of the other inconsistencies in this list.
- **Why it matters:** Tokens only help if components use them. Shared components belong in the design-system file, not in each page module.
- **Proposed fix:** Move card, panel, note, stat tile, chart card, progress bar, skeleton, compact header and overline into ds.css, built on --ts-r-*, --ts-s-* and --ts-e-*. Reduce boxes to three radii: 6px for small items, 10px for controls and cards, 14px for panels and dialogs. Delete the duplicate --ts-play block in app.css. Add a check to test.js that fails on a hard-coded px border-radius or box-shadow outside ds.css.
- **Files:** `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/habits.js`, `misc/101-true-shuffle/wrapped.js`, `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/lyrics.js`, `misc/101-true-shuffle/channel.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/quiz.js`, `misc/101-true-shuffle/duel.js`, `misc/101-true-shuffle/test.js` · **Effort:** L
- **Evidence:**
  - Token use (data/static-css.json): --ts-r-xs, -sm, -md and -lg: 0 uses. --ts-s1 to --ts-s7: 0 uses. --ts-e1: 0, --ts-e3: 0, --ts-e2: 2. The CSS instead contains 165 hard-coded px radii in 18 values and 32 distinct box-shadow values. For example, menus use 0 16px 48px at 0.30 opacity right beside --ts-e2's 0 16px 48px at 0.28, and the modal writes out --ts-e3 by hand. The rendered UI uses 10 icon sizes between 12 and 28px.
  - --ts-play and --ts-play-ink are defined twice: app.css:17-18 and 28-29, and ds.css:34-35 and 50-51.
  - 69 KB of the page's 158 KB of CSS (44%) is injected as strings by 16 modules, and they duplicate parts. Chart card: habits.js .ts-hb-card is the same as wrapped.js .ts-wr-chart. Stat tile: .ts-stat (10px radius, 28px/800 number) against .ts-wr-tile (12px radius, 30px/800). Three column charts at 118, 120 and 128px tall. Five progress bars. Three skeletons: lanes.js and lyrics.js define identical keyframes under two names, and channel.js has none. The compact hero is written twice (duel.js:272, quiz.js:893). Option cards: .ts-modecard (10px radius) against .ts-quiz-level (14px).
  - Boxes measured on screen (data/agg-shapes-dark-1280.txt): bordered or filled containers use corner radii of 8px (.ts-guessbox), 10px (.ts-stat, .ts-needs, .ts-rs-note), 12px (.ts-panel, .ts-lane-msg, .ts-ch-teach, .ts-hb-card), 14px (.ts-mixer, .ts-labelcard, .ts-quiz-*) and 16px (.ts-fy-hero, .ts-duel-pick). They use either --surface or --surface-2 as fill, and either --border or --border-strong. Overview: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/specimen-dark.png.

### visual-system-12 · low · Content widths and edges vary by page: 12 max-widths, lanes stopping at 980–1000px under full-width heroes at 1920, art offset 0–12px from headings

- **Where:** layout grid
- **Observed:** On wide windows each module caps its content at its own width, so the right edge moves from page to page and even within one page: a hero spans the whole view while the lanes under it stop 264–284px short. On the left, headings align with the content edge but the first piece of art sits 0, 8, 10 or 12px in, depending on which component drew it. At 1280 the view is only 624px wide, so these caps never apply there.
- **Why it matters:** Use one content measure and shared edges, so the blocks on a page line up on both sides.
- **Proposed fix:** Add --ts-measure (for example 1120px) on .ts-view and let heroes, lanes, lists and panels fill it. Delete the per-module caps of 860, 900, 980 and 1000px, and limit only paragraphs to a reading width (70ch). Apply the lanes' -10px compensation to .ts-grid.is-cards and .ts-shelf, or remove the card padding and inset the hover background instead, so art lines up with headings.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/duel.js`, `misc/101-true-shuffle/wrapped.js`, `misc/101-true-shuffle/rescue.js`, `misc/101-true-shuffle/share.js`, `misc/101-true-shuffle/channel.js`, `misc/101-true-shuffle/lyrics.js` · **Effort:** S
- **Evidence:**
  - Content max-widths of 620, 640, 680, 760, 780, 820, 860, 880, 900, 980, 1000 and 1400px, in 40 declarations across 11 files (app.css:103, 517, 713, 720, 766; lanes.js:191-199; explore.js:500; foryou.js:1266; duel.js:281-314; wrapped.js:377-427; rescue.js:402-427; share.js:136-143; channel.js:253-279; quiz.js:958; lyrics.js:557-576).
  - At 1920x1080 the view's content box is 1264px wide. Track lists, card grids, Home shelves and every hero use all of it. Explore lanes stop at 980px and For you lanes at 1000px; the 'This season's anime' shelf is clipped at 1000px with empty space beside it. Settings panels stop at 860px, Rank your songs at 860px, Your year's top list at 820px, Rescue at 900px. Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/dark-1920/14-explore.png and 15-foryou.png; overview in sheets/grid-dark-1920.png.
  - Left edges (data/align.json, the same at 1280 and 1920): headings sit at 0. The first card art sits at +10px on Home, Artists, Works, Channels and Liked; +12px on the artist page; +8px on For you cards and in every lane row; 0 on Explore cards, which use .ts-lane-cards { margin: 0 -10px } (lanes.js:208).

### visual-system-13 · low · Colour roles blur: one blue does about 15 jobs, 'liked' appears in two pinks on one screen, and the star gold is hard-coded and faint in light

- **Where:** colour roles
- **Observed:** Accent and play-blue are the same colour, and that blue marks focus, selection, pressed toggles, links, the now-playing title, progress, drop targets, spinners and tags, as well as play. Blue primary buttons also front actions that are not play. A few colours bypass the tokens altogether: the heart on a song row is a different pink from the bar's heart, and the rating stars use one gold in both themes, which is faint on the light panel.
- **Why it matters:** Colours are semantic tokens: one hue per meaning, and every role defined for both themes.
- **Proposed fix:** Change app.css:850 to color: var(--ts-like). Add --ts-star: an amber such as #b7791f in light (3.4:1 on #f7f8fa) and #f2b01e in dark, and use it at app.css:230-231. Replace --ts-bar-fill with --ts-chart: var(--ts-play). Give the toast's action a token. Reserve --ts-play for play and primary actions; show selection with the neutral inverted style (see the 'selected' finding), so blue means play.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - --accent and --ts-play have the same value (#1f5fd6 in light, #7cb3ff in dark; kit.css:32 and 63, ds.css:34 and 50), and --ts-new equals both in dark. var(--accent) is used 62 times and var(--ts-play) 30 times. Blue primary buttons also front non-play actions: 'New smart playlist', 'Apply a labels file', 'Quick labeller' and 'Read the list'. The README says 'one blue for every play'. Charts use a near-duplicate blue: --ts-bar-fill #3b6fd4 / #6aa2f2 (app.css:19 and 30).
  - Hearts (scripts/verify2.mjs): a song row's liked heart is #e8487a (app.css:850; the button is built by hand at app.js:4728), while the bar's heart uses --ts-like. Measured rgb(232,72,122) against rgb(255,122,168) in dark, and rgb(232,72,122) against rgb(214,51,108) in light.
  - Stars are #f2b01e in both themes (app.css:230-231). In light that is about 1.8:1 against the panel, and only 1.3:1 between a filled and an empty star; in dark about 9:1. Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/light-1280/13-track.png.
  - Links come in three styles: underlined in the text colour ('Leave the demo', the channel link on the track page), accent with no underline (.ts-link-btn 'and 18 more', .ts-job-x), and inherited with an underline on hover (artist names). The toast's action button uses a pair of hex values swapped per theme (app.css:888-889).

### visual-system-14 · low · Two dialog designs: the header's '?' opens the kit dialog, every other dialog is the app's modal

- **Where:** overlays
- **Observed:** The help dialog behind the header's '?' button looks different from the app's own dialogs, including the Keyboard shortcuts dialog that the '?' key opens. It has a different corner radius, surface, border, shadow, title style and close control. It also repeats the key list as a paragraph that the app's dialog shows as a table.
- **Why it matters:** Overlays that do the same job should look the same.
- **Proposed fix:** In app.css, restyle '.ts .kit-dialog' with the .ts-modal values: radius 14px, --bg, --border, the --ts-e3 shadow, a 19px/700 title with no rule, and a × close button. Or make the header's '?' open the app's help and keys dialog and keep the kit dialog for other toys.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/_kit/kit.css` · **Effort:** S
- **Evidence:**
  - Measured in data/overlays.json. Kit dialog (kit.css:444-479): 12px radius, --surface fill, --border-strong border, shadow 0 30px 80px at 0.45, a 17px/650 title above a rule, and a 'Close Esc' text pill. App modal (app.css:453-456), used by the Edit details, palette and Keyboard shortcuts dialogs: 14px radius, --bg fill, --border border, shadow 0 24px 80px at 0.40, a 19px/700 title, and a × icon button.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/overlays/dark-kithelp.png against dark-keys.png and light-dialog.png.

### visual-system-15 · low · Control heights and shapes are mixed: the top bar uses 34, 36 and 42px controls, and form fields are 34px rectangles under 40–48px pills

- **Where:** controls
- **Observed:** The 56px top bar holds controls of three heights and three styles: borderless back and forward arrows, filled pills for Focus and search, and outlined circles for theme and help. On list pages, the filter fields and selects are 34px rectangles with 8px corners, directly under 48px and 40px pill buttons. The top search box is the only field drawn as a pill.
- **Why it matters:** Controls that sit together share one height and shape language.
- **Proposed fix:** Inside .ts, set .kit-input and select to --ts-h-md (40px) height with a 10px radius, or pills to match the buttons. Make every top-bar control 40px: filled pills for Focus and search, borderless 40px icon buttons for back, forward, theme and help (or all outlined, but one style).
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/ds.css` · **Effort:** S
- **Evidence:**
  - Top bar (data/chrome.json): back and forward 36px borderless; Focus 42px, filled with a border; search 42px filled pill; theme and help 34px outlined circles (kit.css:212-229). Close-up: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/visual-system/shots/chrome-top-dark.png.
  - Filter bar on Songs: the 'Filter these songs' field and the 'Music' and 'Recently added' selects are 34px .kit-input with 8px corners (kit.css:346-357), directly under Play (48px) and Shuffle (40px) pills (shots/chrome-filter-dark.png). Artists, Works and the channel page filter the same way. --ts-h-md (40px) is not applied to fields.

## Lens: microcopy

<details><summary>What this auditor covered</summary>

- Demo, desktop 1366x900 dark: 33 routes collected for visible text, controls (text, aria-label, title), inputs, empty states and cut-off text: #/, #/search?q=love, #/search?q=zzzzqqq (no match), songs, artists, artist/paperlanterns, genres, genre/Alt J-rock, browse, works, work/Kumori Station Anime, map, for-you, explore/demo-002, track/demo-002, lists, liked, mix, history, wrapped, quiz, duel, stats, label, fix, settings, library, channels, people, rescue, paste, lyrics, car. Output: .../microcopy/d/*.json and *.png
- Demo, phone 390x844 (mobile emulation): the same 33 routes, plus the now-playing sheet and the mini player bar (.../microcopy/p/)
- Every menu and dialog I could reach in the demo: the bar's More, the Shuffle order menu, the Shuffle split caret, the queue's More, the Focus menu, the row menu, the multi-select menu, the now-panel's More, Rating, Add to playlist, Sleep timer, Playback speed, Trim and volume, Journey, Edit details, Save as playlist, Help (?), Keyboard shortcuts, the Ctrl+K palette (empty, with a query, no match), Continue on your phone, and Rescue's page for one song (.../microcopy/m/)
- Toasts: recorded live by wrapping U.toast (like/unlike, repeat, mute, shuffle again, block, clear queue, Endless on/off, Save for later, skip errors through mockErrors). Also extracted from source: 206 say/toast/job/status calls, 124 of them user messages (toasts-full.txt, toastwords.cjs)
- Real mode, first run, with Google's API and sign-in hosts blocked: 23 routes, which outside hosts each route contacts (hosts.mjs), and the For you lanes once settled (.../microcopy/r/)
- Real mode with a synthetic library of 160 songs, 180 listens and 3 dead uploads, in America/Chicago time: the stale-data banner, History's day groups, Needs attention, Rescue, Your numbers, Settings and the YouTube units line in the bar's More. The database was deleted afterwards (.../microcopy/rl/)
- Long and Japanese titles: a 35-character Japanese title injected into the demo and checked at 1366, 1100 and 390 px in song rows, home cards, the player bar, the phone sheet and car mode (.../microcopy/l/). I also estimated title widths across the 1,855 songs in the owner's labels.json
- Source sweeps of the user-facing strings in app.js, index.html and the page modules: terms (song/track/video, playlist/list/station, units/quota/allowance, found/new songs, focus, work/series, endless, British vs American spelling), singular/plural agreement, date and time formatting, ellipses, verb-first labels
- Specific checks (.../microcopy/v/): Endless off vs the queue header's “endless”, the r key vs the Repeat tooltip, the I key and the Title field, live regions, toast hover, the phone search placeholder's width, “1 track have”, and the empty now panel overlapping the size bar
- Not covered: real YouTube playback, signed-in flows (import progress, Add to YouTube playlist), real LRCLIB lyrics, quiz rounds with real previews, the mini player window (Document PiP), car voice commands. No repository files were changed and config.js was never read

</details>

### microcopy-1 · high · Repeat's tooltip names the radio key, and the shortcut hints have drifted from actions.js

- **Where:** Player bar tooltips, now-panel icon buttons, palette (desktop)
- **Observed:** The Repeat button's tooltip says “Repeat the queue (r)”. Pressing r does not repeat. It starts a radio from the playing song and replaces what was coming, with no toast and no Undo; Shift+R is what repeats. The other bar tooltips are written by hand in index.html with lowercase keys: “Previous (p)”, “Next (n)”, “Play or pause (space)”, “Like (l)”, “Mute (m)”, “Queue (q)”, and in app.js “Theater mode: a big video (t)”. The shortcuts dialog, the menus and the palette show uppercase keys (N, Shift+R, [T]). The bar More's tooltip and aria-label list 5 items (“sleep timer, theater, full screen, edit, repeat”), but the menu has 15, including Endless, Car mode, Mini player, Playback speed and the YouTube units line. The now panel's icon buttons use their own words (“Radio from this song”, “A journey from this song to another”, “Explore it (E)”) instead of the vocabulary's “Start radio”, “Journey from here…” and “Explore”. The palette shows “Leave focus — not focused” when nothing is focused, and gives no key for “Start radio from the playing song”, although R does that.
- **Why it matters:** Labels and hints must tell the truth, and come from one source. actions.js promises that “a button, a menu item, the shortcuts list and the help all say the same words”.
- **Proposed fix:** Change index.html:112 to “Repeat the queue (Shift+R)” now. Then stop writing these by hand: in app.js wireShell, set each bar title from actions.js as A.label(k) + ' (' + A.VOCAB[k].key + ')'. That gives “Previous song (P)”, “Next song (N)”, “Play or pause (Space)”, “Shuffle again (S)”, “Repeat (Shift+R)”, “Like (L)”, “Mute (M)”, “Show or hide the queue (Q)”, “Shuffle order (O)”, “Theater mode (T)” and “Full screen (F)”. Bar More: aria-label “More player controls”, title “More: sleep timer, speed, Endless, car mode, mini player…”. Now-panel icons: use A.label('radio'|'journey'|'explore'). Palette (app.js ACTIONS ~4796): build the entries from A.VOCAB (label + key), list “Stop focusing” only while focused, and show R for radio. Add a test.js check that compares every “(x)” hint in index.html and app.js with A.KEYMAP.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/test.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/v/verify.json rKey: before pressing r the queue said “Playing from Everything · true shuffle”, repeat=false. After r it said “Playing from Radio: Painted Rooftops · some new songs”, repeat=false, and no new toast appeared
  - index.html:112 title="Repeat the queue (r)"; actions.js:69 repeat key 'Shift+R'; actions.js:36 radio key 'R'; app.js:5708-5709 (Shift+R repeats, r starts a radio); app.js:620-629 startRadio gives no feedback
  - index.html:107-128: nine tooltips with lowercase keys; app.js:4642 and 4644 “(t)” and “(f)”
  - index.html:127 More tooltip vs .../microcopy/m/menus.json bar-more (15 items); screenshot .../microcopy/m/bar-more.png
  - app.js:4807 (palette radio, key ''), app.js:4809 (“Leave focus”, 'not focused'); screenshot .../microcopy/m/palette-empty.png

### microcopy-2 · high · The I shortcut types an “i” into the song's Title field (outside this lens: corrupts titles)

- **Where:** Edit details dialog opened with the keyboard
- **Observed:** With a song playing, pressing I opens Edit details with the focus in Title, and the same keystroke lands in the field. “Blue Letters” became “Blue Lettersi”, and “Painted Rooftops” became “Painted Rooftopsi”. If the user then changes a mood and presses Save or Enter, the wrong title goes into the library, the labels export and the Desk sync. The “/” key already avoids this with preventDefault; I does not. I found this while checking titles. It is an input bug, but it damages the very content this lens covers.
- **Why it matters:** A shortcut must never change content the user did not type.
- **Proposed fix:** In app.js wireKeys (line 5719), call e.preventDefault() before openEditor for i/I, and do the same in any other key handler that moves the focus into a text field. Add a drive test: play a song, press I, and assert that the Title input equals the song's title.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/v/verify.json iKey: {current: 'Painted Rooftops', field: 'Painted Rooftopsi', focused: true}
  - Screenshots .../microcopy/m/editor.png (Title shows “Blue Lettersi”) and .../microcopy/v/i-key-editor.png
  - app.js:5719 calls openEditor([ctl.current()]) with no e.preventDefault(); app.js:5721 (“/”) does call e.preventDefault()

### microcopy-3 · high · Long and Japanese titles are cut with no way to read them, and the bar's tooltip hides the title

- **Where:** Song rows, cards, genre chips, player bar, car mode (desktop and phone)
- **Observed:** I tested a real-world title, 「君の知らない物語 (TVサイズ) 〜化物語エンディングテーマ〜」 (35 characters). The song row cuts it to “君の知らない物語 (TVサイズ) 〜化…”: the title cell is 192 px wide at a 1366 px window and 225 px at 1100 px, even when the From column next to it is empty, and the row has no title attribute. Home cards cut at 140 px and genre chips at 114 px (“Classical & R…”), also without tooltips. The player bar's title has the tooltip “Song details” (on a phone, “Now playing and the queue”) instead of the name. The full title can be read only in the now-playing panel or sheet for the song that is on, or on the song's own page. In the demo at 1366 px, 13 texts are cut on Songs, 13 on Home, 26 on Needs attention and 10 on a work page, none with a tooltip. In the owner's labels.json (1,855 songs), 963 titles have Japanese characters and I estimate that about 266 (14%) are wider than the 192 px cell. 895 songs have a romaji or English titleAlt that is never offered on hover. Japanese text is rendered under lang="en", with no lang="ja" on titles, although 1,339 songs carry the language label 'ja'. Screen readers therefore read those titles with an English voice, and Android can pick Chinese glyph forms for the kanji.
- **Why it matters:** Text that is cut must be recoverable on hover or focus (WCAG 1.4.13 / 3.1.2: mark the language of parts).
- **Proposed fix:** Set title on .ts-r-tt (app.js:1249) to trackTitle(t) + (t.titleAlt ? ' (' + t.titleAlt + ')' : '') + ' – ' + trackArtist(t). Set title to the full text on .ts-card-title in card() (app.js:1827) and in media.js:626, and in chip() (app.js:948). For the bar title (app.js:798), use title = trackTitle(t) + ' – ' + trackArtist(t), with the action left to the aria-label (“Open song details”). On phones, let .ts-r-tt wrap to two lines (-webkit-line-clamp: 2) instead of one. When a song's language label is 'ja', or its title has kana or kanji, add lang="ja" to the title and artist elements in rows, cards, the bar, the now panel and car mode.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/car.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/l/long.json: ts-r-tt cut at 192/225/206 px with no tooltip; bar title tooltip 'Song details' / 'Now playing and the queue'
  - Screenshots .../microcopy/l/long-laptop-songs.png (row cut, From column empty) and .../microcopy/l/long-phone-sheet.png (full only in the sheet)
  - .../microcopy/d/desktop-summary.json: cut texts and how many have no tooltip, per route
  - app.js:1249 (.ts-r-tt), app.js:1823-1831 card(), app.js:948 chip(), media.js:626 (card title), app.js:798 (bar title tooltip). foryou.js:665 already sets title on its cards: the pattern to copy

### microcopy-4 · medium · Help and Settings still describe retired keys and terms (E edits, “stations”, “the mode button”)

- **Where:** Help dialog (?), Settings > Backup and Data and privacy, the Delete everything confirmation
- **Observed:** The help's Labels paragraph says “Edit one track with e or the pencil”. Since 2026-10-11, E opens Explore and I edits; the same dialog's Keys paragraph, generated from actions.js, says “I edit the playing song”. The help says Mix builder “saves them as stations”, but its button says “Save as playlist”. “What this page stores” lists “queue and stations”. “The mode button left of Play” is now the Shuffle order pill. “Radio on a song plays others that sound like it” leaves out that, by default, about half of a radio is songs you do not own. In Settings, “Restoring replaces … queue and stations”. The delete confirmation, “Delete the library, labels, corrections, ratings, history, queue and stations from this browser?”, never says “playlists”, which is what people most fear losing.
- **Why it matters:** Help must match the product, and a destructive confirmation must name what is lost in the user's words.
- **Proposed fix:** index.html:144 → “Edit a song with I or the pencil; select several in a list to edit them together.” index.html:142 → “The Shuffle order button (O) changes how the next songs are picked: spread artists apart, fresh first, favourites, rediscover, artist rotation, genre blocks, newest first, mood flow. Mix builder combines filters, limits and an order, and saves them as a playlist.” index.html:140 → “Start radio on a song plays songs like it; by default about half are new to you (For you > New songs sets how many).” Replace 'stations' with 'playlists' at index.html:148, app.js:2956 and app.js:2997. app.js:3002 → “Delete your library, playlists, labels, ratings, play history and queue from this browser? Your YouTube account is not changed. Export first if you may want them back.”
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - index.html:144 'Edit one track with <kbd>e</kbd> or the pencil'
  - index.html:142 'The mode button left of Play … saves them as stations.'; index.html:140 'Radio on a song plays others that sound like it'
  - index.html:148 '…history, queue and stations.'; app.js:2956 (Backup); app.js:2997 (privacy); app.js:3002 (delete dialog)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/m/menus.json help.text (732 words); screenshot .../microcopy/m/help.png
  - app.js:625 radio ratio default 0.5 (For you's dial: “About half new songs … Also for Endless and every Start radio”)

### microcopy-5 · medium · “Song”, “track” and “video” name the same thing; a playlist is also a “station” and a “list”

- **Where:** Vocabulary in aria-labels, menus, toasts, Settings and the demo banner
- **Observed:** actions.js moved to “song” (“Next song”, “Previous song”), but the bar's accessible names are still “Previous track”, “Next track” and “Position in the track”, and about 50 plural(…, 'track') calls remain in app.js. One menu mixes both: the shuffle orders say “One track per artist, in turn.” and “A few tracks of one genre…” next to “Each song leads to one…”. Selecting rows gives “Actions for 3 tracks”, “Edit 3 tracks…”, “Rate 3 tracks” and “3 chosen tracks”. Settings shows “160 of 160 tracks carry labels” above “0 songs without labels”. Toasts say “That was the last track” but also “That was the last song of …”, and “Imported “X”: 120 videos”. The demo banner says “every artist, track and playlist”. Playlists are also “stations” (help, Backup, the delete dialog) and “lists” (“Tick at least one list first.”, “the imported lists”). The YouTube import “Liked videos” (101 songs in the demo) sits next to the app's own “Liked songs” (37); liking a song here does not change YouTube's list. Spelling mixes British (Favourites, labeller, Colour, coloured, theatre, synthesiser, Tick) with the American “Theater mode”.
- **Why it matters:** One concept, one word. The listener sees songs, not tracks or videos.
- **Proposed fix:** Use 'song' in every visible and accessible string. index.html: aria “Previous song”, “Next song”, “Position in the song”. shuffle.js:561/687/688 → “One song per artist, in turn.” and “A few songs of one genre, then another genre.” app.js:1365/1388/1397/1462 → “Play these 3”, “Edit 3 songs…”, “Actions for 3 songs”, “Rate 3 songs”. app.js:369 → “That was the last song. Press Shuffle again for more.” app.js:3082 → “Imported “X”: 120 songs, 14 new, 3 no longer on YouTube.” app.js:3066 → “Choose at least one playlist to import.” Replace 'stations' with 'playlists'. Show the imported Liked videos as “Liked on YouTube”, and add to the Liked songs blurb: “Your YouTube likes are under Liked on YouTube.” Pick one spelling; the copy is mostly British, so use “Theatre mode”. Add a test.js check that greps user-facing strings for /\btracks?\b/.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/shuffle.js`, `misc/101-true-shuffle/demo.js`, `misc/101-true-shuffle/test.js` · **Effort:** M
- **Evidence:**
  - index.html:70-71, 108, 110, 117 (aria 'Previous track', 'Next track', 'Position in the track')
  - shuffle.js:561, 687, 688; screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/m/mode-menu.png
  - app.js:1365, 1388, 1397, 1462 (selection menu); .../microcopy/m/menus.json multi-menu 'Actions for 3 tracks'
  - app.js:369, 3066, 3082; demo.js:33; .../microcopy/d/desktop-mix.json 'Liked videos 101' vs nav 'Liked songs' 37
  - Term sweep (terms.cjs): 'song' in 53 plural() calls vs 'track' in about 50; 'station' in index.html:142, 148 and app.js:2956, 2997, 3002

### microcopy-6 · medium · Focus goes by nine names, and its top-bar button just says “Everything”

- **Where:** Focus (working inside one playlist): top bar, menus, focus bar, playlists page, palette, demo
- **Observed:** The feature that narrows the whole app to one playlist goes by nine names: “Focus” and “Leave focus” (page buttons), “Focus on this” and “Stop focusing” (actions.js, unused), “Work inside” (menu heading), “Working in: everything. Change” (aria-label), “Work inside a playlist” (tooltip), “Inside <name> · N songs” with “Show everything” (focus bar), “One click focuses on it” (playlists page), “Focus on it now (the whole app works inside it)” (new playlist dialog), and “Work with part of your library” (home and sidebar). The top-bar button's visible label is “Everything” with a music-note icon, which does not say what it does. “Everything” also means other things: Shuffle everything's queue context (“Playing from Everything”), and the Songs filter that includes clips, while Mix builder says “Everything (no clips).” The demo also ships a YouTube playlist named “Focus” (28 songs), so a newcomer meets Focus as both a playlist and a feature.
- **Why it matters:** Name a mode once, and show its state in that name (Focus: off / Focus: Late night).
- **Proposed fix:** Call it Focus everywhere. Top bar: “Focus: off” or “Focus: Late night” (aria “Focus: off. Change”; tooltip “Focus on one playlist: every page shows only its songs”). Menu heading “Focus on”, with the first item “Off (whole library)”. Focus bar: “Focused on Late night · 56 songs” and a button “Stop focusing”. Page buttons: “Focus” / “Stop focusing”, taken from actions.js 'focus'/'stop-focus' (relabel 'focus' as “Focus”). Dialog checkbox: “Focus on it now (every page shows only its songs)”. Playlists page: “Click a suggestion to focus on it; + saves it as a playlist.” Palette: show “Stop focusing” only while focused. Songs filter option: “Music and clips”. Shuffle everything's context: “Your library”. Rename the demo playlist (demo.js:69) to “Study”.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/demo.js` · **Effort:** M
- **Evidence:**
  - app.js:773, 1865, 3292, 3295, 3312, 3362, 3400, 3404, 3418, 3447, 4809; index.html:26; actions.js:67-68
  - demo.js:69 { id: 'demo-focus', title: 'Focus' }; C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/d/desktop-mix.json 'Playlists: Liked videos 101, Late night 56, Commute 40, Focus 28'
  - .../microcopy/v/verify2.json: Songs filter 'Everything' (with clips) vs Mix builder 'Everything (no clips).'
  - Screenshots .../microcopy/m/focus-menu.png and .../microcopy/d/desktop-songs.png (top bar)

### microcopy-7 · medium · Queue words collide with other features: “endless” and “In list order”

- **Where:** The queue header (Up next) and the Shuffle order pill and menu
- **Observed:** In a true shuffle, the queue header shows the word “endless” next to the order pill. It stays there after More > “Endless: off” and the toast “Endless off: playback stops when the queue ends.” Here the word describes the shuffle that never runs out, not the Endless setting. When a list plays in order, the pill says “In list order” and the context line “· in order”. The order menu it opens offers “In order — The order of your playlists: oldest addition first”, which is a different order, and nothing in the menu is checked.
- **Why it matters:** A word names one thing, and a status matches the option that controls it.
- **Proposed fix:** app.js:4625: replace 'endless' with 'never runs out' (title: “A true shuffle keeps drawing until you stop”). Show “Endless on” or “Endless off” only where that setting applies (lists and radios). Rename the 'original' order (app.js:117 and 123): “Oldest added first — the order you added them to your playlists.” When a list plays in order, label the pill “As listed”, and open the menu with a checked first row “As listed (this page's order)”.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/v/verify.json: queueHeaderEndlessOn and queueHeaderEndlessOff are both 'True shuffle / endless'; screenshot .../microcopy/v/endless-off.png
  - app.js:4625 (the 'endless' word); app.js:4174 and 4345 (the Endless setting)
  - app.js:4574 modeLabel 'In list order'; app.js:117 and 123 'In order'; screenshot .../microcopy/m/mode-menu.png (pill “In list order”, menu “In order” unchecked)

### microcopy-8 · medium · The YouTube budget is called “units”, “quota” and “allowance”, and one label says “1 YouTube units”

- **Where:** Cost badges, Settings > YouTube, the bar's More, lane errors, Rescue
- **Observed:** One number is described three ways. Settings: “YouTube quota used today: 0 of 10,000 units.” The bar's More: “YouTube today: 0 of 10,000 units — A search for a song uses 100; 8,500 left for finding songs (1,500 kept for imports and adds)…”. Lane errors: “Today's YouTube quota is used up” and “Today's YouTube allowance for finding songs is used up”. The badge legend says “Uses units”, and Play tooltips say “uses 100 of today's YouTube units”. A newcomer cannot tell quota from allowance (the 10,000 total vs the 8,500 for finding songs). The accessible name of a 1-unit Play reads “Play X, uses 1 YouTube units”.
- **Why it matters:** One unit name, defined once and pluralised correctly.
- **Proposed fix:** Use only “YouTube units” and “today's units”. Settings (app.js:3021): “YouTube units used today: 340 of 10,000. A song search uses 100; the count resets at midnight Pacific time.” Bar More (app.js:4176): label “YouTube units today: 340 of 10,000”, desc “A song search uses 100. 8,160 left for finding songs; 1,500 are kept for imports and adds. Resets at midnight Pacific time.” lanes.js:147 → “Today's YouTube units are used up. They come back …” lanes.js:148, media.js:276, rescue.js:719 and app.js:4374 → “Today's units for finding songs are used up (1,500 are kept for imports). They come back at midnight Pacific time.” lanes.js:39 badge legend → “Costs YouTube units”. In ui.js:205 and media.js:637 → ', uses ' + c + (c === 1 ? ' YouTube unit' : ' YouTube units').
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/rescue.js` · **Effort:** S
- **Evidence:**
  - app.js:3021, 4176, 4374, 4396; lanes.js:39, 147-149; media.js:276-278, 637; ui.js:205; rescue.js:702, 719
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/rl/reallib.json barMore; screenshot .../microcopy/r/desktop-real-settings-0.png

### microcopy-9 · medium · Internal terms reach users: “found song” and “the discovery engine”

- **Where:** Shortcuts dialog, For you (Saved for later, Hidden), Explore/Share/Channel toasts
- **Observed:** The shortcuts list says “B — Save the playing found song for later”. For you's empty states say “The bookmark on a found song keeps it here.” and “Not interested, in a found song's menu, keeps a song or its artist out of suggestions.” Five places toast “Playing found songs needs the discovery engine.” or “Playing new songs needs the discovery engine.”: the engine is a module name, and the listener can do nothing with it. Elsewhere the same idea is called “new songs” (For you's “NEW SONGS None / Some / Lots”, car mode's “New songs: Some”), “songs like them you do not have yet”, and the playlist “Discovered”.
- **Why it matters:** Speak the user's language, and give an error a next step.
- **Proposed fix:** Define “new song” as “a song not in your library yet” and use it everywhere. actions.js:45 desc → “Save the playing new song for later”. foryou.js:1154 → “Nothing saved yet. Press the bookmark on a new song to keep it here.” foryou.js:1187 → “Nothing hidden. Choose Not interested in a new song's menu to keep it, or its artist, out of suggestions.” The five engine toasts → “New songs can't play right now. Reload the page and try again.”, or hide their Play button when the engine is missing. Add to For you's lede: “New songs are songs not in your library yet.”
- **Files:** `misc/101-true-shuffle/actions.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/share.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/channel.js` · **Effort:** S
- **Evidence:**
  - actions.js:45 desc 'Save the playing found song for later'; C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/m/menus.json shortcuts
  - foryou.js:1154, 1187, 1246
  - foryou.js:361, share.js:177, share.js:214, explore.js:151, channel.js:438
  - Screenshot .../microcopy/d/desktop-for-you.png (“NEW SONGS” dial)

### microcopy-10 · medium · Dates come in five styles, and History files evening plays under the wrong day

- **Where:** History, the song page, Your numbers, For you, Rescue, the sleep timer
- **Observed:** Dates appear as: History headings “2026-10-09” and “Plays per month: 2026-10” (ISO); the song page's “Added 2024-09-11” and “Last played 2026-08-21” (ISO); Your numbers' “since Oct 9”; For you's “Oct 9”; Rescue's “9 October 2026”; added-month pages' “May 2021”. Times appear as: History and the sleep timer “20:31” and “until 23:15” (24-hour); Your numbers “9 to 10 am”; For you's airing list “Episode 2 · 2:30 AM”. History groups days by UTC (toISOString) but prints local times. With the clock at Sunday 20:31 Central time (Texas), “Today” held only the 5 plays since 19:11. The group headed “2026-10-11” ran from 19:11 on the 10th to 18:51 on the 11th; every group spans 7 pm to 7 pm local.
- **Why it matters:** Use the reader's local calendar, one human date style and one time style.
- **Proposed fix:** Add words.date(ms) and words.time(ms) to the page's words (pageCtx.words) and use them everywhere. Dates (local): “Today”, “Yesterday”, “Fri, Oct 9”, “Oct 9, 2025”; months “October 2026”. Times: toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }). Group History by local day and month, the way habits.js partsAt does with { local: true }. Song page: “Added Sep 11, 2024”, “Last played Aug 21”. rescue.js:458 → the same helper (“Oct 9, 2026”).
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/rescue.js`, `misc/101-true-shuffle/foryou.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/rl/reallib.json historyGroups, with timezone America/Chicago: 2026-10-09 (31 listens, 08:51-18:51), 2026-10-10 (72, 19:11-18:51), 2026-10-11 (72, 19:11-18:51), Today (5, 19:11-20:31)
  - Screenshot .../microcopy/rl/reallib-history.png
  - app.js:3501, 3506, 3511 (UTC days and months) vs app.js:3516 (local time); app.js:2532-2533; app.js:4144, 4155, 4162
  - rescue.js:458 'd M YYYY'; foryou.js:705 (12-hour), foryou.js:936; habits.js:62 already uses the local clock ({ local: true })

### microcopy-11 · medium · Counts disagree and units are wrong: 157 vs 160 songs, “22 unsure artists”, “1 track have”

- **Where:** Home, Songs, Your numbers, the Library hub, Artists, Needs attention, banners
- **Observed:** Home says “157 songs · 12 artists” (playable songs only), Songs says “160 songs”, and Your numbers says “160 songs, 156 playable”: the same word with three numbers. The Library hub's Needs attention tile says “22 unsure artists”, but 22 counts songs (the nav badge's tooltip says “22 tracks without a sure artist”, and the list has 22 rows from 2 channels). Once no artists are unsure, the tile says “All good” while Needs attention still shows “One song cannot play any more”, 4 duplicates and 2 blocked. Singular forms break: plural(k, 'track') + ' have …' produced “1 track have no sure artist yet and are not listed here.” on Artists. The same pattern appears in “1 track play next.”, “1 track come from this channel.”, “1 track still have no sure artist. Name them…” and “1 track carry YouTube details…”.
- **Why it matters:** A number means the same thing everywhere, and the grammar survives a count of one.
- **Proposed fix:** Home (app.js:1890): count the same set as Songs and add “(3 can't play)”, e.g. “160 songs (3 can't play) · 12 artists · 11 h 57 min”. Hub (app.js:2553): count everything Needs attention lists, e.g. “22 songs need an artist · 1 can't play”, and say “Nothing to fix” only when every tab is 0. Add a verb helper: plural(k, 'song') + (k === 1 ? ' has' : ' have'). Then: “1 song has no known artist yet, so it isn't listed here.”, “1 song plays next.”, “1 song comes from this channel.”, “1 song still has no known artist. Name it in one tap.”, “YouTube details for 1 song are over 30 days old.”
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/d/desktop-home.png “157 songs” vs .../microcopy/d/desktop-songs.png “160 songs”; .../microcopy/rl/reallib.json stats “160 songs, 156 playable”
  - .../microcopy/v/verify2.json: artistsNote '1 track have no sure artist yet and are not listed here.'; hubNeeds 'Needs attention All good' while fixTop lists Cannot play 1, Duplicates 4, Blocked 2
  - app.js:1890 (home count), 2099 (Songs), 2553 (hub tile), 717 (nav tooltip); singular bugs at app.js:586, 1679, 1972, 2164, 3027

### microcopy-12 · medium · First run: the welcome makes a false promise, and the empty states disagree

- **Where:** Welcome (#/ with no library), Settings > YouTube, empty states, now panel
- **Observed:** The welcome ends “Nothing is contacted until you press Sign in or Play.”, but opening For you (in the sidebar on the first run) contacts graphql.anilist.co, api.animethemes.moe and s4.anilist.co. The button “Sign in or import a file” opens Settings, which starts with “Client id (this browser only) [Use]”, “YouTube API key (optional…) [Use]”, “Last.fm API key… [Use]” and a 75-word Google Cloud recipe; “Sign in with Google” comes after them. The file option is called “Restore from a file”, under Backup further down. The empty states name the next step five different ways, and some are wrong. Quick labeller: “Every song here has labels.” (there are no songs). Library hub: “Needs attention — All good”. Channels: “No channels yet: import some music first.” (no button). Rescue: “Nothing in the library yet.” (no button). Map: “The map needs at least eight songs here.” (no heading; the tab title is just “True Shuffle”). Rank: “Import your playlists in Settings, then come back to rank them.” [Open Settings]. For you: “import a playlist first” [Open Settings]. Guess the anime offers “Quick labeller” and “Anime, games & stage”, which lead to empty pages. The now panel's “No music yet. Try the demo, or sign in under Settings.” is half covered by the S/M/L size buttons.
- **Why it matters:** Be accurate about privacy. One empty state, one next step, in the user's words.
- **Proposed fix:** app.js:1873 → “Your library stays in this browser. Nothing is sent until you sign in or press Play; For you and Explore ask public music sites (AniList, AnimeThemes, Deezer, iTunes) about anime and artists, never about you.” app.js:1871 → two buttons: “Import from YouTube” (opens #/settings scrolled to “Sign in with Google”, with the focus on it) and “Restore a backup file”. In Settings > YouTube, put “Sign in with Google” first and move the client id, API keys and Cloud recipe into a <details> named “Use your own Google keys (advanced)”. Use one empty-state helper for every library page: heading “No music yet”, line “Import your YouTube playlists to fill this page.”, buttons “Import from YouTube” and “Try the demo”. Use it for Quick labeller with 0 songs, Channels, Rescue, Map, Rank and Quiz. Hide the hub's Needs attention status when the library is empty. Give Map an h1 “Map”. In the empty now panel, hide #vbar until something is loaded, or add a top margin under it.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/channel.js`, `misc/101-true-shuffle/rescue.js`, `misc/101-true-shuffle/duel.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/quiz.js`, `misc/101-true-shuffle/app.css` · **Effort:** M
- **Evidence:**
  - hosts.mjs run: '#/ -> []' but '#/for-you -> graphql.anilist.co, api.animethemes.moe, s4.anilist.co' (empty library, not signed in)
  - app.js:1871 and 1873 (welcome); app.js:2842-2887 (Settings order); app.js:3564; app.js:3714; channel.js:557; rescue.js:511; duel.js:468; foryou.js:496
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/r/desktop-real.json; screenshots .../microcopy/r/desktop-real-home.png and .../microcopy/r/desktop-real-settings-0.png
  - .../microcopy/v/now-empty-overlap.png (the size bar overlaps the text by 3,696 px²)

### microcopy-13 · medium · Error toasts state a cause but no next step, and vanish before they can be read

- **Where:** Playback errors, search with no results, page errors, toast timing
- **Observed:** A song that cannot play gives “Skipped “Hollow Compass - Paper Weather”: The owner does not allow this video to be played on other sites.”: 19 words, a capital letter after the colon, shown for 3.5 s. A second skip replaced it about 1.5 s later, and hovering does not keep a toast (it was still gone after 4 s). The toast offers no action, although the row menu has “Find a working upload” and Needs attention has “Find working uploads”. Five failures in a row end with “Five tracks in a row could not be played, so playback stopped. Is the network down?”, which asks a question instead of giving an instruction. A search with no match says “Nothing found. Search knows titles in any script, romaji, artists, anime and games, genres and moods.”, with no way forward. A page that fails to draw shows “This page could not be drawn: ” followed by the raw JavaScript message. 13 of the 124 toast messages in the source are longer than 14 words, and all share the same 3.5 s timer (7 s with Undo).
- **Why it matters:** An error says what happened and what to do next. Timed messages last long enough or can be paused (WCAG 2.2.1).
- **Proposed fix:** app.js:357 → U.toast('Couldn't play “' + title + '”: ' + reason, { action: 'Find another upload', onAction: open the Rescue page for that song }), with the reasons in lowercase: “removed from YouTube or made private”, “its owner blocks other sites”. haltReason → “Five songs in a row wouldn't play, so playback stopped. Check your connection, then press Play.”, or “…Their owners block other sites. Needs attention can find other uploads.” Search empty state (app.js:2021) → “No songs, artists or anime match “zzzzqqq”. Check the spelling, or look further:” with the buttons “Search YouTube” (with its cost badge) and “Find it by its lyrics”. app.js:776 → “Something went wrong drawing this page. Reload it, or go Home.”, with the technical message inside a <details>. ui.js toast(): show for max(4 s, 1.5 s + 0.3 s per word), pause while hovered or focused, and queue a new toast instead of replacing one that is less than 1.5 s old.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/player.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/v/verify.json skip toasts; toastAfterHover4s: false; screenshot .../microcopy/v/skip-toast.png
  - app.js:357 (skip toast); app.js:378-384 (haltReason); app.js:2021 (search empty state); app.js:776 (page error); ui.js:506-517 (toast: 3500/7000 ms, no hover pause); rescue.js:866 'Find a working upload'
  - toastwords.cjs: 13 messages over 14 words (e.g. app.js:3160 at 24 words, app.js:4364 at 20, app.js:5682 at 17)

### microcopy-14 · low · Screen readers hear every message twice

- **Where:** say(): #status and the toast
- **Observed:** say() writes each message to #status (role=status, aria-live=polite) and also shows it in the toast, which is a second role=status, aria-live=polite region. After pressing S, both regions held “Shuffled again.” at the same moment, so every confirmation and error can be announced twice.
- **Why it matters:** One message, one announcement.
- **Proposed fix:** Keep #status as the only live region. In ui.js toast(), drop role and aria-live from the toast box and keep its Undo button focusable with the label “Undo: <message>”. Alternatively, have say() skip setStatus whenever it shows a toast.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/v/verify.json liveRegions: #status and .ts-toast.is-on, both role=status and both holding 'Shuffled again.'
  - app.js:45 say(); ui.js:506-508 (toast role and aria-live)

### microcopy-15 · low · Ellipses on items that only navigate, and status text after the ellipsis

- **Where:** Menus: Shuffle order, Focus, the bar's More, the row menu
- **Observed:** “Mix builder…” (order menu), and “Suggested and all playlists…” and “New smart playlist…” (Focus menu) open pages, not dialogs. “Continue on your phone” opens a dialog but has no ellipsis. Several labels put a status after the ellipsis: “Playback speed… (normal)”, “Rating… (1)”, “Sleep timer… (until 23:15)”, “Trim and volume… (set)”, “Other versions (3)…”.
- **Why it matters:** An ellipsis means more input follows in a dialog or menu. State belongs in the description line.
- **Proposed fix:** Rename to “Mix builder”, “All playlists” and “New smart playlist” (no ellipsis), and “Continue on your phone…”. Move state into desc: “Playback speed…” with desc “Normal”; “Rating…” with desc “1 star”; “Sleep timer…” with desc “Pauses at 23:15”; “Trim and volume…” with desc “Set for this song”; “Other versions…” with hint “3”.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - app.js:4595, 3298, 3299 (items that navigate); app.js:4165 (Continue on your phone)
  - app.js:4162, 4170, 1373, 1390, 1391
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/m/menus.json bar-more, mode-menu, focus-menu, row-menu

### microcopy-16 · low · Buttons whose words don't say what they do

- **Where:** Settings, Explore and For you rows, the Trim dialog, the stale banner, Songs and Home headers
- **Observed:** Three Settings buttons all read “Use” (client id, YouTube key, Last.fm key), with nothing to tell them apart for a screen reader. Rows that open a YouTube search in a new tab are labelled just “YouTube”, a noun, next to “Play”. Trim's “Now” fills the field with the playing position. The stale banner's “Delete instead” only links to the top of Settings, which is at least 3,872 px tall; the delete button is at the bottom. “Listening history (CSV)” is a download button without a verb. The Shuffle split button reads “Shuffle True shuffle” to a screen reader. Home's order pill is captioned “Shuffles use”. Mood cards end with a bare number (“Upbeat, sunny, catchy. 29”).
- **Why it matters:** Verb-first labels that predict the result, and accessible names that make sense on their own.
- **Proposed fix:** Rename to “Save client id”, “Save API key” and “Save Last.fm key”. media.js:540/544: label “Find on YouTube”, keeping the external icon. Trim: “Use current time”. Banner: “Delete in Settings…”, linking to #/settings with Data and privacy scrolled into view. “Download history (CSV)”. Split button: aria-label “Shuffle (order: True shuffle)” and visible text “Shuffle · True shuffle”. Home caption: “Shuffle order:”. Mood cards: put “29 songs” on its own line.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/index.html` · **Effort:** S
- **Evidence:**
  - app.js:2844, 2860, 2876 (“Use”); media.js:540, 544 (“YouTube”); app.js:1407 (“Now”); index.html:50 (“Delete instead”, href #/settings); app.js:2950 (CSV); app.js:4602-4604 (split button); app.js:1909 (“Shuffles use”)
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/d/desktop-explore_demo-002.json controls; screenshot .../microcopy/d/desktop-home.png; .../microcopy/rl/reallib-history.png (banner)

### microcopy-17 · low · Settings reads like a manual: 1,090 words, a 148-word privacy paragraph, and the car guide twice

- **Where:** Settings (real mode) and the Help dialog
- **Observed:** Settings in real mode has 1,090 words and is 3,872 px tall at 1366x900. Six paragraphs of 40 words or more add up to 426 words: Data and privacy (148 words in one block), the API key recipe (75), the Desk sync note (64) and the media-keys explanation (52) lead the list. The five-step “In the car” guide and its three notes appear word for word in both Settings > Car and the Help dialog. The Sync section talks about “the Desk”, “your private repository” and “pulled data”, which only the owner can decode.
- **Why it matters:** Lead with the decision, put the explanation behind a disclosure, and say each thing once.
- **Proposed fix:** Turn Data and privacy into four bullets. “Kept in this browser only: your library, playlists, labels, ratings and history.” “Sent to Google: the sign-in, YouTube requests and the player.” “Sent to music sites (Deezer, iTunes, AnimeThemes, AniList, MusicBrainz, LRCLIB; Last.fm only with your key): artist, song and anime names, never anything about you.” “YouTube data older than 30 days is refreshed when you sign in; or delete it below.” Put the API-key recipe, the media-keys mechanism and the Desk details inside <details> elements named “How this works”. Keep the car steps only in Settings > Car, and have Help say “In the car: see Settings > Car.”
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/car.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/r/desktop-real.json settings: 1,090 words, 6 paragraphs of 40 words or more totalling 426
  - app.js:2997 (privacy paragraph); car.js:58-69 (steps shared by Settings and Help); screenshots .../microcopy/r/desktop-real-settings-0.png to -4.png

### microcopy-18 · low · Jargon a newcomer can't parse: “works”, “Role there”, “sure artist”, “Nothing vouches…”, OP/ED

- **Where:** Needs attention, the editor, Mix builder, Works, For you, Quiz, Rescue
- **Observed:** The anime or game a song comes from has five names. It is a “work” (Mix builder's “Works” row, “16 songs from 2 works”, the sort “Anime / work”), a “series” (For you: “Missing from your series”, “2 series”), “From” (the song list column and the editor's “From (anime, game, film, musical)”), a “show” (Quiz), and “Anime, games & stage” (the nav). The editor asks for “Role there”. Needs attention explains itself with “Nothing vouches for the artist of these, so the channel stands in its place. One tap on a reading names it; the page then offers to read the channel's other guesses the same way.”, under the tab “No sure artist”, with buttons like “By Hollow Compass?”. Quiz: “songs labelled with the work they are from and the role OP or ED”. Rescue: “the artist's Topic channel”, “The first is surely this song, so it is chosen.”
- **Why it matters:** Use plain words for concepts, and define fan jargon once.
- **Proposed fix:** Say “anime or game” in copy: “16 songs from 2 anime and games”, Mix builder row “Anime & games”, editor “From (anime, game, film or musical)” and “Role in it (opening, ending…)”, For you “Missing from your anime”. Needs attention: tab “Artist unknown”; text “We couldn't tell who sings these, so the channel's name stands in. Tap the right artist under a song; we'll offer to fix the channel's other songs the same way.”; buttons “Artist: Hollow Compass”. Give OP1/ED1 chips the titles “Opening 1” and “Ending 1”. Rescue: “the artist's official audio channel (Topic)”, and “This one is almost certainly the same song, so it's selected. Play it to check.”
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/quiz.js`, `misc/101-true-shuffle/rescue.js` · **Effort:** M
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/d/desktop-mix.json, desktop-works.json, desktop-for-you.json; .../microcopy/m/menus2.json editor
  - app.js:1599-1600 (editor labels); app.js:1801 (sort 'Anime / work'); app.js:2635 (“Works” row); app.js:2783, 2795 (Needs attention); quiz.js:1199; rescue.js:202, 666; foryou.js:768

### microcopy-19 · low · For you and Explore: jump chips don't match their sections, and badges mix sources with kinds

- **Where:** For you (#/for-you), Explore (#/explore/<id>)
- **Observed:** For you's chips (“Your radio, This season, Airing today, Your series, New releases, Your channels, Because you play, Saved”) jump to sections titled “This season's anime”, “Missing from your series”, “New releases from your artists”, “New from your channels”, “Because you play Paper Lanterns” and “Saved for later”. The page's kicker is “DISCOVER”, but the nav calls it For you. Explore's chips (“Mix, Artist, Composer, Similar, Your library”) lead to “YouTube Mix”, “More by Paper Lanterns”, “More by Ilka Morrowind” and “From artists like Paper Lanterns”, and “Mix” collides with Mix builder. Lane badges mix kinds and sources: “Anime”, “Airing”, “Albums”, “Channel”, “Deezer”, “Elsewhere”, “Yours”, and “YouTube Mix” repeated from the title. With an empty library, the fallback heading reads “Because you play your favourites”.
- **Why it matters:** A link's words should match where it lands.
- **Proposed fix:** Build the chip labels from the lane titles, shortened the same way: “Your radio”, “This season”, “Airing today”, “Missing songs”, “New releases”, “New uploads”, “Like Paper Lanterns”, “Saved for later”. Drop the “Discover” kicker, or make it “New music”. Explore chips: “YouTube Mix”, “More by artist”, “Credits”, “Similar artists”, “In your library”. Badges: sources only (“AniList”, “AnimeThemes”, “Deezer”, “iTunes”, “YouTube”) plus “In your library”; drop “Elsewhere” and any badge that repeats the title. Empty-library fallback heading: “Artists like yours”.
- **Files:** `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/lanes.js` · **Effort:** S
- **Evidence:**
  - foryou.js:50 (JUMP); foryou.js:614, 768, 872, 996, 1098, 1152, 1335 (kicker 'Discover'); explore.js:526 (JUMP); explore.js:235, 270, 376; lanes.js:39 (BADGE)
  - Screenshot C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/d/desktop-for-you.png; .../microcopy/d/desktop-explore_demo-002.json

### microcopy-20 · low · On a phone the search box reads “Search songs,” and the demo banner takes three lines

- **Where:** Phone (390 px): top bar, demo banner, player poster
- **Observed:** The search placeholder “Search songs, artists, anime, moods” needs 250 px, but the phone field has 112 px, so it reads “Search songs,”. The demo banner, “Demo. Demo library: every artist, track and playlist here is invented, and nothing is played. Leave the demo”, repeats itself (“Demo. Demo library”) and wraps to three lines above every page. The player adds “Demo · no sound” and “Press play (demo, no sound)”: three demo notices on one screen.
- **Why it matters:** Copy must fit its container at every width, and a thing is said once.
- **Proposed fix:** Under 760 px, set the placeholder to “Search” (in wireShell, with matchMedia('(max-width: 760px)')). Keep the full hint on wide windows and in the label. Banner: “<b>Demo:</b> an invented library with a silent player. <a>Leave the demo</a>” (demo.js:33 → “an invented library with a silent player.”), which fits one line on a phone. Poster (app.js:851): “Press play”; the tag already says “Demo · no sound”.
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/demo.js` · **Effort:** S
- **Evidence:**
  - C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/microcopy/v/verify2.json phonePlaceholder {textWidth: 250, room: 112, fits: false}; screenshot .../microcopy/v/phone-search-placeholder.png
  - Screenshots .../microcopy/p/phone-home.png and .../microcopy/p/phone-songs.png
  - index.html:30, 47, 62; demo.js:33; app.js:851

## Lens: responsive-perf

<details><summary>What this auditor covered</summary>

- Viewports (dark theme, demo unless noted): 761, 800, 880, 960, 1000, 1100, 1180 and 1280 px wide at 760 px tall; 800x700, 1000x700, 1024x600 (touch), 1280x720/800, 1366x768, 1440x900, 1600x900, 1920x1080, 2560x1440; phone 390x844 portrait; landscape 740x360, 844x390, 915x412; DPR 2 at 1366x768
- Resizes while playing: 1000 -> 700 -> 1000/1100 px with the sheet open (mouse); phone 390x844 -> 915x412/844x390 -> back with the sheet open (touch); a sweep from 1180 to 1280 px; theater mode (T) at 1920 then 1366/1100/900; the S/M/L player sizes at 1366/1600/1920 and L at 1920 then 1366/1000
- Demo routes, with screenshots and geometry at 5 sizes and layout-shift, long-task and paint timing on each: #/, songs, artists, artist, track, for-you, explore, stats, settings, browse, works, work, genres, history, fix, lists, liked, channels, wrapped, duel, rescue, map, mix, quiz, search
- Real mode, always with the four Google hosts blocked and thumbnails served locally through DevTools Fetch: a first run with an empty library at 1366/800/390; synthetic libraries of 60, 400, 2,000 and 8,000 songs with 3,000-20,000 history entries; boot at 1x and 4x CPU on desktop and phone; 22 routes timed; interactions measured with Event Timing (select, Ctrl-click, ArrowDown, double-click play, row menu, Escape, sort x4, songs filter typing, header search typing, the 4 queue tabs, Pause, Next, L); fast scrolling of the 8,000-row list; memory after 50 and 100 routes
- Lanes (Explore, For you, track, artist) with a slow network: outside requests held 1.5-8 s, then failed locally; the player's error and loading messages with YouTube blocked; cover art sharpness at DPR 2, lazy loading counts, broken-thumbnail fallback
- Tools: PerformanceObserver (layout-shift, longtask, event at 16 ms, LCP), CDP Profiler (boot, routes, like, filter, Explore tab), HeapProfiler GC + Performance.getMetrics, Runtime.queryObjects, a heap snapshot retainer path, DOMDebugger.getEventListeners, a MutationObserver render counter
- Scripts and raw output: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/ (*.mjs; bigperf-8000.txt, bigperf-8000-x4.txt, profile-8000.txt, memory-8000.txt, responsive.json, cls-*.json; screenshots under shots/)
- Network note: one early real-mode run let YouTube's IFrame player load a synthetic video id. That used no Data API calls and no quota. One lanes run let the sandboxed Deezer frame send synthetic artist names to api.deezer.com. No listener data was sent in either case. Later runs blocked www.youtube.com, youtube-nocookie.com and api.deezer.com too. config.js was never opened, and nothing in the repository was changed.

</details>

### responsive-perf-1 · critical · Opening the now-playing sheet on a phone, then widening past 760 px (rotating the phone, resizing or snapping the window), leaves the player bar, the page and the search box unusable

- **Where:** Responsive: crossing the 760 px breakpoint
- **Observed:** When the sheet opens in the phone layout, sheetInert(true) marks #main, #bar, #tabbar and the header inert, and gives #now-rest role=dialog and aria-modal. Nothing undoes this when the window becomes wider than 760 px, so the desktop layout appears with those regions still inert. Real clicks and taps on the bar's Play/Pause, the page's Play button and the search box do nothing, and Tab skips them. The only way out is a sidebar link: it navigates, and onRoute() calls closeSheet(). The page looks normal, so nothing tells the person why it stopped responding.
- **Why it matters:** State that belongs to one layout (a modal sheet with inert siblings) must be reset when the layout changes. The interface must never stop responding with no visible cause.
- **Proposed fix:** In app.js where the app is wired up, listen to the breakpoint: var mq = window.matchMedia('(max-width: 760px)'); (mq.addEventListener ? mq.addEventListener('change', onBp) : mq.addListener(onBp)); function onBp(e) { if (!e.matches) closeSheet(); U.safe.update(); }. closeSheet() already removes sheet-open, the inert flags and the dialog role, and returns the focus. Also make sheetInert(true) do nothing unless isPhone(). Add a drive check: open the sheet at 700 px, widen to 1100 px, assert that #main.inert is false and that #btn-toggle toggles.
- **Files:** `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - inert.mjs, 700x700 with the sheet open, then 1100x760 (mouse): inert main:true bar:true header:true. Clicking the bar's Play/Pause: state stays 'playing'. Clicking the search box: it does not take the focus. Clicking the view's Play: the queue context does not change. Tab order: Home | Search | Songs | Artists | Channels | Genres (sidebar only).
  - The same results after a phone rotation from 390x844 to 915x412 using touch taps.
  - resize.mjs: after rotating to 844x390, #now-rest still has role=dialog aria-modal=true, and elementFromPoint at the middle of the view returns #app (the view can no longer be hit).
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/resize/A-700-sheet.png, then .../shots/resize/A-1000-after-sheet.png (looks normal but does not respond) and .../shots/resize/inert-phone-rotate.png
  - Code: app.js:1185-1209 (sheetInert/openSheet/closeSheet). isPhone() at app.js:1165 is only read on demand, and there is no matchMedia change listener. The only automatic closeSheet() is in onRoute (app.js:751).

### responsive-perf-2 · high · If the window gets smaller while theater mode is on, the 1,100 px panel stays: the page column shrinks to 0 px and the bar's right-hand controls go off-screen

- **Where:** Responsive: window resize, player sizes
- **Observed:** Pressing T at 1920x1080 sets --ts-now to 1100px without saving it. The resize handler only re-applies a saved width, so the 1,100 px panel stays when the window shrinks. At 1366 px the main column is 166 px wide; at 1100 and 900 px it is 0 px. At 900 px the app grid is wider than the window, so the like, volume, More and queue buttons on the bar are cut off (body has overflow hidden). Snapping a window to half a screen or moving it to a smaller monitor does this, and the only way out is knowing to press T again.
- **Why it matters:** Layout modes must refit when the window is resized. A size the user chose is a preference, not a fixed pixel width that may push content out of the window.
- **Proposed fix:** In the resize listener (app.js:4565), always re-clamp the current width. If body has is-theater, recompute Math.max(520, innerWidth - 68 - 640) and clamp it with nowMax(); otherwise re-apply the saved width or the default. Make nowMax() keep a minimum main column, roughly innerWidth minus the sidebar's real width, minus 32, minus 420. Turn theater off automatically below about 1100 px. As a CSS backstop (app.css:90): grid-template-columns: var(--ts-side) minmax(0, 1fr) min(var(--ts-now), calc(100vw - var(--ts-side) - 440px)).
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - theater.mjs: 1920 with theater on: now panel 1100x918, main 720. After resizing to 1366: main 166x606. At 1100: main 0x606. At 900: main 0x606 and the now panel is still 1,100 px wide.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/theater/t-1366.png (the Songs page squeezed into a 166 px strip) and .../shots/theater/t-900.png (no page at all; the bar stops after the time)
  - Code: setTheater (app.js:4646-4651) sets the width with save=false. The resize listener (app.js:4565) only re-applies ToyKit.load('nowWidth'). nowMax() (app.js:4527) is never applied to an unsaved width.

### responsive-perf-3 · high · The songs table sizes itself by the window, not by its own column: with the L player size on a 1366 px laptop the Title column is 0 px wide

- **Where:** Responsive: track lists at mid widths and with a resized panel
- **Observed:** The .ts-tracks columns change at window-width media queries. But the main column's width also depends on the sidebar (236 or 68 px) and on the now panel, which the user can size (S 340, M 520, L 760, a drag, or theater). At 1366x768, pressing L leaves a 338 px main column while the table keeps its 7-column desktop grid: the title and artist column is 0 px wide, so rows show only the number, the cover and the length, and the 'Title' and 'From' headers overlap. M leaves 106 px. Even with the default panel the title column is cramped: 75 px at 761 (12 of 12 titles cut off), 114 px at 800, and 151 px at 1280 (the sidebar has labels again). At 1280 the genre chips are cut off too, while a From column that is empty for most songs takes 96 px.
- **Why it matters:** A component should respond to the space it actually gets (container queries), especially next to panels the user can resize. A primary column must never shrink below a usable width.
- **Proposed fix:** Move the .ts-tracks column rules to container queries on .ts-view: at max-width 860px hide .ts-c-genre; at 640px hide .ts-c-work and use 32px 44px minmax(0, 1fr) 52px 80px; at 460px use the phone's 44px minmax(0, 1fr) 80px. Add no-work (hide From) when no listed track has a work. In nowMax(), subtract the real sidebar width and keep main at least about 480 px; grey out L or M when they would not fit.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - panelL.mjs title column width: 1366 S 192 px (2/12 truncated), M 106 px (3/12), L 0 px (12/12) with main at 338 px; 1600 L 103 px; 1920 L 256 px
  - mid.mjs: title column 75 px at 761 (12/12 truncated), 114 at 800 (3/12), 163 at 1000, 151 at 1280 (3/12)
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/panel/1366-L.png, .../shots/mid/mid-761.png and .../shots/mid/mid-1280.png
  - Code: app.css:374-375, 549-566 and 621 set --cols with window media queries, although .ts-view already has container-type: inline-size (app.css:903). nowMax() (app.js:4527) is min(1100, innerWidth - 480) and ignores the 236 px sidebar, so L is allowed at 1366 px.

### responsive-perf-4 · high · In landscape on a phone the page disappears: under 760 px wide the view is 0 px tall, and at 844-915 px wide no song rows show and the queue is 5-27 px tall

- **Where:** Responsive: short and landscape viewports
- **Observed:** At 740x360 the phone layout needs 385 px for fixed parts (header 52 + video 210 + mini player 61 + tabs 62), more than the 360 px available. #main therefore gets 0 px and the tab bar is cut off by 25 px: only the video and the mini player are visible. Phones rotated to more than 760 px wide get the desktop grid with its fixed 56 px header and 96 px bar. At 844x390 the main area is 474x225 px, the first song row is at y=497 (below the screen) and the rest of the now panel is 5 px tall. At 915x412 it is 247 px tall with no rows and a 27 px queue. A 1024x600 tablet shows the first row only partly. This also covers a phone in a landscape car mount when car mode is off.
- **Why it matters:** Every orientation must keep the main content reachable. Fixed chrome should scale with the window's height. YouTube's 200x200 minimum can be met with the player beside the content instead of above it.
- **Proposed fix:** Add a short landscape layout, e.g. @media (orientation: landscape) and (max-height: 500px). Use a grid of 'video main' / 'bar bar' with a video column of about 40% width (at least 356x200, so YouTube's minimum holds). Put the tab bar in a narrow left rail or the header. Make the bar 56-64 px tall with the seek line on top, and hide hero art. Use the same layout for windows 761 px or wider and 500 px or shorter, instead of the three-column desktop grid.
- **Files:** `misc/101-true-shuffle/app.css` · **Effort:** M
- **Evidence:**
  - resize.mjs (mobile emulation): 740x360: main [0,262,740,0], tab bar at y 323-385. 844x390: main 474x225, now-rest h=5, 0 rows fully visible. 915x412: main 545x247, now-rest h=27, 0 rows. 1024x600: main 624x435, first row at y=456.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/resize/C-740x360.png (video, mini player and cut-off tabs only), .../C-844x390.png, .../C-915x412.png and .../C-1024x600.png
  - Code: app.css:570-647 (phone grid rows), app.css:587 (player height max(210px, ...)), app.css:10 (--ts-bar: 96px), plus the 56 px header

### responsive-perf-5 · high · While a card lane loads it shows six full-width grey squares (4,598 px tall), then collapses: layout shift 0.42 on Explore and 0.64 on For you

- **Where:** Perceived performance: lane loading states, layout shift
- **Observed:** The card skeleton is a div with the classes ts-shelf ts-lane-sk ts-lane-cards (lanes.js:522). The CSS that lanes.js injects contains '.ts-lane-sk { display: block; }' (lanes.js:209), which overrides '.ts-shelf { display: grid; grid-auto-flow: column }' (app.css:334). The six skeleton cards therefore stack vertically at full width: 726x764 px each at 1366 px, and 366x404 on a phone. Every card lane that is loading is 4,670 px tall (2,512 on a phone), a wall of grey squares. On Explore that is More by the artist, Credits and Similar; on For you, This season's anime, New releases and Because you play. When the lane settles it shrinks to a 120 px error or empty box, or a 300 px shelf, so everything below jumps by thousands of pixels. The demo never shows this because its data arrives instantly.
- **Why it matters:** A skeleton should have the shape and size of what will replace it, so nothing shifts when content arrives (layout shift of 0.1 or less).
- **Proposed fix:** In lanes.js:209 limit the rule to '.ts-lane-sk:not(.ts-shelf):not(.ts-grid) { display: block; }', or add '.ts-lane-sk.ts-shelf { display: grid; }'. Then keep the lane's height while it settles: give .ts-lane-body the skeleton's height as min-height while loading, and only collapse an empty or error lane when it is below the visible area.
- **Files:** `misc/101-true-shuffle/lanes.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - skel.mjs (real mode; outside requests held, then failed locally): the artist lane while loading is 4,670 px tall; its skeleton is 730x4,598 with each card 726x764. On a 390x844 phone the skeleton is 370x2,438 with cards 366x404.
  - lanesreal.mjs (requests answered after 1.5 s): layout shift 0.4217 on Explore (div.ts-shelf.ts-lane-sk moved from y0h0 to y58h606), 0.6403 on For you (section#fy-lane-because-0 pulled into view, plus the saved/hidden lanes), 0.0812 on a track page
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/skel/explore-loading.png (one grey square fills the screen under 'More by Paper Lanterns'). .../shots/skel/for-you-m-loading.png, then .../for-you-m-after.png (the squares become a 120 px error box and Airing today jumps up).

### responsive-perf-6 · high · With a big library the app opens on an empty shell for 1 to 3 s with no loading state, then freezes and everything pops in (8,000 songs: a 1.9 s long task at 4x CPU)

- **Where:** Perceived performance: start-up
- **Observed:** Real mode with 8,000 songs and 20,000 history entries. The first paint at 88 ms shows an empty sidebar, an empty main panel, a Play circle with no icon and an empty Focus pill. Content arrives at 1,117 ms on this desktop and 3,189 ms at 4x CPU (roughly a mid-range Android phone), after one long task of 483 ms (1x) or 1,912 ms (4x). Then the whole shell appears at once (layout shift 0.20). On a phone the tab bar is missing until then, and the mini player's Play button looks enabled but does nothing. The start page is also built more than once: start() calls renderAll(), which already runs renderView(true), and then calls renderView(false) (app.js:5892-5893). A MutationObserver saw the start page's title inserted 3 times during start-up.
- **Why it matters:** Show something meaningful at once (a skeleton or progress for work known to be slow). Keep the main thread free of tasks over about 200 ms, and draw the first screen once.
- **Proposed fix:** (1) Before store.loadLibrary(), have start() draw a loading view: 'Opening your library…', a skeleton of the home page, the sidebar and the tabs. (2) Remove the second render: drop renderView(false) after renderAll() (app.js:5893), or let renderAll skip the view. (3) Draw the home page's first rows, then build the heavy shelves later in requestIdleCallback slices or as lazy lanes: wrapped.js homeLanes, rediscover and onThisDay, suggestions (app.js:3375) and channel homeShelf. (4) Remember S.addedKeys and firstAdded for each track (shuffle.js:130-136). Build peopleIdx (app.js:5578) only when the song that is playing has voice credits. (5) Keep Play disabled with a spinner until the library is ready.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/shuffle.js`, `misc/101-true-shuffle/wrapped.js`, `misc/101-true-shuffle/index.html` · **Effort:** L
- **Evidence:**
  - bigperf.mjs, 8,000 songs at 1366x768. 1x: FCP 88 ms, ready at 1,117 ms, long tasks of 483 ms (at 612 ms) and 101 ms, layout shift 0.2043. 4x: ready at 3,189 ms, long tasks of 1,912 ms (at 1,207 ms) and 233 ms.
  - bootprof.mjs (4x, 5.15 s sampled): renderView 2,191 ms inclusive (viewHome 1,655, of which wrapped.js homeLanes 395, suggestions 344, channel homeShelf 191); renderNowInfo 575 (voiceLinks/peopleIdx 346); setQueue/replaceUpcoming 509; the IndexedDB load (store.js:165) 401; S.addedKeys 310
  - twice.mjs (2,000 songs): the start page's title was inserted at 410, 410 and 487 ms
  - bootphone.mjs (phone, 4x): at 323 ms the view is empty, there are 0 tabs, and #btn-toggle is enabled and shows its icon
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/big-8000/boot-00028.png (empty shell), .../shots/big-8000/boot-01117.png and .../shots/bootphone/boot-00323.png (phone: a black page and no tabs)

### responsive-perf-7 · medium · The page shell builds itself after the first paint: load layout shift is 0.19-0.20 at 1366 px, and the search box jumps 60 px

- **Where:** Perceived performance: layout shift on load
- **Observed:** Several controls in index.html are empty and app.js fills them after the first frame: the sidebar list #nav, the Back and Forward buttons and #focus-btn (no icon or label), #btn-mode (no label), the transport buttons (no icons) and #vbar. As they fill, the search form moves from x=493 to x=553 and the Play button from x=611 to x=664. The transport row grows from 304 to 427 px, and the queue section moves down 28-70 px. This happens in the demo, on first run and with a library.
- **Why it matters:** Reserve the space that JavaScript will fill, so the first frame already has the final layout (layout shift of 0.1 or less).
- **Proposed fix:** Give the static shell its final size. In index.html, put the SVG icons, or fixed-size spans, into #nav-back, #nav-fwd and the transport buttons. Write default text into #focus-btn ('Everything') and #btn-mode ('True shuffle'). Give #vbar a min-height of 28 px at 761 px and up. Either render the sidebar items statically or give .ts-nav a min-height. Another option: keep .ts-app and the header's controls at visibility: hidden until the first renderAll() adds html.ts-drawn (hidden content is not counted as a shift).
- **Files:** `misc/101-true-shuffle/index.html`, `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** S
- **Evidence:**
  - cls.mjs, demo at 1366x768: layout shift 0.1935 at 319 ms (now-rest from y250 to y278; transport from 304 to 427 px wide; the sidebar's Playlists section pushed out). 1920x1080: 0.1091. Phone 390x844: 0.
  - firstrun.mjs, real mode with an empty library. 1366: 0.1981 (search form x493 to 553, #btn-toggle x611 to 664, queue y298 to 368). 800x700: 0.0407 (the search form shrinks from 412 to 292 px wide).
  - Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/big-8000/boot-00028.png (the shell before it is filled)
  - Code: index.html:22-26, 38, 63 and 107-128 (empty buttons and lists)

### responsive-perf-8 · medium · On a phone, the first tap that starts playback docks the video and moves the list 220 px under the finger

- **Where:** Responsive and perceived performance: phone layout shift
- **Observed:** On Songs at 390x844, a tap on a row starts playback. In the same frame body.has-player adds the 219 px video above #main. The tapped row 'Small Current' jumps from y=415 to y=635, and the row now under the finger is 'Paper Parade'. A second tap (on ⋯, or a quick double tap) lands on another song. The same happens on an artist page (y 391 to 611). The visible list shrinks from 10 rows to 6 with no transition.
- **Why it matters:** Content under the finger must not move as a result of that tap. When UI is inserted above content, the scroll position should be kept.
- **Proposed fix:** On phones, in showDock() (app.js:411), read #main's top before and after adding has-player, and add the difference to main.scrollTop in the same frame. The tapped row then stays put and the video seems to slide in above it. Optionally animate the dock's height and ignore row taps for about 300 ms after docking.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - phone.mjs: on #/songs the tapped row's top goes from 415 to 635 px in one frame, and the row under the finger becomes 'Paper Parade'. On #/artist/paperlanterns, 391 to 611.
  - cls.mjs, phone: a layout shift of 0.2063 when playback starts (main#main moves from y52 to y271)
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/phone/tap-before-_songs.png and .../shots/phone/tap-after-_songs.png
  - Code: showDock() (app.js:411); app.css:585-587

### responsive-perf-9 · medium · The player-size buttons cover the first line of the player's own messages ('could not be loaded', 'Loading the YouTube player…') and of the empty panel's text

- **Where:** Responsive: the now-playing panel on wide windows
- **Observed:** On every window wider than 760 px, #vbar has margin-bottom: -40px so that it shares the 'Now playing' line (app.css:1061-1065). playerMessage() appends #player-msg after #vbar (app.js:219), so the message box slides under the S, M, L, theater and full screen buttons. The error reads 'The YouTube player [S][M][L]…' and the words saying what failed are hidden, exactly when the user needs them. The loading message on every first play in real mode is covered the same way, as is the first-run text ('No music yet. Try the d[S]mo, or[M] sign in…').
- **Why it matters:** Controls must never cover status or error text. A layout that overlaps elements needs a guard for every state.
- **Proposed fix:** Insert the message right after #player instead of appending it (app.js:219: box.insertBefore(m, $('vbar'))), so the size bar sits below the message. Only pull the bar up when the now-playing info has its kicker line, for example '.ts-video:has(.ts-player-msg) .ts-vbar { margin-bottom: 0 }', and the same rule for the empty state.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - msg.mjs (real mode, YouTube blocked): at 1366x768 and 1920x1080 all 5 size buttons overlap the error box, and the first line of text is under a button. At 1000x700, 2 buttons overlap.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/msg/msg-1366-600.png, .../shots/big-8000/after-play.png ('Loading the You[S]…') and .../shots/first/first-1366.png (the empty-state text under S/M/L)

### responsive-perf-10 · medium · Every like, rating or track change rebuilds all the library's indexes, and #/rescue then rebuilds the match index (a 3.6 s freeze at 4x on 8,000 songs)

- **Where:** Interaction latency: cache invalidation
- **Observed:** dirty() (app.js:134) clears idx(), the scope and the match index. changed() calls it for every like, rating and edit, and onListened (app.js:344) calls it every time a song ends or is skipped. renderNowInfo then rebuilds peopleIdx over every track for voiceLinks, and the next user of idx() rebuilds the whole index. With 8,000 songs: L (like) takes 104 ms at 1x and 288 ms at 4x (269 ms of it in the keydown handler); Next takes 128 and 184 ms. On every visit after any change, #/rescue rebuilds TS.match.index over the whole library (libIndex, app.js:4207, via rescue.js markSure/quickList). That is 327 ms at 1x and a single 3,604 ms task at 4x, with only about 50 unplayable songs.
- **Why it matters:** Frequent actions (like, next) should finish within about 100 ms. Clear only the caches that depend on what changed. Long computations should show progress and not block input.
- **Proposed fix:** Make dirty() distinguish what changed: plays, skips and ratings update counters in place and keep idx, libIx and peopleIdx; edits to artist, title or work clear the label indexes; imports and removals clear everything. Keep libIx (the match index) until a title or artist changes. On #/rescue, draw the list first and compute the 'Sure match' badges (rescue.js markSure) in requestIdleCallback chunks, with a line of progress.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/rescue.js` · **Effort:** M
- **Evidence:**
  - bigperf.mjs, 8,000 songs: key L worst event 104 ms at 1x and 288 ms at 4x (long tasks 271 and 128 ms); the bar's Next 128 and 184 ms; route #/rescue 327 ms at 1x and 3,604 ms at 4x
  - profile.mjs: a like goes toggleLike, changed, renderNowInfo, voiceLinks, peopleIdx (44 ms), plus idx 25 ms at 1x. #/rescue goes listPage (681 ms), markSure, quickList, libIndex, match.index (546 ms).
  - Raw output: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/bigperf-8000-x4.txt and .../profile-8000.txt
  - Code: app.js:133-134, 344, 658-668, 4207 and 5578-5597; rescue.js:485-540

### responsive-perf-11 · medium · Pages are kept in memory after you leave them: each 50 routes adds 6,559 detached DOM nodes and 1,427 listeners, because observers and listeners are never removed

- **Where:** Memory over a long session
- **Observed:** With the 8,000-song library, visiting 50 routes raised the heap after garbage collection from 13.9 to 19.5 MB, DOM nodes from 2,328 to 10,623 (868 in the document) and JS listeners from 350 to 2,267. After 100 routes: 21.3 MB, 18,054 nodes, 3,828 listeners. The lanes are designed to be released 30 s after they leave the page. Even after that release and a forced collection, each visit to Explore, a track or an artist still keeps about 540 nodes and 170 listeners, and each For you visit about 600 nodes. A heap snapshot shows why. stickyHeader() creates an IntersectionObserver on the persistent #main that is never disconnected. Its callback holds the page's Play button, whose click handler holds the mounted lanes, so the whole detached page stays alive. foryou.js also adds a capturing click listener to #view on every render, never removed: there were 11 after 11 visits, and all the stale handlers run on later clicks. Its engine.on('saved'/'hidden') subscriptions are only removed if those events fire.
- **Why it matters:** When a view is replaced it must clean up its observers, listeners and subscriptions; a music player stays open for hours.
- **Proposed fix:** In app.js keep a list of cleanups for the current view (var viewCleanups = []) and run and empty it in renderView() before clear(view). stickyHeader adds io.disconnect to it, and so does the settings jump observer. Destroy the page's lanes on a route change rather than waiting 30 s for their release. In foryou.js, attach the delegated click listener to the For you wrapper instead of to el (#view), or return a destroy() that removes it and calls the engine's off() functions; app.js calls it when the route changes.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/lanes.js` · **Effort:** M
- **Evidence:**
  - memory.mjs, 8,000 songs: at the start 13.9 MB, 2,328 nodes, 350 listeners; after 50 routes 19.5 MB, 10,623, 2,267; after 100 routes 21.3 MB, 18,054, 3,828
  - leak3.mjs (demo, after the lanes' 30 s release and garbage collection): kept per visit 601 nodes and 152 listeners including For you; 543 nodes and 171 listeners for Explore, track and artist alone; click listeners on #view went from 1 to 11
  - leak5.mjs, the retainer path: Window, HTMLDocument, IntersectionObserverController, IntersectionObserver, the callback's 'play' variable, the button with classes ts-btn ts-btn--primary ts-btn--lg, its click listener's 'mounted' variable, a lane, section.ts-lane[data-lane=work], section#x-lane-work
  - Code: app.js:4890-4899 (stickyHeader); app.js:3012 (the settings jump observer disconnects only when it fires); foryou.js:1339-1345 and 1375-1376

### responsive-perf-12 · medium · At 761-960 px and 1100-1180 px the queue's More button (save, share, clear) is pushed out of the panel, and the panel scrolls sideways

- **Where:** Responsive: the now-playing panel at mid widths
- **Observed:** The queue tab row holds Up next, Played, Explore, Lyrics, a spacer and ⋯, and its tabs have flex: none, so they never shrink. In the 270-300 px now panel the row is 287-310 px wide, so #btn-queue-more sits 18-25 px past the panel's edge. At 800 px only 11 of its 36 px show; at 1100 px, 18 of 36. A click at the button's centre lands on #app. Because #now-rest has overflow-y: auto, its overflow-x is auto too, so a trackpad or Shift+wheel scrolls the whole panel sideways by 18-25 px, cutting off 'Up next' and 'Playing from'.
- **Why it matters:** No control may be cut off at any supported width, and panels should not scroll sideways.
- **Proposed fix:** Let the tabs shrink or scroll while More stays where it is: .ts-tabs { min-width: 0 }, .ts-tab { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis }, #btn-queue-more { flex: none }. Alternatively, put the tabs in their own overflow-x: auto wrapper. Shorten the Explore and Lyrics labels or use icons below 1180 px, and set #now-rest { overflow-x: hidden }.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/index.html` · **Effort:** S
- **Evidence:**
  - mid.mjs: the tab row is 287 px wide in a 254 px space at 761-960 px (the More button's right edge at 778 against the panel's 753 at 761 px) and 310 in 284 at 1100 and 1180 px. It fits only at 1000 px and from 1280 px.
  - qmore.mjs: at 800 px, 11 of 36 px visible and a click at the centre hits #app. At 1100 px, 18 of 36. now-rest scrolls sideways by 25 px and 18 px.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/mid/mid-761.png (no ⋯ beside Lyrics) and .../shots/mid/qmore-800.png (the panel scrolled sideways)
  - Code: index.html:75-82; app.css:237-238 and 1069-1074

### responsive-perf-13 · medium · At 2560x1440 the page sits to the left with 552 px of empty panel, the header band ends mid-panel, and the video stays 316x210 (1.8% of the screen)

- **Where:** Responsive: large screens
- **Observed:** .ts-view has max-width: 1400px and is not centred (app.css:103). In a 1,952 px main panel the content therefore ends at x=1,652, leaving 552-576 px of empty panel on every route. The hero's coloured band and its rounded corner stop in the middle of the panel, while the demo banner spans its full width. --ts-now stays at 340 px for every width above 1180 px, so on a 2560 px screen the video is 316x210.
- **Why it matters:** On large screens, either use the space (more columns, a bigger player) or centre a bounded column. Decorative bands should span their container.
- **Proposed fix:** Either let the hero and the track tables use the whole panel and keep the 1,400 px limit for text only (.ts-lede, .ts-panel), or centre the view (.ts-view { margin-inline: auto }) and keep the hero full-bleed. Make the default player grow with the screen: @media (min-width: 1900px) { :root { --ts-now: 420px } } and @media (min-width: 2400px) { :root { --ts-now: 560px } } (a 536x302 player), while still honouring a size the user saved.
- **Files:** `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - responsive.mjs at 2560x1440: the view is 1,400 px of a 1,952 px main panel on every route; empty space on the right is 552 px (songs, artist, explore) to 576 px (artists, stats, settings, works, search)
  - wide.mjs: hero [252, 94, 1400, 242]; 552 px of empty space on the right; player 316x210 = 1.8% of the screen
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/wide-2560-hero-edge.png, .../shots/resp/2560x1440-songs.png and .../shots/resp/2560x1440-.png

### responsive-perf-14 · medium · With a big library, several pages and the songs filter block for 0.3-0.7 s on a phone-class CPU, and typing in the filter stalls

- **Where:** Interaction latency and route-change jank on a big library
- **Observed:** With 8,000 songs and 4x CPU, these pages run one long task before they appear: #/explore 712 ms, #/browse 673 ms (browseMixer runs a full S.select to count every chip), #/history 485 + 112 ms, #/search 418 ms, #/fix 215 + 329 ms, #/track 298 + 105 ms and the home page 236 + 163 ms. 'Filter these songs' redraws the whole page (setQuery, then renderView) 250 ms after each pause in typing. A keystroke takes 95-463 ms to reach the screen, with long tasks of 342, 339 and 152 ms. Sorting by Title takes 382 ms to paint, the queue's Explore tab 280 ms, and a double-click to play from the 8,000-song list 448 ms. At 1x everything stays under 165 ms except #/rescue (covered in the cache invalidation finding).
- **Why it matters:** Keep input latency under about 100 ms (Interaction to Next Paint of 200 ms or less). Show the page frame first and compute the heavy parts after the first paint. Never redraw a whole page to filter a list.
- **Proposed fix:** Filter in place: keep the trackList and call vl.set() with the filtered tracks, and update the address with replaceState only, with no setQuery or renderView. Keep a folded-title index built once per idx(). In browseMixer, count chips from per-facet sets of ids built once per idx() instead of running S.select per chip. Draw page headers at once and fill the bodies of Explore, History and Search in a setTimeout(0) or requestIdleCallback slice behind skeletons.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/explore.js` · **Effort:** M
- **Evidence:**
  - Raw output: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/bigperf-8000-x4.txt (routes and interactions at 4x) and .../bigperf-8000.txt (the same at 1x)
  - profile.mjs at 1x: #/browse spends 209 ms in browseMixer, 164 ms of it in S.select. Each filter run spends 62 ms in setQuery, renderView and L.search/foldText.
  - Code: app.js:2105 (the filter's input calls later(setQuery, 250)), app.js:2118-2129 (setQuery redraws the view), app.js:5143 (browseMixer)

### responsive-perf-15 · medium · On laptops 700-768 px tall, no queue item is visible in the now-playing panel, and list pages show only 2 or 3 rows

- **Where:** Responsive: laptop heights
- **Observed:** Before the first queue item, the now panel stacks the 210 px video, the song's details, chips, stars and actions, the tabs, 'Playing from' and the order pill. The first item therefore starts at y=613 on every window. The panel ends at 596 px at 1000x700, 616 at 1280x720 and 664 at 1366x768, so no Up next item is fully visible. 1280x800 shows one and 1440x900 three. On list pages, the hero, the Play/Shuffle row and the filter row put the first song at about y=430-470, leaving 2 or 3 full rows (in the demo; about one more without the demo banner).
- **Why it matters:** On common screen sizes, each region's main content (the list, the queue) should show without scrolling; decorative headers should give way on short screens.
- **Proposed fix:** Add @media (min-width: 761px) and (max-height: 820px): make list headers compact (.ts-hero with 12 px padding, the art at 96 px or hidden on Songs and Liked songs, a smaller title clamp), and put the filter and sort on the Play row. In the now panel, put the genre and mood chips and the actions on one line, or behind a Details toggle, so the queue starts by about y=420.
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js` · **Effort:** M
- **Evidence:**
  - queuefold.mjs, queue items / song rows fully visible: 1000x700 0/2; 1280x720 0/3; 1366x768 0/3; 1280x800 1/4; 1440x900 3/5; 1920x1080 6/8
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/responsive-perf/shots/resp/1366x768-songs.png, .../shots/resp/1000x700-songs.png and .../shots/resp/800x700-track_demo-012.png (the header fills the first screen)

### responsive-perf-16 · low · Large cover art is blown up from a small thumbnail: the 192 px header art has 47% of the pixels it needs on a high-density screen

- **Where:** Image loading: thumbnail resolution
- **Observed:** art() in ui.js always loads mqdefault.jpg (320x180) and crops it to a square, which leaves 180 source pixels. At devicePixelRatio 2, the 192 px header art on song and artist pages needs 384 px, so it has 0.47 of that; 148 px home cards have 0.61. 44 px rows are fine (2.05). Lazy loading and the coloured square placeholder and fallback work: the home page asked for 36 thumbnails, and failed images fell back to the letter square.
- **Why it matters:** Load the largest art at the size it is drawn times devicePixelRatio; keep small thumbnails light.
- **Proposed fix:** Pass a size to U.art, or check the class. For art drawn 120 px or larger, try hq720.jpg (1280x720), then sddefault.jpg, then mqdefault.jpg through onerror. If hqdefault.jpg is used, crop out its letterbox bars (object-view-box: inset(12.5% 0) or scale(1.34) inside overflow: hidden). Keep mqdefault for rows, the bar and the queue.
- **Files:** `misc/101-true-shuffle/ui.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - images.mjs (DPR 2, thumbnails served locally): the #/track header art is drawn at 192x192, needs 384 px, has 180 (ratio 0.47); the #/artist header is the same; home cards 148x148, ratio 0.61; rows 2.05; 36 thumbnail requests while the home page loads
  - Code: ui.js:437 (mqdefault.jpg at every size)

## Lens: interaction

<details><summary>What this auditor covered</summary>

- Lens: what click, double click, right click, long press, Enter, Space, Shift+F10, Tab, drag and the song keys (E, I, R, L, B) do on a song, surface by surface, and how the menus compare. All runs in the demo (?demo=1) with no network. Scripts and screenshots are in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/ (scripts *.mjs, screenshots shots/*.png).
- Desktop, 1280x860, dark: #/ (Recently added, Recently played and Waiting for you shelves; artist, work and mood cards), #/songs, #/artist/kumoristation (Songs table plus the More by and Artists like lanes), #/genre/Alt J-rock, #/track/demo-126 (header More, From your library lane), #/explore/demo-126 (anime lane with library and found songs, header More), #/for-you (all lanes loaded by scrolling: Because you play media cards, This season cards, Airing today rows), #/channel/demo-ch-paper-lanterns-topic, #/history and #/wrapped (with an invented history pushed into pageCtx.history()), #/lyrics?q= (a fake LRCLIB through TrueShuffle.lyrics.configure), #/map (dot click, double click, right click), #/list/<hand-picked> and #/list/<smart>.
- Now-playing panel: Up next, Played and Explore tabs, the info block and its More, pencil and stars, each with a library song and with a found song from a demo radio. Player bar title.
- Phone, 390x844 with mobile emulation: tap and long press on Songs rows, Explore and song-page lane rows, Home cards, channel rows and the queue sheet's Up next; taps on the sheet's Explore tab and For you rows. A long press was also replayed as the event sequence pointerdown, contextmenu, pointerup, because CDP touch input never makes Chrome fire contextmenu.
- Queue: double click on Up next and Played rows; reorder by the grip, by dragging the title, and by a 6 px nudge; arrow keys on the grip.
- Menus listed item by item: trackMenu (Songs row and the panel's More), media.js menu (library and found songs in several lanes), channel.js menu, and the header More of the song page, Explore page and playlist pages. Key hints and key scope: R, E, L and I on a focused row that is not playing.
- Keyboard: Tab stops per list (Songs table 635 presses to leave 160 songs, media lists, shelves, Up next, History), arrow keys in each list, and whether Space pauses after a song is started with the mouse in 5 ways.
- Drag and drop: which song surfaces can be dragged, and which drop targets accept (synthetic dragover carrying application/x-ts-ids on a hand-picked playlist, a smart playlist and the queue panel), plus the drag outlines.
- Not tested: a real Android device (the long-press and fling cases are inferred from code plus the replayed event sequence), real mode with a signed-in library (the 100-unit and new-tab paths were read from code and shown with canRead and play.find stubbed in the demo), the duel and rescue pages beyond code reading and the matrix, quiz, car mode, pip.

</details>

### interaction-1 · high · A found song in the now-playing panel: More throws and opens nothing, the stars report a rating they drop, the bar title opens a dead page

- **Where:** Now-playing panel and player bar, found songs (radio, Endless, Explore, For you)
- **Observed:** Endless is on by default, and a radio makes about half its songs found songs (newRatio 0.5). While one of these plays, the panel's More (three dots) throws a TypeError and no menu opens, and the pencil does nothing. Pressing a star shows 'Rated 4 of 5.', but the song is not in the library, so nothing is saved and the stars go back to empty. Clicking the bar's title opens #/track/<id>, which says 'This track is not in the library.' Only the heart works, because it keeps the song first.
- **Why it matters:** A control that is shown must work for every song it is shown for, and feedback must report what actually happened: no success toast for a rating that was thrown away.
- **Proposed fix:** In renderNowInfo (app.js:998-1005), when t.transient: make More open TS.media.menu(pageCtx, t, button) (Play next, Save for later, Not interested, Explore, Go to) instead of trackMenu; hide the pencil, or make it keep the song first. Have the stars keep the song first, as toggleLike does (engine.keep(t.id), then L.edit on lib.tracks[t.id]); otherwise disable them with the title 'Like or keep it to rate it'. Harden trackMenu: filter ids to lib.tracks and return when none are left (app.js:1360). In renderBar (app.js:798), send a transient song to Explore (TS.explore.remember(find), then '#/explore/find/' + key) instead of #/track/<id>.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/library.js` · **Effort:** S
- **Evidence:**
  - found-now.mjs: 'Neon Abacus - Night Window' (dmu01xddrrt) from a demo radio. Clicking the More in #nowinfo logged page error "Uncaught TypeError: Cannot read properties of undefined (reading 'blocked')" and no .ts-menu appeared. The pencil opened no dialog. The 4th star toasted 'Rated 4 of 5.', and lib.tracks[id] was still undefined afterwards.
  - misc1.mjs: with a found song on, clicking the bar title went to #/track/dmu001e5cfe, and the view says 'This track is not in the library.' Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/bar-title-found.png
  - app.js:1004 calls trackMenu(t) with the transient track. At app.js:1361, one = lib.tracks[id] is undefined, so the menu takes the several-songs branch, and app.js:1392 reads lib.tracks[id].blocked, which throws.
  - The stars (app.js:1012-1016) call L.edit, which returns null when the id is not in the library (library.js:685-687), and then toast success anyway. toggleLike (app.js:4712) runs engine.keep(t.id) first, which is why the heart works. renderBar (app.js:798) always links to #/track/<id>.

### interaction-2 · high · A double click on an Up next or Played row plays the wrong song and drops queued songs; a small drag on a row does the same

- **Where:** Queue panel and phone sheet: Up next and Played rows
- **Observed:** Up next and Played rows act on the first click and redraw at once. The second click of a double click (the gesture that plays a song in the Songs table) therefore lands on whichever row has moved under the pointer. In Up next that is a second jump, and every song jumped over leaves the queue with no Undo. A 6 px drag on a row's title also counts as a click and jumps. Dragging a row by its title does nothing; only the faint grip reorders.
- **Why it matters:** A gesture that is safe in one list must be safe in every list. A destructive action needs a guard or an Undo, and a redraw caused by the first click must not retarget the rest of the same gesture.
- **Proposed fix:** In renderQueue, guard both handlers (app.js:1044, 1074) with if (e.detail > 1) return, or move the jump and replay to dblclick and Enter under the shared model in the desktop finding. When a jump skips songs, show the toast 'Skipped 3 songs' with an Undo that restores them through ctl. In wireQueue (app.js:1104-1131), let the whole row start a reorder after a 5 px move and swallow the click that follows a move. Show the grip at full opacity while the row is hovered.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/app.css` · **Effort:** S
- **Evidence:**
  - queue-dbl.mjs: Up next = Late Meadow, Glass Engine, Small Current, Last Static, Quiet Staircase, Glass Lullaby... Double click on row 3, 'Small Current': the presses landed on 'Small Current', then 'Glass Lullaby'. Glass Lullaby plays. Late Meadow, Glass Engine, Last Static and Quiet Staircase are now in neither Up next nor Played.
  - queue-dbl.mjs, Played tab: double click on 'Late Meadow'. The presses landed on 'Late Meadow', then 'Glass Engine', and Glass Engine plays.
  - queue-drag.mjs (1280x1200): a 6 px drag on the title of row 4, 'Last Static', played it and dropped Late Meadow, Glass Engine and Small Current. Dragging the title onto row 1 did nothing. The grip (20x28 px, opacity 0.5, cursor grab) reordered correctly. Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/queue-rows.png
  - Code: app.js:1044 Up next click calls ctl.jump(at) and app.js:1074 Played click calls playNow, both with no e.detail guard (duel.js:564 has one: if (e.detail > 1) return). The skipped songs get no toast, while Clear queue has an Undo (app.js:1160). wireQueue starts a drag only from .ts-grip (app.js:1105-1112).

### interaction-3 · high · On a phone, tapping a song row plays it in the Songs table but does nothing in Explore, For you, song-page lanes and the sheet's Explore tab

- **Where:** Touch: song rows (media.js) vs library tables
- **Observed:** The README says a tap on a song row plays it. That holds for the library tables (play from here), channel rows and the queue sheet. Every media.js row ignores a tap on its body: only its 32 px play button responds. On the phone these rows look the same as table rows, yet tapping their title or artwork does nothing.
- **Why it matters:** On touch, one tap on a song row should mean one thing everywhere. The README's rule is that it plays.
- **Proposed fix:** In media.js row(), add a click listener on the li: if (e.pointerType === 'touch' && !e.target.closest('button, a')) { if (c === 0) pb.click(); else openRowMenu(); }. A free song plays. A song that needs a 100-unit search opens its menu instead, where Play shows the cost, so a tap never spends quota. Use click, not pointerup, so long presses and fling-stopping touches do not fire it. Do the same in lyrics.js hitRow (1057-1088): play on tap when the song is in the library.
- **Files:** `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/lyrics.js` · **Effort:** S
- **Evidence:**
  - phone.mjs (390x844, mobile): tapping a Songs row (events pointerup:touch, click:touch) replaced the queue and played that row. A channel row tap played the song now. A sheet Up next tap jumped to it.
  - phone.mjs: tapping an Explore anime-lane row did nothing, and so did tapping a song-page 'From your library' row.
  - phone-sheet.mjs: tapping 'Open Kindling' in the sheet's Explore tab did nothing, and so did tapping 'Prism Horizon' in For you's Airing today.
  - Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/phone-songs.png (rows show only the heart and More; the row is the button) vs shots/phone-track.png and shots/phone-sheet-explore.png (rows show play, play next and More; the row body does nothing).
  - Code: app.js:1280 plays on a touch pointerup on .ts-row. In media.js, only the Play button (media.js:549-555) and dblclick (media.js:573-578) play.

### interaction-4 · high · On a desktop, a single click on a song means six different things depending on the surface; double click and Enter differ too

- **Where:** Desktop: primary activation of a song on every surface
- **Observed:** There is no shared rule. A single click on a song's body selects it, does nothing, opens its page, opens Explore, plays it, or skips the queue to it, depending on where the song is. Double click and Enter split the same way. The same song on one page behaves two ways: the artist page lists 'Winter Arcade' in both its Songs table and its 'More by' lane. Hover feedback does not tell these apart: media rows light up on hover and show a text cursor over the title, yet a click does nothing.
- **Why it matters:** One gesture should have one meaning across all song lists, and hover feedback should match what a click does. The media.js comment at media.js:573 says it means to follow the library's lists; it does not.
- **Proposed fix:** Use the Songs-table model everywhere on desktop: a single click selects or focuses and never plays, skips or navigates; double click and Enter play; a touch tap plays.
- media.js row(): a click on the body focuses the row's Play and adds is-sel. Add cursor: default and user-select: none to .ts-m-row.
- app.js renderQueue (1044, 1074), viewHistory (3517) and channel.js row (473): move play or jump from click to dblclick and Enter, keeping the tap on touch.
- Cards stay links: a click opens, the play button plays.
At minimum, add the e.detail > 1 guard everywhere a single click acts. Write the model down in README 'The page'.
- **Files:** `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/channel.js`, `misc/101-true-shuffle/lyrics.js`, `misc/101-true-shuffle/wrapped.js`, `misc/101-true-shuffle/README.md` · **Effort:** M
- **Evidence:**
  - matrix.mjs and matrix2.mjs, single click on a song's body: - tables (Songs, artist, genre, search): select (SEL 0->1) - media.js lanes (Explore, song page, artist page, panel's Explore tab): nothing - Home song cards and On repeat: #/track/<id> - For you cards: #/explore/... - Up next: jump - Played, History and channel rows: play now
  - Double click: - tables: play from the row, queue replaced (ctx 'Songs', 157 items) - media rows and map dots: play now, queue kept (8->9) - Home and For you cards: navigate only - lyrics results and Your year rows: nothing - Up next and Played: the wrong song (see the queue finding)
  - Enter on each surface's first Tab stop: a table row plays from here; a media row's Play plays now; Up next jumps; a card navigates. Space on a focused table row toggles selection.
  - artist-page.mjs, 'Winter Arcade' on #/artist/kumoristation. In the Songs table: click selects, double click replaces the queue (ctx 'Kumori Station', 10 items). In 'More by Kumori Station': click does nothing, double click plays now with the queue kept. Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/artist-lane.png
  - Cursor: default over a table row; auto (text I-beam) over a media row's title; pointer over queue, History and channel rows.

### interaction-5 · high · The same play icon means 'replace the queue from here' in some places and 'play now, keep the queue' in others, and replacing has no Undo

- **Where:** What Play means: tables, media rows, cards, menus
- **Observed:** In the tables, the play icon on a row, a double click, Enter and a tap all run playFrom: they throw away what was coming up (except hand-queued songs) and play the whole list from that row. A media row's play icon and a double click on it play the song now and keep the queue. A Home song card's play button is labelled 'Play <song>' but replaces the queue with the whole shelf. A For you card's play button keeps the queue. The table's menu 'Play' plays now, which is not what a double click on the same row does. Nothing can undo a replaced queue.
- **Why it matters:** The same icon should do the same thing everywhere, the label should say what will happen, and an action that discards the queue should be reversible.
- **Proposed fix:** Decide by list, not by component.
- A list of library songs: the play icon, double click, Enter and tap all play the list from that song. Make media.js row() use mode 'from' when opts.list is set and every item costs 0, so the song-page and Explore 'Your library' lanes match the tables.
- A list with found songs: keep 'play now', because a list play could start several 100-unit searches.
- Home song cards (app.js:1861-1863): title and aria 'Play Recently added from this song'.
- Add 'Play from here' to trackMenu when it is opened from a trackList (pass ids and index).
- In playFrom, when upcoming songs are discarded, toast 'Playing <list>' with an Undo that restores items, index and context.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/wrapped.js` · **Effort:** M
- **Evidence:**
  - artist-page.mjs, same song: double click in the table → QUEUE REPLACED (ctx 'Kumori Station', 10 items); double click in the lane → PLAY NOW, queue kept (8->9).
  - card-play.mjs: the 'Recently added' card's play button, aria 'Play Electric Kindling', replaced the queue with the 18-song shelf (ctx 'Recently added'). A For you 'Because you play' card's play button played now. Your year's row play button calls ctx.play.from (wrapped.js:622); lyrics results play now (lyrics.js:1068-1072).
  - Code: trackMenu 'Play' = playNow (app.js:1364), but play(i) for a row = playFrom (app.js:1284-1287). media.js row Play = play(ctx, it, 'now') (media.js:551). trackCard = playFrom(ids, i) (app.js:1861-1863). README:170 says 'Play in a list plays the list from there'.
  - playFrom (app.js:558-569) discards the upcoming songs with no toast or Undo, while Clear queue offers Undo (app.js:1160).

### interaction-6 · high · Song menus differ by surface, and ten song surfaces have no menu at all

- **Where:** Context menus: app.js trackMenu vs media.js menu vs channel.js menu vs none
- **Observed:** The same library song gets 14 menu items in the Songs table but 6 to 8 in a lane: Start radio, Add to playlist, Edit, Rating, Block and Trim are missing there. Groups, order and headings differ between the menus. Up next, Played, History, Home song cards, For you season cards, channel rows, lyrics results, Your year rows and map dots have no app menu. Right click shows the browser's own menu there, and Shift+F10 does nothing. There is no way to add a queued, played or Home-shelf song to a playlist, or to rate it, without first opening its page.
- **Why it matters:** A song should offer the same actions, in the same order and words, wherever it appears. Right click, long press and the menu key should open the menu on every song.
- **Proposed fix:** Build one song-menu builder: media.menu for every song. For a library song (it.mine), it appends trackMenu's groups so items, order and headings are identical:
- Play: Play, Play from here, Play next, Add to queue
- Find more: Start radio, Explore, Journey, Other versions
- Keep: Add to playlist, Add to YouTube playlist, or Save for later and Not interested for found songs
- Go to: artist, work, album, channel, Song details
- Fix: Edit, Rating, Trim, Block, Find a working upload, Open on YouTube
Attach it with media.js pressMenu (right click, long press, Shift+F10) to:
- Up next and Played rows, adding Remove from queue and Play next
- History rows (app.js:3517)
- Home song cards (app.js card() 1823)
- For you season cards (foryou.js:665)
- channel rows: replace channel.js:451-461
- lyrics results and Your year rows
- the map's selected dot
- **Files:** `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/channel.js`, `misc/101-true-shuffle/explore.js`, `misc/101-true-shuffle/foryou.js`, `misc/101-true-shuffle/lyrics.js`, `misc/101-true-shuffle/wrapped.js` · **Effort:** L
- **Evidence:**
  - menus.mjs: - Songs row (trackMenu, app.js:1359-1398): 14 items in Play / Find more / Keep / Go to / Fix - song page lane row (media.js:687-747): 8 items, headed by the title, then Go to - Explore anime lane, a song you have: 6 items, with no Song details (media.js:741 requires kind 'track') and no Play from here (explore.js:211 passes no list; explore.js:302 does) - channel upload (channel.js:451-461): 5 items, flat - old Discover rows (app.js:4407-4420): a fourth, flat menu
  - Placement differs between trackMenu and media.js: - Explore: 'Find more' vs 'Go to' - Song details and Open on YouTube: 'Fix' vs 'Go to' - first heading: 'Play' vs the song title - channel item: 'Go to channel' vs 'Go to <channel>' Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/menu-songs-row.png and shots/menu-track-lane-row.png
  - matrix.mjs, matrix2.mjs and drag-map.mjs: right click left contextmenu not prevented (browser menu) on Home song cards, For you season cards, Up next, Played, History, channel rows, lyrics results, Your year rows and map dots. Shift+F10 gave 'nothing' on Home cards, Up next, Played and channel rows.
  - The play button is also styled differently on each surface: a blue primary 'Play' pill on every lyrics result (shots/m2-lyrics-hits.png, two primaries on one page), a quiet round icon on media rows, and a hover icon in the # column of tables.

### interaction-7 · high · Keyboard: Tab goes into every row of the Songs table, so it takes 635 Tab presses to get past 160 songs

- **Where:** Keyboard model of song lists (roving focus)
- **Observed:** The table means arrow keys to move between rows and Enter to play, with only one row in the Tab order. But each row's artist link, genre chip, heart and More keep tabindex 0. Tab therefore walks through 4 or 5 controls on every row, and skips the rows themselves. Pressing Enter on those stops opens the artist instead of playing. Media lists cost 3 Tab stops per song and Up next costs 3, while arrow keys do nothing in Up next, History or the shelves.
- **Why it matters:** A list should be one Tab stop, with arrow keys inside it. The app's own key list advertises this ('In a list: up down move, Enter play from there, Shift+F10 menu').
- **Proposed fix:** In trackList row() (app.js:1239-1282), set tabIndex -1 on the row's links and buttons, and 0 only in the row that has sel.focus; vl.refresh redraws rows on every move, so this is a one-line condition. Add ArrowRight and ArrowLeft in the row keydown (app.js:1309-1332) to step into those controls. In media.js list() (593-604), make only the active row's buttons tabbable, since arrows already move between rows. Give Up next, Played and History the same Up/Down roving.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js` · **Effort:** M
- **Evidence:**
  - tabwalk.mjs, starting from the focused row 0: row0 div, row0 a[Aldric Vessant], row0 a.ts-chip, row0 heart, row0 More, row1 a[Quiet Ferrymen], row1 chip, row1 heart, row1 More... 16 Tab presses covered 4 rows.
  - tabcount.mjs: 635 Tab presses to leave the Songs table, reaching row 160 (9600 px list).
  - tabstops.mjs: Explore lane with 8 songs = 24 Tab stops; Up next with 19 songs = 57; a Home shelf with 18 cards = 36. ArrowDown on an Up next row, ArrowDown on a History row and ArrowRight on a shelf card all left the focus where it was.
  - Code: app.js:1241 gives the row its tabindex (0 or -1). The links and buttons inside are left tabbable: artistLinks app.js:855, work link 1262, genre chip 1266, likeButton 4728, More 1269. Only .ts-row-play gets tabIndex -1 (1244).

### interaction-8 · medium · The song page and playlist pages fold their own More into 'More actions': a one-item menu that opens the real menu at the window's top-left and loses focus

- **Where:** Page header menus (song page, playlist pages)
- **Observed:** headerBlock shows three actions and folds the rest into More actions. The song page and both kinds of playlist page pass their own More button as an extra action, so it gets folded. More actions then shows a single item, 'More'. Choosing it clicks a button that is no longer in the page: the real menu opens at (8, 4), over the brand and sidebar, and Escape leaves the focus on body. Rename and Delete playlist are reached this way, and Delete has no confirmation or Undo. On the Explore page, More holds only 'Song details', unlike the song page.
- **Why it matters:** A menu opens next to the control that opened it and returns focus there. One press should reach the page's actions, not a menu containing a single 'More'.
- **Proposed fix:** Give headerBlock a dedicated menu slot that is drawn after the three actions and never folded, and use it in viewTrack (app.js:2517) and viewList (app.js:3450). Alternatively, have moreActions (app.js:1778-1788) inline a menu button's items instead of clicking a detached node. Anchor the menu to the visible More button with returnTo set to it. Add an Undo toast to Delete playlist.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/ui.js` · **Effort:** S
- **Evidence:**
  - nested-more.mjs: - #/track/demo-126: header Play, Start radio, Edit details, More actions → ['More'] → a 15-item menu at (8,4) - #/list/<hand-picked>: More actions → ['More'] → Rename…, Edit every song…, Delete playlist at (8,4) - #/list/<smart>: More actions → ['Edit filter', 'More'] - #/explore/demo-126: More actions → ['Song details']
  - track-more.mjs: focus after Escape is BODY. Screenshots: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/track-more-1.png, shots/track-more-2.png, shots/nested-more-list.png
  - Code: - app.js:2517 and app.js:3450 pass U.iconBtn('more') as an extra action - headerBlock keeps 3 (app.js:1770-1771) - moreActions calls main.click() on the folded node (app.js:1784) - trackMenu reads at.getBoundingClientRect() of the detached button (app.js:1362, 1397), and ui.js:314-321 places the menu at the clamped 8,4 - Delete playlist: app.js:3455, say() only

### interaction-9 · medium · After starting a song with the mouse, Space does not pause it

- **Where:** Space key vs focused song controls
- **Observed:** Space is advertised as play or pause, the second shortcut in the list. After starting a song with the mouse, the focus stays on what was clicked. In a table, Space then toggles that row's selection. On a lane's play button, a card's play button or a channel row, Space presses the same play again, which does nothing. In 4 of 4 ways of starting a song, the next Space did not pause.
- **Why it matters:** In a media player, the play/pause key should work right after the most common action. A row's focus should not take that key over without a visible sign.
- **Proposed fix:** In wireKeys (app.js:5702), treat Space as togglePlay when the focus is on a song's own play control (.ts-m-play, .ts-bigplay, .ts-ch-main, .ts-q-main, .ts-row-play); Enter still activates them. In trackList, move the selection toggle to Ctrl+Space (Explorer convention; Spotify keeps Space as play/pause in lists), and update the KEYMAP 'In a list' text in actions.js:91.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/actions.js` · **Effort:** S
- **Evidence:**
  - space.mjs: - double click a Songs row: focus DIV.ts-row; Space left the player playing and changed the selection 1->0 - song page lane Play: focus BUTTON.ts-btn; Space, still playing - Home card play: focus BUTTON.ts-bigplay; Space, still playing - channel row: focus BUTTON.ts-ch-main; Space, still playing - only after using the bar's own button did Space pause
  - Code: wireKeys returns for BUTTON, A and SUMMARY targets (app.js:5702). The trackList row handles Space as select and stops propagation (app.js:1320). actions.js:28 and KEYMAP advertise 'Space: Play or pause'.

### interaction-10 · medium · A double click anywhere on a found song's row runs its paid Play: a 100-unit search, or a YouTube tab when signed out

- **Where:** media.js rows of found songs: double click
- **Observed:** The row's Play button carries the cost badge ('Play 100'). But a double click anywhere on the row's text calls pb.click(), so selecting or 'opening' a row starts the YouTube search. Signed out, the same path opens a YouTube search in a new tab. The double click also selects the word under the pointer.
- **Why it matters:** A cost should be spent only by pressing the control that shows it. A row-wide gesture must not trigger a paid action.
- **Proposed fix:** In media.js row() (573-578), call pb.click() only when c === 0. For a paid row, focus pb so its cost is visible. Stop the text selection with a mousedown handler that calls preventDefault() when e.detail > 1, or with user-select: none on .ts-m-text on desktop.
- **Files:** `misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - dbl-cost.mjs (demo with canRead and the estimate stubbed to the owner's signed-in state, play.find recorded): row 'Kazemachi Ticket' shows Play with badge 100 and the title 'Find it on YouTube and play it here (uses 100 of today's YouTube units)'. A double click on its text recorded play.find(Kazemachi Ticket, now) and selected 'Kazemachi '. Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/dbl-cost-row.png
  - misc1.mjs: a double click on a library song's media row selected 'Winter ' (shots/dbl-select-media-row.png). Table rows select nothing (user-select: none).
  - Code: media.js:573-578, the dblclick handler calls pb.click() whatever the cost. With no key or sign-in, app.js:4361-4365 then opens youtube.com/results in a new tab. README's terms: a search 'runs only on a press, shown by cost badges'.

### interaction-11 · medium · Menu shortcut hints point at the playing song, and E, R, L and I have different targets in different lists

- **Where:** Single-letter song keys and menu hints
- **Observed:** Song menus show global key hints next to items about another song. The table's menu for a song that is not playing shows 'Start radio R', yet R starts a radio from the playing song and replaces the queue. Media menus show 'Save for later B' and 'Explore E', yet both keys act on the playing song. In a table, E and I act on the focused row but R and L act on the playing song. In a media list, E explores the playing song.
- **Why it matters:** A hint is a promise that the key does this item, here. The same key should target the same song (the focused one, else the playing one) in every list.
- **Proposed fix:** Make song keys target the focused song row when the focus is in a song list, and the playing song otherwise, in both kinds of list. Add R, L and B to the trackList keydown (app.js:1309-1332), and add a keydown in media.js list() (593) that resolves the row's item for E, R, L and B. Until then, pass hint: '' for radio, save, like and explore items in song menus whose song is not the one playing.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js`, `misc/101-true-shuffle/actions.js` · **Effort:** S
- **Evidence:**
  - misc1.mjs, with 'Velvet Compass' playing and Songs row 'Hidden Current' focused: - R: queue became 'Radio: Velvet Compass' - L: Velvet Compass went from 0 to 5 stars; Hidden Current stayed at 3 - E: #/explore/<focused row> - E on a focused song-page lane row ('Crooked Weather'): #/explore/demo-139, the playing song
  - misc1.mjs: trackMenu hints for 'Hidden Current' (not playing) are Start radio [R], Explore [E], Edit details… [I]. matrix.mjs: media menus show 'Save for laterB' and 'ExploreE'.
  - Code: - actions.js:97-102: item() shows the vocabulary key as the hint by default - trackMenu: app.js:1370-1371, 1388 - media.menu: media.js:708, 740 - keys: app.js:5709 (R), 5710 (L), 5718 (E), 5720 (B) act on ctl.current() - trackList intercepts only I and E (app.js:1322-1323); media.js list() has no key handler

### interaction-12 · medium · On a phone, a long press on a Songs-table row opens its menu and then plays from that row on release, replacing the queue (likely; replayed, not tried on a device)

- **Where:** Touch: long press on library table rows
- **Observed:** On Chrome for Android, a long press sends pointerdown, then contextmenu, then the finger's pointerup. The table opens its menu on contextmenu, then plays the list from that row on any touch pointerup. So the long press used to reach 'Add to playlist' would also replace the queue. media.js rows already guard against exactly this.
- **Why it matters:** A long press is for the menu. Releasing the finger must not also run the tap action.
- **Proposed fix:** In trackList row(), move the touch play from pointerup into the existing click handler (app.js:1270-1274: if (e.pointerType === 'touch') { play(i); return; }). Chrome sends no click after a long press or after a touch that stops a fling. Alternatively reuse media.js pressMenu's 800 ms AGAIN_MS guard. Then check it on the Android phone.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - longpress-synth.mjs (390x844 mobile) replayed pointerdown, contextmenu, pointerup (pointerType touch). Songs row: MENU (19 items) and QUEUE REPLACED (ctx 'Songs', 157 items, the row playing). Media row: MENU only.
  - phone.mjs: CDP touch input never makes headless Chrome fire contextmenu, so a long press there plays like a tap. The device case is therefore inferred, not observed.
  - Code: app.js:1279 opens trackMenu on contextmenu. app.js:1280 plays on every touch pointerup with no long-press guard. media.js:475 guards it: 'the finger that ends a long press does not also press the button under it'.

### interaction-13 · medium · The 'playing' mark on media rows never updates: it stays on a song that has stopped and is missing on the one that started

- **Where:** Now-playing indication in lists
- **Observed:** Table rows move their animated playing mark live. Media rows get is-now only when they are drawn. Playing a lane song marks nothing. After a redraw the mark appears, and after Next it stays on the old song.
- **Why it matters:** Status shown in a list must follow reality, and should do so in every list.
- **Proposed fix:** Extend markPlaying (app.js:1211-1218) to toggle is-now on .ts-m-row and .ts-m-card by data-id. In media.js row() and card(), add data-mine (the library copy's id) so a found song with a library copy matches too. afterQueueChange already calls markPlaying.
- **Files:** `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - nowmark.mjs, #/track/demo-126 lane: - double click 'Crooked Weather' (it plays): marked [] - Play on 'Electric Tide' (it plays): marked [] - redraw the page: marked ['Electric Tide'] - Next (now 'Paper Crossing'): still marked ['Electric Tide'] The Songs table moved its mark from 'Paper Parade' to 'Electric Kindling' live.
  - Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/nowmark-stale.png ('Electric Tide' in accent while 'Paper Crossing' plays).
  - Code: markPlaying (app.js:1211-1218) only touches .ts-row; media.js:494 sets is-now once, at render time.

### interaction-14 · low · Drag and drop: only table rows can be dragged, smart playlists light up as targets but refuse the drop, and queued songs can't be dragged anywhere

- **Where:** Drag and drop of songs
- **Observed:** While a table row is dragged, every sidebar playlist gets the dashed 'drop here' outline, including smart playlists, which refuse the drop. Media rows, cards, History, Played and Up next rows cannot be dragged onto the queue or a playlist. Up next reorders only by its grip; a title drag does nothing or jumps (see the queue finding).
- **Why it matters:** A highlighted target should accept the drop, and any song that can be shown should be draggable to the same targets.
- **Proposed fix:** Add data-kind to stations in renderStations (app.js:738) and outline only body.is-dragging .ts-station[data-kind=manual] (app.css:705). Give media.js rows of library songs (it.mine) and Up next, Played and History rows draggable plus a dragstart that sets application/x-ts-ids, as trackList does (app.js:1277).
- **Files:** `misc/101-true-shuffle/app.css`, `misc/101-true-shuffle/app.js`, `misc/101-true-shuffle/media.js` · **Effort:** S
- **Evidence:**
  - drag-shot.mjs: after dragstart on a table row, body gets is-dragging. 'Hand picked' (hand-picked) accepts a dragover (outline solid). 'Bright songs (smart)' refuses but shows the same dashed outline. Screenshot: C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/interaction/shots/drag-outlines-stations.png
  - drag-map.mjs: draggable is true on .ts-row, false on .ts-m-row and on Up next rows. Home card anchors are draggable only as links, carrying no application/x-ts-ids. #now accepts the drop.
  - Code: app.css:705 outlines every .ts-station; renderStations attaches dropTarget only for kind 'manual' (app.js:739); dragstart exists only in trackList (app.js:1276-1278).

## Lens: keyboard-power

<details><summary>What this auditor covered</summary>

- Desktop 1280x860, dark theme, headless Chrome via scripts/qa/drive.mjs; demo (?demo=1) plus ?demo=1&speed=50 so songs end by themselves; real mode first run (empty library) with www.googleapis.com, youtube.googleapis.com, oauth2.googleapis.com and accounts.google.com blocked (no external host was contacted, no page errors in any run)
- Routes: #/, #/search?q=, #/songs, #/artist/paperlanterns, #/explore/demo-011, #/for-you, #/genres, #/genre/Jazz arrangement, #/settings (jump chips), #/duel, #/track/demo-011, #/lists, #/history, a new #/list/<id>
- Journey: search and Play next = 53 keystrokes (1 '/', 17 typing, 32 Tab, Shift+F10, ArrowDown, Enter). Open the artist from the row: 1 Tab + Enter. Back with Alt+Left. Rate from the row menu: 16 keys. New playlist: 19 keys. Existing playlist: 9 keys. Explore with E and play a found song: 13 Tabs + Enter. Shuffle a genre through the palette: 9 keys. Change the order with O. Settings > Playback > Fade between songs: about 20 keys. Rank with 1, ArrowRight, S and Backspace
- Focus after: 8 menus (track, rating, add to playlist, O order, bar More, Focus, queue More, versions), dialogs (?, Trim and volume, album, editor, palette, new playlist, kit Help), list re-render (like, rate, edit), route change and Back, a song change (programmatic and natural), queue buttons, the panel's Explore tab
- The ? shortcuts dialog, the kit Help text, every tooltip that names a key, the row menu's key hints
- Whether shortcuts fire while typing (search box, palette, editor fields) and on non-text inputs (volume and seek sliders, Settings checkboxes); every shortcut with an empty library (real mode)
- Command palette: empty state, 60 name probes, Shift+Enter on a song, its ARIA, Like and Start radio on a found song
- Escape in the search box, menus, dialogs, the palette and a list selection
- Tab-stop counts per region: Songs list (635 Tabs), Home, For you, Explore, artist and track pages, now-playing panel (144), sidebar (24), header (8), bar (13); Explore, For you and Settings jump chips; Shift+F10 menu placement
- Screenshots in C:/Users/jackl/AppData/Local/Temp/claude/c--Users-jackl-Documents-nietztein-github-io/ab3e0049-44ce-4906-b74c-c3b446cf5620/scratchpad/ux/audit/keyboard-power/shots/ (j1-j17). Scripts j1-j20 are in the same folder
- Not covered: phone or tablet with a hardware keyboard, car mode, the mini player window's own keys, the map, the quiz, the lyrics and karaoke page keys, actual screen-reader speech (only DOM and ARIA attributes were checked), the light theme

</details>

### keyboard-power-1 · high · Choosing a menu item drops keyboard focus to the page body (Rating, Add to playlist, O order, bar More, Focus, Sleep, Speed)

- **Where:** Focus management: menus
- **Observed:** Menus opened without an explicit returnTo lose focus when an item is chosen. Focus lands on BODY, and because the menu sat at the end of <body>, the next Tab goes to the 'True Shuffle' brand link at the top of the document. Shift+F10 then opens nothing, because no row has focus. This affects the Rating and Add-to-playlist submenus of every song, the shuffle-order menu (O and the bar pill), the bar's More menu, the Focus menu, and the Sleep timer and Playback speed menus. Escape restores focus correctly. Only choosing an item breaks it.
- **Why it matters:** After a menu command, focus goes back to the control that opened the menu (WAI-ARIA APG menu button). A keyboard user must never be sent back to the top of the document.
- **Proposed fix:** In ui.js openMenu, compute the return target once: var ret = opts.returnTo || (at && at.nodeType ? at : document.activeElement). Use menuReturn = ret in the item click handler at line 297. Keep outside() setting null only for pointer dismissals. For submenus opened from a menu item (ratingMenu app.js:1465, addToList app.js:3348, sleepMenu, speedMenu), pass the original row or anchor as returnTo.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js:297`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js:311`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1465`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:3348`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4596`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4178` · **Effort:** S
- **Evidence:**
  - j2-row.mjs: row Shift+F10 > Rating... > 4 gave the toast 'Rated 4 of 5.' and left focus on BODY. Add to playlist > 'Road trip' gave 'Already in Road trip' and left focus on BODY
  - j3-menus.mjs: O, then pick an item: focus went to BODY (it started on the 'String Quartet No. 2' row). Bar More > Repeat: focus went to BODY
  - j7-settings.mjs: after O > first order, and after Rating > 4, the next Tab went to header a.ts-brand-link 'True Shuffle', and Shift+F10 opened no menu
  - ui.js:297: the item click sets menuReturn = opts.returnTo || null, which throws away the fallback computed at ui.js:311 (opts.returnTo || anchor || document.activeElement). The track menu (app.js:1397), media.js:746 and the queue More menu (app.js:1158) pass returnTo and work

### keyboard-power-2 · high · Dialogs open without taking focus, so Escape cannot close the ? shortcuts list, Trim and volume or the album dialogs

- **Where:** Dialogs / shortcut discoverability
- **Observed:** U.openDialog never moves focus into the dialog, and it listens for Escape and Tab only on the dialog box. When the caller does not focus something inside, focus stays on the page underneath. This happens for Keyboard shortcuts (the ? key and More > Keyboard shortcuts), Trim and volume, the album dialogs (app.js and explore.js), Map with a language model, and Restore this backup. Escape does nothing, even pressed twice. Every app shortcut is blocked because a dialog counts as open. Tab walks through the song row behind the backdrop. The way out is 41 Shift+Tabs from a Songs row, or 291 Tabs from the Home title, to reach the dialog. The ? dialog is where keyboard users learn the keys, so their first contact with it is a trap. The kit's own Help dialog (the header ? button) handles this correctly.
- **Why it matters:** A modal dialog moves focus inside when it opens, keeps Tab inside, closes on Escape wherever focus is, and returns focus to the opener (APG dialog pattern; WCAG 2.1.2, 2.4.3).
- **Proposed fix:** In ui.js openDialog, after the caller has filled the body (queueMicrotask or setTimeout 0): if !box.contains(document.activeElement), focus the first focusable element in the body, else the Close button. While this dialog is the top entry of `dialogs`, register the Escape/Tab handler on document in the capture phase, as kit.js does. Set inert on #app and .kit-header while it is open. The shortcuts dialog then needs no special code.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js:332-366`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4856`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1400`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5019`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/explore.js:333` · **Effort:** S
- **Evidence:**
  - j3-menus.mjs: '?' on a focused row opened 'Keyboard shortcuts' with focusInside false. Escape: still open. Escape again: still open. Tab x4 went to the row's artist link, genre chip, Like and More, all behind the modal
  - j20-escape.mjs: 41 Shift+Tab presses from the row before focus entered the dialog (Escape then closed it). 291 Tab presses from the Home title
  - j10-help.mjs: the Trim and volume dialog had focusInside false and Escape left it open. The Explore album dialog 'Weightless Stations' had focusInside false and Escape left it open
  - Screenshot shots/j3-shortcuts.png: the dialog is drawn over the page with no focus ring inside it
  - ui.js:332-366: no initial focus, and the keydown handler is bound to the box at :353. app.js:4856-4862 showShortcuts, app.js:1400 trimDialog, app.js:5019, explore.js:333, app.js:4042 and app.js:4916 never call focus(). kit.js:849-866 uses a window-level capture listener instead

### keyboard-power-3 · high · Every song change wipes keyboard focus in the queue, the now-playing panel and the bar title

- **Where:** Focus management: queue and now playing
- **Observed:** renderQueue, renderNowInfo and renderBar clear and rebuild their DOM on every queue change, and none of them restores focus. When a song ends while focus is on a queue item, a grip (in the middle of a reorder), the panel's Edit button or stars, the bar title, or anything in the panel's Explore tab, focus falls to BODY. The user's next arrow key does nothing. The queue's own buttons drop focus the same way when pressed: the x (Remove), a song to play now, a Played song. Only the grip's Arrow and Delete path keeps focus (focusGrip). The Explore tab's guard against rebuilding under the pointer checks :hover only, so it rebuilds under keyboard focus without showing its 'Now playing changed' pill.
- **Why it matters:** Content that updates by itself must not destroy the keyboard focus (WCAG 2.4.3, 3.2.1). The queue is the core of a music player and must stay operable while music plays.
- **Proposed fix:** Add a helper, for example U.keepFocus(container, render). Before clear(), record the focused element inside the container: its data-id plus its kind (grip, main, x, star index, or the button's label). After the rebuild, focus the matching element, or its neighbour at the same index when the song left the queue. Use it in renderQueue, renderNowInfo and renderBar. In explore.js panel line 590, treat box.contains(document.activeElement) like hover and show the pill.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:967`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1028`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1044`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1048`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:792`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/explore.js:590` · **Effort:** M
- **Evidence:**
  - j19-autoadvance.mjs (?demo=1&speed=50): focus on the 'Move Quiet Staircase' grip; the song ended by itself after 5,249 ms and focus went to BODY. The next ArrowUp did nothing
  - j11-advance.mjs (ctl.next()): a queue item, a grip, the panel's Edit button, panel star 2 and the bar title all ended on BODY. A song row in the view and the bar heart kept focus. A button in the Explore tab ended on BODY, and no pill was shown
  - j8-regions.mjs: Enter on 'Remove Small Current from the queue', on a queue song (play now) and on a Played song each ended on BODY. ArrowDown and Delete on a grip kept focus
  - app.js:967-1007 renderNowInfo calls clear(box). app.js:1028-1084 renderQueue calls clear(list) (handlers at :1044, :1048, :1074). app.js:792-812 renderBar calls clear(box). explore.js:590 guards only with box.matches(':hover')

### keyboard-power-4 · high · On a focused row, L, R and B act on the playing song without saying so, while the row's menu shows R next to that row's Start radio

- **Where:** Shortcut model / data integrity
- **Observed:** In a list, E and I act on the focused row because the row handler takes them. L (like), R (start radio) and B (save for later) fall through to the global handler and act on the playing song. The row's own menu shows 'Start radio  R' next to the row's song, so pressing R on the row looks right. Instead it starts a radio of a different song, which clears the upcoming queue (startFeeder calls clearUpcoming) with no Undo. L likes the playing song while the toast says only 'Added to Liked songs.', with no title, so the user believes the focused row was liked. On Explore and For you rows (media.js), even E explores the playing song rather than the focused one.
- **Why it matters:** A key acts on what has focus, or the place that teaches it says which song it acts on. The same key must not mean 'this row' in one place and 'the playing song' in another. Destructive actions need Undo.
- **Proposed fix:** In trackList's row keydown (app.js:1309), handle L (toggleLike(tracks[i])), R (startRadio(tracks[i])) and B for the focused row. Do the same in media.js row and card keydown (E explores that item; L and R too). Name the song in toggleLike's toast ('Liked Small Current'). Give Start radio a toast with Undo that restores the previous upcoming items. Until the row keys exist, pass hint: '' for radio in trackMenu so the menu stops advertising R.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1309-1332`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5708-5720`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4719`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4316`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/actions.js:101`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/media.js:570` · **Effort:** M
- **Evidence:**
  - j4-dense.mjs: focused row demo-005 'Small Current' while demo-002 played. L changed demo-002's rating from 0 to 5 and left demo-005 unchanged. Toast: 'Added to Liked songs.'
  - j14-rowkeys.mjs: the row menu for demo-140 shows 'Start radio R', 'Explore E' and 'Edit details... I'. R on that row set the context to 'Radio: Blue Letters', the playing song. Screenshot shots/j1-row-menu.png shows the R hint
  - j9-explore.mjs: focused found row 'Small Current' in Explore; E went to #/explore/demo-002, the playing song
  - app.js:1309-1332: the row keydown handles only E, I, Enter, Space and the menu keys. app.js:5708-5720: R, L and B use ctl.current(). actions.js:101: the menu hint comes from VOCAB.key whatever the context. app.js:4316: a radio clears what was coming. media.js:570-572: the row handles only the menu key

### keyboard-power-5 · high · Search has no keyboard path from the box to its results: 32 Tabs through the header and sidebar, no skip link

- **Where:** Search / bypass blocks
- **Observed:** '/' focuses the search box and results appear as you type, but ArrowDown and Enter in the box do nothing. The only way to the results is Tab through the header tools, all 24 sidebar stops (one more per playlist in a real library), the legal links and the demo banner. There is no skip link. Finding a song and playing it next took 53 keystrokes, 32 of them Tabs.
- **Why it matters:** Make the common path the short one. A search box should hand the keyboard to its results, and every page needs a way to bypass repeated blocks (WCAG 2.4.1).
- **Proposed fix:** In wireShell, add a keydown on #search: ArrowDown, or Enter once the debounced render has run, focuses the first result in #view (the top card if there is one, else the first .ts-row through its roving tabindex). Escape from a result row returns to #search. Add a 'Skip to content' link as the first child of body, hidden until it has focus, that focuses #main (it already has tabindex=-1).
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5736-5745`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html:19`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:2003-2039` · **Effort:** S
- **Evidence:**
  - j1-search.mjs: '/' then 'Electric Rooftops' gave #/search?q=Electric%20Rooftops. ArrowDown and Enter both left focus in #search. 32 Tabs to the first song row: kit-theme, kit-help, kit-back, 21 nav links, 'make or pick a playlist', Terms, Privacy, 'Leave the demo', Shuffle these, Focus, Save as playlist, then the row
  - j1-search.mjs: search plus Play next = 53 keystrokes (1 '/', 17 typing, 32 Tab, Shift+F10, ArrowDown, Enter)
  - j4-dense.mjs: 29 Tabs from the search box to the first control on #/songs; 0 skip links on the page
  - Screenshot shots/j1-search-typed.png
  - app.js:5736-5745: #search has only input, focus and submit listeners. index.html:19-53: header, then #side, then #main, with no skip link

### keyboard-power-6 · high · Dense lists are not one Tab stop: 635 Tabs to get past Songs, 144 stops in the now-playing panel, no way to jump between regions

- **Where:** Tab order on dense pages
- **Observed:** Track rows use a roving tabindex, but each row's artist link, work link, genre chip, heart and More button stay in the Tab order, so the roving row saves nothing. On the Songs page (160 songs) it takes 635 Tabs to leave the list, about two minutes at five presses a second. The selection bar, appended after the list, is effectively out of Tab reach. media.js lists (Explore, For you) put every row's Play, Play next and More in the Tab order, 3 per row; the arrows only move between rows. The queue has 3 stops per song (39 songs give 117). Nothing jumps between regions: no skip links, F6 does nothing, and Q shows or hides the queue without focusing it. Reaching the queue or the bar from a list means walking through everything in between.
- **Why it matters:** A composite widget (list, grid, toolbar) is one Tab stop with arrow keys inside it (APG grid and listbox). Landmarks or skip links let keyboard users move between regions.
- **Proposed fix:** Make the track list an APG grid: in row(), set tabindex=-1 on every link and button inside .ts-row; Left and Right move between a row's cells and controls; Enter activates the focused cell. In media.js list(), rove across rows so only the focused row's Play has tabindex 0, with Left and Right among Play, Play next and More. Rove across the queue too, with Alt+Up and Alt+Down for the grip. Add region keys: F6 and Shift+F6 cycle header, sections, main, now panel and bar. Add a 'Skip to the queue' link, and let Q on a desktop also focus the first queue item when it opens the queue.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1239-1332`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/media.js:583-606`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1038-1050`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5706`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html:37-130` · **Effort:** M
- **Evidence:**
  - j4-dense.mjs: from the first Songs row, 635 Tabs to leave the list (all 160 rows passed), landing on #now-resizer. Each row's inner stops: the artist link ('Aldric Vessant'), the genre chip, Like, More
  - j15-stops.mjs, focusable stops: header 8, sidebar 24, now panel 144, bar 13. In the view: Home 229, For you 253, Explore 97, artist page 94, track page 64
  - j8-regions.mjs: 147 Tabs from the start of the now panel to the bar's Play button. F6 left focus unchanged. Q hid and showed the queue with focus still on the row
  - app.js:1241-1269: the row tabindex roves, but inner <a> and <button> elements keep tabIndex 0; only .ts-row-play gets -1 (:1244). Also media.js:530-565 and app.js:1041-1048. lyrics.js:770-783 already uses a proper roving list

### keyboard-power-7 · high · Shortcuts go dead whenever a slider, checkbox or select has focus (Space will not pause after you set the volume)

- **Where:** Global shortcuts
- **Observed:** wireKeys returns for any INPUT or SELECT target, including range sliders and checkboxes that never take text. After a mouse user drags the volume slider or the seek bar, Space no longer pauses, N and P do not skip, M does not mute and '/' does not reach the search box, all without feedback. The same happens after toggling any Settings switch.
- **Why it matters:** Single-key shortcuts should pause only where they would type text (WCAG 2.1.4 concerns text entry). A control that does not use a key should not swallow it.
- **Proposed fix:** In wireKeys, replace the tag test with a 'typing target' test: textarea, contenteditable, or an input of type text, search, email, url, number, password or tel that is not readonly. A range input keeps its own keys (arrows, Home, End, PageUp, PageDown) and passes Space, letters, '/', '?', '-' and '=' through. A checkbox or radio keeps Space. A select keeps the arrows and letters.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5697-5698` · **Effort:** S
- **Evidence:**
  - j4-dense.mjs: after a click on #vol, Space left the player playing, N left demo-002 playing and M left muted false. After a click on #seek, Space left it playing
  - j4-dense.mjs: '/' with the seek bar focused did not move focus to #search. The typed 'lantern' went nowhere and the hash stayed #/songs
  - j6-genre-settings-duel.mjs: N with the 'Fade between songs' checkbox focused left the song unchanged
  - app.js:5697-5698: if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) ...) return;

### keyboard-power-8 · high · The toast's Undo is out of keyboard reach and fades out even while it has focus

- **Where:** Undo / recovery
- **Observed:** Undo for Like, Block, Clear queue, Remove from playlist, Not interested, Set stars and Rescue exists only in the toast, which is appended at the end of <body>. From a song row it takes 36 Shift+Tabs to reach it; forward Tab never got there in 400 presses on #/songs. The toast hides after 7 s and does not pause for focus or hover. It went to opacity 0 while its Undo button still had focus, leaving an invisible focused control. There is no Ctrl+Z or other key for 'undo the last action'.
- **Why it matters:** Recovery must work by keyboard within the time it is offered. Time limits pause while the user is interacting (WCAG 2.2.1), and an invisible element must not keep focus.
- **Proposed fix:** Keep the last undoable action in app state and bind Ctrl+Z (Cmd+Z on a Mac) outside text fields to it. For keyboard users, say 'Ctrl+Z to undo' in the toast. In ui.js toast(), clear the timer on focusin and pointerenter and restart it on focusout and pointerleave. Optionally add a key (for example Alt+U) that focuses the toast's button.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js:506-516`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4719`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1477`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1160` · **Effort:** S
- **Evidence:**
  - j3-menus.mjs: L on a row showed 'Added to Liked songs. Undo'. Tab x400 never reached it. Shift+Tab from the row: 36 presses. The toast lasts 7,000 ms
  - j16-misc.mjs: with Undo focused, 7.6 s later the toast was {on:false, opacity:'0'} and the button still had focus
  - ui.js:506-516: setTimeout(hide, 7000) is never cleared on focus or hover, and there is no keyboard route to the toast

### keyboard-power-9 · medium · The palette is not a full launcher, and a song found in it can only 'play now'

- **Where:** Command palette: reach
- **Observed:** Ctrl+K reaches 21 pages and about 20 actions. These probes found nothing: 'car mode', 'rescue', 'people', 'duel', 'sleep', 'repeat', 'previous', 'shuffle again', 'volume', 'add to playlist', 'clear queue', 'speed', 'endless', 'edit', 'save for later', 'import', 'backup', 'help', 'journey', 'cover art', 'media keys'. People, Rescue and Car mode are not in NAV, and no Settings switch can be reached. A song result only runs playNow: Enter and Shift+Enter both interrupt the current song. There is no Play next, Add to queue, Go to artist or Song details from the palette, so the fastest finder cannot queue a song. The empty palette shows 14 actions and no pages, and one of them is 'Leave focus (not focused)'.
- **Why it matters:** A command palette is worth having when it reaches every command and destination by name. Result rows need secondary actions on modifier keys (the Spotify and VS Code pattern).
- **Proposed fix:** Build the palette's actions from actions.js VOCAB, each with a run function for the playing song: Previous, Shuffle again, Repeat, Edit, Save for later, Rate 1-5, Add to playlist..., Sleep timer..., Speed..., Trim..., Endless, Clear queue, Go to the playing song's artist and work. Add the pages People, Rescue, Car mode, Sign in / Import and Back up, and each Settings section and switch (go to #/settings and focus that row). For Song and Artist rows: Enter plays now, Shift+Enter plays next, Alt+Enter adds to the queue, Ctrl+Enter opens its page. Show these keys in a footer line.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4767-4855`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:673-697`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/actions.js:24-84` · **Effort:** M
- **Evidence:**
  - j5-palette.mjs: of 60 probes, the ones listed above returned NOTHING. 'car' returned the 'Acoustic arrangement' genre, 'Change the shuffle order', 'Switch light or dark' and 'Quick labeller'
  - j1-search.mjs: palette 'Electric Rooftops' gave one Song entry. Shift+Enter replaced the current song (demo-002 to demo-011), and Play next was not possible
  - j13-real.mjs (real mode, empty library): 'sign' gave 'Start radio from the playing song' and 'Lyrics of the playing song', with no Sign in or Import entry
  - app.js:4767-4820 (paletteEntries and ACTIONS); :4792 run: playNow; NAV at app.js:673-697 has no people, rescue or car

### keyboard-power-10 · medium · Palette top hits can be the wrong command, Like and Start radio silently fail on found songs, and the highlighted row is not announced

- **Where:** Command palette: correctness and a11y
- **Observed:** Matching falls back to a loose subsequence (any 3 or more letters in order), and Enter runs the first entry. So a word the palette does not know runs an unrelated command. 'rating' returns only 'Start radio from the playing song', which clears the upcoming queue with no Undo. 'trim' and 'stats' put Start radio first, 'export' gives Explore and 'theme' gives Theater mode. 'Like the playing song' and 'Start radio from the playing song' look the song up in lib.tracks, so for a found song they do nothing and say nothing, while the L key (which uses trackOf) works. The input has no role=combobox, aria-expanded or aria-activedescendant, and the options have no ids, so the row highlighted with the arrow keys is not announced.
- **Why it matters:** Enter should never run a command the user did not name; when nothing matches well, the palette should say so. An action must do the same thing from a key and from the palette. A combobox with a listbox needs aria-activedescendant (APG combobox).
- **Proposed fix:** Drop the subsequence tier for Action entries (or require a score of at least 20 for them) and show 'Nothing matches' instead of a weak action. Use trackOf (and the L key's keep path) for the actions at :4805 and :4807. Give the input role=combobox, aria-expanded=true and aria-autocomplete=list, give each li an id, and update aria-activedescendant in mark().
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4776-4778`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4805`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4807`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4825-4846` · **Effort:** S
- **Evidence:**
  - j5-palette.mjs: 'rating' returned only 'Action: Start radio from the playing song'. 'trim' returned Start radio, then The Velvet Algorithms. 'export' returned 'Explore the playing song (E)'
  - j12-found.mjs: found song 'Lantern Garden' playing (transient). Palette Like: no new toast, still not in the library. Palette Start radio: queue unchanged. L key: 'Added to Liked songs.', kept, rating 5
  - j5-palette.mjs ARIA: {role:null, activedesc:null, expanded:null, controls:'ts-pal-list', optionIds:0}
  - app.js:4776-4778 (subsequence score 5); :4805 and :4807 (lib.tracks[ctl.current()]); :4825-4846

### keyboard-power-11 · medium · The O menu opens on a toggle, not an order, whenever a list is playing

- **Where:** Shuffle order (O)
- **Observed:** While queueMode is 'list' (after any Play on an album, playlist, search result or genre), modeMenu marks no order as checked. focusChecked therefore lands on the first checked item, 'Keep songs of one anime or game apart'. O then Enter switches that setting off. O, ArrowDown, Enter turned on 'One version of each song' when the user meant to pick the next order. The two toggles also carry role=menuitemradio. openMenu indexes the enabled-only list with an index taken from the full list.
- **Why it matters:** A menu should open on the item the user most likely wants. A set of mutually exclusive orders and independent toggles are different item types (menuitemradio and menuitemcheckbox).
- **Proposed fix:** In modeMenu, focus the current order (plan.mode) even in list mode, or the first order when none applies, by passing an explicit focus index. Mark the two toggles as menuitemcheckbox in ui.js through a new toggle: true item flag. Fix ui.js:324 to search the filtered list.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4586-4597`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js:291`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/ui.js:324` · **Effort:** S
- **Evidence:**
  - j3-menus.mjs: while the 'Test' list played, O put focus on 'Keep songs of one anime or game apart'. ArrowDown then Enter gave the toast 'One version of each song from now on.'
  - app.js:4590 sets checked: queueMode !== 'list' && ...; app.js:4593-4594 the toggles carry checked; ui.js:291 uses menuitemradio whenever checked != null; ui.js:324 uses buttons.findIndex against the filtered list

### keyboard-power-12 · medium · Jump chips on Explore and For you scroll the page but leave focus behind; the next Tab scrolls back to the top

- **Where:** In-page navigation
- **Observed:** The chips scroll to a lane but focus stays on the chip, which is now off screen. The next Tab moves to the next chip and scrolls the page back to the top, which undoes the jump. Settings' chips move focus to the section heading, so the same control behaves two ways.
- **Why it matters:** A link to a place on the page moves the focus along with the view (WCAG 2.4.3).
- **Proposed fix:** After scrollIntoView, set tabindex=-1 on the lane's heading (or the lane wrapper) and call focus({ preventScroll: true }), as app.js:3010 does. Honour reduced motion as Settings does.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/explore.js:569`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/foryou.js:1379`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:2474` · **Effort:** S
- **Evidence:**
  - j18-chips.mjs: Explore 'Similar' scrolled to 1783, and one Tab brought it back to 20 with focus on the 'Your library' chip. For you 'New releases' scrolled to 2110, and one Tab brought it back to 0. It took 126 Tabs from that chip to the first control in its lane
  - Screenshot shots/j9-foryou-chip.png: the page has scrolled and no focus is visible
  - explore.js:569, foryou.js:1379 and app.js:2474 only scroll; app.js:3010 (Settings) also focuses the h2

### keyboard-power-13 · medium · Going Back loses the keyboard's place in a long list

- **Where:** Focus after a route change
- **Observed:** Back restores the scroll position but always focuses the page's h1. In a long list the h1 has scrolled away (the compact header shows instead), so no focus is visible, and the first Tab scrolls the page to the top. The list's roving row also resets to row 0. A user who opened an artist from row 120 has to press End and then ArrowUp 39 times again.
- **Why it matters:** Coming back to a page should return the user to where they were, focus included.
- **Proposed fix:** Next to scrollMemo, keep focusMemo[routeKey] in onRoute: the focused [data-id] and the list index. When renderView(false) runs for a Back or Forward navigation (popstate) and a memo exists, set the list's sel.focus to that index, call vl.reveal on it and focus the row instead of the h1.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:746-786`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1225-1236` · **Effort:** S
- **Evidence:**
  - j17-back.mjs: on row 120 (scrollTop 7569), Tab to the artist link, Enter, then Alt+Left. After Back, scrollTop was 7629 and focus was on the h1 'Songs'. The next Tabs went to Play, Shuffle, the caret, Filter, Show and Sort, and scrollTop became 0
  - Screenshot shots/j17-back.png: rows 122-132 shown, no focus ring anywhere
  - app.js:748 and :777 keep a scroll memo per route; app.js:782 always focuses the h1; app.js:1235 starts sel.focus at 0

### keyboard-power-14 · medium · Rating by keyboard is slow and drops focus

- **Where:** Rating
- **Observed:** The stars are five separate Tab stops. Enter on one rebuilds the panel or page, and focus falls to BODY. From a song row, rating goes through the menu: Shift+F10, 11 ArrowDowns (or End, Up, Up) to 'Rating...', Enter, arrows in the submenu (which opens on 'No rating'), Enter. That was 16 keys in the measured run, and focus was lost at the end (see the menu finding). There are no rating keys for the focused or the playing song.
- **Why it matters:** A star rating is a radio group: one Tab stop, arrows to change, focus kept (APG radio group). Frequent actions deserve direct keys.
- **Proposed fix:** Render the stars as role=radiogroup with one star at tabindex=0 and Left, Right, Home and End to move; restore focus to the chosen star after changed(). Add Alt+1 to Alt+5 (Alt+0 clears) for the focused row, else the playing song, and list them in the ? dialog and the palette.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1008-1021`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1309-1332`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5692-5727`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/actions.js:89` · **Effort:** S
- **Evidence:**
  - j4-dense.mjs: Enter on the now-panel star 'Rate 3 of 5' gave 'Rated 3 of 5.' and left focus on BODY. Tab from star 1 went to Rate 2, 3, 4, 5, then Radio
  - j16-misc.mjs: Enter on star 4 on the track page left focus on BODY
  - j2-row.mjs: rating 4 through the row menu took 16 keystrokes
  - app.js:1008-1021 stars(); app.js:1461-1466 ratingMenu

### keyboard-power-15 · medium · Stale key hints still teach R for Repeat and E for Edit

- **Where:** Shortcut discoverability
- **Observed:** The Repeat button's tooltip still says 'Repeat the queue (r)'. Since 2026-10-11, R starts a radio from the playing song, which clears what was coming with no Undo, and Shift+R repeats. The Help dialog still says 'Edit one track with e or the pencil', but E now leaves the page for Explore; I edits. The one-time key tip only fires when E is pressed, so someone with an R-for-repeat habit gets no warning.
- **Why it matters:** Every place that teaches a key must match what the key does. When a key changes, the old habit should meet a warning.
- **Proposed fix:** Change the title to 'Repeat the queue (Shift+R)'; better, build the bar's titles from actions.js VOCAB keys in wireShell. Change the help sentence to 'Edit one track with I or the pencil'. Call keyTip() from the R branch too, and give Start radio an Undo toast.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html:112`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/index.html:144`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5682`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5709` · **Effort:** S
- **Evidence:**
  - j10-help.mjs: the help text reads 'Edit one track with e or the pencil; select several...'. Among the titles that name a key is 'Repeat the queue (r)'
  - index.html:112 title='Repeat the queue (r)'; index.html:144 <kbd>e</kbd>; app.js:5682 keyTip() is called only from the E branch at :5718

### keyboard-power-16 · low · Shift+F10 on a row that is not selected opens its menu in the window's top-left corner

- **Where:** Menus
- **Observed:** The row handler selects the row first. That refreshes the virtual list and replaces the row element, and the handler then reads the old element's rectangle, which is all zeros. The 19-item menu opens at (60, 4) over the sidebar and the header, about 660 px from its row, with no visible title naming the song. A second Shift+F10 on the same row, now selected, opens it at (336, 121).
- **Why it matters:** A context menu opens next to the thing it acts on, so the user can see what it refers to.
- **Proposed fix:** In app.js:1321, read the rectangle after select(): var rr = (vl.row(i) || r).getBoundingClientRect(). Optionally show the song title as the menu's first heading.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1321` · **Effort:** S
- **Evidence:**
  - j16-misc.mjs: row at (276, 667). Not selected: menu at (60, 4). Selected: menu at (336, 121)
  - Screenshot shots/j16-menu-unselected.png
  - app.js:1321: select(i, null, true) calls vl.refresh() before r.getBoundingClientRect()

### keyboard-power-17 · low · A library song's menu loses most of its actions in the Explore and For you lanes

- **Where:** Menu consistency
- **Observed:** The same library song has a 19-item menu in track lists. In the Explore and For you lanes (media.js) it has 9: no Add to playlist, Rating, Start radio, Edit details, Block or Trim. A keyboard user exploring cannot add the song to a playlist without first opening its page.
- **Why it matters:** One object, one menu (consistency and standards).
- **Proposed fix:** In media.js menu(), when it.mine names a library track, append the Keep and Fix groups of app.js trackMenu, exported through pageCtx (for example ctx.trackMenuItems(track)). Add to playlist, Rating, Radio, Edit and Block are then there too.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/media.js:687-747`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:1359-1398`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:4430` · **Effort:** M
- **Evidence:**
  - j8-regions.mjs: Shift+F10 on the library song 'Late Radio' in Explore gave ['## Late Radio', 'Play', 'Play from here', 'Play next', 'Add to queue', '## Go to', 'Go to Paper Lanterns', 'Explore', 'Song details']
  - j1-search.mjs: the Songs-list menu for a song has 19 entries in 5 groups
  - media.js:687-747 menu(); app.js:1359-1398 trackMenu()

### keyboard-power-18 · low · 'New playlist...' from a song's menu takes you away from the list you were working in

- **Where:** Add to playlist flow
- **Observed:** Creating a playlist from a row's Add to playlist menu calls createList with focus: false but not go: false, so the app jumps to the new playlist's page and leaves the search results. Adding the next song means pressing Back and Tabbing to the row again.
- **Why it matters:** Do not move the user somewhere else while a task is in progress; confirm in place (WCAG 3.2.2).
- **Proposed fix:** Pass { focus: false, go: false } at app.js:3347 and show a toast 'Added to the new playlist Road trip' with an Open action. Closing the dialog then returns focus to the row.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:3347`, `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:3325` · **Effort:** S
- **Evidence:**
  - j2-row.mjs: search results, row, Add to playlist, New playlist..., 'Road trip', Enter (19 keys) moved to #/list/lmv4kew9tkv4x. Toast: 'Created Road trip.'
  - app.js:3347 calls createList('manual', { ids }, '', { focus: false }); app.js:3325 runs if (opts.go !== false) location.hash = ...

### keyboard-power-19 · low · Arrow keys on a focused link or tile seek the song

- **Where:** Global shortcuts
- **Observed:** Left and Right seek 10 s unless the target is a button or inside a track row. On a card, tile or chip link they jump the music instead of moving or scrolling, while media rows use the same arrows to move between rows.
- **Why it matters:** Arrow keys belong to the focused widget. Global seeking belongs on the page itself (body, main, a heading) or on a modified key.
- **Proposed fix:** At app.js:5722, seek only when the target is body, #main, a heading or the now-playing area, or require Shift+Arrow elsewhere. Give shelves Left and Right movement between cards.
- **Files:** `C:/Users/jackl/Documents/nietztein.github.io/misc/101-true-shuffle/app.js:5722` · **Effort:** S
- **Evidence:**
  - j9-explore.mjs: with focus on the 'Bright' mood tile, ArrowRight moved the player from 15.0 to 25.3 s and did not scroll the shelf
  - app.js:5722

