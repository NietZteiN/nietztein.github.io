# The lab kit

Small behavioural experiments that run on the visitor: "n = 1", the only participant is the reader. They mirror the questions in the owner's research (how people and language models read obfuscated code) without asserting any result. Each one measures the reader and plots the reader's own data.

An experiment is a kit toy (read `misc/_kit/BRIEF.md` and `misc/_kit/README.md` first; all of it applies) that also loads this folder. The kit gives every experiment the same session, the same way of timing, the same statistics, the same charts, one place for the study's cited figures, and one caveat under every result.

| File | What it is |
| --- | --- |
| `lab.js` | `window.Lab`: the session (instructions, trials, typed answers, pauses, progress, results, the saved record), simulated participants, the loop's stages, the Latin square. Needs ToyKit. |
| `stats.js` | `window.LabStats`: the statistics, pure, each with its formula in its comment. |
| `chart.js` | `window.LabChart`: five small SVG charts, a figure wrapper with a data table. |
| `facts.js` | `window.Facts`: the cited figures of the owner's study, read from the one file that holds them. |
| `lab.css` | The look: stimulus card, answer buttons, progress bar, results sheet, charts, both themes. |
| `lint-facts.js` | `node misc/_lab/lint-facts.js misc/NN-slug`: fails a folder that writes one of the study's figures out. |
| `test.js` | `node misc/_lab/test.js`: the kit's own tests. |

## Start an experiment

1. Copy `misc/_kit/template/` to `misc/NN-slug/` and fix the two kit paths, as the kit README says.
2. Add the lab's files: the stylesheet after the kit pair in the `<head>`, the scripts at the end of the `<body>`, in this order, before your `app.js`.

```html
<link rel="stylesheet" href="../_kit/kit.css"><script src="../_kit/kit.js"></script>
<link rel="stylesheet" href="../_lab/lab.css">
...
<script src="../_lab/stats.js"></script>
<script src="../_lab/chart.js"></script>
<script src="../_lab/facts.js"></script>   <!-- only if the page cites the study -->
<script src="../_lab/lab.js"></script>
<script src="app.js"></script>
```

3. In `toy.json`: `"group": "lab"`, `"kit": true`, the default thumbnail query `"?thumb=1"`, and `"facts": [...]` listing every fact key the page cites (an empty list if none).
4. Write `app.js` like the example below. Put everything with a right answer (item generation, scoring) in a UMD file of its own and test it in Node, as the brief asks.

## A complete small experiment

This one was tested as it stands, under another slug: the seven smoke passes, a sitting of eighteen real key presses, both simulated participants, the thumbnail, and the lint. `index.html`, the body:

```html
<main class="kit-main kit-pad"></main>
<footer class="kit-footer">
	<p><b>How it works.</b> Each of the numbers 1 to 9 is shown once as a digit and once as a word, in a shuffled order. The clock starts on the first frame after a number is drawn and stops at your key press or tap. The headline is the median time of your correct answers to words minus that to digits; its interval is a percentile bootstrap (2,000 resamples of this sitting's trials). The result is kept in this browser's localStorage and nowhere else. Nothing leaves your browser.</p>
</footer>
<template id="instructions">
	<h2>Odd or even?</h2>
	<p>A number appears, as a digit or as a word. Answer as fast as you can without guessing: <kbd>F</kbd> for odd, <kbd>J</kbd> for even, or tap the buttons. Eighteen numbers, about a minute.</p>
</template>
<template id="help-template">
	<p>Eighteen numbers, one at a time. Press <kbd>F</kbd> if the number is odd and <kbd>J</kbd> if it is even. At the end you see your own times, and nothing else: there is nobody to compare with.</p>
</template>
```

`app.js`:

```js
(function () {
	'use strict';

	ToyKit.init({ id: '61-odd-or-even', title: 'Odd or Even', sub: 'Is a number slower to judge when it is spelled out?', back: 'misc', help: '#help-template' });

	var S = LabStats;
	var WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

	// Simulated participants: ?auto=1 (and the thumbnail) plays the first one.
	Lab.auto({
		typical: Lab.sim({ acc: 0.95, rt: { digit: 520, word: 640 } }),
		nodifference: Lab.sim({ acc: 0.95, rt: 580 })
	});

	var session = Lab.session({ exp: '61-odd-or-even', version: 1, stage: 'h2' });

	// Each number once as a digit and once as a word, in this sitting's order.
	var items = [];
	WORDS.forEach(function (word, i) {
		items.push({ n: i + 1, cond: 'digit', text: String(i + 1) });
		items.push({ n: i + 1, cond: 'word', text: word });
	});
	items = session.shuffle(items);

	session.instructions(document.querySelector('#instructions'), { button: 'Start' }).then(function () {
		return session.each(items, function (item) {
			return session.trial({
				cond: item.cond,
				render: function (el) { el.textContent = item.text; },
				choices: [{ key: 'f', label: 'Odd', value: 'odd' }, { key: 'j', label: 'Even', value: 'even' }],
				correct: item.n % 2 ? 'odd' : 'even',
				deadlineMs: 4000,
				feedback: true
			});
		});
	}).then(function (trials) {
		function times(cond) {
			return trials.filter(function (t) { return t.cond === cond && t.correct; }).map(function (t) { return t.rt; });
		}
		var digit = times('digit'), word = times('word');
		var diff = S.bootstrapDiff(word, digit, S.median, { seed: session.seed });
		session.results(function (el) {
			el.appendChild(LabChart.figure(
				LabChart.dots([{ label: 'digits', values: digit }, { label: 'words', values: word }], { title: 'Time of every correct answer', yLabel: 'response time (ms)', unit: 'ms' }),
				{ caption: 'Every correct answer, by how the number was written' }
			));
		});
		session.finish({ headline: { label: 'Words took longer than digits by', value: diff.estimate, unit: 'ms', ci: diff, signed: true } });
	}).catch(Lab.fail);
})();
```

What the kit did there without being asked: called `ToyKit.ready()` on the first screen; kept the answer buttons asleep until the clock started; ran the progress bar; put the title, the stage of the loop, the headline number, the caveat and the "Run it again", "Download my data" and "Forget my results" buttons on the results sheet; saved the record; and, under `?auto=1` or `?thumb=1`, played the whole thing with a simulated participant, labelled it as simulated, saved nothing and offered "Run it with another seed" in place of "Run it again".

## The session

```js
var session = Lab.session({ exp: '61-odd-or-even', version: 1, stage: 'h2' });
```

| Option | Meaning |
| --- | --- |
| `exp` | The experiment's id: the toy's slug. Records are stored under it. |
| `version` | Bump it whenever the trials or the scoring change, so old records are not read as if they were new ones. |
| `stage` | Which stage of the owner's human-machine loop the experiment is about: one of `h1 h2 h3 m1 m2 m3 xin xout` (see "The stages of the loop"). Required. |
| `seed` | Optional. Without it each sitting gets a new seed; `?seed=abc` in the address fixes it; `?auto=` uses `'lab'` and `?thumb=1` uses `'thumb'`. The seed is stored in the record. |
| `mount` | Optional selector or element to build in. Otherwise `#lab` if the page has one, else `main.kit-main`. |

A session is used one step at a time; every step returns a Promise, and the chain ends in `.catch(Lab.fail)`.

| Call | What it does |
| --- | --- |
| `session.instructions(htmlOrNode, { button: 'Start' })` | Shows a panel with a button; resolves when it is pressed. A string is your own HTML; a `<template>` element gives its content. |
| `session.trial(spec)` | One timed choice. Resolves with `{ i, cond, resp, rt, correct, timedOut }`. |
| `session.text(spec)` | One typed answer. Resolves with `{ i, cond, resp, rt, rtFirstKey, correct, timedOut }`. |
| `session.each(list, fn, { progress })` | Calls `fn(item, i)` for one item after the other, waiting for each Promise, moves the progress bar, and resolves with the list of results. |
| `session.loop(fn, { max: 1000 })` | Calls `fn(i, resultsSoFar)` again and again until it returns `false` (or nothing). For a staircase, where the next trial depends on the last answer. |
| `session.progress(i, n)` | Sets the thin bar: `i` of `n` done. `each` does this for you. |
| `session.pause(message, { button: 'Continue' })` | A rest panel; resolves when the button is pressed. |
| `session.results(render, { title, headline })` | Shows the results sheet. `render(el, session)` draws your part into `el`. The kit adds the rest. `headline: false` leaves the headline number out. Returns the sheet element. |
| `session.finish({ headline, n, trials, extra })` | Builds the record of this sitting, saves it (`Lab.save`) and shows its headline on the sheet. Returns the record. Call it once, after `results`. |

Also on the session: `seed`, `rng` (a seeded generator: `rng()`, `rng.int(n)`, `rng.pick(list)`, `rng.shuffle(list)`, `rng.normal(mean, sd)`), `shuffle(list)`, `pick(list)`, `trials` (every result so far, in order), `practice` (the results of practice trials), `record` and `saved` (after `finish`), `history()` (this experiment's stored records), `auto` (the simulated participant's name, or `null`), `root` (the `.lab` element), `elapsedMs`.

### session.trial

```js
session.trial({
	cond: 'word',                                   // the condition, kept in the result
	render: function (el) { el.textContent = 'seven'; },   // draws the stimulus into the card
	choices: [{ key: 'f', label: 'Odd', value: 'odd' }, { key: 'j', label: 'Even', value: 'even' }],
	correct: 'odd',                                 // or function (value) -> true / false; leave out when no answer is right
	deadlineMs: 4000,
	feedback: true
})
```

| Option | Meaning |
| --- | --- |
| `render(el)` | Required. Draw the stimulus into `el` (it is empty). For code, `el.appendChild(Lab.code(source))`. |
| `choices` | Required. `[{ key, label, value }]`: `key` is a `KeyboardEvent.key` (`'f'`, `'ArrowLeft'`, `' '` or `'Space'`, `'1'`), or a list of them, or nothing for a button without a key; `label` is text or a node; `value` is what comes back as `resp`. Letters match in either case. |
| `prompt` | A line of text above the buttons (the question, when it is the same for every trial). |
| `correct` | The right `value`, or `function (value)` returning true or false. Without it `correct` in the result is `null`. |
| `deadlineMs` | No answer by then: `timedOut: true`, `resp: null`, `rt: null`, `correct: false`. |
| `feedback` | `true` shows "Correct", "Not quite" or "Too slow" for `feedbackMs` (700); a `function (result)` returns your own words (text or a node). |
| `confidence` | `true` asks "How sure are you of that answer?" after the answer, on the 50 to 100 scale of `misc/05-obfuscation-game` (keys 1 to 6); the result gains `confidence` and `confidenceRt`. |
| `showMs`, `mask(el)` | Takes the stimulus away after `showMs` (to the nearest frame) and calls `mask(el)` to draw what replaces it. The result gains `shownMs`: the kit's estimate of how long it was on screen, from the display's frame length (the median gap between frames while the trial waited) and the frames it drew on. A browser does not say when it painted, so both are good to about one frame (17 ms at 60 Hz), not to the tenth of a millisecond they are written with: in the kit's check against paint times (headless Chrome, 60 Hz, 32 trials of 50 to 250 ms), 28 were within 3 ms and the other 4 one frame off. Do not build a threshold finer than a frame on it. |
| `itiMs` | The blank gap before the stimulus (300). |
| `fixationMs` | Shows a + for this long before the stimulus (0: none). |
| `practice` | `true` keeps the result out of `session.trials` (it goes to `session.practice`, marked `practice: true`). |
| `data` | Anything small you want back on the result as `result.data` (the item's id, its level). |

The result: `i` (0, 1, 2 ... over the session), `cond`, `resp` (the chosen `value`, or `null`), `rt` (ms, to a tenth; `null` on a timeout), `correct` (`true`, `false`, or `null` when there is no right answer), `timedOut`. A result may also carry `shownMs`, `confidence`, `confidenceRt`, `practice`, `data`, and `away: true` when the tab was hidden during the trial (you may want to drop those).

The same thing as one line of JSON, as it is stored: `{ "i": 3, "cond": "word", "resp": "odd", "rt": 612.4, "correct": true, "timedOut": false }`.

### session.text

```js
session.text({
	render: function (el) { el.appendChild(Lab.code('total = 3 + 4\nprint(total)')); },
	label: 'What does this print?', placeholder: 'the output', correct: '7'
})
```

Options: `cond`, `render(el)`, `prompt`, `label` ("Your answer"), `placeholder`, `button` ("Submit"), `multiline` (a textarea; Enter submits, Shift+Enter is a new line), `inputmode`, `maxLength`, `allowEmpty`, `correct`, `feedback`, `feedbackMs`, `confidence`, `itiMs`, `fixationMs`, `practice`, `data`.

`correct` may be a string or a number (the answer is matched the way the obfuscation game matches one, see `Lab.judge`; the result gains `nearMiss: true` when only blank space differs), a `RegExp`, or a `function (text)`. `rt` runs to the press of Enter or of the button, `rtFirstKey` to the first character typed. An empty answer is refused with a toast.

### Timing

What the kit does, the same for every experiment:

1. The stimulus is drawn while hidden. On the next animation frame it is shown.
2. On the frame after that one, the first frame after it was painted, the clock starts: `t0 = performance.now()`. The buttons wake up at that moment; a press that began earlier is ignored.
3. The answer's time is the `timeStamp` of the input event: the `keydown` for a key, the `pointerdown` for a mouse or a finger (the click that follows a moment later only confirms it). `rt = timeStamp - t0`.

What it cannot do: know when the screen really lit up or when the finger really moved. A frame is 8 to 17 ms, a touch screen adds tens of ms, some browsers round their clocks to 1 ms or coarser, and the reader's device is unknown. Differences between conditions within one sitting survive that; absolute times do not mean much. Do not report a time to more than the nearest millisecond, and prefer differences. This is why the caveat says "Timing in a browser is approximate."

For your drive scripts: the `.lab` element carries `data-phase`, one of `instructions`, `wait` (the gap before a stimulus), `armed` (the clock is running), `confidence`, `feedback`, `pause`, `results`. Wait for `armed` before pressing.

### The results sheet

`session.results(render)` builds, top to bottom: the title ("Your results"), the stage of the loop as a small link, the headline number of the record with its interval, your `render(el, session)` output, the caveat (`Lab.caveat()`), and the buttons. Put your charts in a `<div class="lab-figures">` to get the two-column grid, and your sentences in plain `<p>` elements.

In a thumbnail (`?thumb=1`) the sheet shows the headline on the left and the first figure on the right, and hides everything else in your part; give another element the class `lab-thumb` to keep it.

## Simulated participants

```js
Lab.auto({
	typical: Lab.sim({ acc: { clean: 0.9, renamed: 0.7 }, rt: { clean: 700, renamed: 950 } }),
	perfect: function (trial) { return { resp: trial.right[0], rt: 500 }; }
});
```

Under `?auto=<name>` the session is played by that policy with no waiting: no frames, no timers, the whole session and its results sheet in a few milliseconds (in the kit's check, 10 trials with six charts took about 15 ms and 200 trials 60 to 95 ms). `?auto=1` plays the first policy, and so does `?thumb=1`, which is how thumbnails are taken: a thumbnail is the results sheet of the first policy with the seed `'thumb'`. With no policy registered a default `Lab.sim()` plays.

A policy is `function (trial) -> { resp, rt }` (plus `confidence` and `confidenceRt` if the trial asks for confidence; a simulated result always gets both, as a real one does: a `confidence` off the 50 to 100 scale becomes 70, a missing `confidenceRt` 800 ms). It gets `{ kind: 'trial' | 'text', i, cond, choices, values, correct, right, deadlineMs, showMs, data, rng }`: `values` are the choices' values, `right` the ones that are correct, `rng` a seeded generator (never use `Math.random()`). Answer with one of `values`, or `null` for no answer; for a typed trial `resp` is the text.

`Lab.sim({ acc, rt, sd, miss, text })` builds a policy: `acc` is the chance of a right answer (a number, or one per condition, `'*'` for the rest; 0.85), `rt` the typical time in ms the same way (600), `sd` the spread of the times as a share (0.25, log-normal), `miss` the chance of no answer (0), `text(trial, right)` what a typed answer says. Every answer also carries a `confidence` (70 to 100 when right, 50 to 80 when wrong) and a `confidenceRt` (400 to 1400 ms, related to nothing).

Use more than one policy. A policy with an effect built in shows that your analysis finds it; one without shows what your page says when there is nothing to find.

One simulated sitting is one draw, and a short sitting is noisy. In the example above the "typical" participant is 120 ms slower on words, yet over 2,000 seeds the headline of its eighteen trials ranged from about -20 to +270 ms (5th to 95th percentile, mean +122). The default seed `'lab'` happens to be a rare draw for this example under both policies: "typical" comes out at -84 ms (only about 1 seed in 100 gives less) and "nodifference" at -203 ms (also about 1 in 100), so the first `?auto=1` you open of it looks wrong. That is the experiment telling the truth about eighteen trials, not a bug, and any other experiment's default draw is just as much a single draw. So never judge an analysis by one seed: press "Run it with another seed" on the simulated sheet (it puts a new `?seed=` in the address) a few times, or give the policy a smaller spread (`sd: 0.1`); to see what a reader will see, keep the spread realistic.

A simulated sitting is honest about itself: the sheet is titled "A simulated sitting" and tagged "simulated participant", a note at the top says a script answered and names the seed, the record carries `auto: '<name>'`, and it is **not saved**. `Lab.isAuto` and `Lab.autoName` tell your code.

## Records and storage

`session.finish(...)` saves one record per sitting in `localStorage` under `lab:v1:<exp>`, keeping the last 20 per experiment. This shared prefix is the kit's own, the one exception to "storage only through `ToyKit.store`", because a hub page reads every experiment's latest record. Your experiment's own preferences still go through `ToyKit.store`.

```json
{
	"exp": "61-odd-or-even", "version": 1, "t": "2026-10-03T12:00:00.000Z", "stage": "h2",
	"headline": { "label": "Words took longer than digits by", "value": 84.3, "unit": "ms", "ci": [12.1, 150.9] },
	"n": 18,
	"trials": [{ "i": 0, "cond": "word", "resp": "odd", "rt": 612.4, "correct": true, "timedOut": false }],
	"seed": "mgb1x2k"
}
```

- `headline.value` is a finite number or `null` (not enough data). `headline.ci` is `[lo, hi]` or `null`; you may pass what `LabStats.wilson`, `bootstrapCI` or `bootstrapDiff` return (anything with `lo` and `hi`) and the kit stores the pair. Optional: `ciLabel` (default "95% interval"), `digits`, `signed`.
- `n` defaults to the number of trials the session ran, `trials` to those trials. Pass your own to store less.
- Optional fields: `seed`, `auto`, `extra` (anything small you want back), `trialsDropped` (set by the kit if storage was too full for the trials).

| Call | |
| --- | --- |
| `Lab.save(record)` | Checks and stores a record; `true` if stored. A malformed record throws a `TypeError` that says what is wrong. `finish` calls it for you. |
| `Lab.history(exp)` | This browser's records of one experiment, oldest first. Empty under `?thumb=1`. |
| `Lab.latest(exp)` | The newest one, or `null`. |
| `Lab.all()` | `{ exp: [records] }` for every experiment that has any: what a hub page reads. |
| `Lab.clear(exp)` | Removes one experiment's records (`Lab.clear()` removes all); returns how many went. The "Forget my results" button does this. |
| `Lab.last` | The record `session.finish` built on this page, simulated or not; `null` before. |

For a page that reads the records (a hub): a stored record is always a real sitting, because simulated ones are never stored. To test such a page, load each experiment with `?auto=1`, read `Lab.last`, and seed the hub's page with those records through the harness (`newPage({ storage: { 'lab:v1:<exp>': JSON.stringify([record]) } })`). A record that carries `auto` is a simulated one: a hub that meets one must label it or skip it. Records are data the reader could have edited: show them with `textContent`, and treat a missing or odd field as "no number".

## The stages of the loop

`Lab.STAGES` is the owner's human-machine loop, copied word for word from `assets/js/glance.js` (the test reads that file and fails if they drift). Quote these names exactly; do not paraphrase them.

| id | side | name |
| --- | --- | --- |
| `h1` | Human | Interpret and set goals |
| `h2` | Human | Read and reason |
| `h3` | Human | Judge and revise |
| `m1` | Model | Represent the task |
| `m2` | Model | Generate and reason |
| `m3` | Model | Change capabilities |
| `xin` | Human to model | Instruction and context |
| `xout` | Model to human | Output and explanation |

`Lab.stage('h2')` gives the entry (with `sub`, the small print of the six stages), `Lab.stageLabel('h2')` gives "Human · Read and reason", `Lab.stageChip('h2')` an element that links to the diagram on the About page (the results sheet shows it already).

## Other helpers on Lab

| Call | |
| --- | --- |
| `Lab.latin(n, seed)` | A balanced Latin square (a Williams design) for conditions `0 .. n-1`: every condition once in every position and after every other condition equally often. `n` rows for an even `n`; `2n` rows for an odd `n` (no single square can balance an odd number). A seed relabels the conditions and shuffles the rows. With one participant, use a row per block. |
| `Lab.shuffle(list, seed)` | A shuffled copy; the same seed, the same order. |
| `Lab.rng(seed)` | The site's seeded generator (the numbers of `ToyKit.rng`), plus `normal(mean, sd)`. |
| `Lab.each(list, fn)` | The sequential loop of `session.each`, without the progress bar. |
| `Lab.caveat()` | The standard line under every result, as a `<p class="lab-caveat">`: "One participant, one sitting: an anecdote, not a finding. Timing in a browser is approximate." The sheet adds it by itself; use this elsewhere. The text alone is `Lab.CAVEAT`. |
| `Lab.headline({ label, value, unit, ci })` | The large number with its interval, as an element. |
| `Lab.code(source, { numbers })` | A `<pre class="lab-code">` with numbered lines, the way the obfuscation game prints a snippet. |
| `Lab.judge(answer, expected)` | `{ correct, nearMiss }`, the obfuscation game's matching: line endings, curly quotes, blank space at the ends of lines and trailing newlines do not count; a near miss differs only in blank space. `Lab.normalize(text)` is the first half. |
| `Lab.format(value, { unit, digits, signed, bare })` | A number as text: `612 ms`, `63%`, `0.42`, a real minus sign, a dash for no number. |
| `Lab.fail(err)` | The end of every chain: shows the kit's failure panel and marks the page ready. |
| `Lab.CONFIDENCE` | `[50, 60, 70, 80, 90, 100]`. |

## LabStats

Pure functions on plain arrays of numbers; every comment in `stats.js` gives the formula. Anything that is not a finite number makes the answer `NaN` rather than being counted as zero, so filter first: a timed-out trial has `rt: null`.

| Function | Returns |
| --- | --- |
| `finite(list)` | The finite numbers of a list. |
| `sum`, `mean`, `median`, `variance`, `sd`, `sem` | The usual; `variance` and `sd` divide by n - 1. |
| `quantile(list, p)` | Linear interpolation between order statistics (R's default). |
| `rank(list)` | Ranks from 1, ties sharing the mean of their ranks. |
| `pearson(x, y)`, `spearman(x, y)` | Correlations; `spearman` is the Pearson correlation of average ranks, so ties are handled. |
| `linreg(x, y)` | `{ slope, intercept, r, r2, n, predict(x), residuals }`. |
| `wilson(k, n, z)` | The Wilson score interval of k successes in n: `{ p, lo, hi, centre }`, 95% unless `z` is given. For any share of correct answers. |
| `bootstrapCI(values, statFn, { n: 2000, seed, level: 0.95 })` | The percentile bootstrap: `{ lo, hi, estimate, se }`. Seeded: the same call gives the same interval. `values` may be pairs, for a correlation. |
| `bootstrapDiff(a, b, statFn, opts)` | The same for `statFn(a) - statFn(b)` between two conditions of one sitting. |
| `permutationTest(a, b, { paired, stat, alternative, n, seed, maxExact })` | `{ p, observed, exact }`. Exact (every deal tried) when there are at most 20,000 deals, otherwise 5,000 seeded random ones. |
| `dprime(hits, misses, falseAlarms, correctRejections)` | `{ dprime, c, hitRate, faRate }` with the log-linear correction (0.5 added to every cell), and the criterion c. |
| `staircase({ start, step, down: 2, up: 1, min, max })` | An object with `level`, `next(correct)` and `threshold()` (the mean of the last six reversals; `threshold(k)` for the last k), plus `reversals`, `trials`, `history`, `target`. The level goes down (harder) after `down` right answers in a row and up after `up` wrong ones; 2-down 1-up settles near 70.7% correct. `step` may be a list that shrinks at each reversal. If more is harder in your task, show `max - level`. For durations, run it on an index into a list of durations. |
| `fitExpVsPower(times, scores, { shift })` | Fits `a * exp(-b t)` and `a * (t + shift)^(-b)` by least squares on the scores: `{ exp, power, better }`, each fit with `a, b, rss, r2, residuals, predict(t)`. Times must be above zero, or pass `shift: 1` (a time of 0 without it throws). Fewer than two points, or a point that is not a finite number, gives no fit: every number `NaN` and `better: null`, so filter first. |
| `surprisal(p)` | `-log2(p)`, in bits. |
| `normCdf(z)`, `probit(p)` | The standard normal distribution and its inverse. `Z95` is 1.959964. |
| `rng(seed)`, `hash(text)` | The seeded generator and the hash behind it. |

## LabChart

Five charts, each `LabChart.<name>(data, opts)` returning an `<svg>` element. A chart is drawn at its real size (340 by 220, or `opts.width` and `opts.height`), shrinks to fit a narrower column and never grows, so at 360 px its text is still 11 px. Each carries `role="img"` and an `aria-label` that says what it shows in words, a tooltip on every mark, and its numbers as a table (`chart.labTable`). The colours come from `lab.css` and follow the theme without a redraw.

| Chart | Data | What it draws |
| --- | --- | --- |
| `LabChart.bars(rows, opts)` | `[{ label, value, lo, hi, n }]` | One bar per row from zero, a whisker from `lo` to `hi`, the value on the cap. One colour: the rows are conditions of one measure. |
| `LabChart.scatter(points, opts)` | `[{ x, y, label, group }]` | Points, the least-squares line, and Spearman's rho with n above the plot (`fit: false`, `rho: false` turn them off; `identity: true` adds the dashed line y = x, for confidence against accuracy). Up to three groups get colours and a key. Needs `stats.js`. |
| `LabChart.line(series, opts)` | `[{ name, points: [{ x, y, lo, hi }] }]`, or just the points | A learning or forgetting curve. `curves: [{ name, fn }]` draws fitted curves (pass the `predict` of `fitExpVsPower`). Up to three series. |
| `LabChart.dots(groups, opts)` | `[{ label, values }]` | Every value as a dot, by condition, with a tick and a number for each median. The honest picture of a small sitting. Tied values sit side by side; the dots shrink (to 1.6 px) before they would touch, and values that still find no room (dozens tied at one value, say confidence over many trials) are counted at the end of their row ("+12") rather than piled up. Past about 40 values a condition, a histogram reads better. |
| `LabChart.histogram(values, opts)` | `[numbers]` | Bins with round edges (`bins` asks for about that many); whole numbers over a short range, such as a span, get one bar per number. `marks: [{ x, label }]` draws labelled lines (the median, a deadline). |

Options shared by all: `title` (the start of the spoken summary; say what the chart is), `xLabel`, `yLabel`, `unit` (`'ms'`, `'%'`), `digits`, `yMin`, `yMax`, `xMin`, `xMax`, `width`, `height`.

`LabChart.figure(chart, { caption, note, table })` wraps a chart in a `<figure class="lab-figure">` with a caption above, a note below and the chart's numbers in a closed "The numbers" table (the keyboard and screen-reader way to every value). Pass a function instead of a chart, `LabChart.figure(function (width) { return LabChart.bars(rows, { width: width }); }, {...})`, and the chart fills its column and is redrawn when the column changes width; `LabChart.mount(container, draw)` does the same without the figure.

Rules the charts follow, so that nine experiments look like one lab: one colour for one measure, at most three series colours and never colour alone (a key, labels, the table); gridlines are hairlines; text is never in a series colour; a marker on every point only while there are few points (up to 24). Keep condition labels short: two words, and at most five or six bars in a chart of the default width. A chart with no data draws "Nothing to plot" and does not throw.

## Facts: the figures of the owner's study

The only figures about the owner's study that a page may show are the lines of `misc/55-paper-theatre/stories/_facts/obfuscation.vn`, and a page shows them only through `Facts`, which reads that file at run time. Nothing is copied: when the facts file changes, every page follows.

```js
Facts.load().then(function () {
	// a sentence of the published story obfuscation-src.vn, with its two figures cited
	p.appendChild(Facts.fill('Human accuracy falls from {human_l0} at L0 to {human_l3} at L3.'));
	p.appendChild(Facts.cite('human_l0'));     // one fact: its value, its section mark, a link to the PDF
	footer.appendChild(Facts.source());        // the line that says where the marked figures come from
}).catch(Lab.fail);
```

| Call | |
| --- | --- |
| `Facts.load()` | Fetches and parses the facts file (through `ToyKit.root`); a Promise of `{ key: fact }`. Rejects with an error `Lab.fail` can show. |
| `Facts.get(key)` | `{ key, value, ref, num, unit, range }` or `null`. `value` is verbatim; `num` is the value as a number when it is a single number (a percentage, a count, a number word, a correlation), `unit` is `'%'`, the letter rho or `''`, `range` is `[lo, hi]` when the value is a range. |
| `Facts.all()` | Every fact. |
| `Facts.cite(key)` | An element: the value exactly as printed, then its reference, which links to the published abstract (`assets/documents/publications/2026SPLASH-SRC.pdf`). Throws on an unknown key. |
| `Facts.fill(template)` | A fragment where every `{key}` is the cited fact and the rest is plain text. |
| `Facts.source()` | The one-line source note with the link. Put it under anything that cites. |
| `Facts.parse(text)` | The parser alone (also in Node). |

List the keys you cite under `"facts"` in `toy.json`, and run the lint:

```
node misc/_lab/lint-facts.js misc/NN-slug
```

It fails when a guarded figure (any fact value with a percent sign, a decimal point, a rho or a thousands comma) is written out in a `.js`, `.mjs`, `.html`, `.htm` or `.svg` file of the folder, in a `content:` rule of its CSS, or in the card text of its `toy.json` (`title`, `desc`, `note`, which the public Misc card prints and where nothing can be cited), in any spelling (escapes, entities, "rho", "percent", a dash for "to", a count without its comma, a decimal without its last zero); when `toy.json` lists a fact key that does not exist; or when the code asks `Facts` for one. It warns, without failing, about the bare number of such a figure (the percentage without its sign, or as a share of one, `0.405`), about a figure written out in a `.json` data file (JSON cannot carry the marker), and about a cited key missing from `"facts"`.

Layout is not a figure, and is not read: CSS wherever it is written (`<style>` blocks, `style` attributes quoted or not, `.css` files apart from `content:`, `el.style.width = '12%'`, `cssText`, `.style()`, `.css()`, `.setProperty()`), size and position attributes of HTML and SVG whose value is numbers (`width="25%"`, `<stop offset="60%">`, `.attr('cx', '25%')`, `setAttribute`), CSS colour, gradient and `calc` functions (`hsl(210 40% 60%)`), and the remainder operator between two numbers in a code stimulus (`27 % 4`, `27%4`). (These examples use made-up numbers.) What the lint cannot tell from a figure is your own copy that happens to use one of the study's numbers ("about N% of trials are catch trials") or arithmetic shaped like one of its ranges: put the marker `lint-facts-ok` and the reason in a comment on that line. Whole percentages as bare numbers and a number split across strings are not caught, and a figure with a tag inside it is only warned about. The other facts (small counts, words, dates) are not guarded by the lint, but the rule is the same: show them through `Facts`.

Load the facts early: call `Facts.load()` when the page starts (it is one small request, made once per page) and wait for it before `session.results`, so the sheet is complete when it appears and the thumbnail taken from it has the figures in it. The experiment itself should still run when the file cannot be read: turn the rejection into "no figures", say so with `ToyKit.fail(err)`, and leave the cited sentence out. Never fall back to a number typed into the page.

```js
var cited = Facts.load().then(function () { return true; }, function (err) { ToyKit.fail(err); return false; });
// ... later, with the trials done:
cited.then(function (ok) {
	session.results(function (el) {
		if (ok) el.appendChild(Facts.source());
	});
	session.finish({ headline: headline });
});
```

The words around a figure are a claim about the study too. Take them from the abstract or from a published story, keep them few, and never put a figure of the study on the same axis as the reader's number: the materials, the supervision and the people differ, so they are not comparable.

## lab.css

Tokens you may override after loading it (light on `:root`, dark on `:root[data-theme="dark"]`): `--lab-c1`, `--lab-c2`, `--lab-c3` (the three series colours, each at least 3:1 against the surface in both themes and checked together for colour-blind separation by simulation: change all or none), `--lab-scroll-shade` (the shadow at the edge of a code block that scrolls sideways), `--lab-good`, `--lab-bad`, `--lab-plot-bg` (what a chart sits on), `--lab-card-min` (the least height of the stimulus card, so the buttons do not move between trials), `--lab-width`.

Classes for your own markup: `lab-figures` (the grid of figures), `lab-figure`, `lab-note` (a paragraph), `lab-code`, `lab-chip`, `lab-thumb` (stays in the thumbnail). Built by the kit: `lab`, `lab-progress`, `lab-panel`, `lab-go`, `lab-trial`, `lab-card`, `lab-stim`, `lab-prompt`, `lab-choices`, `lab-choice`, `lab-feedback`, `lab-answer`, `lab-input`, `lab-sheet`, `lab-headline`, `lab-caveat`, `lab-fact`, `lab-chart`, `lab-tip`.

Answer buttons are at least 52 px high. Nothing is animated; the two transitions use the kit's duration tokens and are off under reduced motion. Right and wrong are never colour alone (the mark changes shape and the word says it).

## How to choose a headline number

The record has one number. It is what a hub page shows for the experiment, so choose it with care.

1. **Answer the experiment's question, for this sitting.** "Does a misleading name slow me down?" has the headline "Misleading names cost +84 ms", not "Mean time 912 ms".
2. **Prefer a difference between conditions to a level.** A level (a time, a share correct) depends on the device, the hour and the coffee. A difference between two conditions of the same sitting cancels most of that, and it is the thing the experiment set up.
3. **Use a statistic a few odd trials cannot move.** Medians for times. Shares for accuracy. A threshold from a staircase. Spearman's rho for a relation.
4. **Give it an interval that comes from this sitting's trials**, and say in "How it works" how it was made. It describes how much the number would wobble over trials like these, by this reader, today. It says nothing about other people.
5. **Decide the exclusions before looking** and state them: correct answers only, no timeouts, no trial while the tab was hidden.
6. **Let it be `null`.** With too few usable trials there is no number; pass the `NaN` you got and the sheet says so.

| The measure | The headline | Made with |
| --- | --- | --- |
| Time in two conditions | the difference of medians, ms, `signed: true` | `bootstrapDiff(a, b, LabStats.median, { seed: session.seed })` |
| Share correct | the share, %, or the difference of two shares | `wilson(k, n)` (times 100), or `bootstrapDiff` on lists of 0 and 1 with `mean` |
| Yes/no detection | d-prime (unit `''`, `digits: 2`) | `dprime(...)`; an interval by `bootstrapCI` over the trials |
| A limit (span, shortest exposure) | the threshold, in the task's unit | `staircase(...).threshold()`; `ci: null` is fine |
| A relation between two things | Spearman's rho (`digits: 2`) | `spearman`; an interval by `bootstrapCI` over pairs |
| Forgetting or learning | the fitted rate, or the score at a fixed delay | `fitExpVsPower`; say which curve was closer "this time" |
| Prediction | mean surprisal, bits | `surprisal(p)` per item, `bootstrapCI` |
| Confidence against accuracy | the gap between mean confidence and share correct, in points | `bootstrapCI` over trials |

The `label` reads together with the number ("Words took longer than digits by" / "+84 ms"). `n` is the number of trials the headline rests on. If you change what the headline means, bump `version`.

## What an experiment must never claim

1. **Anything about the owner's papers beyond `Facts`.** No result, method or number of the study that is not a line of the facts file, shown through `Facts.cite` with its reference. Do not say a sitting "replicates", "confirms", "matches" or "contradicts" the study: one reader on a web page is not the study's design. Six of the owner's papers are under embargo (see the brief): do not describe or demonstrate them. A technique you demonstrate is the textbook version, and the page says it is not the method of any paper on this site.
2. **Anything about people in general.** One participant, one sitting. Write "you", "this sitting", "this time", "these eighteen trials". Never "people", "readers", "humans", "programmers", "most", "typically", "on average". A p value from `permutationTest` is about this sitting's trials; it does not make the sentence general. The caveat stays on the sheet.
3. **Any comparison with other visitors.** No percentile, norm, rank, grade, leaderboard, "better than", "faster than most", "typical score". There is no data behind any of them: nothing leaves the browser, so nobody else's result exists here. The only comparison a page may draw is with the same reader's earlier sittings (`Lab.history`), and even that is two anecdotes.

Also: a simulated sitting is always labelled as simulated and never stored; do not present one as anybody's result. Do not diagnose (attention, memory, skill) and do not advise. And do not dress the number up: no more digits than the timing can bear.

## Checking an experiment

```
node misc/NN-slug/test.js                       your own logic
node misc/_lab/lint-facts.js misc/NN-slug       no figure of the study written out
node scripts/qa/smoke.mjs NN-slug               seven loads; the thumb pass plays the first policy to the results sheet
node scripts/qa/shot.mjs NN-slug                the thumbnail: the results sheet of the first policy
node scripts/qa/drive.mjs <scratch>/check.mjs   a real sitting, by clicks and keys
```

In a drive script: `page.goto(url)`, `page.click('.lab-go')`, then for each trial wait until `document.querySelector('.lab').getAttribute('data-phase') === 'armed'`, wait a human moment, and `page.key('f')` or `page.click('.lab-choice:nth-child(1)')`; at the end wait for the phase `results` and read `localStorage['lab:v1:<exp>']`. Then load `?auto=<each policy>` and check that the sheet says what it should for a participant whose behaviour you chose. Look at the sheet in both themes and at 360 px.

`node misc/_lab/test.js` runs the kit's own tests: the statistics against answers worked by hand, the Latin square, the facts file, the stage names against `assets/js/glance.js`, the lint, the charts' markup.
