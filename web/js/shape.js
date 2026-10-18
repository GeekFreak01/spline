// Shape analysis for kerning help: side profiles of glyphs, grouping by the
// shape of a side, and a kerning estimate from the white space between two
// letters.
import { flatten, charOf } from './model.js';

const ROWS = 48;

// Left and right ink edge of a glyph on ROWS horizontal lines between y0 and
// y1: { left: [x | null], right: [x | null], minX, maxX }. null = no ink.
export function profile(g, y0, y1) {
  const polys = g.contours.filter((c) => c.closed && c.nodes.length > 1).map((c) => flatten(c, 16));
  const left = [], right = [];
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < ROWS; i++) {
    const y = y0 + ((i + 0.5) / ROWS) * (y1 - y0);
    let lo = Infinity, hi = -Infinity;
    for (const poly of polys) {
      for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
        const a = poly[k], b = poly[j];
        if ((a.y > y) === (b.y > y)) continue;
        const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    left.push(lo === Infinity ? null : lo);
    right.push(hi === -Infinity ? null : hi);
    if (lo < minX) minX = lo;
    if (hi > maxX) maxX = hi;
  }
  return { left, right, minX, maxX };
}

// How different the shapes of two sides are (font units, average over the
// rows): each side relative to its own outermost point, so spacing does not
// matter. A row with ink on one side only counts as `miss`.
export function sideDistance(a, b, miss) {
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === null && b[i] === null) continue;
    n++;
    sum += a[i] === null || b[i] === null ? miss : Math.abs(a[i] - b[i]);
  }
  return n ? sum / n : Infinity;
}

// Kinds of letters that are grouped and kerned together, with the vertical
// zone that defines their side shape.
export function letterKind(ch) {
  if (/^[A-ZА-ЯЁ]$/.test(ch)) return 'caps';
  if (/^[a-zа-яё]$/.test(ch)) return 'small';
  if (/^[0-9]$/.test(ch)) return 'digits';
  return null;
}

export function kindZone(kind, info) {
  return kind === 'small' ? [info.descender, info.ascender] : [0, info.capHeight];
}

// Side profiles for grouping: offsets from the glyph's outermost point.
function sideShapes(g, info, kind) {
  const [y0, y1] = kindZone(kind, info);
  const p = profile(g, y0, y1);
  return {
    left: p.left.map((x) => (x === null ? null : x - p.minX)),
    right: p.right.map((x) => (x === null ? null : p.maxX - x)),
  };
}

// Proposes groups for one side of the given glyphs (drawn base letters):
// complete-linkage clustering, glyphs end up together when every pair in a
// group differs by less than `tolerance` font units on average.
export function proposeGroups(glyphs, info, side, tolerance) {
  const miss = info.unitsPerEm * 0.25;
  const out = [];
  const byKind = new Map();
  for (const g of glyphs) {
    const kind = letterKind(charOf(g));
    if (!kind || !g.contours.length) continue;
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push({ g, shape: sideShapes(g, info, kind)[side] });
  }
  for (const items of byKind.values()) {
    const n = items.length;
    const d = items.map((a) => items.map((b) => sideDistance(a.shape, b.shape, miss)));
    let clusters = items.map((_, i) => [i]);
    for (;;) {
      let best = null;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          let worst = 0;
          for (const a of clusters[i]) for (const b of clusters[j]) worst = Math.max(worst, d[a][b]);
          if (worst < tolerance && (!best || worst < best.worst)) best = { i, j, worst };
        }
      }
      if (!best) break;
      clusters[best.i] = clusters[best.i].concat(clusters[best.j]);
      clusters.splice(best.j, 1);
    }
    if (n) for (const c of clusters) out.push(c.map((i) => items[i].g));
  }
  return out;
}

// White space between two letters set next to each other without kerning:
// `close` is the average of the `k` tightest rows where both letters have
// ink. That is where the eye reads the distance (a thin foot or arm counts),
// while open space elsewhere is left to the letters' own spacing. `tight`
// is the closest row.
export function pairGap(L, R, zone, k = 3) {
  const [y0, y1] = zone;
  const a = profile(L, y0, y1), b = profile(R, y0, y1);
  const rows = [];
  for (let i = 0; i < ROWS; i++) {
    if (a.right[i] === null || b.left[i] === null) continue;
    rows.push(L.advance - a.right[i] + b.left[i]);
  }
  if (!rows.length) return null;
  rows.sort((x, y) => x - y);
  const n = Math.min(k, rows.length);
  return { close: rows.slice(0, n).reduce((sum, v) => sum + v, 0) / n, tight: rows[0] };
}
