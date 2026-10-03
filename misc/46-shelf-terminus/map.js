// Terminus: the map. The thirteen bookcase units as stations (names and
// descriptions are the owner's, copied from the site's bookshelf), the river
// that separates the Japanese cases from the English ones, the genre hues the
// rest of the site uses, and the six line colours.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TerminusMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Virtual map is 1000 x 640. lx/ly: label anchor; la: text-align; px/py: where waiting books queue.
  var UNITS = [
    { id: 'K', name: 'Pine library', short: 'Pine', shape: 'square', x: 470, y: 330, lx: 0, ly: 46, la: 'center', px: 0, py: -50,
      desc: 'Three pine folding bookcases. Alphabetical by title, with every "The" filed after S, the fifty-one Harvard Classics stacked beneath, and two shelves of Japanese books to the side.', terminus: true },
    { id: 'H', name: 'Black bookcase', short: 'Black', shape: 'triangle', x: 265, y: 215, lx: -22, ly: -18, la: 'right', px: 24, py: -8,
      desc: 'Six shelves: the canon read for school, a writing-craft and screenwriting library, dictionaries, and old test prep.' },
    { id: 'N', name: 'Manga case', short: 'Manga', shape: 'circle', x: 845, y: 230, lx: 0, ly: -28, la: 'center', px: 26, py: 0,
      desc: 'The manga library: 1970s and 80s shōjo and seinen in bunko, seinen runs, visual novels and CDs, plus an Italian shelf.' },
    { id: 'B', name: 'Cherry bookcase', short: 'Cherry', shape: 'diamond', x: 265, y: 440, lx: -24, ly: 5, la: 'right', px: 24, py: 14,
      desc: 'Dark cherry shelves with library call-number labels. Almost entirely English humanities.' },
    { id: 'G', name: 'Library-label shelves', short: 'Labels', shape: 'pentagon', x: 150, y: 545, lx: 0, ly: 34, la: 'center', px: 24, py: -10,
      desc: 'Overflow shelves in the same dark cherry, with a nursing stack at one end.' },
    { id: 'I', name: 'Cream bookcase', short: 'Cream', shape: 'hexagon', x: 430, y: 140, lx: 0, ly: -26, la: 'center', px: 26, py: 2,
      desc: 'English fiction and philosophy, with a visual-novel and illustration corner.' },
    { id: 'L', name: 'Nursing case', short: 'Nursing', shape: 'cross', x: 650, y: 560, lx: 0, ly: 34, la: 'center', px: 24, py: -12,
      desc: 'Drug guides, pathophysiology and review modules, with a Japanese manga shelf on top.' },
    { id: 'M', name: 'Japanese literature shelf', short: 'JP lit', shape: 'star', x: 880, y: 430, lx: 0, ly: -26, la: 'center', px: -118, py: 2,
      desc: 'Sōseki, Dazai, Mishima, Akutagawa and Murakami in the original, mostly bunko.' },
    { id: 'A', name: 'Light-wood unit', short: 'Light-wood', shape: 'octagon', x: 125, y: 330, lx: 0, ly: -26, la: 'center', px: 24, py: 2,
      desc: 'Two mixed shelves by the calligraphy wall.' },
    { id: 'D', name: 'Wire shelf', short: 'Wire', shape: 'lozenge', x: 790, y: 565, lx: 0, ly: 32, la: 'center', px: 24, py: -12,
      desc: 'Japanese bunko and test prep.' },
    { id: 'F', name: 'Headset shelf', short: 'Headset', shape: 'semicircle', x: 615, y: 165, lx: 0, ly: -24, la: 'center', px: 22, py: 4,
      desc: 'Manga and art catalogues, next to the VR headset.' },
    { id: 'J', name: 'Cubby', short: 'Cubby', shape: 'bar', x: 330, y: 590, lx: 0, ly: 30, la: 'center', px: 22, py: -12,
      desc: 'A box of self-help paperbacks.' },
    { id: 'Loose', name: 'Desk and floor', short: 'Desk', shape: 'ring', x: 560, y: 470, lx: 28, ly: 5, la: 'left', px: -22, py: -22,
      desc: 'Whatever was out being read when the photos were taken.' },
  ];

  var RIVER = [
    { x: 742, y: -10 }, { x: 722, y: 110 }, { x: 745, y: 240 }, { x: 715, y: 380 }, { x: 735, y: 500 }, { x: 712, y: 650 },
  ];

  var GENRE_HUE = {
    'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
    'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
    'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
    'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
    'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
    'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
    'Games & other objects': 0, 'Unidentified': 0,
  };

  var LINE_COLORS = [
    { name: 'Red', hex: '#d8232a' },
    { name: 'Blue', hex: '#1a4fb0' },
    { name: 'Green', hex: '#0c8a4a' },
    { name: 'Orange', hex: '#ef8a16' },
    { name: 'Violet', hex: '#7d3c98' },
    { name: 'Teal', hex: '#0c9aa8' },
  ];

  function stationsFor(counts) {
    return UNITS.map(function (u) {
      return { id: u.id, name: u.name, x: u.x, y: u.y, shape: u.shape, count: counts ? (counts[u.id] || 0) : 0 };
    });
  }

  return { UNITS: UNITS, RIVER: RIVER, GENRE_HUE: GENRE_HUE, LINE_COLORS: LINE_COLORS, stationsFor: stationsFor, W: 1000, H: 640 };
});
