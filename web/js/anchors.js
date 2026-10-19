// Anchors (extended mode): named points that put marks onto letters and
// join handwriting. A letter has "top"/"bottom", a mark has "_top"/"_bottom"
// at the point that should touch the letter's anchor; "entry"/"exit" are
// where a script letter is joined from the previous one and to the next.
import { glyphBox, outline } from './model.js';

const GAP = 30; // between a letter and its mark, font units

export const anchorOf = (g, name) => g?.anchors?.find((a) => a.name === name) || null;

export function isMarkGlyph(g) {
  const ch = g.unicode ? String.fromCodePoint(g.unicode) : '';
  return /^[\p{Mn}\p{Sk}]$/u.test(ch) || !!g.anchors?.some((a) => a.name.startsWith('_'));
}

// Anchor names that make sense for this glyph and are not there yet.
export function suggestedAnchors(g) {
  const names = isMarkGlyph(g) ? ['_top', '_bottom', 'top'] : ['top', 'bottom', 'entry', 'exit'];
  return names.filter((n) => !anchorOf(g, n));
}

// Where an anchor goes by default, from the outline.
export function defaultAnchor(g, name) {
  const box = glyphBox(g);
  if (!box) return { name, x: Math.round(g.advance / 2), y: 0 };
  const cx = Math.round((box.minX + box.maxX) / 2);
  if (name === 'top') return { name, x: cx, y: Math.round(box.maxY) };
  if (name === 'bottom') return { name, x: cx, y: Math.round(box.minY) };
  if (name === '_top') return { name, x: cx, y: Math.round(box.minY - GAP) };
  if (name === '_bottom') return { name, x: cx, y: Math.round(box.maxY + GAP) };
  // entry / exit: the leftmost and rightmost points of the outline.
  let best = null;
  for (const c of outline(g)) {
    for (const n of c.nodes) {
      if (!best || (name === 'entry' ? n.x < best.x : n.x > best.x)) best = n;
    }
  }
  return { name, x: Math.round(best.x), y: Math.round(best.y) };
}

// Offset that puts mark m onto base b by anchors (_top onto top, _bottom
// onto bottom), or null when they do not have matching anchors.
export function attachOffset(b, m) {
  for (const n of ['top', 'bottom']) {
    const ba = anchorOf(b, n), ma = anchorOf(m, '_' + n);
    if (ba && ma) return { dx: ba.x - ma.x, dy: ba.y - ma.y };
  }
  return null;
}
