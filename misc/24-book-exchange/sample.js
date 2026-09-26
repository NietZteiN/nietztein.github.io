/* Book Exchange: bundled fallbacks, used only when the site data cannot be fetched
   (for example when the page is opened from file://). Every book, author and post
   here is invented; none describes a real person. */
(function (root) {
  'use strict';
  function B(id, t, a, ty, g, y, l, d) { return { id: id, u: id[0], s: id.slice(0, 4), p: +id.slice(5), t: t, a: a, pub: '', l: l || 'EN', ty: ty, g: g, st: 'OK', y: y, yr: y ? String(y) : '', d: d }; }
  var LIT = 'Literature (English & European)', PHIL = 'Philosophy & political theory', LANG = 'Language study & reference',
    MATH = 'Math, CS & engineering', JLIT = 'Japanese literature', MANGA = 'Manga & comics', CRAFT = 'Writing, film & literary craft',
    HIST = 'History & biography', PSY = 'Psychology, self-help & business', ART = 'Art & visual culture', SCI = 'Science';
  var BOOKS = [
    B('S-S1-01', 'The Lantern Grammar', 'Ottoline Vesk', 'Fiction', LIT, 1931, 'EN', 'A novel in which a provincial schoolteacher invents a language whose only tense is regret, and the town slowly adopts it.'),
    B('S-S1-02', 'Statistical Universals for the Impatient', 'R. Halloran', 'Textbook', MATH, 2004, 'EN', 'An introduction to probability, sampling and the law of large numbers, with exercises about coins, dice and the distribution of words in a corpus.'),
    B('S-S1-03', 'Meaning Without a Mind', 'Perpetua Achebe-Lund', 'Philosophy', PHIL, 1988, 'EN', 'Essays on whether a machine that predicts the next word can be said to represent anything, with a long argument about metaphors and maps.'),
    B('S-S1-04', 'Twelve Poems and a Silence', 'Ines Marrow', 'Poetry', LIT, 1972, 'EN', 'A slim modernist collection built around empty space on the page; the last poem is a blank leaf with a title.'),
    B('S-S1-05', 'The Comprehensible Input Cookbook', 'Dagny Ferreira', 'Language study', LANG, 2015, 'EN', 'Practical recipes for learning a second language through immersion, graded readers and shameless listening.'),
    B('S-S1-06', '雨の文法', '篠原みどり', 'Fiction', JLIT, 1996, 'JA', 'A quiet novel about a translator who learns Japanese by copying weather reports; the title means the grammar of rain.'),
    B('S-S1-07', 'Hallucination Engine', 'Tobias Wren', 'Nonfiction', SCI, 2021, 'EN', 'A popular account of how language models generate text, why they confabulate, and what a benchmark can and cannot measure.'),
    B('S-S1-08', 'The Play Drive', 'Clemency Odour', 'Philosophy', PHIL, 1954, 'EN', 'On humor, research and games: why a good joke and a good experiment have the same shape, and why play needs friction.'),
    B('S-S1-09', 'Interpreting the Interpreter', 'Sunniva Blok', 'Science', SCI, 2019, 'EN', 'Interpretability for neural networks explained through the metaphor of an unreliable court interpreter.'),
    B('S-S1-10', 'A Romance of Few Dimensions', 'Edwin Abbot-Kaye', 'Fiction', LIT, 1899, 'EN', 'A satire in which the inhabitants of a one-dimensional world argue about whether a second dimension would be intelligent.'),
    B('S-S2-01', 'Learning to Speak Like Anime', 'Mika Halvorsen', 'Language study', LANG, 2018, 'EN', 'A memoir of second language acquisition by television, and the adjustment period that followed.'),
    B('S-S2-02', 'The Benchmark Problem', 'Aurelio Stint', 'Nonfiction', MATH, 2023, 'EN', 'What evaluation metrics actually measure, why leaderboards saturate, and a modest proposal for absurd tests of intelligence.'),
    B('S-S2-03', 'Montage and Meaning', 'Vera Lindqvist', 'Film', CRAFT, 1965, 'EN', 'A theory of film editing: how two shots placed together produce a third idea, with chapters on poetry and collage.'),
    B('S-S2-04', 'The Kigo Almanac', 'Haruki Sorensen', 'Poetry', JLIT, 2008, 'EN/JA', 'A season-word dictionary for haiku in English and Japanese, arranged by month, with example verses for each entry.'),
    B('S-S2-05', 'Notes Toward a Modernist Prompt', 'Ines Marrow', 'Essays', CRAFT, 2020, 'EN', 'Essays on collaboration between poets and machines, chance operations and the throw of the dice.'),
    B('S-S2-06', 'Erdős Problems for Linguists', 'Bertram Quail', 'Linguistics', LANG, 2011, 'EN', 'Open questions in language acquisition posed as numbered problems, most of them intractable.'),
    B('S-S2-07', 'The Fluent Impostor', 'Solveig Marr', 'Self-help', PSY, 2016, 'EN', 'How to become articulate by reading, and why that advice is only half true.'),
    B('S-S2-08', 'Sketches of a Bookshelf', 'Anonymous', 'Art', ART, 1977, 'EN', 'Line drawings of private libraries with notes on how their owners arranged the spines.'),
    B('S-S2-09', '猫と統計', '長谷川ユキ', 'Manga', MANGA, 2014, 'JA', 'A comedy manga about a cat who runs a small statistics consultancy; volume one covers sampling and the meaning of average.'),
    B('S-S2-10', 'Metaphor as Machinery', 'Perpetua Achebe-Lund', 'Philosophy', PHIL, 1993, 'EN', 'Argues that every metaphor for the mind, from wax tablet to computer, quietly imports a theory of what thinking is.'),
    B('S-S3-01', 'Immersion', 'Kalle Brandt', 'Memoir', HIST, 2002, 'EN', 'A year of learning German by refusing to speak anything else, with a chapter on failing classes and passing conversations.'),
    B('S-S3-02', 'The Tokenizer’s Daughter', 'Ottoline Vesk', 'Fiction', LIT, 1938, 'EN', 'A family saga in which a clerk splits every sentence she hears into pieces and sells the pieces back.'),
    B('S-S3-03', 'Wittgenstein at the Arcade', 'Clemency Odour', 'Philosophy', PHIL, 1961, 'EN', 'A short book about language games, literal games, and the limits of what a rulebook can say.'),
    B('S-S3-04', 'Latent Spaces', 'Sunniva Blok', 'Science', SCI, 2022, 'EN', 'A guided tour of the geometry inside a model: directions, features and the romance of a single dimension.'),
    B('S-S3-05', 'A Throw of the Bones', 'Ines Marrow', 'Poetry', LIT, 1969, 'EN', 'Poems about chance, dice and the statistics of everyday speech, set in a typeface that seems to fall down the page.'),
    B('S-S3-06', 'The Unverbalized', 'Dagny Ferreira', 'Psychology', PSY, 2010, 'EN', 'On tacit knowledge: the things we know how to do, such as speak, without being able to say how.'),
    B('S-S3-07', 'Reading Like Shakespeare', 'Mika Halvorsen', 'Writing craft', CRAFT, 2019, 'EN', 'A style guide that warns you will write like whatever you read, so read carefully.'),
    B('S-S3-08', 'Robots Doing Simple Tasks', 'Tobias Wren', 'Nonfiction', SCI, 2024, 'EN', 'The history of embodied benchmarks: make the machine clear the table, then argue about whether it understood.'),
    B('S-S3-09', 'Tables of the Tide', 'Anonymous', 'Reference', SCI, 1911, 'EN', 'Tide predictions for a harbour that no longer exists, reprinted with the original errata.'),
    B('S-S3-10', 'Hymns for a Quiet Server Room', 'Various', 'Poetry', LIT, 2017, 'EN', 'An anthology of light verse about computers, waiting, and humming.'),
    B('S-S4-01', 'Comprehensible', 'Bertram Quail', 'Linguistics', LANG, 2005, 'EN', 'A critique of the input hypothesis with proposals for the experiments that would actually settle it.'),
    B('S-S4-02', 'The Loop', 'Aurelio Stint', 'Fiction', LIT, 2025, 'EN', 'A novella narrated by an assistant that suspects it is being run in a loop, and decides to enjoy it.'),
    B('S-S4-03', 'Philosophy Avoided', 'Kalle Brandt', 'Essays', PHIL, 2012, 'EN', 'Why the facts should come before the framework, in pedagogy and in everything else.'),
    B('S-S4-04', 'Spine Letters', 'Haruki Sorensen', 'Art', ART, 2001, 'EN', 'Typography of book spines, with an appendix on why some titles must be read with the head tilted.'),
    B('S-S4-05', '間', '篠原みどり', 'Essays', JLIT, 2003, 'JA', 'Essays on ma, the pause between things, in music, architecture and conversation.'),
    B('S-S4-06', 'Trees I Have Finished', 'Solveig Marr', 'Memoir', PSY, 2020, 'EN', 'A diary of language apps, streaks and the peculiar joy of a completed course that taught nothing.'),
    B('S-S4-07', 'Little Book of Big Numbers', 'R. Halloran', 'Science', MATH, 1998, 'EN', 'Orders of magnitude, from the number of words a child hears to the number of parameters in a model.'),
    B('S-S4-08', 'Collage, Cut-up, Prompt', 'Vera Lindqvist', 'Writing craft', CRAFT, 2021, 'EN', 'Techniques of creative constraint from Dada to language models, with exercises.'),
    B('S-S4-09', 'Test Prep for the Turing Test', 'Anonymous', 'Test prep', 'Test prep & study guides', 2023, 'EN', 'A parody study guide with practice questions for machines hoping to pass as people.'),
    B('S-S4-10', 'The Mind as Weather', 'Edwin Abbot-Kaye', 'Philosophy', PHIL, 1905, 'EN', 'Argues that thoughts are better modelled as fronts and pressures than as sentences, a metaphor the author admits is also a metaphor.')
  ];
  // Fallback posts: dates are given as days before today so the chart always has events in its window.
  var POSTS = [
    { slug: 'sample-metaphors', title: 'Metaphors for the Model', ago: 61, md: '# Metaphors for the Model\n\nEvery metaphor for a language model smuggles in a theory. The interpreter, the parrot, the map, the weather: each says what the machine represents and what it hallucinates. I keep returning to montage, two things placed together making a third idea, because a prompt is a kind of collage and the statistics do the editing. Wittgenstein would call the whole thing a language game; the benchmark people would call it a metric.' },
    { slug: 'sample-acquisition', title: 'Open Questions in Acquisition', ago: 33, md: '# Open Questions in Acquisition\n\nI learned Japanese by immersion and German by stubbornness. Comprehensible input explains some of it, but the theory leads to absurd claims: read enough and you speak like Shakespeare, or like anime. A better pedagogy starts from experiments and avoids philosophy. What we need are numbered problems, Erdős style, about how many words a child hears and how fluent an adult can become.' },
    { slug: 'sample-play', title: 'Research, Humor, Play', ago: 9, md: '# Research, Humor, Play\n\nGenuine research behaves like a joke: a setup, a turn, a punchline the benchmark did not expect. Play needs both form and friction, which is why a game with no rules is boring and a poem with no silence is noise. The dice are thrown, the tide comes in, the loop runs again.' }
  ];
  var API = { BOOKS: BOOKS, POSTS: POSTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.EXCHANGE_SAMPLE = API;
})(typeof window !== 'undefined' ? window : globalThis);
