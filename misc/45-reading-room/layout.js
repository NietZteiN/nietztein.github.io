/* Reading Room: furniture catalogue and the default floor plan.
 *
 * DEFAULT_LAYOUT is the one obvious constant. "Export layout JSON" in the
 * page's Arrange mode writes exactly this shape ({version, room, pieces}), so
 * a measured layout can be pasted over it. x/y are tile coordinates (one tile
 * is roughly 40 cm), r is the rotation: 0 faces the viewer's lower-left (back
 * against the long wall), 1 faces the lower-right (back against the left wall),
 * 2 and 3 face the walls. Wall pieces (window, calligraphy, clock) use r to
 * pick the wall: 0 = the long back wall (position x), 1 = the left wall (y).
 */
window.ReadingRoomLayout = (function () {
  'use strict';

  // The real bookcases, names and descriptions as in assets/js/bookshelf.js.
  // cols: shelves per column, top to bottom; top: a shelf whose items stand on
  // the top of the unit. w/d/h are in tiles (w, d) and height units (h).
  var UNITS = {
    K: { name: 'Pine library', desc: 'Three pine folding bookcases. Alphabetical by title, with every "The" filed after S, the fifty-one Harvard Classics stacked beneath, and two shelves of Japanese books to the side.',
      wood: 'pine', w: 6, d: 1, h: 5.2,
      cols: [['A to D', 'D to I', 'H to L', 'M to O', 'O to S'], ['S / The A-E', 'The F-O', 'The P-T', 'T-W', 'HC 1-16'], ['HC 17-34', 'HC 35-51', 'JP-1 (Jump, Mill)', 'JP-2 (Ranpo, Witchcraft)']],
      top: 'Top (VN boxes)' },
    H: { name: 'Black bookcase', desc: 'Six shelves: the canon read for school, a writing-craft and screenwriting library, dictionaries, and old test prep.',
      wood: 'black', w: 2, d: 1, h: 5.0, cols: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6']] },
    N: { name: 'Manga case', desc: 'The manga library: 1970s and 80s shōjo and seinen in bunko, seinen runs, visual novels and CDs, plus an Italian shelf.',
      wood: 'white', w: 2, d: 1, h: 5.4, cols: [['N1 (Uffizi)', 'N2 (Berlitz, Catan)', 'N3 (鈴木由美子)', 'N4 (バガボンド, くず)', 'N5 (手塚, 吉田秋生)']], top: 'N-Top (VN boxes, CDs)' },
    B: { name: 'Cherry bookcase', desc: 'Dark cherry shelves with library call-number labels. Almost entirely English humanities.',
      wood: 'cherry', w: 2, d: 1, h: 3.0, cols: [['B1', 'B2', 'B3']] },
    G: { name: 'Library-label shelves', desc: 'Overflow shelves in the same dark cherry, with a nursing stack at one end.',
      wood: 'cherry', w: 2, d: 1, h: 2.2, cols: [['G1', 'G2']] },
    I: { name: 'Cream bookcase', desc: 'English fiction and philosophy, with a visual-novel and illustration corner.',
      wood: 'cream', w: 2, d: 1, h: 2.4, cols: [['I1', 'I2']] },
    L: { name: 'Nursing case', desc: 'Drug guides, pathophysiology and review modules, with a Japanese manga shelf on top.',
      wood: 'white', w: 2, d: 1, h: 2.4, cols: [['L0 (above sticky 16)', 'L1 (sticky 16)']] },
    M: { name: 'Japanese literature shelf', desc: 'Sōseki, Dazai, Mishima, Akutagawa and Murakami in the original, mostly bunko.',
      wood: 'pine', w: 2, d: 1, h: 1.0, cols: [['JP floor shelf']] },
    A: { name: 'Light-wood unit', desc: 'Two mixed shelves by the calligraphy wall.',
      wood: 'lightwood', w: 2, d: 1, h: 2.4, cols: [['A1', 'A2']] },
    D: { name: 'Wire shelf', desc: 'Japanese bunko and test prep.',
      wood: 'wire', w: 1, d: 1, h: 2.8, cols: [['D1', 'D2']] },
    F: { name: 'Headset shelf', desc: 'Manga and art catalogues, next to the VR headset.',
      wood: 'white', w: 1, d: 1, h: 1.5, cols: [['F1']] },
    J: { name: 'Cubby', desc: 'A box of self-help paperbacks.',
      wood: 'cardboard', w: 1, d: 1, h: 0.9, cols: [['Cubby']] },
    Loose: { name: 'Desk and floor', desc: 'Whatever was out being read when the photos were taken.',
      shelves: ['Floor', 'Held (photo 73)', 'Held (photo 96)'] },
  };

  // Everything that can stand in the room. Bookcases are the UNITS above; the
  // rest is the desk (which holds the "Loose" books), seating, light and decor.
  var SPECS = {
    desk: { kind: 'desk', name: 'Desk', unit: 'Loose', w: 3, d: 2, h: 1.9 },
    chair: { kind: 'chair', name: 'Chair', w: 1, d: 1, h: 2.2 },
    lamp: { kind: 'lamp', name: 'Floor lamp', w: 1, d: 1, h: 3.8, light: true },
    plant: { kind: 'plant', name: 'Plant', w: 1, d: 1, h: 2.4 },
    rug: { kind: 'rug', name: 'Rug', w: 5, d: 4, h: 0, flat: true },
    window: { kind: 'window', name: 'Window', w: 3, wall: true },
    calligraphy: { kind: 'calligraphy', name: 'Calligraphy wall', w: 3, wall: true },
    clock: { kind: 'clock', name: 'Clock', w: 1, wall: true },
  };
  Object.keys(UNITS).forEach(function (k) {
    if (k === 'Loose') return;
    var u = UNITS[k];
    SPECS[k] = { kind: 'case', name: u.name, desc: u.desc, unit: k, w: u.w, d: u.d, h: u.h, wood: u.wood, cols: u.cols, top: u.top };
  });

  var GENRE_HUE = {
    'Literature (English & European)': 214, 'Japanese literature': 354, 'Manga & comics': 322, 'Light novels': 282,
    'Writing, film & literary craft': 28, 'History & biography': 14, 'Philosophy & political theory': 248,
    'Religion & theology': 42, 'Society, culture & ideas': 186, 'Politics, law & current affairs': 168,
    'Psychology, self-help & business': 142, 'Art & visual culture': 76, 'Music & opera': 266,
    'Language study & reference': 104, 'Test prep & study guides': 56, 'Math, CS & engineering': 200,
    'Science': 178, 'Nursing & medical': 6, 'Magazines & catalogues': 90, 'Occult & folklore': 300,
    'Games & other objects': 0, 'Unidentified': 0,
  };

  // The default plan. The real floor plan is unknown; this is a sensible guess:
  // the pine library along the long wall, the manga case on the left wall
  // opposite it, the black bookcase by the window, the desk under the window,
  // the floor shelf near the chair, smaller units in the corners.
  var DEFAULT_LAYOUT = {
    version: 1,
    room: { cols: 18, rows: 13 },
    pieces: [
      { id: 'K', x: 1, y: 0, r: 0 },
      { id: 'A', x: 7, y: 0, r: 0 },
      { id: 'D', x: 9, y: 0, r: 0 },
      { id: 'desk', x: 10, y: 0, r: 0 },
      { id: 'F', x: 13, y: 0, r: 0 },
      { id: 'H', x: 14, y: 0, r: 0 },
      { id: 'L', x: 16, y: 0, r: 0 },
      { id: 'N', x: 0, y: 1, r: 1 },
      { id: 'B', x: 0, y: 4, r: 1 },
      { id: 'G', x: 0, y: 7, r: 1 },
      { id: 'I', x: 0, y: 10, r: 1 },
      { id: 'J', x: 0, y: 12, r: 1 },
      { id: 'M', x: 8, y: 3, r: 0 },
      { id: 'chair', x: 11, y: 2, r: 0 },
      { id: 'lamp', x: 13, y: 2, r: 0 },
      { id: 'plant', x: 17, y: 2, r: 0 },
      { id: 'rug', x: 5, y: 5, r: 0 },
      { id: 'window', x: 10, y: 0, r: 0 },
      { id: 'calligraphy', x: 7, y: 0, r: 0 },
      { id: 'clock', x: 0, y: 6, r: 1 },
    ],
  };

  return { UNITS: UNITS, SPECS: SPECS, GENRE_HUE: GENRE_HUE, DEFAULT_LAYOUT: DEFAULT_LAYOUT };
})();
