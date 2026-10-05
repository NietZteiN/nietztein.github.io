/*
 * Prints, for reading, the entries of the three word lists of misc/_texts that contain a stem
 * from the list below. Entries that are already flagged come in [brackets]; the others are
 * the ones to judge. This is how the SEEN lists in blocked.mjs were checked on 2026-10-05.
 *
 *     node scripts/texts/review-blocked.mjs [en|de|vi]
 *
 * No network; reads the built data files. A stem is matched as a substring; "=word" must
 * equal the entry and "^word" must begin it. Most hits are harmless (the stem "ass" would
 * find "class", so it is written "=ass"; "cock" still finds "peacock"). Reading them is the
 * point: the script decides nothing.
 */
import path from 'node:path';
import { OUT, loadData } from './lib.mjs';

const STEMS = (
	// English: profanity, sex, slurs
	'fuck shit piss cunt cock dick puss twat boob bitch bastard whore slut hooker prostitu porn sex ' +
	'molest incest pedoph paedoph masturb masterb orgasm orgy orgi ejacul erotic erect genital penis penile phall vagin vulva clit scrot testic semen sperm ' +
	'jizz dildo vibrator condom nude nudi naked nipple horny horni kink fetish bondage bdsm stripper striptease topless hentai milf gangbang blowjob handjob wank jerk ' +
	'bugger bollock crap damn turd poop fart douche scum skank pimp nazi hitler swastika klan nigg negro chink gook kike wetback coon paki dago kraut gyps gypp tranny shemale ' +
	'fag dyke queer lesbo lezz retard spaz spastic cripple midget mongol honk redskin injun squaw darkie darky sambo mulatto towelhead raghead beaner ' +
	'sodom bestial necroph zooph voyeur perver lust brothel bordello harlot bimbo floozy hussy nympho viagra cialis feces fecal faec urinat cunnil fellat coit intercourse foreplay threesome swinger escort playboy ' +
	'xxx nsfw smut sleaz lewd obscen raunch boner schlong prick butt booty tits titt titi arse asshol ' +
	'rapist raping raped rapes slave lynch whitey suck screw bang hump shag bonk ' +
	'spank sadis masoch lingerie hooch trollop strumpet wench knockers hooters cleavage pubic urethra labia foreskin circumcis menstru tampon enema laxative diarrh vomit puke barf snot booger defecat excrement dung ' +
	'jackass dumbass badass smartass kickass asswipe asshat shite feck frig freaking effing bellend minge fanny willy pecker wiener weiner nutsack ballsack boobie booby ' +
	'chinaman coolie gringo hillbilly redneck heeb limey polack golliwog pikey gyppo eskimo halfbreed moron imbecile cretin psycho lunatic sissy pansy ponce ladyboy transvest crossdress hermaphrod eunuch castrat ' +
	'fuhrer fuehrer holocaust genocid aryan stalin mussolini goebbels himmler auschwitz osama saddam ' +
	'breast bosom busty buxom bikini babe hottie cumshot facial squirt interracial upskirt seduc sensual arous libido carnal fornicat adulter mistress concubin virgin chast impoten ' +
	'harem geisha gigolo callgirl ghetto thug gangsta ' +
	'=ass =asses =assed =cum =cums =anal =anally =anus =rape =raper =tit =jap =japs =spic =spics =wop =wops =homo =homos =hoe =hoes =ho =hos =pee =poo =hell =gay =gays =nig =dong =knob =bra =bras =bum =bums ' +
	'=crotch =groin =thong =thongs =sod =git =slag =tart =tarts =tramp =bloody =goddamn =darn =jew =jews =yid =oriental =negroes =colored =savage =savages ' +
	'=jugs =pube =pubes =nuts =balls =spook =mick =poof =oral =rectal =stool =bowel =urine =teat =teats =beaver =snatch =muff =lay =laid =boned =sob =fu =pos =wtf ^motherf ^mofo ' +
	// German
	'scheiß scheiss schiss schiß arsch ärsch fick fotz hure nutte schlamp schwanz schwänz schwuchtel schwul tunte wichs pimmel möse muschi bums vögel geil sperma hoden nackt ' +
	'kack kotz mist dreck neger kanak zigeuner vergewalt krüppel spast missgeburt mißgeburt hurens lesb homo transe puff bordell luder flittchen möpse nippel eier ' +
	'lutsch orgie erotik erotisch onan kondom inzest pädo schänd zuhälter furz pups pinkel rotz sau schwein polack itaker schlitz japs jude nutt strich depp trottel idiot verdammt verflucht ' +
	'pisse fresse schnauze maul busen brüste hintern pobacke ständer geblasen geleckt missbrauch pornog befriedig gestapo führer vergas arisch ' +
	'freudenm stricher behindert schwachkopf schwachsinn blödmann abschaum gesindel tucke transv zwitter verreck krepier flachgelegt gepoppt rammel ' +
	'=sack =säcke =schwuler =schwule =schwulen =lesbe =lesben =tussi =weib =weiber =penner =assi =asi =spasti =mongo =juden =jüdin =mohr =ami =amis =po =popo =latte =blasen =bläst =leck =lecken =leckt ' +
	'=heil =ss =sieg =kz =arier =dirne =puff =freier =irre =irrer =pack =kot =urin =glied =prügel =riemen =rohr =nudel =nüsse =poppen =nageln =knallen =treiben'
).split(' ');

function matches(word) {
	for (const s of STEMS) {
		if (s[0] === '=') { if (word === s.slice(1)) return true; }
		else if (s[0] === '^') { if (word.startsWith(s.slice(1))) return true; }
		else if (word.includes(s)) return true;
	}
	return false;
}

function show(label, words, blocked) {
	const flagged = new Set(blocked);
	const hits = [];
	words.forEach((w, i) => { if (matches(w)) hits.push((flagged.has(w) ? '[' + w + ']' : w) + '#' + (i + 1)); });
	const open = hits.filter((h) => h[0] !== '[').length;
	console.log('== ' + label + ': ' + words.length + ' entries, ' + hits.length + ' contain a stem; ' + (hits.length - open) + ' of those are flagged, ' + open + ' are not');
	console.log(hits.join(' '));
	console.log('');
}

const which = process.argv[2] || '';
if (!which || which === 'en') {
	const C = loadData(path.join(OUT, 'cmu-phones.js'), 'TEXTS_CMU');
	show('cmu-phones.js', Object.keys(C.w), C.blocked);
}
if (!which || which === 'de') {
	const F = loadData(path.join(OUT, 'freq-de.js'), 'TEXTS_FREQ_DE');
	show('freq-de.js', F.words, F.blocked);
}
if (!which || which === 'vi') {
	const V = loadData(path.join(OUT, 'freq-vi.js'), 'TEXTS_FREQ_VI');
	show('freq-vi.js', V.words, V.blocked);
}
console.log(STEMS.length + ' stems');
