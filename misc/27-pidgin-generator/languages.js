/*
 * Pidgin Generator - language profiles.
 *
 * Eight hand-written source-language profiles used as lexifier or substrate.
 * Each lexical entry is "orthography|broad IPA" (or just "form" when the two
 * coincide). A trailing "?" marks an entry the author was not fully sure of.
 * Tones (Vietnamese, Mandarin, Hausa) and vowel length are deliberately dropped:
 * they are the first casualties in real contact situations too.
 *
 * Transcription conventions (kept deliberately broad):
 *   Mandarin  pinyin b/d/g = p/t/k, p/t/k = ph/th/kh; j,zh = tʃ; q,ch = tʃʰ;
 *             x,sh = ʃ; z = ts; c = tsʰ; h = x; ü = y; "buzzed" i = ɨ.
 *   Vietnamese Northern (Hanoi): d/gi/r = z; tr/ch = tʃ; s/x = s; kh = x;
 *             g = ɣ; đ = ɗ; b = ɓ; th = tʰ.
 *   Portuguese Brazilian, nasal vowels ã ẽ ĩ õ ũ, final o/e = u/i.
 *   Spanish   Latin American (seseo, yeísmo); tap ɾ vs trill r.
 *   English   non-rhotic, diphthongs written as vowel pairs (ai, au, ei, ou).
 *   Hausa     ɓ ɗ implosive, kʼ tsʼ ejective, ʔ glottal stop.
 *
 * Works both in the browser (window.PidginLanguages) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PidginLanguages = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Concepts shown in the Swadesh-style table, with a rough part of speech. */
  var CONCEPTS = [
    ['woman','n'],['man','n'],['person','n'],['child','n'],['mother','n'],['father','n'],['friend','n'],
    ['fish','n'],['bird','n'],['dog','n'],['tree','n'],['leaf','n'],['root','n'],['seed','n'],
    ['skin','n'],['meat','n'],['blood','n'],['bone','n'],['egg','n'],['horn','n'],['tail','n'],['feather','n'],
    ['hair','n'],['head','n'],['ear','n'],['eye','n'],['nose','n'],['mouth','n'],['tooth','n'],['tongue','n'],
    ['hand','n'],['foot','n'],['belly','n'],['neck','n'],['heart','n'],
    ['sun','n'],['moon','n'],['star','n'],['water','n'],['rain','n'],['stone','n'],['sand','n'],['earth','n'],
    ['cloud','n'],['smoke','n'],['fire','n'],['ash','n'],['path','n'],['mountain','n'],['night','n'],['day','n'],
    ['name','n'],['house','n'],['food','n'],['rice','n'],['money','n'],['work','n'],
    ['drink','v'],['eat','v'],['bite','v'],['see','v'],['hear','v'],['know','v'],['sleep','v'],['die','v'],['kill','v'],
    ['swim','v'],['fly','v'],['walk','v'],['come','v'],['go','v'],['sit','v'],['stand','v'],['give','v'],['say','v'],
    ['talk','v'],['want','v'],['have','v'],['make','v'],['take','v'],['burn','v'],['buy','v'],
    ['big','a'],['small','a'],['long','a'],['red','a'],['green','a'],['yellow','a'],['white','a'],['black','a'],
    ['hot','a'],['cold','a'],['full','a'],['new','a'],['good','a'],['bad','a'],['dry','a'],
    ['today','adv'],['tomorrow','adv'],['yesterday','adv'],['now','adv']
  ];

  var ANY = '*'; // wildcard in onset-pair rules

  var LANGS = {

    /* ------------------------------------------------------------------ */
    en: {
      id: 'en', name: 'English', autonym: 'English|ɪŋglɪʃ', family: 'Indo-European, Germanic',
      phon: {
        cons: ['p','b','t','d','k','g','m','n','ŋ','f','v','θ','ð','s','z','ʃ','ʒ','tʃ','dʒ','h','l','r','w','j'],
        vowels: ['i','ɪ','e','ɛ','æ','a','ʌ','ɔ','o','ʊ','u','ə'],
        template: '(C)(C)(C)V(C)(C)(C)',
        onset: { max: 3, pairs: [[['p','b','t','d','k','g','f','θ','ʃ','v','m','n','l','h','s'], ['l','r','w','j']]], sPlus: ['p','t','k','m','n','l','w','f'] },
        coda: { max: 3, allowed: ANY },
        codaSubst: true, geminates: true, longVowels: false,
        map: { 'x': ['k'], 'ʔ': [''], 'ts': ['s'], 'ɲ': ['nj'], 'ʎ': ['lj'], 'ɸ': ['f'], 'ɣ': ['g'] },
        repairs: [],
        cluster: { mode: 'epenthesis', vowel: 'ə' },
        final: { mode: 'delete' },
        note: 'Large inventory, heavy clusters, reduced vowels; nothing much needs repairing.'
      },
      gram: { order: 'SVO', adpos: 'pre', adj: 'pre', dem: 'pre', num: 'pre', gen: 'possessed-first', neg: 'pre', wh: 'front',
        clusive: false, svc: false, redup: false, q: null, tense: 'affix (-ed) and auxiliaries', plural: 'suffix -s', copula: 'is|ɪz' },
      pron: { '1sg': 'I|ai', '2sg': 'you|ju', '3sg': 'him|hɪm', '1pl': 'we|wi', '2pl': 'you|ju', '3pl': 'them|ðɛm' },
      num: ['one|wʌn', 'two|tu', 'three|θri', 'four|fɔ', 'five|faiv'],
      fn: { neg: 'no|nou', where: 'where|wɛa', what: 'what|wɔt', who: 'who|hu', loc: 'stop|stɔp', gen: 'belong|bilɔŋ',
        and: 'and|ænd', all: 'all|ɔl', many: 'plenty|plɛnti', this: 'this|ðɪs', that: 'that|ðæt', here: 'here|hia', there: 'there|ðɛa',
        yes: 'yes|jɛs', no: 'no|nou', to: 'to|tu', in: 'in|ɪn' },
      tma: { ant: { w: 'been|bɪn', from: "'been'" }, fut: { w: 'by-and-by|bai', from: "'by and by', cf. Tok Pisin bai" }, prog: { w: 'stop|stɔp', from: "'stop' (stay), cf. Tok Pisin i stap" }, compl: { w: 'finish|fɪnɪʃ', from: "'finish', cf. Tok Pisin pinis" } },
      lex: {
        woman: 'woman|wʊmən', man: 'man|mæn', person: 'person|pəsən', child: 'child|tʃaild', mother: 'mother|mʌðə', father: 'father|faðə', friend: 'friend|frɛnd',
        fish: 'fish|fɪʃ', bird: 'bird|bəd', dog: 'dog|dɔg', tree: 'tree|tri', leaf: 'leaf|lif', root: 'root|rut', seed: 'seed|sid',
        skin: 'skin|skɪn', meat: 'meat|mit', blood: 'blood|blʌd', bone: 'bone|boun', egg: 'egg|ɛg', horn: 'horn|hɔn', tail: 'tail|teil', feather: 'feather|fɛðə',
        hair: 'hair|hɛa', head: 'head|hɛd', ear: 'ear|ia', eye: 'eye|ai', nose: 'nose|nouz', mouth: 'mouth|mauθ', tooth: 'tooth|tuθ', tongue: 'tongue|tʌŋ',
        hand: 'hand|hænd', foot: 'foot|fʊt', belly: 'belly|bɛli', neck: 'neck|nɛk', heart: 'heart|hat',
        sun: 'sun|sʌn', moon: 'moon|mun', star: 'star|sta', water: 'water|wɔtə', rain: 'rain|rein', stone: 'stone|stoun', sand: 'sand|sænd', earth: 'ground|graund',
        cloud: 'cloud|klaud', smoke: 'smoke|smouk', fire: 'fire|faia', ash: 'ash|æʃ', path: 'road|roud', mountain: 'mountain|mauntən', night: 'night|nait', day: 'day|dei',
        name: 'name|neim', house: 'house|haus', food: 'food|fud', rice: 'rice|rais', money: 'money|mʌni', work: 'work|wək',
        drink: 'drink|drɪŋk', eat: 'eat|it', bite: 'bite|bait', see: 'see|si', hear: 'hear|hia', know: 'savvy|sævi', sleep: 'sleep|slip', die: 'die|dai', kill: 'kill|kɪl',
        swim: 'swim|swɪm', fly: 'fly|flai', walk: 'walk|wɔk', come: 'come|kʌm', go: 'go|gou', sit: 'sit|sɪt', stand: 'stand|stænd', give: 'give|gɪv', say: 'say|sei',
        talk: 'talk|tɔk', want: 'want|wɔnt', have: 'got|gɔt', make: 'make|meik', take: 'take|teik', burn: 'burn|bən', buy: 'buy|bai',
        big: 'big|bɪg', small: 'small|smɔl', long: 'long|lɔŋ', red: 'red|rɛd', green: 'green|grin', yellow: 'yellow|jɛlou', white: 'white|wait', black: 'black|blæk',
        hot: 'hot|hɔt', cold: 'cold|kould', full: 'full|fʊl', new: 'new|nju', good: 'good|gʊd', bad: 'bad|bæd', dry: 'dry|drai',
        today: 'today|tədei', tomorrow: 'tomorrow|təmɔrou', yesterday: 'yesterday|jɛstədei', now: 'now|nau'
      }
    },

    /* ------------------------------------------------------------------ */
    ja: {
      id: 'ja', name: 'Japanese', autonym: 'Nihongo|nihongo', family: 'Japonic',
      phon: {
        cons: ['p','b','t','d','k','g','m','n','s','z','ʃ','tʃ','dʒ','ts','h','f','r','w','j'],
        vowels: ['a','i','u','e','o'],
        template: '(C)(j)V(N)',
        onset: { max: 2, pairs: [[ANY, ['j']]], sPlus: [] },
        coda: { max: 1, allowed: ['n'] },
        codaSubst: false, geminates: true, longVowels: true,
        map: { 'l': ['r'], 'v': ['b'], 'θ': ['s'], 'ð': ['z'], 'ŋ': ['n'], 'x': ['k'], 'ʒ': ['dʒ'], 'ɲ': ['nj'], 'ə': ['a'], 'ʌ': ['a'], 'æ': ['a'], 'ɔ': ['o'], 'ɛ': ['e'], 'ɪ': ['i'], 'ʊ': ['u'], 'ɨ': ['i'], 'y': ['ju'] },
        repairs: [[['t','i'],['tʃ','i']], [['t','u'],['ts','u']], [['d','i'],['dʒ','i']], [['d','u'],['z','u']], [['s','i'],['ʃ','i']], [['z','i'],['dʒ','i']],
          [['h','u'],['f','u']], [['j','i'],['i']], [['j','e'],['i','e']], [['w','u'],['u']]],
        cluster: { mode: 'epenthesis', vowel: 'u', after: { 't': 'o', 'd': 'o', 'tʃ': 'i', 'dʒ': 'i' } },
        final: { mode: 'paragoge', vowel: 'u', after: { 't': 'o', 'd': 'o', 'tʃ': 'i', 'dʒ': 'i' } },
        note: 'Open syllables only (plus moraic nasal); clusters and final consonants get an epenthetic u (o after t/d), as in loanword adaptation.'
      },
      gram: { order: 'SOV', adpos: 'post', adj: 'pre', dem: 'pre', num: 'pre', gen: 'possessor-first', neg: 'post', wh: 'in-situ',
        clusive: false, svc: false, redup: false, q: 'ka', tense: 'verb suffixes (-ta, -ru)', plural: 'mostly unmarked; -tachi for people', copula: 'da' },
      pron: { '1sg': 'watashi|wataʃi', '2sg': 'anata', '3sg': 'kare', '1pl': 'watashitachi|wataʃitatʃi', '2pl': 'anatatachi|anatatatʃi', '3pl': 'karera' },
      num: ['ichi|itʃi', 'ni', 'san', 'yon|jon', 'go'],
      fn: { neg: 'nai', where: 'doko', what: 'nani', who: 'dare', loc: 'aru', gen: 'no', and: 'to', all: 'zenbu|zembu', many: 'takusan',
        this: 'kore', that: 'sore', here: 'koko', there: 'soko', yes: 'hai', no: 'iie', to: 'ni', in: 'de', q: 'ka' },
      tma: { ant: { w: 'mou|moo', from: "mō 'already'" }, fut: { w: 'ato', from: "ato 'later'" }, prog: { w: 'ima', from: "ima 'now'" }, compl: { w: 'owari', from: "owari 'end, finish'" } },
      lex: {
        woman: 'onna', man: 'otoko', person: 'hito', child: 'kodomo', mother: 'haha', father: 'chichi|tʃitʃi', friend: 'tomodachi|tomodatʃi',
        fish: 'sakana', bird: 'tori', dog: 'inu', tree: 'ki', leaf: 'ha', root: 'ne', seed: 'tane',
        skin: 'kawa', meat: 'niku', blood: 'chi|tʃi', bone: 'hone', egg: 'tamago', horn: 'tsuno', tail: 'shippo|ʃipo', feather: 'hane',
        hair: 'kami', head: 'atama', ear: 'mimi', eye: 'me', nose: 'hana', mouth: 'kuchi|kutʃi', tooth: 'ha', tongue: 'shita|ʃita',
        hand: 'te', foot: 'ashi|aʃi', belly: 'hara', neck: 'kubi', heart: 'kokoro',
        sun: 'taiyou|taijoo', moon: 'tsuki', star: 'hoshi|hoʃi', water: 'mizu', rain: 'ame', stone: 'ishi|iʃi', sand: 'suna', earth: 'tsuchi|tsutʃi',
        cloud: 'kumo', smoke: 'kemuri', fire: 'hi', ash: 'hai', path: 'michi|mitʃi', mountain: 'yama|jama', night: 'yoru|joru', day: 'hiru',
        name: 'namae', house: 'ie', food: 'tabemono', rice: 'gohan', money: 'kane', work: 'shigoto|ʃigoto',
        drink: 'nomu', eat: 'taberu', bite: 'kamu', see: 'miru', hear: 'kiku', know: 'shiru|ʃiru', sleep: 'neru', die: 'shinu|ʃinu', kill: 'korosu',
        swim: 'oyogu|ojogu', fly: 'tobu', walk: 'aruku', come: 'kuru', go: 'iku', sit: 'suwaru', stand: 'tatsu', give: 'ageru', say: 'iu',
        talk: 'hanasu', want: 'hoshii|hoʃii', have: 'motsu', make: 'tsukuru', take: 'toru', burn: 'yaku|jaku', buy: 'kau',
        big: 'ookii', small: 'chiisai|tʃiisai', long: 'nagai', red: 'akai', green: 'midori', yellow: 'kiiroi', white: 'shiroi|ʃiroi', black: 'kuroi',
        hot: 'atsui', cold: 'samui', full: 'ippai|ipai', new: 'atarashii|ataraʃii', good: 'yoi|joi', bad: 'warui', dry: 'kawaita',
        today: 'kyou|kjoo', tomorrow: 'ashita|aʃita', yesterday: 'kinou|kinoo', now: 'ima'
      }
    },

    /* ------------------------------------------------------------------ */
    es: {
      id: 'es', name: 'Spanish', autonym: 'español|espaɲol', family: 'Indo-European, Romance',
      phon: {
        cons: ['p','b','t','d','k','g','m','n','ɲ','f','s','x','tʃ','l','r','ɾ','j','w'],
        vowels: ['a','e','i','o','u'],
        template: '(C)(C)V(C)',
        onset: { max: 2, pairs: [[['p','b','t','d','k','g','f'], ['l','r','ɾ']], [ANY, ['w','j']]], sPlus: [] },
        coda: { max: 1, allowed: ['n','m','s','l','r','ɾ','d'] },
        codaSubst: true, geminates: false, longVowels: false,
        map: { 'ʃ': ['tʃ','s'], 'ʒ': ['j'], 'dʒ': ['j'], 'z': ['s'], 'v': ['b'], 'θ': ['t'], 'ð': ['d'], 'h': ['x'], 'ŋ': ['n'], 'ə': ['e'], 'ʌ': ['a'], 'æ': ['a'], 'ɔ': ['o'], 'ɛ': ['e'], 'ɪ': ['i'], 'ʊ': ['u'], 'ts': ['s'], 'ʎ': ['j'] },
        repairs: [],
        cluster: { mode: 'delete', prothesis: 'e' },
        final: { mode: 'delete' },
        note: 'Five vowels, few codas; initial s+C gets a prothetic e- (estrés), other clusters simplify.'
      },
      gram: { order: 'SVO', adpos: 'pre', adj: 'post', dem: 'pre', num: 'pre', gen: 'possessed-first', neg: 'pre', wh: 'front',
        clusive: false, svc: false, redup: false, q: null, tense: 'verb suffixes', plural: 'suffix -s', copula: 'es' },
      pron: { '1sg': 'yo|jo', '2sg': 'tú|tu', '3sg': 'él|el', '1pl': 'nosotros|nosotɾos', '2pl': 'ustedes', '3pl': 'ellos|ejos' },
      num: ['uno', 'dos', 'tres|tɾes', 'cuatro|kwatɾo', 'cinco|sinko'],
      fn: { neg: 'no', where: 'dónde|donde', what: 'qué|ke', who: 'quién|kjen', loc: 'está|esta', gen: 'de', and: 'y|i', all: 'todo', many: 'mucho|mutʃo',
        this: 'este', that: 'ese', here: 'aquí|aki', there: 'allí|aji', yes: 'sí|si', no: 'no', to: 'a', in: 'en' },
      tma: { ant: { w: 'ya|ja', from: "ya 'already', cf. Chabacano ya" }, fut: { w: 'va|ba', from: "va (a) 'goes to'" }, prog: { w: 'ta', from: "está 'is', cf. Chabacano/Papiamentu ta" }, compl: { w: 'kaba', from: "acabar 'to finish', cf. Papiamentu kaba" } },
      lex: {
        woman: 'mujer|muxeɾ', man: 'hombre|ombɾe', person: 'persona|peɾsona', child: 'niño|niɲo', mother: 'madre|madɾe', father: 'padre|padɾe', friend: 'amigo',
        fish: 'pescado|peskado', bird: 'pájaro|paxaɾo', dog: 'perro|pero', tree: 'árbol|aɾbol', leaf: 'hoja|oxa', root: 'raíz|rais', seed: 'semilla|semija',
        skin: 'piel|pjel', meat: 'carne|kaɾne', blood: 'sangre|sangɾe', bone: 'hueso|weso', egg: 'huevo|webo', horn: 'cuerno|kweɾno', tail: 'cola|kola', feather: 'pluma',
        hair: 'pelo', head: 'cabeza|kabesa', ear: 'oreja|oɾexa', eye: 'ojo|oxo', nose: 'nariz|naɾis', mouth: 'boca|boka', tooth: 'diente|djente', tongue: 'lengua|lengwa',
        hand: 'mano', foot: 'pie|pje', belly: 'barriga|bariga', neck: 'cuello|kwejo', heart: 'corazón|koɾason',
        sun: 'sol', moon: 'luna', star: 'estrella|estɾeja', water: 'agua|agwa', rain: 'lluvia|jubja', stone: 'piedra|pjedɾa', sand: 'arena|aɾena', earth: 'tierra|tjera',
        cloud: 'nube', smoke: 'humo|umo', fire: 'fuego|fwego', ash: 'ceniza|senisa', path: 'camino|kamino', mountain: 'montaña|montaɲa', night: 'noche|notʃe', day: 'día|dia',
        name: 'nombre|nombɾe', house: 'casa|kasa', food: 'comida|komida', rice: 'arroz|aros', money: 'dinero|dineɾo', work: 'trabajo|tɾabaxo',
        drink: 'bebe', eat: 'come|kome', bite: 'muerde|mweɾde', see: 'mira|miɾa', hear: 'oye|oje', know: 'sabe', sleep: 'duerme|dweɾme', die: 'muere|mweɾe', kill: 'mata',
        swim: 'nada', fly: 'vuela|bwela', walk: 'camina|kamina', come: 'viene|bjene', go: 'va|ba', sit: 'sienta|sjenta', stand: 'para', give: 'da', say: 'dice|dise',
        talk: 'habla|abla', want: 'quiere|kjeɾe', have: 'tiene|tjene', make: 'hace|ase', take: 'toma', burn: 'quema|kema', buy: 'compra|kompɾa',
        big: 'grande|gɾande', small: 'chico|tʃiko', long: 'largo|laɾgo', red: 'rojo|roxo', green: 'verde|beɾde', yellow: 'amarillo|amaɾijo', white: 'blanco|blanko', black: 'negro|negɾo',
        hot: 'caliente|kaljente', cold: 'frío|fɾio', full: 'lleno|jeno', new: 'nuevo|nwebo', good: 'bueno|bweno', bad: 'malo', dry: 'seco|seko',
        today: 'hoy|oi', tomorrow: 'mañana|maɲana', yesterday: 'ayer|ajeɾ', now: 'ahora|aoɾa'
      }
    },

    /* ------------------------------------------------------------------ */
    pt: {
      id: 'pt', name: 'Portuguese', autonym: 'português|poɾtuges', family: 'Indo-European, Romance',
      phon: {
        cons: ['p','b','t','d','k','g','m','n','ɲ','f','v','s','z','ʃ','ʒ','l','ʎ','r','ɾ','j','w'],
        vowels: ['a','e','ɛ','i','o','ɔ','u','ã','ẽ','ĩ','õ','ũ'],
        template: '(C)(C)V(C)',
        onset: { max: 2, pairs: [[['p','b','t','d','k','g','f','v'], ['l','r','ɾ']], [ANY, ['w','j']]], sPlus: [] },
        coda: { max: 1, allowed: ['s','r','ɾ','l','n','m'] },
        codaSubst: true, geminates: false, longVowels: false,
        map: { 'h': [''], 'θ': ['t'], 'ð': ['d'], 'tʃ': ['ʃ'], 'dʒ': ['ʒ'], 'ŋ': ['n'], 'x': ['k'], 'ə': ['i'], 'ʌ': ['a'], 'æ': ['a'], 'ɪ': ['i'], 'ʊ': ['u'], 'ts': ['s'] },
        repairs: [],
        cluster: { mode: 'epenthesis', vowel: 'i' },
        final: { mode: 'paragoge', vowel: 'i' },
        note: 'Brazilian-style: stray consonants get an epenthetic i (hip-hop > hipi-hopi); nasal vowels survive as V+n where a coda nasal is allowed.'
      },
      gram: { order: 'SVO', adpos: 'pre', adj: 'post', dem: 'pre', num: 'pre', gen: 'possessed-first', neg: 'pre', wh: 'front',
        clusive: false, svc: false, redup: false, q: null, tense: 'verb suffixes', plural: 'suffix -s', copula: 'é|ɛ' },
      pron: { '1sg': 'eu', '2sg': 'você|vose', '3sg': 'ele|eli', '1pl': 'nós|nɔs', '2pl': 'vocês|voses', '3pl': 'eles|elis' },
      num: ['um|ũ', 'dois', 'três|tɾes', 'quatro|kwatɾu', 'cinco|sĩku'],
      fn: { neg: 'não|nãu', where: 'onde|õdi', what: 'que|ki', who: 'quem|kẽ', loc: 'está|ta', gen: 'de|di', and: 'e|i', all: 'tudo|tudu', many: 'muito|mũitu',
        this: 'este|esti', that: 'aquele|akeli', here: 'aqui|aki', there: 'ali', yes: 'sim|sĩ', no: 'não|nãu', to: 'para|paɾa', in: 'em|ẽ' },
      tma: { ant: { w: 'já|ʒa', from: "já 'already', cf. Kriolu dja" }, fut: { w: 'vai', from: "vai 'goes'" }, prog: { w: 'ta', from: "está 'is', cf. Kriolu sta/ta" }, compl: { w: 'kaba', from: "acabar 'to finish'" } },
      lex: {
        woman: 'mulher|muʎɛɾ', man: 'homem|omẽ', person: 'pessoa|pesoa', child: 'criança|kɾiãsa', mother: 'mãe|mãi', father: 'pai', friend: 'amigo|amigu',
        fish: 'peixe|peiʃi', bird: 'pássaro|pasaɾu', dog: 'cachorro|kaʃoru', tree: 'árvore|aɾvoɾi', leaf: 'folha|foʎa', root: 'raiz|rais', seed: 'semente|semẽti',
        skin: 'pele|pɛli', meat: 'carne|kaɾni', blood: 'sangue|sãgi', bone: 'osso|osu', egg: 'ovo|ovu', horn: 'chifre|ʃifɾi', tail: 'rabo|rabu', feather: 'pena',
        hair: 'cabelo|kabelu', head: 'cabeça|kabesa', ear: 'orelha|oɾeʎa', eye: 'olho|oʎu', nose: 'nariz|naɾis', mouth: 'boca|boka', tooth: 'dente|dẽti', tongue: 'língua|lĩgwa',
        hand: 'mão|mãu', foot: 'pé|pɛ', belly: 'barriga|bariga', neck: 'pescoço|peskosu', heart: 'coração|koɾasãu',
        sun: 'sol|sɔl', moon: 'lua', star: 'estrela|estɾela', water: 'água|agwa', rain: 'chuva|ʃuva', stone: 'pedra|pɛdɾa', sand: 'areia|aɾeia', earth: 'terra|tɛra',
        cloud: 'nuvem|nuvẽ', smoke: 'fumaça|fumasa', fire: 'fogo|fogu', ash: 'cinza|sĩza', path: 'caminho|kamiɲu', mountain: 'montanha|mõtaɲa', night: 'noite|noiti', day: 'dia',
        name: 'nome|nomi', house: 'casa|kaza', food: 'comida|komida', rice: 'arroz|aros', money: 'dinheiro|diɲeiɾu', work: 'trabalho|tɾabaʎu',
        drink: 'bebe|bɛbi', eat: 'come|komi', bite: 'morde|mɔɾdi', see: 'vê|ve', hear: 'ouve|ovi', know: 'sabe|sabi', sleep: 'dorme|dɔɾmi', die: 'morre|mɔri', kill: 'mata',
        swim: 'nada', fly: 'voa', walk: 'anda|ãda', come: 'vem|vẽ', go: 'vai', sit: 'senta|sẽta', stand: 'levanta|levãta', give: 'dá|da', say: 'diz|dis',
        talk: 'fala', want: 'quer|kɛɾ', have: 'tem|tẽ', make: 'faz|fas', take: 'pega|pɛga', burn: 'queima|keima', buy: 'compra|kõpɾa',
        big: 'grande|gɾãdi', small: 'pequeno|pekenu', long: 'longo|lõgu', red: 'vermelho|veɾmeʎu', green: 'verde|veɾdi', yellow: 'amarelo|amaɾɛlu', white: 'branco|bɾãku', black: 'preto|pɾetu',
        hot: 'quente|kẽti', cold: 'frio|fɾiu', full: 'cheio|ʃeiu', new: 'novo|novu', good: 'bom|bõ', bad: 'mau', dry: 'seco|seku',
        today: 'hoje|oʒi', tomorrow: 'amanhã|amaɲã', yesterday: 'ontem|õtẽ', now: 'agora|agɔɾa'
      }
    },

    /* ------------------------------------------------------------------ */
    vi: {
      id: 'vi', name: 'Vietnamese', autonym: 'tiếng Việt|tieŋ viet', family: 'Austroasiatic',
      phon: {
        cons: ['ɓ','ɗ','t','tʰ','k','ɣ','m','n','ɲ','ŋ','f','v','s','z','x','h','l','tʃ','w'],
        codaOnly: ['p'],
        vowels: ['a','ə','ɛ','e','i','ɔ','o','u','ɨ'],
        template: '(C)(w)V(C)',
        onset: { max: 2, pairs: [[ANY, ['w']]], sPlus: [] },
        coda: { max: 1, allowed: ['p','t','k','m','n','ŋ','ɲ'] },
        codaSubst: true, geminates: false, longVowels: false,
        map: { 'p': ['ɓ','p'], 'b': ['ɓ','p'], 'd': ['ɗ','t'], 'g': ['ɣ','k'], 'dʒ': ['z','tʃ'], 'ʒ': ['z'], 'ʃ': ['s'], 'θ': ['tʰ','t'], 'ð': ['ɗ','z'], 'r': ['z'], 'ɾ': ['z'], 'ts': ['t'],
          'j': ['z','i'], 'ʌ': ['ə'], 'æ': ['a'], 'ɪ': ['i'], 'ʊ': ['u'], 'y': ['u'], 'ɯ': ['ɨ'], 'ʎ': ['l'] },
        repairs: [],
        cluster: { mode: 'delete' },
        final: { mode: 'delete' },
        note: 'No clusters at all; only stops and nasals may close a syllable, so final fricatives and liquids are dropped (as in loans like ga, xà phòng).'
      },
      gram: { order: 'SVO', adpos: 'pre', adj: 'post', dem: 'post', num: 'pre', gen: 'possessed-first', neg: 'pre', wh: 'in-situ',
        clusive: true, svc: true, redup: false, q: 'không', tense: 'optional particles (đã, sẽ, đang)', plural: 'particles các/những', copula: 'là|la' },
      pron: { '1sg': 'tôi|toi', '2sg': 'bạn|ɓan', '3sg': 'nó|nɔ', '1pl': 'chúng tôi|tʃuŋ toi', '1pl.incl': 'chúng ta|tʃuŋ ta', '2pl': 'các bạn|kak ɓan', '3pl': 'họ|hɔ' },
      num: ['một|mot', 'hai', 'ba|ɓa', 'bốn|ɓon', 'năm|nam'],
      fn: { neg: 'không|xoŋ', where: 'đâu|ɗəu', what: 'gì|zi', who: 'ai', loc: 'ở|ə', gen: 'của|kua', and: 'và|va', all: 'tất cả|tət ka', many: 'nhiều|ɲieu',
        this: 'này|nai', that: 'đó|ɗɔ', here: 'đây|ɗəi', there: 'kia', yes: 'vâng|vəŋ', no: 'không|xoŋ', to: 'đến|ɗen', in: 'trong|tʃɔŋ', q: 'không|xoŋ' },
      tma: { ant: { w: 'đã|ɗa', from: "đã (past marker)" }, fut: { w: 'sẽ|sɛ', from: "sẽ (future marker)" }, prog: { w: 'đang|ɗaŋ', from: "đang (progressive marker)" }, compl: { w: 'xong|soŋ', from: "xong 'finished'" } },
      lex: {
        woman: 'đàn bà|ɗan ɓa', man: 'đàn ông|ɗan oŋ', person: 'người|ŋɨəi', child: 'con|kɔn', mother: 'mẹ|mɛ', father: 'bố|ɓo', friend: 'bạn|ɓan',
        fish: 'cá|ka', bird: 'chim|tʃim', dog: 'chó|tʃɔ', tree: 'cây|kəi', leaf: 'lá|la', root: 'rễ|ze', seed: 'hạt|hat',
        skin: 'da|za', meat: 'thịt|tʰit', blood: 'máu|mau', bone: 'xương|sɨəŋ', egg: 'trứng|tʃɨŋ', horn: 'sừng|sɨŋ', tail: 'đuôi|ɗuoi', feather: 'lông|loŋ',
        hair: 'tóc|tɔk', head: 'đầu|ɗəu', ear: 'tai', eye: 'mắt|mat', nose: 'mũi|mui', mouth: 'miệng|mieŋ', tooth: 'răng|zaŋ', tongue: 'lưỡi|lɨəi',
        hand: 'tay|tai', foot: 'chân|tʃən', belly: 'bụng|ɓuŋ', neck: 'cổ|ko', heart: 'tim',
        sun: 'mặt trời|mat tʃəi', moon: 'trăng|tʃaŋ', star: 'sao|sau', water: 'nước|nɨək', rain: 'mưa|mɨə', stone: 'đá|ɗa', sand: 'cát|kat', earth: 'đất|ɗət',
        cloud: 'mây|məi', smoke: 'khói|xɔi', fire: 'lửa|lɨə', ash: 'tro|tʃɔ', path: 'đường|ɗɨəŋ', mountain: 'núi|nui', night: 'đêm|ɗem', day: 'ngày|ŋai',
        name: 'tên|ten', house: 'nhà|ɲa', food: 'thức ăn|tʰɨk an', rice: 'cơm|kəm', money: 'tiền|tien', work: 'việc|viek',
        drink: 'uống|uoŋ', eat: 'ăn|an', bite: 'cắn|kan', see: 'thấy|tʰəi', hear: 'nghe|ŋɛ', know: 'biết|ɓiet', sleep: 'ngủ|ŋu', die: 'chết|tʃet', kill: 'giết|ziet',
        swim: 'bơi|ɓəi', fly: 'bay|ɓai', walk: 'đi bộ|ɗi ɓo', come: 'đến|ɗen', go: 'đi|ɗi', sit: 'ngồi|ŋoi', stand: 'đứng|ɗɨŋ', give: 'cho|tʃɔ', say: 'nói|nɔi',
        talk: 'nói chuyện|nɔi tʃuien', want: 'muốn|muon', have: 'có|kɔ', make: 'làm|lam', take: 'lấy|ləi', burn: 'đốt|ɗot', buy: 'mua',
        big: 'lớn|lən', small: 'nhỏ|ɲɔ', long: 'dài|zai', red: 'đỏ|ɗɔ', green: 'xanh|saɲ', yellow: 'vàng|vaŋ', white: 'trắng|tʃaŋ', black: 'đen|ɗɛn',
        hot: 'nóng|nɔŋ', cold: 'lạnh|laɲ', full: 'đầy|ɗəi', new: 'mới|məi', good: 'tốt|tot', bad: 'xấu|səu', dry: 'khô|xo',
        today: 'hôm nay|hom nai', tomorrow: 'ngày mai|ŋai mai', yesterday: 'hôm qua|hom kwa', now: 'bây giờ|ɓəi zə'
      }
    },

    /* ------------------------------------------------------------------ */
    ha: {
      id: 'ha', name: 'Hausa', autonym: 'Hausa|hausa', family: 'Afroasiatic, Chadic',
      phon: {
        cons: ['b','ɓ','t','d','ɗ','k','kʼ','g','f','s','z','ʃ','tsʼ','tʃ','dʒ','h','m','n','r','l','w','j','ʔ'],
        vowels: ['a','e','i','o','u'],
        template: 'CV(C)',
        onset: { max: 2, pairs: [[ANY, ['w','j']]], sPlus: [] },
        coda: { max: 1, allowed: ['n','m','r','l','s','ʃ','k','t','b','d','z'] },
        codaSubst: true, geminates: true, longVowels: true,
        map: { 'p': ['f','b'], 'v': ['b','f'], 'θ': ['t','s'], 'ð': ['d','z'], 'ŋ': ['n'], 'ʒ': ['dʒ','z'], 'x': ['h','k'], 'ɲ': ['nj'], 'ts': ['tsʼ'],
          'ə': ['a'], 'ʌ': ['a'], 'æ': ['a'], 'ɔ': ['o'], 'ɛ': ['e'], 'ɪ': ['i'], 'ʊ': ['u'], 'ɨ': ['i'], 'y': ['u'], 'ʎ': ['l'] },
        repairs: [],
        cluster: { mode: 'epenthesis', copy: true, vowel: 'i' },
        final: { mode: 'paragoge', copy: true, vowel: 'a' },
        note: 'No /p/ or /v/ (they become f/b); clusters are broken with a copy vowel (screwdriver > sukurudireba).'
      },
      gram: { order: 'SVO', adpos: 'pre', adj: 'pre', dem: 'post', num: 'post', gen: 'possessed-first', neg: 'pre', wh: 'front',
        clusive: false, svc: true, redup: false, q: null, tense: 'preverbal TAM + person markers', plural: 'many suffix classes', copula: 'ne' },
      pron: { '1sg': 'ni', '2sg': 'kai', '3sg': 'shi|ʃi', '1pl': 'mu', '2pl': 'ku', '3pl': 'su' },
      num: ['ɗaya|ɗaja', 'biyu|bija', 'uku', 'huɗu', 'biyar|bijar'],
      fn: { neg: 'ba', where: 'ina', what: 'me', who: 'wa', loc: 'na', gen: 'na', and: 'da', all: 'duka', many: 'yawa|jawa',
        this: 'wannan', that: 'wancan|wantʃan', here: 'nan', there: 'can|tʃan', yes: 'eh|e', no: "a'a|aʔa", to: 'zuwa', in: 'a' },
      tma: { ant: { w: 'riga', from: "rigā 'already'" }, fut: { w: 'za', from: "zā (future marker)" }, prog: { w: 'na', from: "-nā (continuous marker)" }, compl: { w: 'gama', from: "gama 'to finish'" } },
      lex: {
        woman: 'mace|matʃe', man: 'namiji|namidʒi', person: 'mutum', child: 'yaro|jaro', mother: 'uwa', father: 'uba', friend: 'aboki',
        fish: 'kifi', bird: 'tsuntsu|tsʼuntsʼu', dog: 'kare', tree: 'itace|itatʃe', leaf: 'ganye|ganje', root: 'saiwa?', seed: 'iri',
        skin: 'fata', meat: 'nama', blood: 'jini|dʒini', bone: 'ƙashi|kʼaʃi', egg: 'ƙwai|kʼwai', horn: 'ƙaho|kʼaho', tail: 'wutsiya|wutsʼija', feather: 'gashi|gaʃi',
        hair: 'gashi|gaʃi', head: 'kai', ear: 'kunne', eye: 'ido', nose: 'hanci|hantʃi', mouth: 'baki', tooth: 'haƙori|hakʼori', tongue: 'harshe|harʃe',
        hand: 'hannu', foot: 'ƙafa|kʼafa', belly: 'ciki|tʃiki', neck: 'wuya|wuja', heart: 'zuciya|zutʃija',
        sun: 'rana', moon: 'wata', star: 'tauraro', water: 'ruwa', rain: 'ruwan sama', stone: 'dutse|dutsʼe', sand: 'yashi|jaʃi', earth: 'ƙasa|kʼasa',
        cloud: 'gajimare|gadʒimare?', smoke: 'hayaƙi|hajakʼi', fire: 'wuta', ash: 'toka', path: 'hanya|hanja', mountain: 'tsauni|tsʼauni?', night: 'dare', day: 'rana',
        name: 'suna', house: 'gida', food: 'abinci|abintʃi', rice: 'shinkafa|ʃinkafa', money: 'kuɗi', work: 'aiki',
        drink: 'sha|ʃa', eat: 'ci|tʃi', bite: 'ciza|tʃiza?', see: 'gani', hear: 'ji|dʒi', know: 'sani', sleep: 'barci|bartʃi', die: 'mutu', kill: 'kashe|kaʃe',
        swim: 'iyo|ijo?', fly: 'tashi|taʃi?', walk: 'tafiya|tafija', come: 'zo', go: 'tafi', sit: 'zauna', stand: 'tsaya|tsʼaja', give: 'ba', say: 'ce|tʃe',
        talk: 'magana', want: 'so', have: 'da', make: 'yi|ji', take: 'ɗauka', burn: 'ƙone|kʼone', buy: 'saya|saja',
        big: 'babba', small: 'ƙarami|kʼarami', long: 'dogo', red: 'ja|dʒa', green: 'kore?', yellow: 'rawaya|rawaja', white: 'fari', black: 'baƙi|bakʼi',
        hot: 'zafi', cold: 'sanyi|sanji', full: 'cike|tʃike?', new: 'sabo', good: 'kyau|kjau', bad: 'mugu?', dry: 'bushe|buʃe',
        today: 'yau|jau', tomorrow: 'gobe', yesterday: 'jiya|dʒija', now: 'yanzu|janzu'
      }
    },

    /* ------------------------------------------------------------------ */
    ms: {
      id: 'ms', name: 'Malay', autonym: 'Melayu|məlaju', family: 'Austronesian',
      phon: {
        cons: ['p','b','t','d','k','g','m','n','ɲ','ŋ','s','h','tʃ','dʒ','l','r','w','j','f','z','ʃ'],
        vowels: ['a','e','i','o','u','ə'],
        template: '(C)V(C)',
        onset: { max: 1, pairs: [], sPlus: [] },
        coda: { max: 1, allowed: ['p','t','k','m','n','ŋ','s','h','l','r'] },
        codaSubst: true, geminates: false, longVowels: false,
        map: { 'v': ['f','b'], 'θ': ['t'], 'ð': ['d'], 'x': ['k','h'], 'ʒ': ['dʒ'], 'ʌ': ['a'], 'æ': ['a'], 'ɔ': ['o'], 'ɛ': ['e'], 'ɪ': ['i'], 'ʊ': ['u'], 'ɨ': ['ə'], 'y': ['u'], 'ts': ['s'], 'ʎ': ['l'] },
        repairs: [],
        cluster: { mode: 'epenthesis', vowel: 'ə' },
        final: { mode: 'delete' },
        note: 'Clusters are broken with a schwa (school > sekolah); most single codas are fine, voiced finals devoice.'
      },
      gram: { order: 'SVO', adpos: 'pre', adj: 'post', dem: 'post', num: 'pre', gen: 'possessor-first', neg: 'pre', wh: 'in-situ',
        clusive: true, svc: true, redup: true, q: 'kah', tense: 'optional particles (sudah, akan, sedang)', plural: 'reduplication', copula: 'adalah' },
      pron: { '1sg': 'saya|saja', '2sg': 'kamu', '3sg': 'dia', '1pl': 'kami', '1pl.incl': 'kita', '2pl': 'kalian', '3pl': 'mereka|məreka' },
      num: ['satu', 'dua', 'tiga', 'empat|əmpat', 'lima'],
      fn: { neg: 'tidak', where: 'mana', what: 'apa', who: 'siapa', loc: 'ada', gen: 'punya|puɲa', and: 'dan', all: 'semua|səmua', many: 'banyak|baɲak',
        this: 'ini', that: 'itu', here: 'sini', there: 'sana', yes: 'ya|ja', no: 'tidak', to: 'ke|kə', in: 'di', q: 'kah' },
      tma: { ant: { w: 'sudah', from: "sudah 'already'" }, fut: { w: 'mau', from: "mau 'want', cf. Bazaar Malay mau" }, prog: { w: 'ada', from: "ada 'exist', cf. Bazaar Malay ada" }, compl: { w: 'habis', from: "habis 'finished, used up'" } },
      lex: {
        woman: 'perempuan|pərəmpuan', man: 'lelaki|ləlaki', person: 'orang|oraŋ', child: 'anak', mother: 'ibu', father: 'bapa', friend: 'kawan',
        fish: 'ikan', bird: 'burung|buruŋ', dog: 'anjing|andʒiŋ', tree: 'pokok', leaf: 'daun', root: 'akar', seed: 'biji|bidʒi',
        skin: 'kulit', meat: 'daging|dagiŋ', blood: 'darah', bone: 'tulang|tulaŋ', egg: 'telur|təlur', horn: 'tanduk', tail: 'ekor', feather: 'bulu',
        hair: 'rambut', head: 'kepala|kəpala', ear: 'telinga|təliŋa', eye: 'mata', nose: 'hidung|hiduŋ', mouth: 'mulut', tooth: 'gigi', tongue: 'lidah',
        hand: 'tangan|taŋan', foot: 'kaki', belly: 'perut|pərut', neck: 'leher', heart: 'jantung|dʒantuŋ',
        sun: 'matahari', moon: 'bulan', star: 'bintang|bintaŋ', water: 'air', rain: 'hujan|hudʒan', stone: 'batu', sand: 'pasir', earth: 'tanah',
        cloud: 'awan', smoke: 'asap', fire: 'api', ash: 'abu', path: 'jalan|dʒalan', mountain: 'gunung|gunuŋ', night: 'malam', day: 'hari',
        name: 'nama', house: 'rumah', food: 'makanan', rice: 'nasi', money: 'duit', work: 'kerja|kərdʒa',
        drink: 'minum', eat: 'makan', bite: 'gigit', see: 'lihat', hear: 'dengar|dəŋar', know: 'tahu', sleep: 'tidur', die: 'mati', kill: 'bunuh',
        swim: 'berenang|bərənaŋ', fly: 'terbang|tərbaŋ', walk: 'jalan|dʒalan', come: 'datang|dataŋ', go: 'pergi|pərgi', sit: 'duduk', stand: 'berdiri|bərdiri', give: 'kasi', say: 'kata',
        talk: 'cakap|tʃakap', want: 'mau', have: 'ada', make: 'buat', take: 'ambil', burn: 'bakar', buy: 'beli|bəli',
        big: 'besar|bəsar', small: 'kecil|kətʃil', long: 'panjang|pandʒaŋ', red: 'merah', green: 'hijau|hidʒau', yellow: 'kuning|kuniŋ', white: 'putih', black: 'hitam',
        hot: 'panas', cold: 'sejuk|sədʒuk', full: 'penuh|pənuh', new: 'baru', good: 'baik', bad: 'buruk', dry: 'kering|kəriŋ',
        today: 'hari ini', tomorrow: 'esok', yesterday: 'semalam|səmalam', now: 'sekarang|səkaraŋ'
      }
    },

    /* ------------------------------------------------------------------ */
    zh: {
      id: 'zh', name: 'Mandarin', autonym: 'Hànyǔ|xanjy', family: 'Sino-Tibetan',
      phon: {
        cons: ['p','pʰ','t','tʰ','k','kʰ','ts','tsʰ','tʃ','tʃʰ','f','s','ʃ','x','m','n','ŋ','l','r','w','j'],
        vowels: ['a','o','ə','e','i','u','y','ɨ'],
        template: '(C)V(N)',
        onset: { max: 1, pairs: [], sPlus: [] },
        coda: { max: 1, allowed: ['n','ŋ','r'] },
        codaSubst: true, geminates: false, longVowels: false,
        map: { 'b': ['p'], 'd': ['t'], 'g': ['k'], 'v': ['w','f'], 'z': ['s'], 'ʒ': ['ʃ'], 'dʒ': ['tʃ'], 'dz': ['ts'], 'θ': ['s'], 'ð': ['t'], 'h': ['x'], 'ɲ': ['n'],
          'ʌ': ['a'], 'æ': ['a'], 'ɔ': ['o'], 'ɛ': ['e'], 'ɪ': ['i'], 'ʊ': ['u'], 'ɯ': ['u'], 'ʎ': ['l'] },
        repairs: [],
        cluster: { mode: 'epenthesis', vowel: 'ə', after: { 's': 'ɨ', 'ʃ': 'ɨ', 'ts': 'ɨ', 'tʃ': 'ɨ', 'tsʰ': 'ɨ', 'tʃʰ': 'ɨ' } },
        final: { mode: 'delete', paragogeFor: { 's': 'ɨ', 'ʃ': 'ɨ', 'ts': 'ɨ', 'tʃ': 'ɨ' } },
        note: 'Only nasals may close a syllable; voiced stops become unaspirated voiceless; clusters get a schwa (Clinton > Kelindun), final sibilants an -ɨ (bus > bashi).'
      },
      gram: { order: 'SVO', adpos: 'pre', adj: 'pre', dem: 'pre', num: 'pre', gen: 'possessor-first', neg: 'pre', wh: 'in-situ',
        clusive: true, svc: true, redup: false, q: 'ma', tense: 'aspect particles (le, guo, zhe)', plural: 'unmarked; -men for people', copula: 'shì|ʃɨ' },
      pron: { '1sg': 'wǒ|wo', '2sg': 'nǐ|ni', '3sg': 'tā|tʰa', '1pl': 'wǒmen|womən', '1pl.incl': 'zánmen|tsanmən?', '2pl': 'nǐmen|nimən', '3pl': 'tāmen|tʰamən' },
      num: ['yī|i', 'èr|ər', 'sān|san', 'sì|sɨ', 'wǔ|u'],
      fn: { neg: 'bù|pu', where: 'nǎli|nali', what: 'shénme|ʃənmə', who: 'shéi|ʃei', loc: 'zài|tsai', gen: 'de|tə', and: 'hé|xə', all: 'dōu|tou', many: 'duō|tuo',
        this: 'zhè|tʃə', that: 'nà|na', here: 'zhèli|tʃəli', there: 'nàli|nali', yes: 'shì|ʃɨ', no: 'bù|pu', to: 'dào|tau', in: 'zài|tsai', q: 'ma' },
      tma: { ant: { w: 'guò|kuo', from: "guò (experiential aspect)" }, fut: { w: 'yào|jau', from: "yào 'want, will'" }, prog: { w: 'zài|tsai', from: "zài (progressive marker, 'be at')" }, compl: { w: 'wán|wan', from: "wán 'finish'" } },
      lex: {
        woman: 'nǚrén|nyrən', man: 'nánrén|nanrən', person: 'rén|rən', child: 'háizi|xaitsɨ', mother: 'māma|mama', father: 'bàba|papa', friend: 'péngyou|pʰəŋjou',
        fish: 'yú|jy', bird: 'niǎo|niau', dog: 'gǒu|kou', tree: 'shù|ʃu', leaf: 'yèzi|jetsɨ', root: 'gēn|kən', seed: 'zhǒngzi|tʃuŋtsɨ',
        skin: 'pí|pʰi', meat: 'ròu|rou', blood: 'xuè|ʃye', bone: 'gǔtou|kutʰou', egg: 'dàn|tan', horn: 'jiǎo|tʃiau', tail: 'wěiba|weipa', feather: 'yǔmáo|jymau',
        hair: 'tóufa|tʰoufa', head: 'tóu|tʰou', ear: 'ěrduo|ərtuo', eye: 'yǎnjing|jantʃiŋ', nose: 'bízi|pitsɨ', mouth: 'zuǐ|tsuei', tooth: 'yá|ja', tongue: 'shétou|ʃətʰou',
        hand: 'shǒu|ʃou', foot: 'jiǎo|tʃiau', belly: 'dùzi|tutsɨ', neck: 'bózi|potsɨ', heart: 'xīn|ʃin',
        sun: 'tàiyáng|tʰaijaŋ', moon: 'yuèliang|yeliaŋ', star: 'xīngxing|ʃiŋʃiŋ', water: 'shuǐ|ʃuei', rain: 'yǔ|jy', stone: 'shítou|ʃɨtʰou', sand: 'shā|ʃa', earth: 'tǔ|tʰu',
        cloud: 'yún|jyn', smoke: 'yān|jan', fire: 'huǒ|xuo', ash: 'huī|xuei', path: 'lù|lu', mountain: 'shān|ʃan', night: 'yè|je', day: 'tiān|tʰien',
        name: 'míngzi|miŋtsɨ', house: 'fángzi|faŋtsɨ', food: 'shíwù|ʃɨu', rice: 'mǐfàn|mifan', money: 'qián|tʃʰien', work: 'gōngzuò|kuŋtsuo',
        drink: 'hē|xə', eat: 'chī|tʃʰɨ', bite: 'yǎo|jau', see: 'kàn|kʰan', hear: 'tīng|tʰiŋ', know: 'zhīdào|tʃɨtau', sleep: 'shuì|ʃuei', die: 'sǐ|sɨ', kill: 'shā|ʃa',
        swim: 'yóuyǒng|joujuŋ', fly: 'fēi|fei', walk: 'zǒu|tsou', come: 'lái|lai', go: 'qù|tʃʰy', sit: 'zuò|tsuo', stand: 'zhàn|tʃan', give: 'gěi|kei', say: 'shuō|ʃuo',
        talk: 'shuōhuà|ʃuoxua', want: 'yào|jau', have: 'yǒu|jou', make: 'zuò|tsuo', take: 'ná|na', burn: 'shāo|ʃau', buy: 'mǎi|mai',
        big: 'dà|ta', small: 'xiǎo|ʃiau', long: 'cháng|tʃʰaŋ', red: 'hóng|xuŋ', green: 'lǜ|ly', yellow: 'huáng|xuaŋ', white: 'bái|pai', black: 'hēi|xei',
        hot: 'rè|rə', cold: 'lěng|ləŋ', full: 'mǎn|man', new: 'xīn|ʃin', good: 'hǎo|xau', bad: 'huài|xuai', dry: 'gān|kan',
        today: 'jīntiān|tʃintʰien', tomorrow: 'míngtiān|miŋtʰien', yesterday: 'zuótiān|tsuotʰien', now: 'xiànzài|ʃientsai'
      }
    }
  };

  var ORDER = ['en', 'ja', 'es', 'pt', 'vi', 'ha', 'ms', 'zh'];

  return { LANGS: LANGS, ORDER: ORDER, CONCEPTS: CONCEPTS, ANY: ANY };
});
