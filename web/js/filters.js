// Shape filters (extended mode): thicken/thin, round corners, stroke an
// outline, handle length (Fit Curve). Each takes contours and returns new
// ones; the editor shows the result as a preview before it is applied.
import { segments, insertNode, flatten, signedArea } from './model.js';

const clone = (o) => structuredClone(o);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
const r = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });

// Directions in and out of node i: the handles when there are any, else
// the neighbouring points.
function tangents(c, i) {
  const n = c.nodes.length, p = c.nodes[i];
  const prev = c.nodes[(i - 1 + n) % n], next = c.nodes[(i + 1) % n];
  const hasPrev = c.closed || i > 0, hasNext = c.closed || i < n - 1;
  let tin = hasPrev ? unit(sub(p, p.in && len(sub(p, p.in)) > 0.01 ? p.in : (prev.out || prev))) : null;
  let tout = hasNext ? unit(sub(p.out && len(sub(p.out, p)) > 0.01 ? p.out : (next.in || next), p)) : null;
  if (!tin) tin = tout;
  if (!tout) tout = tin;
  return { tin, tout };
}

// Moves every point sideways by d along the outline's normal: positive
// grows a filled shape (its contour runs counter-clockwise, holes the other
// way), negative thins it. Corners keep sharp (mitred, with a limit).
function offsetContour(c, d) {
  const out = clone(c);
  const ccw = signedArea(flatten(c, 6)) > 0;
  const s = ccw ? 1 : -1; // right-hand normal points outwards for CCW
  c.nodes.forEach((p, i) => {
    const { tin, tout } = tangents(c, i);
    const nIn = { x: tin.y * s, y: -tin.x * s }, nOut = { x: tout.y * s, y: -tout.x * s };
    let nx = nIn.x + nOut.x, ny = nIn.y + nOut.y;
    let l = Math.hypot(nx, ny);
    if (l < 1e-6) { nx = nIn.x; ny = nIn.y; l = 1; }
    nx /= l; ny /= l;
    const cos = nx * nIn.x + ny * nIn.y;
    const k = d / Math.max(cos, 0.35); // mitre, limited for very sharp corners
    const m = { x: nx * k, y: ny * k };
    const q = out.nodes[i];
    q.x = p.x + m.x; q.y = p.y + m.y;
    // Handles move with their side's own normal, so curves stay parallel.
    if (p.in) q.in = { x: p.in.x + nIn.x * d, y: p.in.y + nIn.y * d };
    if (p.out) q.out = { x: p.out.x + nOut.x * d, y: p.out.y + nOut.y * d };
  });
  for (const q of out.nodes) {
    Object.assign(q, r(q));
    if (q.in) q.in = r(q.in);
    if (q.out) q.out = r(q.out);
  }
  return out;
}

export function offsetContours(contours, d) {
  return contours.map((c) => (c.closed && c.nodes.length > 2 ? offsetContour(c, d) : clone(c)));
}

// Length of a segment, roughly.
function segLength(s) {
  if (s.line) return len(sub(s.p3, s.p0));
  const pts = flatten({ closed: false, nodes: [{ ...s.p0, out: s.c1 }, { ...s.p3, in: s.c2 }] }, 16);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len(sub(pts[i], pts[i - 1]));
  return L + len(sub(s.p3, pts[pts.length - 1]));
}

// Rounds the sharp corners with radius `radius`. A corner is a point
// whose two sides do not continue each other.
export function roundCorners(contours, radius) {
  return contours.map((c0) => {
    if (!c0.closed || c0.nodes.length < 3 || radius <= 0) return clone(c0);
    const c = clone(c0);
    for (let i = c.nodes.length - 1; i >= 0; i--) {
      const n = c.nodes.length;
      const { tin, tout } = tangents(c, i);
      if (tin.x * tout.x + tin.y * tout.y > 0.97) continue; // smooth already
      const segs = segments(c);
      const before = segs[(i - 1 + n) % n], after = segs[i];
      const Lb = segLength(before), La = segLength(after);
      const rr = Math.min(radius, Lb * 0.45, La * 0.45);
      if (rr < 1) continue;
      const corner = { x: c.nodes[i].x, y: c.nodes[i].y };
      // Point A on the side after the corner, point B on the side before.
      const A = insertNode(c, after, rr / La);
      const segs2 = segments(c);
      const bi = (c.nodes.indexOf(c.nodes[i]) - 1 + c.nodes.length) % c.nodes.length;
      const B = insertNode(c, segs2[bi], 1 - rr / Lb);
      const ci = c.nodes.indexOf(B) + 1;
      c.nodes.splice(ci % c.nodes.length, 1);
      const k = 0.55;
      B.out = { x: B.x + (corner.x - B.x) * k, y: B.y + (corner.y - B.y) * k };
      A.in = { x: A.x + (corner.x - A.x) * k, y: A.y + (corner.y - A.y) * k };
      for (const q of [A, B]) {
        Object.assign(q, r(q));
        if (q.in) q.in = r(q.in);
        if (q.out) q.out = r(q.out);
        q.smooth = !!(q.in && q.out);
      }
      i = Math.min(i, c.nodes.length);
    }
    return c;
  });
}

// Turns lines and outlines into strokes of width w: an open path becomes a
// closed band with square ends, a closed contour becomes a ring.
export function strokeContours(contours, w) {
  const out = [];
  for (const c of contours) {
    if (c.nodes.length < 2 || w <= 0) { out.push(clone(c)); continue; }
    if (c.closed) {
      const a = offsetContour(c, w / 2), b = offsetContour(c, -w / 2);
      out.push(a, b);
      continue;
    }
    // Open path: one side forward, the other back.
    const left = offsetContour({ ...c, closed: false }, w / 2);
    const right = offsetContour({ ...c, closed: false }, -w / 2);
    const back = clone(right);
    back.nodes.reverse();
    for (const q of back.nodes) [q.in, q.out] = [q.out, q.in];
    for (const q of back.nodes) { if (!q.in) delete q.in; if (!q.out) delete q.out; }
    const L = left.nodes, B = back.nodes;
    delete L[L.length - 1].out; delete B[0].in; delete B[B.length - 1].out; delete L[0].in;
    out.push({ closed: true, nodes: [...L, ...B] });
  }
  return out;
}

// Fit Curve: sets the handles of every curve to `pct` of the way to the
// point where the two handle lines meet (55% is a circle-like curve).
export function fitCurves(contours, pct) {
  const f = pct / 100;
  return contours.map((c0) => {
    const c = clone(c0);
    for (const s of segments(c)) {
      if (s.line) continue;
      const a = c.nodes[s.i], b = c.nodes[(s.i + 1) % c.nodes.length];
      if (!a.out || !b.in) continue;
      const d1 = sub(a.out, a), d2 = sub(b.in, b);
      const den = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(den) < 1e-6) continue; // parallel handles: no corner point
      const t = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / den;
      const u = ((b.x - a.x) * d1.y - (b.y - a.y) * d1.x) / den;
      if (t <= 0 || u <= 0) continue;
      const X = { x: a.x + d1.x * t, y: a.y + d1.y * t };
      const keepA = a.in && a.smooth, keepB = b.out && b.smooth;
      a.out = r({ x: a.x + (X.x - a.x) * f, y: a.y + (X.y - a.y) * f });
      b.in = r({ x: b.x + (X.x - b.x) * f, y: b.y + (X.y - b.y) * f });
      // A smooth point keeps its other handle on the same line.
      if (keepA) { const l = len(sub(a.in, a)), v = unit(sub(a, a.out)); a.in = r({ x: a.x + v.x * l, y: a.y + v.y * l }); }
      if (keepB) { const l = len(sub(b.out, b)), v = unit(sub(b, b.in)); b.out = r({ x: b.x + v.x * l, y: b.y + v.y * l }); }
    }
    return c;
  });
}
