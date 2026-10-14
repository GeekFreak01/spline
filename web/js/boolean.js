// Boolean operations on Bézier outlines (union, subtract, intersect,
// exclude, divide, remove overlap). Geometry is done by Paper.js, which keeps
// curves intact: only the parts near intersections change.
import { flatten, polyBox, pointInPolygon, signedArea } from './model.js';

let scope = null;
function paperScope() {
  if (!scope) {
    const P = window.paper;
    if (!P) throw new Error('Paper.js is not loaded');
    scope = new P.PaperScope();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    scope.setup(cv);
  }
  scope.activate();
  return scope;
}

// ------------------------------------------------------------ conversion

function toPaper(contours) {
  const P = paperScope();
  const children = contours.filter((c) => c.nodes.length >= 2).map((c) => new P.Path({
    insert: false,
    closed: true,
    segments: c.nodes.map((n) => new P.Segment(
      new P.Point(n.x, n.y),
      n.in ? new P.Point(n.in.x - n.x, n.in.y - n.y) : null,
      n.out ? new P.Point(n.out.x - n.x, n.out.y - n.y) : null,
    )),
  }));
  return new P.CompoundPath({ children, fillRule: 'nonzero', insert: false });
}

function paths(item, out = []) {
  if (!item) return out;
  if (item.className === 'Path') out.push(item);
  else (item.children || []).forEach((ch) => paths(ch, out));
  return out;
}

const r1 = (v) => Math.round(v * 10) / 10;

function fromPaper(item) {
  const out = [];
  for (const p of paths(item)) {
    if (p.segments.length < 2 || Math.abs(p.area) < 1) continue;
    const nodes = p.segments.map((s) => {
      const n = { x: r1(s.point.x), y: r1(s.point.y) };
      if (!s.handleIn.isZero()) n.in = { x: r1(s.point.x + s.handleIn.x), y: r1(s.point.y + s.handleIn.y) };
      if (!s.handleOut.isZero()) n.out = { x: r1(s.point.x + s.handleOut.x), y: r1(s.point.y + s.handleOut.y) };
      if (n.in && n.out) {
        const a = Math.atan2(-s.handleIn.y, -s.handleIn.x), b = Math.atan2(s.handleOut.y, s.handleOut.x);
        n.smooth = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.02;
      }
      return n;
    });
    out.push({ closed: true, nodes });
  }
  return out;
}

// ------------------------------------------------------------ operations

const op = (name) => (a, b) => fromPaper(toPaper(a)[name](toPaper(b), { insert: false }));

/** Area covered by a or b. */
export const unite = op('unite');
/** Area of a not covered by b. */
export const subtract = op('subtract');
/** Area covered by both a and b. */
export const intersect = op('intersect');
/** Area covered by exactly one of a and b. */
export const exclude = op('exclude');

/** Merges every overlapping part of the outline into one clean shape. */
export function removeOverlap(contours) {
  if (!contours.length) return contours;
  const P = paperScope();
  const empty = new P.Path({ insert: false });
  return fromPaper(toPaper(contours).unite(empty, { insert: false }));
}

// Groups contours into shapes: each outer contour together with the holes
// that lie completely inside it, so a letter "O" is treated as one shape.
export function shapesOf(all, picked) {
  const polys = all.map((c) => flatten(c, 8));
  const boxes = polys.map(polyBox);
  const inside = (i, j) => {
    const a = boxes[i], b = boxes[j];
    if (!(a.minX >= b.minX && a.maxX <= b.maxX && a.minY >= b.minY && a.maxY <= b.maxY)) return false;
    return polys[i].every((p) => pointInPolygon(p, polys[j]));
  };
  const isHole = (i) => signedArea(polys[i]) < 0;
  const used = new Set();
  const shapes = [];
  for (const i of [...picked].sort((x, y) => x - y)) {
    if (used.has(i)) continue;
    if (isHole(i) && all.some((_, j) => j !== i && !isHole(j) && picked.has(j) && inside(i, j))) continue;
    const members = [i];
    used.add(i);
    if (!isHole(i)) {
      all.forEach((_, j) => {
        if (j !== i && !used.has(j) && isHole(j) && inside(j, i)) { members.push(j); used.add(j); }
      });
    }
    shapes.push(members);
  }
  return shapes; // arrays of contour indices, back to front
}

/**
 * Runs a vector-editor style path operation on shapes (arrays of contours,
 * back to front). Returns the resulting contours.
 *  unite     everything merged
 *  subtract  front-most shape cut out of the others
 *  intersect only the area common to all shapes
 *  exclude   areas covered an odd number of times
 *  divide    split into separate non-overlapping pieces
 */
export function pathOperation(kind, shapes) {
  if (shapes.length < 2) {
    if (kind === 'unite' && shapes.length === 1) return removeOverlap(shapes[0]);
    return null;
  }
  const merge = (list) => list.reduce((acc, s) => unite(acc, s));
  switch (kind) {
    case 'unite': return merge(shapes);
    case 'subtract': return subtract(merge(shapes.slice(0, -1)), shapes[shapes.length - 1]);
    case 'intersect': return shapes.slice(1).reduce((acc, s) => intersect(acc, s), shapes[0]);
    case 'exclude': return shapes.slice(1).reduce((acc, s) => exclude(acc, s), shapes[0]);
    case 'divide': {
      let pieces = [shapes[0]];
      for (const s of shapes.slice(1)) {
        const next = [];
        for (const p of pieces) {
          next.push(intersect(p, s), subtract(p, s));
        }
        next.push(subtract(s, merge(pieces)));
        pieces = next.filter((p) => p.length);
      }
      return pieces.flat();
    }
  }
  return null;
}
