// "Simplify outline": removes points that do not change the shape, so a
// letter drawn with the brush or imported from SVG becomes easy to edit.
//
//  - points on top of each other are merged;
//  - handles of zero length or lying on a straight segment are dropped;
//  - a corner point in the middle of a straight line is removed;
//  - two curves meeting smoothly become one curve when it stays within
//    `tol` font units of the original. Points with horizontal or vertical
//    handles (extremes) are kept: fonts render best with them.
import { fitOne, vec } from './fit.js';
import { segments, pointAt, insertNode } from './model.js';

const near = (a, b, e) => Math.abs(a.x - b.x) <= e && Math.abs(a.y - b.y) <= e;

// Distance from p to the segment a-b.
function distToLine(p, a, b) {
  const d = vec.sub(b, a), l2 = vec.dot(d, d);
  if (!l2) return vec.dist(p, a);
  const t = Math.max(0, Math.min(1, vec.dot(vec.sub(p, a), d) / l2));
  return vec.dist(p, vec.add(a, vec.mul(d, t)));
}

const isExtreme = (n, h) => {
  if (!h) return false;
  const a = Math.abs(Math.atan2(h.y - n.y, h.x - n.x)) % (Math.PI / 2);
  return Math.min(a, Math.PI / 2 - a) < 0.035; // ~2°
};

function cleanHandles(c, eps) {
  for (const n of c.nodes) {
    if (n.in && near(n.in, n, eps)) delete n.in;
    if (n.out && near(n.out, n, eps)) delete n.out;
  }
  // A curve whose handles lie on its chord is a straight line.
  for (const s of segments(c)) {
    if (s.line) continue;
    const a = s.p0, b = s.p3;
    if (distToLine(s.c1, a, b) <= eps && distToLine(s.c2, a, b) <= eps) { delete a.out; delete b.in; }
  }
  for (const n of c.nodes) if (!n.in || !n.out) n.smooth = false;
}

function mergeDuplicates(c, eps) {
  const out = [];
  for (const n of c.nodes) {
    const prev = out[out.length - 1];
    if (prev && near(prev, n, eps)) { if (n.out) prev.out = n.out; else delete prev.out; continue; }
    out.push(n);
  }
  if (c.closed && out.length > 1 && near(out[0], out[out.length - 1], eps)) {
    const last = out.pop();
    if (last.in) out[0].in = last.in; else delete out[0].in;
  }
  c.nodes = out;
}

function removeCollinear(c, eps) {
  let changed = true;
  while (changed && c.nodes.length > 3) {
    changed = false;
    const n = c.nodes.length;
    for (let i = c.closed ? 0 : 1; i < (c.closed ? n : n - 1); i++) {
      const a = c.nodes[(i - 1 + n) % n], p = c.nodes[i], b = c.nodes[(i + 1) % n];
      if (p.in || p.out || a.out || b.in) continue;
      if (distToLine(p, a, b) <= eps) { c.nodes.splice(i, 1); changed = true; break; }
    }
  }
}

// Joins the curves on both sides of node i into one when it fits.
function tryMerge(c, i, tol) {
  const n = c.nodes.length;
  const a = c.nodes[(i - 1 + n) % n], p = c.nodes[i], b = c.nodes[(i + 1) % n];
  if (!p.in || !p.out || !a.out || !b.in) return false;
  if (isExtreme(p, p.in) || isExtreme(p, p.out)) return false;
  // Only smooth joins: a corner is part of the design.
  const t1 = vec.norm(vec.sub(p, p.in)), t2 = vec.norm(vec.sub(p.out, p));
  if (vec.dot(t1, t2) < 0.97) return false;
  const s1 = { line: false, p0: a, c1: a.out, c2: p.in, p3: p };
  const s2 = { line: false, p0: p, c1: p.out, c2: b.in, p3: b };
  const pts = [];
  for (let k = 0; k < 16; k++) pts.push(pointAt(s1, k / 16));
  for (let k = 0; k <= 16; k++) pts.push(pointAt(s2, k / 16));
  const ta = vec.norm(vec.sub(a.out, a)), tb = vec.norm(vec.sub(b.in, b));
  const [[, c1, c2], err] = fitOne(pts, ta, tb);
  if (err > tol * 2) return false;
  // The fit is checked at its own parameters; check the real distance too.
  const seg = { line: false, p0: a, c1, c2, p3: b };
  const dense = [];
  for (let k = 0; k <= 64; k++) dense.push(pointAt(seg, k / 64));
  const within = (from, to) => from.every((q) => {
    for (let k = 1; k < to.length; k++) if (distToLine(q, to[k - 1], to[k]) <= tol) return true;
    return false;
  });
  if (!within(pts, dense) || !within(dense, pts)) return false;
  a.out = { x: Math.round(c1.x), y: Math.round(c1.y) };
  b.in = { x: Math.round(c2.x), y: Math.round(c2.y) };
  c.nodes.splice(i, 1);
  return true;
}

function mergeCurves(c, tol) {
  let changed = true;
  while (changed && c.nodes.length > (c.closed ? 3 : 2)) {
    changed = false;
    const n = c.nodes.length;
    for (let i = c.closed ? 0 : 1; i < (c.closed ? n : n - 1); i++) {
      if (tryMerge(c, i, tol)) { changed = true; break; }
    }
  }
}

// Simplifies contours in place; returns how many points were removed.
export function simplifyContours(contours, tol = 1.5) {
  let removed = 0;
  for (const c of contours) {
    const before = c.nodes.length;
    mergeDuplicates(c, 0.5);
    cleanHandles(c, 0.5);
    removeCollinear(c, 0.5);
    mergeCurves(c, tol);
    removed += before - c.nodes.length;
  }
  return removed;
}

// Parameters (0..1) where one coordinate of a cubic has a zero derivative.
function extremeTs(a, b, c, d) {
  const A = -a + 3 * b - 3 * c + d, B = 2 * (a - 2 * b + c), C = b - a;
  if (Math.abs(A) < 1e-9) return Math.abs(B) < 1e-9 ? [] : [-C / B];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const r = Math.sqrt(disc);
  return [(-B + r) / (2 * A), (-B - r) / (2 * A)];
}

// Adds points where curves are horizontal or vertical (their extremes) to
// the contours (all, or those whose index is in `only`). Returns how many.
export function addExtremesTo(contours, only = null) {
  let added = 0;
  contours.forEach((c, ci) => {
    if (only?.size && !only.has(ci)) return;
    for (const s of segments(c).reverse()) {
      if (s.line) continue;
      const ts = [...extremeTs(s.p0.x, s.c1.x, s.c2.x, s.p3.x), ...extremeTs(s.p0.y, s.c1.y, s.c2.y, s.p3.y)]
        .filter((t) => t > 0.02 && t < 0.98).sort((a, b) => b - a)
        .filter((t, i, a) => i === 0 || a[i - 1] - t > 0.02);
      // Split from the end: the part before each split keeps its shape,
      // only its parameter shrinks.
      let seg = s, prev = 1;
      for (const t of ts) {
        const node = insertNode(c, seg, t / prev);
        node.x = Math.round(node.x); node.y = Math.round(node.y);
        const flat = Math.abs(node.out.y - node.in.y) < Math.abs(node.out.x - node.in.x);
        for (const h of [node.in, node.out]) { if (flat) h.y = node.y; else h.x = node.x; h.x = Math.round(h.x); h.y = Math.round(h.y); }
        added++;
        seg = segments(c)[s.i];
        prev = t;
      }
    }
  });
  return added;
}
