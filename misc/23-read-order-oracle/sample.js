/*
 * Fallback catalogue for the Read-Order Oracle, used only when
 * ../../assets/data/library.json cannot be fetched (for example when the page
 * is opened from a file:// URL). Every title, author and description below is
 * invented; none of these books exist.
 */
window.ORACLE_SAMPLE = {
  generated: 'sample',
  books: [
    { id: 'S-01', t: 'The Lantern Grammar', a: 'Ines Okonkwo', l: 'EN', g: 'Language study & reference', y: 2014, d: 'A reference grammar of a small island language, with chapters on evidential particles, verb serialisation and the etiquette of counting fish.' },
    { id: 'S-02', t: 'Particles of Politeness', a: 'Ines Okonkwo', l: 'EN', g: 'Language study & reference', y: 2019, d: 'How sentence-final particles carry politeness and doubt across Japanese, Cantonese and the island languages the author studied for The Lantern Grammar.' },
    { id: 'S-03', t: 'Counting Fish in Winter', a: 'Tomas Berg', l: 'EN', g: 'Literature (English & European)', y: 1998, d: 'A novel of a lighthouse keeper who learns the language of the fishing village below and slowly forgets his own; quiet, cold and precise.' },
    { id: 'S-04', t: 'The Keeper\'s Second Winter', a: 'Tomas Berg', l: 'EN', g: 'Literature (English & European)', y: 2003, d: 'Sequel to Counting Fish in Winter. The keeper returns to the village after the lighthouse is automated and finds the language changed.' },
    { id: 'S-05', t: 'Small Models, Long Sentences', a: 'Priya Raman', l: 'EN', g: 'Math, CS & engineering', y: 2023, d: 'A short textbook on training tiny language models, with exercises on tokenisation, attention and why long sentences break small models.' },
    { id: 'S-06', t: 'Attention Is a Kind of Reading', a: 'Priya Raman', l: 'EN', g: 'Math, CS & engineering', y: 2025, d: 'Essays connecting attention in transformer models to how human readers skim, reread and lose their place in long sentences.' },
    { id: 'S-07', t: 'How Children Guess Grammar', a: 'Mara Lindqvist', l: 'EN', g: 'Science', y: 2011, d: 'A study of language acquisition: how children guess grammar from sparse evidence, with experiments on verb endings and counting words.' },
    { id: 'S-08', t: 'The Sparse Evidence Problem', a: 'Mara Lindqvist', l: 'EN', g: 'Science', y: 2017, d: 'Why both children and language models learn grammar from far less data than statistics would predict, and what that says about attention and memory.' },
    { id: 'S-09', t: '灯台守の冬', a: '青山ミナ', l: 'JA', g: 'Japanese literature', y: 2008, d: 'A Japanese novel about a lighthouse keeper on a northern island, his winter routines and the fishing village that stops speaking to him.' },
    { id: 'S-10', t: '雪の文法', a: '青山ミナ', l: 'JA', g: 'Japanese literature', y: 2012, d: 'Linked stories set in a snowbound village school where a teacher invents a grammar of snow words for her pupils.' },
    { id: 'S-11', t: 'Haiku for Bad Weather', a: 'Owen Petrie', l: 'EN', g: 'Literature (English & European)', y: 2020, d: 'Seventy haiku written during a wet year, arranged by season, with a short essay on syllable counting in English.' },
    { id: 'S-12', t: 'The Syllable Ledger', a: 'Owen Petrie', l: 'EN', g: 'Writing, film & literary craft', y: 2022, d: 'A craft book on metre and syllable counting for poets, with drills on haiku, tanka and the sonnet.' },
    { id: 'S-13', t: 'Sonnets from the Server Room', a: 'Dee Alvarez', l: 'EN', g: 'Literature (English & European)', y: 2021, d: 'Poems about night shifts in a data centre, written in strict sonnet form; the metre is counted against the hum of fans.' },
    { id: 'S-14', t: 'Cooling the Machine', a: 'Dee Alvarez', l: 'EN', g: 'Math, CS & engineering', y: 2016, d: 'A practical guide to data centre cooling, fans, airflow and the night shifts that keep servers alive.' },
    { id: 'S-15', t: 'Hymns of the Northern Parish', a: '', l: 'EN', g: 'Religion & theology', y: 1911, d: 'A parish hymnal from a northern fishing town, with responsive readings, a winter liturgy and hymns for those at sea.' },
    { id: 'S-16', t: 'Prayers for Those at Sea', a: 'Rev. Callum Hart', l: 'EN', g: 'Religion & theology', y: 1934, d: 'A small devotional book of prayers and readings for sailors and lighthouse keepers, drawn from the Northern Parish hymnal.' },
    { id: 'S-17', t: 'The Skeptic\'s Liturgy', a: 'Rev. Callum Hart', l: 'EN', g: 'Philosophy & political theory', y: 1950, d: 'A late work in which the minister argues with his own prayers, asking what a liturgy is for once belief has gone.' },
    { id: 'S-18', t: 'What Belief Is For', a: 'Hanna Voss', l: 'EN', g: 'Philosophy & political theory', y: 2009, d: 'A philosophical essay on belief, doubt and practice, answering The Skeptic\'s Liturgy and the pragmatists.' },
    { id: 'S-19', t: 'Doubt as a Habit', a: 'Hanna Voss', l: 'EN', g: 'Psychology, self-help & business', y: 2015, d: 'A self-help book that treats doubt as a habit to train rather than a mood to escape, with exercises and a chapter on decision fatigue.' },
    { id: 'S-20', t: 'Decision Fatigue at Work', a: 'Marcus Quill', l: 'EN', g: 'Psychology, self-help & business', y: 2018, d: 'Business advice on reducing decision fatigue in teams: fewer meetings, habits, defaults and the courage to doubt a plan.' },
    { id: 'S-21', t: 'Fewer Meetings', a: 'Marcus Quill', l: 'EN', g: 'Psychology, self-help & business', y: 2021, d: 'A short manifesto for teams: fewer meetings, written decisions, and defaults that survive a bad week.' },
    { id: 'S-22', t: 'Ink Tide, vol. 1', a: 'Sora Kai', l: 'JA', g: 'Manga & comics', y: 2019, d: 'Manga: a girl who draws sea monsters in the margins of her grammar homework finds that the tide answers her drawings. Volume 1.' },
    { id: 'S-23', t: 'Ink Tide, vol. 2', a: 'Sora Kai', l: 'JA', g: 'Manga & comics', y: 2019, d: 'Manga: the sea monsters from the margins follow her to the lighthouse; the keeper is not surprised. Volume 2.' },
    { id: 'S-24', t: 'Ink Tide, vol. 3', a: 'Sora Kai', l: 'JA', g: 'Manga & comics', y: 2020, d: 'Manga: the final volume. The tide takes the drawings back and the grammar homework is finally handed in. Volume 3.' },
    { id: 'S-25', t: 'Margin Monsters', a: 'Lulu Fenn', l: 'EN', g: 'Manga & comics', y: 2017, d: 'Comics collection about creatures that live in the margins of school notebooks and feed on crossed-out sentences.' },
    { id: 'S-26', t: 'Crossed Out', a: 'Lulu Fenn', l: 'EN', g: 'Writing, film & literary craft', y: 2020, d: 'A craft book on revision: what to cross out, what a crossed-out sentence still does, with examples from comics and poems.' },
    { id: 'S-27', t: 'The Editor\'s Winter', a: 'Ruth Adeyemi', l: 'EN', g: 'Writing, film & literary craft', y: 2013, d: 'Memoir of a fiction editor\'s year: revision, deadlines, the novel that would not end, and a snowbound month with a manuscript.' },
    { id: 'S-28', t: 'Deadlines', a: 'Ruth Adeyemi', l: 'EN', g: 'History & biography', y: 2019, d: 'A history of publishing deadlines from serial novels to weekly manga magazines, and the editors who invented them.' },
    { id: 'S-29', t: 'The Weekly Magazine Century', a: 'Kenji Mori', l: 'EN', g: 'History & biography', y: 2005, d: 'How weekly magazines shaped serial fiction and manga in the twentieth century, with a chapter on deadlines and printing.' },
    { id: 'S-30', t: 'Printing the Sea', a: 'Kenji Mori', l: 'EN', g: 'Art & visual culture', y: 2010, d: 'A visual history of woodblock prints of the sea, tides and lighthouses, from ukiyo-e to modern magazine covers.' },
    { id: 'S-31', t: 'Blue Pigment', a: 'Ada Ferreira', l: 'EN', g: 'Art & visual culture', y: 2015, d: 'The story of blue pigment in printing and painting, from woodblock prints to the printed sea of magazine covers.' },
    { id: 'S-32', t: 'Chemistry of Colour', a: 'Ada Ferreira', l: 'EN', g: 'Science', y: 2018, d: 'Popular science on the chemistry of pigment: why blue was hard, why red fades, and how printing changed both.' },
    { id: 'S-33', t: 'Opera for the Tone-Deaf', a: 'Gil Santoro', l: 'EN', g: 'Music & opera', y: 2001, d: 'A friendly guide to opera plots, voices and why the hymn-like choruses work even on listeners who cannot sing.' },
    { id: 'S-34', t: 'The Chorus Problem', a: 'Gil Santoro', l: 'EN', g: 'Music & opera', y: 2007, d: 'Essays on choruses in opera and hymnals, and the strange fact that a crowd singing badly sounds fine.' },
    { id: 'S-35', t: 'Ghost Roads of the Coast', a: 'Nell Ashby', l: 'EN', g: 'Occult & folklore', y: 1987, d: 'Folklore of a fishing coast: ghost roads, tide omens, and the drowned village whose bells ring in winter.' },
    { id: 'S-36', t: 'Tide Omens', a: 'Nell Ashby', l: 'EN', g: 'Occult & folklore', y: 1992, d: 'A collection of tide superstitions from lighthouse keepers and fishermen, with a chapter on counting waves.' },
    { id: 'S-37', t: 'Exam Kanji in Forty Days', a: 'Yuki Tanabe', l: 'JA', g: 'Test prep & study guides', y: 2016, d: 'A study guide of kanji for entrance exams, drilled in forty daily sets with mnemonics about the sea and weather.' },
    { id: 'S-38', t: 'Grammar Drills for the JLPT', a: 'Yuki Tanabe', l: 'EN/JA', g: 'Test prep & study guides', y: 2018, d: 'Bilingual drills on Japanese grammar and particles for the JLPT, with a section on politeness and sentence-final particles.' },
    { id: 'S-39', t: 'Nursing at Night', a: 'Clara Ibsen', l: 'EN', g: 'Nursing & medical', y: 2012, d: 'A handbook for night-shift nurses: fatigue, decision-making at 3 a.m., and the routines that keep a ward safe.' },
    { id: 'S-40', t: 'The 3 a.m. Decision', a: 'Clara Ibsen', l: 'EN', g: 'Nursing & medical', y: 2016, d: 'Case studies of clinical decisions made on night shifts, and how fatigue and habit shape them.' },
    { id: 'S-41', t: 'Serial Fiction and the Law', a: 'Ben Okafor', l: 'EN', g: 'Politics, law & current affairs', y: 2014, d: 'How copyright and magazine contracts shaped serial fiction and manga, with cases from weekly publishing.' },
    { id: 'S-42', t: 'Coastal Society', a: 'Ben Okafor', l: 'EN', g: 'Society, culture & ideas', y: 2020, d: 'Essays on fishing villages, lighthouse towns and the culture of a coast that is slowly emptying.' }
  ]
};
