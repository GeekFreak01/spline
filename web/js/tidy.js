// Tidy up: what a contour can lose without changing its shape. A plan is a
// list of steps keyed by contour and point, so it can be checked against
// the other masters first and applied to all of them alike.

const NEAR = 0.5; // font units: closer than this is "the same place"

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Steps for the contours whose index is in targets (all when empty):
//   noIn / noOut  a handle lying on its own point;
//   merge         a point on top of the next one: they become one;
//   drop          a point in the middle of a straight line;
//   smooth        a corner point whose two handles lie on one line.
export function tidyPlan(contours, targets = null) {
  const steps = [];
  contours.forEach((c, ci) => {
    if (targets?.size && !targets.has(ci)) return;
    const ns = c.nodes, len = ns.length;
    for (let i = 0; i < len; i++) {
      const n = ns[i];
      if (n.in && dist(n.in, n) < NEAR) steps.push(`noIn:${ci}:${i}`);
      if (n.out && dist(n.out, n) < NEAR) steps.push(`noOut:${ci}:${i}`);
      if (n.in && n.out && !n.smooth && dist(n.in, n) >= NEAR && dist(n.out, n) >= NEAR) {
        const a = Math.atan2(n.y - n.in.y, n.x - n.in.x), b = Math.atan2(n.out.y - n.y, n.out.x - n.x);
        let d = Math.abs(a - b) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < Math.PI / 180) steps.push(`smooth:${ci}:${i}`);
      }
    }
    const min = c.closed ? 3 : 2;
    let left = len;
    const last = c.closed ? len : len - 1;
    for (let i = 0; i < last && left > min; i++) {
      const n = ns[i], m = ns[(i + 1) % len];
      if (dist(n, m) < NEAR && (!n.out || dist(n.out, n) < NEAR) && (!m.in || dist(m.in, m) < NEAR)) {
        steps.push(`merge:${ci}:${i}`);
        left--;
        i++; // the next point is gone; don't merge it again
      }
    }
    for (let i = c.closed ? 0 : 1; i < (c.closed ? len : len - 1) && left > min; i++) {
      const p = ns[(i - 1 + len) % len], n = ns[i], q = ns[(i + 1) % len];
      if (n.in || n.out || p.out || q.in) continue;
      if (dist(p, n) < NEAR || dist(n, q) < NEAR) continue; // a merge handles it
      const cross = (n.x - p.x) * (q.y - n.y) - (n.y - p.y) * (q.x - n.x);
      const dot = (n.x - p.x) * (q.x - n.x) + (n.y - p.y) * (q.y - n.y);
      // Off the line by less than NEAR units, and not turning back.
      if (dot > 0 && Math.abs(cross) / dist(p, q) < NEAR) {
        if (steps.includes(`merge:${ci}:${(i - 1 + len) % len}`) || steps.includes(`merge:${ci}:${i}`)) continue;
        steps.push(`drop:${ci}:${i}`);
        left--;
        i++; // keep its neighbour: the line is measured against it
      }
    }
  });
  return steps;
}

// Applies the steps. Points are removed from the end of each contour so
// the numbers of the others still hold.
export function applyTidy(contours, steps) {
  const removals = [];
  for (const s of steps) {
    const [kind, ci, i] = s.split(':');
    const c = contours[+ci], n = c?.nodes[+i];
    if (!n) continue;
    if (kind === 'noIn') delete n.in;
    else if (kind === 'noOut') delete n.out;
    else if (kind === 'smooth') n.smooth = true;
    else removals.push([kind, +ci, +i]);
  }
  removals.sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  for (const [kind, ci, i] of removals) {
    const ns = contours[ci].nodes;
    if (kind === 'drop') { ns.splice(i, 1); continue; }
    // merge: one point with the way in of the first and the way out of the
    // second. Across the end of a closed contour the first point is the one
    // removed, so no lower number shifts.
    const j = (i + 1) % ns.length;
    const keep = j === 0 ? j : i, gone = j === 0 ? i : j;
    if (j === 0) { if (ns[i].in) ns[0].in = ns[i].in; else delete ns[0].in; } else if (ns[j].out) ns[i].out = ns[j].out; else delete ns[i].out;
    if (ns[gone].smooth) ns[keep].smooth = true;
    ns.splice(gone, 1);
  }
}

// Points that sit on another point (of any contour): "x:y" -> count.
export function coincident(contours) {
  const seen = new Map();
  const key = (n) => `${Math.round(n.x * 2)}:${Math.round(n.y * 2)}`;
  for (const c of contours) for (const n of c.nodes) seen.set(key(n), (seen.get(key(n)) || 0) + 1);
  return (n) => seen.get(key(n)) > 1;
}
