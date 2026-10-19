// Letters with diacritics that build themselves: Й = И + ˘, Ё = Е + ¨,
// à = a + `. The parts are glyphs of the same font, so when the base letter
// or the mark is redrawn, every letter made from them follows.
//
// A composed glyph keeps compose: { base, marks } and ordinary contours (a
// copy of the parts), so export and every other tool see a normal glyph.
// Editing it by hand turns it into a normal glyph (composeOff).
import { glyphBox, clone } from './model.js';

// Combining mark (from Unicode decomposition) -> the spacing mark glyph
// that is drawn for it.
export const MARKS = {
  0x300: 0x60, 0x301: 0xb4, 0x302: 0x2c6, 0x303: 0x2dc, 0x304: 0xaf, 0x306: 0x2d8,
  0x307: 0x2d9, 0x308: 0xa8, 0x30a: 0x2da, 0x30b: 0x2dd, 0x30c: 0x2c7, 0x327: 0xb8, 0x328: 0x2db,
};
const BELOW = new Set([0xb8, 0x2db]);
// Letters whose dot gives way to the mark: i + ` uses ı when it exists.
const DOTLESS = { i: 'ı', j: 'ȷ', 'і': 'ı', 'ј': 'ȷ' };
const GAP = 30; // between stacked marks, font units

// The parts of a character: { base, marks } as characters, or null.
export function partsOf(ch) {
  if (!ch) return null;
  const d = ch.normalize('NFD');
  const cps = [...d].map((c) => c.codePointAt(0));
  if (cps.length < 2) return null;
  const marks = [];
  for (const cp of cps.slice(1)) {
    if (!MARKS[cp]) return null;
    marks.push(String.fromCodePoint(MARKS[cp]));
  }
  return { base: String.fromCodePoint(cps[0]), marks };
}

const drawn = (g) => g && g.contours.length > 0 && !g.compose;
const isUpper = (ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

// What a glyph could be built from in this project:
// { base, marks, missing: [chars of absent or empty parts] } or null.
export function composeInfo(project, g) {
  const ch = g.unicode ? String.fromCodePoint(g.unicode) : '';
  const parts = partsOf(ch);
  if (!parts) return null;
  const byChar = new Map(project.glyphs.filter((x) => x.unicode).map((x) => [String.fromCodePoint(x.unicode), x]));
  let baseCh = parts.base;
  if (DOTLESS[baseCh] && parts.marks.some((m) => !BELOW.has(m.codePointAt(0))) && drawn(byChar.get(DOTLESS[baseCh]))) {
    baseCh = DOTLESS[baseCh];
  }
  const base = byChar.get(baseCh);
  const marks = parts.marks.map((m) => byChar.get(m));
  const missing = [baseCh, ...parts.marks].filter((c, i) => !drawn(i ? marks[i - 1] : base));
  return { baseChar: baseCh, markChars: parts.marks, base, marks, missing, upper: isUpper(parts.base) };
}

// Builds the contours of g from its parts. Returns false when a part is
// missing.
function build(project, g, info) {
  if (info.missing.length) return false;
  const { info: fi } = project;
  const bbox = glyphBox(info.base);
  const contours = clone(info.base.contours);
  let above = bbox.maxY;
  for (let i = 0; i < info.marks.length; i++) {
    const m = info.marks[i];
    const mb = glyphBox(m);
    const cp = info.markChars[i].codePointAt(0);
    // A mark is drawn in its own glyph where it sits on a lowercase letter;
    // capitals get it raised by the difference in height, and it never
    // touches the letter or the mark under it. Marks below (cedilla,
    // ogonek) stay where they are drawn.
    let dy = BELOW.has(cp) ? 0 : (info.upper ? fi.capHeight - fi.xHeight : 0);
    if (!BELOW.has(cp) && mb.minY + dy < above + GAP) dy = above + GAP - mb.minY;
    const dx = cp === 0x2db ? bbox.maxX - mb.maxX // ogonek: at the right foot
      : (bbox.minX + bbox.maxX) / 2 - (mb.minX + mb.maxX) / 2;
    for (const c of clone(m.contours)) {
      for (const n of c.nodes) {
        for (const p of [n, n.in, n.out]) if (p) { p.x = Math.round(p.x + dx); p.y = Math.round(p.y + dy); }
      }
      contours.push(c);
    }
    if (!BELOW.has(cp)) above = Math.max(above, mb.maxY + dy);
  }
  g.contours = contours;
  g.advance = info.base.advance;
  return true;
}

// Updates every composed glyph and composes empty ones whose parts are
// drawn. Returns the glyphs whose outline changed.
export function recompose(project) {
  const changed = [];
  for (const g of project.glyphs) {
    if (g.composeOff || (!g.compose && g.contours.length)) continue;
    const info = composeInfo(project, g);
    if (!info) { delete g.compose; continue; }
    const before = g.compose ? JSON.stringify([g.contours, g.advance]) : null;
    if (!build(project, g, info)) {
      // A part was erased: the letter waits, empty, until it is back.
      if (g.compose && g.contours.length) { g.contours = []; changed.push(g); }
      continue;
    }
    if (!g.compose) {
      g.kernLeft ||= info.base.kernLeft;
      g.kernRight ||= info.base.kernRight;
      if (!g.kernLeft) delete g.kernLeft;
      if (!g.kernRight) delete g.kernRight;
    }
    g.compose = { base: info.base.name, marks: info.marks.map((m) => m.name) };
    if (JSON.stringify([g.contours, g.advance]) !== before) changed.push(g);
  }
  return changed;
}
