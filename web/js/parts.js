// Parts (extended mode): details drawn once in their own glyph and placed
// along the outline of other glyphs, as live references.
//
//  - Corner details ("_corner.serif"): set on a sharp point (node.corner).
//    Draw the detail for the bottom-left corner of a stem: the point is at
//    (0, 0), the horizontal side of the corner runs to the right along +X,
//    the inside of the letter is up (+Y). Spline turns and mirrors it for
//    every other corner, so one serif fits all four corners of a stem.
//  - Brushes ("_brush.round"): set on an open line (contour.brush). The
//    detail is stretched along the line: its width follows the line's
//    length, its height stays (the line runs through y = 0).
import { segments, pointAt, flatten, glyphBox, outline } from './model.js';
import { simplifyContours } from './simplify.js';

const unit = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };

export const isCornerGlyph = (g) => g.name.startsWith('_corner');
export const isBrushGlyph = (g) => g.name.startsWith('_brush');

// Directions away from node i along its two sides.
function sides(c, i) {
  const n = c.nodes.length, p = c.nodes[i];
  const prev = c.nodes[(i - 1 + n) % n], next = c.nodes[(i + 1) % n];
  const a = unit({ x: (p.in || prev.out || prev).x - p.x, y: (p.in || prev.out || prev).y - p.y });
  const b = unit({ x: (p.out || next.in || next).x - p.x, y: (p.out || next.in || next).y - p.y });
  return [a, b];
}

function placeCorner(c, i, detail) {
  const p = c.nodes[i];
  const [a, b] = sides(c, i);
  // X runs along the more horizontal side, away from the corner; Y points
  // into the letter, towards the other side.
  const [u, w] = Math.abs(a.x) >= Math.abs(b.x) ? [a, b] : [b, a];
  let v = { x: -u.y, y: u.x };
  if (v.x * w.x + v.y * w.y < 0) v = { x: -v.x, y: -v.y };
  const map = (q) => ({ x: Math.round(p.x + q.x * u.x + q.y * v.x), y: Math.round(p.y + q.x * u.y + q.y * v.y) });
  return outline(detail).map((dc) => ({
    closed: dc.closed,
    nodes: dc.nodes.map((n) => {
      const m = { ...map(n) };
      if (n.in) m.in = map(n.in);
      if (n.out) m.out = map(n.out);
      if (n.smooth) m.smooth = true;
      return m;
    }),
  }));
}

// Samples an open path by length: a function from 0..1 to point and normal.
function pathSampler(c) {
  const pts = [];
  for (const s of segments(c)) for (let k = 0; k < 32; k++) pts.push(pointAt(s, k / 32));
  pts.push({ x: c.nodes[c.nodes.length - 1].x, y: c.nodes[c.nodes.length - 1].y });
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = acc[acc.length - 1] || 1;
  return (t) => {
    const d = Math.max(0, Math.min(1, t)) * total;
    let j = 1;
    while (j < acc.length - 1 && acc[j] < d) j++;
    const a = pts[j - 1], b = pts[j], seg = acc[j] - acc[j - 1] || 1;
    const k = (d - acc[j - 1]) / seg;
    const dir = unit({ x: b.x - a.x, y: b.y - a.y });
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, nx: -dir.y, ny: dir.x };
  };
}

function placeBrush(c, detail) {
  const box = glyphBox(detail);
  if (!box || c.nodes.length < 2) return [];
  const at = pathSampler(c);
  const w = box.maxX - box.minX || 1;
  const out = outline(detail).map((dc) => {
    const pts = flatten(dc, 24);
    return {
      closed: true,
      nodes: pts.map((q) => {
        const s = at((q.x - box.minX) / w);
        return { x: Math.round(s.x + s.nx * q.y), y: Math.round(s.y + s.ny * q.y) };
      }),
    };
  });
  simplifyContours(out, 2);
  return out;
}

// Outlines that the corners and brushes of g add.
export function partsOutline(project, g, byName) {
  const out = [];
  for (const c of g.contours) {
    if (c.brush && !c.closed) {
      const d = byName.get(c.brush);
      if (d) out.push(...placeBrush(c, d));
    }
    c.nodes.forEach((n, i) => {
      if (!n.corner || (!c.closed && (i === 0 || i === c.nodes.length - 1))) return;
      const d = byName.get(n.corner);
      if (d) out.push(...placeCorner(c, i, d));
    });
  }
  return out;
}
