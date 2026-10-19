// Contour surgery (extended mode): open a corner into "ears", reconnect
// ears back into a corner, delete the segment between two points.
//
// Open Corner extends both sides of a sharp point past it (curves exactly,
// by evaluating the Bézier beyond its end), so the two segments cross at
// the old point and a short line joins their new ends. Reconnect finds
// where the segment before a pair of points crosses the one after it and
// cuts both there: one sharp point again.

const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const round = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });

// The cubic between nodes a and b; line when neither has a handle there.
function cubic(a, b) {
  return { line: !a.out && !b.in, p0: a, c1: a.out || a, c2: b.in || b, p3: b };
}

// de Casteljau at t (any t: outside 0..1 it extends the curve).
function split(s, t) {
  const p01 = lerp(s.p0, s.c1, t), p12 = lerp(s.c1, s.c2, t), p23 = lerp(s.c2, s.p3, t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return { left: [s.p0, p01, p012, m], right: [m, p123, p23, s.p3] };
}

function at(s, t) {
  return s.line ? lerp(s.p0, s.p3, t) : split(s, t).left[3];
}

const prevIndex = (c, i) => (i > 0 ? i - 1 : c.closed ? c.nodes.length - 1 : -1);
const nextIndex = (c, i) => (i < c.nodes.length - 1 ? i + 1 : c.closed ? 0 : -1);

// Opens the sharp point i of contour c into ears `d` units long. Returns
// false when the point has no segment on one side.
export function openCorner(c, i, d = 30) {
  const ip = prevIndex(c, i), inx = nextIndex(c, i);
  if (ip < 0 || inx < 0 || c.nodes.length < 3) return false;
  const prev = c.nodes[ip], P = c.nodes[i], next = c.nodes[inx];
  const sIn = cubic(prev, P), sOut = cubic(P, next);
  // Only a real corner: the two sides must not go on in one line.
  const apart = (...qs) => qs.find((q) => len(sub(q, P)) > 1e-6) || P;
  const tIn = sub(P, apart(sIn.c2, sIn.c1, prev));
  const tOut = sub(apart(sOut.c1, sOut.c2, next), P);
  if (Math.abs(tIn.x * tOut.y - tIn.y * tOut.x) / ((len(tIn) * len(tOut)) || 1) < 0.1) return false;
  // The end of the incoming segment, moved d past P.
  let P1;
  if (sIn.line) {
    const v = sub(P, prev), l = len(v) || 1;
    P1 = round({ x: P.x + v.x / l * d, y: P.y + v.y / l * d });
  } else {
    let tan = sub(sIn.p3, sIn.c2);
    if (len(tan) < 1e-6) tan = sub(sIn.p3, sIn.c1);
    const speed = 3 * len(tan) || 1;
    const ext = split(sIn, 1 + d / speed).left;
    prev.out = round(ext[1]);
    P1 = { ...round(ext[3]), in: round(ext[2]) };
  }
  // The start of the outgoing segment, moved d back before P.
  let P2;
  if (sOut.line) {
    const v = sub(next, P), l = len(v) || 1;
    P2 = round({ x: P.x - v.x / l * d, y: P.y - v.y / l * d });
  } else {
    let tan = sub(sOut.c1, sOut.p0);
    if (len(tan) < 1e-6) tan = sub(sOut.c2, sOut.p0);
    const speed = 3 * len(tan) || 1;
    const ext = split(sOut, -d / speed).right;
    next.in = round(ext[2]);
    P2 = { ...round(ext[0]), out: round(ext[1]) };
  }
  P1.smooth = false;
  P2.smooth = false;
  c.nodes.splice(i, 1, P1, P2);
  return true;
}

// Where segments a and b cross: [ta, tb] or null. Sampled, then refined.
function crossing(a, b) {
  const N = 64;
  const pa = Array.from({ length: N + 1 }, (_, k) => at(a, k / N));
  const pb = Array.from({ length: N + 1 }, (_, k) => at(b, k / N));
  let best = null;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = pa[i], r = sub(pa[i + 1], p), q = pb[j], s = sub(pb[j + 1], q);
      const den = r.x * s.y - r.y * s.x;
      if (Math.abs(den) < 1e-9) continue;
      const qp = sub(q, p);
      const u = (qp.x * s.y - qp.y * s.x) / den, v = (qp.x * r.y - qp.y * r.x) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const ta = (i + u) / N, tb = (j + v) / N;
      // The crossing nearest the ears: late on a, early on b.
      if (!best || ta - tb > best[0] - best[1]) best = [ta, tb];
    }
  }
  if (!best) return null;
  // Newton on A(ta) − B(tb) = 0, with numeric derivatives.
  let [ta, tb] = best;
  const h = 1e-5;
  for (let k = 0; k < 8; k++) {
    const A = at(a, ta), B = at(b, tb);
    const fx = A.x - B.x, fy = A.y - B.y;
    if (Math.hypot(fx, fy) < 1e-4) break;
    const da = sub(at(a, ta + h), A), db = sub(at(b, tb + h), B);
    const ax = da.x / h, ay = da.y / h, bx = -db.x / h, by = -db.y / h;
    const det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-12) break;
    ta -= (fx * by - fy * bx) / det;
    tb -= (ax * fy - ay * fx) / det;
  }
  return ta >= -0.01 && ta <= 1.01 && tb >= -0.01 && tb <= 1.01 ? [ta, tb] : best;
}

// Reconnects the ears at points i and i+1 of c: cuts the segment before
// them and the one after at their crossing. Returns false when they do
// not cross.
export function reconnect(c, i) {
  const j = nextIndex(c, i);
  if (j < 0) return false;
  const ip = prevIndex(c, i), jn = nextIndex(c, j);
  if (ip < 0 || jn < 0 || ip === j || c.nodes.length < 4) return false;
  const prev = c.nodes[ip], next = c.nodes[jn];
  const sIn = cubic(prev, c.nodes[i]), sOut = cubic(c.nodes[j], next);
  const hit = crossing(sIn, sOut);
  if (!hit) return false;
  const [ta, tb] = hit;
  const X = { smooth: false };
  if (sIn.line) Object.assign(X, round(lerp(sIn.p0, sIn.p3, ta)));
  else {
    const l = split(sIn, ta).left;
    prev.out = round(l[1]);
    Object.assign(X, round(l[3]), { in: round(l[2]) });
  }
  if (!sOut.line) {
    const r = split(sOut, tb).right;
    next.in = round(r[2]);
    X.out = round(r[1]);
  }
  // Remove i and j, put X where i was.
  if (j > i) c.nodes.splice(i, 2, X);
  else { c.nodes.splice(i, 1, X); c.nodes.splice(0, 1); }
  return true;
}

// Deletes the segment between two neighbouring points of c. A closed
// contour opens there; an open one splits in two. Returns the contours
// that replace c, or null when the points are not neighbours.
export function deleteSegment(c, i, j) {
  const n = c.nodes.length;
  if (j === (i + n - 1) % n && !(i === n - 1 && j === 0 && !c.closed)) [i, j] = [j, i];
  const neighbours = j === i + 1 || (c.closed && i === n - 1 && j === 0);
  if (!neighbours) return null;
  const nodes = c.nodes.map((x) => ({ ...x }));
  delete nodes[i].out;
  delete nodes[j].in;
  nodes[i].smooth = false;
  nodes[j].smooth = false;
  if (c.closed) return [{ ...c, closed: false, nodes: [...nodes.slice(j), ...nodes.slice(0, j)] }];
  return [nodes.slice(0, i + 1), nodes.slice(j)].filter((ns) => ns.length > 1).map((ns) => ({ ...c, closed: false, nodes: ns }));
}
