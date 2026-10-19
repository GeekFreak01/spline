// Project model and geometry helpers. Mirrors internal/project in Go.
import { SETS, glyphNameFor, defaultAdvance } from './glyphsets.js';

export const FORMAT = 'spline';
export const VERSION = 1;

export function newProject({ family = 'Мой шрифт', sets = ['latin', 'cyrillic', 'digits', 'punct'] } = {}) {
  const p = {
    format: FORMAT,
    version: VERSION,
    info: {
      familyName: family, styleName: 'Regular', designer: '', version: '1.000',
      unitsPerEm: 1000, ascender: 800, descender: -200, xHeight: 500, capHeight: 700,
    },
    glyphs: [],
    guides: [], // ruler guides: { axis: 'x' | 'y', pos }
  };
  for (const s of sets) for (const ch of SETS[s] || []) addGlyphForChar(p, ch);
  return p;
}

export function addGlyphForChar(p, ch) {
  const cp = ch.codePointAt(0);
  if (p.glyphs.some((g) => g.unicode === cp)) return null;
  let name = glyphNameFor(ch);
  while (p.glyphs.some((g) => g.name === name)) name += '.alt';
  const g = { name, unicode: cp, advance: defaultAdvance(ch), contours: [] };
  p.glyphs.push(g);
  return g;
}

export function charOf(g) {
  return g.unicode ? String.fromCodePoint(g.unicode) : '';
}

// Everything a glyph draws: its own contours and its components' (see
// components.js). Only the own contours are editable.
export function outline(g) {
  return g.refContours?.length ? [...g.contours, ...g.refContours] : g.contours;
}

export const hasOutline = (g) => g.contours.length > 0 || g.refContours?.length > 0;

export function isDrawn(g) {
  return hasOutline(g) || g.unicode === 32;
}

// Accepts any parsed JSON and returns a clean project or throws.
export function validateProject(p) {
  if (!p || p.format !== FORMAT) throw new Error('not a Spline (.sp) file');
  if (p.version > VERSION) throw new Error('file is from a newer Spline version');
  const base = newProject({ sets: [] });
  p.info = { ...base.info, ...(p.info || {}) };
  if (!Array.isArray(p.glyphs)) p.glyphs = [];
  // Kerning: { leftGlyph: { rightGlyph: value } }
  const kern = {};
  for (const [l, rights] of Object.entries(p.kerning && typeof p.kerning === 'object' ? p.kerning : {})) {
    for (const [r, v] of Object.entries(rights || {})) {
      if (Number.isFinite(v)) (kern[l] ||= {})[r] = Math.round(v); // 0 = exception
    }
  }
  p.kerning = kern;
  // Substitutions: contextual alternates and ligatures (glyph names).
  const names = (a) => (Array.isArray(a) ? a.filter((n) => typeof n === 'string' && n) : []);
  p.contextual = (Array.isArray(p.contextual) ? p.contextual : [])
    .filter((r) => r && typeof r.glyph === 'string' && typeof r.use === 'string' && r.glyph && r.use)
    .map((r) => ({ glyph: r.glyph, use: r.use, prev: names(r.prev), next: names(r.next) }));
  p.ligatures = (Array.isArray(p.ligatures) ? p.ligatures : [])
    .filter((l) => l && typeof l.use === 'string' && l.use && names(l.glyphs).length >= 2)
    .map((l) => ({ glyphs: names(l.glyphs), use: l.use }));
  p.guides = (Array.isArray(p.guides) ? p.guides : [])
    .filter((g) => g && (g.axis === 'x' || g.axis === 'y') && Number.isFinite(g.pos));
  for (const g of p.glyphs) {
    g.contours = Array.isArray(g.contours) ? g.contours : [];
    g.advance = Number.isFinite(g.advance) ? g.advance : 600;
    if (!(g.compose && typeof g.compose.base === 'string' && Array.isArray(g.compose.marks))) delete g.compose;
    if (g.composeOff !== true) delete g.composeOff;
    if (!Array.isArray(g.background) || !g.background.length) delete g.background;
    g.components = (Array.isArray(g.components) ? g.components : [])
      .filter((k) => k && typeof k.glyph === 'string' && k.glyph && k.glyph !== g.name)
      .map((k) => ({ glyph: k.glyph, x: Number(k.x) || 0, y: Number(k.y) || 0 }));
    if (!g.components.length) delete g.components;
    if (!Array.isArray(g.refContours) || !g.refContours.length) delete g.refContours;
    g.anchors = (Array.isArray(g.anchors) ? g.anchors : [])
      .filter((a) => a && typeof a.name === 'string' && a.name && Number.isFinite(a.x) && Number.isFinite(a.y)).slice(0, 64);
    if (!g.anchors.length) delete g.anchors;
    if (Array.isArray(g.snapshots)) g.snapshots = g.snapshots.filter((x) => x && Array.isArray(x.contours) && Number.isFinite(x.advance)).slice(-20);
    if (!g.snapshots?.length) delete g.snapshots;
    for (const k of ['lsbKey', 'rsbKey', 'widthKey']) if (typeof g[k] !== 'string' || !g[k]) delete g[k];
    const im = g.image;
    if (!(im && typeof im.data === 'string' && im.data.startsWith('data:image/')
      && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(im[k])) && im.w > 0 && im.h > 0)) delete g.image;
    for (const c of g.contours) {
      c.nodes = Array.isArray(c.nodes) ? c.nodes : [];
      if (c.closed === undefined) c.closed = true;
    }
  }
  return p;
}

// Compact but readable: one glyph per line, coordinates rounded.
export function serialize(p) {
  const round = (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  const head = { ...p, glyphs: '__GLYPHS__' };
  const glyphs = p.glyphs.map((g) => '    ' + JSON.stringify(g, round)).join(',\n');
  return JSON.stringify(head, null, 2).replace('"__GLYPHS__"', `[\n${glyphs}\n  ]`) + '\n';
}

export const clone = (o) => structuredClone(o);

// ------------------------------------------------------------ geometry

export function segments(c) {
  const n = c.nodes.length;
  const out = [];
  const last = c.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = c.nodes[i];
    const b = c.nodes[(i + 1) % n];
    if (!a.out && !b.in) out.push({ line: true, p0: a, p3: b, i });
    else out.push({ line: false, p0: a, c1: a.out || a, c2: b.in || b, p3: b, i });
  }
  return out;
}

export function pointAt(s, t) {
  if (s.line) return { x: s.p0.x + (s.p3.x - s.p0.x) * t, y: s.p0.y + (s.p3.y - s.p0.y) * t };
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y,
  };
}

export function flatten(c, steps = 12) {
  const pts = [];
  for (const s of segments({ ...c, closed: true })) {
    if (s.line) { pts.push({ x: s.p0.x, y: s.p0.y }); continue; }
    for (let i = 0; i < steps; i++) pts.push(pointAt(s, i / steps));
  }
  return pts;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polyBox(pts) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y > b.maxY) b.maxY = p.y;
  }
  return b;
}

export function glyphBox(g) {
  const pts = outline(g).flatMap((c) => flatten(c, 8));
  return pts.length ? polyBox(pts) : null;
}

const boxContains = (a, b) => b.minX >= a.minX && b.maxX <= a.maxX && b.minY >= a.minY && b.maxY <= a.maxY;

export function reverseContour(c) {
  c.nodes.reverse();
  for (const n of c.nodes) [n.in, n.out] = [n.out, n.in];
  for (const n of c.nodes) { if (!n.in) delete n.in; if (!n.out) delete n.out; }
}

// Same rule as the Go exporter: a contour completely inside an odd number
// of other contours is a hole (clockwise); everything else is filled
// (counter-clockwise). Overlapping shapes therefore merge.
// Returns the contours that were reversed.
export function normalizeDirections(g) {
  const closed = g.contours.filter((c) => c.closed && c.nodes.length >= 2);
  const polys = closed.map((c) => flatten(c));
  const boxes = polys.map(polyBox);
  const reversed = [];
  closed.forEach((c, i) => {
    let depth = 0;
    closed.forEach((_, j) => {
      if (i === j || !boxContains(boxes[j], boxes[i])) return;
      if (polys[i].every((p) => pointInPolygon(p, polys[j]))) depth++;
    });
    const area = signedArea(polys[i]);
    if (Math.abs(area) < 1e-6) return;
    const wantCCW = depth % 2 === 0;
    if ((area > 0) !== wantCCW) { reverseContour(c); reversed.push(c); }
  });
  return reversed;
}

// Canvas / SVG path for a glyph in font units (y up).
export function tracePath(ctx, g, closedOnly = false) {
  for (const c of outline(g)) {
    if (!c.nodes.length || (closedOnly && !c.closed)) continue;
    const segs = segments(c);
    ctx.moveTo(c.nodes[0].x, c.nodes[0].y);
    for (const s of segs) {
      if (s.line) ctx.lineTo(s.p3.x, s.p3.y);
      else ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p3.x, s.p3.y);
    }
    if (c.closed) ctx.closePath();
  }
}

export function svgPath(g) {
  const r = (v) => Math.round(v);
  let d = '';
  for (const c of outline(g)) {
    if (!c.nodes.length) continue;
    d += `M${r(c.nodes[0].x)} ${r(c.nodes[0].y)}`;
    for (const s of segments({ ...c, closed: true })) {
      d += s.line ? `L${r(s.p3.x)} ${r(s.p3.y)}`
        : `C${r(s.c1.x)} ${r(s.c1.y)} ${r(s.c2.x)} ${r(s.c2.y)} ${r(s.p3.x)} ${r(s.p3.y)}`;
    }
    d += 'Z';
  }
  return d;
}

// Moves every point of a glyph by dx, dy.
export function translateGlyph(g, dx, dy) {
  for (const c of outline(g)) for (const n of c.nodes) movePoint(n, dx, dy, true);
  for (const k of g.components || []) { k.x += dx; k.y += dy; }
  for (const a of g.anchors || []) { a.x += dx; a.y += dy; }
}

export function movePoint(n, dx, dy, withHandles) {
  n.x += dx; n.y += dy;
  if (withHandles) {
    if (n.in) { n.in.x += dx; n.in.y += dy; }
    if (n.out) { n.out.x += dx; n.out.y += dy; }
  }
}

export function transformGlyph(g, fn) {
  for (const c of g.contours) {
    for (const n of c.nodes) {
      Object.assign(n, fn(n));
      if (n.in) n.in = fn(n.in);
      if (n.out) n.out = fn(n.out);
    }
  }
}

// Splits segment s of contour c at t and inserts a new node.
export function insertNode(c, s, t) {
  const n = c.nodes.length;
  const a = c.nodes[s.i];
  const b = c.nodes[(s.i + 1) % n];
  const lerp = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  let node;
  if (s.line) {
    node = lerp(a, b, t);
  } else {
    const p01 = lerp(s.p0, s.c1, t), p12 = lerp(s.c1, s.c2, t), p23 = lerp(s.c2, s.p3, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    const m = lerp(p012, p123, t);
    node = { x: m.x, y: m.y, in: p012, out: p123, smooth: true };
    a.out = p01;
    b.in = p23;
  }
  c.nodes.splice(s.i + 1, 0, node);
  return node;
}

// Rectangle and ellipse contours, counter-clockwise.
export function rectContour(x0, y0, x1, y1) {
  const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
  return { closed: true, nodes: [{ x: a, y: c }, { x: b, y: c }, { x: b, y: d }, { x: a, y: d }] };
}

export function ellipseContour(x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const k = 0.5523;
  return {
    closed: true,
    nodes: [
      { x: cx, y: cy - ry, in: { x: cx - rx * k, y: cy - ry }, out: { x: cx + rx * k, y: cy - ry }, smooth: true },
      { x: cx + rx, y: cy, in: { x: cx + rx, y: cy - ry * k }, out: { x: cx + rx, y: cy + ry * k }, smooth: true },
      { x: cx, y: cy + ry, in: { x: cx + rx * k, y: cy + ry }, out: { x: cx - rx * k, y: cy + ry }, smooth: true },
      { x: cx - rx, y: cy, in: { x: cx - rx, y: cy + ry * k }, out: { x: cx - rx, y: cy - ry * k }, smooth: true },
    ],
  };
}
