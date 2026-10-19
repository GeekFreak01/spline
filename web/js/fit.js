// Fits cubic Bézier curves to a list of points (Philip J. Schneider,
// "An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems 1990).

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function bez(c, t) {
  const mt = 1 - t;
  return add(add(mul(c[0], mt * mt * mt), mul(c[1], 3 * mt * mt * t)), add(mul(c[2], 3 * mt * t * t), mul(c[3], t * t * t)));
}
function bezD1(c, t) {
  const mt = 1 - t;
  return add(add(mul(sub(c[1], c[0]), 3 * mt * mt), mul(sub(c[2], c[1]), 6 * mt * t)), mul(sub(c[3], c[2]), 3 * t * t));
}
function bezD2(c, t) {
  return add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * (1 - t)), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t));
}

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(pts, u, t1, t2) {
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  }
  const segLen = dist(first, last);
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps) { al = ar = segLen / 3; }
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function reparam(c, pts, u) {
  return u.map((t, i) => {
    const d = sub(bez(c, t), pts[i]);
    const d1 = bezD1(c, t), d2 = bezD2(c, t);
    const den = dot(d1, d1) + dot(d, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

function maxError(c, pts, u) {
  let max = 0, idx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(bez(c, u[i]), pts[i]);
    if (d > max) { max = d; idx = i; }
  }
  return [max, idx];
}

// Returns a list of cubic segments [p0, c1, c2, p3] approximating pts.
// t1/t2 are unit tangents at the start (pointing forward) and end (pointing back).
export function fitCubic(pts, t1, t2, tol, out = [], depth = 0) {
  if (pts.length === 2) {
    const d = dist(pts[0], pts[1]) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]);
    return out;
  }
  let u = chordParams(pts);
  let c = generate(pts, u, t1, t2);
  let [err, split] = maxError(c, pts, u);
  if (err < tol) { out.push(c); return out; }
  if (err < tol * 4) {
    for (let k = 0; k < 6; k++) {
      u = reparam(c, pts, u);
      c = generate(pts, u, t1, t2);
      [err, split] = maxError(c, pts, u);
      if (err < tol) { out.push(c); return out; }
    }
  }
  if (depth > 12) { out.push(c); return out; }
  const tc = norm(sub(pts[split - 1], pts[split + 1]));
  fitCubic(pts.slice(0, split + 1), t1, tc, tol, out, depth + 1);
  fitCubic(pts.slice(split), mul(tc, -1), t2, tol, out, depth + 1);
  return out;
}

// One cubic through all of pts (no splitting): returns [curve, max error].
export function fitOne(pts, t1, t2, iterations = 30) {
  let u = chordParams(pts);
  let c = generate(pts, u, t1, t2);
  let best = c, [err] = maxError(c, pts, u);
  for (let k = 0; k < iterations; k++) {
    u = reparam(c, pts, u);
    c = generate(pts, u, t1, t2);
    const [e] = maxError(c, pts, u);
    if (e < err) { best = c; err = e; }
  }
  return [best, err];
}

export const vec = { sub, add, mul, dot, len, norm, dist };
